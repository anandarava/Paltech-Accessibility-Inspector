import { useEffect } from "react";
import { isMessage, type Message } from "@shared/messages";
import type { Issue, ScanResult } from "@shared/types";
import { isBestPracticeIssue, matchesFilters, matchesTab, ruleGroupKey, useStore, type Filters } from "@src/sidepanel/store";

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
      // Keep track of scans running in tabs other than the visible one, so switching back
      // to such a tab does not re-enable Scan while it is still running.
      if ("tabId" in msg && msg.tabId !== store.tabId) {
        if (msg.type === "SCAN_PROGRESS") store.markScanning(msg.tabId, true);
        else if (msg.type === "SCAN_RESULT" || msg.type === "SCAN_ERROR") store.markScanning(msg.tabId, false);
      }
      if (!("tabId" in msg) || msg.tabId !== store.tabId) return;

      switch (msg.type) {
        case "SCAN_PROGRESS":
          store.markScanning(msg.tabId, true);
          store.setScanning(true);
          store.setProgress({ percent: clampPercent(msg.percent), stage: msg.stage });
          break;
        case "SCAN_RESULT": {
          const count = msg.result.issues.length;
          const message = `${count} issue${count === 1 ? "" : "s"} found`;
          // A live result arriving while a saved scan is shown must not silently throw the
          // user out of it: park the result as the live one and say so.
          if (store.viewingSaved) {
            if (store.liveResult && msg.result.scanId === store.liveResult.scanId) {
              useStore.setState({ liveResult: msg.result });
              break;
            }
            store.markScanning(msg.tabId, false);
            useStore.setState({ liveResult: msg.result, scanning: false, progress: null, pageChanged: null });
            store.showToast({
              kind: "success",
              title: "Scan complete",
              message: `${message} · you are viewing a saved scan`,
            });
            break;
          }
          // The SW also broadcasts SCAN_RESULT for in-place updates of an existing
          // result (baseline/ignore removal, KBD-02 traps recorded after a keyboard
          // test). Those carry the scanId the panel already holds; only a different
          // scanId (or no result yet) is a finished scan.
          const current = useStore.getState().result;
          if (current && msg.result.scanId === current.scanId) {
            applyResultUpdate(msg.result);
            break;
          }
          store.markScanning(msg.tabId, false);
          store.setResult(msg.result);
          store.showToast({ kind: "success", title: "Scan complete", message });
          break;
        }
        case "SCAN_ERROR":
          store.markScanning(msg.tabId, false);
          store.setScanning(false);
          store.setProgress(null);
          store.showToast({ kind: "error", message: `Scan failed: ${msg.error}`, autoDismiss: false });
          break;
        case "ISSUE_CLICKED": {
          // Overlay clicks refer to the live scan. A saved scan is shown instead: go back to live only if the issue is there.
          if (store.viewingSaved) {
            if (!store.liveResult?.issues.some((i) => i.id === msg.issueId)) break;
            store.exitSaved();
          }
          const exists = useStore.getState().result?.issues.find((i) => i.id === msg.issueId);
          if (!exists) break;
          const revealed = revealIssue(exists);
          store.expandCategory(exists.category);
          store.expandRule(ruleGroupKey(exists));
          store.selectIssue(msg.issueId);
          // Stay on whatever view is open; the list scrolls the item into view
          // (IssueList reacts to selectedIssueId) and the detail view swaps issue.
          if (store.view !== "list" && store.view !== "detail") store.setView("list");
          if (revealed) store.showToast({ kind: "info", message: `Showing issue ${exists.ruleId}. ${revealed}` });
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

/**
 * Make sure the clicked issue is visible in the list: switch away from result tabs that do not
 * list issues (or not this kind) and drop only the filters that would hide it.
 * Returns a short description of what changed (for the live region), or "" when nothing did.
 */
function revealIssue(issue: Issue): string {
  const store = useStore.getState();
  const changes: string[] = [];
  let tab = store.resultTab;
  if (tab === "failed" || tab === "passed" || tab === "na" || !matchesTab(issue, tab)) {
    tab = "all";
    store.setResultTab("all");
    changes.push("switched to the All tab");
  }
  const f = store.filters;
  const patch: Partial<Filters> = {};
  if (f.statuses.length > 0 && !f.statuses.includes(issue.status)) patch.statuses = [...f.statuses, issue.status];
  if (f.severities.length > 0 && !f.severities.includes(issue.severity)) patch.severities = [];
  if (f.categories.length > 0 && !f.categories.includes(issue.category)) patch.categories = [];
  if (f.sources.length > 0 && !f.sources.includes(issue.source)) patch.sources = [];
  if (tab === "all" && !f.showBestPractice && isBestPracticeIssue(issue)) patch.showBestPractice = true;
  const open: Filters = { statuses: [], severities: [], categories: [], sources: [], showBestPractice: true, search: f.search };
  if (!matchesFilters(issue, open, "all")) patch.search = "";
  if (Object.keys(patch).length > 0) {
    store.setFilters(patch);
    changes.push("cleared filters that hid it");
  }
  return changes.length ? `${changes.join(" and ").replace(/^./, (c) => c.toUpperCase())}.` : "";
}

/**
 * On mount and whenever the tab changes: load the tab's last scan. The rest of the tab's view state
 * (filters, open view, scope...) is swapped by the store's setTabId, so each tab keeps its own.
 */
export function useLastResult(): void {
  const tabId = useStore((s) => s.tabId);
  useEffect(() => {
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

