/**
 * Frame scanner: runs axe-core (scoped to the frame, overlay excluded), then
 * the custom rules, then normalizes everything into `Issue` objects. The
 * service worker calls this once per frame and merges the outputs.
 */
import axe from "axe-core";
import type { Issue, RuleConfig, RulesFile, Severity } from "@shared/types";
import type { ScanOptions } from "@shared/messages";
import { EXT_MARKER_ATTR, OVERLAY_HOST_ID } from "@shared/constants";
import type { CustomRule, RuleContext } from "./rules/types";
import { CUSTOM_RULES, ruleIdsOf } from "./rules/index";
import { axeIdsForProjectRule, dedupeIssues, normalizeAxeResults, normalizeCustomFindings } from "./normalizer";
import { isVisible, yieldToMain } from "./dom-utils";
import { axeTagsFor, criterionInVersion } from "@shared/wcag-map";

export interface FrameScanOutput {
  issues: Issue[];
  passedRules: string[];
  /** Severity of each passed axe rule (its static impact; best practices as Minor). */
  passedRuleSeverity: Record<string, Severity>;
  /** axe rules that matched no element in this frame. */
  inapplicableRules: string[];
  frameUrl: string;
  isTop: boolean;
  durationMs: number;
}

export interface ScanContextExtras {
  isExtensionNode(el: Element): boolean;
  onProgress(percent: number, stage: string): void;
}

const IMPACT_SEVERITY: Record<string, Severity> = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

/**
 * Weight class of a passed axe rule for the score. Passed results carry no
 * impact, so the rule's static impact is read from axe's rule metadata.
 */
function passedSeverityOf(result: axe.Result): Severity {
  if ((result.tags ?? []).includes("best-practice") && !(result.tags ?? []).some((t) => /^wcag\d/.test(t))) return "Minor";
  const meta = (axe as unknown as { _audit?: { rules?: Array<{ id: string; impact?: string }> } })._audit?.rules?.find((r) => r.id === result.id);
  return IMPACT_SEVERITY[meta?.impact ?? ""] ?? "Moderate";
}

let scanInProgress = false;

/** True while a scan (or a single-rule run) is executing in this frame. */
export function isScanning(): boolean {
  return scanInProgress;
}

/** Resolve the scan root for the options; null when a selector scope matches nothing. */
export function resolveScanRoot(options: ScanOptions): Document | Element | null {
  if (options.scope === "selector" && options.selector) {
    try {
      return document.querySelector(options.selector);
    } catch {
      return null;
    }
  }
  return document;
}

/** Rule ids (project ids, and raw axe ids) disabled by config or by the rules file. */
export function disabledRuleIds(rulesFile: RulesFile, ruleConfig: RuleConfig): Set<string> {
  const disabled = new Set<string>(ruleConfig.disabled ?? []);
  for (const rule of rulesFile.rules) if (rule.enabled === false) disabled.add(rule.id);
  return disabled;
}

function isAllowed(ruleId: string, options: ScanOptions, disabled: Set<string>): boolean {
  if (disabled.has(ruleId)) return false;
  if (options.rules.length > 0 && !options.rules.includes(ruleId)) return false;
  return true;
}

function customRuleEnabled(rule: CustomRule, options: ScanOptions, disabled: Set<string>): boolean {
  return ruleIdsOf(rule).some((id) => isAllowed(id, options, disabled));
}

function buildAxeContext(root: Document | Element): axe.ContextObject {
  const exclude: string[] = [`#${OVERLAY_HOST_ID}`, `[${EXT_MARKER_ATTR}]`];
  return { include: root, exclude };
}

/**
 * axe rules whose job a custom rule does more completely, mapped to the custom
 * rule that replaces them. Running both produces two issues for one defect:
 * dedupe keys on `fingerprint` (rule id + selector + text), and the two engines
 * disagree on all three — axe reports its own selector form and always uses
 * `color-contrast`, while the custom rule splits the same element into CLR-01
 * (normal text), CLR-02 (large text) or CLR-03 (undeterminable background), so
 * the fingerprints differ and both survive.
 *
 * The custom rule wins in each case because it carries information axe does
 * not: alpha-blended ancestor backgrounds and a suggested passing colour for
 * contrast, and the 24px spacing exception for target size. A superseding rule
 * only takes effect when it is actually going to run, so disabling the custom
 * rule hands the check back to axe.
 *
 * Only genuinely redundant pairs belong here. `label-title-only` is NOT one:
 * it covers title-only controls, while the custom FRM-02 deliberately covers
 * only placeholder-only controls and defers the title case to axe, so the two
 * are complementary and disabling either loses real findings.
 */
const SUPERSEDED_BY_CUSTOM: Record<string, string> = {
  "color-contrast": "CLR-01",
  "target-size": "TGT-01",
};

