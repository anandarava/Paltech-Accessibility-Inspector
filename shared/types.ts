/**
 * Shared domain types for the PalTech A11y Inspector extension.
 * Used by the service worker, content script, side panel, options page,
 * exporters, and the CI parity tooling.
 */

export type WcagLevel = "A" | "AA" | "AAA";
/** WCAG version whose success criteria are tested (axe "wcag2x" tags). */
export type WcagVersion = "2.0" | "2.1" | "2.2";
export type CheckType = "Auto" | "Semi" | "Manual";
export type Severity = "Critical" | "Serious" | "Moderate" | "Minor";
export type IssueStatus = "new" | "baselined" | "ignored" | "fixed";
export type IssueSource = "axe" | "custom" | "manual";

export type Category =
  | "Images and Media"
  | "Color and Contrast"
  | "Forms"
  | "Keyboard and Focus"
  | "Page Structure and Semantics"
  | "ARIA"
  | "Links, Buttons, and Targets"
  | "Responsiveness and Zoom"
  | "Best Practice"
  | "Other";

export interface WcagRef {
  /** e.g. "1.4.3". Empty string for best-practice rules. */
  criterion: string;
  /** e.g. "Contrast (Minimum)" */
  name: string;
  /** "A" | "AA" | "AAA" | "BP" (best practice, not a WCAG failure) */
  level: WcagLevel | "BP";
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementRef {
  /** Stable CSS selector (unique in document at scan time). */
  selector: string;
  /** Absolute XPath. */
  xpath: string;
  /** Outer HTML snippet, truncated to ~300 chars. */
  html: string;
  /** Bounding box in page (document) coordinates at scan time. */
  boundingBox: BoundingBox;
  /** Bounding box relative to the viewport at scan time (used for cropping screenshots). */
  viewportBox?: BoundingBox;
}

export interface FixGuidance {
  summary: string;
  suggestedValue?: string;
  docsUrl?: string;
}

export interface Evidence {
  /** PNG data URL of a cropped screenshot. */
  screenshot?: string;
  capturedAt?: string;
}

export interface Issue {
  id: string;
  /** Rule id from shared/a11y-rules.json (e.g. "CLR-01") or an axe rule id (e.g. "image-alt"). */
  ruleId: string;
  source: IssueSource;
  title: string;
  description: string;
  wcag: WcagRef;
  type: CheckType;
  severity: Severity;
  category: Category;
  element: ElementRef;
  /** Rule-specific structured data (e.g. contrast foreground/background/ratio). */
  data?: Record<string, unknown>;
  fix: FixGuidance;
  /** Hash of ruleId + selector + text snippet; stable across scans. */
  fingerprint: string;
  /**
   * Chrome frame id the issue was found in (0 = top frame). Set by the service worker when it
   * merges frame results; selectors and `id` are only meaningful inside that frame.
   */
  frameId?: number;
  status: IssueStatus;
  /** Reason entered by the tester when ignoring/baselining. */
  reason?: string;
  evidence?: Evidence;
}

export interface ScanSummary {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  bestPractice: number;
  passed: number;
}

export interface ScanResult {
  scanId: string;
  url: string;
  origin: string;
  title: string;
  timestamp: string;
  environment?: string;
  browser: string;
  viewport: { width: number; height: number };
  wcagLevel: WcagLevel;
  /** Absent on results created before version selection existed (treated as 2.2). */
  wcagVersion?: WcagVersion;
  /** What was scanned. Absent means the whole page. */
  scope?: ScanScope;
  /** True when the scan ran axe-core rules only. */
  axeOnly?: boolean;
  durationMs: number;
  score: number;
  /** True when any Critical WCAG (non best-practice) issue that is not baselined/ignored exists. */
  notConformant: boolean;
  summary: ScanSummary;
  issues: Issue[];
  /** axe rule ids that passed, for reporting. */
  passedRules: string[];
  /** Severity (axe impact; best practices as Minor) of each passed rule, used to weight the score. */
  passedRuleSeverity?: Record<string, Severity>;
  /** axe rule ids that found nothing to test on the page (e.g. video-caption without a video). */
  inapplicableRules?: string[];
  /** Frames that could not be scanned (cross-origin without host permission). */
  unscannedFrames: string[];
}

export interface ScanScope {
  kind: "page" | "selector";
  selector?: string;
}

export interface BaselineEntry {
  fingerprint: string;
  ruleId: string;
  selector: string;
  reason: string;
  author: string;
  createdAt: string;
}

export interface Settings {
  wcagLevel: WcagLevel;
  wcagVersion: WcagVersion;
  /** Categories enabled for scanning. Empty array means all. */
  enabledCategories: Category[];
  autoRescan: boolean;
  includeBestPractices: boolean;
  /** Run only axe-core's own rules (no custom rules), for results comparable with axe DevTools. */
  axeOnly: boolean;
  environment: string;
  /** Name shown as "Prepared by" on HTML reports. */
  reportPreparedBy: string;
  /** Organisation (client or company) shown on HTML reports. */
  reportOrganisation: string;
  /** Selectors to blur in screenshots. */
  redactSelectors: string[];
  maskInputValues: boolean;
  overlay: {
    showBadges: boolean;
    colors: Record<Severity | "review", string>;
  };
}

export interface RuleConfig {
  /** Rule ids explicitly disabled. */
  disabled: string[];
  /** Custom thresholds keyed by rule id, e.g. { "TGT-01": { minSize: 24 } }. */
  thresholds: Record<string, Record<string, number>>;
}

export interface KeyboardTestStep {
  index: number;
  selector: string;
  boundingBox: BoundingBox;
  tagName: string;
  accessibleName: string;
}

export interface KeyboardTestResult {
  path: KeyboardTestStep[];
  trapDetected: boolean;
  trapElements: string[];
  unreachedFocusables: string[];
  cycleCompleted: boolean;
  /** Always "guided": the tester presses Tab and the page records focus. */
  mode: "guided";
}

export type OverlayMode =
  | "off"
  | "issues"
  | "taborder"
  | "headings"
  | "landmarks"
  | "names";

export type ColorBlindnessMode =
  | "none"
  | "protanopia"
  | "deuteranopia"
  | "tritanopia"
  | "achromatopsia";

export type ExportFormat = "html" | "json";

export interface RuleDefinition {
  id: string;
  check: string;
  category: Category;
  wcag: WcagRef;
  type: CheckType;
  severity: Severity | null;
  /** axe rule ids that map to this rule (when source is axe). */
  axeRules?: string[];
  docsUrl?: string;
  enabled: boolean;
}

export interface RulesFile {
  version: string;
  wcagVersion: "2.2";
  rules: RuleDefinition[];
}

// ---------------------------------------------------------------------------
// Saved scans (named snapshots kept in chrome.storage.local)
// ---------------------------------------------------------------------------

export interface SavedScanMeta {
  id: string;
  name: string;
  url: string;
  title: string;
  /** When the scan ran. */
  timestamp: string;
  /** When it was saved. */
  savedAt: string;
  score: number;
  summary: ScanSummary;
  wcagLevel: WcagLevel;
  wcagVersion: WcagVersion;
  scope?: ScanScope;
  issueCount: number;
}

export interface SavedScan {
  meta: SavedScanMeta;
  result: ScanResult;
}
