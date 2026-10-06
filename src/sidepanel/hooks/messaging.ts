/**
 * Thin helpers around the shared message transport used by the panel.
 */
import type { Message, Response } from "@shared/messages";
import { sendToBackground, sendToTab } from "@shared/messages";
import type { ScanResult, Settings } from "@shared/types";
import { useStore } from "@src/sidepanel/store";

/**
 * Sends a message meant for the content script. Extension pages may talk to
 * the tab directly; if the content script is not injected yet (no receiver)
 * we fall back to the service worker which knows how to inject it.
 */
export async function sendToPage<T = unknown>(tabId: number, msg: Message): Promise<Response<T>> {
  const direct = await sendToTab<T>(tabId, msg);
  if (direct.ok) return direct;
  const viaBackground = await sendToBackground<T>(msg);
  if (viaBackground.ok) return viaBackground;
  return { ok: false, error: viaBackground.error ?? direct.error ?? "The page did not respond." };
}

/** Fetch settings from the service worker and store them. */
export async function refreshSettings(): Promise<Settings | undefined> {
  const res = await sendToBackground<Settings>({ type: "GET_SETTINGS" });
  if (res.ok && res.data && typeof res.data === "object") {
    const s = res.data;
    const store = useStore.getState();
    store.setSettings(s);
    store.setFilters({ showBestPractice: s.includeBestPractices });
    return s;
  }
  return undefined;
}

/** Restore the last scan for a tab (chrome.storage.session via the SW). */
export async function restoreLastResult(tabId: number): Promise<void> {
  const res = await sendToBackground<ScanResult | undefined>({ type: "GET_LAST_RESULT", tabId });
  const store = useStore.getState();
  // The tab may have changed while we were waiting.
  if (store.tabId !== tabId) return;
  if (res.ok && isScanResult(res.data)) {
    // This tab's own view state may already hold it (switching back to a tab): leave that untouched.
    if (store.result?.scanId === res.data.scanId || store.liveResult?.scanId === res.data.scanId) return;
    // A saved scan is open for this tab: keep showing it and park the live result behind it.
    if (store.viewingSaved) {
      useStore.setState({ liveResult: res.data });
      return;
    }
    store.setResult(res.data);
    // setResult marks the scan finished; a rescan of this tab may still be running.
    if (store.scanningTabs.includes(tabId)) store.setScanning(true);
  }
}

export function isScanResult(value: unknown): value is ScanResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { issues?: unknown }).issues) &&
    typeof (value as { scanId?: unknown }).scanId === "string"
  );
}

export function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return fallback;
}