function buildAxeRunOptions(options: ScanOptions, rulesFile: RulesFile, disabled: Set<string>): axe.RunOptions | null {
  const tags = axeTagsFor(options.wcagVersion ?? "2.2", options.wcagLevel ?? "AA");
  if (options.includeBestPractices) tags.push("best-practice");

  const base: axe.RunOptions = {
    reporter: "v1",
    // "incomplete" (axe could not decide) is not requested: only definite findings are reported.
    resultTypes: ["violations"],
    iframes: false,
    elementRef: true,
    selectors: true,
    ancestry: false,
    xpath: false,
  };

  // Rules disabled by project id map to every axe rule that feeds them.
  const disabledAxe = new Set<string>();
  for (const id of disabled) {
    disabledAxe.add(id);
    for (const axeId of axeIdsForProjectRule(id, rulesFile)) disabledAxe.add(axeId);
  }

  // Stand down the axe rules whose custom replacement is going to run, so one
  // defect yields one issue (see SUPERSEDED_BY_CUSTOM).
  for (const [axeId, customId] of Object.entries(SUPERSEDED_BY_CUSTOM)) {
    const replacement = CUSTOM_RULES.find((rule) => ruleIdsOf(rule).includes(customId));
    if (!options.axeOnly && replacement && customRuleEnabled(replacement, options, disabled)) disabledAxe.add(axeId);
  }

  let available: Array<{ ruleId: string; tags: string[] }>;
  try {
    available = axe.getRules(tags).map((r) => ({ ruleId: r.ruleId, tags: r.tags }));
  } catch {
    available = [];
  }

  if (options.rules.length > 0) {
    // Explicit allow-list: run only the axe rules that feed those project ids (or raw axe ids).
    const allowedAxe = new Set<string>();
    for (const id of options.rules) {
      allowedAxe.add(id);
      for (const axeId of axeIdsForProjectRule(id, rulesFile)) allowedAxe.add(axeId);
    }
    const values = available.map((r) => r.ruleId).filter((id) => allowedAxe.has(id) && !disabledAxe.has(id));
    if (values.length === 0) return null;
    return { ...base, runOnly: { type: "rule", values } };
  }

  // Tag selection alone never runs axe rules tagged `experimental` (axe-core
  // excludes that tag by default: label-content-name-mismatch, p-as-heading,
  // table-fake-caption, td-has-header, css-orientation-lock,
  // focus-order-semantics, ...). An explicit `rules[id] = { enabled: true }`
  // overrides the exclusion, so, mirroring ci/a11y-rules-to-axe.ts, switch on
  // every axe rule that feeds an enabled project rule. Only rules matching the
  // selected tags are enabled so the WCAG level / best-practice choice still
  // decides what runs (a best-practice-only or AAA-only feeder is not pulled
  // into an A/AA scan). Disabled ids always win.
  const availableIds = new Set(available.map((r) => r.ruleId));
  const rules: axe.RuleObject = {};
  for (const def of rulesFile.rules) {
    if (def.enabled === false || disabled.has(def.id)) continue;
    for (const axeId of axeIdsForProjectRule(def.id, rulesFile)) {
      if (availableIds.has(axeId) && !disabledAxe.has(axeId)) rules[axeId] = { enabled: true };
    }
  }
  for (const r of available) if (disabledAxe.has(r.ruleId)) rules[r.ruleId] = { enabled: false };
  return { ...base, runOnly: { type: "tag", values: tags }, ...(Object.keys(rules).length ? { rules } : {}) };
}

function emptyAxeResults(): axe.AxeResults {
  return {
    passes: [],
    violations: [],
    incomplete: [],
    inapplicable: [],
    toolOptions: {},
    testEngine: { name: "axe-core", version: axe.version },
    testRunner: { name: "axe" },
    testEnvironment: { userAgent: navigator.userAgent, windowWidth: window.innerWidth, windowHeight: window.innerHeight },
    timestamp: new Date().toISOString(),
    url: location.href,
  };
}

async function runAxe(root: Document | Element, runOptions: axe.RunOptions): Promise<axe.AxeResults> {
  const context = buildAxeContext(root);
  return axe.run(context, runOptions);
}

function makeRuleContext(root: Document | Element, rule: CustomRule, ruleConfig: RuleConfig, extras: ScanContextExtras, progress: (p: number) => void): RuleContext {
  const thresholds: Record<string, number> = {};
  for (const id of ruleIdsOf(rule)) Object.assign(thresholds, ruleConfig.thresholds?.[id] ?? {});
  return {
    root,
    thresholds,
    isExtensionNode: (el: Element) => extras.isExtensionNode(el),
    isVisible,
    yieldToMain,
    progress,
  };
}

/**
 * Run one custom rule against the root and return its normalized, filtered
 * issues. Used by the scanner.
 */
