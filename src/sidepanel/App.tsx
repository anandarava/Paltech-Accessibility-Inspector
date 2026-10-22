import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useStore } from "./store";
import { useActiveTab } from "./hooks/useActiveTab";
import { useBackgroundEvents, useLastResult, useSettings } from "./hooks/useBackgroundEvents";
import { usePanelConnection } from "./hooks/usePanelConnection";
import { useChangeSettings } from "./hooks/useChangeSettings";
import { BackButton } from "./components/BackButton";
import { Button } from "./components/Button";
import { ScanButton, ScanProgressBar, useStartScan } from "./components/ScanButton";
import { ScopeControl } from "./components/ScopeControl";
import { LandingView } from "./components/LandingView";
import { ScoreCard } from "./components/ScoreCard";
import { ResizableSummary } from "./components/ResizableSummary";
import { ResultTabs } from "./components/ResultTabs";
import { Filters } from "./components/Filters";
import { IssueList } from "./components/IssueList";
import { IssueDetail } from "./components/IssueDetail";
import { KeyboardTest } from "./components/KeyboardTest";
import { ContrastChecker } from "./components/ContrastChecker";
import { SavedScans } from "./components/SavedScans";
import { SiteScan } from "./components/SiteScan";
import { ManualView, ModeChoice, ModeSwitch, useTestingMode } from "./components/ManualView";
import { CompareView } from "./components/CompareView";
import { OverlayMenu, useOverlayModeSync } from "./components/OverlayMenu";
import { ExportMenu } from "./components/ExportMenu";
import { ResetButton } from "./components/ResetButton";
import { SaveScanButton } from "./components/SaveScanButton";
import { Toast } from "./components/Toast";
import { PageChangedBanner } from "./components/PageChangedBanner";
import { SelectMenu, WCAG_LEVEL_OPTIONS, WCAG_VERSION_OPTIONS } from "./components/SelectMenu";
import { BookmarkIcon, DropperIcon, GlobeIcon, KeyboardIcon } from "./components/icons";

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

/** Shown while a page opened from Site scan (View) shows its site-scan result in this tab. */
function SiteScanPageBanner() {
  const resultId = useStore((s) => s.result?.scanId);
  const siteScanResultId = useStore((s) => s.siteScanResultId);
  const viewingSaved = useStore((s) => s.viewingSaved);
  const setView = useStore((s) => s.setView);
  if (!siteScanResultId || resultId !== siteScanResultId || viewingSaved) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-indigo-700 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
      <div className="min-w-0 flex-1">
        <strong>Site scan result</strong> for this page
        <span className="block text-xs">Scanned earlier; rescan to check the page as it is now</span>
      </div>
      <Button size="sm" variant="primary" onClick={() => setView("site")}>
        Back to site scan
      </Button>
    </div>
  );
}

