/**
 * Focus indicator rules.
 *
 * Emits:
 *  - KBD-05  no visible focus indicator (Auto, Serious; Semi when
 *            `:focus-visible` may not have applied to the programmatic focus)
 *  - CLR-05  focus indicator below 3:1 against the adjacent background
 *            (Auto, Serious, WCAG 1.4.11)
 *
 * Method: for every focusable element we snapshot the style properties that
 * commonly carry a focus ring (outline, box-shadow, border, background, text
 * colour and decoration), call `el.focus({ preventScroll: true })`, snapshot
 * again and compare. The original `document.activeElement` and the window
 * scroll position are restored afterwards.
 *
 * Heuristics and their risks
 * --------------------------
 *  - Chromium only applies `:focus-visible` to programmatic focus when the
 *    last user interaction was keyboard-driven (or the element is a text
 *    field). When `el.matches(":focus-visible")` is false after focusing, a
 *    site that styles `:focus-visible` correctly would look unchanged, so the
 *    finding is reported as Semi (needs review) rather than a definite failure.
 *  - Focus indicators drawn on a *different* element (a parent `:focus-within`
 *    ring, a pseudo-element, an SVG underline) are invisible to this check and
 *    produce false positives.
 *  - Moving focus can trigger page behaviour (opening menus, validation).
 *    Focus is moved with `preventScroll` and restored, but side effects that
 *    the page itself performs on focus cannot be undone.
 *  - Contrast of the indicator is measured against the background *around*
 *    the element (outlines sit outside the box). An inset ring against the
 *    element's own fill is approximated by the same value.
 *  - Pages with more than 400 focusables are skipped (one Semi note) to keep
 *    the scan responsive.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { blend, contrastRatio, parseColor, suggestPassingColor, toHex, type RGB, type RGBA } from "@shared/color";
import { getFocusableElements } from "@src/content/dom-utils";
import { isExtensionElement, resolveBackground, type BackgroundCache } from "./contrast";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const PRIMARY = ruleDef("KBD-05");
const CONTRAST = ruleDef("CLR-05");

const MAX_FOCUSABLES = 400;
const CHUNK = 25;

interface StyleSnapshot {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  outlineOffset: string;
  boxShadow: string;
  borderColor: string;
  borderWidth: string;
  borderStyle: string;
  backgroundColor: string;
  backgroundImage: string;
  color: string;
  textDecorationLine: string;
  textDecorationColor: string;
  filter: string;
  transform: string;
}

function snapshot(cs: CSSStyleDeclaration): StyleSnapshot {
  return {
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
    boxShadow: cs.boxShadow,
    borderColor: `${cs.borderTopColor} ${cs.borderRightColor} ${cs.borderBottomColor} ${cs.borderLeftColor}`,
    borderWidth: `${cs.borderTopWidth} ${cs.borderRightWidth} ${cs.borderBottomWidth} ${cs.borderLeftWidth}`,
    borderStyle: `${cs.borderTopStyle} ${cs.borderRightStyle} ${cs.borderBottomStyle} ${cs.borderLeftStyle}`,
    backgroundColor: cs.backgroundColor,
    backgroundImage: cs.backgroundImage,
    color: cs.color,
    textDecorationLine: cs.textDecorationLine,
    textDecorationColor: cs.textDecorationColor,
    filter: cs.filter,
    transform: cs.transform,
  };
}

function changedKeys(a: StyleSnapshot, b: StyleSnapshot): Array<keyof StyleSnapshot> {
  const keys = Object.keys(a) as Array<keyof StyleSnapshot>;
  return keys.filter((k) => a[k] !== b[k]);
}

/**
 * Extract the first colour token from a box-shadow list (Chromium serialises colour first).
 * The alpha channel is preserved: a translucent ring such as Bootstrap's
 * `rgba(13, 110, 253, 0.25)` must be blended with the page background before its
 * contrast is measured, otherwise a ring that renders as a pale tint is judged as
 * if it were the opaque brand colour.
 */
