/**
 * Link text rules (both best practice).
 *
 * Emits:
 *  - LNK-03  vague link text such as "click here" / "read more" (Auto, Moderate, BP)
 *  - LNK-05  link opens a new window/tab without warning (Auto, Minor, BP)
 *
 * Heuristics and their risks
 * --------------------------
 *  - LNK-03 judges the *accessible name* (aria-label / aria-labelledby win
 *    over the visible text), so `<a aria-label="Read more about pricing">Read
 *    more</a>` passes. Links with `aria-describedby` are skipped because the
 *    description may supply the context (2.4.4 allows "in context").
 *    Trailing punctuation, arrows and ellipses are stripped before matching.
 *    A link whose vague text is complemented by the surrounding sentence is
 *    still flagged (the rule cannot read intent), hence best practice only.
 *  - LNK-05 looks for "new window", "new tab", "opens in", "external" in the
 *    link's text, aria-label, title, aria-describedby text, and in the alt /
 *    aria-label / <title> of icons inside the link. A site that announces the
 *    behaviour once in a global notice will see false positives.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { accessibleName } from "@src/content/dom-utils";
import { isExtensionElement } from "./contrast";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const PRIMARY = ruleDef("LNK-03");
const NEW_WINDOW = ruleDef("LNK-05");
const CHUNK = 200;

export const VAGUE_LINK_TEXT = new Set([
  "click here",
  "click",
  "here",
  "read more",
  "more",
  "learn more",
  "link",
  "details",
  "more details",
  "more info",
  "more information",
  "info",
  "this",
  "this link",
  "this page",
  "continue",
  "continue reading",
  "go",
  "view",
  "view more",
  "see more",
  "see details",
  "find out more",
  "show more",
  "open",
  "download",
  "page",
  "website",
  "url",
  "http",
  "https",
]);

export const NEW_WINDOW_RE = /\b(new\s+(window|tab)|opens?\s+in\s+(a\s+)?(new|separate|another)|external\s+(link|site|window)|opens\s+external)\b/i;

/** Normalise link text for matching: lower-case, collapse whitespace, strip decoration. */
export function normaliseLinkText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[…›»→>]+/g, " ") // ellipsis, chevrons, arrows
    .replace(/\.{2,}/g, " ")
    .replace(/[\s\p{P}]+$/gu, "")
    .replace(/^[\s\p{P}]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isVagueLinkText(text: string): boolean {
  const norm = normaliseLinkText(text);
  if (!norm) return false;
  return VAGUE_LINK_TEXT.has(norm);
}

/** All text a user (sighted or screen reader) could receive from this link that might warn about a new window. */
function warningText(link: Element, doc: Document): string {
  const parts: string[] = [];
  parts.push(link.textContent ?? "");
  parts.push(link.getAttribute("aria-label") ?? "");
  parts.push(link.getAttribute("title") ?? "");
  const describedBy = link.getAttribute("aria-describedby");
  if (describedBy) {
    for (const id of describedBy.split(/\s+/)) {
      if (!id) continue;
      const ref = doc.getElementById(id);
      if (ref) parts.push(ref.textContent ?? "");
    }
  }
  const labelledBy = link.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      if (!id) continue;
      const ref = doc.getElementById(id);
      if (ref) parts.push(ref.textContent ?? "");
    }
  }
  for (const child of Array.from(link.querySelectorAll("img, svg, [aria-label], [title], [alt]"))) {
    parts.push(child.getAttribute("alt") ?? "");
    parts.push(child.getAttribute("aria-label") ?? "");
    parts.push(child.getAttribute("title") ?? "");
    if (child.tagName.toLowerCase() === "svg") {
      const t = child.querySelector("title");
      if (t) parts.push(t.textContent ?? "");
    }
  }
  return parts.join(" ");
}

export const rule: CustomRule = {
  id: PRIMARY.id,
  emits: [NEW_WINDOW.id],
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Moderate",
  defaultFix: {
    summary: "Make the link text describe its destination or purpose (for example \"Read more about our pricing\") so it makes sense out of context.",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
    let links: Element[] = [];
    try {
      links = Array.from(ctx.root.querySelectorAll("a[href], [role='link']"));
    } catch {
      return findings;
    }
    for (let i = 0; i < links.length; i++) {
      if (i > 0 && i % CHUNK === 0) {
        await ctx.yieldToMain();
        ctx.progress?.(Math.round((i / links.length) * 100));
      }
      const link = links[i];
      if (!link) continue;
      try {
        if (isExtensionElement(link, ctx) || !ctx.isVisible(link)) continue;
        if (link.getAttribute("aria-hidden") === "true") continue;

        // --- LNK-03 ----------------------------------------------------------
        const name = accessibleName(link);
        if (isVagueLinkText(name) && !link.hasAttribute("aria-describedby")) {
          const href = link.getAttribute("href") ?? "";
          findings.push({
            element: link,
            type: PRIMARY.type,
            severity: PRIMARY.severity ?? "Moderate",
            description: `The link text "${name.trim()}" does not describe the link's destination${href ? ` (${href.length > 80 ? `${href.slice(0, 79)}…` : href})` : ""}; screen reader users often navigate by a list of links out of context.`,
            data: { ruleId: PRIMARY.id, text: name.trim(), href },
            fix: {
              summary: "Rewrite the link text to describe the destination, or add an aria-label / visually hidden text that completes it (e.g. \"Read more about pricing\").",
            },
          });
        }

        // --- LNK-05 ----------------------------------------------------------
        const target = (link.getAttribute("target") ?? "").trim().toLowerCase();
        if (target === "_blank") {
          const text = warningText(link, doc);
          if (!NEW_WINDOW_RE.test(text)) {
            findings.push({
              element: link,
              type: NEW_WINDOW.type,
              severity: NEW_WINDOW.severity ?? "Minor",
              description: `The link "${name.trim() || link.getAttribute("href") || ""}" opens in a new window or tab (target="_blank") without telling the user; unexpected context changes disorient screen reader and cognitive-impaired users.`,
              data: { ruleId: NEW_WINDOW.id, text: name.trim(), href: link.getAttribute("href") ?? "", target },
              fix: {
                summary: "Append \"(opens in a new tab)\" to the link text or its aria-label, or add an icon with alt text \"opens in a new tab\". Alternatively drop target=\"_blank\".",
                suggestedValue: "<span class=\"sr-only\"> (opens in a new tab)</span>",
                docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html",
              },
            });
          }
        }
      } catch {
        // next link
      }
    }
    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
