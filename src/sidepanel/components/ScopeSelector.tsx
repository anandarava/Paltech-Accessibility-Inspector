import { useEffect, useState } from "react";
import { useStore } from "@src/sidepanel/store";
import { sendToPage } from "@src/sidepanel/hooks/messaging";
import { PICKED_EVENT } from "@src/sidepanel/hooks/useBackgroundEvents";
import { Button } from "./Button";
import { CrosshairIcon } from "./icons";
import { useStartScan } from "./ScanButton";

/**
 * Shared "Part of page" logic: the selector draft, validation, the element picker
 * and the DevTools "$0" shortcut. Used by the scope popover and the landing view.
 */
export function useScopeSelector(getInspectedSelector?: () => Promise<string | null>) {
  const tabId = useStore((s) => s.tabId);
  const scope = useStore((s) => s.scope);
  const setScope = useStore((s) => s.setScope);
  const picking = useStore((s) => s.picking);
  const setPicking = useStore((s) => s.setPicking);
  const showToast = useStore((s) => s.showToast);
  const startScan = useStartScan();
  const [draft, setDraft] = useState(scope.selector ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(scope.selector ?? ""), [scope.selector]);

  // The picker result arrives as a broadcast; scan the picked element right away.
  useEffect(() => {
    const onPicked = () => void startScan();
    window.addEventListener(PICKED_EVENT, onPicked);
    return () => window.removeEventListener(PICKED_EVENT, onPicked);
  }, [startScan]);

  const preview = (selector: string) => {
    if (tabId === null || !selector) return;
    void sendToPage(tabId, { type: "HIGHLIGHT_SELECTORS", tabId, selectors: [selector], scroll: true });
  };

  const applySelector = (value: string) => {
    const selector = value.trim();
    if (!selector) {
      setError("Enter a CSS selector, or pick an element on the page.");
      return false;
    }
    try {
      document.createDocumentFragment().querySelector(selector);
    } catch {
      setError(`"${selector}" is not a valid CSS selector.`);
      return false;
    }
    setError(null);
    setScope({ kind: "selector", selector });
    preview(selector);
    return true;
  };

  const pick = async () => {
    if (tabId === null) return;
    setPicking(true);
    const res = await sendToPage(tabId, { type: "PICKER_START", tabId });
    if (!res.ok) {
      setPicking(false);
      showToast({ kind: "error", message: `Could not start the element picker: ${res.error ?? "no response from page"}` });
      return;
    }
    showToast({ kind: "info", message: "Click an element on the page to scan it. Press Esc to cancel." });
  };

  const cancelPick = () => {
    if (tabId === null) return;
    setPicking(false);
    void sendToPage(tabId, { type: "PICKER_CANCEL", tabId });
  };

  const useInspected = async () => {
    if (!getInspectedSelector) return;
    const selector = await getInspectedSelector();
    if (!selector) {
      showToast({ kind: "error", message: "Select an element in the Elements panel first." });
      return;
    }
    setDraft(selector);
    if (applySelector(selector)) void startScan();
  };

  /** Switch to "Part of page", re-applying the typed selector when there is one. */
  const choosePart = () => {
    if (draft.trim()) applySelector(draft);
    else setScope({ kind: "selector", selector: "" });
  };

  return {
    scope,
    setScope,
    draft,
    setDraft,
    error,
    picking,
    applySelector,
    pick,
    cancelPick,
    useInspected,
    choosePart,
    hasInspected: Boolean(getInspectedSelector),
  };
}

export type ScopeSelectorState = ReturnType<typeof useScopeSelector>;

/** The element picker and status text for "Part of page" (there is no selector field: the picker is the way to choose). */
export function ScopeSelectorFields({ state, className = "" }: { state: ScopeSelectorState; className?: string }) {
  const { scope, picking, pick, cancelPick, useInspected, hasInspected } = state;
  return (
    <div className={className}>
      {picking ? (
        <button
          type="button"
          onClick={cancelPick}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-red-700 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
        >
          <CrosshairIcon size={16} /> Cancel picking
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void pick()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-blue-600 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100"
        >
          <CrosshairIcon size={16} /> Pick an element on the page
        </button>
      )}
      {hasInspected && (
        <Button className="mt-1.5 w-full rounded-lg" onClick={() => void useInspected()}>
          Scan selected element ($0)
        </Button>
      )}
      {scope.selector ? (
        <p className="mt-2 text-xs text-slate-700">
          Scanning only <code className="break-all font-mono">{scope.selector}</code> and everything inside it.
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-700">Pick an element on the page to choose what to scan.</p>
      )}
    </div>
  );
}
