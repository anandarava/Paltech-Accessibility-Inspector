import { useEffect, useMemo, useRef } from "react";
import type { Category, Issue, RulesFile, Severity } from "@shared/types";
import rulesJson from "@shared/a11y-rules.json";
import { AXE_TO_RULE } from "@shared/wcag-map";
import {
  CATEGORY_ORDER,
  failedRules,
  issueNumbers,
  matchesFilters,
  ruleGroupKey,
  severityRank,
  useStore,
} from "@src/sidepanel/store";
import { SeverityLabel, StatusLabel } from "./SeverityLabel";

const RULES = (rulesJson as unknown as RulesFile).rules;

interface Group {
  key: string;
  label: string;
  /** Rule id shown next to the label in rule mode. */
  ruleId?: string;
  wcag?: string;
  severity?: Severity;
  issues: Issue[];
}

function passedRuleLabel(axeId: string): string {
  const projectId = AXE_TO_RULE[axeId];
  const def = projectId ? RULES.find((r) => r.id === projectId) : undefined;
  if (def) return def.check;
  return axeId.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Short element label for instance rows in rule mode: `tag#id.class` plus text, from the HTML snippet. */
function elementLabel(issue: Issue): string {
  const html = issue.element.html || issue.element.selector;
  const open = /^<([a-z0-9-]+)([^>]*)>/i.exec(html);
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!open) return issue.element.selector;
  const tag = open[1].toLowerCase();
  const id = /\bid="([^"]+)"/.exec(open[2])?.[1];
  const cls = /\bclass="([^"]+)"/.exec(open[2])?.[1]?.trim().split(/\s+/)[0];
  const head = `<${tag}${id ? `#${id}` : ""}${cls ? `.${cls}` : ""}>`;
  return text ? `${head} ${text.slice(0, 60)}` : head;
}

