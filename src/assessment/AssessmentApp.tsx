/**
 * The Quick Assess tab: an extension page tied to one tested tab (?tabId=…). Layout: top bar
 * (target page, actions), left navigation (Overview and the requirements with their status),
 * and the main pane (Overview, or one requirement). Progress is saved per tested page in
 * chrome.storage.local (key: storageKey(url)) after every change.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { isMessage, sendToBackground } from "@shared/messages";
import {
  ASSESSMENT_NAME,
  FULL_TESTS,
  QUICK_ASSESS,
  buildAssessmentHtml,
  buildAssessmentJson,
  emptyResult,
  failuresOf,
  locate,
  moveToFull,
  newAssessment,
  pageKey,
  parseAssessment,
  requirementStatus,
  requirementsFor,
  resultOf,
  storageKey,
  summarize,
  type AssessmentKind,
  type AssessmentState,
  type Failure,
  type Instance,
  type Requirement,
  type RequirementResult,
  type RequirementStatus,
  type Verdict,
} from "@shared/assessment";
import { FullNav, FullOverview, TestView } from "./FullAssessment";

type Route = { view: "overview" } | { view: "req"; id: string } | { view: "test"; id: string };

const KIND: AssessmentKind = new URLSearchParams(location.search).get("kind") === "full" ? "full" : "quick";
const REQS: Requirement[] = requirementsFor(KIND);

function readRoute(): Route {
  const m = /^#(req|test)\/(.+)$/.exec(location.hash);
  if (m?.[1] === "req" && REQS.some((r) => r.id === m[2])) return { view: "req", id: m[2] };
  if (m?.[1] === "test" && KIND === "full" && FULL_TESTS.some((t) => t.id === m[2])) return { view: "test", id: m[2] };
  return { view: "overview" };
}

function go(route: Route): void {
  location.hash = route.view === "overview" ? "#overview" : `#${route.view}/${route.id}`;
}

function download(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function fileStem(state: AssessmentState): string {
  let host = "page";
  try {
    host = new URL(state.target.url).hostname.replace(/[^a-z0-9.-]+/gi, "_");
  } catch {
    /* keep "page" */
  }
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${state.kind === "full" ? "full-assessment" : "quick-assess"}_${host}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const STATUS_LABEL: Record<RequirementStatus, string> = { pass: "Passed", fail: "Failed", todo: "To do" };

function StatusIcon({ status }: { status: RequirementStatus }) {
  if (status === "pass")
    return (
      <span role="img" aria-label="Passed" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-[10px] text-white">
        ✓
      </span>
    );
  if (status === "fail")
    return (
      <span role="img" aria-label="Failed" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-700 text-[10px] text-white">
        ✕
      </span>
    );
  return null;
}

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700";
const primary = "inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-[15px] font-bold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:bg-slate-500";
const secondary = "inline-flex items-center gap-2 rounded-lg border border-slate-400 bg-white px-4 py-2 text-[15px] text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700";

// ---------------------------------------------------------------------------
// Dialog: a native <dialog> opened with showModal (focus stays inside, Escape closes)
// ---------------------------------------------------------------------------

function Dialog({ open, onClose, labelledBy, children }: { open: boolean; onClose(): void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      className="m-auto w-[min(640px,calc(100vw-32px))] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-900/60"
    >
      {open && children}
    </dialog>
  );
}

