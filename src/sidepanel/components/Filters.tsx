import { useId } from "react";
import type { Category, IssueSource, IssueStatus, Severity } from "@shared/types";
import { CATEGORY_ORDER, SEVERITIES, useStore, type GroupBy } from "@src/sidepanel/store";
import { FilterCheckRow, FilterHeading, FilterMenu } from "./FilterMenu";
import { FilterIcon, InfoCircleIcon, SearchIcon } from "./icons";
import { SelectMenu, type SelectOption } from "./SelectMenu";

const SOURCE_LABEL: Record<IssueSource, string> = { axe: "axe-core", custom: "advanced", manual: "manual" };

const GROUP_OPTIONS: Array<SelectOption<GroupBy>> = [
  { value: "rule", label: "By rule", description: "One row per rule, issues nested" },
  { value: "category", label: "By category", description: "Rules grouped by category" },
];

/** Statuses offered in the Status filter ("fixed" is never set by the panel). */
const STATUS_OPTIONS: Array<{ value: IssueStatus; label: string; hint: string }> = [
  { value: "new", label: "Open", hint: "Counted in the totals and score" },
  { value: "ignored", label: "Ignored", hint: "Marked as false positives" },
  { value: "baselined", label: "Baselined", hint: "Known and accepted for now" },
];

/** Short description of the current status selection, e.g. "Open" or "All". */
function statusSelection(statuses: IssueStatus[]): string {
  const shown = STATUS_OPTIONS.filter((o) => statuses.length === 0 || statuses.includes(o.value));
  if (shown.length === STATUS_OPTIONS.length) return "All";
  if (shown.length === 1) return shown[0].label;
  return `${shown.length} selected`;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

const LINK_BUTTON = "rounded px-1.5 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-50 hover:underline";

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
  const shownByStatus = STATUS_OPTIONS.filter((o) => filters.statuses.length === 0 || filters.statuses.includes(o.value)).reduce(
    (n, o) => n + statusCount(o.value),
    0,
  );
  const statusSel = statusSelection(filters.statuses);
  const sevLabel = filters.severities.length === 0 ? "Severity: all" : `Severity: ${filters.severities.length}`;
  const catLabel = filters.categories.length === 0 ? "Category: all" : `Category: ${filters.categories.length}`;
  const sevCount = (s: Severity) => result.issues.filter((i) => i.severity === s).length;
  const catCount = (c: Category) => result.issues.filter((i) => i.category === c).length;
  const lastStatus = filters.statuses.length === 1;

  return (
    <section aria-label="Filters" className="px-3 py-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search issues
        </label>
        <div className="relative min-w-0 flex-1">
          <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-600" />
          <input
            id={`${id}-search`}
            type="search"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder="Search rule, selector, WCAG..."
            className="w-full rounded-md border border-slate-500 bg-white py-1 pr-2 pl-7 text-[13px] text-slate-900 placeholder:text-slate-600"
          />
        </div>
        <span id={`${id}-group-lbl`} className="text-xs font-medium text-slate-700">
          Group
        </span>
        <SelectMenu
          id={`${id}-group`}
          label="Group by"
          labelledBy={`${id}-group-lbl`}
          value={groupBy}
          options={GROUP_OPTIONS}
          onChange={setGroupBy}
          align="right"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-stretch gap-2">
        <FilterMenu
          ariaLabel={`${sevLabel}, open severity filter`}
          className="min-w-24 flex-1"
          panelClassName="w-60"
          panel={
            <fieldset>
              <FilterHeading>Show severities</FilterHeading>
              {SEVERITIES.map((sev: Severity) => (
                <FilterCheckRow
                  key={sev}
                  checked={filters.severities.length === 0 || filters.severities.includes(sev)}
                  count={sevCount(sev)}
                  onChange={() => {
                    const base = filters.severities.length === 0 ? [...SEVERITIES] : filters.severities;
                    const next = toggle(base, sev);
                    setFilters({ severities: next.length === SEVERITIES.length ? [] : next });
                  }}
                >
                  <span className={`sev-dot sev-${sev}`} aria-hidden="true" />
                  {sev}
                </FilterCheckRow>
              ))}
            </fieldset>
          }
        >
          {sevLabel}
        </FilterMenu>

        <FilterMenu
          ariaLabel={`${catLabel}, open category filter`}
          className="min-w-24 flex-1"
          panelClassName="w-60"
          panel={
            <fieldset>
              <FilterHeading>Show categories</FilterHeading>
              {CATEGORY_ORDER.filter((c) => presentCategories.has(c)).map((cat) => (
                <FilterCheckRow
                  key={cat}
                  checked={filters.categories.length === 0 || filters.categories.includes(cat)}
                  count={catCount(cat)}
                  onChange={() => {
                    const all = CATEGORY_ORDER.filter((c) => presentCategories.has(c));
                    const base = filters.categories.length === 0 ? all : filters.categories;
                    const next = toggle(base, cat);
                    setFilters({ categories: next.length === all.length ? [] : next });
                  }}
                >
                  {cat}
                </FilterCheckRow>
              ))}
            </fieldset>
          }
        >
          {catLabel}
        </FilterMenu>

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

        <FilterMenu
          ariaLabel={`Status: ${statusSel}, ${shownByStatus} ${shownByStatus === 1 ? "issue" : "issues"}, open status filter`}
          align="right"
          className="min-w-24 flex-1"
          panelClassName="w-72"
          panel={
            <fieldset>
              <FilterHeading>Show issues that are</FilterHeading>
              {STATUS_OPTIONS.map((o) => {
                const all = STATUS_OPTIONS.map((x) => x.value);
                const checked = filters.statuses.length === 0 || filters.statuses.includes(o.value);
                const locked = checked && lastStatus;
                return (
                  <FilterCheckRow
                    key={o.value}
                    checked={checked}
                    dimmed={locked}
                    hint={o.hint}
                    count={statusCount(o.value)}
                    describedBy={locked ? `${id}-last-status` : undefined}
                    onChange={() => {
                      const base = filters.statuses.length === 0 ? all : filters.statuses;
                      const next = toggle(base, o.value);
                      // At least one status stays ticked: an empty choice would just show an empty list.
                      if (next.length === 0) return;
                      setFilters({ statuses: next.length === all.length ? [] : next });
                    }}
                  >
                    {o.label}
                  </FilterCheckRow>
                );
              })}
              <p id={`${id}-last-status`} className="mt-1 flex items-start gap-1.5 border-t border-slate-200 px-1 pt-2 text-[11px] text-slate-600">
                <InfoCircleIcon size={14} className="mt-px" />
                At least one status stays selected. Tick another to untick this one.
              </p>
              <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-200 pt-2">
                <button type="button" className={LINK_BUTTON} onClick={() => setFilters({ statuses: ["new"] })}>
                  Open only
                </button>
                <button type="button" className={LINK_BUTTON} onClick={() => setFilters({ statuses: ["ignored", "baselined"] })}>
                  Excluded only
                </button>
                <button type="button" className={LINK_BUTTON} onClick={() => setFilters({ statuses: [] })}>
                  All
                </button>
              </div>
            </fieldset>
          }
        >
          <FilterIcon size={14} className="text-slate-700" />
          <span className="truncate">
            Status: <strong className="font-bold text-slate-900">{statusSel}</strong>
          </span>
          <span className="rounded-full bg-blue-100 px-1.5 text-[11px] font-semibold tabular-nums text-blue-900">{shownByStatus}</span>
        </FilterMenu>
      </div>
    </section>
  );
}
