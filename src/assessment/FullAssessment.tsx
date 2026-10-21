/**
 * Full Assessment views: the left navigation (23 tests, the current one opened as a dropdown of
 * Getting started and its numbered checks), the Overview (progress, filters, a card per test) and
 * a test's Getting started page.
 */
import { useEffect, useRef, useState } from "react";
import {
  FULL_REQUIREMENTS,
  FULL_TESTS,
  failuresOf,
  locate,
  requirementStatus,
  summarize,
  type AssessmentState,
  type AssessmentTest,
  type RequirementStatus,
} from "@shared/assessment";

export type TestStatus = "passed" | "failed" | "in-progress" | "not-started";

export function testStatus(test: AssessmentTest, state: AssessmentState): { status: TestStatus; done: number; failed: number; statuses: RequirementStatus[] } {
  const statuses = test.requirements.map((r) => requirementStatus(r, state.results[r.id]));
  const failed = statuses.filter((s) => s === "fail").length;
  const done = statuses.filter((s) => s !== "todo").length;
  const status: TestStatus = failed ? "failed" : done === statuses.length ? "passed" : done ? "in-progress" : "not-started";
  return { status, done, failed, statuses };
}

const TEST_LABEL: Record<TestStatus, string> = { passed: "Passed", failed: "Failed", "in-progress": "In progress", "not-started": "Not started" };
const TEST_CHIP: Record<TestStatus, string> = {
  passed: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-900",
  "in-progress": "bg-blue-100 text-blue-900",
  "not-started": "bg-slate-100 text-slate-700",
};

function ReqMark({ status }: { status: RequirementStatus }) {
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
  return <span role="img" aria-label="Incomplete" className="inline-block h-4 w-4 shrink-0 rounded-full border-[1.5px] border-slate-500" />;
}

/** The test the current view belongs to: the test page itself, or the test of the open requirement. */
export function currentTestId(route: { view: string; id?: string }): string | undefined {
  if (route.view === "test") return route.id;
  if (route.view === "req" && route.id) return locate(route.id)?.test.id;
  return undefined;
}

