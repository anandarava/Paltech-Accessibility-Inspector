/**
 * Test data factories shared by the unit tests. Everything here is built from
 * the shared contracts only (shared/types.ts), so it does not depend on any
 * module still under construction.
 */
import type {
  Issue,
  ScanResult,
  ScanSummary,
  Severity,
  CheckType,
  IssueStatus,
  WcagRef,
} from "@shared/types";
import type { RuleContext } from "@src/content/rules/types";

let counter = 0;

const WCAG_AA_CONTRAST: WcagRef = { criterion: "1.4.3", name: "Contrast (Minimum)", level: "AA" };
const WCAG_BP: WcagRef = { criterion: "", name: "Best practice", level: "BP" };

export interface IssueOverrides extends Partial<Omit<Issue, "element" | "fix" | "wcag">> {
  element?: Partial<Issue["element"]>;
  fix?: Partial<Issue["fix"]>;
  wcag?: Partial<WcagRef>;
  severity?: Severity;
  type?: CheckType;
  status?: IssueStatus;
  bestPractice?: boolean;
}

export function makeIssue(overrides: IssueOverrides = {}): Issue {
  counter += 1;
  const { element, fix, wcag, bestPractice, ...rest } = overrides;
  const base: Issue = {
    id: `iss_${String(counter).padStart(3, "0")}`,
    ruleId: "CLR-01",
    source: "custom",
    title: "Text contrast below 4.5:1",
    description: "Text color #777777 on #FFFFFF has a contrast ratio of 4.48:1.",
    wcag: { ...(bestPractice ? WCAG_BP : WCAG_AA_CONTRAST), ...(wcag ?? {}) },
    type: "Auto",
    severity: "Serious",
    category: bestPractice ? "Best Practice" : "Color and Contrast",
    element: {
      selector: `#pricing > p:nth-of-type(${counter})`,
      xpath: `/html/body/main/section[2]/div[2]/p[${counter}]`,
      html: '<p class="note">Billed annually</p>',
      boundingBox: { x: 412, y: 980, width: 220, height: 18 },
      ...(element ?? {}),
    },
    data: { foreground: "#777777", background: "#FFFFFF", ratio: 4.48, required: 4.5 },
    fix: {
      summary: "Darken the text color to at least #767676.",
      suggestedValue: "#767676",
      docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
      ...(fix ?? {}),
    },
    fingerprint: `fp${String(counter).padStart(6, "0")}`,
    status: "new",
  };
  return { ...base, ...rest };
}

export function emptySummary(): ScanSummary {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, bestPractice: 0, passed: 0 };
}

export function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  const issues = overrides.issues ?? [makeIssue(), makeIssue({ ruleId: "IMG-01", severity: "Critical", source: "axe" })];
  return {
    scanId: "scan_2026-09-24T10-15-02",
    url: "https://staging.example.com/pricing",
    origin: "https://staging.example.com",
    title: "Pricing - Example",
    timestamp: "2026-09-24T10:15:02.000Z",
    environment: "staging",
    browser: "Chrome 140 / Windows 11",
    viewport: { width: 1440, height: 900 },
    wcagLevel: "AA",
    durationMs: 2310,
    score: 85,
    notConformant: true,
    summary: { ...emptySummary(), critical: 1, serious: 1, passed: 42 },
    issues,
    passedRules: ["document-title", "html-has-lang"],
    unscannedFrames: [],
    ...overrides,
  };
}

/** Minimal RuleContext for running custom rules against a jsdom document. */
export function makeRuleContext(root: Document | Element = document, thresholds: Record<string, number> = {}): RuleContext {
  return {
    root,
    thresholds,
    isExtensionNode: () => false,
    // jsdom has no layout engine, so treat everything as visible unless it is
    // explicitly hidden through attributes or inline styles.
    isVisible: (el: Element) => {
      if (el.closest("[hidden], [aria-hidden='true']")) return false;
      let node: Element | null = el;
      while (node) {
        const style = (node as HTMLElement).style;
        if (style && (style.display === "none" || style.visibility === "hidden")) return false;
        node = node.parentElement;
      }
      return true;
    },
    yieldToMain: async () => {},
  };
}

/** Effective rule id of a custom finding: `data.ruleId` override, else the rule's own id. */
export function findingRuleId(finding: { data?: Record<string, unknown> }, fallback: string): string {
  const id = finding.data?.ruleId;
  return typeof id === "string" ? id : fallback;
}

/** Replace the document body with the given HTML and return it. */
export function setBody(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}
