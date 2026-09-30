import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import type { Settings, WcagLevel, WcagVersion } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { saveSettings } from "@src/background/storage";
import { useStore } from "./store";
import { useActiveTab } from "./hooks/useActiveTab";
import { useBackgroundEvents, useLastResult, useSettings } from "./hooks/useBackgroundEvents";
import { usePanelConnection } from "./hooks/usePanelConnection";
import { Button } from "./components/Button";
import { ScanButton, ScanProgressBar, useStartScan } from "./components/ScanButton";
import { ScopeControl } from "./components/ScopeControl";
import { ScoreCard } from "./components/ScoreCard";
import { ResultTabs } from "./components/ResultTabs";
import { Filters } from "./components/Filters";
import { IssueList } from "./components/IssueList";
import { IssueDetail } from "./components/IssueDetail";
import { KeyboardTest } from "./components/KeyboardTest";
import { SavedScans } from "./components/SavedScans";
import { CompareView } from "./components/CompareView";
import { OverlayMenu } from "./components/OverlayMenu";
import { ExportMenu } from "./components/ExportMenu";
import { Toast } from "./components/Toast";
import { PageChangedBanner } from "./components/PageChangedBanner";

export interface AppProps {
  /** DevTools passes chrome.devtools.inspectedWindow.tabId; the side panel resolves the active tab itself. */
  tabIdOverride?: number;
  /** Enables the "Inspect element" action (DevTools only). */
  inspectable?: boolean;
  /** DevTools-only: reveal an element in the Elements panel. */
  onInspect?(selector: string): void;
  /** DevTools-only: selector of the element selected in the Elements panel ($0). */
  getInspectedSelector?(): Promise<string | null>;
}

const LEVELS: WcagLevel[] = ["A", "AA", "AAA"];
const VERSIONS: WcagVersion[] = ["2.2", "2.1", "2.0"];
/** Panel width from which the list and the issue detail are shown side by side. */
const TWO_PANE_MIN_WIDTH = 760;

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function SavedBanner() {
  const saved = useStore((s) => s.viewingSaved);
  const exitSaved = useStore((s) => s.exitSaved);
  if (!saved) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-indigo-700 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
      <div className="min-w-0 flex-1">
        <strong>Viewing saved scan:</strong> <span className="truncate">{saved.name}</span>
        <span className="block text-xs">
          {new Date(saved.timestamp).toLocaleString()} · read-only
        </span>
      </div>
      <Button size="sm" variant="primary" onClick={exitSaved}>
        Back to live results
      </Button>
    </div>
  );
}