export function FullNav({ state, route }: { state: AssessmentState; route: { view: string; id?: string } }) {
  const openTest = currentTestId(route);
  const s = summarize(state);
  return (
    <nav aria-label="Full Assessment" className="max-w-[280px] flex-[1_1_250px] border-r border-slate-200 bg-slate-50 py-3">
      <p className="mx-3 mb-2.5 flex items-center gap-2 rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm font-semibold">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-violet-700" />
        Full Assessment
      </p>
      <a
        href="#overview"
        aria-current={route.view === "overview" ? "page" : undefined}
        className={`flex items-center gap-2.5 px-4 py-2 text-slate-900 no-underline ${route.view === "overview" ? "border-l-4 border-blue-700 bg-blue-100 pl-3" : ""}`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="text-blue-700">
          <path d="M2 7.5 8 2.5l6 5V14H2z" />
        </svg>
        <span className="flex flex-col">
          <span className="text-[15px] font-bold">Overview</span>
          <span className="text-xs text-slate-700">{s.percent}% completed</span>
        </span>
      </a>
      <ol className="mt-1">
        {FULL_TESTS.map((test, t) => {
          const open = test.id === openTest;
          return (
            <li key={test.id}>
              <a
                href={`#test/${test.id}`}
                aria-expanded={open}
                className={`flex items-center gap-2.5 px-4 py-1.5 text-sm text-slate-900 no-underline hover:bg-slate-100 ${open ? "font-bold" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] ${open ? "bg-blue-700 text-white" : "border-[1.5px] border-slate-500 text-slate-700"}`}
                >
                  {t + 1}
                </span>
                <span className="flex-1">{test.name}</span>
                <span aria-hidden="true" className={open ? "text-blue-700" : "text-slate-500"}>
                  {open ? "▾" : "▸"}
                </span>
              </a>
              {open && (
                <ol className="mb-1.5 mt-0.5 bg-blue-50">
                  <li>
                    <a
                      href={`#test/${test.id}`}
                      aria-current={route.view === "test" ? "page" : undefined}
                      className={`block py-1.5 pl-12 pr-4 text-sm text-slate-900 no-underline ${route.view === "test" ? "border-l-4 border-blue-700 bg-blue-200 pl-11 font-bold" : ""}`}
                    >
                      Getting started
                    </a>
                  </li>
                  {test.requirements.map((r, i) => {
                    const active = route.view === "req" && route.id === r.id;
                    return (
                      <li key={r.id}>
                        <a
                          href={`#req/${r.id}`}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center gap-2.5 py-1.5 pl-5 pr-4 text-sm text-slate-900 no-underline hover:bg-blue-100 ${active ? "border-l-4 border-blue-700 bg-blue-200 pl-4 font-bold" : ""}`}
                        >
                          <span className="w-7 shrink-0 text-[13px] text-slate-700">
                            {t + 1}.{i + 1}
                          </span>
                          <span className="flex-1">{r.name}</span>
                          <ReqMark status={requirementStatus(r, state.results[r.id])} />
                        </a>
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type Filter = "all" | "in-progress" | "failed" | "not-started";

export function FullOverview({ state }: { state: AssessmentState }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => headingRef.current?.focus(), []);
  const s = summarize(state);
  const tests = FULL_TESTS.map((test, i) => ({ test, i, ...testStatus(test, state) }));
  const count = (f: Filter) => (f === "all" ? tests.length : tests.filter((t) => (f === "in-progress" ? t.status === "in-progress" || t.status === "passed" : t.status === f)).length);
  const shown = tests.filter((t) => filter === "all" || (filter === "in-progress" ? t.status === "in-progress" || t.status === "passed" : t.status === filter));
  const passDeg = (s.passed / s.total) * 100;
  const failDeg = passDeg + (s.failed / s.total) * 100;
  const next = s.next ? locate(s.next.id) : undefined;
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
          <p className="text-[13px] font-bold tracking-wider text-violet-800">FULL ASSESSMENT · WCAG 2.2 AA</p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-[26px] font-bold" style={{ outline: "none" }}>
            {state.target.title}
          </h1>
          {s.next && next ? (
            <a
              href={s.todo === s.total ? `#test/${next.test.id}` : `#req/${s.next.id}`}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-[15px] font-bold text-white no-underline hover:bg-blue-800"
            >
              {s.todo === s.total ? `Start: ${next.test.name}` : `Continue: ${next.number} ${s.next.name}`} →
            </a>
          ) : (
            <p className="mt-3 text-[15px] font-semibold text-emerald-800">Every requirement has a result. Export the report from the top bar.</p>
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

      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="mr-3 text-xl font-bold">Tests</h2>
        <div role="group" aria-label="Show tests" className="flex flex-wrap gap-2">
          {(
            [
              ["all", "All"],
              ["in-progress", "In progress"],
              ["failed", "Failed"],
              ["not-started", "Not started"],
            ] as const
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${filter === f ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-900"}`}
            >
              {label} {count(f)}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {shown.map(({ test, i, status, done, statuses }) => (
          <li key={test.id}>
            <a href={`#test/${test.id}`} className="flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-slate-900 no-underline shadow-sm hover:bg-slate-50">
              <span className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[13px] font-bold text-indigo-800">{i + 1}</span>
                <span className="flex-1 text-base font-bold">{test.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${TEST_CHIP[status]}`}>{TEST_LABEL[status]}</span>
              </span>
              <span
                role="img"
                aria-label={`${statuses.filter((x) => x === "pass").length} passed, ${statuses.filter((x) => x === "fail").length} failed, ${statuses.filter((x) => x === "todo").length} to do`}
                className="flex gap-[3px]"
              >
                {statuses.map((x, k) => (
                  <span key={k} className={`h-2 flex-1 rounded ${x === "pass" ? "bg-emerald-700" : x === "fail" ? "bg-red-700" : "bg-slate-200"}`} />
                ))}
              </span>
              <span className="text-[13px] text-slate-600">
                {done} of {statuses.length} done
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-slate-600">
        {FULL_TESTS.length} tests, {FULL_REQUIREMENTS.length} requirements: every WCAG 2.2 A and AA success criterion that needs a person. Run PalTech's automated scan too for the rest.
      </p>
    </div>
  );
}

export function TestView({ test, state }: { test: AssessmentTest; state: AssessmentState }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const t = FULL_TESTS.indexOf(test);
  const { done, failed, statuses } = testStatus(test, state);
  useEffect(() => headingRef.current?.focus(), [test.id]);
  const criteria = [...new Set(test.requirements.map((r) => r.wcag.criterion))];
  const firstTodo = test.requirements.find((r, i) => statuses[i] === "todo") ?? test.requirements[0];
  const prevTest = FULL_TESTS[t - 1];
  return (
    <div className="flex max-w-[980px] flex-col gap-4">
      <div>
        <p className="text-sm text-slate-600">{test.name} · Getting started</p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-[28px] font-bold" style={{ outline: "none" }}>
          {t + 1}. {test.name}
        </h1>
        <p className="mt-2 max-w-[760px] text-base leading-relaxed">{test.description}</p>
      </div>
      <section aria-label="Summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[13px] text-slate-600">Requirements</div>
          <div className="text-[26px] font-bold">{test.requirements.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[13px] text-slate-600">Done</div>
          <div className="text-[26px] font-bold">
            {done}
            {failed > 0 && <span className="text-sm font-semibold text-red-800"> · {failed} failed</span>}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[13px] text-slate-600">WCAG</div>
          <div className="pt-1.5 text-base font-bold">{criteria.join(" · ")}</div>
        </div>
      </section>
      <section aria-labelledby={`checks-${test.id}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 id={`checks-${test.id}`} className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-[17px] font-bold">
          Checks in this test
        </h2>
        <ul>
          {test.requirements.map((r, i) => {
            const st = statuses[i];
            const n = failuresOf(r, state.results[r.id]).length;
            return (
              <li key={r.id}>
                <a href={`#req/${r.id}`} className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 text-slate-900 no-underline last:border-0 hover:bg-slate-50">
                  <span className="w-8 shrink-0 text-[13px] text-slate-700">
                    {t + 1}.{i + 1}
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="text-[15px] font-semibold">{r.name}</span>
                    <span className="text-[13px] text-slate-600">{r.description}</span>
                  </span>
                  <span className="w-14 shrink-0 text-[13px] text-slate-700">{r.wcag.criterion}</span>
                  <span className={`w-24 shrink-0 text-right text-[13px] font-semibold ${st === "pass" ? "text-emerald-800" : st === "fail" ? "text-red-800" : "text-slate-700"}`}>
                    {st === "pass" ? "✓ Passed" : st === "fail" ? `✕ Failed${n ? ` (${n})` : ""}` : "Incomplete"}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>
      <nav aria-label="Tests" className="flex justify-between gap-3">
        <a href={prevTest ? `#test/${prevTest.id}` : "#overview"} className="inline-flex items-center rounded-lg border border-slate-400 bg-white px-4 py-2 text-[15px] text-slate-900 no-underline hover:bg-slate-50">
          ← {prevTest ? prevTest.name : "Overview"}
        </a>
        <a href={`#req/${firstTodo.id}`} className="inline-flex items-center rounded-lg bg-blue-700 px-4 py-2 text-[15px] font-bold text-white no-underline hover:bg-blue-800">
          {done === 0 ? "Start" : "Continue"}: {firstTodo.name} →
        </a>
      </nav>
    </div>
  );
}
