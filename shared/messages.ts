/**
 * Message contract between Side Panel / DevTools / Options (UI),
 * the Service Worker (SW), and the Content Script (CS).
 *
 * Transport:
 *  - UI -> SW: chrome.runtime.sendMessage(msg)
 *  - SW -> CS: chrome.tabs.sendMessage(tabId, msg)
 *  - CS -> SW / UI: chrome.runtime.sendMessage(msg)   (broadcast; UI filters by tabId)
 *  - UI -> CS: chrome.tabs.sendMessage(tabId, msg)     (allowed for extension pages)
 *
 * Every message carries `type` and, where relevant, `tabId` so the side panel
 * (one per window) can ignore events from other tabs.
 */
import type {
  ColorBlindnessMode,
  ExportFormat,
  Issue,
  ElementColors,
  ManualCheck,
  KeyboardTestResult,
  OverlayMode,
  ScanResult,
  WcagLevel,
  WcagVersion,
} from "./types";
import type { SiteScanOptions, SiteScanState } from "./site-crawl";
import type { AssessmentKind, InstanceKind } from "./assessment";

/** What the side panel sends for a manual contrast check; the service worker adds the rest. */
export type ManualCheckInput = Omit<ManualCheck, "originalType" | "author" | "checkedAt">;

export interface ScanOptions {
  scope: "page" | "selector";
  selector?: string;
  wcagLevel: WcagLevel;
  /** Defaults to "2.2" when absent. */
  wcagVersion?: WcagVersion;
  /** Rule ids to run; empty means all enabled rules. */
  rules: string[];
  includeBestPractices: boolean;
  /** Keep needs-review ("Semi") findings; defaults to true when absent. */
  includeNeedsReview?: boolean;
  /** Run only axe-core's own rules; custom rules and the reflow check are skipped. */
  axeOnly?: boolean;
  /** Rule ids to leave out of this scan only, as if disabled (a site scan's quick mode skips the slow focus and zoom checks). */
  skipRules?: string[];
}

