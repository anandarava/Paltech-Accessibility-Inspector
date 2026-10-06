import { useCallback } from "react";
import { sendToBackground } from "@shared/messages";
import { useStore } from "@src/sidepanel/store";
import { isScanResult } from "@src/sidepanel/hooks/messaging";
import { Button } from "./Button";
import { PlayIcon, RefreshIcon } from "./icons";

/** Starts a full-page scan for the current tab. Exposed so other components (banner) can reuse it. */
export function useStartScan(): () => Promise<void> {
  return useCallback(async () => {
    const store = useStore.getState();
    const { tabId, settings, scanning, scope } = store;
    if (tabId === null || scanning) return;
    if (store.viewingSaved) store.exitSaved();
    store.setScanning(true);
    store.markScanning(tabId, true);
    store.setProgress({ percent: 0, stage: "Starting scan" });
    store.setPageChanged(null);
    const res = await sendToBackground<unknown>({
      type: "SCAN_START",
      tabId,
      options: {
        scope: scope.kind === "selector" && scope.selector ? "selector" : "page",
        selector: scope.kind === "selector" ? scope.selector : undefined,
        wcagLevel: settings.wcagLevel,
        wcagVersion: settings.wcagVersion,
        rules: [],
        includeBestPractices: settings.includeBestPractices,
        axeOnly: settings.axeOnly,
      },
    });
    const after = useStore.getState();
    // Whatever tab is visible now, a failed or already-answered start means no scan is running for this one.
    if (!res.ok || isScanResult(res.data)) after.markScanning(tabId, false);
    if (after.tabId !== tabId) return;
    if (!res.ok) {
      after.setScanning(false);
      after.setProgress(null);
      after.showToast({ kind: "error", message: `Scan failed: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    // Some SW implementations resolve with the finished result instead of
    // (or as well as) broadcasting SCAN_RESULT; accept either.
    if (isScanResult(res.data)) {
      after.setResult(res.data);
    }
  }, []);
}

export function ScanButton({ icon = "play", className = "flex-1 basis-[5.5rem] whitespace-normal leading-tight" }: { icon?: "play" | "refresh"; className?: string }) {
  const tabId = useStore((s) => s.tabId);
  const scanning = useStore((s) => s.scanning);
  const hasResult = useStore((s) => Boolean(s.result));
  // "Part of page" without a selector yet still scans the whole page, so the label says so.
  const partial = useStore((s) => s.scope.kind === "selector" && Boolean(s.scope.selector));
  const start = useStartScan();
  const label = scanning ? "Scanning…" : partial ? (hasResult ? "Rescan part" : "Scan part of page") : hasResult ? "Rescan page" : "Scan page";
  return (
    <Button variant="primary" size="action" onClick={() => void start()} disabled={tabId === null || scanning} className={className}>
      {icon === "play" ? <PlayIcon size={11} /> : <RefreshIcon size={14} />}
      {label}
    </Button>
  );
}

export function ScanProgressBar() {
  const progress = useStore((s) => s.progress);
  const scanning = useStore((s) => s.scanning);
  if (!scanning) return null;
  const percent = progress?.percent ?? 0;
  const stage = progress?.stage ?? "Preparing";
  return (
    <div className="px-3 py-2">
      <div
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% – ${stage}`}
        className="h-2 w-full overflow-hidden rounded bg-slate-200"
      >
        <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-700" aria-live="polite">
        {percent}% – {stage}
      </p>
    </div>
  );
}
