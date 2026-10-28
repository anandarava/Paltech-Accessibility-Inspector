/**
 * Manual assessment (Quick Assess): the requirements a tester checks by hand, the saved state of
 * one assessment of one page, and the report built from it. Pure data and functions, shared by
 * the assessment tab, the side panel and the tests.
 *
 * A requirement is either
 *  - "manual": the tester follows the steps and records Pass or Fail, adding failure instances;
 *  - "assisted": PalTech lists the instances on the page (links, images, headings, form fields,
 *    controls) and the tester marks each one; the requirement fails when any instance fails.
 */

import { FULL_REQUIREMENTS, FULL_TESTS, QUICK_REQUIREMENTS, locate, type AssessmentTest } from "./assessment-catalogue";

export type RequirementKind = "manual" | "assisted";
export type InstanceKind = "links" | "images" | "headings" | "fields" | "controls";
/** What the visual helper draws on the tested page. */
export type HelperKind = "focus" | "headings" | "landmarks" | "instances";
export type Verdict = "pass" | "fail";
export type RequirementStatus = "pass" | "fail" | "todo";

export interface Requirement {
  id: string;
  name: string;
  /** The test it belongs to (Keyboard, Links …). */
  test: string;
  wcag: { criterion: string; name: string; level: "A" | "AA" };
  kind: RequirementKind;
  description: string;
  steps: string[];
  helper?: HelperKind;
  /** What the helper says when it is on. */
  helperNote?: string;
  instances?: InstanceKind;
  /** Column heading for an instance's detail (alt text, href, level …). */
  detailLabel?: string;
  /** How to fix a failure, for the report. */
  fix: string;
}

export type AssessmentKind = "quick" | "full";

/** Quick Assess: 10 key requirements. */
export const QUICK_ASSESS: Requirement[] = QUICK_REQUIREMENTS;
export { FULL_TESTS, FULL_REQUIREMENTS, locate, type AssessmentTest };

export function requirementsFor(kind: AssessmentKind): Requirement[] {
  return kind === "full" ? FULL_REQUIREMENTS : QUICK_REQUIREMENTS;
}

export const ASSESSMENT_NAME: Record<AssessmentKind, string> = { quick: "Quick Assess", full: "Full Assessment" };

/** An element listed for an assisted requirement. */
export interface Instance {
  /** Stable within a page: selector plus visible text. */
  key: string;
  selector: string;
  /** Its accessible name or text. */
  text: string;
  /** Requirement-specific detail: href, alt text, heading level, label, control type. */
  detail: string;
  html: string;
}

export interface Failure {
  id: string;
  description: string;
  selector?: string;
  html?: string;
  /** PNG data URL. */
  screenshot?: string;
}

export interface RequirementResult {
  /** Manual requirements, and assisted ones with no instances on the page. */
  verdict?: Verdict;
  failures: Failure[];
  /** Assisted requirements: each instance's mark, by instance key. */
  marks: Record<string, Verdict>;
  /** Assisted requirements: the instances last listed from the page. */
  instances?: Instance[];
  /** Why each marked-failed instance fails, by instance key (optional). */
  notes?: Record<string, string>;
}

export interface AssessmentState {
  version: 1;
  kind: AssessmentKind;
  target: { url: string; title: string };
  startedAt: string;
  updatedAt: string;
  results: Record<string, RequirementResult>;
}

export const ASSESSMENT_KEY_PREFIX = "assessment:";

/** The page an assessment belongs to: the address without its #fragment. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

export function storageKey(url: string, kind: AssessmentKind = "quick"): string {
  return `${ASSESSMENT_KEY_PREFIX}${kind}:${pageKey(url)}`;
}

export function newAssessment(url: string, title: string, now: Date = new Date(), kind: AssessmentKind = "quick"): AssessmentState {
  return { version: 1, kind, target: { url: pageKey(url), title }, startedAt: now.toISOString(), updatedAt: now.toISOString(), results: {} };
}

/**
 * Move Quick Assess results into a Full Assessment of the same page: requirements the two share
 * (same ids) take the Quick Assess result unless the Full Assessment already has one.
 */
