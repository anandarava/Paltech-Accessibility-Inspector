import type { Issue, ScanSummary, Severity } from "./types";
import { SEVERITY_WEIGHTS } from "./constants";

const ACTIVE: ReadonlySet<Issue["status"]> = new Set(["new"]);

function isActive(i: Issue): boolean {
  return ACTIVE.has(i.status);
}

/**
 * Only definite findings are reported. Undeterminable ("Semi") findings are
 * dropped by the scanner; this guard keeps any stray one out of the numbers.
 */
function isDefinite(i: Issue): boolean {
  return i.type !== "Semi";
}

function isBestPractice(i: Issue): boolean {
  return i.wcag.level === "BP";
}

/** Severity a rule is weighted at: best-practice rules count as Minor. */
function weightSeverity(i: Issue): Severity {
  return isBestPractice(i) ? "Minor" : i.severity;
}

/**
 * Accessibility score, computed like Google Lighthouse: a weighted pass rate
 * over the rules that applied to the page.
 *
 *   score = round(100 x weight of passed rules / weight of all applicable rules)
 *
 * - A rule is **failed** when it has at least one open (new) finding; it is
 *   weighted by its most severe open finding. How many elements fail does not
 *   matter, only whether the rule passes.
 * - A rule is **passed** when axe-core reports it as passed and no open finding
 *   belongs to it; it is weighted by its axe impact (`passedSeverity`,
 *   defaulting to Moderate for results saved before severities were recorded).
 * - Not-applicable rules, and rules whose findings are all baselined or
 *   ignored, are left out entirely.
 * - Weights: Critical 10, Serious 7, Moderate 3, Minor 1 (best practices count as Minor).
 * - A page with no applicable rules scores 100.
 */
/**
 * Rules that passed and have no open finding. A rule that passed in one frame but
 * failed in another is not passed; this is the set the score weighs.
 */
export function effectivePassedRules(issues: Issue[], passedRules: string[] = []): string[] {
  const failedIds = new Set<string>();
  for (const i of issues) {
    if (!isActive(i) || !isDefinite(i)) continue;
    failedIds.add(i.ruleId);
    const axeId = i.data?.axeRuleId;
    if (typeof axeId === "string") failedIds.add(axeId);
  }
  return [...new Set(passedRules)].filter((id) => !failedIds.has(id));
}

export function computeScore(
  issues: Issue[],
  passedRules: string[] = [],
  passedSeverity: Record<string, Severity> = {},
): number {
  const failed = new Map<string, Severity>();
  const failedAxeRules = new Set<string>();
  for (const i of issues) {
    if (!isActive(i) || !isDefinite(i)) continue;
    const sev = weightSeverity(i);
    const prev = failed.get(i.ruleId);
    if (!prev || SEVERITY_WEIGHTS[sev] > SEVERITY_WEIGHTS[prev]) failed.set(i.ruleId, sev);
    const axeId = i.data?.axeRuleId;
    if (typeof axeId === "string") failedAxeRules.add(axeId);
  }
  let failedWeight = 0;
  for (const sev of failed.values()) failedWeight += SEVERITY_WEIGHTS[sev];

  let passedWeight = 0;
  for (const id of new Set(passedRules)) {
    if (failedAxeRules.has(id) || failed.has(id)) continue;
    passedWeight += SEVERITY_WEIGHTS[passedSeverity[id] ?? "Moderate"];
  }

  const total = passedWeight + failedWeight;
  return total === 0 ? 100 : Math.round((100 * passedWeight) / total);
}

export function summarize(issues: Issue[], passedRules: string[]): ScanSummary {
  const s: ScanSummary = { critical: 0, serious: 0, moderate: 0, minor: 0, bestPractice: 0, passed: effectivePassedRules(issues, passedRules).length };
  for (const i of issues) {
    if (!isActive(i)) continue;
    if (isBestPractice(i)) { s.bestPractice++; continue; }
    if (!isDefinite(i)) continue;
    switch (i.severity) {
      case "Critical": s.critical++; break;
      case "Serious": s.serious++; break;
      case "Moderate": s.moderate++; break;
      case "Minor": s.minor++; break;
    }
  }
  return s;
}

/** Any active, definite, Critical WCAG issue makes the page not conformant. */
export function isNotConformant(issues: Issue[]): boolean {
  return issues.some((i) => isActive(i) && !isBestPractice(i) && isDefinite(i) && i.severity === "Critical");
}
