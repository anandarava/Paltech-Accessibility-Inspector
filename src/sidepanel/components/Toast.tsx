import { useEffect } from "react";
import { useStore } from "@src/sidepanel/store";

const KIND_CLASS = {
  info: "border-blue-700 bg-blue-50 text-blue-900",
  success: "border-green-700 bg-green-50 text-green-900",
  error: "border-red-700 bg-red-50 text-red-900",
} as const;

const KIND_TEXT = { info: "Info", success: "Success", error: "Error" } as const;

/**
 * Single toast rendered inside a persistent aria-live region (the region exists
 * even when empty so assistive tech announces later insertions).
 */
export function Toast() {
  const toast = useStore((s) => s.toast);
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast || toast.autoDismiss === false || toast.link) return;
    const t = window.setTimeout(dismiss, 7000);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);

  return (
    <div aria-live="polite" aria-atomic="true" className="pointer-events-none fixed inset-x-2 bottom-2 z-30">
      {toast && (
        <div
          className={`pointer-events-auto flex items-start gap-2 rounded border px-3 py-2 text-sm shadow-lg ${KIND_CLASS[toast.kind]}`}
        >
          <span className="sr-only">{KIND_TEXT[toast.kind]}: </span>
          <div className="min-w-0 flex-1 break-words">
            {toast.message}
            {toast.link && (
              <>
                {" "}
                <a
                  href={toast.link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-semibold underline"
                >
                  {toast.link.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss notification"
            className="shrink-0 rounded px-1 text-base leading-none hover:bg-black/10"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  );
}
