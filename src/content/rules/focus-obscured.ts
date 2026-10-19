/**
 * KBD-06: focused element obscured by sticky/fixed content (WCAG 2.4.11).
 *
 * Method: starting with the page scrolled to the top, we move focus to every
 * focusable element (first 400) in order with `el.focus()`, and keep the
 * scroll positions from one element to the next, as a keyboard user pressing
 * Tab does. The browser scrolls each element into view exactly as it does
 * for Tab (Chrome keeps a focused element clear of sticky headers in its
 * scroll container, which `scrollIntoView` does not, and an element only
 * reached after the ones before it is seen in the scroll state they left).
 * Where focus cannot be moved, `scrollIntoView({ block: "nearest" })` is used
 * instead. Then we hit test with `elementFromPoint` on a 3x3 grid: the centre,
 * the four corners and the four edge midpoints, inset by 2px. If the element
 * at the centre is not the target (or inside it) and it, or one of its
 * ancestors, is a visible `position: fixed` or `sticky` element that is not
 * an ancestor of the target, the target is reported as obscured. Focus and
 * scroll positions (window and every scrollable ancestor, including ones that
 * started at 0) are restored afterwards.
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
 *  - A cover over 85% or more of the viewport (a cookie dialog's scrim, a
 *    modal backdrop) is a page overlay, not a sticky header: it is reported
 *    once for the page (Semi) instead of once per element behind it, and the
 *    per-element results of that scan are dropped: they describe the open
 *    dialog (its banner), not the page.
 *  - A cover that cannot be seen (opacity 0, visibility hidden, or at most
 *    2px in either direction, like an idle loading bar) does not count.
 *  - An element found covered is checked again after 350 ms, so a page that
 *    scrolls the focused element into view itself (a scrolling strip, smooth
 *    scrolling) is judged once its scrolling has finished.
 *  - Moving focus can trigger page behaviour (opening menus); the same is true
 *    of the focus-indicator check, which focuses every element as well.
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
/** Time budget for the whole check; past it the rest is left for manual review. */
const TIME_BUDGET_MS = 20_000;
const INSET = 2;
/** Wait before re-checking a covered element, so the page's own scroll-on-focus can finish. */
const SETTLE_MS = 350;
/** A cover over at least this share of the viewport is a page overlay, reported once (see run). */
const OVERLAY_SHARE = 0.85;

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

/**
 * Nearest fixed/sticky element at or above `hit` that is not an ancestor of
 * `target` and that can be seen: nothing from `hit` up to it is transparent
 * or hidden, and it is more than 2px in both directions.
 */
