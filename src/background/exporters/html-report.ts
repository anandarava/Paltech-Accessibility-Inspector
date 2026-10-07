/**
 * Self-contained HTML report. No external requests (inline CSS, data: images only,
 * a CSP meta tag enforces it), no scripts, every untrusted string escaped,
 * semantic heading order, high-contrast palette, alt text on every image.
 *
 * The report has two parts for two audiences:
 *  1. Summary (team leads and clients): verdict in plain words, score, issues by
 *     severity, the problems to fix first, who is affected, what was tested and
 *     what automated testing cannot cover.
 *  2. Developer details: failed rules table, one card per failed rule (why it
 *     matters, how to fix, then every element with its own measurements,
 *     suggested fix, code and screenshot; XPath and fingerprint are tucked into
 *     a collapsed "Technical details"), excluded issues with their reasons, rule
 *     lists and scan details.
 */
import type { Category, Issue, ScanResult, Severity } from "@shared/types";
import { SEVERITY_ORDER } from "@shared/constants";
import { effectivePassedRules } from "@shared/scoring";
import { wcagDocsUrl } from "@shared/wcag-map";
import { contrastRatio, parseColor, suggestPassingColor, toHex, type RGB } from "@shared/color";
import { toolInfo } from "./json-report";
import { guidanceFor, SEVERITY_MEANING, type AffectedUsers, type Effort, type RuleGuidance } from "./report-guidance";

/** Optional details about who produced the report, shown on the cover. */
export interface ReportMeta {
  preparedBy?: string;
  organisation?: string;
  /** data:image/png URL of the logo shown in the report header. */
  logo?: string;
}

const CATEGORY_ORDER: Category[] = [
  "Images and Media",
  "Color and Contrast",
  "Forms",
  "Keyboard and Focus",
  "Page Structure and Semantics",
  "ARIA",
  "Links, Buttons, and Targets",
  "Responsiveness and Zoom",
  "Best Practice",
  "Other",
];

/** Severity colours shared with the extension's panel and overlay. */
const SEVERITY_COLOR: Record<Severity, string> = {
  Critical: "#d7263d",
  Serious: "#f46036",
  Moderate: "#f5b700",
  Minor: "#8d99ae",
};
const BP_COLOR = "#6d28d9";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape any untrusted value for use in HTML text or attribute context. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const SAFE_HTTP_URL = /^https?:\/\/[^\s"'<>]+$/i;
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;
const SAFE_HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const UNSAFE_ID_CHARS = /[^a-z0-9_-]+/gi;

function safeHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  return SAFE_HTTP_URL.test(trimmed) ? trimmed : null;
}

function safeImage(dataUrl: unknown): string | null {
  if (typeof dataUrl !== "string") return null;
  return SAFE_DATA_IMAGE.test(dataUrl) ? dataUrl.replace(/\s+/g, "") : null;
}

function safeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : null;
}

function slug(value: string): string {
  return value.replace(UNSAFE_ID_CHARS, "-").replace(/^-+|-+$/g, "").toLowerCase() || "x";
}

function severityRank(s: Severity): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

function typeRank(t: Issue["type"]): number {
  return t === "Auto" ? 0 : 1;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Severity first (Critical..Minor), then automatic before other findings, then rule id and title. */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      typeRank(a.type) - typeRank(b.type) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.title.localeCompare(b.title),
  );
}

export function groupByCategory(issues: Issue[]): Array<{ category: string; issues: Issue[] }> {
  const map = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = issue.category || "Other";
    const list = map.get(key);
    if (list) list.push(issue);
    else map.set(key, [issue]);
  }
  const ordered: Array<{ category: string; issues: Issue[] }> = [];
  for (const c of CATEGORY_ORDER) {
    const list = map.get(c);
    if (list) {
      ordered.push({ category: c, issues: sortIssues(list) });
      map.delete(c);
    }
  }
  for (const [category, list] of map) ordered.push({ category, issues: sortIssues(list) });
  return ordered;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function isBestPractice(wcag: Issue["wcag"]): boolean {
  return wcag.level === "BP" || !wcag.criterion;
}

function severityBadge(severity: Severity, bp: boolean): string {
  const label = bp ? `Best practice · ${severity}` : severity;
  return `<span class="badge badge-${bp ? "bp" : slug(severity)}">${escapeHtml(label)}</span>`;
}

function effortChip(effort: Effort): string {
  return `<span class="chip chip-effort">${escapeHtml(effort)}</span>`;
}

function userChips(users: AffectedUsers[]): string {
  return `<ul class="users" aria-label="Users affected">${users.map((u) => `<li>${escapeHtml(u)}</li>`).join("")}</ul>`;
}

function wcagText(wcag: Issue["wcag"]): string {
  if (isBestPractice(wcag)) return "Best practice";
  return `WCAG ${wcag.criterion} ${wcag.name} · Level ${wcag.level}`;
}

function wcagLink(wcag: Issue["wcag"]): string {
  if (isBestPractice(wcag)) return "Best practice (not a WCAG failure)";
  const href = safeHref(wcagDocsUrl(wcag.criterion));
  const text = escapeHtml(wcagText(wcag));
  return href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${text}</a>` : text;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function formatNumber(key: string, value: number): string {
  const n = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  if (/ratio|contrast/i.test(key)) return `${n}:1`;
  if (/size|width|height|distance|offset|px/i.test(key)) return `${n} px`;
  return n;
}

function formatScalar(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return formatNumber(key, value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Render one measured value; objects become "Label: value" pairs rather than raw JSON. */
function formatDataValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '<span class="muted">—</span>';
  if (typeof value === "string") {
    const color = safeColor(value);
    // Only strictly validated hex colours are ever interpolated into a style attribute.
    if (color) return `<span class="swatch" style="background:${color}" aria-hidden="true"></span> <code>${escapeHtml(color)}</code>`;
    const href = safeHref(value);
    if (href && /url|link|href/i.test(key)) return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(href)}</a>`;
    return escapeHtml(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return escapeHtml(formatScalar(key, value));
  if (Array.isArray(value)) {
    return escapeHtml(value.map((v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v))).join(", "));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && (v === null || typeof v !== "object"))
      .map(([k, v]) => `<span class="pair"><span class="muted">${escapeHtml(humanizeKey(k))}:</span> ${escapeHtml(formatScalar(k, v))}</span>`)
      .join(" ");
  }
  return escapeHtml(String(value));
}

/** Axe bookkeeping and internal flags that mean nothing to a reader. */
const HIDDEN_DATA_KEYS = new Set([
  "checks",
  "tags",
  "axeRuleId",
  "impact",
  "ruleId",
  "question",
  "answer",
  "canvas",
  "reachedOpaque",
  "textOpacity",
  "focusVisibleApplied",
  "frameUrl",
  "isIframe",
  "text",
]);
/** Keys already shown by the contrast preview. */
const CONTRAST_KEYS = new Set(["foreground", "background", "ratio", "required", "fontSize", "fontWeight", "fill", "fillRatio"]);

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z<"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip framework comments (e.g. Ember/Vue `<!---->`) and collapse blank space in an HTML snippet. */
function cleanSnippet(html: string | undefined): string {
  return (html ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/\s{2,}/g, " ").trim();
}

