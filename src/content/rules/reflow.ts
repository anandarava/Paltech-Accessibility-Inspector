/**
 * Reflow and text-spacing rules.
 *
 * Emits:
 *  - ZM-02  horizontal scrolling at 320 CSS px width (Auto, Serious, WCAG 1.4.10).
 *           Only evaluated when `window.innerWidth <= 320`: the service worker
 *           emulates that width through CDP before asking for the check; at
 *           any other width the rule returns nothing and the SW adds a Semi
 *           note that the reflow check did not run.
 *  - ZM-03  content clipped when the WCAG 1.4.12 text spacing is applied
 *           (Auto, Moderate): line-height 1.5, paragraph spacing 2em,
 *           letter-spacing 0.12em, word-spacing 0.16em.
 *
 * Method for ZM-03: candidates are visible elements with overflow hidden/clip
 * on either axis that contain text. Their scroll/client sizes are measured,
 * a <style> element applying the spacing with !important is injected, the
 * sizes are measured again synchronously in one pass (a single relayout) and
 * the style is removed in `finally`. "Clipped" means that the lines of text
 * themselves reach outside the element's visible box, not merely that its
 * scroll size grew: the 2em paragraph spacing adds a bottom margin to the last
 * paragraph, which raises `scrollHeight` without hiding any text. Only
 * elements whose text was NOT clipped before but IS clipped after are
 * reported, so pre-existing clipping (a carousel) is not blamed on text
 * spacing. Text truncated on purpose (`-webkit-line-clamp`, `text-overflow:
 * ellipsis`) is reported as Semi (needs review): whether the full text is
 * available elsewhere decides.
 *
 * Risks
 * -----
 *  - Elements with `text-overflow: ellipsis` that wrap to a second line and
 *    get cut are correctly flagged; a container that grows with its content
 *    is not (WCAG allows that).
 *  - Fixed-height containers whose overflow is *visible* let text spill
 *    over neighbours; that is a real 1.4.12 issue this rule does not detect.
 *  - The page briefly relayouts with the spacing applied; scroll-driven or
 *    ResizeObserver-driven scripts may react. The style is removed before
 *    the rule resolves and before any yield.
 *  - ZM-02 blames the widest overflowing elements it can find; content that
 *    overflows because of `white-space: nowrap` on a small element deep in
 *    the tree may be listed as an ancestor instead.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { EXT_MARKER_ATTR } from "@shared/constants";
import { isExtensionElement } from "./contrast";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const PRIMARY = ruleDef("ZM-02");
const SPACING = ruleDef("ZM-03");
const REFLOW_WIDTH = 320;
const CHUNK = 200;
const MAX_CANDIDATES = 3000;
const TOLERANCE = 1; // px, sub-pixel rounding

const SPACING_CSS = [
  `*:not([${EXT_MARKER_ATTR}]):not([${EXT_MARKER_ATTR}] *) { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }`,
  `p:not([${EXT_MARKER_ATTR}] *) { margin-bottom: 2em !important; }`,
].join("\n");

function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
  return `<${el.tagName.toLowerCase()}${id}${cls}>`;
}

function hasDirectText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent ?? "")) return true;
  }
  return false;
}

function containsText(el: Element): boolean {
  return /\S/.test(el.textContent ?? "");
}

interface Measure {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  /** Text lines reach outside the visible box horizontally / vertically. */
  textOutX: boolean;
  textOutY: boolean;
  /** How far (px) the text reaches past the box horizontally / vertically. */
  outX: number;
  outY: number;
}

/** Text nodes looked at per container; enough to find the first and last lines of real content. */
const MAX_TEXT_NODES = 300;

/** Union of the line boxes of the text inside `el` (viewport coordinates); null when no text is laid out. */
function textExtent(el: Element): { left: number; top: number; right: number; bottom: number } | null {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  let ext: { left: number; top: number; right: number; bottom: number } | null = null;
  let n = 0;
  for (let node = walker.nextNode(); node && n < MAX_TEXT_NODES; node = walker.nextNode()) {
    if (!/\S/.test(node.textContent ?? "")) continue;
    n++;
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width <= 0 || r.height <= 0) continue;
      ext = ext
        ? { left: Math.min(ext.left, r.left), top: Math.min(ext.top, r.top), right: Math.max(ext.right, r.right), bottom: Math.max(ext.bottom, r.bottom) }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
  }
  range.detach();
  return ext;
}

