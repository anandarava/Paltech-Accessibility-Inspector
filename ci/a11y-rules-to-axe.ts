/**
 * CI parity: derive axe-core run options from the shared rule catalogue so a
 * Playwright (`@axe-core/playwright`), Cypress (`cypress-axe`) or plain
 * `axe.run()` invocation executes the same axe rules as the extension.
 *
 * The extension (src/content/scanner.ts) selects axe rules by WCAG tag for the
 * chosen level and then applies the per-rule enable/disable state from
 * shared/a11y-rules.json plus the tester's RuleConfig. This module reproduces
 * exactly that selection as `{ runOnly, rules }`.
 *
 * Custom rules (contrast blending, focus visibility, alt quality, link text,
 * target spacing, forms, keyboard, aria-live, reflow) have no axe equivalent;
 * `customRuleIds()` lists them so a pipeline can document the gap or run the
 * content-script bundle in-page for full parity.
 */
import type { RuleConfig, RuleDefinition, RulesFile, WcagLevel } from "@shared/types";
import { AXE_TO_RULE } from "@shared/wcag-map";

export interface AxeRunOnly {
  type: "tag";
  values: string[];
}

export interface AxeRuleToggle {
  enabled: boolean;
}

export interface AxeOptions {
  runOnly: AxeRunOnly;
  rules: Record<string, AxeRuleToggle>;
}

/** axe-core tags per WCAG level. There is no `wcag22a` tag (see plan 17.3). */
const LEVEL_TAGS: Record<WcagLevel, string[]> = {
  A: ["wcag2a", "wcag21a"],
  AA: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  AAA: ["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag22aa"],
};

const LEVEL_RANK: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

/** Tag list used by the extension scanner for a level (plus best-practice when enabled). */
export function levelTags(level: WcagLevel, includeBestPractices: boolean): string[] {
  const tags = [...LEVEL_TAGS[level]];
  if (includeBestPractices) tags.push("best-practice");
  return tags;
}

/** True when a project rule is enabled in the catalogue and not disabled by the tester. */
export function isRuleEnabled(rule: RuleDefinition, ruleConfig: RuleConfig): boolean {
  if (!rule.enabled) return false;
  return !ruleConfig.disabled.includes(rule.id);
}

/** True when a rule's WCAG level is at or below the requested level (BP rules follow the flag). */
function withinLevel(rule: RuleDefinition, level: WcagLevel, includeBestPractices: boolean): boolean {
  if (rule.wcag.level === "BP") return includeBestPractices;
  return LEVEL_RANK[rule.wcag.level] <= LEVEL_RANK[level];
}

/**
 * Build axe run options equivalent to the extension's scan configuration.
 *
 * - `runOnly` selects rules by tag for the WCAG level (and best practices).
 * - `rules` disables every axe rule mapped to a project rule that is disabled,
 *   and explicitly enables mapped rules that are enabled and within the level,
 *   so a catalogue change (e.g. enabling CLR-08 / color-contrast-enhanced)
 *   takes effect in CI without touching the pipeline.
 */
export function axeOptionsFromRules(
  rulesFile: RulesFile,
  ruleConfig: RuleConfig,
  level: WcagLevel,
  includeBestPractices = true,
): AxeOptions {
  const rules: Record<string, AxeRuleToggle> = {};
  const enabledAxe = new Set<string>();
  const disabledAxe = new Set<string>();

  for (const rule of rulesFile.rules) {
    const axeIds = rule.axeRules ?? [];
    if (axeIds.length === 0) continue;
    // Semi rules (undeterminable) are not reported by the extension, so CI skips their axe rules too.
    const on = rule.type !== "Semi" && isRuleEnabled(rule, ruleConfig) && withinLevel(rule, level, includeBestPractices);
    for (const id of axeIds) (on ? enabledAxe : disabledAxe).add(id);
  }

  // An axe rule shared by several project rules stays on if any of them is on.
  for (const id of disabledAxe) if (!enabledAxe.has(id)) rules[id] = { enabled: false };
  for (const id of enabledAxe) rules[id] = { enabled: true };

  // Mapped axe rules that are absent from the catalogue keep their tag-based default.
  for (const axeId of Object.keys(AXE_TO_RULE)) {
    if (rules[axeId]) continue;
    const projectId = AXE_TO_RULE[axeId];
    const def = rulesFile.rules.find((r) => r.id === projectId);
    if (def && !isRuleEnabled(def, ruleConfig)) rules[axeId] = { enabled: false };
  }

  return {
    runOnly: { type: "tag", values: levelTags(level, includeBestPractices) },
    rules,
  };
}

/** Project rule id for an axe rule id (falls back to the axe id, like the extension normaliser). */
export function projectRuleId(axeRuleId: string, rulesFile?: RulesFile): string {
  if (rulesFile) {
    const def = rulesFile.rules.find((r) => r.axeRules?.includes(axeRuleId));
    if (def) return def.id;
  }
  return AXE_TO_RULE[axeRuleId] ?? axeRuleId;
}

/** Definite (Auto) project rules that only the extension's custom rules implement. */
export function customRuleIds(rulesFile: RulesFile, ruleConfig: RuleConfig = { disabled: [], thresholds: {} }): string[] {
  return rulesFile.rules
    .filter((r) => r.type === "Auto" && (!r.axeRules || r.axeRules.length === 0) && isRuleEnabled(r, ruleConfig))
    .map((r) => r.id);
}