function SavedBanner() {
  const saved = useStore((s) => s.viewingSaved);
  const exitSaved = useStore((s) => s.exitSaved);
  const setView = useStore((s) => s.setView);
  if (!saved) return null;
  // A page opened from the Site scan list (its id is "<site scan id>:<page index>").
  const fromSiteScan = saved.id.startsWith("site_");
  return (
    <div role="status" className="flex items-center gap-2 border-b border-indigo-700 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
      <div className="min-w-0 flex-1">
        <strong>Viewing saved scan:</strong> <span className="truncate">{saved.name}</span>
        <span className="block text-xs">
          {new Date(saved.timestamp).toLocaleString()} · read-only
        </span>
      </div>
      {fromSiteScan ? (
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            exitSaved();
            setView("site");
          }}
        >
          Back to site scan
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={exitSaved}>
          Back to live results
        </Button>
      )}
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
  useOverlayModeSync();

  const tabId = useStore((s) => s.tabId);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const selectedIssueId = useStore((s) => s.selectedIssueId);
  const selectIssue = useStore((s) => s.selectIssue);
  const settings = useStore((s) => s.settings);
  const result = useStore((s) => s.result);
  const scanning = useStore((s) => s.scanning);
  const readOnly = useStore((s) => s.viewingSaved !== null);
  const setInspectable = useStore((s) => s.setInspectable);
  const checkerIssueId = useStore((s) => s.checkerIssueId);
  const openChecker = useStore((s) => s.openChecker);
  const changeSettings = useChangeSettings();
  const startScan = useStartScan();
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const wide = width >= TWO_PANE_MIN_WIDTH;
  // Automated (scans, in this panel) or Manual (guided assessments, in a tab of their own).
  const [mode, chooseMode] = useTestingMode();
  const automated = mode === "automated";

  useEffect(() => {
    setInspectable(inspectable);
  }, [inspectable, setInspectable]);

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

  /** From the checker: back to the finding it was opened for, or to the list. */
  const backFromChecker = useCallback(() => {
    if (checkerIssueId) {
      selectIssue(checkerIssueId);
      setView("detail");
    } else backToList();
  }, [checkerIssueId, selectIssue, setView, backToList]);

  const resultsView = view === "list" || view === "detail";
  // No scan yet for this tab: show the landing view instead of the (empty) results UI.
  const landing = view === "list" && !result && !readOnly;

  const listPane = (
    <>
      <ResizableSummary>
        <ScoreCard />
      </ResizableSummary>
      <ResultTabs />
      <Filters />
      <IssueList onOpen={openIssue} wide={wide} />
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
        <BackButton onClick={backToList} />
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="relative flex h-full flex-col overflow-hidden bg-white text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <h1 className="text-base font-bold">PalTech A11y Inspector</h1>
        {/* The landing view has the same settings in its card; the header shows them with the results. */}
        {automated && !landing && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            <span id={`${id}-version-lbl`} className="text-xs text-slate-700">
              WCAG
            </span>
            <SelectMenu
              id={`${id}-version`}
              label="WCAG version"
              labelledBy={`${id}-version-lbl`}
              value={settings.wcagVersion}
              options={WCAG_VERSION_OPTIONS}
              onChange={(v) => void changeSettings({ wcagVersion: v }, "WCAG version")}
              disabled={scanning}
              align="right"
            />
            <SelectMenu
              id={`${id}-level`}
              label="Conformance level"
              value={settings.wcagLevel}
              options={WCAG_LEVEL_OPTIONS}
              triggerContent={`Level ${settings.wcagLevel}`}
              onChange={(v) => void changeSettings({ wcagLevel: v }, "WCAG level")}
              disabled={scanning}
              align="right"
            />
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
        )}
        {mode && (
          <div className="basis-full">
            <ModeSwitch mode={mode} onChange={(m) => chooseMode(m, true)} />
          </div>
        )}
      </header>

      {mode === null && <ModeChoice onChoose={chooseMode} />}
      {mode === "manual" && <ManualView />}
      {automated && (
        <>
        <SavedBanner />
        <SiteScanPageBanner />
        <PageChangedBanner onRescan={() => void startScan()} />

        {tabId === null && !landing && (
          <p role="status" className="border-b border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            No active tab detected. Open a regular web page in this window to scan it.
          </p>
        )}

        {/* Every control keeps its label on one line and grows to fill its row, so the
            row stays even at any width and wraps into full rows instead of ragged ones. */}
        {!landing && (
        <nav aria-label="Actions" className="flex flex-wrap gap-1.5 border-b border-slate-200 px-3 py-2">
          <ScanButton />
          <ScopeControl getInspectedSelector={getInspectedSelector} />
          <Button onClick={() => setView("keyboard")} disabled={tabId === null} aria-pressed={view === "keyboard"} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <KeyboardIcon /> Keyboard test
          </Button>
          <Button onClick={() => openChecker(null)} aria-pressed={view === "contrast"} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <DropperIcon /> Contrast checker
          </Button>
          <Button onClick={() => setView("saved")} aria-pressed={view === "saved" || view === "compare"} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <BookmarkIcon /> Saved Scans
          </Button>
          <Button onClick={() => setView("site")} aria-pressed={view === "site"} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <GlobeIcon /> Site scan
          </Button>
          <OverlayMenu />
        </nav>
        )}

        <ScanProgressBar />

        <main className="flex min-h-0 flex-1 flex-col">
          {landing && <LandingView getInspectedSelector={getInspectedSelector} />}
          {!landing && resultsView && wide && (
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 w-[45%] min-w-80 flex-col border-r border-slate-300">{listPane}</div>
              <div className="flex min-h-0 flex-1 flex-col">{detailPane}</div>
            </div>
          )}
          {!landing && resultsView && !wide && (view === "list" ? listPane : detailPane)}
          {view === "keyboard" && <KeyboardTest onBack={backToList} />}
          {view === "contrast" && <ContrastChecker key={checkerIssueId ?? "standalone"} onBack={backFromChecker} />}
          {view === "saved" && <SavedScans onBack={backToList} />}
          {view === "compare" && <CompareView onBack={() => setView("saved")} />}
          {view === "site" && <SiteScan onBack={backToList} />}
        </main>

        {/* The single-column issue view has its own action bar; the scan bar returns with the list. */}
        {!landing && resultsView && (wide || view === "list") && (
          <footer className="sticky bottom-0 flex shrink-0 flex-wrap items-center gap-1.5 border-t border-slate-200 bg-white px-3 py-2">
            {!readOnly && <SaveScanButton />}
            <ResetButton />
            <span className="flex-1" />
            <ExportMenu />
          </footer>
        )}

        </>
      )}

      <Toast />
    </div>
  );
}

export default App;
