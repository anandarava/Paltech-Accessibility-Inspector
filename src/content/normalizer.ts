/**
 * Turns axe-core results and custom-rule findings into the shared `Issue`
 * shape: project rule id, WCAG reference, type, severity, stable selector,
 * XPath, HTML snippet, bounding boxes, fix guidance and fingerprint.
 */
import type axe from "axe-core";
import type { Category, CheckType, Issue, RuleDefinition, RulesFile, Severity, WcagLevel, WcagRef } from "@shared/types";
import { AXE_TO_RULE, BEST_PRACTICE_RULES, criterionFromAxeTag, wcagDocsUrl, wcagRef } from "@shared/wcag-map";
import type { CustomRule, RuleFinding } from "./rules/types";
import { fingerprint, textSnippet } from "./fingerprint";
import { boundingBoxes, fingerprintSelector, outerHtmlSnippet, resolveSelector, uniqueSelector, xpath } from "./dom-utils";

// ---------------------------------------------------------------------------
// Issue ids: unique within a browsing context, and (via the random token)
// practically unique across the frames the service worker merges.
// ---------------------------------------------------------------------------

const ID_TOKEN = Math.random().toString(36).slice(2, 7);
let idCounter = 0;

function nextIssueId(): string {
  idCounter += 1;
  return `iss_${ID_TOKEN}_${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Rule lookup
// ---------------------------------------------------------------------------

interface RuleIndex {
  byId: Map<string, RuleDefinition>;
  byAxeId: Map<string, RuleDefinition>;
}

const indexCache = new WeakMap<RulesFile, RuleIndex>();

function indexRules(rulesFile: RulesFile): RuleIndex {
  const cached = indexCache.get(rulesFile);
  if (cached) return cached;
  const byId = new Map<string, RuleDefinition>();
  const byAxeId = new Map<string, RuleDefinition>();
  for (const rule of rulesFile.rules) {
    byId.set(rule.id, rule);
    for (const axeId of rule.axeRules ?? []) {
      if (!byAxeId.has(axeId)) byAxeId.set(axeId, rule);
    }
  }
  for (const [axeId, projectId] of Object.entries(AXE_TO_RULE)) {
    const def = byId.get(projectId);
    if (def && !byAxeId.has(axeId)) byAxeId.set(axeId, def);
  }
  const index = { byId, byAxeId };
  indexCache.set(rulesFile, index);
  return index;
}

/** Project rule id for an axe rule id (AXE_TO_RULE, then the rules file, else the axe id itself). */
export function projectRuleIdForAxe(axeId: string, rulesFile: RulesFile): string {
  const mapped = AXE_TO_RULE[axeId];
  if (mapped) return mapped;
  const def = indexRules(rulesFile).byAxeId.get(axeId);
  return def ? def.id : axeId;
}

/** All axe rule ids that feed the given project rule id. */
export function axeIdsForProjectRule(projectId: string, rulesFile: RulesFile): string[] {
  const ids = new Set<string>();
  const def = indexRules(rulesFile).byId.get(projectId);
  for (const axeId of def?.axeRules ?? []) ids.add(axeId);
  for (const [axeId, mapped] of Object.entries(AXE_TO_RULE)) if (mapped === projectId) ids.add(axeId);
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IMPACT_TO_SEVERITY: Record<string, Severity> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};

function severityFromImpact(impact: axe.ImpactValue | undefined): Severity {
  return (impact && IMPACT_TO_SEVERITY[impact]) || "Moderate";
}

const AXE_CATEGORY_BY_TAG: Record<string, Category> = {
  "cat.aria": "ARIA",
  "cat.name-role-value": "ARIA",
  "cat.color": "Color and Contrast",
  "cat.sensory-and-visual-cues": "Color and Contrast",
  "cat.forms": "Forms",
  "cat.keyboard": "Keyboard and Focus",
  "cat.language": "Page Structure and Semantics",
  "cat.structure": "Page Structure and Semantics",
  "cat.semantics": "Page Structure and Semantics",
  "cat.tables": "Page Structure and Semantics",
  "cat.parsing": "Page Structure and Semantics",
  "cat.text-alternatives": "Images and Media",
  "cat.time-and-media": "Images and Media",
};

function categoryFromTags(tags: string[]): Category | undefined {
  for (const tag of tags) {
    const cat = AXE_CATEGORY_BY_TAG[tag];
    if (cat) return cat;
  }
  return undefined;
}

function isBestPracticeOnly(tags: string[]): boolean {
  return tags.includes("best-practice") && !tags.some((t) => /^wcag\d{3,4}$/.test(t));
}

/** Conformance level an axe rule is tagged with ("wcag2a", "wcag21aa", "wcag22aaa", ...). */
function levelFromAxeTags(tags: string[]): WcagLevel | undefined {
  if (tags.some((t) => /^wcag2\d?a$/.test(t))) return "A";
  if (tags.some((t) => /^wcag2\d?aa$/.test(t))) return "AA";
  if (tags.some((t) => /^wcag2\d?aaa$/.test(t))) return "AAA";
  return undefined;
}

function bestPracticeRef(): WcagRef {
  return { criterion: "", name: "Best practice", level: "BP" };
}

/**
 * WCAG reference for an axe result that maps to a project rule definition.
 * The definition is the default, but the axe result's own tags decide whether
 * the hit is a WCAG failure at all:
 * - an axe rule tagged best-practice only (no wcagXXX tag), e.g.
 *   meta-viewport-large, aria-allowed-role or skip-link, is reported as level
 *   "BP" even when grouped under a Level A/AA project rule, so it never
 *   affects conformance;
 * - an axe rule carrying a real wcagXXX tag is a WCAG failure even when it is
 *   grouped under a best-practice project rule (form-field-multiple-labels,
 *   p-as-heading);
 * - an AAA-only axe rule (meta-refresh-no-exceptions) is not reported at the
 *   definition's A/AA level.
 */
function wcagForMappedAxeResult(
  ruleId: string,
  def: RuleDefinition,
  tags: string[],
  firstCriterion: string | undefined,
): WcagRef {
  if (isBestPracticeOnly(tags)) return bestPracticeRef();
  const fromDef = resolveWcag(ruleId, def.wcag);
  const axeLevel = levelFromAxeTags(tags);
  if (!firstCriterion || !axeLevel) return fromDef;
  if (fromDef.level === "BP" || (axeLevel === "AAA" && fromDef.level !== "AAA")) {
    const fromTags = wcagRef(firstCriterion);
    if (fromTags.level !== "BP") return fromTags;
  }
  return fromDef;
}

/** Rules listed in BEST_PRACTICE_RULES never count as WCAG failures: force level "BP". */
function resolveWcag(ruleId: string, ref: WcagRef): WcagRef {
  if (BEST_PRACTICE_RULES.has(ruleId) && ref.level !== "BP") {
    return { criterion: ref.criterion, name: ref.name, level: "BP" };
  }
  return { criterion: ref.criterion, name: ref.name, level: ref.level };
}

function collapse(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function sentence(text: string): string {
  const t = collapse(text);
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Deep-clone to a JSON-safe value, dropping anything that cannot be serialised. */
function jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v: unknown) => {
        if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") return undefined;
        if (typeof Node !== "undefined" && v instanceof Node) return undefined;
        return v;
      }),
    );
  } catch {
    return undefined;
  }
}

function elementRef(el: Element | null, fallbackSelector: string, fallbackHtml: string): Issue["element"] {
  if (el) {
    const boxes = boundingBoxes(el);
    return {
      selector: uniqueSelector(el),
      xpath: xpath(el),
      html: outerHtmlSnippet(el),
      boundingBox: boxes.page,
      viewportBox: boxes.viewport,
    };
  }
  return {
    selector: fallbackSelector,
    xpath: "",
    html: outerHtmlSnippet({ outerHTML: fallbackHtml, localName: "" } as unknown as Element),
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    viewportBox: { x: 0, y: 0, width: 0, height: 0 },
  };
}

/** Resolve an axe node target (frame-local; shadow DOM targets are arrays) to an element. */
function resolveAxeTarget(target: axe.UnlabelledFrameSelector): Element | null {
  let root: ParentNode = document;
  let found: Element | null = null;
  for (const part of target) {
    const chain = Array.isArray(part) ? part : [part];
    for (const selector of chain) {
      if (typeof selector !== "string") return null;
      found = resolveSelector(selector, root);
      if (!found) return null;
      root = found.shadowRoot ?? found;
    }
  }
  return found;
}

function axeTargetToString(target: axe.UnlabelledFrameSelector): string {
  return target.map((part) => (Array.isArray(part) ? part.join(" >>> ") : String(part))).join(" ");
}

function checkMessages(node: axe.NodeResult): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const check of [...node.any, ...node.all, ...node.none]) {
    const msg = collapse(check.message);
    if (msg && !seen.has(msg)) {
      seen.add(msg);
      out.push(msg);
    }
  }
  return out;
}

function failureSummaryText(node: axe.NodeResult): string {
  const raw = node.failureSummary ?? "";
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// axe results
// ---------------------------------------------------------------------------

/** True when some text inside `el` is painted and not inside an aria-hidden subtree. */
function hasShownText(el: Element): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/\S/.test(n.textContent ?? "")) continue;
    const parent = n.parentElement;
    if (!parent || parent.closest("[aria-hidden='true']")) continue;
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const withCheck = parent as Element & { checkVisibility?: (o?: { visibilityProperty?: boolean; opacityProperty?: boolean }) => boolean };
    if (typeof withCheck.checkVisibility === "function" && !withCheck.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    return true;
  }
  return false;
}

const LANDMARK_SELECTOR = "main, [role='main'], nav, [role='navigation'], [role='region'], [role='search'], [role='complementary'], aside, [role='contentinfo'], [role='banner']";

/** An in-page link whose target is a landmark or sits in one (a skip link). */
function isSkipLink(el: Element): boolean {
  const href = el.getAttribute("href") ?? "";
  if (el.localName !== "a" || !href.startsWith("#") || href.length < 2) return false;
  let id = href.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // keep the raw id
  }
  const target = el.ownerDocument.getElementById(id);
  return !!target && (target.matches(LANDMARK_SELECTOR) || target.closest(LANDMARK_SELECTOR) !== null);
}

/**
 * axe-core results that are known to be wrong for the element, checked on the
 * live element:
 *  - `label-content-name-mismatch` (experimental) on a control with no visible
 *    text: the "label" it compares is hidden text (a 0x0, aria-hidden badge),
 *    so there is no visible label to mismatch.
 *  - `region` on a skip link: axe exempts a skip link only when it is the first
 *    link on the page, and cookie banners often come first. A link to a
 *    landmark is a bypass mechanism, not content outside landmarks.
 */
function isKnownAxeMisfire(axeRuleId: string, element: Element | null): boolean {
  if (!element) return false;
  try {
    if (axeRuleId === "label-content-name-mismatch") return !hasShownText(element);
    if (axeRuleId === "region") return isSkipLink(element);
  } catch {
    // keep the finding
  }
  return false;
}

const SEVERITY_RANK: Record<Severity, number> = { Minor: 0, Moderate: 1, Serious: 2, Critical: 3 };

/** What to do with one axe "incomplete" (needs review) result. */
type ReviewVerdict = "keep" | "drop" | "definite";

/** Ids named in axe's `needsReview` text, e.g. `aria-controls="top-search menu"`. */
function reviewIds(node: axe.NodeResult): { attribute: string; ids: string[] } | null {
  for (const check of [...node.any, ...node.all, ...node.none]) {
    const text = (check.data as { needsReview?: unknown } | null)?.needsReview;
    if (typeof text !== "string") continue;
    const m = /^(aria-[a-z]+)="([^"]*)"$/.exec(text.trim());
    if (m) return { attribute: m[1] ?? "", ids: (m[2] ?? "").split(/\s+/).filter(Boolean) };
  }
  return null;
}

function messageKey(node: axe.NodeResult): string {
  for (const check of [...node.any, ...node.all, ...node.none]) {
    const key = (check.data as { messageKey?: unknown } | null)?.messageKey;
    if (typeof key === "string") return key;
  }
  return "";
}

/**
 * Decide an axe "incomplete" result that this extension can settle:
 *  - `aria-allowed-role` on a hidden element whose role is already reported
 *    as a definite failure on a visible element: a hidden copy (other
 *    carousel slides), dropped.
 *  - `aria-valid-attr-value` that axe leaves open because the control opens a
 *    popup: dropped when the referenced ids exist now, or the control is
 *    collapsed (popups are often built when opened).
 *  - `aria-labelledby` where none of the referenced ids exist: the element
 *    gets no name from it, a definite failure.
 */
function reviewVerdict(result: axe.Result, node: axe.NodeResult, element: Element | null, confirmedRoles: Set<string>): ReviewVerdict {
  try {
    if (result.id === "aria-allowed-role") {
      const roles = [...node.any, ...node.all, ...node.none].flatMap((c) => (Array.isArray(c.data) ? c.data.map(String) : []));
      return roles.length > 0 && roles.every((r) => confirmedRoles.has(r)) ? "drop" : "keep";
    }
    if (result.id === "aria-valid-attr-value" && element) {
      const ref = reviewIds(node);
      if (!ref) return "keep";
      const doc = element.ownerDocument;
      const existing = ref.ids.filter((id) => doc.getElementById(id));
      if (messageKey(node) === "controlsWithinPopup") {
        return existing.length === ref.ids.length || element.getAttribute("aria-expanded") === "false" ? "drop" : "keep";
      }
      if (ref.attribute === "aria-labelledby" && ref.ids.length > 0 && existing.length === 0) return "definite";
    }
  } catch {
    // keep the finding as axe reported it
  }
  return "keep";
}

/** Roles axe reports as definitely not allowed (aria-allowed-role violations), for reviewVerdict. */
function confirmedDisallowedRoles(violations: axe.Result[]): Set<string> {
  const roles = new Set<string>();
  for (const result of violations) {
    if (result.id !== "aria-allowed-role") continue;
    for (const node of result.nodes ?? []) for (const c of [...node.any, ...node.all, ...node.none]) if (Array.isArray(c.data)) for (const r of c.data) roles.add(String(r));
  }
  return roles;
}

interface AxeMapping {
  ruleId: string;
  title: string;
  category: Category;
  wcag: WcagRef;
  type: CheckType;
  severity: Severity;
  docsUrl: string | undefined;
  def: RuleDefinition | undefined;
}

function mapAxeRule(result: axe.Result, rulesFile: RulesFile, incomplete: boolean): AxeMapping {
  const { byId } = indexRules(rulesFile);
  const ruleId = projectRuleIdForAxe(result.id, rulesFile);
  const def = byId.get(ruleId);
  const tags = result.tags ?? [];
  const firstCriterion = tags.map(criterionFromAxeTag).find((c): c is string => Boolean(c));

  if (def) {
    const wcag = wcagForMappedAxeResult(ruleId, def, tags, firstCriterion);
    const type: CheckType = def.type === "Semi" || incomplete ? "Semi" : "Auto";
    // When the level comes from the axe tags rather than the definition, the
    // definition's category/severity describe the WCAG failure, not this hit:
    // fall back to what axe says about this particular rule.
    const forcedBp = wcag.level === "BP" && def.wcag.level !== "BP";
    const upgraded = wcag.level !== "BP" && def.wcag.level === "BP";
    let category: Category = def.category;
    if (forcedBp) category = "Best Practice";
    else if (upgraded && def.category === "Best Practice") category = categoryFromTags(tags) ?? "Other";
    const severity: Severity = forcedBp
      ? severityFromImpact(result.impact)
      : (def.severity ?? severityFromImpact(result.impact));
    const docsUrl =
      wcagDocsUrl(wcag.criterion) ?? (forcedBp ? (result.helpUrl ?? def.docsUrl) : (def.docsUrl ?? result.helpUrl));
    return {
      ruleId,
      title: def.check,
      category,
      wcag,
      type,
      severity,
      docsUrl,
      def,
    };
  }

  const bpOnly = isBestPracticeOnly(tags) || !firstCriterion;
  const wcag: WcagRef = bpOnly ? bestPracticeRef() : wcagRef(firstCriterion);
  const category: Category = bpOnly ? "Best Practice" : (categoryFromTags(tags) ?? "Other");
  return {
    ruleId,
    title: collapse(result.help) || result.id,
    category,
    wcag,
    type: incomplete ? "Semi" : "Auto",
    severity: severityFromImpact(result.impact),
    docsUrl: (wcag.criterion && wcagDocsUrl(wcag.criterion)) || result.helpUrl,
    def: undefined,
  };
}

function normalizeAxeGroup(results: axe.Result[], rulesFile: RulesFile, incomplete: boolean, out: Issue[], confirmedRoles: Set<string> = new Set()): void {
  for (const result of results) {
    const mapping = mapAxeRule(result, rulesFile, incomplete);
    for (const node of result.nodes ?? []) {
      let element: Element | null = null;
      try {
        element = node.element instanceof Element ? node.element : resolveAxeTarget(node.target);
      } catch {
        element = null;
      }
      if (isKnownAxeMisfire(result.id, element)) continue;
      const verdict: ReviewVerdict = incomplete ? reviewVerdict(result, node, element, confirmedRoles) : "keep";
      if (verdict === "drop") continue;
      const settled = verdict === "definite";
      const messages = checkMessages(node);
      const ref = elementRef(element, axeTargetToString(node.target), node.html);
      const snippet = element ? textSnippet(element) : collapse(node.html).slice(0, 40);
      const fp = fingerprint(mapping.ruleId, element ? fingerprintSelector(element, ref.selector) : ref.selector, snippet);
      const summary = failureSummaryText(node);
      const descriptionParts = [sentence(result.description)];
      if (messages.length) descriptionParts.push(messages.map(sentence).join(" "));
      if (settled) descriptionParts.push("None of the referenced ids exist on the page, so the element gets no name from aria-labelledby.");
      else if (incomplete) descriptionParts.push("axe-core could not determine the result automatically; verify manually.");

      const fixParts = [sentence(result.help)];
      if (summary) fixParts.push(sentence(summary));
      else if (messages.length) fixParts.push(messages.map(sentence).join(" "));

      let severity = node.impact && !mapping.def?.severity ? severityFromImpact(node.impact) : mapping.severity;
      if (incomplete && !settled) {
        // axe could not decide: the project rule's severity describes a confirmed failure, not this
        // hit. Use axe's own impact for the element, and never call an undecided result Critical.
        const impact = node.impact ?? result.impact;
        if (impact) severity = severityFromImpact(impact);
        if (SEVERITY_RANK[severity] > SEVERITY_RANK.Serious) severity = "Serious";
      }

      out.push({
        id: nextIssueId(),
        ruleId: mapping.ruleId,
        source: "axe",
        title: mapping.title,
        description: descriptionParts.join(" "),
        wcag: mapping.wcag,
        type: settled ? "Auto" : mapping.type,
        severity,
        category: mapping.category,
        element: ref,
        data: {
          axeRuleId: result.id,
          impact: node.impact ?? result.impact ?? null,
          tags: result.tags,
          checks: jsonSafe(
            [...node.any, ...node.all, ...node.none].map((c) => ({ id: c.id, message: c.message, data: c.data })),
          ),
        },
        fix: {
          summary: fixParts.join(" "),
          docsUrl: mapping.docsUrl,
        },
        fingerprint: fp,
        status: "new",
      });
    }
  }
}

export function normalizeAxeResults(results: axe.AxeResults, rulesFile: RulesFile): Issue[] {
  const issues: Issue[] = [];
  normalizeAxeGroup(results.violations ?? [], rulesFile, false, issues);
  normalizeAxeGroup(results.incomplete ?? [], rulesFile, true, issues, confirmedDisallowedRoles(results.violations ?? []));
  return issues;
}

// ---------------------------------------------------------------------------
// Custom findings
// ---------------------------------------------------------------------------

function emittedRuleId(rule: CustomRule, finding: RuleFinding): string {
  const candidate = finding.data?.ruleId;
  if (typeof candidate === "string" && candidate && (candidate === rule.id || rule.emits?.includes(candidate))) {
    return candidate;
  }
  return rule.id;
}

export function normalizeCustomFindings(rule: CustomRule, findings: RuleFinding[], rulesFile: RulesFile): Issue[] {
  const { byId } = indexRules(rulesFile);
  const issues: Issue[] = [];
  for (const finding of findings) {
    if (!finding || !(finding.element instanceof Element)) continue;
    const ruleId = emittedRuleId(rule, finding);
    const def = byId.get(ruleId);
    const wcag = resolveWcag(ruleId, def?.wcag ?? rule.wcag);
    let type: CheckType = finding.type ?? def?.type ?? rule.type;
    if (type === "Manual") type = "Semi";
    const severity: Severity = finding.severity ?? def?.severity ?? rule.severity;
    const ref = elementRef(finding.element, "", "");
    const snippet = textSnippet(finding.element);
    const fp = fingerprint(ruleId, fingerprintSelector(finding.element, ref.selector), snippet);
    const data = finding.data ? (jsonSafe(finding.data) as Record<string, unknown> | undefined) : undefined;
    const fixSummary = collapse(finding.fix?.summary) || collapse(rule.defaultFix.summary);
    const docsUrl = finding.fix?.docsUrl ?? rule.defaultFix.docsUrl ?? wcagDocsUrl(wcag.criterion) ?? def?.docsUrl;
    const suggestedValue = finding.fix?.suggestedValue ?? rule.defaultFix.suggestedValue;

    issues.push({
      id: nextIssueId(),
      ruleId,
      source: "custom",
      title: def?.check ?? rule.title,
      description: collapse(finding.description) || def?.check || rule.title,
      wcag,
      type,
      severity,
      category: def?.category ?? rule.category,
      element: ref,
      data,
      fix: {
        summary: fixSummary,
        ...(suggestedValue !== undefined ? { suggestedValue } : {}),
        ...(docsUrl ? { docsUrl } : {}),
      },
      fingerprint: fp,
      status: "new",
    });
  }
  return issues;
}

/** Same fingerprint -> keep the first occurrence. */
export function dedupeIssues(issues: Issue[]): Issue[] {
  // Same fingerprint = same rule on the same element. A definite finding replaces a
  // needs-review ("Semi") one, e.g. a custom rule confirming what axe-core left incomplete.
  const at = new Map<string, number>();
  const out: Issue[] = [];
  for (const issue of issues) {
    const index = at.get(issue.fingerprint);
    if (index === undefined) {
      at.set(issue.fingerprint, out.length);
      out.push(issue);
    } else if (out[index]?.type === "Semi" && issue.type !== "Semi") {
      out[index] = issue;
    }
  }
  return out;
}
