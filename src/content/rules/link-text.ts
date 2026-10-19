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
 *    description may supply the context (2.4.4 allows "in context"). A link
 *    whose text is a single <code> element is a term ("link" the ARIA role on
 *    a documentation page), not vague text, and is skipped too.
 *    Trailing punctuation, arrows and ellipses are stripped before matching.
 *    A vague link whose purpose is clear from its context passes 2.4.4 and is
 *    not reported: the sentence, paragraph, list item or table cell it sits in
 *    (at least three other words), or a heading before it in the same block
 *    (WCAG technique H80: "Learn more" under the card's heading).
 *  - LNK-05 looks for "new window", "new tab", "opens in", "external" in the
 *    link's text, aria-label, title, aria-describedby text, and in the alt /
 *    aria-label / <title> of icons inside the link. A site that announces the
 *    behaviour once in a global notice will see false positives.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { accessibleName, queryAllIncludingRoot } from "@src/content/dom-utils";
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

// Short action words that are legitimate standalone link/button text ("Continue", "Download", "Open",
// "View", "Go", "Page", "Website") are deliberately absent: they name an action or a target on their own.
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
  "continue reading",
  "view more",
  "see more",
  "see details",
  "find out more",
  "show more",
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

/**
 * A link whose whole text is one code element names a term, not a vague
 * phrase: `<a href="/Roles/link_role"><code>link</code></a>` on a
 * documentation page points to the definition of `link`.
 */
export function isCodeTerm(link: Element): boolean {
  const children = Array.from(link.children);
  if (children.length !== 1) return false;
  const only = children[0];
  if (!only || !["code", "kbd", "samp", "var"].includes(only.tagName.toLowerCase())) return false;
  return (link.textContent ?? "").trim() === (only.textContent ?? "").trim();
}

/**
 * A link whose text is the name of the page it points to: Stripe's product
 * "Link" at `/payments/link`. Matches the last path segment of the URL.
 */
export function namesItsTarget(link: Element, text: string): boolean {
  const href = link.getAttribute("href") ?? "";
  let segment = "";
  try {
    segment = new URL(href, link.ownerDocument.baseURI).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return false;
  }
  const norm = (v: string): string => v.toLowerCase().replace(/[-_\s]+/g, " ").replace(/\.[a-z0-9]+$/, "").trim();
  return !!segment && norm(decodeURIComponent(segment)) === norm(text);
}

const CONTEXT_BLOCKS = "p, li, td, th, dd, dt, figcaption, blockquote, label, caption";
const HEADINGS = "h1, h2, h3, h4, h5, h6, [role='heading']";
/** How far up from the link a heading still belongs to the link's own block (a card, a section). */
const HEADING_LEVELS = 4;

/** Words in `text`, ignoring punctuation. */
function wordCount(text: string): number {
  return text.split(/[\s\p{P}]+/u).filter(Boolean).length;
}

/**
 * The context that explains a vague link, or "" when there is none (WCAG
 * 2.4.4 "in context"): the sentence, paragraph, list item or table cell
 * around it with at least three words besides the link, or a heading that
 * comes before the link inside one of its nearest ancestors (H80). The
 * heading counts only for the link's own block (a card, a section of a page,
 * not the page's main region) and only when that block has no other vague
 * link: one heading cannot tell three "Read more" links apart.
 */
export function linkContext(link: Element): string {
  const own = (link.textContent ?? "").replace(/\s+/g, " ").trim();
  // The paragraph-like block around the link: a <p>, list item or cell, or (Kaggle's and go.dev's
  // cookie bars) the nearest plain box whose own text reads as a sentence with the link in it.
  const blocks = [link.parentElement?.closest(CONTEXT_BLOCKS), link.parentElement, link.parentElement?.parentElement];
  for (const block of blocks) {
    if (!block || block === link.ownerDocument.body || block === link.ownerDocument.documentElement || block.contains(link.ownerDocument.body)) continue;
    const links = Array.from(block.querySelectorAll("a[href], [role='link']"));
    if (links.length > 3) continue; // a list of links, not a sentence
    // The words around the link, leaving out the text of every link in the block.
    let rest = (block.textContent ?? "").replace(/\s+/g, " ");
    for (const other of links) rest = rest.replace((other.textContent ?? "").replace(/\s+/g, " ").trim(), " ");
    rest = rest.replace(/\s+/g, " ").trim();
    if (wordCount(rest) >= 3) return `the surrounding text "${rest.length > 60 ? `${rest.slice(0, 59)}…` : rest}"`;
  }
  let node: Element | null = link.parentElement;
  for (let level = 0; node && level < HEADING_LEVELS; level++, node = node.parentElement) {
    if (node === link.ownerDocument.body || node === link.ownerDocument.documentElement || node.matches("main, [role='main']")) break;
    const vagueLinks = Array.from(node.querySelectorAll("a[href], [role='link']")).filter((a) => isVagueLinkText(accessibleName(a)));
    if (vagueLinks.length > 1) break;
    const before = Array.from(node.querySelectorAll(HEADINGS)).filter(
      (h) => !h.contains(link) && !!(h.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING) && wordCount(h.textContent ?? "") > 0,
    );
    const heading = before[before.length - 1];
    if (heading) {
      const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
      return `the heading "${text.length > 60 ? `${text.slice(0, 59)}…` : text}"`;
    }
  }
  return "";
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
      links = Array.from(queryAllIncludingRoot(ctx.root, "a[href], [role='link']"));
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
        if (isVagueLinkText(name) && !link.hasAttribute("aria-describedby") && !isCodeTerm(link) && !namesItsTarget(link, name) && !linkContext(link)) {
          const href = link.getAttribute("href") ?? "";
          findings.push({
            element: link,
            type: PRIMARY.type,
            severity: PRIMARY.severity ?? "Moderate",
            description: `The link text "${name.trim()}" does not describe the link's destination${href ? ` (${href.length > 80 ? `${href.slice(0, 79)}…` : href})` : ""}, and nothing around it (a sentence, list item, table cell or heading before it) explains it; screen reader users often navigate by a list of links out of context.`,
            data: { ruleId: PRIMARY.id, text: name.trim(), href },
            fix: {
              summary: "Rewrite the link text to describe the destination, or add an aria-label / visually hidden text that completes it (e.g. \"Read more about pricing\").",
            },
          });
        }

        // --- LNK-05 ----------------------------------------------------------
        const target = (link.getAttribute("target") ?? "").trim().toLowerCase();
        const hrefValue = (link.getAttribute("href") ?? "").trim().toLowerCase();
        // href="#" or javascript: runs script in the page; target=_blank opens nothing.
        if (target === "_blank" && hrefValue !== "#" && !hrefValue.startsWith("javascript:")) {
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
