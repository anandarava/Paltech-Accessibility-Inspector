/**
 * Registry of custom (non-axe) rules executed by the scanner after axe-core.
 * Each module exports `rule: CustomRule`; the order here is the execution
 * order (cheap DOM-only rules first, focus/layout-mutating rules last).
 */
import type { CustomRule } from "./types";
import { rule as altQuality } from "./alt-quality";
import { rule as linkText } from "./link-text";
import { rule as forms } from "./forms";
import { rule as keyboard } from "./keyboard";
import { rule as targetSize } from "./target-size";
import { rule as contrast } from "./contrast";
import { rule as focusVisible } from "./focus-visible";
import { rule as focusObscured } from "./focus-obscured";
import { rule as reflow } from "./reflow";

export const CUSTOM_RULES: CustomRule[] = [
  altQuality,
  linkText,
  forms,
  keyboard,
  targetSize,
  contrast,
  focusVisible,
  focusObscured,
  reflow,
];

/** All rule ids a custom rule can produce (its id plus `emits`). */
export function ruleIdsOf(rule: CustomRule): string[] {
  const ids = [rule.id, ...(rule.emits ?? [])];
  return Array.from(new Set(ids));
}

/** Find the custom rule that owns (emits) the given project rule id. */
export function findCustomRule(ruleId: string): CustomRule | undefined {
  return CUSTOM_RULES.find((r) => ruleIdsOf(r).includes(ruleId));
}
