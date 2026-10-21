import { useEffect, useId, useRef, useState } from "react";
import { sendToBackground } from "@shared/messages";
import {
  ASSESSMENT_NAME,
  FULL_REQUIREMENTS,
  FULL_TESTS,
  newAssessment,
  parseAssessment,
  storageKey,
  summarize,
  type AssessmentKind,
  type AssessmentState,
} from "@shared/assessment";
import { useStore } from "@src/sidepanel/store";

export type TestingMode = "automated" | "manual";
const MODE_KEY = "testingMode";

/** The panel's testing mode: null until the tester chooses (and asks to remember it). */
export function useTestingMode(): [TestingMode | null | undefined, (mode: TestingMode, remember: boolean) => void] {
  const [mode, setMode] = useState<TestingMode | null | undefined>(undefined);
  useEffect(() => {
    void chrome.storage.local.get(MODE_KEY).then(
      (r) => setMode(r[MODE_KEY] === "automated" || r[MODE_KEY] === "manual" ? r[MODE_KEY] : null),
      () => setMode(null),
    );
  }, []);
  const choose = (next: TestingMode, remember: boolean) => {
    setMode(next);
    if (remember) void chrome.storage.local.set({ [MODE_KEY]: next });
  };
  return [mode, choose];
}

/** Segmented switch in the header. */
export function ModeSwitch({ mode, onChange }: { mode: TestingMode; onChange(mode: TestingMode): void }) {
  const item = (m: TestingMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => onChange(m)}
      className={`rounded-lg py-1.5 text-sm ${mode === m ? `bg-white font-bold shadow-sm ${m === "manual" ? "text-emerald-800" : "text-blue-800"}` : "font-semibold text-slate-700 hover:text-slate-900"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Testing mode" className="grid w-full grid-cols-2 rounded-xl bg-slate-100 p-[3px]">
      {item("automated", "Automated")}
      {item("manual", "Manual")}
    </div>
  );
}

/** First screen until the tester picks a mode: Automated or Manual. */
export function ModeChoice({ onChoose }: { onChoose(mode: TestingMode, remember: boolean): void }) {
  const id = useId();
  const [remember, setRemember] = useState(true);
  const card = (mode: TestingMode, title: string, text: string, badge: string, tone: "blue" | "green") => (
    <button
      type="button"
      onClick={() => onChoose(mode, remember)}
      className={`flex flex-col items-start gap-2.5 rounded-2xl border-2 bg-white p-4 text-left ${tone === "blue" ? "border-blue-200 hover:border-blue-500" : "border-emerald-200 hover:border-emerald-500"}`}
    >
      <span aria-hidden="true" className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone === "blue" ? "bg-blue-700" : "bg-emerald-700"}`}>
        {tone === "blue" ? (
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.5">
            <path d="M8.5 1.5 3 9h4.5L7 14.5 13 7H8.5z" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.5">
            <rect x="3" y="2.5" width="10" height="11.5" rx="1.5" />
            <path d="M6 1.5h4v2H6zM5.5 8l1.8 1.8L10.8 6.3" />
          </svg>
        )}
      </span>
      <span className="text-[17px] font-bold">{title}</span>
      <span className="text-[13px] text-slate-700">{text}</span>
      <span className={`mt-auto rounded-full px-2 py-0.5 text-xs font-semibold ${tone === "blue" ? "bg-blue-100 text-blue-900" : "bg-emerald-100 text-emerald-900"}`}>{badge}</span>
    </button>
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-blue-50 to-white p-3.5">
      <section aria-labelledby={`${id}-h`} className="rounded-2xl border border-blue-100 bg-white px-4 pb-4 pt-5 shadow-sm">
        <h2 id={`${id}-h`} className="text-center text-xl font-bold">
          How do you want to test?
        </h2>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {card("automated", "Automated", "Scan the page in seconds", "In this panel", "blue")}
          {card("manual", "Manual", "Guided tests, step by step", "Opens a new tab", "green")}
        </div>
        <label className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-[18px] w-[18px]" />
          Remember my choice
        </label>
      </section>
    </div>
  );
}

