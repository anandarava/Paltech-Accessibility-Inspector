/**
 * Zustand store for the side panel / DevTools panel.
 *
 * All cross-component state lives here so that the chrome.runtime.onMessage
 * listener (see hooks/useBackgroundEvents.ts) can update it without stale
 * closures via `useStore.getState()`.
 */
import { create } from "zustand";
import type {
  Category,
  ColorBlindnessMode,
  Issue,
  IssueSource,
  IssueStatus,
  KeyboardTestResult,
  OverlayMode,
  SavedScanMeta,
  ScanResult,
  ScanScope,
  Settings,
  Severity,
} from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/constants";
import { computeScore, isNotConformant, summarize } from "@shared/scoring";

export type View = "list" | "detail" | "keyboard" | "saved" | "compare";

/** Result tabs, as in axe DevTools: every finding, WCAG failures, best practices, passed and not-applicable rules. */
export type ResultTab = "all" | "auto" | "bp" | "failed" | "passed" | "na";
export type GroupBy = "rule" | "category";

/** One side of a comparison: the live result or a saved scan id. */
export type CompareSide = { kind: "current" } | { kind: "saved"; id: string };

export interface Filters {
  /** Empty means "all severities". */
  severities: Severity[];
  /** Empty means "all categories". */
  categories: Category[];
  /** Issue statuses to show; empty means every status. Defaults to open issues only. */
  statuses: IssueStatus[];
  showBestPractice: boolean;
  /** Free-text search over title, rule id, selector, HTML and WCAG criterion. */
  search: string;
  /** Empty means every source: axe-core and the extension's own ("advanced") rules. */
  sources: IssueSource[];
}

export interface ScanProgress {
  percent: number;
  stage: string;
}

export interface KeyboardProgress {
  step: number;
  selector: string;
}

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Bold lead-in shown before the message, e.g. "Scan complete". */
  title?: string;
  link?: { href: string; label: string };
  /** When false the toast stays until dismissed. Defaults to true. */
  autoDismiss?: boolean;
}

export type PageChangeReason = "route" | "dialog" | "dom";

export interface PanelState {
  tabId: number | null;
  /** True inside DevTools where "Inspect element" is available. */
  inspectable: boolean;
  result: ScanResult | undefined;
  scanning: boolean;
  /** Tabs with a scan in flight, so switching tabs does not lose track of a running scan. */
  scanningTabs: number[];
  progress: ScanProgress | null;
  selectedIssueId: string | null;
  filters: Filters;
  overlayMode: OverlayMode;
  colorBlindness: ColorBlindnessMode;
  keyboardResult: KeyboardTestResult | undefined;
  keyboardRunning: boolean;
  keyboardProgress: KeyboardProgress | null;
  settings: Settings;
  toast: Toast | null;
  pageChanged: PageChangeReason | null;
  view: View;
  /** Categories whose group is collapsed in the issue list. */
  collapsedCategories: Category[];
  /** Rule groups that are expanded (rule groups start collapsed, like axe). */
  expandedRules: string[];
  resultTab: ResultTab;
  groupBy: GroupBy;
  /** What the next scan covers. */
  scope: ScanScope;
  picking: boolean;
  /** Set while a saved scan is shown instead of the live result. */
  viewingSaved: SavedScanMeta | null;
  /** The live result, parked while a saved scan is shown. */
  liveResult: ScanResult | undefined;
  compare: { a: CompareSide; b: CompareSide } | null;
  /** Scroll to and outline the element whenever an issue is opened. */
  autoHighlight: boolean;

  setTabId(tabId: number | null): void;
  setInspectable(v: boolean): void;
  setResult(result: ScanResult | undefined): void;
  setScanning(v: boolean): void;
  /** Record that a scan started / finished for a specific tab (independent of the visible tab). */
  markScanning(tabId: number, v: boolean): void;
  setProgress(p: ScanProgress | null): void;
  selectIssue(id: string | null): void;
  setView(view: View): void;
  setFilters(patch: Partial<Filters>): void;
  setOverlayMode(mode: OverlayMode): void;
  setColorBlindness(mode: ColorBlindnessMode): void;
  setKeyboardResult(r: KeyboardTestResult | undefined): void;
  setKeyboardRunning(v: boolean): void;
  setKeyboardProgress(p: KeyboardProgress | null): void;
  setSettings(s: Settings): void;
  showToast(toast: Omit<Toast, "id">): void;
  dismissToast(): void;
  setPageChanged(reason: PageChangeReason | null): void;
  toggleCategoryCollapsed(category: Category): void;
  expandCategory(category: Category): void;
  toggleRuleExpanded(key: string): void;
  expandRule(key: string): void;
  setResultTab(tab: ResultTab): void;
  setGroupBy(g: GroupBy): void;
  setScope(scope: ScanScope): void;
  setPicking(v: boolean): void;
  openSaved(meta: SavedScanMeta, result: ScanResult): void;
  exitSaved(): void;
  setCompare(c: { a: CompareSide; b: CompareSide } | null): void;
  setAutoHighlight(v: boolean): void;
  /** Map every issue through `fn` and recompute score / summary / conformance. */
  updateIssues(fn: (issue: Issue) => Issue): void;
  /** Reset per-tab state (called when the active tab changes). */
  resetForTab(): void;
}

