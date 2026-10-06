/**
 * KBD-06: focused element obscured by sticky/fixed content (WCAG 2.4.11).
 *
 * Method: for every focusable element (first 400) we scroll it into view
 * with `block: "nearest"` (what the browser does when focus moves), then hit
 * test with `elementFromPoint` on a 3x3 grid: the centre, the four corners
 * and the four edge midpoints, inset by 2px. If the element at the centre is
 * not the target (or inside it) and it, or one of its ancestors, is
 * `position: fixed` or `sticky` and is not an ancestor of the target, the
 * target is reported as obscured. Scroll positions (window and every
 * scrollable ancestor, including ones that started at 0) are restored
 * afterwards.
 *
 * Heuristics and their risks
 * --------------------------
 *  - 2.4.11 (minimum) only fails when the focused item is *entirely* hidden.
 *    When every in-viewport probe point is covered the finding is emitted as
 *    a definite (Auto) failure. When only the centre (and some other points)
 *    are covered the control is partially visible, which conforms at AA but
 *    fails 2.4.12 (AAA); such findings are emitted as Semi (needs review)
 *    with the probe data so the tester can judge.
 *  - Elements the page overlays on purpose (a modal backdrop while the dialog
 *    is open) will show as obscured; those focusables should normally be
 *    inert anyway.
 *  - `elementFromPoint` respects `pointer-events: none`; a sticky bar with
 *    pointer-events disabled is invisible to this check (false negative).
 *  - Scrolling happens for real (briefly); pages with scroll-driven effects
 *    may react. Everything is restored before the rule resolves.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { getFocusableElements } from "@src/content/dom-utils";
import { isExtensionElement } from "./contrast";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const PRIMARY = ruleDef("KBD-06");
const MAX_FOCUSABLES = 400;
const CHUNK = 25;
const INSET = 2;

interface ScrollState {
  element: Element;
  top: number;
  left: number;
}

/**
 * Record scroll offsets of every scrollable ancestor so they can be restored.
 *
 * An ancestor is recorded when it *can* scroll (its content overflows its
 * client box) or is already scrolled, regardless of whether its current
 * offset is 0: `scrollIntoView` scrolls any overflow container on the path,
 * including ones that were sitting at the top, and those must be reset too.
 */
function recordAncestorScroll(el: Element): ScrollState[] {
  const out: ScrollState[] = [];
  let cur: Element | null = el.parentElement;
  while (cur) {
    try {
      const top = cur.scrollTop;
      const left = cur.scrollLeft;
      const scrollable =
        top !== 0 ||
        left !== 0 ||
        cur.scrollHeight > cur.clientHeight ||
        cur.scrollWidth > cur.clientWidth;
      if (scrollable) out.push({ element: cur, top, left });
    } catch {
      // ignore ancestors we cannot inspect
    }
    cur = cur.parentElement;
  }
  return out;
}

function restoreAncestorScroll(states: ScrollState[]): void {
  for (const s of states) {
    try {
      if (s.element.scrollTop !== s.top) s.element.scrollTop = s.top;
      if (s.element.scrollLeft !== s.left) s.element.scrollLeft = s.left;
    } catch {
      // ignore
    }
  }
}

/** Nearest fixed/sticky element at or above `hit` that is not an ancestor of `target`. */
function coveringStickyElement(hit: Element, target: Element, view: Window): Element | null {
  let cur: Element | null = hit;
  while (cur && cur !== view.document.documentElement) {
    if (cur === target || cur.contains(target)) return null;
    try {
      const pos = view.getComputedStyle(cur).position;
      if (pos === "fixed" || pos === "sticky") return cur;
    } catch {
      return null;
    }
    cur = cur.parentElement;
  }
  return null;
}

function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
  return `<${el.tagName.toLowerCase()}${id}${cls}>`;
}