function shadowColor(boxShadow: string): RGBA | null {
  if (!boxShadow || boxShadow === "none") return null;
  const m = /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b|\b[a-z]+\b)/i.exec(boxShadow);
  if (!m) return null;
  return parseColor(m[1] ?? "");
}

function outlineVisible(s: StyleSnapshot): boolean {
  const w = parseFloat(s.outlineWidth);
  return s.outlineStyle !== "none" && Number.isFinite(w) && w > 0;
}

function firstBorderColor(s: StyleSnapshot): string {
  return s.borderColor.split(" ")[0] ?? "";
}

export const rule: CustomRule = {
  id: PRIMARY.id,
  emits: [CONTRAST.id],
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Serious",
  defaultFix: {
    summary: "Add a visible focus style (for example `:focus-visible { outline: 2px solid #005fcc; outline-offset: 2px }`) and never set `outline: none` without a replacement.",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
    const view = doc.defaultView ?? window;

    let focusables: HTMLElement[] = [];
    try {
      focusables = getFocusableElements(ctx.root).filter((el) => {
        try {
          return !isExtensionElement(el, ctx) && ctx.isVisible(el) && !el.matches(":disabled");
        } catch {
          return false;
        }
      });
    } catch {
      return findings;
    }

    if (focusables.length > MAX_FOCUSABLES) {
      findings.push({
        element: doc.body ?? doc.documentElement,
        type: "Semi",
        description: `The page has ${focusables.length} focusable elements; the automatic focus-indicator check is capped at ${MAX_FOCUSABLES} to keep the scan responsive. Tab through the page manually and confirm every control shows a visible focus indicator.`,
        data: { ruleId: PRIMARY.id, focusableCount: focusables.length, cap: MAX_FOCUSABLES, skipped: true },
        fix: { summary: "Run the Keyboard Test or tab through the page manually to verify focus visibility." },
      });
      return findings;
    }

    const originalActive = doc.activeElement;
    const scrollX = view.scrollX;
    const scrollY = view.scrollY;
    const cache: BackgroundCache = new Map();

    try {
      for (let i = 0; i < focusables.length; i++) {
        if (i > 0 && i % CHUNK === 0) {
          await ctx.yieldToMain();
          ctx.progress?.(Math.round((i / focusables.length) * 100));
        }
        const el = focusables[i];
        if (!el) continue;
        try {
          const before = snapshot(view.getComputedStyle(el));
          el.focus({ preventScroll: true });
          if (doc.activeElement !== el) continue; // not actually focusable, or focus was redirected
          const after = snapshot(view.getComputedStyle(el));
          const focusVisible = (() => {
            try {
              return el.matches(":focus-visible");
            } catch {
              return true;
            }
          })();
          const diff = changedKeys(before, after);

          if (diff.length === 0) {
            findings.push({
              element: el,
              type: focusVisible ? PRIMARY.type : "Semi",
              severity: PRIMARY.severity ?? "Serious",
              description: focusVisible
                ? `No visual change (outline, box-shadow, border, background, colour or text decoration) was detected when this ${el.tagName.toLowerCase()} received focus.`
                : `No visual change was detected when this ${el.tagName.toLowerCase()} received focus, but the browser did not apply :focus-visible to the programmatic focus, so a :focus-visible style may exist. Confirm with the keyboard.`,
              data: { ruleId: PRIMARY.id, focusVisibleApplied: focusVisible, outline: after.outlineStyle, boxShadow: after.boxShadow },
            });
            continue;
          }

          // Something changed: identify the indicator colour and check 3:1 against the adjacent background.
          let indicator: RGB | null = null;
          let indicatorKind = "";
          let transparentOnly = false;
          const surrounding = resolveBackground(el.parentElement ?? el, cache);
          // Blend an indicator colour (keeping its own alpha) onto the adjacent background.
          // Alpha <= 0.01 is treated as fully transparent, i.e. not a visible indicator.
          const composeRgba = (c: RGBA | null): RGB | null => {
            if (!c || c[3] <= 0.01) return null;
            return blend([c[0], c[1], c[2], c[3] * surrounding.cumulativeOpacity], surrounding.color);
          };
          const compose = (css: string): RGB | null => composeRgba(parseColor(css));

          if (outlineVisible(after) && (diff.includes("outlineStyle") || diff.includes("outlineWidth") || diff.includes("outlineColor") || diff.includes("outlineOffset"))) {
            indicatorKind = "outline";
            indicator = compose(after.outlineColor);
            if (!indicator) transparentOnly = true;
          } else if (diff.includes("boxShadow") && after.boxShadow !== "none") {
            indicatorKind = "box-shadow";
            indicator = composeRgba(shadowColor(after.boxShadow));
            if (!indicator) transparentOnly = true;
          } else if (diff.includes("borderColor") || diff.includes("borderWidth") || diff.includes("borderStyle")) {
            indicatorKind = "border";
            indicator = compose(firstBorderColor(after));
            if (!indicator) transparentOnly = true;
          } else if (diff.includes("backgroundColor")) {
            indicatorKind = "background";
            const b = compose(after.backgroundColor);
            const a = compose(before.backgroundColor) ?? surrounding.color;
            if (b) {
              // A background change must contrast with the *previous* state to be perceivable.
              const changeRatio = contrastRatio(b, a);
              if (changeRatio < 3) {
                findings.push(contrastFinding(el, indicatorKind, b, a, changeRatio));
              }
            }
            continue;
          } else {
            // Colour / text-decoration / filter / transform changes: perceivable but not measurable as a 3:1 boundary.
            continue;
          }

          if (transparentOnly) {
            findings.push({
              element: el,
              type: focusVisible ? PRIMARY.type : "Semi",
              severity: PRIMARY.severity ?? "Serious",
              description: `The only change on focus is a fully transparent ${indicatorKind}, which is not visible.`,
              data: { ruleId: PRIMARY.id, focusVisibleApplied: focusVisible, indicator: indicatorKind },
            });
            continue;
          }
          if (indicator && surrounding.hasImage) continue; // cannot judge contrast against an image
          if (indicator) {
            const ratio = contrastRatio(indicator, surrounding.color);
            if (ratio < 3) findings.push(contrastFinding(el, indicatorKind, indicator, surrounding.color, ratio));
          }
        } catch {
          // continue with the next element
        }
      }
    } finally {
      // Restore focus and scroll exactly as they were.
      try {
        const current = doc.activeElement;
        if (current instanceof HTMLElement && current !== originalActive) current.blur();
        if (originalActive instanceof HTMLElement && originalActive !== doc.body && originalActive.isConnected) {
          originalActive.focus({ preventScroll: true });
        }
      } catch {
        // ignore
      }
      try {
        if (view.scrollX !== scrollX || view.scrollY !== scrollY) view.scrollTo(scrollX, scrollY);
      } catch {
        // ignore
      }
    }
    ctx.progress?.(100);
    return findings;
  },
};

function contrastFinding(el: Element, kind: string, indicator: RGB, adjacent: RGB, ratio: number): RuleFinding {
  const suggested = suggestPassingColor(indicator, adjacent, 3);
  return {
    element: el,
    type: CONTRAST.type,
    severity: CONTRAST.severity ?? "Serious",
    description: `The focus indicator (${kind} ${toHex(indicator)}) has a contrast of ${ratio}:1 against the adjacent colour ${toHex(adjacent)}; 3:1 is required.`,
    data: { ruleId: CONTRAST.id, indicator: kind, foreground: toHex(indicator), background: toHex(adjacent), ratio, required: 3 },
    fix: {
      summary: `Use a focus ${kind} colour of at least ${toHex(suggested)} (${contrastRatio(suggested, adjacent)}:1 against ${toHex(adjacent)}).`,
      suggestedValue: `${kind === "outline" ? "outline-color" : kind === "border" ? "border-color" : kind === "background" ? "background-color" : "box-shadow colour"}: ${toHex(suggested)}`,
      docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html",
    },
  };
}

export default rule;