function coveringStickyElement(hit: Element, target: Element, view: Window): Element | null {
  let cur: Element | null = hit;
  while (cur && cur !== view.document.documentElement) {
    if (cur === target || cur.contains(target)) return null;
    try {
      const cs = view.getComputedStyle(cur);
      if (cs.opacity === "0" || cs.visibility === "hidden") return null;
      if (cs.position === "fixed" || cs.position === "sticky") {
        const box = cur.getBoundingClientRect();
        return box.width > 2 && box.height > 2 ? cur : null;
      }
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
    // Scroll containers touched during the walk, with their starting offsets, restored at the end.
    const saved = new Map<Element, ScrollState>();
    try {
      view.scrollTo({ left: 0, top: 0, behavior: "instant" }); // a keyboard user starts at the top
    } catch {
      // ignore
    }
    const originalActive = doc.activeElement;
    const reported = new Set<Element>();
    // Full-screen overlays (a cookie dialog's scrim, a modal) seen while probing: reported once.
    const overlays = new Set<Element>();
    const isFullScreen = (cover: Element): boolean => {
      const b = cover.getBoundingClientRect();
      const visW = Math.min(b.right, view.innerWidth) - Math.max(b.left, 0);
      const visH = Math.min(b.bottom, view.innerHeight) - Math.max(b.top, 0);
      return visW > 0 && visH > 0 && visW * visH >= view.innerWidth * view.innerHeight * OVERLAY_SHARE;
    };

    const started = Date.now();
    let stoppedAt = -1;
    try {
      for (let i = 0; i < focusables.length; i++) {
        if (i > 0 && i % CHUNK === 0) {
          await ctx.yieldToMain();
          ctx.progress?.(Math.round((i / focusables.length) * 100));
        }
        if (Date.now() - started > TIME_BUDGET_MS) {
          stoppedAt = i;
          break;
        }
        const el = focusables[i];
        if (!el || reported.has(el)) continue;
        for (const s of recordAncestorScroll(el)) if (!saved.has(s.element)) saved.set(s.element, s);
        try {
          const cs = view.getComputedStyle(el);
          if (cs.position === "fixed" || cs.position === "sticky") continue; // it is itself the sticky content
          // Let the browser scroll the element into view as it does for Tab.
          el.focus();
          if (doc.activeElement !== el) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
          // Hit-test a 3x3 grid on the element: the centre, four corners (inset) and the four edge midpoints.
          const probe = (): { centreCover: Element | null; coveredPoints: string[]; probed: number } | null => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return null;
            const vw = view.innerWidth;
            const vh = view.innerHeight;
            // Fully outside the viewport even after scrolling: cannot probe.
            if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return null;
            const cx = (r.left + r.right) / 2;
            const cy = (r.top + r.bottom) / 2;
            const inset = Math.min(INSET, r.width / 2, r.height / 2);
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
              if (isFullScreen(cover)) {
                // Covers the whole page, not just this control: one note for the page, not one per element.
                overlays.add(cover);
                continue;
              }
              coveredPoints.push(name);
              if (name === "centre") centreCover = cover;
            }
            return { centreCover, coveredPoints, probed };
          };
          let hitTest = probe();
          if (hitTest?.centreCover) {
            // Pages often scroll a focused element into view themselves (a scrolling strip, smooth
            // scrolling): check again once that has settled before reporting.
            await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
            hitTest = probe();
          }
          if (!hitTest) continue;
          const { centreCover, coveredPoints, probed } = hitTest;

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
              ? `When this ${tag} receives focus (and the browser scrolls it into view) it is entirely hidden by the ${coverPos} element ${describe(centreCover)} (all ${probed} probe points covered).`
              : `When this ${tag} receives focus (and the browser scrolls it into view), its centre is covered by the ${coverPos} element ${describe(centreCover)} (${coveredPoints.length} of ${probed} probe points covered). Partial obscuring conforms to 2.4.11 (AA) but fails 2.4.12 Focus Not Obscured (Enhanced) (AAA); verify the focused control remains visible.`;
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
        }
      }
    } finally {
      restoreAncestorScroll([...saved.values()]);
      try {
        const current = doc.activeElement;
        if (current instanceof HTMLElement && current !== originalActive) current.blur();
        if (originalActive instanceof HTMLElement && originalActive !== doc.body && originalActive.isConnected) originalActive.focus({ preventScroll: true });
      } catch {
        // ignore
      }
      try {
        if (view.scrollX !== scrollX || view.scrollY !== scrollY) view.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
      } catch {
        // ignore
      }
    }
    // While a page-wide overlay is open (a consent dialog with its scrim and banner), what covers
    // each control is the dialog, not the page's own layout: report the overlay only.
    if (overlays.size > 0) findings.length = 0;
    for (const overlay of overlays) {
      findings.push({
        element: overlay,
        type: "Semi",
        severity: PRIMARY.severity ?? "Serious",
        description: `A full-screen ${view.getComputedStyle(overlay).position} overlay ${describe(overlay)} (for example a cookie consent dialog or modal backdrop) covered the page during the scan, so focus visibility behind it could not be judged element by element. If keyboard users can reach the page behind the overlay, the controls they focus are hidden; if focus is kept inside the overlay, that is correct. Dismiss the overlay and rescan to check the page itself.`,
        data: { ruleId: PRIMARY.id, overlay: true, obscuredBy: describe(overlay) },
        fix: { summary: "Keep focus inside a modal overlay while it is open (and make the page behind it inert), or let keyboard users dismiss it before they reach the page." },
      });
    }
    if (stoppedAt >= 0) {
      findings.push({
        element: doc.body ?? doc.documentElement,
        type: "Semi",
        severity: PRIMARY.severity ?? "Serious",
        description: `The check for focus hidden by sticky content stopped after ${Math.round(TIME_BUDGET_MS / 1000)} seconds, having checked ${stoppedAt} of ${focusables.length} focusable elements. Tab through the rest of the page and confirm focused controls are not hidden behind sticky headers, footers or banners.`,
        data: { ruleId: PRIMARY.id, checked: stoppedAt, focusableCount: focusables.length, timeBudgetMs: TIME_BUDGET_MS, skipped: true },
      });
    }
    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