export const rule: CustomRule = {
  id: PRIMARY.id,
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Serious",
  defaultFix: {
    summary: "Add `scroll-padding` to the scroll container equal to the height of sticky headers/footers, or reduce the size of fixed overlays so focused elements stay visible.",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
    const view = doc.defaultView ?? window;

    let focusables: HTMLElement[] = [];
    try {
      focusables = getFocusableElements(ctx.root)
        .filter((el) => {
          try {
            return !isExtensionElement(el, ctx) && ctx.isVisible(el);
          } catch {
            return false;
          }
        })
        .slice(0, MAX_FOCUSABLES);
    } catch {
      return findings;
    }

    const scrollX = view.scrollX;
    const scrollY = view.scrollY;
    const reported = new Set<Element>();

    try {
      for (let i = 0; i < focusables.length; i++) {
        if (i > 0 && i % CHUNK === 0) {
          await ctx.yieldToMain();
          ctx.progress?.(Math.round((i / focusables.length) * 100));
        }
        const el = focusables[i];
        if (!el || reported.has(el)) continue;
        const ancestors = recordAncestorScroll(el);
        try {
          const cs = view.getComputedStyle(el);
          if (cs.position === "fixed" || cs.position === "sticky") continue; // it is itself the sticky content
          el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const vw = view.innerWidth;
          const vh = view.innerHeight;
          // Fully outside the viewport even after scrollIntoView: cannot probe.
          if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;

          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          const inset = Math.min(INSET, r.width / 2, r.height / 2);
          // 3x3 grid: centre, four corners (inset) and the four edge midpoints.
          const points: Array<[string, number, number]> = [
            ["centre", cx, cy],
            ["top-left", r.left + inset, r.top + inset],
            ["top-centre", cx, r.top + inset],
            ["top-right", r.right - inset, r.top + inset],
            ["middle-left", r.left + inset, cy],
            ["middle-right", r.right - inset, cy],
            ["bottom-left", r.left + inset, r.bottom - inset],
            ["bottom-centre", cx, r.bottom - inset],
            ["bottom-right", r.right - inset, r.bottom - inset],
          ];

          let centreCover: Element | null = null;
          const coveredPoints: string[] = [];
          let probed = 0;
          for (const [name, x, y] of points) {
            if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
            probed++;
            const hit = doc.elementFromPoint(x, y);
            if (!hit || hit === el || el.contains(hit) || isExtensionElement(hit, ctx)) continue;
            const cover = coveringStickyElement(hit, el, view);
            if (!cover) continue;
            coveredPoints.push(name);
            if (name === "centre") centreCover = cover;
          }

          if (centreCover) {
            reported.add(el);
            // 2.4.11 (AA) fails only when the component is entirely hidden by
            // author content. Every in-viewport probe point covered -> definite
            // (Auto) failure. Partial coverage conforms at AA (2.4.12 AAA forbids
            // it) so it is emitted as Semi for the tester to judge.
            const entirely = probed > 0 && coveredPoints.length === probed;
            const coverPos = view.getComputedStyle(centreCover).position;
            const tag = el.tagName.toLowerCase();
            const description = entirely
              ? `When this ${tag} is scrolled into view and focused it is entirely hidden by the ${coverPos} element ${describe(centreCover)} (all ${probed} probe points covered).`
              : `When this ${tag} is scrolled into view and focused, its centre is covered by the ${coverPos} element ${describe(centreCover)} (${coveredPoints.length} of ${probed} probe points covered). Partial obscuring conforms to 2.4.11 (AA) but fails 2.4.12 Focus Not Obscured (Enhanced) (AAA); verify the focused control remains visible.`;
            findings.push({
              element: el,
              type: entirely ? PRIMARY.type : "Semi",
              severity: PRIMARY.severity ?? "Serious",
              description,
              data: {
                ruleId: PRIMARY.id,
                obscuredBy: describe(centreCover),
                obscuredByPosition: coverPos,
                coveredPoints,
                probedPoints: probed,
                entirelyObscured: entirely,
              },
            });
          }
        } catch {
          // continue with the next element
        } finally {
          restoreAncestorScroll(ancestors);
        }
      }
    } finally {
      try {
        if (view.scrollX !== scrollX || view.scrollY !== scrollY) view.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
      } catch {
        // ignore
      }
    }
    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
