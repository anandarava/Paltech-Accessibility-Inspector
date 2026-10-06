import { useState } from "react";
import type { ExportFormat } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { useStore } from "@src/sidepanel/store";
import { Popover } from "./Popover";
import { DownloadIcon } from "./icons";

interface ExportOption {
  id: string;
  format: ExportFormat;
  screenshots?: boolean;
  label: string;
  hint: string;
  /** Needs the live page (not available for saved scans). */
  live?: boolean;
}

const OPTIONS: ExportOption[] = [
  { id: "html-shots", format: "html", screenshots: true, live: true, label: "HTML report with screenshots", hint: "Best for clients: captures each problem (the page scrolls)" },
  { id: "html", format: "html", label: "HTML report", hint: "Summary and developer details" },
  { id: "json", format: "json", label: "JSON", hint: "Raw result for tooling / CI" },
];

export function ExportMenu() {
  const tabId = useStore((s) => s.tabId);
  const hasResult = useStore((s) => Boolean(s.result));
  const saved = useStore((s) => s.viewingSaved);
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState<string | null>(null);

  const exportAs = async (option: ExportOption) => {
    if (busy) return;
    const { format } = option;
    if (saved) {
      setBusy(option.id);
      const res = await sendToBackground<{ filename?: string }>({ type: "SAVED_SCAN_EXPORT", id: saved.id, format });
      setBusy(null);
      if (res.ok) showToast({ kind: "success", message: `Report exported${res.data?.filename ? `: ${res.data.filename}` : "."}` });
      else showToast({ kind: "error", message: `Export failed: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    if (tabId === null) return;
    setBusy(option.id);
    showToast({
      kind: "info",
      message: option.screenshots ? "Capturing screenshots, then building the report… Keep this tab open." : `Building ${format.toUpperCase()} report…`,
    });
    const res = await sendToBackground<{ filename?: string }>({ type: "EXPORT_REPORT", tabId, format, screenshots: option.screenshots });
    setBusy(null);
    // The SW broadcasts EXPORT_RESULT for the outcome; only surface a transport failure here.
    if (!res.ok) showToast({ kind: "error", message: `Export failed: ${res.error ?? "unknown error"}`, autoDismiss: false });
  };

  return (
    <Popover side="top" label={<><DownloadIcon /> Export</>} ariaLabel="Export report" disabled={!hasResult || (tabId === null && !saved)}>
      <ul aria-label="Export formats">
        {OPTIONS.filter((f) => !(f.live && saved)).map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => void exportAs(f)}
              // aria-disabled (not disabled) so the focused item keeps focus while an export runs; exportAs ignores clicks when busy.
              aria-disabled={busy !== null ? true : undefined}
              className="w-full rounded px-2 py-1 text-left text-sm text-slate-900 hover:bg-slate-100 aria-disabled:cursor-not-allowed aria-disabled:text-slate-500"
            >
              {busy === f.id ? `${f.label}…` : f.label}
              <span className="block text-[11px] text-slate-600">{f.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
