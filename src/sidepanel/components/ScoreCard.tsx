import type { IssueSource, Severity } from "@shared/types";
import { SEVERITIES, useStore, type ResultTab } from "@src/sidepanel/store";
import { SeverityDonut } from "./SeverityDonut";
import { AlertCircleIcon } from "./icons";

/** Tinted tile per severity: [open: border + background + text, zero: softer border + background]. Text is dark on the tint (>= 4.5:1). */
const TILE: Record<Severity, { open: string; zero: string; dot: string }> = {
  Critical: { open: "border-red-300 bg-red-50 text-red-900", zero: "border-red-100 bg-red-50/40 text-slate-700", dot: "" },
  Serious: { open: "border-orange-300 bg-orange-50 text-orange-900", zero: "border-orange-100 bg-orange-50/40 text-slate-700", dot: "" },
  Moderate: { open: "border-yellow-300 bg-yellow-50 text-yellow-900", zero: "border-yellow-100 bg-yellow-50/40 text-slate-700", dot: "" },
  Minor: { open: "border-slate-300 bg-slate-100 text-slate-800", zero: "border-slate-200 bg-slate-50 text-slate-700", dot: "" },
};

function TileIcon({ sev }: { sev: Severity }) {
  if (sev === "Critical") return <AlertCircleIcon size={20} />;
  return <span className={`sev-dot sev-${sev} h-4! w-4!`} aria-hidden="true" />;
}

/** Severity tile in the 2x2 grid beside the donut; a count above zero filters the list. */
function SeverityTile({ sev, value, pressed, onSelect }: { sev: Severity; value: number; pressed: boolean; onSelect(): void }) {
  const base = "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px]";
  const body = (
    <>
      <TileIcon sev={sev} />
      <span className="min-w-0">
        <span className="block leading-tight">{sev}</span>
        <span className="block text-xl leading-tight font-bold tabular-nums">{value}</span>
      </span>
    </>
  );
  if (value === 0) {
    return <li className={`${base} ${TILE[sev].zero}`}>{body}</li>;
  }
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={pressed}
        aria-label={`${sev}: ${value}. Show these issues`}
        className={`${base} w-full hover:brightness-95 ${TILE[sev].open} ${pressed ? "ring-2 ring-blue-600 ring-offset-1" : ""}`}
      >
        {body}
      </button>
    </li>
  );
}

interface StatProps {
  value: number;
  label: string;
  hint: string;
  pressed: boolean;
  onSelect(): void;
  /** Accessible name of the button, e.g. "Best practice: 2. Show these issues". */
  name: string;
  accent?: boolean;
}

/** A number that filters the list, or a plain 0 when there is nothing to show. */
function StatNumber({ value, pressed, onSelect, name, accent }: Omit<StatProps, "label" | "hint">) {
  if (value === 0) return <span className="text-lg font-bold tabular-nums text-slate-600">0</span>;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={pressed}
      aria-label={name}
      className={`rounded px-0.5 text-lg font-bold tabular-nums underline-offset-2 hover:underline ${pressed ? "bg-blue-100 text-blue-900" : accent ? "text-blue-800" : "text-slate-900"}`}
    >
      {value}
    </button>
  );
}

/** One cell of the row under the donut: number on top, label below. */
function Stat(props: StatProps) {
  return (
    <li className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-center" title={props.hint}>
      <StatNumber {...props} />
      <span className="block text-[11.5px] leading-tight text-slate-600">{props.label}</span>
    </li>
  );
}

/** Lighthouse score bands; the label keeps the meaning from being colour-only. */
function scoreBand(score: number): { label: string; className: string } {
  if (score >= 90) return { label: "Good", className: "border-green-200 bg-green-100 text-green-900" };
  if (score >= 50) return { label: "Needs improvement", className: "border-amber-300 bg-amber-100 text-amber-900" };
  return { label: "Poor", className: "border-red-300 bg-red-100 text-red-900" };
}

