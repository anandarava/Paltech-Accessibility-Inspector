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
  /** Icon chip text, and whether it is highlighted. */
  chip: string;
  featured?: boolean;
  /** Needs the live page (not available for saved scans). */
  live?: boolean;
}

const OPTIONS: ExportOption[] = [
  { id: "html-shots", format: "html", screenshots: true, live: true, label: "HTML report with screenshots", hint: "Captures each problem. The page scrolls while it runs.", chip: "HTML", featured: true },
  { id: "html", format: "html", label: "HTML report", hint: "Summary and developer details", chip: "HTML" },
  { id: "json", format: "json", label: "JSON", hint: "Raw results for tooling and CI", chip: "JSON" },
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
    <Popover side="top" label={<><DownloadIcon /> Export</>} ariaLabel="Export report" disabled={!hasResult || (tabId === null && !saved)} panelClassName="w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-300 p-2">
      <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">Export as</p>
      <ul aria-label="Export formats">
        {OPTIONS.filter((f) => !(f.live && saved)).map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => void exportAs(f)}
              // aria-disabled (not disabled) so the focused item keeps focus while an export runs; exportAs ignores clicks when busy.
              aria-disabled={busy !== null ? true : undefined}
              className="flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm text-slate-900 hover:bg-slate-50 aria-disabled:cursor-not-allowed aria-disabled:text-slate-500"
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${f.featured ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-700"}`}
              >
                {f.chip}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{busy === f.id ? `${f.label}…` : f.label}</span>
                {f.featured && (
                  <span className="my-0.5 inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-green-600" />
                    Best for clients
                  </span>
                )}
                <span className="block text-xs text-slate-600">{f.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
