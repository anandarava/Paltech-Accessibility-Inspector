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
  KeyboardTestResult,
  OverlayMode,
  ScanResult,
  WcagLevel,
  WcagVersion,
} from "./types";

export interface ScanOptions {
  scope: "page" | "selector";
  selector?: string;
  wcagLevel: WcagLevel;
  /** Defaults to "2.2" when absent. */
  wcagVersion?: WcagVersion;
  /** Rule ids to run; empty means all enabled rules. */
  rules: string[];
  includeBestPractices: boolean;
  /** Run only axe-core's own rules; custom rules and the reflow check are skipped. */
  axeOnly?: boolean;
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
  | { type: "SAVED_SCAN_SAVE"; tabId: number; name: string }
  | { type: "SAVED_SCAN_GET"; id: string }
  | { type: "SAVED_SCAN_RENAME"; id: string; name: string }
  | { type: "SAVED_SCAN_DELETE"; id: string }
  | { type: "SAVED_SCAN_EXPORT"; id: string; format: ExportFormat }
  // ---- Baseline / ignore ----
  | { type: "BASELINE_ADD"; tabId: number; issueIds: string[]; reason: string }
  | { type: "IGNORE_ADD"; tabId: number; issueIds: string[]; reason: string }
  | { type: "BASELINE_REMOVE"; origin: string; fingerprints: string[] }
  | { type: "IGNORE_REMOVE"; origin: string; fingerprints: string[] }
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
