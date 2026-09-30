import type { JSX } from "react";
import type { Settings, WcagLevel, WcagVersion } from "@shared/types";
import { Section, Fieldset, Checkbox, TextField } from "./ui";

const LEVELS: Array<{ value: WcagLevel; label: string; hint: string }> = [
  { value: "A", label: "Level A", hint: "Minimum conformance." },
  { value: "AA", label: "Level AA", hint: "Recommended target for most products (default)." },
  { value: "AAA", label: "Level AAA", hint: "Also runs enhanced contrast and focus checks." },
];

const VERSIONS: Array<{ value: WcagVersion; hint: string }> = [
  { value: "2.2", hint: "Current recommendation (default). Adds target size, focus not obscured, accessible authentication." },
  { value: "2.1", hint: "Adds reflow, non-text contrast, text spacing, label in name, status messages." },
  { value: "2.0", hint: "Original 2008 success criteria only (e.g. older Section 508 / EN 301 549 baselines)." },
];

export function GeneralSection(props: { settings: Settings; onChange: (patch: Partial<Settings>) => void }): JSX.Element {
  const { settings, onChange } = props;
  return (
    <Section id="general" title="General" description="Conformance target and scan behaviour.">
      <Fieldset legend="WCAG version">
        {VERSIONS.map((v) => {
          const id = `wcag-version-${v.value.replace(".", "-")}`;
          return (
            <div key={v.value} className="flex items-start gap-2">
              <input
                id={id}
                type="radio"
                name="wcagVersion"
                value={v.value}
                className="mt-0.5 h-4 w-4 accent-blue-700"
                checked={settings.wcagVersion === v.value}
                onChange={() => onChange({ wcagVersion: v.value })}
                aria-describedby={`${id}-hint`}
              />
              <div>
                <label htmlFor={id} className="text-sm text-slate-800">
                  WCAG {v.value}
                </label>
                <p id={`${id}-hint`} className="text-xs text-slate-500">
                  {v.hint}
                </p>
              </div>
            </div>
          );
        })}
      </Fieldset>

      <Fieldset legend="WCAG conformance level">
        {LEVELS.map((l) => {
          const id = `wcag-level-${l.value}`;
          return (
            <div key={l.value} className="flex items-start gap-2">
              <input
                id={id}
                type="radio"
                name="wcagLevel"
                value={l.value}
                className="mt-0.5 h-4 w-4 accent-blue-700"
                checked={settings.wcagLevel === l.value}
                onChange={() => onChange({ wcagLevel: l.value })}
                aria-describedby={`${id}-hint`}
              />
              <div>
                <label htmlFor={id} className="text-sm text-slate-800">
                  {l.label}
                </label>
                <p id={`${id}-hint`} className="text-xs text-slate-500">
                  {l.hint}
                </p>
              </div>
            </div>
          );
        })}
      </Fieldset>

      <Fieldset legend="Scan behaviour">
        <Checkbox
          id="include-best-practices"
          label="Include best-practice checks"
          hint="Best-practice findings never count toward the conformance label; they are weighted as Minor in the score."
          checked={settings.includeBestPractices}
          onChange={(v) => onChange({ includeBestPractices: v })}
        />
        <Checkbox
          id="axe-only"
          label="axe-core rules only"
          hint="Skip the extension's own rules (alpha-blended contrast, focus indicators, text spacing, target spacing, reflow, alt and link quality…) and run only axe-core, so results line up with axe DevTools."
          checked={settings.axeOnly}
          onChange={(v) => onChange({ axeOnly: v })}
        />
        <Checkbox
          id="auto-rescan"
          label="Automatically rescan when the page changes"
          hint="Rescans after route changes, dialogs opening, or large DOM updates in single-page apps. When off, the side panel shows a “Page changed” banner instead."
          checked={settings.autoRescan}
          onChange={(v) => onChange({ autoRescan: v })}
        />
      </Fieldset>

      <TextField
        id="environment"
        label="Environment name"
        value={settings.environment}
        onChange={(v) => onChange({ environment: v })}
        placeholder="e.g. staging, UAT, prod"
        hint="Recorded in reports so results from different environments can be told apart."
      />
      <TextField
        id="report-organisation"
        label="Organisation on reports"
        value={settings.reportOrganisation}
        onChange={(v) => onChange({ reportOrganisation: v })}
        placeholder="e.g. Acme Ltd"
        hint="The client or company name shown at the top of HTML reports. Leave empty to hide it."
      />
      <TextField
        id="report-prepared-by"
        label="Prepared by"
        value={settings.reportPreparedBy}
        onChange={(v) => onChange({ reportPreparedBy: v })}
        placeholder="e.g. QA team"
        hint="Your name or team, shown at the top of HTML reports. Leave empty to hide it."
      />
    </Section>
  );
}