export function IssueList({ onOpen }: { onOpen(issueId: string): void }) {
  const result = useStore((s) => s.result);
  const filters = useStore((s) => s.filters);
  const tab = useStore((s) => s.resultTab);
  const groupBy = useStore((s) => s.groupBy);
  const selectedIssueId = useStore((s) => s.selectedIssueId);
  const collapsed = useStore((s) => s.collapsedCategories);
  const expandedRules = useStore((s) => s.expandedRules);
  const toggleCollapsed = useStore((s) => s.toggleCategoryCollapsed);
  const toggleRule = useStore((s) => s.toggleRuleExpanded);
  const readOnly = useStore((s) => s.viewingSaved !== null);
  const setResultTab = useStore((s) => s.setResultTab);
  const setGroupBy = useStore((s) => s.setGroupBy);
  const expandRule = useStore((s) => s.expandRule);
  const selectIssue = useStore((s) => s.selectIssue);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus management on mount: return focus to the item the tester came from
  // (back from detail view), otherwise land on the heading.
  useEffect(() => {
    const selected = useStore.getState().selectedIssueId;
    const target =
      (selected && listRef.current?.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(selected)}"] button`)) ||
      headingRef.current;
    const id = window.requestAnimationFrame(() => target?.focus());
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Badge number = index in result.issues + 1 (matches overlay); see issueNumbers().
  const numbers = useMemo(() => issueNumbers(result), [result]);

  const groups = useMemo<Group[]>(() => {
    if (!result || tab === "failed" || tab === "passed" || tab === "na") return [];
    const visible = result.issues.filter((issue) => matchesFilters(issue, filters, tab));
    if (groupBy === "category") {
      const byCat = new Map<Category, Issue[]>();
      for (const issue of visible) {
        const list = byCat.get(issue.category) ?? [];
        list.push(issue);
        byCat.set(issue.category, list);
      }
      return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({ key: `cat:${c}`, label: c, issues: byCat.get(c) ?? [] }));
    }
    const byRule = new Map<string, Issue[]>();
    for (const issue of visible) {
      const key = ruleGroupKey(issue);
      const list = byRule.get(key) ?? [];
      list.push(issue);
      byRule.set(key, list);
    }
    const out: Group[] = [...byRule.entries()].map(([key, issues]) => {
      const first = issues[0];
      const severity = issues.map((i) => i.severity).sort((a, b) => severityRank(a) - severityRank(b))[0];
      return {
        key,
        label: first.title,
        ruleId: first.ruleId,
        wcag: first.wcag.level === "BP" ? "Best practice" : `WCAG ${first.wcag.criterion} (${first.wcag.level})`,
        severity,
        issues,
      };
    });
    // Most severe first, then most instances, then title.
    out.sort(
      (a, b) =>
        severityRank(a.severity ?? "Minor") - severityRank(b.severity ?? "Minor") ||
        b.issues.length - a.issues.length ||
        a.label.localeCompare(b.label),
    );
    return out;
  }, [result, filters, tab, groupBy]);

  const visibleIds = useMemo(() => groups.flatMap((g) => g.issues.map((i) => i.id)), [groups]);

  // Scroll the selected item into view (e.g. after ISSUE_CLICKED from the overlay).
  useEffect(() => {
    if (!selectedIssueId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(selectedIssueId)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIssueId, collapsed, expandedRules]);

  if (!result) return null;

  if (tab === "passed") {
    return (
      <section id="result-tabpanel" role="tabpanel" aria-labelledby="result-tab-passed" className="flex min-h-0 flex-1 flex-col">
        <h2 ref={headingRef} tabIndex={-1} className="px-3 py-1.5 text-sm font-semibold text-slate-900">
          Passed rules <span className="font-normal text-slate-600">({result.passedRules.length})</span>
        </h2>
        <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {result.passedRules.length === 0 && <li className="py-2 text-sm text-slate-700">No axe-core rule passed on this page.</li>}
          {result.passedRules.map((rule) => (
            <li key={rule} className="flex items-baseline gap-2 border-b border-slate-100 py-1 text-sm text-slate-900">
              <span aria-hidden="true" className="text-green-700">
                ✓
              </span>
              <span className="min-w-0 flex-1">{passedRuleLabel(rule)}</span>
              <code className="font-mono text-[11px] text-slate-600">{rule}</code>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (tab === "failed") {
    const rules = failedRules(result, filters);
    const elements = rules.reduce((n, r) => n + r.count, 0);
    // Show the rule's elements in the grouped issue list, expanded and scrolled to.
    const openRule = (rule: (typeof rules)[number]) => {
      setGroupBy("rule");
      expandRule(rule.key);
      setResultTab("all");
      selectIssue(rule.firstIssueId);
    };
    return (
      <section id="result-tabpanel" role="tabpanel" aria-labelledby="result-tab-failed" className="flex min-h-0 flex-1 flex-col">
        <h2 ref={headingRef} tabIndex={-1} className="px-3 py-1.5 text-sm font-semibold text-slate-900">
          Failed rules <span className="font-normal text-slate-600">({rules.length} rules, {elements} failing elements)</span>
        </h2>
        {rules.length === 0 ? (
          <p className="px-3 py-2 text-sm text-green-800">No rule failed on this page.</p>
        ) : (
          <table className="mx-3 mb-2 text-sm">
            <caption className="sr-only">Rules that failed, most severe first</caption>
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs text-slate-700">
                <th scope="col" className="py-1 pr-2 font-medium">Rule</th>
                <th scope="col" className="py-1 pr-2 font-medium">WCAG</th>
                <th scope="col" className="py-1 pr-2 font-medium">Severity</th>
                <th scope="col" className="py-1 text-right font-medium">Elements</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.key} className="border-b border-slate-100 align-top">
                  <th scope="row" className="py-1 pr-2 text-left font-normal">
                    <button type="button" onClick={() => openRule(r)} className="text-left text-blue-800 underline hover:text-blue-950">
                      {r.title}
                    </button>
                    <span className="block font-mono text-[11px] text-slate-600">
                      {r.ruleId}
                      {r.axeRuleId && r.axeRuleId !== r.ruleId ? ` · axe: ${r.axeRuleId}` : ""}
                    </span>
                  </th>
                  <td className="py-1 pr-2 text-xs text-slate-800">
                    {r.wcag.level === "BP" ? "Best practice" : `${r.wcag.criterion} (${r.wcag.level})`}
                  </td>
                  <td className="py-1 pr-2 text-xs text-slate-800">
                    <span className="inline-flex items-center gap-1">
                      <span className={`sev-dot ${r.wcag.level === "BP" ? "sev-bp" : `sev-${r.severity}`}`} aria-hidden="true" />
                      {r.severity}
                    </span>
                  </td>
                  <td className="py-1 text-right tabular-nums text-slate-900">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  if (tab === "na") {
    const rules = result.inapplicableRules ?? [];
    return (
      <section id="result-tabpanel" role="tabpanel" aria-labelledby="result-tab-na" className="flex min-h-0 flex-1 flex-col">
        <h2 ref={headingRef} tabIndex={-1} className="px-3 py-1.5 text-sm font-semibold text-slate-900">
          Not applicable rules <span className="font-normal text-slate-600">({rules.length})</span>
        </h2>
        <p className="px-3 pb-1 text-xs text-slate-700">
          These axe-core rules ran but found nothing on the page to test (for example no video, iframe or image map). They neither
          passed nor failed.
        </p>
        <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {rules.length === 0 && <li className="py-2 text-sm text-slate-700">Every rule found something to test on this page.</li>}
          {rules.map((rule) => (
            <li key={rule} className="flex items-baseline gap-2 border-b border-slate-100 py-1 text-sm text-slate-900">
              <span aria-hidden="true" className="text-slate-500">
                –
              </span>
              <span className="min-w-0 flex-1">{passedRuleLabel(rule)}</span>
              <code className="font-mono text-[11px] text-slate-600">{rule}</code>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const tabTotal = result.issues.filter((i) => matchesFilters(i, { ...filters, severities: [], categories: [], sources: [], search: "" }, tab)).length;
  const hiddenCount = tabTotal - visibleIds.length;

  const instanceRow = (issue: Issue, mode: "rule" | "category") => {
    const n = numbers.get(issue.id) ?? 0;
    const selected = issue.id === selectedIssueId;
    // Ignored / baselined / fixed issues are shown softer: they are not counted.
    const excluded = issue.status !== "new";
    return (
      <li
        key={issue.id}
        data-issue-id={issue.id}
        className={`flex items-center gap-1 rounded border-l-4 ${selected ? "border-blue-700 bg-blue-50" : "border-transparent"}`}
      >
        <button
          type="button"
          onClick={() => onOpen(issue.id)}
          aria-current={selected ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-slate-100"
        >
          <span
            className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums ${
              excluded ? "border border-slate-300 bg-slate-100 text-slate-700" : "bg-slate-800 text-white"
            }`}
            aria-label={`Issue number ${n}`}
          >
            {n}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              {mode === "rule" ? (
                <span className={`min-w-0 flex-1 truncate font-mono text-xs ${excluded ? "text-slate-600" : "text-slate-900"}`}>{elementLabel(issue)}</span>
              ) : (
                <span className={`min-w-0 flex-1 truncate text-sm ${excluded ? "text-slate-600" : "text-slate-900"}`}>
                  <span className="font-mono text-xs text-slate-700">{issue.ruleId}</span> {issue.title}
                </span>
              )}
              <StatusLabel status={issue.status} />
            </span>
            {mode === "category" && (
              <span className="flex flex-wrap items-center gap-2">
                <SeverityLabel issue={issue} />
              </span>
            )}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section
      id="result-tabpanel"
      role="tabpanel"
      aria-labelledby={`result-tab-${tab}`}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <h2 id="issues-heading" ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-slate-900">
          {groupBy === "rule" ? `${groups.length} rule${groups.length === 1 ? "" : "s"}, ` : ""}
          {visibleIds.length} issue{visibleIds.length === 1 ? "" : "s"}
          {hiddenCount > 0 && <span className="font-normal text-slate-600"> ({hiddenCount} filtered out)</span>}
        </h2>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {result.issues.length === 0 && (
          <p className="px-1 py-4 text-sm text-green-800">
            No issues found by the automated checks. Automated checks do not cover everything: also test the page with a keyboard and a screen reader.
          </p>
        )}
        {result.issues.length > 0 && groups.length === 0 && (
          <p className="px-1 py-4 text-sm text-slate-700">
            No issues match the current tab and filters.
          </p>
        )}
        {groups.map((group) => {
          const isRule = groupBy === "rule";
          const isOpen = isRule ? expandedRules.includes(group.key) : !collapsed.includes(group.label as Category);
          const panelId = `group-${group.key.replace(/[^a-z0-9]+/gi, "-")}`;
          return (
            <div key={group.key} className={isRule ? "mb-0.5 rounded border border-slate-200" : "mb-1"}>
              <h3 className="text-sm">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => (isRule ? toggleRule(group.key) : toggleCollapsed(group.label as Category))}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-slate-900 hover:bg-slate-100"
                >
                  <span aria-hidden="true" className="w-3 shrink-0 text-xs">
                    {isOpen ? "▾" : "▸"}
                  </span>
                  {isRule && group.severity && (
                    <>
                      <span className={`sev-dot sev-${group.severity}`} aria-hidden="true" />
                      <span className="sr-only">{group.severity}: </span>
                    </>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {group.label}{" "}
                      <span className="font-normal tabular-nums text-slate-700">({group.issues.length})</span>
                    </span>
                    {isRule && (
                      <span className="block text-[11px] font-normal text-slate-600">
                        <span className="font-mono">{group.ruleId}</span> · {group.wcag} · {group.severity}
                      </span>
                    )}
                  </span>
                </button>
              </h3>
              {isOpen && (
                <ul id={panelId} className={isRule ? "border-t border-slate-200 py-0.5 pl-3" : "ml-1"}>
                  {group.issues.map((issue) => instanceRow(issue, isRule ? "rule" : "category"))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
