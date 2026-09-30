import type { KeyboardTestResult } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { useStore } from "@src/sidepanel/store";
import { sendToPage } from "@src/sidepanel/hooks/messaging";
import { useFocusHeading } from "@src/sidepanel/hooks/useFocusHeading";
import { Button } from "./Button";

/** The recording stops after this many focus changes. */
const MAX_TABS = 200;

function isKeyboardResult(v: unknown): v is KeyboardTestResult {
  return typeof v === "object" && v !== null && Array.isArray((v as { path?: unknown }).path);
}

export function KeyboardTest({ onBack }: { onBack(): void }) {
  const tabId = useStore((s) => s.tabId);
  const running = useStore((s) => s.keyboardRunning);
  const progress = useStore((s) => s.keyboardProgress);
  const result = useStore((s) => s.keyboardResult);
  const setRunning = useStore((s) => s.setKeyboardRunning);
  const setProgress = useStore((s) => s.setKeyboardProgress);
  const setResult = useStore((s) => s.setKeyboardResult);
  const setOverlayMode = useStore((s) => s.setOverlayMode);
  const showToast = useStore((s) => s.showToast);
  const headingRef = useFocusHeading<HTMLHeadingElement>([]);
  const start = async () => {
    if (tabId === null || running) return;
    setResult(undefined);
    setRunning(true);
    setProgress(null);
    const res = await sendToBackground<unknown>({ type: "KEYBOARD_TEST_START", tabId, maxTabs: MAX_TABS, mode: "guided" });
    if (!res.ok) {
      setRunning(false);
      setProgress(null);
      showToast({ kind: "error", message: `Keyboard test failed: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    // The SW may answer with the finished result or broadcast KEYBOARD_TEST_RESULT; accept either.
    if (isKeyboardResult(res.data)) {
      setRunning(false);
      setProgress(null);
      setResult(res.data);
    }
  };

  const stop = async () => {
    if (tabId === null) return;
    const res = await sendToBackground<unknown>({ type: "KEYBOARD_TEST_STOP", tabId });
    if (!res.ok) {
      showToast({ kind: "error", message: `Could not stop the test: ${res.error ?? "unknown error"}` });
      return;
    }
    // The SW acknowledges the stop even when the page cannot answer (navigated/reloaded, content
    // script gone, or the guided session already ended). Always leave the running state so the
    // Start buttons come back; only show a result when one was actually returned.
    setRunning(false);
    setProgress(null);
    if (isKeyboardResult(res.data)) {
      setResult(res.data);
    } else {
      showToast({ kind: "info", message: "Recording stopped; the page did not return a result." });
    }
  };

  const showTabOrder = async () => {
    if (tabId === null) return;
    setOverlayMode("taborder");
    const res = await sendToPage(tabId, { type: "TOGGLE_OVERLAY", tabId, visible: true, mode: "taborder" });
    if (!res.ok) showToast({ kind: "error", message: `Could not draw the tab order: ${res.error ?? "no response from page"}` });
  };

  return (
    <section aria-labelledby="keyboard-heading" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-slate-300 px-3 py-2">
        <Button onClick={onBack} size="sm" aria-label="Back to issue list">
          ← Back
        </Button>
        <h2 id="keyboard-heading" ref={headingRef} tabIndex={-1} className="text-base font-semibold text-slate-900">
          Keyboard test
        </h2>
      </div>

      <div className="px-3 py-2 text-sm text-slate-800">
        <p>
          Records where focus lands while you press <kbd className="rounded border border-slate-400 bg-slate-100 px-1 font-mono text-xs">Tab</kbd>{" "}
          through the page, and reports keyboard traps and elements that are never reached (WCAG 2.1.1, 2.1.2, 2.4.3).
        </p>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-slate-700">
          <li>Press <strong>Start test</strong>.</li>
          <li>Click into the page, then press Tab repeatedly (Shift+Tab goes back).</li>
          <li>The test ends by itself when focus comes back to the first element or a trap is found. Press <strong>Stop</strong> to end it early.</li>
        </ol>
        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={() => void start()} disabled={tabId === null || running}>
            {running ? "Recording…" : "Start test"}
          </Button>
          {running && (
            <Button variant="danger" onClick={() => void stop()}>
              Stop
            </Button>
          )}
        </div>

        <div aria-live="polite" className="mt-2 text-xs text-slate-800">
          {running && (
            <p>
              Recording focus changes…
              {progress && (
                <>
                  {" "}
                  Step {progress.step}: <code className="font-mono break-all">{progress.selector}</code>
                </>
              )}
            </p>
          )}
        </div>

        {result && !running && (
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-slate-900">Result</h3>
            {result.trapDetected ? (
              <p className="mt-1 rounded border border-red-700 bg-red-50 p-2 text-sm text-red-900">
                <strong>Keyboard trap detected (KBD-02).</strong> Focus cycled within {result.trapElements.length} element
                {result.trapElements.length === 1 ? "" : "s"}{" "}
                while you pressed Tab and never reached the rest of the page. Check whether Escape or Shift+Tab lets you out.
              </p>
            ) : result.cycleCompleted ? (
              <p className="mt-1 rounded border border-green-700 bg-green-50 p-2 text-sm text-green-900">
                No keyboard trap: focus returned to the starting element after {result.path.length} step
                {result.path.length === 1 ? "" : "s"}.
              </p>
            ) : (
              <p className="mt-1 rounded border border-amber-700 bg-amber-50 p-2 text-sm text-amber-900">
                Stopped after {result.path.length} step{result.path.length === 1 ? "" : "s"} without completing a full cycle.{" "}
                Keep pressing Tab until focus comes back to the first element, or check the unreached elements below.
              </p>
            )}

            {result.trapElements.length > 0 && (
              <>
                <h4 className="mt-2 text-xs font-semibold text-slate-800">Trapped elements</h4>
                <ul className="list-disc pl-4 text-xs">
                  {result.trapElements.map((sel) => (
                    <li key={sel}>
                      <code className="font-mono break-all">{sel}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void showTabOrder()} disabled={tabId === null}>
                Show tab order on page
              </Button>
            </div>

            <h4 className="mt-2 text-xs font-semibold text-slate-800">Focus path ({result.path.length})</h4>
            <ol className="max-h-64 overflow-y-auto text-xs">
              {result.path.map((step, i) => (
                <li key={`${step.index}-${i}`} className="flex gap-2 border-b border-slate-200 py-0.5">
                  <span className="w-6 shrink-0 text-right tabular-nums text-slate-700">{step.index + 1}.</span>
                  <span className="min-w-0">
                    <span className="text-slate-900">
                      &lt;{step.tagName.toLowerCase()}&gt; {step.accessibleName ? `"${step.accessibleName}"` : <em className="text-slate-700">(no accessible name)</em>}
                    </span>
                    <code className="block break-all font-mono text-[11px] text-slate-700">{step.selector}</code>
                  </span>
                </li>
              ))}
            </ol>

            {result.unreachedFocusables.length > 0 && (
              <>
                <h4 className="mt-2 text-xs font-semibold text-slate-800">
                  Focusable elements never reached ({result.unreachedFocusables.length})
                </h4>
                <ul className="max-h-40 list-disc overflow-y-auto pl-4 text-xs">
                  {result.unreachedFocusables.map((sel) => (
                    <li key={sel}>
                      <code className="font-mono break-all">{sel}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