function FailureDialog({
  open,
  req,
  tabId,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  req: Requirement;
  tabId: number;
  initial?: Failure;
  onSave(f: Failure): void;
  onClose(): void;
}) {
  const id = useId();
  const [description, setDescription] = useState(initial?.description ?? "");
  const [selector, setSelector] = useState(initial?.selector ?? "");
  const [html, setHtml] = useState(initial?.html);
  const [withShot, setWithShot] = useState(true);
  const [screenshot, setScreenshot] = useState(initial?.screenshot);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDescription(initial?.description ?? "");
    setSelector(initial?.selector ?? "");
    setHtml(initial?.html);
    setScreenshot(initial?.screenshot);
    setError(null);
  }, [open, initial]);

  const pick = async () => {
    setPicking(true);
    setError(null);
    const self = await chrome.tabs.getCurrent();
    const res = await sendToBackground<{ selector: string; html?: string; screenshot?: string } | null>({
      type: "ASSESS_PICK",
      tabId,
      screenshot: withShot,
      returnTabId: self?.id,
    });
    setPicking(false);
    if (!res.ok) setError(res.error ?? "Could not pick an element.");
    else if (res.data) {
      setSelector(res.data.selector);
      setHtml(res.data.html);
      if (res.data.screenshot) setScreenshot(res.data.screenshot);
    }
  };

  const save = () => {
    if (!description.trim()) {
      setError("Describe what fails.");
      return;
    }
    onSave({
      id: initial?.id ?? `f${Date.now().toString(36)}`,
      description: description.trim(),
      selector: selector.trim() || undefined,
      html: selector.trim() ? html : undefined,
      screenshot: withShot ? screenshot : undefined,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy={`${id}-t`}>
      <div className="px-6 pb-2 pt-5">
        <p className="text-sm text-slate-600">
          {req.name} · WCAG {req.wcag.criterion}
        </p>
        <h2 id={`${id}-t`} className="mt-0.5 text-2xl font-bold">
          {initial ? "Edit failing instance" : "Add a failing instance"}
        </h2>
      </div>
      <div className="flex flex-col gap-4 px-6 py-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-d`} className="text-[15px] font-semibold">
            What fails
          </label>
          <textarea
            id={`${id}-d`}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={error === "Describe what fails." ? "true" : undefined}
            className="rounded-md border border-slate-500 px-2.5 py-2 text-[15px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-e`} className="text-[15px] font-semibold">
            Element (optional)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${id}-e`}
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              className="min-w-0 flex-[1_1_260px] rounded-md border border-slate-500 px-2.5 py-2 font-mono text-[13px]"
            />
            <button type="button" onClick={() => void pick()} disabled={picking} className="rounded-md border border-blue-700 bg-white px-3.5 py-2 text-sm font-semibold text-blue-800 disabled:opacity-60">
              {picking ? "Pick on the page…" : "Pick on page"}
            </button>
          </div>
          <p className="text-[13px] text-slate-600">{picking ? "The page is in front: click the element (Escape cancels)." : "Pick on page switches to the page; click the element there and you come back here."}</p>
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[15px] font-semibold">
            <input type="checkbox" checked={withShot} onChange={(e) => setWithShot(e.target.checked)} className="h-[18px] w-[18px]" />
            Attach a screenshot of the element
          </label>
          {withShot && screenshot && <img src={screenshot} alt="Screenshot of the picked element" className="max-h-40 self-start rounded-md border border-slate-300" />}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-800">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2.5 border-t border-slate-200 px-6 py-4">
        <button type="button" onClick={onClose} className={secondary}>
          Cancel
        </button>
        <button type="button" onClick={save} className={primary}>
          Save failing instance
        </button>
      </div>
    </Dialog>
  );
}

function ExportDialog({ open, state, onClose }: { open: boolean; state: AssessmentState; onClose(): void }) {
  const id = useId();
  const [format, setFormat] = useState<"html" | "json">("html");
  const [description, setDescription] = useState("");
  const [shots, setShots] = useState(true);
  const [criteria, setCriteria] = useState(true);
  const [preparedBy, setPreparedBy] = useState("");
  // Start from the name in PalTech's settings (Options > Reports).
  useEffect(() => {
    if (!open) return;
    void chrome.storage.local.get("settings").then((r) => {
      const name = (r.settings as { reportPreparedBy?: string } | undefined)?.reportPreparedBy;
      if (name) setPreparedBy((prev) => prev || name);
    });
  }, [open]);
  const run = () => {
    const options = { description: description.trim() || undefined, screenshots: shots, criteriaTable: criteria, preparedBy: preparedBy.trim() || undefined };
    if (format === "html") download(`${fileStem(state)}.html`, "text/html", buildAssessmentHtml(state, options));
    else download(`${fileStem(state)}-report.json`, "application/json", buildAssessmentJson(state, options));
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} labelledBy={`${id}-t`}>
      <div className="flex flex-col gap-4 p-6">
        <h2 id={`${id}-t`} className="text-2xl font-bold">
          Export result
        </h2>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[15px] font-semibold">Format</legend>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="radio" name={`${id}-f`} checked={format === "html"} onChange={() => setFormat("html")} /> HTML report (summary, issues to fix, appendix)
          </label>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="radio" name={`${id}-f`} checked={format === "json"} onChange={() => setFormat("json")} /> JSON (by WCAG success criterion, for tools)
          </label>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-d`} className="text-[15px] font-semibold">
            Description (optional)
          </label>
          <textarea id={`${id}-d`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-md border border-slate-500 px-2.5 py-2 text-[15px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-p`} className="text-[15px] font-semibold">
            Assessed by (optional)
          </label>
          <input id={`${id}-p`} value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} className="rounded-md border border-slate-500 px-2.5 py-2 text-[15px]" />
        </div>
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={shots} onChange={(e) => setShots(e.target.checked)} /> Include screenshots of failing instances
        </label>
        <label className={`flex items-center gap-2 text-[15px] ${format === "json" ? "text-slate-500" : ""}`}>
          <input type="checkbox" checked={criteria} disabled={format === "json"} onChange={(e) => setCriteria(e.target.checked)} /> Appendix: conformance by WCAG success criterion (ACR / VPAT style)
        </label>
        <div className="flex gap-2.5">
          <button type="button" onClick={onClose} className={secondary}>
            Cancel
          </button>
          <button type="button" onClick={run} className={primary}>
            Export
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Visual helper: draws on the tested page while switched on
// ---------------------------------------------------------------------------

function useVisualHelper(req: Requirement, tabId: number, on: boolean, instances: Instance[] | undefined): number {
  const [stops, setStops] = useState(0);
  const selectors = (instances ?? []).map((i) => i.selector).join("\n");
  useEffect(() => {
    if (!on || !req.helper) return;
    const helper = req.helper;
    setStops(0);
    const onMessage = (msg: unknown) => {
      if (isMessage(msg) && msg.type === "KEYBOARD_TEST_PROGRESS" && msg.tabId === tabId) setStops(msg.step + 1);
    };
    if (helper === "focus") {
      chrome.runtime.onMessage.addListener(onMessage);
      void (async () => {
        await sendToBackground({ type: "KEYBOARD_TEST_START", tabId, maxTabs: 300, mode: "guided" });
        await sendToBackground({ type: "TOGGLE_OVERLAY", tabId, visible: true, mode: "taborder" });
      })();
    } else if (helper === "headings" || helper === "landmarks") {
      void sendToBackground({ type: "TOGGLE_OVERLAY", tabId, visible: true, mode: helper });
    } else {
      void sendToBackground({ type: "HIGHLIGHT_SELECTORS", tabId, selectors: selectors ? selectors.split("\n") : [] });
    }
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      if (helper === "focus") void sendToBackground({ type: "KEYBOARD_TEST_STOP", tabId });
      if (helper === "instances") void sendToBackground({ type: "CLEAR_HIGHLIGHTS", tabId });
      else void sendToBackground({ type: "TOGGLE_OVERLAY", tabId, visible: false, mode: "off" });
    };
  }, [on, req.helper, req.id, tabId, selectors]);
  return stops;
}

async function showOnPage(tabId: number, selector?: string): Promise<void> {
  if (selector) await sendToBackground({ type: "HIGHLIGHT_SELECTORS", tabId, selectors: [selector], scroll: true });
  await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Requirement page
// ---------------------------------------------------------------------------

function RequirementView({
  req,
  index,
  tabId,
  result,
  status,
  onChange,
}: {
  req: Requirement;
  index: number;
  tabId: number;
  result: RequirementResult;
  status: RequirementStatus;
  onChange(fn: (r: RequirementResult) => RequirementResult): void;
}) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [helperOn, setHelperOn] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; edit?: Failure }>({ open: false });
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const stops = useVisualHelper(req, tabId, helperOn, result.instances);
  const prev = REQS[index - 1];
  const next = REQS[index + 1];
  // Full Assessment: "1.3" numbering; the first check of a test goes back to its Getting started page.
  const place = KIND === "full" ? locate(req.id) : undefined;

  useEffect(() => {
    setHelperOn(false);
    headingRef.current?.focus();
  }, [req.id]);

  const loadInstances = useCallback(async () => {
    if (!req.instances) return;
    setLoading(true);
    setListError(null);
    const res = await sendToBackground<Instance[]>({ type: "ASSESS_LIST", tabId, kind: req.instances });
    setLoading(false);
    if (!res.ok) {
      setListError(res.error ?? "The page did not answer.");
      return;
    }
    const list = res.data ?? [];
    // Keep marks of instances still on the page.
    onChange((r) => ({ ...r, instances: list, marks: Object.fromEntries(Object.entries(r.marks).filter(([k]) => list.some((i) => i.key === k))) }));
  }, [req.instances, tabId, onChange]);

  useEffect(() => {
    if (req.kind === "assisted" && result.instances === undefined) void loadInstances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.id]);

  const instances = result.instances ?? [];
  const marked = instances.filter((i) => result.marks[i.key]).length;
  const setVerdict = (v: Verdict) => onChange((r) => ({ ...r, verdict: v }));
  const setMark = (key: string, v: Verdict) => onChange((r) => ({ ...r, marks: { ...r.marks, [key]: v } }));
  const failures = req.kind === "manual" || instances.length === 0 ? result.failures : [];

  return (
    <article aria-labelledby={`${id}-h`} className="flex max-w-[980px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 id={`${id}-h`} ref={headingRef} tabIndex={-1} className="text-[26px] font-bold" style={{ outline: "none" }}>
          {place && <span className="mr-2 text-slate-500">{place.number} </span>}
          {req.name}
        </h1>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
          WCAG {req.wcag.criterion} ({req.wcag.level}) · {req.kind === "manual" ? "Manual" : "Assisted"}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${status === "pass" ? "bg-emerald-100 text-emerald-900" : status === "fail" ? "bg-red-100 text-red-900" : "bg-slate-100 text-slate-700"}`}>{STATUS_LABEL[status]}</span>
      </div>
      <p className="text-base">{req.description}</p>

      {req.helper && (
        <div className="flex flex-wrap items-center gap-2.5 text-[15px]">
          <span id={`${id}-vh`} className="font-semibold">
            Visual helper
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={helperOn}
            aria-labelledby={`${id}-vh`}
            onClick={() => setHelperOn((v) => !v)}
            className={`relative inline-block h-[22px] w-10 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${helperOn ? "bg-blue-700" : "bg-slate-500"}`}
          >
            <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all ${helperOn ? "right-[3px]" : "left-[3px]"}`} />
          </button>
          <span className="text-slate-700">{helperOn ? `On · ${req.helperNote ?? ""}${req.helper === "focus" ? ` ${stops} stop${stops === 1 ? "" : "s"} recorded.` : ""}` : "Off"}</span>
          {helperOn && (
            <button type="button" onClick={() => void showOnPage(tabId)} className="text-sm font-semibold text-blue-800 underline">
              Go to the page
            </button>
          )}
        </div>
      )}

      <details open className="rounded-xl border border-slate-200 px-4 py-3">
        <summary className="cursor-pointer text-[17px] font-bold">How to test</summary>
        <ol className="mt-2 list-decimal pl-6 text-[15px] leading-relaxed">
          {req.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </details>

      {req.kind === "assisted" && (
        <section aria-labelledby={`${id}-i`} className="overflow-hidden rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h2 id={`${id}-i`} className="text-[17px] font-bold">
              Instances ({instances.length})
            </h2>
            <span className="text-sm text-slate-700" aria-live="polite">
              {loading ? "Reading the page…" : `${marked} marked · ${instances.length - marked} left`}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              <button type="button" onClick={() => void loadInstances()} className={btn}>
                <Icon d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" className="text-blue-700" /> Refresh list
              </button>
              <button
                type="button"
                disabled={instances.length === marked}
                onClick={() => onChange((r) => ({ ...r, marks: Object.fromEntries(instances.map((i) => [i.key, r.marks[i.key] ?? "pass"])) }))}
                className="rounded-lg border border-emerald-700 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-800 disabled:border-slate-300 disabled:text-slate-500"
              >
                Pass unmarked instances
              </button>
            </span>
          </div>
          {listError && (
            <p role="alert" className="px-4 py-3 text-sm text-red-800">
              {listError}
            </p>
          )}
          {instances.length > 0 ? (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full border-collapse text-[15px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-[13px] text-slate-600">
                    <th scope="col" className="px-4 py-2 font-semibold">
                      {req.instances === "images" ? "Image" : req.instances === "headings" ? "Heading" : "Name"}
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      {req.detailLabel}
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      <span className="sr-only">Show on page</span>
                    </th>
                    <th scope="col" className="px-2 py-2 font-semibold">
                      Pass
                    </th>
                    <th scope="col" className="px-2 py-2 font-semibold">
                      Fail
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((inst) => {
                    const mark = result.marks[inst.key];
                    return (
                      <tr key={inst.key} className={`border-t border-slate-200 ${mark === "fail" ? "bg-red-50" : ""}`}>
                        <td className="px-4 py-2 align-top">
                          {inst.text}
                          {mark === "fail" && (
                            <input
                              aria-label={`Why it fails: ${inst.text}`}
                              placeholder="Why it fails (optional)"
                              value={result.notes?.[inst.key] ?? ""}
                              onChange={(e) => onChange((r) => ({ ...r, notes: { ...r.notes, [inst.key]: e.target.value } }))}
                              className="mt-1 block w-full rounded border border-slate-400 px-2 py-1 text-sm"
                            />
                          )}
                        </td>
                        <td className="break-all px-4 py-2 align-top font-mono text-xs text-slate-700">{inst.detail}</td>
                        <td className="px-4 py-2 align-top">
                          <button type="button" onClick={() => void showOnPage(tabId, inst.selector)} className="text-sm font-semibold text-blue-800 underline" aria-label={`Show on page: ${inst.text}`}>
                            Show
                          </button>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input type="radio" name={`${id}-m-${inst.key}`} checked={mark === "pass"} onChange={() => setMark(inst.key, "pass")} aria-label={`Pass: ${inst.text}`} className="h-[18px] w-[18px]" />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input type="radio" name={`${id}-m-${inst.key}`} checked={mark === "fail"} onChange={() => setMark(inst.key, "fail")} aria-label={`Fail: ${inst.text}`} className="h-[18px] w-[18px]" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            !loading && <p className="px-4 py-3 text-[15px] text-slate-700">None found on this page. Record the result below.</p>
          )}
        </section>
      )}

      {(req.kind === "manual" || (!loading && instances.length === 0 && result.instances !== undefined)) && (
        <fieldset className="flex gap-6 text-base">
          <legend className="sr-only">Result</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name={`${id}-v`} checked={result.verdict === "pass"} onChange={() => setVerdict("pass")} className="h-[18px] w-[18px]" /> Pass
          </label>
          <label className={`flex items-center gap-2 ${result.verdict === "fail" ? "font-bold text-red-800" : ""}`}>
            <input type="radio" name={`${id}-v`} checked={result.verdict === "fail"} onChange={() => setVerdict("fail")} className="h-[18px] w-[18px]" /> Fail
          </label>
        </fieldset>
      )}

      {(req.kind === "manual" || instances.length === 0) && (result.verdict === "fail" || failures.length > 0) && (
        <section aria-labelledby={`${id}-f`} className="flex flex-col gap-2.5 rounded-xl border border-red-200 px-4 py-3">
          <h2 id={`${id}-f`} className="text-base font-bold">
            Failure instances ({failures.length})
          </h2>
          {failures.map((f) => (
            <div key={f.id} className="flex flex-wrap items-start gap-3 border-t border-red-100 pt-2.5 first:border-0 first:pt-0">
              {f.screenshot && <img src={f.screenshot} alt="Screenshot of the failing element" className="max-h-20 max-w-[140px] rounded-md border border-slate-200" />}
              <div className="min-w-[240px] flex-1">
                <p className="text-[15px]">{f.description}</p>
                {f.selector && <code className="break-all text-xs text-slate-700">{f.selector}</code>}
              </div>
              <span className="flex gap-3 text-sm">
                <button type="button" onClick={() => setDialog({ open: true, edit: f })} className="font-semibold text-blue-800 underline">
                  Edit
                </button>
                <button type="button" onClick={() => onChange((r) => ({ ...r, failures: r.failures.filter((x) => x.id !== f.id) }))} className="font-semibold text-red-800 underline">
                  Remove
                </button>
              </span>
            </div>
          ))}
          <button type="button" onClick={() => setDialog({ open: true })} className="self-start rounded-lg border border-blue-700 px-3 py-1.5 text-sm font-semibold text-blue-800">
            + Add a failure instance
          </button>
        </section>
      )}

      <nav aria-label="Requirements" className="flex justify-between gap-3">
        {place && place.reqIndex === 0 ? (
          <a href={`#test/${place.test.id}`} className={secondary}>
            ← Getting started
          </a>
        ) : prev ? (
          <a href={`#req/${prev.id}`} className={secondary}>
            ← {prev.name}
          </a>
        ) : (
          <a href="#overview" className={secondary}>
            ← Overview
          </a>
        )}
        {next ? (
          <a href={`#req/${next.id}`} className={primary}>
            Next: {next.name} →
          </a>
        ) : (
          <a href="#overview" className={primary}>
            Back to the overview
          </a>
        )}
      </nav>

      <FailureDialog
        open={dialog.open}
        req={req}
        tabId={tabId}
        initial={dialog.edit}
        onClose={() => setDialog({ open: false })}
        onSave={(f) => {
          onChange((r) => ({
            ...r,
            verdict: req.kind === "manual" || instances.length === 0 ? "fail" : r.verdict,
            failures: r.failures.some((x) => x.id === f.id) ? r.failures.map((x) => (x.id === f.id ? f : x)) : [...r.failures, f],
          }));
          setDialog({ open: false });
        }}
      />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview({ state }: { state: AssessmentState }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const s = summarize(state);
  useEffect(() => headingRef.current?.focus(), []);
  const passDeg = (s.passed / s.total) * 100;
  const failDeg = passDeg + (s.failed / s.total) * 100;
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Progress" className="flex flex-wrap items-center gap-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div
          role="img"
          aria-label={`${s.percent}% complete`}
          className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(#047857 0 ${passDeg}%, #b91c1c ${passDeg}% ${failDeg}%, #e2e8f0 ${failDeg}% 100%)` }}
        >
          <div className="flex h-[86px] w-[86px] flex-col items-center justify-center rounded-full bg-white">
            <span className="text-[26px] font-bold leading-none">{s.percent}%</span>
            <span className="text-xs text-slate-600">
              {s.passed + s.failed} of {s.total}
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-[1_1_260px]">
          <p className="text-[13px] font-bold tracking-wider text-emerald-800">QUICK ASSESS · {s.total} KEY REQUIREMENTS</p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-[26px] font-bold" style={{ outline: "none" }}>
            {state.target.title}
          </h1>
          {s.next ? (
            <a href={`#req/${s.next.id}`} className={`${primary} mt-3`}>
              {s.todo === s.total ? "Start" : "Up next"}: {QUICK_ASSESS.indexOf(s.next) + 1}. {s.next.name} →
            </a>
          ) : (
            <p className="mt-3 text-[15px] font-semibold text-emerald-800">All requirements have a result. Export the report from the top bar.</p>
          )}
        </div>
        <div className="grid flex-[1_1_300px] grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-emerald-50 p-3">
            <div className="text-[13px] font-semibold text-emerald-900">✓ Passed</div>
            <div className="text-[26px] font-bold text-emerald-900">{s.passed}</div>
          </div>
          <div className="rounded-xl bg-red-50 p-3">
            <div className="text-[13px] font-semibold text-red-900">✕ Failed</div>
            <div className="text-[26px] font-bold text-red-900">{s.failed}</div>
          </div>
          <div className="rounded-xl bg-slate-100 p-3">
            <div className="text-[13px] font-semibold text-slate-700">○ To do</div>
            <div className="text-[26px] font-bold">{s.todo}</div>
          </div>
        </div>
      </section>

      <h2 className="text-xl font-bold">Requirements</h2>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {QUICK_ASSESS.map((req, i) => {
          const st = requirementStatus(req, state.results[req.id]);
          const n = failuresOf(req, state.results[req.id]).length;
          const accent = st === "pass" ? "border-l-emerald-700" : st === "fail" ? "border-l-red-700" : "border-l-slate-300";
          return (
            <li key={req.id}>
              <a href={`#req/${req.id}`} className={`flex items-center gap-3 rounded-xl border border-l-4 border-slate-200 bg-white px-3.5 py-3 text-slate-900 no-underline hover:bg-slate-50 ${accent}`}>
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[15px] font-bold text-indigo-800">{i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-base font-bold">{req.name}</span>
                  <span className="flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-full border border-slate-300 px-2 text-slate-700">{req.kind === "manual" ? "Manual" : "Assisted"}</span>
                    <span className="text-slate-600">
                      {req.test} · WCAG {req.wcag.criterion}
                    </span>
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${st === "pass" ? "bg-emerald-100 text-emerald-900" : st === "fail" ? "bg-red-100 text-red-900" : "bg-slate-100 text-slate-700"}`}>
                  {STATUS_LABEL[st]}
                  {st === "fail" && n ? ` (${n})` : ""}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function AssessmentApp() {
  const tabId = Number(new URLSearchParams(location.search).get("tabId"));
  const [state, setState] = useState<AssessmentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(readRoute);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        if (!Number.isInteger(tabId)) throw new Error("no tab");
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url || !/^https?:|^file:/.test(tab.url)) throw new Error("not a web page");
        const key = storageKey(tab.url, KIND);
        const stored = (await chrome.storage.local.get(key))[key] as AssessmentState | undefined;
        setState(stored ?? newAssessment(tab.url, tab.title || tab.url, undefined, KIND));
      } catch {
        setError("The page this assessment was opened for is closed or is not a web page. Open Manual testing from the side panel on the page you want to assess.");
      }
    })();
  }, [tabId]);

  useEffect(() => {
    if (state) document.title = `${ASSESSMENT_NAME[KIND]}: ${state.target.title}`;
  }, [state?.target.title]);

  const update = useCallback((fn: (s: AssessmentState) => AssessmentState) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...fn(prev), updatedAt: new Date().toISOString() };
      void chrome.storage.local.set({ [storageKey(next.target.url, next.kind)]: next });
      return next;
    });
  }, []);

  const changeResult = useCallback(
    (reqId: string) => (fn: (r: RequirementResult) => RequirementResult) => update((s) => ({ ...s, results: { ...s.results, [reqId]: fn(s.results[reqId] ?? emptyResult()) } })),
    [update],
  );

  const load = async (file: File) => {
    try {
      let loaded = parseAssessment(await file.text());
      if (!state) return;
      if (loaded.kind !== KIND) {
        // A Quick Assess file loads into a Full Assessment (shared requirements); not the other way.
        if (loaded.kind === "full") throw new Error("This file is a Full Assessment. Open Full Assessment from the side panel to load it.");
        loaded = moveToFull(loaded, state);
      }
      if (loaded.target.url !== state.target.url && !window.confirm(`This file is an assessment of ${loaded.target.url}. Load its results for this page (${state.target.url})?`)) return;
      update(() => ({ ...loaded, kind: KIND, target: state.target }));
      setNotice(`Loaded ${file.name}.`);
      go({ view: "overview" });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  if (error)
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-bold">{ASSESSMENT_NAME[KIND]}</h1>
        <p role="alert" className="mt-3 text-base">
          {error}
        </p>
      </main>
    );
  if (!state)
    return (
      <main className="p-8">
        <p role="status">Loading…</p>
      </main>
    );

  const s = summarize(state);
  const current = route.view === "req" ? REQS.findIndex((r) => r.id === route.id) : -1;
  const test = route.view === "test" ? FULL_TESTS.find((t) => t.id === route.id) : undefined;

  /** Quick Assess -> Full Assessment of the same page, carrying over the shared requirements. */
  const moveToFullAssessment = async () => {
    const key = storageKey(state.target.url, "full");
    const existing = (await chrome.storage.local.get(key))[key] as AssessmentState | undefined;
    await chrome.storage.local.set({ [key]: moveToFull(state, existing) });
    location.href = `${location.pathname}?tabId=${tabId}&kind=full#overview`;
  };

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <div className={`h-1 ${KIND === "full" ? "bg-blue-700" : "bg-emerald-700"}`} />
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-slate-200 px-5 py-2.5">
        <span className="flex items-center gap-2 text-[15px] font-bold">
          <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-700">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#ffffff" strokeWidth="1.6">
              <circle cx="8" cy="3.2" r="1.4" />
              <path d="M3 6h10M8 6v4M5.5 14 8 10l2.5 4" />
            </svg>
          </span>
          PalTech A11y Inspector
        </span>
        <span className="text-sm text-slate-700">
          Target page:{" "}
          <button type="button" onClick={() => void showOnPage(tabId)} className="font-semibold text-blue-800 underline">
            {state.target.title}
          </button>
        </span>
        <nav aria-label="Assessment actions" className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setExporting(true)} className={btn}>
            <Icon d="M2 8h10M9 5l3 3-3 3" className="text-blue-700" /> Export result
          </button>
          {KIND === "quick" && (
            <button type="button" onClick={() => void moveToFullAssessment()} className={btn}>
              <Icon d="M3 8h10M10 5l3 3-3 3M3 3v10" className="text-blue-700" /> Move to Full Assessment
            </button>
          )}
          <button type="button" onClick={() => download(`${fileStem(state)}.json`, "application/json", JSON.stringify(state))} className={btn}>
            <Icon d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" className="text-blue-700" /> Download
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className={btn}>
            <Icon d="M2 4.5h4l1.5 1.5H14v7H2z" className="text-blue-700" /> Load
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
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Start over? Every result of this assessment is removed.")) {
                update((prev) => newAssessment(prev.target.url, prev.target.title, undefined, KIND));
                go({ view: "overview" });
              }
            }}
            className={`${btn} border border-slate-400`}
          >
            <Icon d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" className="text-blue-700" /> Start over
          </button>
        </nav>
      </header>
      {notice && (
        <p role="status" className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-5 py-2 text-sm">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="ml-auto font-semibold text-blue-800 underline">
            Dismiss
          </button>
        </p>
      )}

      <div className="flex flex-1 flex-wrap">
        {KIND === "full" ? (
          <FullNav state={state} route={route} />
        ) : (
          <nav aria-label="Quick Assess" className="max-w-[280px] flex-[1_1_250px] border-r border-slate-200 bg-slate-50 py-3">
            <p className="mx-3 mb-2.5 flex items-center gap-2 rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm font-semibold">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-emerald-700" />
              Quick Assess
            </p>
            <a
              href="#overview"
              aria-current={route.view === "overview" ? "page" : undefined}
              className={`flex items-center gap-2.5 px-4 py-2 text-slate-900 no-underline ${route.view === "overview" ? "border-l-4 border-blue-700 bg-blue-100 pl-3" : ""}`}
            >
              <Icon d="M2 7.5 8 2.5l6 5V14H2z" className="text-blue-700" />
              <span className="flex flex-col">
                <span className="text-[15px] font-bold">Overview</span>
                <span className="text-xs text-slate-700">{s.percent}% completed</span>
              </span>
            </a>
            <ol className="mt-1">
              {QUICK_ASSESS.map((req, i) => {
                const st = requirementStatus(req, state.results[req.id]);
                const active = i === current;
                return (
                  <li key={req.id}>
                    <a
                      href={`#req/${req.id}`}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 px-4 py-2 text-sm text-slate-900 no-underline hover:bg-slate-100 ${active ? "border-l-4 border-blue-700 bg-blue-100 pl-3 font-bold" : ""}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] ${active ? "bg-blue-700 text-white" : "border-[1.5px] border-slate-500 text-slate-700"}`}
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1">{req.name}</span>
                      <StatusIcon status={st} />
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        <main className="min-w-0 flex-[999_1_560px] bg-slate-50 px-7 py-6">
          {test ? (
            <TestView key={test.id} test={test} state={state} />
          ) : route.view === "req" && current >= 0 ? (
            <RequirementView
              key={REQS[current].id}
              req={REQS[current]}
              index={current}
              tabId={tabId}
              result={resultOf(state, REQS[current].id)}
              status={requirementStatus(REQS[current], state.results[REQS[current].id])}
              onChange={changeResult(REQS[current].id)}
            />
          ) : KIND === "full" ? (
            <FullOverview state={state} />
          ) : (
            <Overview state={state} />
          )}
        </main>
      </div>

      <ExportDialog open={exporting} state={state} onClose={() => setExporting(false)} />
    </div>
  );
}

/** For tests and the side panel: the assessment saved for a page, if any. */
export async function savedAssessment(url: string, kind: AssessmentKind = "quick"): Promise<AssessmentState | undefined> {
  const key = storageKey(pageKey(url), kind);
  return (await chrome.storage.local.get(key))[key] as AssessmentState | undefined;
}