function measure(el: Element): Measure {
  const m = { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, textOutX: false, textOutY: false, outX: 0, outY: 0 };
  // Cheap exit: nothing can be cut off when the content fits.
  if (m.scrollWidth <= m.clientWidth + TOLERANCE && m.scrollHeight <= m.clientHeight + TOLERANCE) return m;
  const text = textExtent(el);
  if (!text) return m;
  const r = el.getBoundingClientRect();
  const left = r.left + el.clientLeft;
  const top = r.top + el.clientTop;
  m.textOutX = text.left < left - TOLERANCE || text.right > left + el.clientWidth + TOLERANCE;
  m.textOutY = text.top < top - TOLERANCE || text.bottom > top + el.clientHeight + TOLERANCE;
  // How far the text reaches past the box (px), to tell lost words from cut-off letter tails.
  m.outX = Math.max(0, left - text.left, text.right - (left + el.clientWidth));
  m.outY = Math.max(0, top - text.top, text.bottom - (top + el.clientHeight));
  return m;
}

function overflows(m: Measure, x: boolean, y: boolean): boolean {
  return (x && m.textOutX) || (y && m.textOutY);
}

function scrollOverflows(m: Measure, x: boolean, y: boolean): boolean {
  return (x && m.scrollWidth > m.clientWidth + TOLERANCE) || (y && m.scrollHeight > m.clientHeight + TOLERANCE);
}

/** Share of the font size that text may reach past its box and still only lose letter tails. */
const TAIL_SHARE = 0.5;

/** True when `el` lays out three or more items side by side (directly or one wrapper down). */
function isItemRow(el: Element, view: Window): boolean {
  for (const box of [el, ...Array.from(el.children).slice(0, 3)]) {
    const items = Array.from(box.children).filter((k) => (k as HTMLElement).offsetWidth > 0);
    if (items.length < 3) continue;
    const tops = items.slice(0, 6).map((k) => Math.round(k.getBoundingClientRect().top));
    if (tops.every((t) => Math.abs(t - (tops[0] as number)) <= 2)) return true;
  }
  return false;
}

/** Text cut short on purpose: `-webkit-line-clamp` or `text-overflow: ellipsis`. */
function isDeliberateTruncation(el: Element, view: Window): boolean {
  const cs = view.getComputedStyle(el);
  const clamp = (cs as unknown as { webkitLineClamp?: string }).webkitLineClamp ?? cs.getPropertyValue("-webkit-line-clamp");
  return (!!clamp && clamp !== "none") || cs.textOverflow === "ellipsis";
}

// ---------------------------------------------------------------------------
// ZM-02
// ---------------------------------------------------------------------------

