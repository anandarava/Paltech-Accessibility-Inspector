import { useId, type ReactNode } from "react";
import { useStore } from "@src/sidepanel/store";
import { useChangeSettings } from "@src/sidepanel/hooks/useChangeSettings";
import { Button } from "./Button";
import { useStartScan } from "./ScanButton";
import { ScopeSelectorFields, useScopeSelector } from "./ScopeSelector";
import { LandingIllustration } from "./EmptyState";
import { KeyboardIcon, LightbulbIcon, MonitorIcon, PartOfPageIcon, PlayIcon, ClockIcon } from "./icons";
import { SelectMenu, WCAG_LEVEL_OPTIONS, WCAG_VERSION_OPTIONS, type SelectOption } from "./SelectMenu";

const SCAN_TYPE_OPTIONS: Array<SelectOption<"page" | "selector">> = [
  {
    value: "page",
    label: "Full page",
    description: "Scan everything on the page",
    leading: <MonitorIcon size={16} className="text-slate-700" />,
  },
  {
    value: "selector",
    label: "Part of page",
    description: "Scan one element and its contents",
    leading: <PartOfPageIcon size={16} className="text-slate-700" />,
  },
];

/** A visible label above a full-width SelectMenu. */
function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  triggerContent,
}: {
  id: string;
  label: string;
  value: T;
  options: Array<SelectOption<T>>;
  onChange(value: T): void;
  disabled?: boolean;
  triggerContent?: ReactNode;
}) {
  return (
    <div>
      <span id={`${id}-lbl`} className="mb-1 block text-xs font-semibold text-slate-800">
        {label}
      </span>
      <SelectMenu
        id={id}
        label={label}
        labelledBy={`${id}-lbl`}
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        triggerContent={triggerContent}
        fullWidth
      />
    </div>
  );
}

/**
 * Initial view of the side panel, before the first scan of a tab: choose the scan
 * type and WCAG settings, then start. The settings are the same ones as in the header.
 */
export function LandingView({ getInspectedSelector }: { getInspectedSelector?(): Promise<string | null> }) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const settings = useStore((s) => s.settings);
  const scanning = useStore((s) => s.scanning);
  const setView = useStore((s) => s.setView);
  const changeSettings = useChangeSettings();
  const startScan = useStartScan();
  const state = useScopeSelector(getInspectedSelector);
  const { scope, setScope, choosePart } = state;

  const partial = scope.kind === "selector";
  const needsSelector = partial && !scope.selector;
  const noTab = tabId === null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-blue-50 to-white p-3">
      <section aria-labelledby={`${id}-h`} className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div aria-hidden="true" className="flex h-36 w-36 items-center justify-center rounded-full bg-blue-100">
            <LandingIllustration />
          </div>
          <h2 id={`${id}-h`} className="mt-4 text-lg font-bold text-slate-900">
            Scan your page for accessibility issues
          </h2>
          <p className="mt-1 text-sm text-slate-700">Choose a scan type and configure the settings to start the scan.</p>
        </div>

        {noTab && (
          <p role="status" className="mt-4 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            No active tab detected. Open a regular web page in this window to scan it.
          </p>
        )}

        <div className="mt-4 space-y-3 rounded-xl border border-slate-300 bg-white p-3">
          <SelectField
            id={`${id}-type`}
            label="Scan type"
            value={partial ? "selector" : "page"}
            options={SCAN_TYPE_OPTIONS}
            triggerContent={
              <>
                {partial ? <PartOfPageIcon size={16} className="text-slate-700" /> : <MonitorIcon size={16} className="text-slate-700" />}
                {partial ? "Part of page" : "Full page"}
              </>
            }
            onChange={(v) => (v === "page" ? setScope({ kind: "page" }) : choosePart())}
            disabled={scanning}
          />

          {partial && <ScopeSelectorFields state={state} className="rounded-md bg-slate-50 p-2" />}

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              id={`${id}-version`}
              label="WCAG version"
              value={settings.wcagVersion}
              options={WCAG_VERSION_OPTIONS}
              onChange={(v) => void changeSettings({ wcagVersion: v }, "WCAG version")}
              disabled={scanning}
            />
            <SelectField
              id={`${id}-level`}
              label="Level"
              value={settings.wcagLevel}
              options={WCAG_LEVEL_OPTIONS}
              triggerContent={`Level ${settings.wcagLevel}`}
              onChange={(v) => void changeSettings({ wcagLevel: v }, "WCAG level")}
              disabled={scanning}
            />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <label className="flex items-center gap-1.5 text-sm text-slate-800" title="Include best-practice rules in scans">
              <input
                type="checkbox"
                checked={settings.includeBestPractices}
                onChange={(e) => void changeSettings({ includeBestPractices: e.target.checked }, "best-practice setting")}
                disabled={scanning}
              />
              Best practices
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-800" title="Run only axe-core rules, for results comparable with axe DevTools">
              <input
                type="checkbox"
                checked={settings.axeOnly}
                onChange={(e) => void changeSettings({ axeOnly: e.target.checked }, "axe-core only setting")}
                disabled={scanning}
              />
              axe-core only
            </label>
          </div>

          <div className="flex gap-2 rounded-md border border-blue-100 bg-blue-50 p-2.5 text-xs text-slate-800">
            <LightbulbIcon size={16} className="mt-0.5 text-blue-700" />
            <p>
              The scan will analyze {partial ? "only the selected part of the page" : "the entire page"} and check for accessibility issues based on the
              selected WCAG version and level.
            </p>
          </div>

          <Button
            variant="primary"
            size="md"
            className="w-full py-2.5"
            onClick={() => void startScan()}
            disabled={noTab || scanning || needsSelector}
            aria-describedby={needsSelector ? `${id}-need` : undefined}
          >
            <PlayIcon size={12} />
            {scanning ? "Scanning…" : "Start scan"}
          </Button>
          {needsSelector && (
            <p id={`${id}-need`} className="text-center text-xs text-slate-700">
              Pick an element on the page to scan part of it.
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Button variant="ghost" size="action" onClick={() => setView("keyboard")} disabled={noTab}>
            <KeyboardIcon /> Keyboard test
          </Button>
          <Button variant="ghost" size="action" onClick={() => setView("saved")}>
            <ClockIcon /> Saved scans
          </Button>
        </div>
      </section>
    </div>
  );
}
