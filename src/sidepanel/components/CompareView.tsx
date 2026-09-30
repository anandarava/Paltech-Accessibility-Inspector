import { useEffect, useId, useMemo, useState } from "react";
import type { Issue, SavedScan, ScanResult, ScanSummary } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { SEVERITIES, useStore, type CompareSide } from "@src/sidepanel/store";
import { useFocusHeading } from "@src/sidepanel/hooks/useFocusHeading";
import { Button } from "./Button";
import { SeverityLabel } from "./SeverityLabel";

interface Loaded {
  label: string;
  result: ScanResult;
}

const SUMMARY_ROWS: Array<{ key: keyof ScanSummary; label: string }> = [
  { key: "critical", label: "Critical" },
  { key: "serious", label: "Serious" },
  { key: "moderate", label: "Moderate" },
  { key: "minor", label: "Minor" },
  { key: "bestPractice", label: "Best practice" },
];

function delta(n: number): string {
  if (n === 0) return "±0";
  return n > 0 ? `+${n}` : String(n);
}

/** Only issues that count: open statuses. */
function activeIssues(r: ScanResult): Issue[] {
  return r.issues.filter((i) => i.status === "new");
}

function IssueRows({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return <p className="px-1 py-1 text-xs text-slate-600">None.</p>;
  const sorted = [...issues].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.title.localeCompare(b.title));
  return (
    <ul className="text-xs">
      {sorted.map((i) => (
        <li key={i.fingerprint} className="border-b border-slate-100 px-1 py-1">
          <span className="block text-slate-900">
            <span className="font-mono text-slate-700">{i.ruleId}</span> {i.title}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <SeverityLabel issue={i} />
            <code className="truncate font-mono text-[11px] text-slate-600">{i.element.selector}</code>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Side-by-side comparison of two scans by issue fingerprint (new / fixed / unchanged). */
export function CompareView({ onBack }: { onBack(): void }) {
  const id = useId();
  const compare = useStore((s) => s.compare);
  const live = useStore((s) => (s.viewingSaved ? s.liveResult : s.result));
  const headingRef = useFocusHeading<HTMLHeadingElement>([]);
  const [sides, setSides] = useState<[Loaded, Loaded] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!compare) return;
    let cancelled = false;
    const load = async (side: CompareSide): Promise<Loaded> => {
      if (side.kind === "current") {
        if (!live) throw new Error("There is no current scan to compare.");
        return { label: "Current scan", result: live };
      }
      const res = await sendToBackground<SavedScan>({ type: "SAVED_SCAN_GET", id: side.id });
      if (!res.ok || !res.data) throw new Error(res.error ?? "Saved scan not found.");
      return { label: res.data.meta.name, result: res.data.result };
    };
    Promise.all([load(compare.a), load(compare.b)])
      .then(([a, b]) => {
        if (cancelled) return;
        // Older scan on the left so "new" / "fixed" read naturally.
        const ordered: [Loaded, Loaded] = new Date(a.result.timestamp) <= new Date(b.result.timestamp) ? [a, b] : [b, a];
        setSides(ordered);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [compare, live]);

  const diff = useMemo(() => {
    if (!sides) return null;
    const [a, b] = sides;
    const aIssues = activeIssues(a.result);
    const bIssues = activeIssues(b.result);
    const aFp = new Set(aIssues.map((i) => i.fingerprint));
    const bFp = new Set(bIssues.map((i) => i.fingerprint));
    return {
      added: bIssues.filter((i) => !aFp.has(i.fingerprint)),
      fixed: aIssues.filter((i) => !bFp.has(i.fingerprint)),
      unchanged: bIssues.filter((i) => aFp.has(i.fingerprint)),
    };
  }, [sides]);

  return (
    <section aria-labelledby={`${id}-h`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-slate-300 px-3 py-2">
        <Button size="sm" onClick={onBack} aria-label="Back to saved scans">
          ← Back
        </Button>
        <h2 id={`${id}-h`} ref={headingRef} tabIndex={-1} className="text-base font-semibold text-slate-900">
          Compare scans
        </h2>
      </div>
      {error && (
        <p role="alert" className="px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {!sides && !error && <p className="px-3 py-2 text-sm text-slate-700">Loading…</p>}
      {sides && diff && (
        <>
          <table className="mx-3 my-2 text-xs">
            <caption className="sr-only">Summary of both scans</caption>
            <thead>
              <tr className="text-left">
                <th scope="col" className="pr-3 font-medium text-slate-700">
                  <span className="sr-only">Measure</span>
                </th>
                <th scope="col" className="pr-3 font-semibold text-slate-900">
                  Before: {sides[0].label}
                  <span className="block font-normal text-slate-600">{new Date(sides[0].result.timestamp).toLocaleString()}</span>
                </th>
                <th scope="col" className="pr-3 font-semibold text-slate-900">
                  After: {sides[1].label}
                  <span className="block font-normal text-slate-600">{new Date(sides[1].result.timestamp).toLocaleString()}</span>
                </th>
                <th scope="col" className="font-semibold text-slate-900">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="pr-3 text-left font-medium text-slate-700">
                  Score
                </th>
                <td className="tabular-nums">{sides[0].result.score}</td>
                <td className="tabular-nums">{sides[1].result.score}</td>
                <td className="tabular-nums">{delta(Math.round((sides[1].result.score - sides[0].result.score) * 10) / 10)}</td>
              </tr>
              {SUMMARY_ROWS.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="pr-3 text-left font-medium text-slate-700">
                    {r.label}
                  </th>
                  <td className="tabular-nums">{sides[0].result.summary[r.key]}</td>
                  <td className="tabular-nums">{sides[1].result.summary[r.key]}</td>
                  <td className="tabular-nums">{delta(sides[1].result.summary[r.key] - sides[0].result.summary[r.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sides[0].result.url !== sides[1].result.url && (
            <p className="mx-3 mb-2 rounded border border-amber-700 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              These scans are of different URLs, so most issues will show as new / fixed.
            </p>
          )}
          <div className="px-2 pb-3">
            <details open className="mb-2">
              <summary className="cursor-pointer px-1 text-sm font-semibold text-red-800">New issues ({diff.added.length})</summary>
              <IssueRows issues={diff.added} />
            </details>
            <details open className="mb-2">
              <summary className="cursor-pointer px-1 text-sm font-semibold text-green-800">Fixed issues ({diff.fixed.length})</summary>
              <IssueRows issues={diff.fixed} />
            </details>
            <details className="mb-2">
              <summary className="cursor-pointer px-1 text-sm font-semibold text-slate-800">Unchanged ({diff.unchanged.length})</summary>
              <IssueRows issues={diff.unchanged} />
            </details>
          </div>
        </>
      )}
    </section>
  );
}