export function moveToFull(quick: AssessmentState, full?: AssessmentState, now: Date = new Date()): AssessmentState {
  const base = full ?? newAssessment(quick.target.url, quick.target.title, now, "full");
  const results = { ...base.results };
  for (const [id, r] of Object.entries(quick.results)) {
    if (!results[id] && FULL_REQUIREMENTS.some((x) => x.id === id)) results[id] = r;
  }
  return { ...base, results, updatedAt: now.toISOString() };
}

export function emptyResult(): RequirementResult {
  return { failures: [], marks: {} };
}

export function resultOf(state: AssessmentState, id: string): RequirementResult {
  return state.results[id] ?? emptyResult();
}

/** Pass, Fail or still to do. Assisted: any failed instance fails it; all marked passed passes it. */
export function requirementStatus(req: Requirement, result: RequirementResult | undefined): RequirementStatus {
  if (!result) return "todo";
  if (req.kind === "manual") return result.verdict ?? "todo";
  const instances = result.instances;
  if (!instances || instances.length === 0) return result.verdict ?? "todo";
  let marked = 0;
  for (const i of instances) {
    const m = result.marks[i.key];
    if (m === "fail") return "fail";
    if (m === "pass") marked++;
  }
  return marked === instances.length ? "pass" : "todo";
}

export interface AssessmentSummary {
  total: number;
  passed: number;
  failed: number;
  todo: number;
  /** Percentage of requirements with a result. */
  percent: number;
  /** The first requirement still to do, if any. */
  next?: Requirement;
}

export function summarize(state: AssessmentState, requirements: Requirement[] = requirementsFor(state.kind)): AssessmentSummary {
  let passed = 0;
  let failed = 0;
  let next: Requirement | undefined;
  for (const req of requirements) {
    const s = requirementStatus(req, state.results[req.id]);
    if (s === "pass") passed++;
    else if (s === "fail") failed++;
    else next ??= req;
  }
  const total = requirements.length;
  const done = passed + failed;
  return { total, passed, failed, todo: total - done, percent: total ? Math.round((done / total) * 100) : 0, next };
}

/** Assisted requirement: failed instances, as failures for the report. */
export function failuresOf(req: Requirement, result: RequirementResult | undefined): Failure[] {
  if (!result) return [];
  if (req.kind === "manual" || !result.instances?.length) return result.failures;
  const failed = result.instances
    .filter((i) => result.marks[i.key] === "fail")
    .map((i) => ({
      id: i.key,
      description: result.notes?.[i.key] || `${i.text || "(no name)"}${i.detail ? ` · ${i.detail}` : ""}`,
      selector: i.selector,
      html: i.html,
    }));
  return [...failed, ...result.failures];
}

/** Instance key from its selector and text, stable across reloads of an unchanged page. */
export function instanceKey(selector: string, text: string): string {
  let h = 0;
  const s = `${selector}|${text}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}`;
}

/** A loaded file, checked: returns the state or throws with a reason. */
export function parseAssessment(text: string): AssessmentState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not a PalTech assessment (it is not JSON).");
  }
  const o = data as Partial<AssessmentState> | null;
  if (!o || o.version !== 1 || (o.kind !== "quick" && o.kind !== "full") || typeof o.target?.url !== "string" || typeof o.results !== "object" || o.results === null) {
    throw new Error("The file is not a PalTech Quick Assess or Full Assessment file.");
  }
  const kind: AssessmentKind = o.kind;
  const results: Record<string, RequirementResult> = {};
  for (const req of requirementsFor(kind)) {
    const r = (o.results as Record<string, Partial<RequirementResult>>)[req.id];
    if (!r || typeof r !== "object") continue;
    results[req.id] = {
      verdict: r.verdict === "pass" || r.verdict === "fail" ? r.verdict : undefined,
      failures: Array.isArray(r.failures) ? r.failures.filter((f) => f && typeof f.description === "string") : [],
      marks: r.marks && typeof r.marks === "object" ? Object.fromEntries(Object.entries(r.marks).filter(([, v]) => v === "pass" || v === "fail")) : {},
      instances: Array.isArray(r.instances) ? r.instances.filter((i) => i && typeof i.key === "string") : undefined,
      notes: r.notes && typeof r.notes === "object" ? r.notes : undefined,
    };
  }
  return {
    version: 1,
    kind,
    target: { url: pageKey(o.target.url), title: typeof o.target.title === "string" ? o.target.title : o.target.url },
    startedAt: typeof o.startedAt === "string" ? o.startedAt : new Date().toISOString(),
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
    results,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}


