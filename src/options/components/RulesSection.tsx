import { useMemo, useState, type JSX } from "react";
import type { RuleConfig, RuleDefinition, RulesFile } from "@shared/types";
import { Section, Button, SelectField } from "./ui";
import { CATEGORIES } from "./CategoriesSection";

/** Threshold inputs exposed per rule. Values live in RuleConfig.thresholds[ruleId][key]. */
export const THRESHOLD_FIELDS: Record<string, Array<{ key: string; label: string; unit: string; default: number; min: number; max: number }>> = {
  "TGT-01": [{ key: "minSize", label: "Minimum target size", unit: "px", default: 24, min: 1, max: 200 }],
};

export function isRuleEnabled(rule: RuleDefinition, config: RuleConfig): boolean {
  return rule.enabled && !config.disabled.includes(rule.id);
}

function wcagLabel(rule: RuleDefinition): string {
  if (rule.wcag.level === "BP" || !rule.wcag.criterion) return "Best practice";
  return `${rule.wcag.criterion} ${rule.wcag.name}`;
}

/**
 * Numeric threshold input that keeps its own text while the user types and only
 * commits valid, clamped numbers. Empty or invalid text restores the rule default.
 */
function ThresholdInput(props: {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  defaultValue: number;
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
}): JSX.Element {
  const { id, label, unit, min, max, defaultValue, value, onCommit } = props;
  const [text, setText] = useState(String(value ?? defaultValue));
  const [lastValue, setLastValue] = useState(value);
  // Resync when the stored value changes from outside (import, reset).
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value ?? defaultValue));
  }
  const commit = (raw: string): void => {
    const n = Number(raw);
    let next: number | undefined;
    if (raw.trim() === "" || !Number.isFinite(n)) {
      next = undefined;
    } else {
      const clamped = Math.min(max, Math.max(min, Math.round(n)));
      next = clamped === defaultValue ? undefined : clamped;
    }
    // Record our own commit so the prop change it causes does not reset the text mid-typing.
    setLastValue(next);
    onCommit(next);
  };
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="text-xs text-slate-600">
        {label}
      </label>
      <input
        id={id}
        type="number"
        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
        min={min}
        max={max}
        step={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => setText(String(value ?? defaultValue))}
        aria-describedby={`${id}-unit`}
      />
      <span id={`${id}-unit`} className="text-xs text-slate-600">
        {unit} (default {defaultValue})
      </span>
    </div>
  );
}