export function App({ tabIdOverride, inspectable = false, onInspect, getInspectedSelector }: AppProps) {
  const id = useId();
  useActiveTab(tabIdOverride);
  useBackgroundEvents();
  useLastResult();
  useSettings();
  usePanelConnection();

  const tabId = useStore((s) => s.tabId);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const selectedIssueId = useStore((s) => s.selectedIssueId);
  const selectIssue = useStore((s) => s.selectIssue);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const result = useStore((s) => s.result);
  const scanning = useStore((s) => s.scanning);
  const readOnly = useStore((s) => s.viewingSaved !== null);
  const setInspectable = useStore((s) => s.setInspectable);
  const showToast = useStore((s) => s.showToast);
  const startScan = useStartScan();
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const wide = width >= TWO_PANE_MIN_WIDTH;

  useEffect(() => {
    setInspectable(inspectable);
  }, [inspectable, setInspectable]);

  const changeSettings = async (patch: Partial<Settings>, what: string) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await saveSettings(next);
      // Let other extension pages (options, other panels) refresh.
      void sendToBackground({ type: "SETTINGS_CHANGED" });
    } catch (e) {
      showToast({ kind: "error", message: `Could not save the ${what}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const openIssue = useCallback(
    (issueId: string) => {
      selectIssue(issueId);
      setView("detail");
    },
    [selectIssue, setView],
  );

  const backToList = useCallback(() => {
    if (wide) selectIssue(null);
    setView("list");
  }, [setView, selectIssue, wide]);

  const resultsView = view === "list" || view === "detail";

  const listPane = (
    <>
      <ScoreCard />
      <ResultTabs />
      <Filters />
      <IssueList onOpen={openIssue} />
    </>
  );

  const detailPane = selectedIssueId ? (
    <IssueDetail
      issueId={selectedIssueId}
      onBack={backToList}
      onInspect={inspectable ? onInspect : undefined}
      wide={wide}
    />
  ) : (
    <div className="p-3">
      {wide ? (
        <p className="text-sm text-slate-700">Select an issue to see its details, the element and how to fix it.</p>
      ) : (
        <Button size="sm" onClick={backToList}>
          ← Back
        </Button>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="flex h-full flex-col bg-white text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 px-3 py-2">
        <h1 className="text-base font-bold">PalTech A11y Inspector</h1>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <label htmlFor={`${id}-version`} className="text-xs text-slate-700">
            WCAG
          </label>
          <select
            id={`${id}-version`}
            value={settings.wcagVersion}
            onChange={(e) => void changeSettings({ wcagVersion: e.target.value as WcagVersion }, "WCAG version")}
            disabled={scanning}
            className="rounded border border-slate-500 bg-white px-1 py-0.5 text-sm text-slate-900"
          >
            {VERSIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-level`} className="sr-only">
            Conformance level
          </label>
          <select
            id={`${id}-level`}
            value={settings.wcagLevel}
            onChange={(e) => void changeSettings({ wcagLevel: e.target.value as WcagLevel }, "WCAG level")}
            disabled={scanning}
            className="rounded border border-slate-500 bg-white px-1 py-0.5 text-sm text-slate-900"
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <label className="ml-1 flex items-center gap-1 whitespace-nowrap text-xs text-slate-700" title="Include best-practice rules in scans">
            <input
              type="checkbox"
              checked={settings.includeBestPractices}
              onChange={(e) => void changeSettings({ includeBestPractices: e.target.checked }, "best-practice setting")}
              disabled={scanning}
            />
            Best practices
          </label>
          <label className="ml-1 flex items-center gap-1 whitespace-nowrap text-xs text-slate-700" title="Run only axe-core rules, for results comparable with axe DevTools">
            <input
              type="checkbox"
              checked={settings.axeOnly}
              onChange={(e) => void changeSettings({ axeOnly: e.target.checked }, "axe-core only setting")}
              disabled={scanning}
            />
            axe-core only
          </label>
        </div>
      </header>

      <SavedBanner />
      <PageChangedBanner onRescan={() => void startScan()} />

      {tabId === null && (
        <p role="status" className="border-b border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          No active tab detected. Open a regular web page in this window to scan it.
        </p>
      )}

      {/* Every control keeps its label on one line and grows to fill its row, so the
          row stays even at any width and wraps into full rows instead of ragged ones. */}
      <nav aria-label="Actions" className="flex flex-wrap gap-1.5 border-b border-slate-300 px-3 py-2">
        <ScanButton />
        <ScopeControl getInspectedSelector={getInspectedSelector} />
        <Button onClick={() => setView("keyboard")} disabled={tabId === null} aria-pressed={view === "keyboard"} className="flex-auto">
          <span aria-hidden="true">⌨</span> Keyboard test
        </Button>
        <Button onClick={() => setView("saved")} aria-pressed={view === "saved" || view === "compare"} className="flex-auto">
          <span aria-hidden="true">🗂</span> Saved
        </Button>
        <OverlayMenu />
      </nav>

      <ScanProgressBar />

      <main className="flex min-h-0 flex-1 flex-col">
        {resultsView && wide && (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 w-[45%] min-w-80 flex-col border-r border-slate-300">{listPane}</div>
            <div className="flex min-h-0 flex-1 flex-col">{detailPane}</div>
          </div>
        )}
        {resultsView && !wide && (view === "list" ? listPane : detailPane)}
        {view === "keyboard" && <KeyboardTest onBack={backToList} />}
        {view === "saved" && <SavedScans onBack={backToList} />}
        {view === "compare" && <CompareView onBack={() => setView("saved")} />}
      </main>

      {/* The single-column issue view has its own action bar; the scan bar returns with the list. */}
      {resultsView && (wide || view === "list") && (
        <footer className="flex flex-wrap items-center gap-1.5 border-t border-slate-300 px-3 py-2">
          <span className="flex-1" />
          {!readOnly && (
            <Button onClick={() => setView("saved")} disabled={!result}>
              Save scan
            </Button>
          )}
          <ExportMenu />
        </footer>
      )}

      <Toast />
    </div>
  );
}

export default App;