export type Message =
  // ---- Scanning ----
  | { type: "SCAN_START"; tabId: number; options: ScanOptions }
  | { type: "SCAN_PROGRESS"; tabId: number; percent: number; stage: string }
  | { type: "SCAN_RESULT"; tabId: number; result: ScanResult }
  | { type: "SCAN_ERROR"; tabId: number; error: string }
  | { type: "PAGE_CHANGED"; tabId: number; reason: "route" | "dialog" | "dom" }
  // ---- Overlay / highlighting ----
  | { type: "HIGHLIGHT_ISSUE"; tabId: number; issueId: string }
  /** UI -> SW: show an issue that was found inside a child frame (the top frame cannot reach it). */
  | { type: "LOCATE_IN_FRAME"; tabId: number; frameId: number; issueId: string }
  /** SW -> CS (that frame): scroll to the issue's element and outline it briefly. */
  | { type: "CS_LOCATE_IN_FRAME"; issueId: string }
  /** Remove the pulsing outline of the issue that was open in the panel. */
  | { type: "CLEAR_ISSUE_FOCUS"; tabId: number }
  | { type: "ISSUE_CLICKED"; tabId: number; issueId: string }
  | { type: "TOGGLE_OVERLAY"; tabId: number; visible: boolean; mode: OverlayMode }
  | { type: "SET_COLOR_BLINDNESS"; tabId: number; mode: ColorBlindnessMode }
  | { type: "HIGHLIGHT_SELECTORS"; tabId: number; selectors: string[]; scroll?: boolean }
  | { type: "CLEAR_HIGHLIGHTS"; tabId: number }
  // ---- Keyboard test ----
  | { type: "KEYBOARD_TEST_START"; tabId: number; maxTabs: number; mode: "guided" }
  | { type: "KEYBOARD_TEST_STOP"; tabId: number }
  | { type: "KEYBOARD_TEST_PROGRESS"; tabId: number; step: number; selector: string }
  | { type: "KEYBOARD_TEST_RESULT"; tabId: number; result: KeyboardTestResult }
  // ---- Content-script internals (SW -> CS) ----
  | { type: "CS_PING" }
  /** Forget every scan result, highlight and overlay badge held by the page (panel "Reset"). */
  | { type: "CS_RESET"; tabId: number }
  | { type: "CS_GET_ACTIVE_ELEMENT"; tabId: number }
  | { type: "CS_FOCUS_FIRST"; tabId: number }
  | { type: "CS_GET_ELEMENT_BOX"; tabId: number; issueId?: string; selector?: string }
  | { type: "CS_PREPARE_SCREENSHOT"; tabId: number; issueId: string }
  | { type: "CS_RESTORE_AFTER_SCREENSHOT"; tabId: number }
  | { type: "CS_SET_ISSUE_STATUS"; tabId: number; issueId: string; status: Issue["status"]; reason?: string }
  // ---- Evidence / export ----
  | { type: "CAPTURE_EVIDENCE"; tabId: number; issueIds: string[] }
  | { type: "EVIDENCE_RESULT"; tabId: number; screenshots: Record<string, string> }
  | { type: "EXPORT_REPORT"; tabId: number; format: ExportFormat; screenshots?: boolean }
  | { type: "EXPORT_RESULT"; tabId: number; ok: boolean; filename?: string; error?: string }
  // ---- Scope picker (UI -> CS top frame; result is a CS event re-broadcast by the SW) ----
  | { type: "PICKER_START"; tabId: number }
  | { type: "PICKER_CANCEL"; tabId: number }
  | { type: "PICKER_RESULT"; tabId: number; selector: string | null; html?: string }
  // ---- Saved scans ----
  | { type: "SAVED_SCANS_LIST" }
  /** `screenshots`: photograph every failed element first, so the saved scan's reports show them. */
  | { type: "SAVED_SCAN_SAVE"; tabId: number; name: string; screenshots?: boolean }
  | { type: "SAVED_SCAN_GET"; id: string }
  | { type: "SAVED_SCAN_RENAME"; id: string; name: string }
  | { type: "SAVED_SCAN_DELETE"; id: string }
  | { type: "SAVED_SCAN_EXPORT"; id: string; format: ExportFormat }
  /** One file covering several saved scans, in the order given. */
  | { type: "SAVED_SCANS_EXPORT"; ids: string[]; format: ExportFormat }
  // ---- Baseline / ignore ----
  | { type: "BASELINE_ADD"; tabId: number; issueIds: string[]; reason: string }
  | { type: "IGNORE_ADD"; tabId: number; issueIds: string[]; reason: string }
  | { type: "BASELINE_REMOVE"; origin: string; fingerprints: string[] }
  | { type: "IGNORE_REMOVE"; origin: string; fingerprints: string[] }
  /** UI -> SW: record the tester's Contrast checker verdict on a contrast finding (kept for the site). */
  | { type: "MANUAL_CHECK_SET"; tabId: number; issueId: string; check: ManualCheckInput }
  /** UI -> SW: remove a manual contrast check; the finding goes back to what the scan reported. */
  | { type: "MANUAL_CHECK_REMOVE"; tabId: number; issueId: string }
  /**
   * UI -> SW: get the page ready for the eyedropper: hide everything the extension draws, scroll
   * the issue's element into view and, for a focus-ring check, focus it (the SW emulates a focused
   * page so the ring stays drawn while the tester works in the panel). Answers with its colours.
   */
  | { type: "COLOR_PREPARE"; tabId: number; issueId?: string; focus?: boolean }
  /** UI -> SW: undo COLOR_PREPARE (scroll, focus, overlay, focus emulation). */
  | { type: "COLOR_RESTORE"; tabId: number }
  /** SW -> CS: the page side of COLOR_PREPARE / COLOR_RESTORE. */
  | { type: "CS_COLOR_PREPARE"; tabId: number; issueId?: string; focus?: boolean }
  | { type: "CS_COLOR_RESTORE"; tabId: number }
  /** UI -> CS: colours of the element the picker chose (PICKER_RESULT selector). */
  | { type: "CS_ELEMENT_COLORS"; tabId: number; selector: string }
  // ---- Site scan (one at a time; the SW owns the state and broadcasts SITE_SCAN_STATE on every change) ----
  | { type: "SITE_SCAN_GET" }
  /** Find the pages of the site that `url` belongs to; ends in the "review" phase. */
  | { type: "SITE_SCAN_DISCOVER"; url: string; options: SiteScanOptions }
  /** Tick / untick listed pages and add addresses by hand (review phase, or between runs). */
  | { type: "SITE_SCAN_SET_PAGES"; include?: Record<string, boolean>; add?: string[] }
  /** Scan the ticked pages that are still pending (also resumes a paused run). */
  | { type: "SITE_SCAN_START" }
  /** Scan pages already scanned (or failed) again: the given indexes, or all of them. */
  | { type: "SITE_SCAN_RESCAN"; indexes?: number[] }
  | { type: "SITE_SCAN_PAUSE" }
  | { type: "SITE_SCAN_STOP" }
  /** The full result of one scanned page (index into `pages`). */
  | { type: "SITE_SCAN_RESULT"; index: number }
  /**
   * Open one scanned page in `tabId` and make its site-scan result that tab's result, so the
   * issues can be shown on the page (overlay, View element). Returns the result.
   */
  | { type: "SITE_SCAN_SHOW"; index: number; tabId: number }
  | { type: "SITE_SCAN_EXPORT"; format: ExportFormat }
  | { type: "SITE_SCAN_CLEAR" }
  | { type: "SITE_SCAN_STATE"; state: SiteScanState | null }
  // ---- Manual assessment (Quick Assess, in a tab of its own) ----
  /** Open (or bring forward) the assessment tab (Quick Assess by default) for the page in `tabId`. */
  | { type: "ASSESS_OPEN"; tabId: number; kind?: AssessmentKind }
  /** The elements an assisted requirement lists (answers Instance[]). */
  | { type: "ASSESS_LIST"; tabId: number; kind: InstanceKind }
  /**
   * Bring the page forward, let the tester pick an element, optionally photograph it, then
   * return to the tab `returnTabId`. Answers { selector, html, screenshot? } or null (cancelled).
   */
  | { type: "ASSESS_PICK"; tabId: number; screenshot: boolean; returnTabId?: number }
  | { type: "CS_ASSESS_LIST"; kind: InstanceKind }
  /** Scroll the element into view and answer its box (and redaction boxes) for a screenshot. */
  | { type: "CS_ASSESS_SHOT_PREPARE"; selector: string }
  // ---- State queries ----
  | { type: "GET_LAST_RESULT"; tabId: number }
  | { type: "GET_SETTINGS" }
  | { type: "SETTINGS_CHANGED" }
  // ---- Offscreen document ----
  | { type: "OFFSCREEN_CROP"; dataUrl: string; box: { x: number; y: number; width: number; height: number }; padding: number; scale: number; redactBoxes: Array<{ x: number; y: number; width: number; height: number }> }
  | { type: "OFFSCREEN_BUILD_DOWNLOAD"; filename: string; mime: string; content: string };

export type MessageType = Message["type"];

/** Extract a message by its `type` literal. */
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/** Generic response envelope used for request/response style messages. */
export interface Response<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Where to send a message about a single issue: the frame it was found in, and the id the
 * content script of that frame knows it by (the service worker appends `@f<frameId>` to ids
 * that collide across frames).
 */
export function issueFrameTarget(issue: Issue): { frameId: number; issueId: string } {
  const frameId = issue.frameId ?? 0;
  return { frameId, issueId: frameId > 0 ? issue.id.replace(new RegExp(`@f${frameId}$`), "") : issue.id };
}

export function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** Promise wrapper around chrome.runtime.sendMessage. */
export function sendToBackground<T = unknown>(msg: Message): Promise<Response<T>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response: Response<T> | undefined) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve(response ?? { ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** Promise wrapper around chrome.tabs.sendMessage. */
export function sendToTab<T = unknown>(tabId: number, msg: Message, frameId?: number): Promise<Response<T>> {
  return new Promise((resolve) => {
    try {
      const options = frameId === undefined ? undefined : { frameId };
      chrome.tabs.sendMessage(tabId, msg, options as chrome.tabs.MessageSendOptions, (response: Response<T> | undefined) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve(response ?? { ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