export interface ReportOptions {
  description?: string;
  screenshots?: boolean;
  /** Add the appendix: conformance per WCAG success criterion (ACR / VPAT style). Default true. */
  criteriaTable?: boolean;
  /** Who prepared the report, shown in the header. */
  preparedBy?: string;
  now?: Date;
}

const PRINCIPLES: Record<string, string> = { "1": "Perceivable", "2": "Operable", "3": "Understandable", "4": "Robust" };

/** Impact of a failure for ordering and labelling: Level A barriers first. */
function impactOf(req: Requirement): "High" | "Medium" {
  return req.wcag.level === "A" ? "High" : "Medium";
}

export type Conformance = "Supports" | "Partially supports" | "Does not support" | "Not evaluated";

/** Conformance per WCAG success criterion, from the requirements that test it. */
export function criteriaConformance(state: AssessmentState): Array<{ criterion: string; name: string; level: string; conformance: Conformance; remarks: string[] }> {
  const by = new Map<string, { name: string; level: string; statuses: RequirementStatus[]; remarks: string[] }>();
  for (const req of requirementsFor(state.kind)) {
    const c = by.get(req.wcag.criterion) ?? { name: req.wcag.name, level: req.wcag.level, statuses: [], remarks: [] };
    const st = requirementStatus(req, state.results[req.id]);
    c.statuses.push(st);
    if (st === "fail") {
      const all = failuresOf(req, state.results[req.id]);
      const more = all.length > 1 ? ` (+${all.length - 1} more)` : "";
      c.remarks.push(`${req.name}${all[0] ? `: ${all[0].description}${more}` : ""}`);
    }
    by.set(req.wcag.criterion, c);
  }
  const num = (c: string) => c.split(".").map((n) => n.padStart(3, "0")).join(".");
  return [...by.entries()]
    .sort(([a], [b]) => num(a).localeCompare(num(b)))
    .map(([criterion, c]) => {
      const pass = c.statuses.filter((s) => s === "pass").length;
      const fail = c.statuses.filter((s) => s === "fail").length;
      const conformance: Conformance = fail ? (pass ? "Partially supports" : "Does not support") : pass ? "Supports" : "Not evaluated";
      return { criterion, name: c.name, level: c.level, conformance, remarks: c.remarks };
    });
}

/**
 * The HTML report, three parts:
 *  1. Summary (for managers and clients): verdict, numbers, results by WCAG principle, the top issues.
 *  2. Issues (for developers): one card per failing instance with element, screenshot and fix; filter
 *     by impact and copy all as CSV.
 *  3. Appendix (optional, for compliance): conformance per WCAG success criterion.
 */
