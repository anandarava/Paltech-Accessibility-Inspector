import { sendToTab } from "@shared/messages";
import { clearAllTabData } from "@src/background/storage";

let started: Promise<void> | null = null;

/**
 * Once per panel page load: forget the previous session's stored scan results and the pages'
 * in-memory copies, so reopening the panel starts from scratch. Saved scans, baselines and
 * settings are kept. Later calls (tab switches) resolve immediately.
 */
export function startFresh(enabled: boolean): Promise<void> {
  if (!enabled) return Promise.resolve();
  if (!started) {
    started = (async () => {
      try {
        const tabIds = await clearAllTabData();
        // Tabs without the content script just answer ok:false.
        await Promise.allSettled(tabIds.map((tabId) => sendToTab(tabId, { type: "CS_RESET", tabId })));
      } catch {
        /* storage unavailable: fall back to restoring what is there */
      }
    })();
  }
  return started;
}
