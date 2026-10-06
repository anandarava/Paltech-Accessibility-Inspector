import { sendToTab } from "@shared/messages";
import { clearLastResult, clearScanOptions } from "@src/background/storage";
import { DEFAULT_FILTERS, useStore } from "@src/sidepanel/store";
import { Button } from "./Button";
import { ResetIcon } from "./icons";

/**
 * Clears everything held for the current tab so testing can start from scratch: the scan result,
 * filters, selection, keyboard-test result, scope and the overlay on the page. Saved scans,
 * baselines, ignore lists and settings are left alone.
 */
export function ResetButton() {
  const tabId = useStore((s) => s.tabId);
  const scanning = useStore((s) => s.scanning);
  const hasData = useStore((s) => s.result !== undefined || s.keyboardResult !== undefined || s.viewingSaved !== null);
  const showToast = useStore((s) => s.showToast);

  const reset = async () => {
    const store = useStore.getState();
    if (store.tabId === null) return;
    const id = store.tabId;
    if (
      !window.confirm(
        "Reset the inspector for this tab?\n\nThis clears the current scan results, filters, keyboard test and on-page highlights so you can start again. Saved scans, baselines, ignore lists and settings are kept.",
      )
    ) {
      return;
    }
    if (store.keyboardRunning) await sendToTab(id, { type: "KEYBOARD_TEST_STOP", tabId: id });
    await Promise.allSettled([
      clearLastResult(id),
      clearScanOptions(id),
      // Tabs without the content script just answer ok:false; nothing to clear there.
      sendToTab(id, { type: "CS_RESET", tabId: id }),
    ]);
    const after = useStore.getState();
    if (after.tabId !== id) return;
    after.resetForTab();
    after.setFilters({ ...DEFAULT_FILTERS });
    after.setResultTab("all");
    after.setGroupBy("rule");
    useStore.setState({ expandedRules: [], collapsedCategories: [] });
    showToast({ kind: "success", message: "Reset. Run a new scan to start again." });
  };

  return (
    <Button variant="ghost" size="action" onClick={() => void reset()} disabled={tabId === null || scanning || !hasData} title="Clear results, filters and highlights and start from scratch">
      <ResetIcon /> Reset
    </Button>
  );
}
