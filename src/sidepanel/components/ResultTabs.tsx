import { useMemo, useRef, type KeyboardEvent } from "react";
import { failedRules, matchesFilters, useStore, type ResultTab } from "@src/sidepanel/store";

const TABS: Array<{ value: ResultTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "auto", label: "WCAG issues" },
  { value: "bp", label: "Best practices" },
  { value: "failed", label: "Failed rules" },
  { value: "passed", label: "Passed rules" },
  { value: "na", label: "Not applicable rules" },
];

/**
 * axe-style result tabs. Counts honour the status filters (baselined/ignored)
 * but not the severity / category / search filters, so they read as totals.
 * Implemented as a tablist with roving focus (arrow keys, Home, End).
 */
export function ResultTabs() {
  const result = useStore((s) => s.result);
  const tab = useStore((s) => s.resultTab);
  const setTab = useStore((s) => s.setResultTab);
  const filters = useStore((s) => s.filters);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const counts = useMemo(() => {
    const base = { ...filters, severities: [], categories: [], search: "", sources: [], showBestPractice: true };
    const issues = result?.issues ?? [];
    const count = (t: ResultTab) => issues.filter((i) => matchesFilters(i, base, t)).length;
    return {
      all: count("all"),
      auto: count("auto"),
      bp: count("bp"),
      failed: failedRules(result, filters).length,
      passed: result?.passedRules.length ?? 0,
      na: result?.inapplicableRules?.length ?? 0,
    } satisfies Record<ResultTab, number>;
  }, [result, filters]);

  if (!result) return null;

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label="Result type" className="flex flex-wrap gap-x-0.5 border-b border-slate-300 px-2 pt-1">
      {TABS.map((t, index) => {
        const selected = t.value === tab;
        const n = counts[t.value];
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`result-tab-${t.value}`}
            aria-selected={selected}
            aria-controls="result-tabpanel"
            tabIndex={selected ? 0 : -1}
            onClick={() => setTab(t.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`-mb-px whitespace-nowrap rounded-t border-b-2 px-2 py-1 text-xs font-medium ${
              selected ? "border-blue-700 text-blue-900" : "border-transparent text-slate-700 hover:bg-slate-100"
            }`}
          >
            {t.label}{" "}
            <span className="ml-0.5 inline-flex min-w-5 justify-center rounded-full bg-slate-200 px-1 tabular-nums text-slate-800">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