export function buildAssessmentHtml(state: AssessmentState, options: ReportOptions = {}): string {
  const reqs = requirementsFor(state.kind);
  const name = ASSESSMENT_NAME[state.kind];
  const s = summarize(state);
  const date = (options.now ?? new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const shots = options.screenshots !== false;
  const scope = state.kind === "full" ? `${name} · ${FULL_TESTS.length} tests · ${reqs.length} requirements · WCAG 2.2 AA` : `${name} · ${reqs.length} key requirements · WCAG 2.2`;

  // ---- issues: every failing instance (a failed requirement without instances is one issue) ----
  interface Item { id: string; req: Requirement; impact: "High" | "Medium"; failure?: Failure; test: string }
  const failed = reqs.filter((r) => requirementStatus(r, state.results[r.id]) === "fail");
  const items: Item[] = [];
  const ordered = [...failed].sort((a, b) => (impactOf(a) === impactOf(b) ? 0 : impactOf(a) === "High" ? -1 : 1));
  for (const req of ordered) {
    const fs = failuresOf(req, state.results[req.id]);
    const test = state.kind === "full" ? (locate(req.id)?.test.name ?? req.test) : req.test;
    if (fs.length === 0) items.push({ id: "", req, impact: impactOf(req), test });
    for (const f of fs) items.push({ id: "", req, impact: impactOf(req), failure: f, test });
  }
  items.forEach((it, i) => (it.id = `A11Y-${String(i + 1).padStart(3, "0")}`));
  const high = items.filter((i) => i.impact === "High").length;

  const verdict = s.failed > 0 ? `Does not conform · ${s.failed} failure${s.failed === 1 ? "" : "s"}` : s.todo > 0 ? `Incomplete · ${s.todo} not tested` : "No failures found";
  const verdictClass = s.failed > 0 ? "bad" : s.todo > 0 ? "todo" : "good";
  const passPct = Math.round((s.passed / s.total) * 100);
  const failPct = Math.round((s.failed / s.total) * 100);

  // ---- 1. summary ----
  const principles = Object.entries(PRINCIPLES)
    .map(([d, label]) => {
      const rs = reqs.filter((r) => r.wcag.criterion.startsWith(`${d}.`));
      if (!rs.length) return "";
      const st = rs.map((r) => requirementStatus(r, state.results[r.id]));
      const p = st.filter((x) => x === "pass").length;
      const f = st.filter((x) => x === "fail").length;
      return `<div class="pr"><span class="pr-name">${label}</span><span class="bar" role="img" aria-label="${label}: ${p} passed, ${f} failed, ${rs.length - p - f} not tested"><span class="b-pass" style="width:${(p / rs.length) * 100}%"></span><span class="b-fail" style="width:${(f / rs.length) * 100}%"></span></span><span class="pr-num">${p} passed · ${f} failed</span></div>`;
    })
    .join("");
  const top = items
    .filter((it, i, all) => all.findIndex((x) => x.req.id === it.req.id) === i)
    .slice(0, 5)
    .map(
      (it, i) =>
        `<li><span class="num">${i + 1}</span><span class="top-text"><strong>${esc(it.failure?.description ?? it.req.name)}</strong><span>${esc(it.req.name)} · ${esc(it.test)}</span></span><span class="imp ${it.impact.toLowerCase()}">${it.impact}</span><span class="sc">WCAG ${esc(it.req.wcag.criterion)}</span></li>`,
    )
    .join("");

  // ---- 2. issue cards ----
  const cards = items
    .map((it) => {
      const f = it.failure;
      const shot = shots && f?.screenshot ? `<img src="${esc(f.screenshot)}" alt="Screenshot of the failing element">` : `<div class="noshot">No screenshot</div>`;
      return `<li class="card" data-impact="${it.impact.toLowerCase()}"><div class="card-head"><span class="iid">${it.id}</span><span class="title">${esc(f?.description ?? `${it.req.name}: marked as failing`)}</span><span class="imp ${it.impact.toLowerCase()}">${it.impact}</span><span class="chip wcag">WCAG ${esc(it.req.wcag.criterion)}</span><span class="chip">${esc(it.test)}</span></div><div class="card-body">${shot}<dl><dt>Requirement</dt><dd>${esc(it.req.name)} (${esc(it.req.wcag.criterion)} ${esc(it.req.wcag.name)}, Level ${it.req.wcag.level})</dd>${
        f?.selector ? `<dt>Element</dt><dd><code>${esc(f.selector)}</code></dd>` : ""
      }<dt>Expected</dt><dd>${esc(it.req.description)}</dd><dt>How to fix</dt><dd>${esc(it.req.fix)}</dd></dl></div></li>`;
    })
    .join("");
  const csv = [["ID", "Issue", "Impact", "WCAG", "Requirement", "Test", "Element", "How to fix"]]
    .concat(items.map((it) => [it.id, it.failure?.description ?? `${it.req.name}: marked as failing`, it.impact, it.req.wcag.criterion, it.req.name, it.test, it.failure?.selector ?? "", it.req.fix]))
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  // ---- 3. appendix ----
  const conf = criteriaConformance(state);
  const confClass: Record<Conformance, string> = { Supports: "c-s", "Partially supports": "c-p", "Does not support": "c-d", "Not evaluated": "c-n" };
  const appendix =
    options.criteriaTable === false
      ? ""
      : `<section class="sheet" aria-labelledby="h-app"><h2 id="h-app">Appendix: conformance by WCAG success criterion</h2><p class="muted">From the ${name} results: <em>Supports</em> (every requirement passed), <em>Partially supports</em> (some failed), <em>Does not support</em> (all tested failed), <em>Not evaluated</em> (not tested).</p><table><thead><tr><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">Conformance</th><th scope="col">Remarks</th></tr></thead><tbody>${conf
          .map((c) => `<tr><td><strong>${esc(c.criterion)}</strong> ${esc(c.name)}</td><td>${esc(c.level)}</td><td><span class="conf ${confClass[c.conformance]}">${c.conformance}</span></td><td>${esc(c.remarks.join("; "))}</td></tr>`)
          .join("")}</tbody></table></section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}: ${esc(state.target.title)}</title><style>
:root{color-scheme:light}*{box-sizing:border-box}
body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;background:#f1f5f9}
main{max-width:1060px;margin:0 auto;padding:28px 16px;display:flex;flex-direction:column;gap:18px}
.sheet{background:#fff;border-radius:16px;padding:22px 26px;box-shadow:0 1px 3px rgba(15,23,42,.08)}
h1{margin:2px 0 0;font-size:28px}h2{margin:0 0 10px;font-size:20px}.muted{color:#475569;font-size:14px;margin:0 0 12px}
.head{display:flex;flex-wrap:wrap;align-items:center;gap:14px}.head-text{flex:1;min-width:240px}.eyebrow{margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;color:#475569;text-transform:uppercase}.nw{white-space:nowrap}
.head p{margin:2px 0 0;color:#475569;font-size:14px}.verdict{padding:8px 14px;border-radius:999px;font-weight:700}.verdict.bad{background:#fee2e2;color:#991b1b}.verdict.todo{background:#fef3c7;color:#78350f}.verdict.good{background:#dcfce7;color:#14532d}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.kpi{background:#fff;border-radius:16px;padding:18px 20px;box-shadow:0 1px 3px rgba(15,23,42,.08)}.kpi b{display:block;font-size:40px;line-height:1.1}.kpi span{font-size:13px;color:#475569}
.ring{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}.donut{width:112px;height:112px;border-radius:50%;display:flex;align-items:center;justify-content:center}.donut>div{width:86px;height:86px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center}.donut b{font-size:28px;line-height:1}
.k-pass{color:#065f46}.k-fail{color:#991b1b}
.pr{display:grid;grid-template-columns:150px 1fr 170px;align-items:center;gap:14px;margin:10px 0}.pr-name{font-weight:600}.bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:#e2e8f0}.b-pass{background:#047857}.b-fail{background:#b91c1c}.pr-num{font-size:14px;color:#334155}
ol.top{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}ol.top li{display:flex;align-items:flex-start;gap:14px;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px}
.num{flex:none;width:28px;height:28px;border-radius:50%;background:#0f172a;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:14px}.top-text{flex:1;display:flex;flex-direction:column}.top-text span{font-size:14px;color:#334155}
.imp{flex:none;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}.imp.high{background:#fee2e2;color:#991b1b}.imp.medium{background:#fef3c7;color:#78350f}.sc{flex:none;font-size:13px;color:#475569}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.two .sheet p{margin:0}
.tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:14px}.tools button{font:inherit;font-size:13px;font-weight:600;padding:6px 12px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer}.tools button[aria-pressed=true]{background:#0f172a;color:#fff;border-color:#0f172a}.tools .copy{margin-left:auto;border-radius:8px;border-color:#94a3b8}
ol.cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}.card{border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;break-inside:avoid}
.card-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 18px;background:#f8fafc;border-bottom:1px solid #e2e8f0}.iid{font:13px ui-monospace,Consolas,monospace;color:#475569}.title{flex:1;min-width:220px;font-size:16px;font-weight:700}
.chip{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:#f1f5f9;color:#334155}.chip.wcag{background:#eef2ff;color:#3730a3;font-weight:700}
.card-body{display:grid;grid-template-columns:200px 1fr;gap:16px;padding:14px 18px}.card-body img{max-width:200px;max-height:150px;border:1px solid #e2e8f0;border-radius:8px}.noshot{height:90px;border-radius:8px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:13px;color:#475569}
dl{margin:0;display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:14px}dt{font-weight:700}dd{margin:0}code{font:12px ui-monospace,Consolas,monospace;background:#f1f5f9;padding:2px 6px;border-radius:4px;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px 6px;border-bottom:1px solid #e2e8f0}thead th{border-bottom:2px solid #0f172a}
.conf{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:600;white-space:nowrap}.c-s{background:#dcfce7;color:#14532d}.c-p{background:#fef3c7;color:#78350f}.c-d{background:#fee2e2;color:#7f1d1d}.c-n{background:#f1f5f9;color:#334155}
footer{text-align:center;font-size:12px;color:#475569}
@media (max-width:720px){.kpis,.two{grid-template-columns:repeat(2,minmax(0,1fr))}.pr{grid-template-columns:1fr}.card-body{grid-template-columns:1fr}}
@media print{body{background:#fff}.sheet,.kpi{box-shadow:none;border:1px solid #e2e8f0}.tools{display:none}#issues,.appendix-break{break-before:page}}
</style></head><body><main>
<header class="sheet head"><div class="head-text"><p class="eyebrow">${["Accessibility assessment", ...scope.split(" · ")].map((part) => `<span class="nw">${esc(part)}</span>`).join(" · ")}</p><h1>${esc(state.target.title)}</h1><p>${esc(state.target.url)} · ${esc(date)}${options.preparedBy ? ` · Assessed by ${esc(options.preparedBy)}` : ""}${options.description ? ` · ${esc(options.description)}` : ""}</p></div><span class="verdict ${verdictClass}">${esc(verdict)}</span></header>
<section class="kpis" aria-label="Results at a glance"><div class="kpi ring"><div class="donut" role="img" aria-label="${passPct}% of requirements passed" style="background:conic-gradient(#047857 0 ${passPct}%,#b91c1c ${passPct}% ${passPct + failPct}%,#cbd5e1 ${passPct + failPct}% 100%)"><div><b>${passPct}%</b><span>passed</span></div></div><span>of ${s.total} requirements</span></div><div class="kpi"><span class="k-pass">✓ Passed</span><b class="k-pass">${s.passed}</b><span>requirements met</span></div><div class="kpi"><span class="k-fail">✕ Failed</span><b class="k-fail">${s.failed}</b><span>${items.length} issue${items.length === 1 ? "" : "s"} recorded</span></div><div class="kpi"><span>○ Not tested</span><b>${s.todo}</b><span>no result recorded</span></div></section>
<section class="sheet" aria-labelledby="h-pr"><h2 id="h-pr">By WCAG principle</h2>${principles}</section>
${
  top
    ? `<section class="sheet" aria-labelledby="h-top"><h2 id="h-top">Top issues to fix first</h2><p class="muted">Level A barriers first; each is detailed in the issue list below.</p><ol class="top">${top}</ol></section>`
    : `<section class="sheet"><h2>No failures recorded</h2><p class="muted">${s.todo ? `${s.todo} requirement${s.todo === 1 ? " is" : "s are"} still to be tested.` : "Every requirement passed."}</p></section>`
}
<div class="two"><section class="sheet"><h2>What was tested</h2><p>${esc(scope)}, by hand, on ${esc(state.target.url)}. ${s.todo ? `${s.todo} requirement${s.todo === 1 ? " was" : "s were"} not tested (for example, the page has no such content).` : "Every requirement has a result."}</p></section><section class="sheet"><h2>Next steps</h2><p>${
    items.length ? `Fix the ${Math.min(5, failed.length)} top issue${Math.min(5, failed.length) === 1 ? "" : "s"} above, then the rest of the ${items.length} in the list, and re-test the ${s.failed} failed requirement${s.failed === 1 ? "" : "s"}. Run PalTech's automated scan too.` : "Run PalTech's automated scan too, and repeat this assessment after significant changes."
  }</p></section></div>
${
  items.length
    ? `<section class="sheet" id="issues" aria-labelledby="h-iss"><h2 id="h-iss">Issues to fix (${items.length})</h2><div class="tools" role="group" aria-label="Show issues"><button type="button" aria-pressed="true" data-f="all">All ${items.length}</button><button type="button" aria-pressed="false" data-f="high">High ${high}</button><button type="button" aria-pressed="false" data-f="medium">Medium ${items.length - high}</button><button type="button" class="copy" id="copy">Copy all as CSV</button><span id="copied" role="status" class="muted" style="margin:0"></span></div><ol class="cards">${cards}</ol></section>`
    : ""
}
${appendix ? appendix.replace('<section class="sheet"', '<section class="sheet appendix-break"') : ""}
<footer>PalTech Accessibility Testing · ${esc(name)} report · a manual assessment, not a certification of conformance</footer>
</main><script>
(function(){var b=[].slice.call(document.querySelectorAll('.tools [data-f]'));b.forEach(function(x){x.addEventListener('click',function(){b.forEach(function(y){y.setAttribute('aria-pressed',String(y===x))});var f=x.getAttribute('data-f');[].forEach.call(document.querySelectorAll('.card'),function(c){c.hidden=f!=='all'&&c.getAttribute('data-impact')!==f})})});
var c=document.getElementById('copy');if(c)c.addEventListener('click',function(){var t=${JSON.stringify(csv).replace(/</g, "\\u003c")};var done=function(){document.getElementById('copied').textContent='Copied '+${items.length}+' issues.'};if(navigator.clipboard)navigator.clipboard.writeText(t).then(done,function(){prompt('Copy the issues:',t)});else prompt('Copy the issues:',t)})})();
</script></body></html>`;
}

/** The JSON export: each requirement's result, and the same grouped by WCAG success criterion. */
export function buildAssessmentJson(state: AssessmentState, options: ReportOptions = {}): string {
  const requirements = requirementsFor(state.kind).map((req) => ({
    id: req.id,
    name: req.name,
    test: req.test,
    wcag: req.wcag,
    status: requirementStatus(req, state.results[req.id]),
    failures: failuresOf(req, state.results[req.id]).map((f) => ({
      description: f.description,
      selector: f.selector,
      ...(options.screenshots === false || !f.screenshot ? {} : { screenshot: f.screenshot }),
    })),
  }));
  const byCriterion: Record<string, { name: string; level: string; status: RequirementStatus; requirements: string[] }> = {};
  for (const r of requirements) {
    const c = (byCriterion[r.wcag.criterion] ??= { name: r.wcag.name, level: r.wcag.level, status: "pass", requirements: [] });
    c.requirements.push(r.id);
    if (r.status === "fail") c.status = "fail";
    else if (r.status === "todo" && c.status === "pass") c.status = "todo";
  }
  return JSON.stringify(
    { tool: "PalTech Accessibility Testing", kind: state.kind === "full" ? "full-assessment" : "quick-assess", target: state.target, description: options.description || undefined, exportedAt: (options.now ?? new Date()).toISOString(), summary: summarize(state), requirements, byCriterion },
    (k, v) => (k === "next" ? v?.id : v),
    2,
  );
}
