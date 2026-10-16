/**
 * Groups a rule's findings by their shared cause, so a page that repeats one
 * mistake (40 tokens of one code sample in the same colours, one cookie banner
 * covering 23 links, one component on every row) reads as a few causes rather
 * than a long flat list. Every finding is kept: grouping changes only how a
 * rule's elements are listed, never counts, score, ignore or baseline.
 *
 * The cause comes from the finding's own data where a rule records it (the
 * colour pair, the covering element, the duplicated id, the link text).
 * Otherwise it is the kind of element (tag and stable classes)
 * together with the finding's message, with element-specific values (quoted
 * text, ids, numbers) taken out.
 */
import type { Issue } from "./types";

export interface IssueCause {
  /** Stable within a rule; equal keys mean the same cause. */
  key: string;
  /** Short human label, e.g. "Text #999999 on #fcfcfc". */
  label: string;
}

export interface CauseGroup<T> {
  cause: IssueCause;
  items: T[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** `<tag.class1.class2>` from an HTML snippet; classes with digits (generated, per-item) are left out. */
export function elementKind(html: string | undefined): string {
  const open = /^<\s*([a-z0-9-]+)([^>]*)>/i.exec(html ?? "");
  if (!open) return "";
  const classes = (/\bclass\s*=\s*"([^"]*)"/i.exec(open[2] ?? "")?.[1] ?? "")
    .split(/\s+/)
    .filter((c) => c && !/\d/.test(c))
    .slice(0, 3);
  return `<${(open[1] ?? "").toLowerCase()}${classes.map((c) => `.${c}`).join("")}>`;
}

/** The finding's message without the parts that differ per element. */
function genericMessage(issue: Issue): string {
  const checks = Array.isArray(issue.data?.checks) ? (issue.data?.checks as Array<{ message?: unknown }>).map((c) => str(c?.message)).join(" ") : "";
  return (checks || issue.description || "")
    .replace(/"[^"]*"|“[^”]*”|'[^']*'/g, "…")
    .replace(/#[0-9a-f]{3,8}\b/gi, "#")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

export function issueCause(issue: Issue): IssueCause {
  const d = issue.data ?? {};
  const rule = issue.ruleId;
  const fg = str(d.foreground);
  const bg = str(d.background);
  const make = (key: string, label: string): IssueCause => ({ key: `${rule}|${key}`, label });
  const ratio = str(d.ratio) ? ` · ${str(d.ratio)}:1` : "";

  if (rule === "CLR-05" || rule === "CLR-09") {
    if (fg && bg) return make(`ind|${str(d.indicator)}|${fg}|${bg}`, `${str(d.indicator) || "Indicator"} ${fg} on ${bg}${ratio}`);
  } else if (rule === "CLR-03") {
    if (str(d.reason) === "gradient" && fg) return make(`gradient|${fg}|${bg}`, `Text ${fg} on a gradient`);
    if (fg) return make(`img|${str(d.reason)}|${fg}`, `Text ${fg} over ${str(d.reason) === "media" ? "an image or video" : "a background image"}`);
  } else if (rule === "CLR-04") {
    if (fg && bg) return make(`border|${fg}|${bg}`, `Border ${fg} on ${bg}${ratio}`);
  } else if (rule.startsWith("CLR-")) {
    if (fg && bg) return make(`text|${fg}|${bg}`, `Text ${fg} on ${bg}${ratio}`);
  }
  if (str(d.obscuredBy)) return make(`cover|${str(d.obscuredBy)}`, `Covered by ${str(d.obscuredBy)}`);
  if (rule === "STR-08" && str(d.id)) return make(`id|${str(d.id)}`, `id "${str(d.id)}"`);
  if (rule === "LNK-03" && str(d.text)) return make(`text|${str(d.text).toLowerCase()}`, `Link text "${str(d.text)}"`);

  // Everything else (small targets included: their sizes rarely match exactly) by kind of element.
  const kind = elementKind(issue.element?.html);
  const message = genericMessage(issue);
  return make(`kind|${kind}|${message}`, kind ? `Same element ${kind}` : `Same message: ${message.length > 70 ? `${message.slice(0, 69)}…` : message}`);
}

/**
 * Items grouped by cause, in the order each cause first appears. `causeOf`
 * reads the cause from an item (an Issue, or a report row carrying one).
 */
export function groupByCause<T>(items: T[], causeOf: (item: T) => IssueCause): Array<CauseGroup<T>> {
  const groups = new Map<string, CauseGroup<T>>();
  for (const item of items) {
    const cause = causeOf(item);
    const g = groups.get(cause.key);
    if (g) g.items.push(item);
    else groups.set(cause.key, { cause, items: [item] });
  }
  return [...groups.values()];
}
