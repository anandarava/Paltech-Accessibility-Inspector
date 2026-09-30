import type { Severity, Settings, RuleConfig } from "./types";

/** Id of the Shadow DOM host element the overlay is mounted into. */
export const OVERLAY_HOST_ID = "a11y-checker-overlay-host";

/** Attribute set on elements the extension injects so scans can exclude them. */
export const EXT_MARKER_ATTR = "data-a11y-checker";

/**
 * Name prefix of the long-lived port each open panel (side panel / DevTools)
 * holds for the tab it shows: `<prefix><tabId>`. When the last port for a tab
 * closes, the service worker clears that page's overlay.
 */
export const PANEL_PORT_PREFIX = "a11y-panel:";

/** Event name used by the MAIN-world history hook to notify the content script. */
export const ROUTE_CHANGE_EVENT = "a11y-checker:route-change";

/** Rule weights by severity, as in Google Lighthouse's accessibility score (axe impact critical 10, serious 7, moderate 3, minor 1). */
export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  Critical: 10,
  Serious: 7,
  Moderate: 3,
  Minor: 1,
};

export const SEVERITY_ORDER: Severity[] = ["Critical", "Serious", "Moderate", "Minor"];

export const DEFAULT_SETTINGS: Settings = {
  wcagLevel: "AA",
  wcagVersion: "2.2",
  enabledCategories: [],
  autoRescan: false,
  includeBestPractices: true,
  axeOnly: false,
  environment: "",
  reportPreparedBy: "",
  reportOrganisation: "",
  redactSelectors: ["[type=password]", ".pii"],
  maskInputValues: true,
  overlay: {
    showBadges: true,
    colors: {
      Critical: "#d7263d",
      Serious: "#f46036",
      Moderate: "#f5b700",
      Minor: "#8d99ae",
      review: "#2e86de",
    },
  },
};

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  disabled: [],
  thresholds: {},
};

/** chrome.storage.local keys. Origin-scoped keys use the `<prefix>:<origin>` form. */
export const STORAGE_KEYS = {
  settings: "settings",
  rules: "rules",
  baseline: (origin: string) => `baseline:${origin}`,
  ignored: (origin: string) => `ignored:${origin}`,
  lastResult: (tabId: number) => `lastResult:${tabId}`,
  savedScanIndex: "savedScans",
  savedScan: (id: string) => `savedScan:${id}`,
} as const;

export const SPA_DEBOUNCE_MS = 800;
export const MAX_HTML_SNIPPET = 300;
export const SCREENSHOT_PADDING = 16;
export const SAVED_SCAN_LIMIT = 100;