function snippetText(html: string): string {
  return cleanSnippet(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A human description of the element, e.g. `<a> “Should testers write Unit tests?”`. */
function describeElement(issue: Issue): string {
  const html = cleanSnippet(issue.element?.html);
  const tag = /^<\s*([a-z][a-z0-9-]*)/i.exec(html)?.[1]?.toLowerCase();
  const dataText = typeof issue.data?.text === "string" ? issue.data.text : "";
  const alt = /\balt\s*=\s*"([^"]*)"/i.exec(html)?.[1];
  const label = /\baria-label\s*=\s*"([^"]*)"/i.exec(html)?.[1];
  // Form controls: their inner text is option lists or nothing, so use their name instead.
  const control = tag === "select" || tag === "input" || tag === "textarea";
  const placeholder = /\bplaceholder\s*=\s*"([^"]*)"/i.exec(html)?.[1];
  const text = (dataText || label || (control ? placeholder : snippetText(html)) || alt || "").trim();
  const tagHtml = tag ? `<code>&lt;${escapeHtml(tag)}&gt;</code>` : "";
  const textHtml = text ? `“${escapeHtml(truncate(text, 70))}”` : "";
  return [tagHtml, textHtml].filter(Boolean).join(" ") || '<span class="muted">Element</span>';
}

// ---------------------------------------------------------------------------
// Contrast facts (custom CLR-* rules and axe color-contrast)
// ---------------------------------------------------------------------------

interface ContrastFacts {
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  suggested?: string;
  suggestedRatio?: number;
  text: boolean;
  fontSize?: string;
}

