import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Issue, ScanResult } from "@shared/types";
import { contrastRatio, parseColor } from "@shared/color";
import { sendToBackground, sendToTab } from "@shared/messages";
import { wcagDocsUrl } from "@shared/wcag-map";
import { issueNumbers, matchesFilters, ruleGroupKey, useStore } from "@src/sidepanel/store";
import { sendToPage } from "@src/sidepanel/hooks/messaging";
import { applyEvidence } from "@src/sidepanel/hooks/useBackgroundEvents";
import { useFocusHeading } from "@src/sidepanel/hooks/useFocusHeading";
import { BackButton } from "./BackButton";
import { Button } from "./Button";
import { ColorSwatch } from "./ColorSwatch";
import { ReasonForm } from "./ReasonForm";
import { StatusLabel } from "./SeverityLabel";

interface Props {
  issueId: string;
  onBack(): void;
  /** Present only inside DevTools: reveals the element in the Elements panel. */
  onInspect?(selector: string): void;
  /** Two-pane layout: the list stays visible, so "Back" reads "Close". */
  wide?: boolean;
}

/** Plain-text summary of an issue for pasting into chat, a bug tracker or an email. */
export function issueAsText(issue: Issue, result: ScanResult | undefined): string {
  const wcag =
    issue.wcag.level === "BP" ? "Best practice (not a WCAG failure)" : `WCAG ${issue.wcag.criterion} ${issue.wcag.name} (Level ${issue.wcag.level})`;
  const docs = issue.fix.docsUrl ?? wcagDocsUrl(issue.wcag.criterion);
  const lines = [
    `[${issue.severity}] ${issue.title} (${issue.ruleId})`,
    wcag,
    result ? `Page: ${result.title ? `${result.title} – ` : ""}${result.url}` : "",
    issue.description ? `Details: ${issue.description}` : "",
    `Element: ${issue.element.selector}`,
    `HTML: ${issue.element.html}`,
    `How to fix: ${issue.fix.summary}`,
    issue.fix.suggestedValue ? `Suggested value: ${issue.fix.suggestedValue}` : "",
    docs ? `Learn more: ${docs}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

type PendingForm = "ignore" | "baseline" | null;

const CONTRAST_KEYS = new Set(["foreground", "background", "ratio", "required", "suggested", "suggestedRatio", "suggestedColor"]);

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
/**
 * Extract a bare colour from a value that may be a CSS declaration such as
 * `color: #767676` or `box-shadow colour: #1a1a1a` (what the contrast and
 * focus-visible rules put in `fix.suggestedValue`). Returns undefined when the
 * result is not a parseable colour, so the swatch never receives invalid CSS.
 */
function asColor(v: unknown): string | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const colon = s.indexOf(":");
  const candidate = (colon >= 0 ? s.slice(colon + 1) : s).trim().replace(/;$/, "").trim();
  return candidate && parseColor(candidate) ? candidate : undefined;
}
/** Contrast ratio between two CSS colour strings, or undefined when either cannot be parsed. */
function ratioBetween(a: string | undefined, b: string | undefined): number | undefined {
  if (!a || !b) return undefined;
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return undefined;
  return contrastRatio([pa[0], pa[1], pa[2]], [pb[0], pb[1], pb[2]]);
}
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Keys axe-core / the rules add for bookkeeping; shown under "Technical details", not as measurements. */
const TECHNICAL_KEYS = new Set(["checks", "tags", "axeRuleId", "impact", "ruleId", "question", "answer"]);
/** Internal values of the rules (how a measurement was taken), listed under "Technical details" too. */
const INTERNAL_KEYS = new Set(["canvas", "reachedOpaque", "textOpacity", "focusVisibleApplied", "frameUrl", "isIframe"]);

const SOURCE_LABEL: Record<Issue["source"], string> = { axe: "axe-core", custom: "PalTech A11y Inspector rule", manual: "Manual" };

