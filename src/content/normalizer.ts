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
import { boundingBoxes, outerHtmlSnippet, resolveSelector, uniqueSelector, xpath } from "./dom-utils";

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

function normalizeAxeGroup(results: axe.Result[], rulesFile: RulesFile, incomplete: boolean, out: Issue[]): void {
  for (const result of results) {
    const mapping = mapAxeRule(result, rulesFile, incomplete);
    for (const node of result.nodes ?? []) {
      let element: Element | null = null;
      try {
        element = node.element instanceof Element ? node.element : resolveAxeTarget(node.target);
      } catch {
        element = null;
      }
      const messages = checkMessages(node);
      const ref = elementRef(element, axeTargetToString(node.target), node.html);
      const snippet = element ? textSnippet(element) : collapse(node.html).slice(0, 40);
      const fp = fingerprint(mapping.ruleId, ref.selector, snippet);
      const summary = failureSummaryText(node);
      const descriptionParts = [sentence(result.description)];
      if (messages.length) descriptionParts.push(messages.map(sentence).join(" "));
      if (incomplete) descriptionParts.push("axe-core could not determine the result automatically; verify manually.");

      const fixParts = [sentence(result.help)];
      if (summary) fixParts.push(sentence(summary));
      else if (messages.length) fixParts.push(messages.map(sentence).join(" "));

      const severity = node.impact && !mapping.def?.severity ? severityFromImpact(node.impact) : mapping.severity;

      out.push({
        id: nextIssueId(),
        ruleId: mapping.ruleId,
        source: "axe",
        title: mapping.title,
        description: descriptionParts.join(" "),
        wcag: mapping.wcag,
        type: mapping.type,
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
  normalizeAxeGroup(results.incomplete ?? [], rulesFile, true, issues);
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
    const fp = fingerprint(ruleId, ref.selector, snippet);
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
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.fingerprint)) continue;
    seen.add(issue.fingerprint);
    out.push(issue);
  }
  return out;
}