async function checkReflow(ctx: RuleContext, findings: RuleFinding[]): Promise<void> {
  const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
  const view = doc.defaultView ?? window;
  if (view.innerWidth > REFLOW_WIDTH || view.innerWidth <= 0) return;
  const html = doc.documentElement;
  const body = doc.body;
  const scrollWidth = Math.max(html.scrollWidth, body ? body.scrollWidth : 0);
  if (scrollWidth <= view.innerWidth + TOLERANCE) return;

  // Identify the widest elements that stick out of the viewport (up to 5).
  const offenders: Array<{ element: Element; right: number; width: number }> = [];
  try {
    const all = Array.from(ctx.root.querySelectorAll("body *"));
    for (let i = 0; i < all.length; i++) {
      if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
      const el = all[i];
      if (!el) continue;
      try {
        if (isExtensionElement(el, ctx) || !ctx.isVisible(el)) continue;
        const cs = view.getComputedStyle(el);
        if (cs.position === "fixed") continue; // fixed elements do not extend the scroll width
        const r = el.getBoundingClientRect();
        const right = r.right + view.scrollX;
        if (right <= view.innerWidth + TOLERANCE) continue;
        // Skip elements whose overflowing parent is already recorded (report the outermost cause).
        if (offenders.some((o) => o.element.contains(el))) continue;
        offenders.push({ element: el, right, width: r.width });
      } catch {
        // next
      }
    }
  } catch {
    // ignore
  }
  offenders.sort((a, b) => b.right - a.right);
  const top = offenders.slice(0, 5);
  const target = top[0]?.element ?? html;
  findings.push({
    element: target,
    type: PRIMARY.type,
    severity: PRIMARY.severity ?? "Serious",
    description: `At a viewport width of ${view.innerWidth}px the page is ${scrollWidth}px wide and requires horizontal scrolling (${scrollWidth - view.innerWidth}px). ${top.length ? `Widest overflowing elements: ${top.map((o) => `${describe(o.element)} (${Math.round(o.width)}px, right edge ${Math.round(o.right)}px)`).join("; ")}.` : ""}`,
    data: {
      ruleId: PRIMARY.id,
      viewportWidth: view.innerWidth,
      scrollWidth,
      overflowPx: scrollWidth - view.innerWidth,
      offenders: top.map((o) => ({ element: describe(o.element), width: Math.round(o.width), right: Math.round(o.right) })),
    },
    fix: {
      summary: "Use fluid widths (max-width: 100%, flexible grids, `min-width: 0` on flex items) and wrap long strings (`overflow-wrap: anywhere`) so all content fits in 320px without two-dimensional scrolling; tables and images may scroll on their own.",
      docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/reflow.html",
    },
  });
}

// ---------------------------------------------------------------------------
// ZM-03
// ---------------------------------------------------------------------------

interface Candidate {
  element: Element;
  x: boolean;
  y: boolean;
  before: Measure;
}