export async function runCustomRule(
  rule: CustomRule,
  root: Document | Element,
  options: ScanOptions,
  rulesFile: RulesFile,
  ruleConfig: RuleConfig,
  extras: ScanContextExtras,
  progress: (p: number) => void = () => undefined,
): Promise<Issue[]> {
  const disabled = disabledRuleIds(rulesFile, ruleConfig);
  const ctx = makeRuleContext(root, rule, ruleConfig, extras, progress);
  const findings = await rule.run(ctx);
  const safeFindings = (Array.isArray(findings) ? findings : []).filter((f) => f && f.element instanceof Element && !extras.isExtensionNode(f.element));
  const issues = normalizeCustomFindings(rule, safeFindings, rulesFile);
  return issues.filter((issue) => isAllowed(issue.ruleId, options, disabled));
}

const LEVEL_RANK = { A: 0, AA: 1, AAA: 2 } as const;

/** True when a finding's WCAG level is within the selected level; best-practice ("BP") findings always are. */
function levelInScope(level: Issue["wcag"]["level"], selected: keyof typeof LEVEL_RANK): boolean {
  if (level === "BP") return true;
  return LEVEL_RANK[level] <= LEVEL_RANK[selected];
}

export async function scanFrame(options: ScanOptions, rulesFile: RulesFile, ruleConfig: RuleConfig, ctxExtras: ScanContextExtras): Promise<FrameScanOutput> {
  if (scanInProgress) throw new Error("A scan is already running in this frame");
  scanInProgress = true;
  const started = performance.now();
  const isTop = window === window.top;
  const frameUrl = location.href;
  const safeProgress = (percent: number, stage: string): void => {
    try {
      ctxExtras.onProgress(Math.max(0, Math.min(100, Math.round(percent))), stage);
    } catch {
      /* progress must never break a scan */
    }
  };

  try {
    safeProgress(0, "Preparing scan");
    const root = resolveScanRoot(options);
    if (!root) {
      if (isTop && options.scope === "selector") {
        throw new Error(`No element matches the scope selector "${options.selector ?? ""}"`);
      }
      return { issues: [], passedRules: [], passedRuleSeverity: {}, inapplicableRules: [], frameUrl, isTop, durationMs: Math.round(performance.now() - started) };
    }
    const disabled = disabledRuleIds(rulesFile, ruleConfig);

    // ---- axe-core -------------------------------------------------------
    safeProgress(5, "Running axe-core");
    const runOptions = buildAxeRunOptions(options, rulesFile, disabled);
    let axeResults = emptyAxeResults();
    if (runOptions) {
      axeResults = await runAxe(root, runOptions);
    }
    safeProgress(40, "Normalizing axe-core results");
    await yieldToMain();
    let issues: Issue[] = normalizeAxeResults(axeResults, rulesFile).filter(
      (issue) => isAllowed(issue.ruleId, options, disabled) || isAllowed(String(issue.data?.axeRuleId ?? ""), options, disabled),
    );
    const passedRules = Array.from(new Set((axeResults.passes ?? []).map((r) => r.id)));
    const passedRuleSeverity: Record<string, Severity> = {};
    for (const r of axeResults.passes ?? []) passedRuleSeverity[r.id] = passedSeverityOf(r);
    const inapplicableRules = Array.from(new Set((axeResults.inapplicable ?? []).map((r) => r.id)));

    // ---- custom rules ---------------------------------------------------
    // axe-core only: skip the custom rules (axe's own contrast / target-size rules then run instead).
    const rules = options.axeOnly ? [] : CUSTOM_RULES.filter((rule) => customRuleEnabled(rule, options, disabled));
    const span = 55; // progress 40 -> 95
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const from = 40 + (span * i) / Math.max(1, rules.length);
      const to = 40 + (span * (i + 1)) / Math.max(1, rules.length);
      safeProgress(from, `Checking ${rule.title}`);
      const ruleProgress = (p: number): void => safeProgress(from + ((to - from) * Math.max(0, Math.min(100, p))) / 100, `Checking ${rule.title}`);
      try {
        const ruleIssues = await runCustomRule(rule, root, options, rulesFile, ruleConfig, ctxExtras, ruleProgress);
        // Custom rules know nothing about the selected conformance level: drop findings for stricter levels.
        issues.push(...ruleIssues.filter((issue) => levelInScope(issue.wcag.level, options.wcagLevel ?? "AA")));
      } catch (err) {
        // One misbehaving rule must not abort the whole scan.
        console.warn(`[a11y-checker] custom rule ${rule.id} failed:`, err);
      }
      await yieldToMain();
    }

    safeProgress(96, "Deduplicating issues");
    // Keep only definite findings (custom rules report undeterminable cases as
    // "Semi"), for success criteria that are part of the selected WCAG version.
    const version = options.wcagVersion ?? "2.2";
    issues = dedupeIssues(issues).filter((issue) => issue.type !== "Semi" && criterionInVersion(issue.wcag.criterion, version));
    safeProgress(100, "Scan complete");
    return {
      issues,
      passedRules: passedRules.sort(),
      passedRuleSeverity,
      inapplicableRules: inapplicableRules.sort(),
      frameUrl,
      isTop,
      durationMs: Math.round(performance.now() - started),
    };
  } finally {
    scanInProgress = false;
  }
}
