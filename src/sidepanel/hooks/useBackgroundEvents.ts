import { useEffect } from "react";
import { isMessage, type Message } from "@shared/messages";
import type { ScanResult } from "@shared/types";
import { ruleGroupKey, useStore } from "@src/sidepanel/store";

/** Window event fired in the panel when the on-page picker returns a selector (ScopeControl starts the scan). */
export const PICKED_EVENT = "a11y-checker:picked";
import { refreshSettings, restoreLastResult } from "./messaging";

/**
 * Subscribes to broadcast events from the service worker / content script and
 * applies them to the store. Events carrying a `tabId` are ignored unless they
 * belong to the tab this panel is attached to.
 */
export function useBackgroundEvents(): void {
  useEffect(() => {
    const listener = (raw: unknown): void => {
      if (!isMessage(raw)) return;
      const msg: Message = raw;
      const store = useStore.getState();

      if (msg.type === "SETTINGS_CHANGED") {
        void refreshSettings();
        return;
      }
      if (!("tabId" in msg) || msg.tabId !== store.tabId) return;

      switch (msg.type) {
        case "SCAN_PROGRESS":
          store.setScanning(true);
          store.setProgress({ percent: clampPercent(msg.percent), stage: msg.stage });
          break;
        case "SCAN_RESULT": {
          // A live result arriving while a saved scan is shown: return to the live view first.
          if (store.viewingSaved) store.exitSaved();
          // The SW also broadcasts SCAN_RESULT for in-place updates of an existing
          // result (baseline/ignore removal, KBD-02 traps recorded after a keyboard
          // test). Those carry the scanId the panel already holds; only a different
          // scanId (or no result yet) is a finished scan.
          const current = useStore.getState().result;
          if (current && msg.result.scanId === current.scanId) {
            applyResultUpdate(msg.result);
            break;
          }
          store.setResult(msg.result);
          store.showToast({
            kind: "success",
            message: `Scan complete: ${msg.result.issues.length} issue${msg.result.issues.length === 1 ? "" : "s"} found.`,
          });
          break;
        }
        case "SCAN_ERROR":
          store.setScanning(false);
          store.setProgress(null);
          store.showToast({ kind: "error", message: `Scan failed: ${msg.error}`, autoDismiss: false });
          break;
        case "ISSUE_CLICKED": {
          const exists = store.result?.issues.find((i) => i.id === msg.issueId);
          if (!exists) break;
          store.expandCategory(exists.category);
          store.expandRule(ruleGroupKey(exists));
          store.selectIssue(msg.issueId);
          // Stay on whatever view is open; the list scrolls the item into view
          // (IssueList reacts to selectedIssueId) and the detail view swaps issue.
          if (store.view !== "list" && store.view !== "detail") store.setView("list");
          break;
        }
        case "KEYBOARD_TEST_PROGRESS":
          store.setKeyboardRunning(true);
          store.setKeyboardProgress({ step: msg.step, selector: msg.selector });
          break;
        case "KEYBOARD_TEST_RESULT":
          store.setKeyboardRunning(false);
          store.setKeyboardProgress(null);
          store.setKeyboardResult(msg.result);
          break;
        case "EVIDENCE_RESULT":
          applyEvidence(msg.screenshots);
          break;
        case "EXPORT_RESULT":
          if (msg.ok) {
            store.showToast({ kind: "success", message: `Report exported${msg.filename ? `: ${msg.filename}` : "."}` });
          } else {
            store.showToast({ kind: "error", message: `Export failed: ${msg.error ?? "unknown error"}`, autoDismiss: false });
          }
          break;
        case "PICKER_RESULT": {
          store.setPicking(false);
          if (msg.selector) {
            store.setScope({ kind: "selector", selector: msg.selector });
            window.dispatchEvent(new CustomEvent(PICKED_EVENT, { detail: msg.selector }));
          }
          break;
        }
        case "PAGE_CHANGED":
          if (store.result) store.setPageChanged(msg.reason);
          break;
        default:
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
}

/** On mount and whenever the tab changes: reset per-tab state and restore the last result. */
export function useLastResult(): void {
  const tabId = useStore((s) => s.tabId);
  useEffect(() => {
    useStore.getState().resetForTab();
    if (tabId === null) return;
    void restoreLastResult(tabId);
  }, [tabId]);
}

/** Fetch settings once on mount. */
export function useSettings(): void {
  useEffect(() => {
    void refreshSettings();
  }, []);
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Apply an updated copy of the scan the panel already holds (same scanId) without
 * treating it as a completed scan: an in-flight scan's progress and a pending
 * "Page changed" banner survive, unlike a plain setResult().
 */
export function applyResultUpdate(result: ScanResult): void {
  const store = useStore.getState();
  const { scanning, progress, pageChanged } = store;
  store.setResult(result);
  if (scanning) store.setScanning(true);
  if (progress) store.setProgress(progress);
  if (pageChanged) store.setPageChanged(pageChanged);
}

/** Merge captured screenshots into issue evidence. Shared by event and response paths. */
export function applyEvidence(screenshots: Record<string, string>): void {
  const store = useStore.getState();
  const capturedAt = new Date().toISOString();
  let changed = 0;
  store.updateIssues((issue) => {
    const shot = screenshots[issue.id];
    // Idempotent: the same evidence may arrive via the response and the broadcast.
    if (!shot || issue.evidence?.screenshot === shot) return issue;
    changed++;
    return { ...issue, evidence: { ...issue.evidence, screenshot: shot, capturedAt } };
  });
  if (changed === 0) return;
  store.showToast({ kind: "success", message: `Captured ${changed} screenshot${changed === 1 ? "" : "s"}.` });
}