export function RulesSection(props: {
  rulesFile: RulesFile;
  config: RuleConfig;
  onChange: (next: RuleConfig) => void;
}): JSX.Element {
  const { rulesFile, config, onChange } = props;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  // Undeterminable ("Semi") rules are never reported, so they are not offered here.
  const reportable = useMemo(() => rulesFile.rules.filter((r) => r.type !== "Semi"), [rulesFile]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reportable.filter((r) => {
      if (category && r.category !== category) return false;
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.check.toLowerCase().includes(q) ||
        r.wcag.criterion.includes(q) ||
        r.wcag.name.toLowerCase().includes(q)
      );
    });
  }, [reportable, query, category]);

  const setEnabled = (id: string, enabled: boolean): void => {
    const disabled = enabled ? config.disabled.filter((x) => x !== id) : config.disabled.includes(id) ? config.disabled : [...config.disabled, id];
    onChange({ ...config, disabled });
  };

  const setAll = (enabled: boolean): void => {
    const ids = visible.map((r) => r.id);
    const disabled = enabled
      ? config.disabled.filter((x) => !ids.includes(x))
      : Array.from(new Set([...config.disabled, ...ids]));
    onChange({ ...config, disabled });
  };

  /** Store a threshold; `undefined` removes the override so the rule's default applies. */
  const setThreshold = (ruleId: string, key: string, value: number | undefined): void => {
    const thresholds: RuleConfig["thresholds"] = { ...config.thresholds };
    const current = { ...(thresholds[ruleId] ?? {}) };
    if (value === undefined) delete current[key];
    else current[key] = value;
    if (Object.keys(current).length === 0) delete thresholds[ruleId];
    else thresholds[ruleId] = current;
    onChange({ ...config, thresholds });
  };

  const enabledCount = reportable.filter((r) => isRuleEnabled(r, config)).length;

  return (
    <Section
      id="rules"
      title="Rules"
      description={`Rule set version ${rulesFile.version} (WCAG ${rulesFile.wcagVersion}). Disabled rules are skipped by the extension and, through the exported configuration, by CI.`}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
        <div>
          <label htmlFor="rule-search" className="block text-sm font-medium text-slate-800">
            Filter rules
          </label>
          <input
            id="rule-search"
            type="search"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by id, description or WCAG criterion"
          />
        </div>
        <SelectField
          id="rule-category"
          label="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: "", label: "All categories" }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAll(true)}>Enable shown</Button>
        <Button onClick={() => setAll(false)}>Disable shown</Button>
        <p className="text-xs text-slate-500" aria-live="polite">
          Showing {visible.length} of {reportable.length} rules · {enabledCount} enabled
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <caption className="sr-only">Accessibility rules with their WCAG mapping, severity and enabled state</caption>
          <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">
                Enabled
              </th>
              <th scope="col" className="px-3 py-2">
                Id
              </th>
              <th scope="col" className="px-3 py-2">
                Check
              </th>
              <th scope="col" className="px-3 py-2">
                WCAG
              </th>
              <th scope="col" className="px-3 py-2">
                Level
              </th>
              <th scope="col" className="px-3 py-2">
                Type
              </th>
              <th scope="col" className="px-3 py-2">
                Severity
              </th>
              <th scope="col" className="px-3 py-2">
                Threshold
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                  No rules match the current filter.
                </td>
              </tr>
            ) : null}
            {visible.map((r) => {
              const enabled = isRuleEnabled(r, config);
              const fields = THRESHOLD_FIELDS[r.id];
              const checkboxId = `rule-${r.id}`;
              return (
                <tr key={r.id} className={`border-t border-slate-200 ${enabled ? "" : "bg-slate-50 text-slate-500"}`}>
                  <td className="px-3 py-2 align-top">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className="h-4 w-4 accent-blue-700"
                      checked={enabled}
                      disabled={!r.enabled}
                      title={r.enabled ? undefined : "Disabled in the rules file"}
                      aria-label={`Enable ${r.id}: ${r.check}`}
                      onChange={(e) => setEnabled(r.id, e.target.checked)}
                    />
                  </td>
                  <th scope="row" className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs font-semibold text-slate-800">
                    {r.id}
                  </th>
                  <td className="px-3 py-2 align-top">
                    {r.check}
                    <span className="block text-xs text-slate-500">{r.category}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {r.docsUrl ? (
                      <a href={r.docsUrl} target="_blank" rel="noreferrer noopener" className="text-blue-700 underline">
                        {wcagLabel(r)}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      wcagLabel(r)
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">{r.wcag.level}</td>
                  <td className="px-3 py-2 align-top">{r.type}</td>
                  <td className="px-3 py-2 align-top">
                    {r.severity ? (
                      <span className="inline-flex items-center gap-1">
                        <span className={`sev-dot sev-${r.severity}`} aria-hidden="true" />
                        {r.severity}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {fields
                      ? fields.map((f) => (
                          <ThresholdInput
                            key={f.key}
                            id={`threshold-${r.id}-${f.key}`}
                            label={f.label}
                            unit={f.unit}
                            min={f.min}
                            max={f.max}
                            defaultValue={f.default}
                            value={config.thresholds[r.id]?.[f.key]}
                            onCommit={(v) => setThreshold(r.id, f.key, v)}
                          />
                        ))
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
