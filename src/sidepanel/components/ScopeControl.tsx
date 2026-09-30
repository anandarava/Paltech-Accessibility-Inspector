import { useEffect, useId, useState } from "react";
import { useStore } from "@src/sidepanel/store";
import { sendToPage } from "@src/sidepanel/hooks/messaging";
import { PICKED_EVENT } from "@src/sidepanel/hooks/useBackgroundEvents";
import { Popover } from "./Popover";
import { Button } from "./Button";
import { useStartScan } from "./ScanButton";

interface Props {
  /** DevTools only: resolves a selector for the element selected in the Elements panel ($0). */
  getInspectedSelector?(): Promise<string | null>;
}

/**
 * "Full page" / "Part of page" scope, like axe DevTools: type a CSS selector,
 * pick an element on the page, or (in DevTools) use the element selected in
 * the Elements panel. Picking starts the scan straight away.
 */
export function ScopeControl({ getInspectedSelector }: Props) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const scope = useStore((s) => s.scope);
  const setScope = useStore((s) => s.setScope);
  const picking = useStore((s) => s.picking);
  const setPicking = useStore((s) => s.setPicking);
  const scanning = useStore((s) => s.scanning);
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

  const label = scope.kind === "page" ? "Full page" : "Part of page";

  return (
    <Popover label={<><span aria-hidden="true">◎</span> {label}</>} ariaLabel={`Scan scope: ${label}. Change scope`} align="left" disabled={tabId === null} className="flex-auto">
      <fieldset className="w-72" disabled={scanning}>
        <legend className="mb-1 text-xs font-semibold text-slate-800">What to scan</legend>
        <label className="flex items-center gap-2 py-0.5 text-sm text-slate-800">
          <input type="radio" name={`${id}-scope`} checked={scope.kind === "page"} onChange={() => setScope({ kind: "page" })} />
          Full page
        </label>
        <label className="flex items-center gap-2 py-0.5 text-sm text-slate-800">
          <input
            type="radio"
            name={`${id}-scope`}
            checked={scope.kind === "selector"}
            onChange={() => {
              if (draft.trim()) applySelector(draft);
              else setScope({ kind: "selector", selector: "" });
            }}
          />
          Part of page
        </label>

        {/* Choosing what to scan only matters for "Part of page". */}
        {scope.kind === "selector" && (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <label htmlFor={`${id}-sel`} className="block text-xs font-medium text-slate-800">
            CSS selector
          </label>
          <div className="mt-0.5 flex gap-1">
            <input
              id={`${id}-sel`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applySelector(draft);
                }
              }}
              placeholder="e.g. main, #checkout-form"
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? `${id}-err` : undefined}
              className="min-w-0 flex-1 rounded border border-slate-500 bg-white px-2 py-1 font-mono text-xs text-slate-900"
            />
            <Button size="sm" onClick={() => applySelector(draft)}>
              Use
            </Button>
          </div>
          {error && (
            <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-red-700">
              {error}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {picking ? (
              <Button size="sm" variant="danger" onClick={cancelPick}>
                Cancel picking
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => void pick()}>
                <span aria-hidden="true">⌖</span> Pick element on page
              </Button>
            )}
            {getInspectedSelector && (
              <Button size="sm" onClick={() => void useInspected()}>
                Scan selected element ($0)
              </Button>
            )}
          </div>
          {scope.selector ? (
            <p className="mt-2 text-[11px] text-slate-700">
              Scanning only <code className="break-all font-mono">{scope.selector}</code> and everything inside it.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-slate-700">Type a CSS selector or pick an element on the page to choose what to scan.</p>
          )}
        </div>
        )}
      </fieldset>
    </Popover>
  );
}
