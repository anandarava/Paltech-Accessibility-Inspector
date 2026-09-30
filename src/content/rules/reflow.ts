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
 * the style is removed in `finally`. Only elements that did NOT overflow
 * before but DO overflow after are reported, so pre-existing clipping (an
 * intentional ellipsis, a carousel) is not blamed on text spacing.
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
}

function measure(el: Element): Measure {
  return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
}

function overflows(m: Measure, x: boolean, y: boolean): boolean {
  return (x && m.scrollWidth > m.clientWidth + TOLERANCE) || (y && m.scrollHeight > m.clientHeight + TOLERANCE);
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
      const overflowedBefore = overflows(c.before, c.x, c.y);
      const overflowsAfter = overflows(after, c.x, c.y);
      if (overflowedBefore || !overflowsAfter) continue;
      // Ancestor already reported: the inner clip is a consequence.
      if (reported.some((r) => r.contains(c.element))) continue;
      reported.push(c.element);
      const clippedX = c.x && after.scrollWidth > after.clientWidth + TOLERANCE;
      const clippedY = c.y && after.scrollHeight > after.clientHeight + TOLERANCE;
      const axis = clippedX && clippedY ? "horizontally and vertically" : clippedX ? "horizontally" : "vertically";
      const snippet = (c.element.textContent ?? "").replace(/\s+/g, " ").trim();
      findings.push({
        element: c.element,
        type: SPACING.type,
        severity: SPACING.severity ?? "Moderate",
        description: `With WCAG text spacing applied (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, paragraph spacing 2em) the content of ${describe(c.element)} is clipped ${axis} (${after.scrollWidth}x${after.scrollHeight}px of content in a ${after.clientWidth}x${after.clientHeight}px box with overflow hidden)${snippet ? `: "${snippet.length > 60 ? `${snippet.slice(0, 59)}…` : snippet}"` : ""}.`,
        data: {
          ruleId: SPACING.id,
          before: c.before,
          after,
          clippedX,
          clippedY,
          directText: hasDirectText(c.element),
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