async function checkTextSpacing(ctx: RuleContext, findings: RuleFinding[]): Promise<void> {
  const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
  const view = doc.defaultView ?? window;

  // Phase 1 (chunked, page untouched): collect clipping containers with text and their baseline sizes.
  const candidates: Candidate[] = [];
  let all: Element[] = [];
  try {
    all = Array.from(ctx.root.querySelectorAll("*"));
  } catch {
    return;
  }
  for (let i = 0; i < all.length && candidates.length < MAX_CANDIDATES; i++) {
    if (i > 0 && i % CHUNK === 0) {
      await ctx.yieldToMain();
      ctx.progress?.(50 + Math.round((i / all.length) * 40));
    }
    const el = all[i];
    if (!el) continue;
    try {
      const tag = el.tagName;
      if (tag === "HTML" || tag === "BODY" || tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || tag === "SVG" || tag === "IFRAME") continue;
      if (el.closest("svg")) continue;
      if (isExtensionElement(el, ctx)) continue;
      const cs = view.getComputedStyle(el);
      const x = cs.overflowX === "hidden" || cs.overflowX === "clip";
      const y = cs.overflowY === "hidden" || cs.overflowY === "clip";
      if (!x && !y) continue;
      if (!containsText(el)) continue;
      if (!ctx.isVisible(el)) continue;
      candidates.push({ element: el, x, y, before: measure(el) });
    } catch {
      // next
    }
  }
  if (candidates.length === 0) return;

  // Phase 2 (synchronous): inject spacing, measure once, remove.
  const style = doc.createElement("style");
  style.setAttribute(EXT_MARKER_ATTR, "text-spacing-probe");
  style.textContent = SPACING_CSS;
  const results: Array<{ c: Candidate; after: Measure }> = [];
  try {
    (doc.head ?? doc.documentElement).appendChild(style);
    // Force a synchronous layout with the new styles before reading sizes.
    void doc.documentElement.offsetHeight;
    for (const c of candidates) {
      try {
        results.push({ c, after: measure(c.element) });
      } catch {
        // next
      }
    }
  } finally {
    try {
      style.remove();
    } catch {
      // ignore
    }
  }

  const reported: Element[] = [];
  for (const { c, after } of results) {
    try {
      // Ellipsis and line-clamp draw the visible text inside the box, so text that is cut
      // short on purpose is recognised by its scroll size instead.
      // Truncated on purpose, or sized by script (an inline width or custom property, a rotating
      // headline word re-measured on each change): needs review rather than a failure.
      let scripted = false;
      for (let n: Element | null = c.element, i = 0; n && i < 3 && !scripted; n = n.parentElement, i++) scripted = /width|--/.test(n.getAttribute("style") ?? "");
      const deliberate = isDeliberateTruncation(c.element, view) || scripted;
      // A row of items side by side cut off only sideways is usually a carousel or scroller whose
      // other items are reached with its own controls: needs review.
      const row = c.x && !c.y && isItemRow(c.element, view);
      const cut = deliberate ? scrollOverflows : overflows;
      const overflowedBefore = cut(c.before, c.x, c.y);
      const overflowsAfter = cut(after, c.x, c.y);
      if (overflowedBefore || !overflowsAfter) continue;
      // Decoration hidden from assistive technology (a product mock-up in a hero): not content.
      if (c.element.closest("[aria-hidden='true'], [role='presentation'], [role='none']")) continue;
      // Only the tails of the last line's letters (p, g, y) are cut: every word stays readable.
      const fontSize = parseFloat(view.getComputedStyle(c.element).fontSize) || 16;
      if (!deliberate && after.outX <= TOLERANCE && after.outY < fontSize * TAIL_SHARE) continue;
      // Ancestor already reported: the inner clip is a consequence.
      if (reported.some((r) => r.contains(c.element))) continue;
      reported.push(c.element);
      const clippedX = c.x && (deliberate ? after.scrollWidth > after.clientWidth + TOLERANCE : after.textOutX);
      const clippedY = c.y && (deliberate ? after.scrollHeight > after.clientHeight + TOLERANCE : after.textOutY);
      const axis = clippedX && clippedY ? "horizontally and vertically" : clippedX ? "horizontally" : "vertically";
      const snippet = (c.element.textContent ?? "").replace(/\s+/g, " ").trim();
      findings.push({
        element: c.element,
        type: deliberate || row ? "Semi" : SPACING.type,
        severity: SPACING.severity ?? "Moderate",
        description: `With WCAG text spacing applied (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, paragraph spacing 2em) the text of ${describe(c.element)} is cut off ${axis} (${after.scrollWidth}x${after.scrollHeight}px of content in a ${after.clientWidth}x${after.clientHeight}px box with overflow hidden)${snippet ? `: "${snippet.length > 60 ? `${snippet.slice(0, 59)}…` : snippet}"` : ""}.${deliberate ? " The text is shortened on purpose (line-clamp or ellipsis); check that the full text is available, for example on the page the item links to." : ""}${row && !deliberate ? " The box holds a row of items side by side (a carousel or scroller); check whether the items cut off can still be reached with its controls." : ""}`,
        data: {
          ruleId: SPACING.id,
          before: c.before,
          after,
          clippedX,
          clippedY,
          directText: hasDirectText(c.element),
          deliberateTruncation: deliberate,
        },
        fix: {
          summary: "Avoid fixed heights and `overflow: hidden` on text containers; let the box grow (min-height instead of height), or allow wrapping and scrolling so text stays readable with user-adjusted spacing.",
          suggestedValue: "min-height: auto; overflow: visible;",
          docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html",
        },
      });
    } catch {
      // next
    }
  }
}

// ---------------------------------------------------------------------------

export const rule: CustomRule = {
  id: PRIMARY.id,
  emits: [SPACING.id],
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Serious",
  defaultFix: {
    summary: "Ensure content reflows to a 320 CSS px wide viewport without horizontal scrolling and survives increased text spacing without clipping.",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/reflow.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    try {
      await checkReflow(ctx, findings);
    } catch {
      // ignore
    }
    ctx.progress?.(50);
    await ctx.yieldToMain();
    try {
      await checkTextSpacing(ctx, findings);
    } catch {
      // ignore
    } finally {
      // Belt and braces: make sure no probe style survives an unexpected throw.
      try {
        const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
        doc.querySelectorAll(`style[${EXT_MARKER_ATTR}="text-spacing-probe"]`).forEach((s) => s.remove());
      } catch {
        // ignore
      }
    }
    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