function rgbOf(hex: string): RGB | null {
  const c = parseColor(hex);
  return c ? [c[0], c[1], c[2]] : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function contrastFacts(issue: Issue): ContrastFacts | undefined {
  const d = issue.data ?? {};
  let fg = safeColor(d.foreground);
  let bg = safeColor(d.background);
  let ratio = typeof d.ratio === "number" ? d.ratio : undefined;
  let required = typeof d.required === "number" ? d.required : undefined;
  let fontSize = typeof d.fontSize === "number" ? `${d.fontSize}px` : undefined;
  if (!fg || !bg) {
    const checks = Array.isArray(d.checks) ? (d.checks as Array<{ data?: Record<string, unknown> } | null>) : [];
    const c = checks.map((x) => x?.data).find((x) => x && typeof x.fgColor === "string" && typeof x.bgColor === "string");
    if (!c) return undefined;
    fg = safeColor(c.fgColor);
    bg = safeColor(c.bgColor);
    ratio = typeof c.contrastRatio === "number" ? c.contrastRatio : undefined;
    const expected = typeof c.expectedContrastRatio === "string" ? parseFloat(c.expectedContrastRatio) : NaN;
    required = Number.isFinite(expected) ? expected : undefined;
    const size = typeof c.fontSize === "string" ? /\((\d+(?:\.\d+)?px)\)/.exec(c.fontSize)?.[1] : undefined;
    fontSize = size;
  }
  if (!fg || !bg || ratio === undefined || required === undefined) return undefined;
  const fgRgb = rgbOf(fg);
  const bgRgb = rgbOf(bg);
  let suggested = safeColor(/#[0-9a-f]{3,8}\b/i.exec(issue.fix?.suggestedValue ?? "")?.[0]);
  if (!suggested && fgRgb && bgRgb) suggested = toHex(suggestPassingColor(fgRgb, bgRgb, required)).toLowerCase();
  const sRgb = suggested ? rgbOf(suggested) : null;
  const suggestedRatio = sRgb && bgRgb ? round2(contrastRatio(sRgb, bgRgb)) : undefined;
  const text = !/^CLR-0[45]$/.test(issue.ruleId);
  return { fg, bg, ratio: round2(ratio), required, suggested: suggested ?? undefined, suggestedRatio, text, fontSize };
}

function contrastPreview(c: ContrastFacts, sample: string): string {
  const tile = (label: string, fg: string, ratio: number | undefined, pass: boolean) => `<div class="tile">
<div class="tile-sample" style="color:${fg};background:${c.bg}">${c.text ? escapeHtml(truncate(sample || "Sample text", 28)) : `<span class="mock" style="border-color:${fg}"></span>`}</div>
<div class="tile-meta"><span class="muted">${label}</span> <b>${ratio === undefined ? "—" : `${ratio}:1`}</b> <span class="${pass ? "ok" : "bad"}">${pass ? "✓ Passes" : "✗ Fails"}</span><br><span class="small"><code>${escapeHtml(fg)}</code> on <code>${escapeHtml(c.bg)}</code></span></div>
</div>`;
  const current = tile("Current", c.fg, c.ratio, c.ratio >= c.required);
  const suggested = c.suggested ? tile("Suggested", c.suggested, c.suggestedRatio, (c.suggestedRatio ?? 0) >= c.required) : "";
  return `<div class="contrast" role="group" aria-label="Contrast: current ${c.ratio}:1, required ${c.required}:1">${current}${suggested}</div>`;
}

// ---------------------------------------------------------------------------
// Charts (inline SVG, drawn to scale)
// ---------------------------------------------------------------------------

function scoreBand(score: number): { label: string; cls: string } {
  if (score >= 90) return { label: "Good", cls: "good" };
  if (score >= 50) return { label: "Needs improvement", cls: "mid" };
  return { label: "Poor", cls: "poor" };
}

function scoreRing(score: number): string {
  const size = 120;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const d = (Math.max(0, Math.min(100, score)) / 100) * c;
  const color = score >= 90 ? "#1e7a3c" : score >= 50 ? "#b36b00" : "#b3261e";
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Accessibility score ${escapeHtml(score)} out of 100">
<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e3e8f0" stroke-width="${stroke}"/>
<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${d.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
<text x="50%" y="47%" text-anchor="middle" dominant-baseline="middle" font-size="34" font-weight="700" fill="#16202c">${escapeHtml(score)}</text>
<text x="50%" y="66%" text-anchor="middle" font-size="10" fill="#4f5b6c">out of 100</text>
</svg>`;
}

function severityDonut(counts: Record<Severity, number>, total: number): string {
  const size = 124;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const present = SEVERITY_ORDER.filter((s) => counts[s] > 0);
  const gap = present.length > 1 ? 2 : 0;
  let offset = 0;
  const segments = present
    .map((s) => {
      const len = (counts[s] / total) * c;
      const dash = Math.max(0, len - gap);
      const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${SEVERITY_COLOR[s]}" stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
      offset += len;
      return seg;
    })
    .join("");
  const label =
    total === 0 ? "No open issues" : `${total} open issues: ${SEVERITY_ORDER.map((s) => `${counts[s]} ${s.toLowerCase()}`).join(", ")}`;
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(label)}">
<g transform="rotate(-90 ${size / 2} ${size / 2})"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e9edf3" stroke-width="${stroke}"/>${segments}</g>
<text x="50%" y="47%" text-anchor="middle" font-size="30" font-weight="700" fill="#16202c">${total}</text>
<text x="50%" y="63%" text-anchor="middle" font-size="9.5" letter-spacing="1" fill="#4f5b6c">ISSUES</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Rule groups
// ---------------------------------------------------------------------------

interface RuleGroup {
  key: string;
  ruleId: string;
  title: string;
  wcag: Issue["wcag"];
  category: Category;
  severity: Severity;
  guidance: RuleGuidance;
  issues: Issue[];
}

function groupByRule(issues: Issue[]): RuleGroup[] {
  const map = new Map<string, RuleGroup>();
  for (const issue of sortIssues(issues)) {
    const key = `${issue.ruleId}\u0000${issue.title}`;
    const group = map.get(key);
    if (group) {
      group.issues.push(issue);
      if (severityRank(issue.severity) < severityRank(group.severity)) group.severity = issue.severity;
    } else {
      map.set(key, {
        key,
        ruleId: issue.ruleId,
        title: issue.title,
        wcag: issue.wcag,
        category: issue.category,
        severity: issue.severity,
        guidance: guidanceFor(issue.ruleId, issue.category, issue.title),
        issues: [issue],
      });
    }
  }
  // WCAG failures before best practices, then by severity and number of elements.
  return [...map.values()].sort(
    (a, b) =>
      Number(isBestPractice(a.wcag)) - Number(isBestPractice(b.wcag)) ||
      severityRank(a.severity) - severityRank(b.severity) ||
      b.issues.length - a.issues.length ||
      a.title.localeCompare(b.title),
  );
}

function groupId(group: RuleGroup, prefix = "rule"): string {
  return `${prefix}-${slug(group.ruleId)}-${slug(group.title).slice(0, 24)}`;
}

function groupColor(group: RuleGroup): string {
  return isBestPractice(group.wcag) ? BP_COLOR : SEVERITY_COLOR[group.severity];
}

/** Selector with positional parts removed: elements that share one are usually fixed together. */
function selectorPattern(selector: string): string {
  return selector.replace(/:nth-(?:of-type|child|last-child|last-of-type)\(\d+\)/g, "").trim();
}

function patternNote(group: RuleGroup): string {
  if (group.issues.length < 2) return "";
  const counts = new Map<string, number>();
  for (const i of group.issues) {
    const p = selectorPattern(i.element?.selector ?? "");
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const shared = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  if (shared.length === 0) return "";
  const items = shared
    .slice(0, 3)
    .map(([p, n]) => `<li><b>${n} elements</b> share <code>${escapeHtml(p)}</code></li>`)
    .join("");
  return `<div class="note"><p><strong>Likely fewer fixes than elements.</strong> These elements come from the same component or style, so one change there should fix all of them:</p><ul>${items}</ul></div>`;
}

// ---------------------------------------------------------------------------
// Part 2: rule and element details
// ---------------------------------------------------------------------------

function elementFinding(issue: Issue, contrast: ContrastFacts | undefined, sample: string): string[] {
  if (contrast) {
    const what = contrast.text ? (sample ? `The text “${truncate(sample, 50)}”` : "This text") : "This element";
    const size = contrast.text && contrast.fontSize ? ` at ${contrast.fontSize}` : "";
    return [`${what}${size} has a contrast of ${contrast.ratio}:1 (${contrast.fg} on ${contrast.bg}). At least ${contrast.required}:1 is needed.`];
  }
  const description = issue.description ?? "";
  if (issue.source !== "axe") return description ? [description] : [];
  // axe: the first sentence is the rule's generic description; the rest is specific to this element.
  const specific = sentences(description)
    .slice(1)
    .filter((s) => !/could not determine the result automatically/i.test(s));
  if (specific.length) return specific;
  const fromFix = /following:\s*(.+)$/i.exec(issue.fix?.summary ?? "")?.[1];
  return fromFix ? [fromFix] : [];
}

/** Custom rules give element-specific advice ("change the colour to #747474"); axe repeats its generic help. */
function elementAdvice(issue: Issue, sharedAdvice: string | undefined): string {
  if (issue.source === "axe") return "";
  const summary = issue.fix?.summary?.trim();
  if (!summary || summary === sharedAdvice) return "";
  return summary;
}

function sharedAdviceOf(group: RuleGroup): string | undefined {
  const custom = group.issues.filter((i) => i.source !== "axe");
  if (custom.length !== group.issues.length || custom.length < 2) return undefined;
  const first = custom[0].fix?.summary?.trim();
  return first && custom.every((i) => i.fix?.summary?.trim() === first) ? first : undefined;
}

function sourceLabel(source: Issue["source"]): string {
  return source === "axe" ? "axe-core" : source === "custom" ? "PalTech A11y Inspector rule" : "Manual";
}

function statusLabel(status: Issue["status"]): string {
  switch (status) {
    case "new":
      return "Open";
    case "baselined":
      return "Baselined (accepted)";
    case "ignored":
      return "Ignored (false positive)";
    case "fixed":
      return "Fixed";
    default:
      return escapeHtml(status);
  }
}

function renderInstance(issue: Issue, n: number, total: number, group: RuleGroup, sharedAdvice: string | undefined): string {
  const html = cleanSnippet(issue.element?.html);
  const sample = (typeof issue.data?.text === "string" ? issue.data.text : "") || (/^<\s*(select|input|textarea)\b/i.test(html) ? "" : snippetText(html));
  const contrast = contrastFacts(issue);
  const finding = elementFinding(issue, contrast, sample);
  // With a contrast preview the suggested colour is already shown; keep only the CSS.
  const advice = contrast?.suggested ? "" : elementAdvice(issue, sharedAdvice);
  const suggestedValue = issue.fix?.suggestedValue?.trim();

  const findingHtml = finding.length
    ? finding.length === 1
      ? `<p class="finding">${escapeHtml(finding[0])}</p>`
      : `<ul class="finding">${finding.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
    : "";

  const hidden = new Set([...HIDDEN_DATA_KEYS, ...(contrast ? CONTRAST_KEYS : [])]);
  const measurements = Object.entries(issue.data ?? {})
    .filter(([k, v]) => v !== undefined && !hidden.has(k))
    .map(([k, v]) => `<tr><th scope="row">${escapeHtml(humanizeKey(k))}</th><td>${formatDataValue(k, v)}</td></tr>`)
    .join("");

  const adviceHtml =
    advice || suggestedValue
      ? `<div class="advice"><span class="advice-label">Suggested fix</span>${advice ? `<p>${escapeHtml(advice)}</p>` : ""}${
          suggestedValue ? `<p class="small">CSS: <code>${escapeHtml(suggestedValue)}</code></p>` : ""
        }</div>`
      : "";

  const screenshot = safeImage(issue.evidence?.screenshot);
  const shot = screenshot
    ? `<figure class="shot"><img src="${screenshot}" alt="Screenshot of element ${n}: ${escapeHtml(truncate(sample || group.guidance.headline, 80))}"><figcaption>How it looks on the page${
        issue.evidence?.capturedAt ? ` (captured ${escapeHtml(formatDate(issue.evidence.capturedAt))})` : ""
      }</figcaption></figure>`
    : "";

  const excluded =
    issue.status !== "new"
      ? `<p class="excluded-note"><b>${statusLabel(issue.status)}</b>${issue.reason ? `: ${escapeHtml(issue.reason)}` : " (no reason given)"}</p>`
      : "";

  const axeRule = typeof issue.data?.axeRuleId === "string" ? issue.data.axeRuleId : "";
  const tech = `<details class="tech"><summary>Technical details</summary><table class="kv"><tbody>
${issue.element?.xpath ? `<tr><th scope="row">XPath</th><td><code>${escapeHtml(issue.element.xpath)}</code></td></tr>` : ""}
<tr><th scope="row">Found by</th><td>${escapeHtml(sourceLabel(issue.source))}${axeRule ? ` (<code>${escapeHtml(axeRule)}</code>)` : ""}</td></tr>
<tr><th scope="row">Fingerprint</th><td><code>${escapeHtml(issue.fingerprint)}</code> <span class="muted small">(stable id used for ignore and baseline)</span></td></tr>
</tbody></table></details>`;

  return `<li class="inst" data-sev="${issue.severity}">
<div class="inst-h"><span class="inst-n">${n}<span class="sr-only"> of ${total}</span></span><span class="inst-what">${describeElement(issue)}</span><span class="inst-of" aria-hidden="true">Element ${n} of ${total}</span></div>
${excluded}
${findingHtml}
${contrast ? contrastPreview(contrast, sample) : ""}
${measurements ? `<table class="kv"><caption class="sr-only">Measurements for element ${n}</caption><tbody>${measurements}</tbody></table>` : ""}
${adviceHtml}
${shot}
<div class="code"><p class="code-label">Selector</p><pre><code>${escapeHtml(issue.element?.selector)}</code></pre>
<p class="code-label">HTML</p><pre class="html"><code>${escapeHtml(html)}</code></pre></div>
${tech}
</li>`;
}

/** The distinct severities of a rule's elements, space separated (matched by the severity filter in CSS). */
function severitiesOf(group: RuleGroup): string {
  return SEVERITY_ORDER.filter((s) => group.issues.some((i) => i.severity === s)).join(" ");
}

/**
 * Severity filter for Part 2, done in HTML and CSS only (the report stays script-free): one hidden
 * checkbox per severity that occurs, styled labels as toggle chips, and sibling selectors that show
 * the rules, table rows and elements of the ticked severities. Not rendered when everything has the
 * same severity, since there is nothing to filter.
 */
function renderSeverityFilter(counts: Record<Severity, number>, body: string): string {
  const present = SEVERITY_ORDER.filter((s) => counts[s] > 0);
  if (present.length < 2) return body;
  const inputs = present.map((s) => `<input type="checkbox" class="sr-only" id="f-${s}" checked>`).join("");
  const chips = present
    .map(
      (s) =>
        `<label for="f-${s}" class="fchip"><span class="dot" style="background:${SEVERITY_COLOR[s]}" aria-hidden="true"></span>${s} <b>${counts[s]}</b></label>`,
    )
    .join("");
  // Shown only when every severity input is unticked (the sibling chain matches only then).
  const noneTicked = `<style>${present.map((s) => `#f-${s}:not(:checked)`).join("~")}~.nothing{display:block}</style>`;
  return `<div class="devfilter">${inputs}${noneTicked}
<div class="filterbar" role="group" aria-labelledby="f-title"><span id="f-title" class="label">Show severity</span>${chips}<span class="muted small">Untick a severity to hide its problems and elements below.</span></div>
<p class="nothing" role="status">No severity is selected. Tick at least one to see the problems.</p>
<div class="devbody">${body}</div>
</div>`;
}

function renderRuleDetails(group: RuleGroup): string {
  const first = group.issues[0];
  const g = group.guidance;
  const bp = isBestPractice(group.wcag);
  const docsHref = safeHref(first.fix?.docsUrl) ?? (first.wcag.criterion ? safeHref(wcagDocsUrl(first.wcag.criterion)) : null);
  const docs = docsHref ? `<p class="small"><a href="${escapeHtml(docsHref)}" rel="noopener noreferrer">Learn more about this requirement</a></p>` : "";
  const shared = sharedAdviceOf(group);
  const n = group.issues.length;
  const technicalTitle = group.title !== g.headline ? `<p class="rule-sub">${escapeHtml(group.title)}</p>` : "";
  return `<article id="${groupId(group)}" class="rule" data-sevs="${severitiesOf(group)}" style="--c:${groupColor(group)}" aria-labelledby="${groupId(group)}-h">
<header class="rule-h">
<p class="eyebrow"><code>${escapeHtml(group.ruleId)}</code> · ${wcagLink(group.wcag)} · ${escapeHtml(group.category)}</p>
<h3 id="${groupId(group)}-h">${escapeHtml(g.headline)}</h3>
${technicalTitle}
<p class="rule-meta">${severityBadge(group.severity, bp)} <span class="muted">${escapeHtml(SEVERITY_MEANING[group.severity])}</span> · <b>${plural(n, "element")}</b> · ${effortChip(g.effort)}</p>
</header>
<div class="rule-info">
<div class="info"><h4>Why it matters</h4><p>${escapeHtml(g.impact)}</p>${userChips(g.users)}</div>
<div class="info info-fix"><h4>How to fix</h4><p>${escapeHtml(g.fix)}</p>${shared ? `<p class="small"><b>For every element below:</b> ${escapeHtml(shared)}</p>` : ""}${docs}</div>
</div>
${patternNote(group)}
<ol class="instances" aria-label="Affected elements">${group.issues.map((issue, i) => renderInstance(issue, i + 1, n, group, shared)).join("")}</ol>
</article>`;
}

function renderFailedRulesTable(groups: RuleGroup[]): string {
  if (groups.length === 0) return "";
  const max = Math.max(...groups.map((g) => g.issues.length));
  const rows = groups
    .map((g) => {
      const width = ((g.issues.length / max) * 100).toFixed(1);
      const color = groupColor(g);
      return `<tr data-sevs="${severitiesOf(g)}"><td><a href="#${groupId(g)}"><b>${escapeHtml(g.guidance.headline)}</b></a><br><span class="muted small"><code>${escapeHtml(g.ruleId)}</code> · ${escapeHtml(wcagText(g.wcag))}</span></td>
<td class="nowrap">${severityBadge(g.severity, isBestPractice(g.wcag))}</td>
<td class="nowrap small">${escapeHtml(g.guidance.effort)}</td>
<td class="barcell" aria-hidden="true"><span class="bar"><i style="width:${width}%;background:${color}"></i></span></td>
<td class="num">${g.issues.length}</td></tr>`;
    })
    .join("");
  return `<section class="card" aria-labelledby="h-failed">
<h3 id="h-failed" class="label">Failed rules</h3>
<div class="scroll"><table class="grid rules"><caption class="sr-only">Rules with open issues: WCAG failures first, then by severity</caption>
<thead><tr><th scope="col">Problem</th><th scope="col">Severity</th><th scope="col">Effort</th><th scope="col"><span class="sr-only">Share of elements</span></th><th scope="col" class="num">Elements</th></tr></thead>
<tbody>${rows}</tbody></table></div>
</section>`;
}

function renderExcluded(excluded: Issue[]): string {
  if (excluded.length === 0) return "";
  const rows = groupByRule(excluded)
    .flatMap((g) =>
      g.issues.map(
        (i) => `<tr><td><b>${escapeHtml(g.guidance.headline)}</b><br><span class="muted small"><code>${escapeHtml(g.ruleId)}</code> · ${escapeHtml(wcagText(g.wcag))}</span></td>
<td>${describeElement(i)}<br><code class="small">${escapeHtml(truncate(i.element?.selector ?? "", 90))}</code></td>
<td class="nowrap">${statusLabel(i.status)}</td>
<td>${i.reason ? escapeHtml(i.reason) : '<span class="muted">No reason given</span>'}</td></tr>`,
      ),
    )
    .join("");
  return `<section class="card" id="h-excluded" aria-labelledby="h-excluded-t">
<h3 id="h-excluded-t" class="label">Excluded issues (${excluded.length})</h3>
<p class="muted small">The team reviewed these and decided to exclude them. They are not counted in the totals or the score.</p>
<div class="scroll"><table class="grid"><caption class="sr-only">Excluded issues with their reasons</caption>
<thead><tr><th scope="col">Problem</th><th scope="col">Element</th><th scope="col">Decision</th><th scope="col">Reason</th></tr></thead>
<tbody>${rows}</tbody></table></div>
</section>`;
}

// ---------------------------------------------------------------------------
// Part 1: summary
// ---------------------------------------------------------------------------

function verdict(groups: RuleGroup[], active: Issue[], target: string): { tone: string; title: string; text: string } {
  const wcagGroups = groups.filter((g) => !isBestPractice(g.wcag));
  const wcagElements = wcagGroups.reduce((n, g) => n + g.issues.length, 0);
  const criticalGroups = wcagGroups.filter((g) => g.severity === "Critical").length;
  const seriousGroups = wcagGroups.filter((g) => g.severity === "Serious").length;
  const bpCount = active.length - wcagElements;
  const bpText = bpCount > 0 ? ` There ${bpCount === 1 ? "is" : "are"} also ${plural(bpCount, "best-practice recommendation")}.` : "";
  if (criticalGroups > 0) {
    return {
      tone: "poor",
      title: `Does not meet ${target}: critical barriers found`,
      text: `We found ${plural(wcagGroups.length, "accessibility problem")} affecting ${plural(wcagElements, "element")}. ${plural(criticalGroups, "problem")} ${criticalGroups === 1 ? "blocks" : "block"} some users completely and should be fixed first.${bpText}`,
    };
  }
  if (wcagGroups.length > 0) {
    return {
      tone: "mid",
      title: `Does not meet ${target} yet`,
      text: `We found ${plural(wcagGroups.length, "accessibility problem")} affecting ${plural(wcagElements, "element")}. None blocks users completely${seriousGroups ? `, but ${seriousGroups} make${seriousGroups === 1 ? "s" : ""} tasks very difficult for some people` : ""}.${bpText}`,
    };
  }
  return {
    tone: "good",
    title: "No WCAG failures found by the automated checks",
    text: `The automated checks found no ${target} failures on this page.${bpText} A manual review is still needed to confirm conformance.`,
  };
}

function renderTopProblems(groups: RuleGroup[]): string {
  if (groups.length === 0) return "";
  const top = groups.slice(0, 5);
  const items = top
    .map(
      (g, i) => `<li class="top-item" style="--c:${groupColor(g)}"><span class="rank" aria-hidden="true">${i + 1}</span><div>
<p class="top-title"><a href="#${groupId(g)}">${escapeHtml(g.guidance.headline)}</a></p>
<p class="top-impact">${escapeHtml(g.guidance.impact)}</p>
<p class="top-meta">${severityBadge(g.severity, isBestPractice(g.wcag))} <span>${escapeHtml(SEVERITY_MEANING[g.severity])}</span> · <span>${plural(g.issues.length, "element")}</span> · ${effortChip(g.guidance.effort)}</p>
</div></li>`,
    )
    .join("");
  const more = groups.length > top.length ? `<p class="muted small">…and ${plural(groups.length - top.length, "more problem")}, listed in the developer details.</p>` : "";
  return `<section class="card" aria-labelledby="h-top">
<h3 id="h-top" class="label">Fix these first</h3>
<ol class="top">${items}</ol>${more}
</section>`;
}

const USER_ORDER: AffectedUsers[] = [
  "Screen reader users",
  "Low vision",
  "Colour blindness",
  "Keyboard users",
  "Limited dexterity",
  "Cognitive and learning",
  "Deaf and hard of hearing",
  "Zoom and magnifier users",
];

function renderAffected(groups: RuleGroup[]): string {
  const rows = USER_ORDER.map((u) => {
    const hit = groups.filter((g) => g.guidance.users.includes(u));
    return { u, problems: hit.length, elements: hit.reduce((n, g) => n + g.issues.length, 0) };
  }).filter((r) => r.problems > 0);
  if (rows.length === 0) return "";
  rows.sort((a, b) => b.elements - a.elements || b.problems - a.problems);
  const max = Math.max(...rows.map((r) => r.elements));
  const body = rows
    .map(
      (r) => `<li><div class="aff-top"><b>${escapeHtml(r.u)}</b><span>${plural(r.problems, "problem")} · ${plural(r.elements, "element")}</span></div><span class="bar" aria-hidden="true"><i style="width:${((r.elements / max) * 100).toFixed(1)}%"></i></span></li>`,
    )
    .join("");
  return `<section class="card fill-card" aria-labelledby="h-users">
<h3 id="h-users" class="label">Who is affected</h3>
<div class="fill"><div class="fill-scroll" tabindex="0" role="region" aria-labelledby="h-users">
<ul class="affected" aria-label="Open problems by group of users affected">${body}</ul>
</div></div>
</section>`;
}

// ---------------------------------------------------------------------------
// Styles (every text/background pair meets at least 4.5:1)
// ---------------------------------------------------------------------------

/** Rules for the severity filter: hide every element, then show those whose severity is ticked. */
const FILTER_CSS = [
  `.devfilter>.devbody [data-sevs],.devfilter>.devbody [data-sev]{display:none}`,
  `.filterbar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:1rem 0}`,
  `.fchip{display:inline-flex;align-items:center;gap:.4rem;border:2px solid var(--muted);border-radius:999px;padding:.2rem .8rem;background:#fff;color:var(--muted);font-weight:600;font-size:.88rem;cursor:pointer;text-decoration:line-through}`,
  `.fchip .dot{opacity:.45}`,
  `.nothing{display:none;margin:.5rem 0;padding:.8rem 1rem;border:1px solid var(--line);border-radius:10px;background:var(--card)}`,
  ...SEVERITY_ORDER.map(
    (s) =>
      `#f-${s}:checked~.devbody [data-sevs~="${s}"],#f-${s}:checked~.devbody [data-sev="${s}"]{display:revert}` +
      `#f-${s}:checked~.filterbar label[for="f-${s}"]{background:#e8eefc;border-color:var(--accent);color:var(--ink);text-decoration:none}` +
      `#f-${s}:checked~.filterbar label[for="f-${s}"] .dot{opacity:1}` +
      `#f-${s}:focus-visible~.filterbar label[for="f-${s}"]{outline:3px solid var(--focus);outline-offset:2px}`,
  ),
].join("\n");

const CSS = `
:root{color-scheme:light;--ink:#16202c;--muted:#4f5b6c;--line:#e0e5ec;--bg:#f3f5f8;--card:#fff;--link:#0b4fb3;--focus:#1d4ed8;--accent:#1f3a8a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--link)}
a:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em}
p{margin:.35rem 0}
.skip{position:absolute;left:-999px;top:0;background:#fff;color:var(--ink);padding:.5rem 1rem;border:2px solid var(--focus)}
.skip:focus{left:1rem;top:1rem;z-index:10}
${FILTER_CSS}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.muted{color:var(--muted)}.small{font-size:.86rem}.nowrap{white-space:nowrap}
.wrap{max-width:68rem;margin:0 auto;padding-left:1.25rem;padding-right:1.25rem}
.cover{background:var(--accent);color:#fff}
.cover .wrap{padding-top:1.6rem;padding-bottom:1.4rem;display:flex;flex-wrap:wrap;gap:1rem 2rem;justify-content:space-between;align-items:flex-end}
.brand{display:flex;gap:.9rem;align-items:center;min-width:0}
.brand img{width:44px;height:44px;border-radius:10px;background:#fff;padding:4px}
.cover h1{margin:0;font-size:1.6rem;line-height:1.2}
.cover .page{margin:.2rem 0 0;color:#dbe4ff;overflow-wrap:anywhere}
.cover .page a{color:#fff}
.cover dl{margin:0;display:grid;grid-template-columns:auto auto;gap:.1rem .9rem;font-size:.88rem}
.cover dt{color:#c7d3f5}.cover dd{margin:0;font-weight:600}
.toc{background:var(--card);border-bottom:1px solid var(--line)}
.toc ul{list-style:none;margin:0 auto;padding-top:.55rem;padding-bottom:.55rem;display:flex;flex-wrap:wrap;gap:.3rem 1.2rem;font-size:.9rem}
main{padding-top:1.4rem;padding-bottom:3rem;display:grid;gap:1rem}
.part{display:flex;align-items:baseline;gap:.75rem;margin:1rem 0 0;padding-bottom:.4rem;border-bottom:2px solid var(--ink)}
.part h2{margin:0;font-size:1.3rem}
.part span{color:var(--muted);font-size:.9rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.25rem;min-width:0}
.label{margin:0 0 .75rem;font-size:.76rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}
.verdict{border-left:6px solid;display:grid;gap:.2rem}
.verdict h3{margin:0;font-size:1.2rem}
.verdict.poor{border-left-color:#b3261e;background:#fff7f6}.verdict.mid{border-left-color:#b36b00;background:#fffaf0}.verdict.good{border-left-color:#1e7a3c;background:#f4fbf6}
.hero{display:grid;grid-template-columns:1fr 1.4fr 1fr;gap:1rem}
.two{display:grid;grid-template-columns:1.3fr 1fr;gap:1rem;align-items:start}
.two.stretch{align-items:stretch}
/* "Who is affected" fills the height of the card beside it and scrolls when it has more rows. */
.fill-card{display:flex;flex-direction:column}
.fill{position:relative;flex:1;min-height:14rem}
.fill-scroll{position:absolute;inset:0;overflow-y:auto}
.fill-scroll:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
@media (max-width:54rem){.hero,.two{grid-template-columns:1fr}.fill{min-height:0}.fill-scroll{position:static;max-height:22rem}}
.score{display:flex;gap:1rem;align-items:center}
svg.ring,svg.donut{flex:none}
.bandpill{display:inline-block;white-space:nowrap;padding:.1rem .7rem;border-radius:999px;font-weight:600;font-size:.86rem;border:1px solid}
.bandpill.good{background:#e6f4ea;color:#14532d;border-color:#1e7a3c}
.bandpill.mid{background:#fff4d6;color:#6b4500;border-color:#b36b00}
.bandpill.poor{background:#fde8e8;color:#7a1414;border-color:#b3261e}
.sev{display:flex;gap:1.1rem;align-items:center;flex-wrap:wrap}
.sev ul{list-style:none;margin:0;padding:0;display:grid;gap:.45rem;flex:1;min-width:12rem}
.sev li{display:grid;grid-template-columns:auto 1fr auto;column-gap:.5rem;align-items:center}
.sev li small{grid-column:2/4;color:var(--muted);font-size:.78rem;line-height:1.2}
.sev li b{font-variant-numeric:tabular-nums}
.dot{width:.7rem;height:.7rem;border-radius:50%;display:inline-block;flex:none}
.kpis{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
.kpi{border:1px solid var(--line);border-radius:10px;padding:.55rem .7rem}
.kpi b{display:block;font-size:1.4rem;font-variant-numeric:tabular-nums}.kpi span{font-size:.8rem;color:var(--muted)}
ol.top{list-style:none;margin:0;padding:0;display:grid;gap:.7rem}
.top-item{display:grid;grid-template-columns:auto 1fr;gap:.8rem;padding:.75rem .9rem;border:1px solid var(--line);border-left:5px solid var(--c);border-radius:10px}
.rank{width:1.9rem;height:1.9rem;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:700;font-size:.9rem}
.top-title{margin:0;font-weight:700;font-size:1.02rem}.top-title a{color:var(--ink)}
.top-impact{margin:.15rem 0 .35rem;color:#2e3a4b}
.top-meta{margin:0;font-size:.86rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
.chip{display:inline-block;border-radius:6px;padding:.02rem .5rem;font-size:.76rem;font-weight:600;border:1px solid var(--line);background:#f5f7fa;color:#2c394c}
ul.users{list-style:none;margin:.5rem 0 0;padding:0;display:flex;flex-wrap:wrap;gap:.35rem}
ul.users li{background:#eaf0ff;color:#1e3a8a;border-radius:999px;padding:.08rem .65rem;font-size:.78rem;font-weight:600}
.facts-list{margin:0;display:grid;grid-template-columns:auto 1fr;gap:.3rem 1rem;font-size:.92rem}
.facts-list dt{color:var(--muted)}.facts-list dd{margin:0;overflow-wrap:anywhere}
.limits{background:#f7f8fb}
.limits ul{margin:.4rem 0 0;padding-left:1.1rem}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%}
table.grid th,table.grid td{padding:.55rem .6rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
table.grid thead th{font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
ul.affected{list-style:none;margin:0;padding:0 .4rem 0 0}
ul.affected li{padding:.6rem 0;border-bottom:1px solid var(--line)}
ul.affected li:first-child{padding-top:0}
.aff-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.1rem .8rem}
.aff-top span{color:var(--muted);font-size:.9rem;font-variant-numeric:tabular-nums}
ul.affected .bar{margin-top:.4rem}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.barcell{width:26%;min-width:5rem}
.bar{display:block;height:.55rem;border-radius:4px;background:#e9edf3;margin-top:.5rem}.bar i{display:block;height:100%;border-radius:4px;background:var(--accent)}
.intro{margin:0;color:var(--muted)}
article.rule{background:var(--card);border:1px solid var(--line);border-top:5px solid var(--c,#6c757d);border-radius:12px;padding:1.1rem 1.25rem}
.eyebrow{margin:0;font-size:.84rem;color:var(--muted)}
.rule-h h3{margin:.2rem 0 0;font-size:1.2rem}
.rule-sub{margin:.1rem 0 0;color:var(--muted);font-size:.9rem}
.rule-meta{margin:.5rem 0 0;display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;font-size:.88rem}
.rule-info{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin:.9rem 0}
@media (max-width:44rem){.rule-info{grid-template-columns:1fr}}
.info{border:1px solid var(--line);border-radius:10px;padding:.7rem .85rem;background:#fafbfd}
.info h4{margin:0 0 .25rem;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.info-fix{background:#eff8f1;border-color:#cde6d4}.info-fix h4{color:#14532d}
.note{border:1px dashed #9aa8bd;border-radius:10px;padding:.6rem .85rem;margin:0 0 .9rem;font-size:.9rem}
.note ul{margin:.3rem 0 0;padding-left:1.1rem}.note code{overflow-wrap:anywhere}
ol.instances{list-style:none;margin:0;padding:0;display:grid;gap:.8rem}
.inst{border:1px solid var(--line);border-radius:10px;padding:.85rem .95rem;background:#fff}
.inst-h{display:flex;gap:.6rem;align-items:center;margin-bottom:.35rem}
.inst-n{width:1.6rem;height:1.6rem;border-radius:50%;background:#eef2f8;display:grid;place-items:center;font-weight:700;font-size:.8rem;flex:none}
.inst-what{font-weight:600;min-width:0;overflow-wrap:anywhere}
.inst-of{margin-left:auto;font-size:.76rem;color:var(--muted);white-space:nowrap;text-transform:uppercase;letter-spacing:.05em}
.finding{margin:.3rem 0 .5rem}ul.finding{padding-left:1.2rem}
.excluded-note{background:#f3f0ff;border:1px solid #d9d0fb;border-radius:8px;padding:.35rem .6rem;font-size:.9rem}
.contrast{display:flex;flex-wrap:wrap;gap:.6rem;margin:.4rem 0 .6rem}
.tile{border:1px solid var(--line);border-radius:10px;overflow:hidden;min-width:13rem;flex:1;max-width:20rem}
.tile-sample{padding:.8rem .9rem;font-size:1.05rem;font-weight:600;border-bottom:1px solid var(--line);min-height:3rem}
.mock{display:block;height:1.6rem;border:2px solid;border-radius:5px;background:transparent}
.tile-meta{padding:.45rem .7rem;font-size:.86rem}
.ok{color:#14532d;font-weight:600}.bad{color:#9b1c1c;font-weight:600}
.advice{border-left:4px solid #1e7a3c;background:#f4fbf6;border-radius:0 8px 8px 0;padding:.45rem .75rem;margin:.5rem 0}
.advice-label{font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:#14532d;font-weight:700}
.advice p{margin:.15rem 0}
table.kv{margin:.3rem 0 .5rem}
table.kv th,table.kv td{padding:.3rem .5rem;border-bottom:1px solid #eef1f5;text-align:left;vertical-align:top;font-size:.88rem}
table.kv th{width:10rem;color:var(--muted);font-weight:600}
table.kv code{overflow-wrap:anywhere}
.pair{display:inline-block;margin-right:.8rem}
.swatch{display:inline-block;width:1em;height:1em;border:1px solid var(--ink);border-radius:3px;vertical-align:-.15em}
.code{margin-top:.5rem}
.code-label{margin:.4rem 0 .2rem;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
.code pre{margin:0;background:#f5f7fa;border:1px solid var(--line);padding:.45rem .65rem;border-radius:7px;white-space:pre-wrap;word-break:break-word}
.code pre.html{background:#0f1722;border-color:#0f1722;color:#dfe7f2}
figure.shot{margin:.6rem 0}figure.shot img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px;display:block}
figcaption{color:var(--muted);font-size:.82rem;margin-top:.25rem}
details.tech{margin-top:.55rem;font-size:.88rem}
details.tech summary{cursor:pointer;color:var(--muted);font-weight:600}
.badge{display:inline-block;border-radius:999px;padding:.05rem .6rem;font-size:.78rem;font-weight:600;border:1px solid transparent;white-space:nowrap}
.badge-critical{background:#fde2e2;color:#7a0000;border-color:#b91c1c}
.badge-serious{background:#ffe8d6;color:#7a2e00;border-color:#c2410c}
.badge-moderate{background:#fff4c2;color:#5c4a00;border-color:#a16207}
.badge-minor{background:#e4e7ec;color:#2f3744;border-color:#6b7280}
.badge-bp{background:#ede9fe;color:#3b2a86;border-color:#6d28d9}
.lists details{margin:.3rem 0}.lists summary{padding:.3rem 0;font-weight:600;cursor:pointer}
.lists ul{columns:3;column-gap:1.5rem;margin:.3rem 0 .6rem;padding-left:1.1rem;font-size:.86rem}
@media (max-width:40rem){.lists ul{columns:1}table.kv th{width:6.5rem}.inst-of{display:none}}
table.facts th,table.facts td{padding:.35rem .5rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:.9rem}
table.facts th{width:11rem;color:var(--muted);font-weight:600}
footer{color:var(--muted);font-size:.84rem;padding-bottom:2rem}
@media print{.fill{min-height:0}.fill-scroll{position:static;overflow:visible;max-height:none}body{background:#fff}.toc{display:none}.cover{background:#fff;color:var(--ink);border-bottom:3px solid var(--ink)}.cover .page,.cover dt{color:var(--muted)}.cover .page a{color:inherit}
.card,.top-item,.inst{break-inside:avoid}.part{break-before:page}.part.first{break-before:auto}details.tech{display:none}a{color:inherit}}
`;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function buildHtmlReport(result: ScanResult, meta: ReportMeta = {}): string {
  const tool = toolInfo();
  const issues = result.issues ?? [];
  const active = issues.filter((i) => i.status === "new");
  const excluded = issues.filter((i) => i.status !== "new");
  const passed = effectivePassedRules(active, result.passedRules ?? []);
  const inapplicable = result.inapplicableRules ?? [];
  const unscanned = result.unscannedFrames ?? [];

  const counts: Record<Severity, number> = { Critical: 0, Serious: 0, Moderate: 0, Minor: 0 };
  for (const i of active) counts[i.severity]++;
  const groups = groupByRule(active);

  const pageTitle = result.title || result.url || "Untitled page";
  const url = safeHref(result.url);
  const urlHtml = url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(url)}</a>` : escapeHtml(result.url);
  const score = Number.isFinite(result.score) ? result.score : 0;
  const band = scoreBand(score);
  const target = `WCAG ${result.wcagVersion ?? "2.2"} ${result.wcagLevel}`;
  const scopeHtml = result.scope?.kind === "selector" ? `Part of the page (<code>${escapeHtml(result.scope.selector ?? "")}</code>)` : "Full page";
  const rulesText = result.axeOnly ? "axe-core rules only" : "axe-core and PalTech A11y Inspector rules";
  const applicable = passed.length + groups.length;
  const v = verdict(groups, active, target);
  const logo = safeImage(meta.logo);
  const preparedBy = meta.preparedBy?.trim();
  const organisation = meta.organisation?.trim();

  const sevList = SEVERITY_ORDER.map(
    (s) =>
      `<li><span class="dot" style="background:${SEVERITY_COLOR[s]}" aria-hidden="true"></span><span>${s}</span><b>${counts[s]}</b><small>${escapeHtml(SEVERITY_MEANING[s])}</small></li>`,
  ).join("");

  const detailsHtml = groups.length
    ? groups.map(renderRuleDetails).join("\n")
    : `<section class="card"><h3 class="label">Issue details</h3><p>No open issues were found by the automated checks.</p></section>`;

  const list = (ids: string[]) => ids.map((r) => `<li><code>${escapeHtml(r)}</code></li>`).join("");
  const listsHtml = `<section class="card lists" aria-labelledby="h-lists">
<h3 id="h-lists" class="label">Rules checked</h3>
${passed.length ? `<details><summary>${plural(passed.length, "rule")} passed</summary><ul>${list(passed)}</ul></details>` : ""}
${inapplicable.length ? `<details><summary>${plural(inapplicable.length, "rule")} not applicable (nothing on the page to test)</summary><ul>${list(inapplicable)}</ul></details>` : ""}
${unscanned.length ? `<details open><summary>${plural(unscanned.length, "frame")} could not be scanned</summary><ul>${list(unscanned)}</ul><p class="muted small">Usually cross-origin frames without permission. Their content is not covered by this report.</p></details>` : `<p class="muted small">All frames on the page were scanned.</p>`}
</section>`;

  const coverFacts = [
    ["Date", formatDate(result.timestamp)],
    ["Standard", target],
    ...(organisation ? [["Organisation", organisation]] : []),
    ...(preparedBy ? [["Prepared by", preparedBy]] : []),
    ...(result.environment ? [["Environment", result.environment]] : []),
  ]
    .map(([k, val]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(val)}</dd>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Accessibility report: ${escapeHtml(pageTitle)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to report</a>
<header class="cover"><div class="wrap">
<div class="brand">${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>Accessibility report</h1><p class="page">${escapeHtml(pageTitle)} · ${urlHtml}</p></div></div>
<dl aria-label="Report facts">${coverFacts}</dl>
</div></header>
<nav class="toc" aria-label="Report sections"><ul class="wrap">
<li><a href="#part-summary">Summary</a></li>${groups.length ? `<li><a href="#h-top">Fix these first</a></li>` : ""}<li><a href="#h-tested">What was tested</a></li><li><a href="#part-dev">Developer details</a></li>${excluded.length ? `<li><a href="#h-excluded">Excluded issues</a></li>` : ""}<li><a href="#h-scan">Scan details</a></li>
</ul></nav>

<main id="main" class="wrap">
<div class="part first" id="part-summary"><h2>Part 1 · Summary</h2><span>For team leads and clients</span></div>

<section class="card verdict ${v.tone}" aria-labelledby="h-verdict">
<h3 id="h-verdict">${escapeHtml(v.title)}</h3>
<p>${escapeHtml(v.text)}</p>
</section>

<section class="hero" aria-label="Key figures">
<div class="card"><h3 class="label">Accessibility score</h3>
<div class="score">${scoreRing(score)}<div><span class="bandpill ${band.cls}">${band.label}</span>
<p class="muted small">Share of the ${applicable} rules that applied which passed, with more serious rules counting more. Use it to track progress, not as a pass mark.</p></div></div></div>
<div class="card"><h3 class="label">Issues by severity</h3>
<div class="sev">${severityDonut(counts, active.length)}<ul aria-label="Open issues by severity">${sevList}</ul></div></div>
<div class="card"><h3 class="label">Rules</h3>
<div class="kpis"><div class="kpi"><b>${groups.length}</b><span>failed</span></div><div class="kpi"><b>${passed.length}</b><span>passed</span></div><div class="kpi"><b>${inapplicable.length}</b><span>not applicable</span></div><div class="kpi"><b>${excluded.length}</b><span>issues excluded</span></div></div></div>
</section>

<div class="two stretch">
${renderTopProblems(groups) || `<section class="card"><h3 class="label">Fix these first</h3><p>Nothing to fix: the automated checks found no open issues.</p></section>`}
${renderAffected(groups) || ""}
</div>

<div class="two">
<section class="card" id="h-tested" aria-labelledby="h-tested-t">
<h3 id="h-tested-t" class="label">What was tested</h3>
<dl class="facts-list">
<dt>Page</dt><dd>${escapeHtml(pageTitle)}<br>${urlHtml}</dd>
<dt>Scope</dt><dd>${scopeHtml}</dd>
<dt>Standard</dt><dd>${escapeHtml(target)}</dd>
<dt>Method</dt><dd>Automated checks (${escapeHtml(rulesText)})</dd>
<dt>Date</dt><dd>${escapeHtml(formatDate(result.timestamp))}</dd>
<dt>Browser</dt><dd>${escapeHtml(result.browser)} · ${escapeHtml(result.viewport?.width)} × ${escapeHtml(result.viewport?.height)} px</dd>
</dl>
</section>
<section class="card limits" aria-labelledby="h-limits">
<h3 id="h-limits" class="label">About this report</h3>
<p>Automated tools find roughly 30–40% of accessibility problems. Passing these checks does <b>not</b> mean the page is fully accessible or WCAG conformant.</p>
<p>Still to be checked by a person:</p>
<ul class="small"><li>Using the page with only a keyboard and with a screen reader</li><li>Whether alt text, labels and headings are meaningful</li><li>Captions, transcripts and audio description quality</li><li>Error handling, timeouts and complex widgets</li></ul>
</section>
</div>

<div class="part" id="part-dev"><h2>Part 2 · Developer details</h2><span>Everything needed to find and fix each issue</span></div>
<p class="intro">Each problem below explains why it matters and how to fix it, then lists every affected element with its own measurements, suggested fix, code location and HTML.</p>

${renderSeverityFilter(counts, `${renderFailedRulesTable(groups)}

${detailsHtml}`)}

${renderExcluded(excluded)}

${listsHtml}

<section class="card" id="h-scan" aria-labelledby="h-scan-t">
<h3 id="h-scan-t" class="label">Scan details</h3>
<table class="facts"><caption class="sr-only">Scan details</caption><tbody>
<tr><th scope="row">Page</th><td>${escapeHtml(pageTitle)}</td></tr>
<tr><th scope="row">URL</th><td>${urlHtml}</td></tr>
<tr><th scope="row">Scanned at</th><td>${escapeHtml(formatDate(result.timestamp))}</td></tr>
${result.environment ? `<tr><th scope="row">Environment</th><td>${escapeHtml(result.environment)}</td></tr>` : ""}
<tr><th scope="row">Browser</th><td>${escapeHtml(result.browser)}</td></tr>
<tr><th scope="row">Viewport</th><td>${escapeHtml(result.viewport?.width)} × ${escapeHtml(result.viewport?.height)} px</td></tr>
<tr><th scope="row">Standard</th><td>${escapeHtml(target)}</td></tr>
<tr><th scope="row">Rules</th><td>${escapeHtml(rulesText)}</td></tr>
<tr><th scope="row">Scope</th><td>${scopeHtml}</td></tr>
<tr><th scope="row">Scan duration</th><td>${escapeHtml(formatDuration(result.durationMs))}</td></tr>
<tr><th scope="row">Scan id</th><td><code>${escapeHtml(result.scanId)}</code></td></tr>
</tbody></table>
</section>

<footer><p>Generated by ${escapeHtml(tool.name)} v${escapeHtml(tool.version)} on ${escapeHtml(formatDate(new Date().toISOString()))}${
    preparedBy ? `, prepared by ${escapeHtml(preparedBy)}` : ""
  }. The score is a trend indicator, not a compliance certificate.</p></footer>
</main>
</body>
</html>
`;
}
