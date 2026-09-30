import { useId } from "react";
import type { Category, IssueSource, IssueStatus, Severity } from "@shared/types";
import { CATEGORY_ORDER, SEVERITIES, useStore, type GroupBy } from "@src/sidepanel/store";
import { Popover } from "./Popover";

const SOURCE_LABEL: Record<IssueSource, string> = { axe: "axe-core", custom: "advanced", manual: "manual" };

/** Statuses offered in the Status filter ("fixed" is never set by the panel). */
const STATUS_OPTIONS: Array<{ value: IssueStatus; label: string; hint: string }> = [
  { value: "new", label: "Open", hint: "Counted in the totals and score" },
  { value: "ignored", label: "Ignored", hint: "Marked as false positives" },
  { value: "baselined", label: "Baselined", hint: "Known and accepted for now" },
];

function statusFilterLabel(statuses: IssueStatus[]): string {
  const shown = STATUS_OPTIONS.filter((o) => statuses.length === 0 || statuses.includes(o.value));
  if (shown.length === STATUS_OPTIONS.length) return "Status: all";
  if (shown.length === 1) return `Status: ${shown[0].label}`;
  return `Status: ${shown.length} selected`;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function Filters() {
  const id = useId();
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const result = useStore((s) => s.result);
  const tab = useStore((s) => s.resultTab);
  const groupBy = useStore((s) => s.groupBy);
  const setGroupBy = useStore((s) => s.setGroupBy);
  if (!result || tab === "failed" || tab === "passed" || tab === "na") return null;

  const presentCategories = new Set<Category>(result.issues.map((i) => i.category));
  const statusCount = (s: IssueStatus) => result.issues.filter((i) => i.status === s).length;
  const statusLabel = statusFilterLabel(filters.statuses);
  const sevLabel = filters.severities.length === 0 ? "Severity: all" : `Severity: ${filters.severities.length}`;
  const catLabel = filters.categories.length === 0 ? "Category: all" : `Category: ${filters.categories.length}`;

  return (
    <section aria-label="Filters" className="border-b border-slate-300 px-3 py-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search issues
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          placeholder="Search rule, selector, WCAG…"
          className="min-w-0 flex-1 rounded border border-slate-500 bg-white px-2 py-1 text-sm text-slate-900"
        />
        <label htmlFor={`${id}-group`} className="text-xs text-slate-700">
          Group
        </label>
        <select
          id={`${id}-group`}
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          className="rounded border border-slate-500 bg-white px-1 py-1 text-xs text-slate-900"
        >
          <option value="rule">By rule</option>
          <option value="category">By category</option>
        </select>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Popover label={sevLabel} ariaLabel={`${sevLabel}, open severity filter`} align="left">
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-slate-800">Severity</legend>
            {SEVERITIES.map((sev: Severity) => (
              <label key={sev} className="flex items-center gap-2 py-0.5 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={filters.severities.length === 0 || filters.severities.includes(sev)}
                  onChange={() => {
                    const base = filters.severities.length === 0 ? [...SEVERITIES] : filters.severities;
                    const next = toggle(base, sev);
                    setFilters({ severities: next.length === SEVERITIES.length ? [] : next });
                  }}
                />
                <span className={`sev-dot sev-${sev}`} aria-hidden="true" />
                {sev}
              </label>
            ))}
          </fieldset>
        </Popover>

        <Popover label={catLabel} ariaLabel={`${catLabel}, open category filter`} align="left">
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-slate-800">Category</legend>
            {CATEGORY_ORDER.filter((c) => presentCategories.has(c)).map((cat) => (
              <label key={cat} className="flex items-center gap-2 py-0.5 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={filters.categories.length === 0 || filters.categories.includes(cat)}
                  onChange={() => {
                    const all = CATEGORY_ORDER.filter((c) => presentCategories.has(c));
                    const base = filters.categories.length === 0 ? all : filters.categories;
                    const next = toggle(base, cat);
                    setFilters({ categories: next.length === all.length ? [] : next });
                  }}
                />
                {cat}
              </label>
            ))}
          </fieldset>
        </Popover>

        {filters.sources.length > 0 && (
          <button
            type="button"
            onClick={() => setFilters({ sources: [] })}
            aria-label={`Source filter: ${filters.sources.map((x) => SOURCE_LABEL[x]).join(", ")}. Remove filter`}
            className="inline-flex items-center gap-1 rounded-full border border-blue-700 bg-blue-50 px-2 py-0.5 text-xs text-blue-900 hover:bg-blue-100"
          >
            Source: {filters.sources.map((x) => SOURCE_LABEL[x]).join(", ")} <span aria-hidden="true">✕</span>
          </button>
        )}

        <Popover label={statusLabel} ariaLabel={`${statusLabel}, open status filter`} align="left">
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-slate-800">Status</legend>
            {STATUS_OPTIONS.map((o) => {
              const all = STATUS_OPTIONS.map((x) => x.value);
              const checked = filters.statuses.length === 0 || filters.statuses.includes(o.value);
              return (
                <label key={o.value} className="flex items-start gap-2 py-0.5 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    aria-describedby={checked && (filters.statuses.length === 1) ? `${id}-last-status` : undefined}
                    onChange={() => {
                      const base = filters.statuses.length === 0 ? all : filters.statuses;
                      const next = toggle(base, o.value);
                      // At least one status stays ticked: an empty choice would just show an empty list.
                      if (next.length === 0) return;
                      setFilters({ statuses: next.length === all.length ? [] : next });
                    }}
                  />
                  <span>
                    {o.label} <span className="tabular-nums text-slate-600">({statusCount(o.value)})</span>
                    <span className="block text-[11px] text-slate-600">{o.hint}</span>
                  </span>
                </label>
              );
            })}
            {filters.statuses.length === 1 && (
              <p id={`${id}-last-status`} className="text-[11px] text-slate-600">
                Tick another status before unticking this one.
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1 border-t border-slate-200 pt-1.5">
              <button type="button" className="rounded px-1.5 py-0.5 text-xs text-blue-800 underline hover:bg-blue-50" onClick={() => setFilters({ statuses: ["new"] })}>
                Open only
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-blue-800 underline hover:bg-blue-50"
                onClick={() => setFilters({ statuses: ["ignored", "baselined"] })}
              >
                Excluded only
              </button>
            </div>
          </fieldset>
        </Popover>
      </div>
    </section>
  );
}