/** Severity pill: tinted background, dark text (>= 4.5:1), coloured dot. */
const SEVERITY_PILL: Record<Issue["severity"], string> = {
  Critical: "border-red-200 bg-red-50 text-red-900",
  Serious: "border-orange-200 bg-orange-50 text-orange-900",
  Moderate: "border-amber-200 bg-amber-50 text-amber-900",
  Minor: "border-slate-200 bg-slate-100 text-slate-800",
};

/** Left stripe colour of the header, matching the severity dots. */
const SEVERITY_STRIPE: Record<Issue["severity"], string> = {
  Critical: "var(--sev-critical)",
  Serious: "var(--sev-serious)",
  Moderate: "var(--sev-moderate)",
  Minor: "var(--sev-minor)",
};

/** "fontSize" -> "Font size", "textOpacity" -> "Text opacity". */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Readable value: units for sizes and ratios, Yes/No for booleans, lists joined. */
function displayValue(key: string, v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    if (/ratio|contrast/i.test(key)) return `${v}:1`;
    if (/size|width|height|spacing|offset|px/i.test(key)) return `${v} px`;
    return String(v);
  }
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  return formatValue(v);
}

/** Messages of the axe checks that failed, without duplicates. */
function checkMessages(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const c of v) {
    const m = c && typeof c === "object" ? (c as { message?: unknown }).message : undefined;
    if (typeof m === "string" && m.trim()) out.add(m.trim());
  }
  return [...out];
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">{children}</h3>;
}

