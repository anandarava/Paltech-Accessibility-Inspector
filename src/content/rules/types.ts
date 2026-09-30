/**
 * Contract for custom (non-axe) rules that run inside the content script.
 * Every rule module exports `const rule: CustomRule` (and optionally helpers).
 * `src/content/rules/index.ts` collects them into `CUSTOM_RULES`.
 */
import type { CheckType, Severity, Category, WcagRef, FixGuidance } from "@shared/types";

export interface RuleContext {
  /** Root to scan: document, or an element when scope is "selector". */
  root: Document | Element;
  /** Rule-specific thresholds from RuleConfig.thresholds[ruleId]. */
  thresholds: Record<string, number>;
  /** Returns true if the element belongs to the extension (overlay etc.) and must be skipped. */
  isExtensionNode(el: Element): boolean;
  /** True if the element is rendered (not display:none / visibility:hidden / zero-size / aria-hidden tree). */
  isVisible(el: Element): boolean;
  /** Yield to the event loop; call between chunks of expensive work. */
  yieldToMain(): Promise<void>;
  /** Report progress 0..100 for this rule (optional). */
  progress?(percent: number): void;
}

export interface RuleFinding {
  /** Element the finding is attached to. */
  element: Element;
  /** Human readable description with concrete values (e.g. colours and ratio). */
  description: string;
  /** Override the rule's default severity for this finding. */
  severity?: Severity;
  /** Override the rule's default type (e.g. Semi when a value could not be determined). */
  type?: CheckType;
  /** Rule-specific structured data (stored in Issue.data). */
  data?: Record<string, unknown>;
  /** Fix guidance override; falls back to the rule's default fix. */
  fix?: Partial<FixGuidance>;
}

export interface CustomRule {
  /** Project rule id from shared/a11y-rules.json, e.g. "CLR-01". */
  id: string;
  /** Additional rule ids this module can emit (e.g. contrast emits CLR-01, CLR-02, CLR-03). */
  emits?: string[];
  title: string;
  category: Category;
  wcag: WcagRef;
  type: CheckType;
  severity: Severity;
  defaultFix: FixGuidance;
  /**
   * Run the rule. Findings may carry `data.ruleId` to attribute a finding to a
   * different id listed in `emits` (the normalizer honours it).
   */
  run(ctx: RuleContext): Promise<RuleFinding[]>;
}