export function ScoreCard() {
  const result = useStore((s) => s.result);
  const filters = useStore((s) => s.filters);
  const tab = useStore((s) => s.resultTab);
  const setFilters = useStore((s) => s.setFilters);
  const setResultTab = useStore((s) => s.setResultTab);

  if (!result) {
    return (
      <section aria-label="Scan summary" className="border-b border-slate-300 px-3 py-3 text-sm text-slate-700">
        No scan yet. Choose a WCAG level and press <strong>Scan full page</strong> to check the current tab.
      </section>
    );
  }

  // Totals follow axe DevTools: every open issue (best practices included) counts once;
  // baselined and ignored issues are listed separately and excluded from the total.
  const active = result.issues.filter((i) => i.status === "new");
  const excluded = result.issues.filter((i) => i.status === "baselined" || i.status === "ignored").length;
  const bySource = (s: IssueSource) => active.filter((i) => i.source === s).length;
  const bySeverity = (s: Severity) => active.filter((i) => i.severity === s).length;
  const bestPractice = active.filter((i) => i.wcag.level === "BP").length;

  const show = (patch: Partial<typeof filters>, nextTab: ResultTab = "all") => {
    setFilters({ severities: [], categories: [], sources: [], search: "", statuses: ["new"], ...patch });
    setResultTab(nextTab);
  };
  const noNarrowing = filters.severities.length === 0 && filters.categories.length === 0 && filters.search === "";
  const onlySource = (s: IssueSource) => tab === "all" && noNarrowing && filters.sources.length === 1 && filters.sources[0] === s;
  const onlySeverity = (s: Severity) =>
    tab === "all" && filters.sources.length === 0 && filters.categories.length === 0 && filters.search === "" && filters.severities.length === 1 && filters.severities[0] === s;

  const { unscannedFrames } = result;

  const excludedPressed = tab === "all" && filters.statuses.length === 2 && filters.statuses.includes("ignored") && filters.statuses.includes("baselined");

  return (
    <section aria-labelledby="summary-heading" className="border-b border-slate-300 px-3 py-2">
      <h2 id="summary-heading" className="sr-only">
        Issue summary
      </h2>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <SeverityDonut
            counts={{ Critical: bySeverity("Critical"), Serious: bySeverity("Serious"), Moderate: bySeverity("Moderate"), Minor: bySeverity("Minor") }}
            total={active.length}
            onSelectTotal={() => show({})}
            onSelectSeverity={(sev) => show({ severities: [sev] })}
          />
          <ul aria-label="Open issues by severity" className="grid min-w-[13rem] flex-1 grid-cols-2 gap-2">
            {SEVERITIES.map((sev) => (
              <SeverityTile key={sev} sev={sev} value={bySeverity(sev)} pressed={onlySeverity(sev)} onSelect={() => show({ severities: [sev] })} />
            ))}
          </ul>
        </div>

        <ul aria-label="More counts" className="mt-2 grid grid-cols-3 gap-2">
          <li className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-center" title="Found by axe-core rules / found by the extension's own advanced rules">
            <span className="text-lg font-bold tabular-nums">
              <StatNumber value={bySource("axe")} pressed={onlySource("axe")} onSelect={() => show({ sources: ["axe"] })} name={`axe-core: ${bySource("axe")}. Show these issues`} />
              <span className="px-0.5 font-normal text-slate-400" aria-hidden="true">/</span>
              <StatNumber value={bySource("custom")} pressed={onlySource("custom")} onSelect={() => show({ sources: ["custom"] })} name={`Advanced rules: ${bySource("custom")}. Show these issues`} />
            </span>
            <span className="block text-[11.5px] leading-tight text-slate-600">axe-core / advanced</span>
          </li>
          <Stat
            value={bestPractice}
            label="Best practice"
            hint="Recommendations that are not WCAG failures (included in the total)"
            pressed={tab === "bp"}
            onSelect={() => show({}, "bp")}
            name={`Best practice: ${bestPractice}. Show these issues`}
          />
          <Stat
            value={excluded}
            label="Excluded"
            hint="Issues you ignored or added to the baseline; not counted in the total"
            pressed={excludedPressed}
            onSelect={() => show({ statuses: ["ignored", "baselined"] })}
            name={`Excluded (ignored or baselined): ${excluded}. Show these issues`}
            accent
          />
        </ul>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-700">
        <span
          className={`inline-flex items-baseline gap-1 rounded-full border px-2.5 py-0.5 font-medium ${scoreBand(result.score).className}`}
          title="Share of the rules that applied to this page which passed, with more serious rules counting more: passed rule weight ÷ all applicable rule weight. Weights: Critical 10, Serious 7, Moderate 3, Minor 1."
        >
          Accessibility score <strong className="tabular-nums">{result.score}</strong> / 100 · {scoreBand(result.score).label}
        </span>
        {result.notConformant ? (
          <span className="rounded-full border border-red-700 bg-white px-2.5 py-0.5 font-semibold text-red-800">Not conformant (WCAG {result.wcagLevel})</span>
        ) : (
          <span className="rounded-full border border-green-700 bg-white px-2.5 py-0.5 font-medium text-green-800">No critical WCAG issues</span>
        )}
        <span className="font-medium text-green-800">
          <span aria-hidden="true">✓ </span>
          {result.passedRules.length} rules passed
        </span>
        {result.axeOnly && <span>axe-core rules only</span>}
      </p>
      {unscannedFrames.length > 0 && (
        <p className="text-[11px] text-amber-900">
          {unscannedFrames.length} frame{unscannedFrames.length === 1 ? "" : "s"} could not be scanned (cross-origin).
        </p>
      )}
    </section>
  );
}