/** An assessment in progress for this page: its progress and Continue. */
function InProgressCard({ state, onOpen }: { state: AssessmentState; onOpen(): void }) {
  const s = summarize(state);
  const name = ASSESSMENT_NAME[state.kind];
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-blue-200 bg-white px-3.5 py-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${state.kind === "full" ? "bg-violet-700" : "bg-blue-700"}`} />
        <span className="flex-1 text-sm font-bold">{s.todo === 0 ? `${name} finished` : `${name} in progress`}</span>
        <button type="button" onClick={onOpen} aria-label={`Continue ${name}`} className="rounded-lg bg-blue-700 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-800">
          Continue
        </button>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="h-1.5 flex-1 rounded bg-slate-200" role="progressbar" aria-label={`${name} progress`} aria-valuenow={s.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1.5 rounded bg-blue-700" style={{ width: `${s.percent}%` }} />
        </div>
        <span className="text-[13px] text-slate-700">
          {s.passed + s.failed} / {s.total}
          {s.failed ? ` · ${s.failed} failed` : ""}
        </span>
      </div>
    </div>
  );
}

/** Manual mode: Quick Assess and Full Assessment (with the progress saved for this page) and loading a saved file. */
export function ManualView() {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const showToast = useStore((s) => s.showToast);
  const [page, setPage] = useState<{ url: string; title: string } | null | undefined>(undefined);
  const [saved, setSaved] = useState<Partial<Record<AssessmentKind, AssessmentState>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tabId === null) {
      setPage(null);
      return;
    }
    void chrome.tabs.get(tabId).then(
      (t) => setPage(t.url && /^https?:|^file:/.test(t.url) ? { url: t.url, title: t.title || t.url } : null),
      () => setPage(null),
    );
  }, [tabId]);

  useEffect(() => {
    if (!page) {
      setSaved({});
      return;
    }
    const keys = { quick: storageKey(page.url, "quick"), full: storageKey(page.url, "full") };
    const read = () =>
      void chrome.storage.local.get([keys.quick, keys.full]).then((r) =>
        setSaved({ quick: r[keys.quick] as AssessmentState | undefined, full: r[keys.full] as AssessmentState | undefined }),
      );
    read();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && (keys.quick in changes || keys.full in changes)) read();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [page]);

  const open = async (kind: AssessmentKind) => {
    if (tabId === null) return;
    const res = await sendToBackground({ type: "ASSESS_OPEN", tabId, kind });
    if (!res.ok) showToast({ kind: "error", message: `Could not open ${ASSESSMENT_NAME[kind]}: ${res.error ?? "unknown error"}`, autoDismiss: false });
  };

  const load = async (file: File) => {
    if (!page) return;
    try {
      const loaded = parseAssessment(await file.text());
      const target = newAssessment(page.url, page.title).target;
      if (loaded.target.url !== target.url && !window.confirm(`This file is an assessment of ${loaded.target.url}. Load its results for this page?`)) return;
      await chrome.storage.local.set({ [storageKey(page.url, loaded.kind)]: { ...loaded, target } });
      await open(loaded.kind);
    } catch (e) {
      showToast({ kind: "error", message: e instanceof Error ? e.message : String(e), autoDismiss: false });
    }
  };

  const started = (["quick", "full"] as const).filter((k) => saved[k] && Object.keys(saved[k]!.results).length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-gradient-to-b from-emerald-50 to-white p-3.5">
      {page === null && (
        <p role="status" className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Open a web page in this window to assess it.
        </p>
      )}

      {started.map((k) => (
        <InProgressCard key={k} state={saved[k]!} onOpen={() => void open(k)} />
      ))}

      <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-4 shadow-sm">
        <h2 id={`${id}-h`} className="px-0.5 text-lg font-bold">
          Choose an assessment
        </h2>
        <button type="button" onClick={() => void open("quick")} disabled={!page} className="flex items-start gap-3.5 rounded-2xl border-2 border-emerald-200 p-3.5 text-left hover:border-emerald-500 disabled:opacity-60">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-700">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.5">
              <circle cx="8" cy="8.5" r="5.5" />
              <path d="M8 5.5v3l2 1.5M6.5 1.5h3" />
            </svg>
          </span>
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="flex items-center justify-between gap-2">
              <span className="text-[17px] font-bold">Quick Assess</span>
              <span className="text-[13px] font-bold text-emerald-800">Open ↗</span>
            </span>
            <span className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">10 requirements</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">~30 min</span>
            </span>
          </span>
        </button>
        <button type="button" onClick={() => void open("full")} disabled={!page} className="flex items-start gap-3.5 rounded-2xl border-2 border-violet-200 p-3.5 text-left hover:border-violet-500 disabled:opacity-60">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-700">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.5">
              <rect x="2.5" y="2" width="11" height="12" rx="1.5" />
              <path d="M5 5.5h6M5 8h6M5 10.5h4" />
            </svg>
          </span>
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="flex items-center justify-between gap-2">
              <span className="text-[17px] font-bold">Full Assessment</span>
              <span className="text-[13px] font-bold text-violet-800">Open ↗</span>
            </span>
            <span className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900">
                {FULL_TESTS.length} tests · {FULL_REQUIREMENTS.length} requirements
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">WCAG 2.2 AA</span>
            </span>
          </span>
        </button>
      </section>

      <button type="button" onClick={() => fileRef.current?.click()} disabled={!page} className="inline-flex items-center gap-2 self-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#334155" strokeWidth="1.6" aria-hidden="true">
          <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" />
        </svg>
        Load saved assessment
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