export const DEFAULT_FILTERS: Filters = {
  severities: [],
  categories: [],
  statuses: ["new"],
  showBestPractice: true,
  search: "",
  sources: [],
};

let toastCounter = 0;

/** Recompute derived fields of a ScanResult after issue statuses change. */
export function withIssues(result: ScanResult, issues: Issue[]): ScanResult {
  return {
    ...result,
    issues,
    score: computeScore(issues, result.passedRules, result.passedRuleSeverity),
    summary: summarize(issues, result.passedRules),
    notConformant: isNotConformant(issues),
  };
}

export const useStore = create<PanelState>()((set, get) => ({
  tabId: null,
  inspectable: false,
  result: undefined,
  scanning: false,
  scanningTabs: [],
  progress: null,
  selectedIssueId: null,
  filters: DEFAULT_FILTERS,
  overlayMode: "off",
  colorBlindness: "none",
  keyboardResult: undefined,
  keyboardRunning: false,
  keyboardProgress: null,
  settings: DEFAULT_SETTINGS,
  toast: null,
  pageChanged: null,
  view: "list",
  collapsedCategories: [],
  expandedRules: [],
  resultTab: "all",
  groupBy: "rule",
  scope: { kind: "page" },
  picking: false,
  viewingSaved: null,
  liveResult: undefined,
  compare: null,
  autoHighlight: true,

  setTabId: (tabId) => set({ tabId }),
  setInspectable: (inspectable) => set({ inspectable }),
  setResult: (result) =>
    set((s) => {
      const ids = new Set(result?.issues.map((i) => i.id) ?? []);
      const selectedIssueId = s.selectedIssueId && ids.has(s.selectedIssueId) ? s.selectedIssueId : null;
      return {
        result,
        selectedIssueId,
        view: s.view === "detail" && !selectedIssueId ? "list" : s.view,
        scanning: false,
        progress: null,
        pageChanged: null,
      };
    }),
  setScanning: (scanning) => set({ scanning }),
  markScanning: (tabId, v) =>
    set((s) => {
      const has = s.scanningTabs.includes(tabId);
      if (v === has) return {};
      return { scanningTabs: v ? [...s.scanningTabs, tabId] : s.scanningTabs.filter((t) => t !== tabId) };
    }),
  setProgress: (progress) => set({ progress }),
  selectIssue: (selectedIssueId) => set({ selectedIssueId }),
  setView: (view) => set({ view }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  setOverlayMode: (overlayMode) => set({ overlayMode }),
  setColorBlindness: (colorBlindness) => set({ colorBlindness }),
  setKeyboardResult: (keyboardResult) => set({ keyboardResult }),
  setKeyboardRunning: (keyboardRunning) => set({ keyboardRunning }),
  setKeyboardProgress: (keyboardProgress) => set({ keyboardProgress }),
  setSettings: (settings) => set({ settings }),
  showToast: (toast) => set({ toast: { ...toast, id: ++toastCounter } }),
  dismissToast: () => set({ toast: null }),
  setPageChanged: (pageChanged) => set({ pageChanged }),
  toggleCategoryCollapsed: (category) =>
    set((s) => ({
      collapsedCategories: s.collapsedCategories.includes(category)
        ? s.collapsedCategories.filter((c) => c !== category)
        : [...s.collapsedCategories, category],
    })),
  expandCategory: (category) =>
    set((s) => ({ collapsedCategories: s.collapsedCategories.filter((c) => c !== category) })),
  toggleRuleExpanded: (key) =>
    set((s) => ({
      expandedRules: s.expandedRules.includes(key) ? s.expandedRules.filter((k) => k !== key) : [...s.expandedRules, key],
    })),
  expandRule: (key) => set((s) => (s.expandedRules.includes(key) ? {} : { expandedRules: [...s.expandedRules, key] })),
  setResultTab: (resultTab) => set({ resultTab }),
  setGroupBy: (groupBy) => set({ groupBy }),
  setScope: (scope) => set({ scope }),
  setPicking: (picking) => set({ picking }),
  openSaved: (meta, result) =>
    set((s) => ({
      liveResult: s.viewingSaved ? s.liveResult : s.result,
      viewingSaved: meta,
      result,
      selectedIssueId: null,
      view: "list",
    })),
  exitSaved: () =>
    set((s) =>
      s.viewingSaved
        ? {
            viewingSaved: null,
            result: s.liveResult,
            liveResult: undefined,
            selectedIssueId: null,
            view: s.view === "detail" ? "list" : s.view,
          }
        : {},
    ),
  setCompare: (compare) => set({ compare }),
  setAutoHighlight: (autoHighlight) => set({ autoHighlight }),
  updateIssues: (fn) => {
    const { result } = get();
    if (!result) return;
    set({ result: withIssues(result, result.issues.map(fn)) });
  },
  resetForTab: () =>
    set((s) => ({
      result: undefined,
      // A scan may still be running for the tab we switched to.
      scanning: s.tabId !== null && s.scanningTabs.includes(s.tabId),
      progress: null,
      selectedIssueId: null,
      keyboardResult: undefined,
      keyboardRunning: false,
      keyboardProgress: null,
      pageChanged: null,
      view: "list",
      overlayMode: "off",
      colorBlindness: "none",
      scope: { kind: "page" },
      picking: false,
      viewingSaved: null,
      liveResult: undefined,
      compare: null,
    })),
}));

// ---------- Pure selectors / helpers ----------

export function isBestPracticeIssue(issue: Issue): boolean {
  return issue.wcag.level === "BP";
}

/** WCAG failure; best practices excluded. */
export function isDefiniteIssue(issue: Issue): boolean {
  return !isBestPracticeIssue(issue);
}

export function matchesTab(issue: Issue, tab: ResultTab): boolean {
  switch (tab) {
    case "all":
      return true;
    case "auto":
      return isDefiniteIssue(issue);
    case "bp":
      return isBestPracticeIssue(issue);
    case "failed":
    case "passed":
    case "na":
      return false;
  }
}

function matchesSearch(issue: Issue, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const hay = [issue.title, issue.ruleId, issue.element.selector, issue.element.html, issue.wcag.criterion, issue.wcag.name, issue.category, issue.description]
    .join("\n")
    .toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export function matchesFilters(issue: Issue, f: Filters, tab: ResultTab = "all"): boolean {
  if (!matchesTab(issue, tab)) return false;
  if (f.statuses.length > 0 && !f.statuses.includes(issue.status)) return false;
  if (tab === "all" && !f.showBestPractice && isBestPracticeIssue(issue)) return false;
  if (f.severities.length > 0 && !f.severities.includes(issue.severity)) return false;
  if (f.categories.length > 0 && !f.categories.includes(issue.category)) return false;
  if (f.sources.length > 0 && !f.sources.includes(issue.source)) return false;
  return matchesSearch(issue, f.search);
}

/** Key of the rule group an issue belongs to in "group by rule" mode. */
export function ruleGroupKey(issue: Issue): string {
  return `${issue.ruleId}\u0000${issue.title}`;
}

const SEVERITY_RANK: Record<Severity, number> = { Critical: 0, Serious: 1, Moderate: 2, Minor: 3 };
export function severityRank(sev: Severity): number {
  return SEVERITY_RANK[sev];
}

export interface FailedRule {
  /** ruleGroupKey() of the rule's issues. */
  key: string;
  ruleId: string;
  title: string;
  /** axe-core rule id when the rule is backed by axe. */
  axeRuleId?: string;
  wcag: Issue["wcag"];
  /** Most severe instance. */
  severity: Severity;
  count: number;
  firstIssueId: string;
}

/**
 * Rules with at least one failing element, most severe first. Honours the
 * baselined / ignored filters (like the tab counts) but not severity,
 * category or search.
 */
export function failedRules(result: ScanResult | undefined, f: Filters): FailedRule[] {
  if (!result) return [];
  const statusOnly: Filters = { ...f, severities: [], categories: [], sources: [], search: "", showBestPractice: true };
  const byKey = new Map<string, FailedRule>();
  for (const issue of result.issues) {
    if (!matchesFilters(issue, statusOnly, "all")) continue;
    const key = ruleGroupKey(issue);
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      if (severityRank(issue.severity) < severityRank(existing.severity)) existing.severity = issue.severity;
      continue;
    }
    const axeRuleId = typeof issue.data?.axeRuleId === "string" ? issue.data.axeRuleId : undefined;
    byKey.set(key, {
      key,
      ruleId: issue.ruleId,
      title: issue.title,
      axeRuleId,
      wcag: issue.wcag,
      severity: issue.severity,
      count: 1,
      firstIssueId: issue.id,
    });
  }
  return [...byKey.values()].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count || a.title.localeCompare(b.title),
  );
}

/**
 * Badge numbers shown in the list MUST equal the numbers drawn by the on-page
 * overlay. The overlay numbers issues by their index in `result.issues` (the
 * content script holds the very same array), so the number is always
 * `index + 1` in the unfiltered array, regardless of the active filters.
 */
export function issueNumbers(result: ScanResult | undefined): Map<string, number> {
  const map = new Map<string, number>();
  result?.issues.forEach((issue, index) => map.set(issue.id, index + 1));
  return map;
}

export const CATEGORY_ORDER: Category[] = [
  "Images and Media",
  "Color and Contrast",
  "Forms",
  "Keyboard and Focus",
  "Page Structure and Semantics",
  "ARIA",
  "Links, Buttons, and Targets",
  "Responsiveness and Zoom",
  "Best Practice",
  "Other",
];

export const SEVERITIES: Severity[] = ["Critical", "Serious", "Moderate", "Minor"];