export function IssueDetail({ issueId, onBack, onInspect, wide = false }: Props) {
  const tabId = useStore((s) => s.tabId);
  const result = useStore((s) => s.result);
  const filters = useStore((s) => s.filters);
  const tab = useStore((s) => s.resultTab);
  const selectIssue = useStore((s) => s.selectIssue);
  const updateIssues = useStore((s) => s.updateIssues);
  const showToast = useStore((s) => s.showToast);
  const readOnly = useStore((s) => s.viewingSaved !== null);
  const autoHighlight = useStore((s) => s.autoHighlight);
  const setAutoHighlight = useStore((s) => s.setAutoHighlight);
  const headingRef = useFocusHeading<HTMLHeadingElement>([]); // first open only: stepping Prev/Next must keep focus on the stepper
  const [form, setForm] = useState<PendingForm>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const issue: Issue | undefined = result?.issues.find((i) => i.id === issueId);
  const number = useMemo(() => issueNumbers(result).get(issueId) ?? 0, [result, issueId]);

  // Other instances of the same rule, in list order, honouring the active tab and filters.
  const siblings = useMemo(() => {
    if (!result || !issue) return [];
    const key = ruleGroupKey(issue);
    const list = result.issues.filter((i) => ruleGroupKey(i) === key && matchesFilters(i, filters, tab));
    return list.some((i) => i.id === issue.id) ? list : result.issues.filter((i) => ruleGroupKey(i) === key);
  }, [result, issue, filters, tab]);
  const position = siblings.findIndex((i) => i.id === issueId);

  const issueKey = issue?.id;

  // Leaving the detail view (Back, Close, another view) stops the pulsing outline on the page.
  // Opening another issue needs no clear: the next highlight moves the outline.
  const tabRef = useRef(tabId);
  tabRef.current = tabId;
  useEffect(
    () => () => {
      const t = tabRef.current;
      if (t !== null) void sendToTab(t, { type: "CLEAR_ISSUE_FOCUS", tabId: t }, 0);
    },
    [],
  );

  // Scroll to and outline the element whenever a different issue is shown (axe "highlight").
  useEffect(() => {
    if (!autoHighlight || tabId === null || !issueKey || readOnly) return;
    void sendToPage(tabId, { type: "HIGHLIGHT_ISSUE", tabId, issueId: issueKey });
  }, [issueKey, autoHighlight, tabId, readOnly]);

  if (!issue) {
    return (
      <section className="p-3">
        <BackButton onClick={onBack} />
        <p className="mt-2 text-sm text-slate-700">This issue is no longer in the current result.</p>
      </section>
    );
  }

  const data = issue.data ?? {};
  const fg = asString(data.foreground);
  const bg = asString(data.background);
  const ratio = asNumber(data.ratio);
  const required = asNumber(data.required);
  // Prefer a bare colour emitted by the rule; fall back to the colour inside
  // the `property: #hex` declaration that fix.suggestedValue carries.
  const suggested = asColor(data.suggested) ?? asColor(data.suggestedColor) ?? asColor(issue.fix.suggestedValue);
  const suggestedRatio = asNumber(data.suggestedRatio) ?? ratioBetween(suggested, bg);
  const isContrast = Boolean(fg && bg);
  const measurements = Object.entries(data).filter(
    ([k, v]) => v !== undefined && v !== null && v !== "" && !TECHNICAL_KEYS.has(k) && !INTERNAL_KEYS.has(k) && !(isContrast && CONTRAST_KEYS.has(k)),
  );
  const internal = Object.entries(data).filter(([k, v]) => INTERNAL_KEYS.has(k) && v !== undefined && v !== null && v !== "");
  const checks = checkMessages(data.checks);
  const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === "string") : [];
  const axeRuleId = asString(data.axeRuleId);
  const impact = asString(data.impact);
  const hasTechnical = Boolean(checks.length || tags.length || axeRuleId || impact || internal.length);
  const learnMore = issue.fix.docsUrl ?? wcagDocsUrl(issue.wcag.criterion);
  const wcagHref = issue.wcag.level === "BP" ? undefined : wcagDocsUrl(issue.wcag.criterion);
  const bestPractice = issue.wcag.level === "BP";
  const ratioPasses = ratio !== undefined && required !== undefined ? ratio >= required : undefined;

  const locate = async () => {
    if (tabId === null) return;
    setBusy("locate");
    const res = await sendToPage(tabId, { type: "HIGHLIGHT_ISSUE", tabId, issueId: issue.id });
    setBusy(null);
    if (!res.ok) showToast({ kind: "error", message: `Could not locate element: ${res.error ?? "no response from page"}` });
  };

  const screenshot = async () => {
    if (tabId === null) return;
    setBusy("screenshot");
    showToast({ kind: "info", message: "Capturing screenshot…" });
    const res = await sendToBackground<Record<string, string>>({ type: "CAPTURE_EVIDENCE", tabId, issueIds: [issue.id] });
    setBusy(null);
    if (!res.ok) {
      showToast({ kind: "error", message: `Screenshot failed: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    if (res.data && typeof res.data === "object") applyEvidence(res.data);
  };

  const copyIssue = async () => {
    try {
      await navigator.clipboard.writeText(issueAsText(issue, result));
      showToast({ kind: "success", message: "Issue copied to clipboard." });
    } catch {
      showToast({ kind: "error", message: "Could not access the clipboard." });
    }
  };

  const copySelector = async () => {
    try {
      await navigator.clipboard.writeText(issue.element.selector);
      showToast({ kind: "success", message: "Selector copied to clipboard." });
    } catch {
      showToast({ kind: "error", message: "Could not access the clipboard. Select the selector text and copy it manually." });
    }
  };

  /** Undo Ignore / Add to baseline: the issue is open again here, in other tabs of the site and in future scans. */
  const restore = async () => {
    if (!result || (issue.status !== "ignored" && issue.status !== "baselined")) return;
    const kind = issue.status;
    setBusy("restore");
    const res = await sendToBackground({
      type: kind === "ignored" ? "IGNORE_REMOVE" : "BASELINE_REMOVE",
      origin: result.origin,
      fingerprints: [issue.fingerprint],
    });
    setBusy(null);
    if (!res.ok) {
      showToast({ kind: "error", message: `Could not restore the issue: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    // The service worker also rebroadcasts the updated result; apply it here so the counts change at once.
    updateIssues((i) => (i.fingerprint === issue.fingerprint ? { ...i, status: "new", reason: undefined } : i));
    showToast({ kind: "success", message: "Issue restored. It counts in the totals and score again." });
    headingRef.current?.focus();
  };

  const submitReason = async (kind: "ignore" | "baseline", reason: string) => {
    if (tabId === null) return;
    setBusy(kind);
    const res = await sendToBackground({
      type: kind === "ignore" ? "IGNORE_ADD" : "BASELINE_ADD",
      tabId,
      issueIds: [issue.id],
      reason,
    });
    setBusy(null);
    if (!res.ok) {
      showToast({ kind: "error", message: `Could not ${kind === "ignore" ? "ignore" : "baseline"} issue: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    const status: Issue["status"] = kind === "ignore" ? "ignored" : "baselined";
    updateIssues((i) => (i.id === issue.id ? { ...i, status, reason } : i));
    setForm(null);
    showToast({ kind: "success", message: kind === "ignore" ? "Issue ignored for this origin." : "Issue added to the baseline." });
  };

  return (
    <section aria-labelledby="detail-heading" className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50">
      {/* Top bar: back, position within the rule, issue number */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        {wide ? (
          <Button onClick={onBack} size="sm" variant="ghost" aria-label="Close issue details">
            ✕ Close
          </Button>
        ) : (
          <BackButton onClick={onBack} ariaLabel="Back to issue list" />
        )}
        {siblings.length > 1 && (
          <span className="flex items-center gap-1 text-xs text-slate-700" role="group" aria-label="Instances of this rule">
            {/* aria-disabled (not disabled) keeps the button focusable so a keyboard user stepping to the end does not lose focus. */}
            <Button
              size="sm"
              onClick={() => position > 0 && selectIssue(siblings[position - 1].id)}
              aria-disabled={position <= 0 ? true : undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              aria-label="Previous instance"
            >
              ‹
            </Button>
            <span className="min-w-14 text-center tabular-nums" aria-live="polite">
              {position + 1} of {siblings.length}
            </span>
            <Button
              size="sm"
              onClick={() => position < siblings.length - 1 && selectIssue(siblings[position + 1].id)}
              aria-disabled={position >= siblings.length - 1 ? true : undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              aria-label="Next instance"
            >
              ›
            </Button>
          </span>
        )}
        <span
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-800 px-1.5 text-[11px] font-bold text-white tabular-nums"
          aria-label={`Issue number ${number}`}
        >
          {number}
        </span>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {/* Header: what is wrong */}
        <header
          className="rounded-lg border border-slate-200 border-l-4 bg-white px-3 py-3"
          style={{ borderLeftColor: bestPractice ? "var(--sev-bp)" : SEVERITY_STRIPE[issue.severity] }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-semibold ${SEVERITY_PILL[issue.severity]}`}>
              <span className={`sev-dot sev-${issue.severity}`} aria-hidden="true" />
              {issue.severity}
            </span>
            {bestPractice ? (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-px text-[11px] font-semibold text-violet-900">
                Best practice
              </span>
            ) : wcagHref ? (
              <a
                href={wcagHref}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-full border border-blue-200 bg-blue-50 px-2 py-px text-[11px] font-semibold text-blue-900 hover:underline"
              >
                WCAG {issue.wcag.criterion} · {issue.wcag.level}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            <StatusLabel status={issue.status} />
            <span className="ml-auto font-mono text-[11px] text-slate-600">{issue.ruleId}</span>
          </div>
          <h2 id="detail-heading" ref={headingRef} tabIndex={-1} className="mt-2 text-[17px] font-semibold leading-snug text-slate-900 [text-wrap:balance]">
            {issue.title}
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {bestPractice ? "Best practice, not a WCAG failure" : `${issue.wcag.name} · Level ${issue.wcag.level}`} · {SOURCE_LABEL[issue.source]}
          </p>
          {issue.description && <p className="mt-2 text-sm leading-relaxed text-slate-800">{issue.description}</p>}

          {issue.status === "ignored" || issue.status === "baselined" ? (
            <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-2 text-xs text-slate-800">
              <p className="min-w-0 flex-1">
                <strong>{issue.status === "ignored" ? "Ignored (false positive)" : "Baselined (accepted)"}</strong> for this site, so it is not counted
                in the totals or the score.
                {issue.reason && (
                  <>
                    {" "}
                    <strong>Reason:</strong> {issue.reason}
                  </>
                )}
              </p>
              {!readOnly && (
                <Button size="sm" variant="primary" onClick={() => void restore()} disabled={busy === "restore"}>
                  {busy === "restore" ? "Restoring…" : "Restore issue"}
                </Button>
              )}
            </div>
          ) : (
            issue.reason && (
              <p className="mt-2 text-xs text-slate-700">
                <strong>Reason:</strong> {issue.reason}
              </p>
            )
          )}
        </header>

        {/* How to fix: the part people act on */}
        <section aria-labelledby="fix-heading" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <h3 id="fix-heading" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-900">
            <span aria-hidden="true">✓</span> How to fix
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-900">{issue.fix.summary}</p>
          {issue.fix.suggestedValue && !isContrast && (
            <p className="mt-1.5 text-xs text-slate-800">
              Suggested value: <code className="rounded bg-white px-1 py-px font-mono text-[11px]">{issue.fix.suggestedValue}</code>
            </p>
          )}
          {learnMore && (
            <a href={learnMore} target="_blank" rel="noreferrer noopener" className="mt-1.5 inline-block text-xs font-medium text-blue-800 underline">
              Learn more about this requirement <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </section>

        {/* Contrast: see the problem, not just the numbers */}
        {isContrast && fg && bg && (
          <section aria-labelledby="colours-heading" className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <h3 id="colours-heading" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
              Colours
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-slate-200 p-2">
                <div className="flex h-12 items-center justify-center rounded text-lg font-semibold" style={{ color: fg, background: bg }} aria-hidden="true">
                  Aa Text
                </div>
                <p className="mt-1.5 text-[11px] font-semibold text-slate-700">Current</p>
                <p className="text-sm tabular-nums text-slate-900">
                  {ratio !== undefined ? `${ratio}:1` : "—"}{" "}
                  {ratioPasses !== undefined && (
                    <span className={ratioPasses ? "text-emerald-800" : "text-red-800"}>{ratioPasses ? "✓ passes" : `✕ needs ${required}:1`}</span>
                  )}
                </p>
                <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
                  <ColorSwatch color={fg} label="Text colour" />
                  <ColorSwatch color={bg} label="Background colour" />
                </div>
              </div>
              {suggested ? (
                <div className="rounded-md border border-emerald-200 p-2">
                  <div className="flex h-12 items-center justify-center rounded text-lg font-semibold" style={{ color: suggested, background: bg }} aria-hidden="true">
                    Aa Text
                  </div>
                  <p className="mt-1.5 text-[11px] font-semibold text-emerald-900">Suggested</p>
                  <p className="text-sm tabular-nums text-slate-900">
                    {suggestedRatio !== undefined ? `${suggestedRatio}:1` : "—"} <span className="text-emerald-800">✓ passes</span>
                  </p>
                  <div className="mt-1 text-[11px]">
                    <ColorSwatch color={suggested} label="Suggested text colour" />
                  </div>
                </div>
              ) : (
                <p className="self-center text-xs text-slate-600">No passing colour could be suggested for this background.</p>
              )}
            </div>
          </section>
        )}

        {/* Where it is */}
        <section aria-labelledby="element-heading" className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="element-heading" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
              Element
            </h3>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => void locate()} disabled={tabId === null || busy === "locate"}>
                <span aria-hidden="true">◎</span> Highlight on page
              </Button>
              {onInspect && (
                <Button size="sm" onClick={() => onInspect(issue.element.selector)}>
                  Inspect
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-start gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-snug text-slate-800">{issue.element.selector}</code>
            <button
              type="button"
              onClick={() => void copySelector()}
              aria-label="Copy CSS selector"
              title="Copy CSS selector"
              className="shrink-0 rounded px-1 text-xs text-slate-700 hover:bg-slate-200"
            >
              <span aria-hidden="true">⧉</span>
            </button>
          </div>
          <pre className="mt-1.5 max-h-36 overflow-auto rounded-md bg-slate-900 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-slate-100">
            {issue.element.html}
          </pre>
          <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={autoHighlight} onChange={(e) => setAutoHighlight(e.target.checked)} />
            Highlight automatically when opening an issue
          </label>
        </section>

        {/* Rule measurements in plain words */}
        {measurements.length > 0 && (
          <section aria-labelledby="details-heading" className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <h3 id="details-heading" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
              Details
            </h3>
            <dl className="mt-1.5 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
              {measurements.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-600">{humanizeKey(k)}</dt>
                  <dd className="break-words text-slate-900">{displayValue(k, v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {issue.evidence?.screenshot && (
          <section aria-labelledby="shot-heading" className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <SectionLabel>
              <span id="shot-heading">Screenshot</span>
            </SectionLabel>
            <img
              src={issue.evidence.screenshot}
              alt={`Screenshot of the element for issue ${number}: ${issue.title}`}
              className="mt-1.5 max-h-56 w-auto max-w-full rounded-md border border-slate-300"
            />
          </section>
        )}

        {/* Raw engine output, for developers who want it */}
        {hasTechnical && (
          <details className="group rounded-lg border border-slate-200 bg-white px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">Technical details</summary>
            <dl className="mt-2 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
              {axeRuleId && (
                <>
                  <dt className="text-slate-600">axe-core rule</dt>
                  <dd className="font-mono text-slate-900">{axeRuleId}</dd>
                </>
              )}
              {impact && (
                <>
                  <dt className="text-slate-600">axe-core impact</dt>
                  <dd className="text-slate-900">{impact}</dd>
                </>
              )}
              {checks.length > 0 && (
                <>
                  <dt className="text-slate-600">Failed checks</dt>
                  <dd className="text-slate-900">
                    <ul className="list-disc pl-4">
                      {checks.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
              {internal.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-600">{humanizeKey(k)}</dt>
                  <dd className="break-words text-slate-900">{displayValue(k, v)}</dd>
                </div>
              ))}
              {tags.length > 0 && (
                <>
                  <dt className="text-slate-600">Tags</dt>
                  <dd className="flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <span key={t} className="rounded bg-slate-100 px-1.5 py-px font-mono text-[10.5px] text-slate-700">
                        {t}
                      </span>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          </details>
        )}
      </div>

      {/* Actions: evidence on the left, triage on the right */}
      <div className="sticky bottom-0 mt-auto border-t border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Share and evidence">
            <Button size="sm" onClick={() => void copyIssue()}>
              <span aria-hidden="true">⧉</span> Copy issue
            </Button>
            {!readOnly && (
              <Button size="sm" onClick={() => void screenshot()} disabled={tabId === null || busy === "screenshot"}>
                <span aria-hidden="true">📷</span> {busy === "screenshot" ? "Capturing…" : "Screenshot"}
              </Button>
            )}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Triage">
              {issue.status !== "ignored" && (
                <Button size="sm" variant="ghost" onClick={() => setForm(form === "ignore" ? null : "ignore")} aria-expanded={form === "ignore"} disabled={tabId === null}>
                  Ignore…
                </Button>
              )}
              {issue.status !== "baselined" && (
                <Button size="sm" variant="ghost" onClick={() => setForm(form === "baseline" ? null : "baseline")} aria-expanded={form === "baseline"} disabled={tabId === null}>
                  Add to baseline…
                </Button>
              )}
            </div>
          )}
        </div>
        {form === "ignore" && (
          <ReasonForm
            title="Ignore this issue"
            description="Ignored issues are hidden for this origin and excluded from the score. Explain why (e.g. false positive)."
            submitLabel="Ignore issue"
            busy={busy === "ignore"}
            onSubmit={(reason) => void submitReason("ignore", reason)}
            onCancel={() => setForm(null)}
          />
        )}
        {form === "baseline" && (
          <ReasonForm
            title="Add to baseline"
            description="Baselined issues are known and accepted for now; new scans only flag issues that are not in the baseline."
            submitLabel="Add to baseline"
            busy={busy === "baseline"}
            onSubmit={(reason) => void submitReason("baseline", reason)}
            onCancel={() => setForm(null)}
          />
        )}
      </div>
    </section>
  );
}
