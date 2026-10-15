/**
 * Focus indicator rules.
 *
 * Emits:
 *  - KBD-05  no visible focus indicator (Auto, Serious; Semi when
 *            `:focus-visible` may not have applied to the programmatic focus)
 *  - CLR-05  focus indicator (outline, box-shadow or border) below 3:1 against
 *            the adjacent background (Auto, Serious, WCAG 1.4.11)
 *  - CLR-09  focus shown only by a background change below 3:1 against the
 *            unfocused state (Auto, Moderate, WCAG 2.4.13 AAA). Contrast
 *            between a component's own states is required only at AAA, so in
 *            A/AA scans the same finding is CLR-05 Needs review (Semi).
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
 *    field), so focus is moved with `focusVisible: true` to force it. Where
 *    that option is unsupported and `el.matches(":focus-visible")` is false, a
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
 *  - A page without focus gets no focus styles at all. The service worker
 *    emulates a focused page during scans (background/focus-emulation.ts);
 *    when that fails the check is skipped with one Semi note rather than
 *    reporting every element.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { contrastRatio, contrastRatioExact, hslToRgb, parseColor, rgbToHsl, suggestPassingColor, toHex, type RGB, type RGBA } from "@shared/color";
import { getFocusableElements } from "@src/content/dom-utils";
import { isExtensionElement, paintOver, resolveBackground, type BackgroundCache } from "./contrast";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const PRIMARY = ruleDef("KBD-05");
const CONTRAST = ruleDef("CLR-05");
const STATE_CHANGE = ruleDef("CLR-09");

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

/** Split a box-shadow list on top-level commas (commas inside rgba(...) do not separate shadows). */
function splitShadows(boxShadow: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < boxShadow.length; i++) {
    const ch = boxShadow[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(boxShadow.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(boxShadow.slice(start).trim());
  return parts.filter(Boolean);
}

/** Spread radius (4th length) of one shadow entry; 0 when absent. */
function shadowSpread(entry: string): number {
  const lengths = entry.replace(/(rgba?|hsla?|color)\([^)]*\)/gi, "").match(/-?[\d.]+(?:px)?(?=\s|$)/g) ?? [];
  return lengths.length >= 4 ? parseFloat(lengths[3] ?? "0") || 0 : 0;
}

/**
 * Extract the indicator colour from a box-shadow list. A page often carries a
 * decorative shadow (e.g. `rgba(0,0,0,.075) 0 1px 1px inset`) before the focus
 * ring, so the entry that is new on focus (absent from `before`) is preferred,
 * then a non-inset entry with positive spread (a ring), then the first entry.
 * The alpha channel is preserved: a translucent ring such as Bootstrap's
 * `rgba(13, 110, 253, 0.25)` must be blended with the page background before its
 * contrast is measured, otherwise a ring that renders as a pale tint is judged as
 * if it were the opaque brand colour.
 */
export function shadowColor(boxShadow: string, before = "none"): RGBA | null {
  if (!boxShadow || boxShadow === "none") return null;
  const entries = splitShadows(boxShadow);
  const previous = new Set(splitShadows(before === "none" ? "" : before));
  const isRing = (e: string): boolean => !/\binset\b/i.test(e) && shadowSpread(e) > 0;
  const added = entries.filter((e) => !previous.has(e));
  const chosen = added.find(isRing) ?? added[0] ?? entries.find(isRing) ?? entries[0];
  if (!chosen) return null;
  const m = /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?!inset\b)[a-z]+\b)/i.exec(chosen);
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
  emits: [CONTRAST.id, STATE_CHANGE.id],
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

    // Without focus Chrome draws no focus styles, so every element would look unchanged.
    // The service worker emulates a focused page during scans; if that was not possible
    // (no debugger permission, the debugging bar was cancelled), say so once instead.
    if (focusables.length > 0 && !doc.hasFocus()) {
      findings.push({
        element: doc.body ?? doc.documentElement,
        type: "Semi",
        description: "Focus indicators could not be checked: the page did not have keyboard focus during the scan (for example because the side panel had it), and browsers draw no focus styles on a page without focus. Tab through the page manually and confirm every control shows a visible focus indicator.",
        data: { ruleId: PRIMARY.id, pageFocused: false, skipped: true },
        fix: { summary: "Run the Keyboard Test or tab through the page manually to verify focus visibility." },
      });
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
          // A CSS transition would leave computed style at its old value right after focus(),
          // reading as "no visual change". Suspend transitions on the element while measuring.
          const styleDecl = (el as HTMLElement).style;
          const prevTransition = styleDecl.getPropertyValue("transition");
          const prevPriority = styleDecl.getPropertyPriority("transition");
          let before: StyleSnapshot;
          let after: StyleSnapshot;
          try {
            styleDecl.setProperty("transition", "none", "important");
            before = snapshot(view.getComputedStyle(el));
            // focusVisible makes Chrome apply :focus-visible styles even though the last
            // interaction was a mouse click (pressing Scan); without it, sites that style
            // only :focus-visible look unchanged. Browsers without the option ignore it.
            el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
            if (doc.activeElement !== el) continue; // not actually focusable, or focus was redirected
            after = snapshot(view.getComputedStyle(el));
          } finally {
            if (prevTransition) styleDecl.setProperty("transition", prevTransition, prevPriority);
            else styleDecl.removeProperty("transition");
          }
          const focusVisible = (() => {
            try {
              return el.matches(":focus-visible");
            } catch {
              return true;
            }
          })();
          // Outline properties change on focus even when no outline is drawn (Chrome's own
          // stylesheet sets outline-offset on focused links), so they count only while an
          // outline is visible; otherwise `a { outline: none }` would never be reported.
          const showsOutline = outlineVisible(before) || outlineVisible(after);
          const diff = changedKeys(before, after).filter((k) => showsOutline || !k.startsWith("outline"));

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
          const surrounding = resolveBackground(el.parentElement ?? el, cache);
          // Blend an indicator colour (keeping its own alpha) onto the adjacent background.
          // Alpha <= 0.01 is treated as fully transparent, i.e. not a visible indicator.
          const composeRgba = (c: RGBA | null): RGB | null => {
            if (!c || c[3] <= 0.01) return null;
            return paintOver(surrounding, c);
          };
          const compose = (css: string): RGB | null => composeRgba(parseColor(css));

          // Ring-like changes in order of preference. A transparent one (e.g. the common
          // `outline: 2px solid transparent` kept for forced-colours mode) is not the
          // indicator: keep looking at the other changes instead of reporting it.
          const rings: Array<{ kind: string; indicator: RGB | null }> = [];
          if (outlineVisible(after) && (diff.includes("outlineStyle") || diff.includes("outlineWidth") || diff.includes("outlineColor") || diff.includes("outlineOffset"))) {
            rings.push({ kind: "outline", indicator: compose(after.outlineColor) });
          }
          if (diff.includes("boxShadow") && after.boxShadow !== "none") {
            rings.push({ kind: "box-shadow", indicator: composeRgba(shadowColor(after.boxShadow, before.boxShadow)) });
          }
          if (diff.includes("borderColor") || diff.includes("borderWidth") || diff.includes("borderStyle")) {
            rings.push({ kind: "border", indicator: compose(firstBorderColor(after)) });
          }

          const ring = rings.find((r) => r.indicator);
          if (ring?.indicator) {
            if (surrounding.hasImage) continue; // cannot judge contrast against an image
            const ratio = contrastRatio(ring.indicator, surrounding.color);
            if (contrastRatioExact(ring.indicator, surrounding.color) < 3) findings.push(contrastFinding(el, ring.kind, ring.indicator, surrounding.color, ratio));
            continue;
          }

          if (diff.includes("backgroundColor")) {
            const b = compose(after.backgroundColor);
            const a = compose(before.backgroundColor) ?? surrounding.color;
            if (b) {
              // A background change must contrast with the *previous* state to be perceivable.
              const changeRatio = contrastRatio(b, a);
              if (contrastRatioExact(b, a) < 3) {
                // The highlight sits behind the text, so a suggested colour must keep the text readable too.
                findings.push(stateChangeFinding(contrastFinding(el, "background", b, a, changeRatio, compose(after.color) ?? undefined), a, b, changeRatio, ctx.wcagLevel ?? "AA"));
              }
              continue;
            }
          }

          // Colour / text-decoration / filter / transform / background-image changes: perceivable
          // but not measurable as a 3:1 boundary.
          const ringKeys = new Set<keyof StyleSnapshot>(["outlineStyle", "outlineWidth", "outlineColor", "outlineOffset", "boxShadow", "borderColor", "borderWidth", "borderStyle", "backgroundColor"]);
          if (rings.length === 0 || diff.some((k) => !ringKeys.has(k))) continue;

          const kinds = rings.map((r) => r.kind).join(" and ");
          findings.push({
            element: el,
            type: focusVisible ? PRIMARY.type : "Semi",
            severity: PRIMARY.severity ?? "Serious",
            description: `The only change on focus is a fully transparent ${kinds}, which is not visible.`,
            data: { ruleId: PRIMARY.id, focusVisibleApplied: focusVisible, indicator: kinds },
          });
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

/** Contrast the text on a focused element needs (WCAG 1.4.3 normal text; large text is not measured here). */
const TEXT_CONTRAST = 4.5;

/**
 * Background highlight colour, keeping the indicator's hue, that contrasts 3:1
 * with the unfocused background and keeps the text on it readable (4.5:1).
 * The lightness closest to the current highlight wins; null when no lightness
 * satisfies both, e.g. dark text on a white page (a highlight dark enough to
 * show against white is too dark behind the text).
 */
export function readableHighlight(indicator: RGB, unfocused: RGB, text: RGB): RGB | null {
  const [h, s, l] = rgbToHsl(indicator);
  let best: RGB | null = null;
  let bestDistance = Infinity;
  for (let nl = 0; nl <= 100; nl++) {
    const candidate = hslToRgb(h, s, nl);
    if (contrastRatioExact(candidate, unfocused) < 3 || contrastRatioExact(text, candidate) < TEXT_CONTRAST) continue;
    const distance = Math.abs(nl - l);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A focus highlight that only changes the element's own background is measured
 * against the unfocused state. WCAG requires focused and unfocused states to
 * contrast only at AAA (2.4.13 Focus Appearance): AAA scans report it as a
 * definite CLR-09 failure, A/AA scans list it for manual review under CLR-05.
 * The suggested fix is the same either way.
 */
function stateChangeFinding(base: RuleFinding, unfocused: RGB, focused: RGB, ratio: number, level: "A" | "AA" | "AAA"): RuleFinding {
  const change = `On focus the background changes from ${toHex(unfocused)} to ${toHex(focused)}, a contrast of only ${ratio}:1 between the two states.`;
  const data = { ...base.data, stateChange: true };
  if (level === "AAA") {
    return {
      ...base,
      type: STATE_CHANGE.type,
      severity: STATE_CHANGE.severity ?? "Moderate",
      description: `${change} WCAG 2.4.13 Focus Appearance requires at least 3:1.`,
      data: { ...data, ruleId: STATE_CHANGE.id },
    };
  }
  return {
    ...base,
    type: "Semi",
    description: `${change} WCAG AA does not require a component's focused and unfocused states to contrast with each other (that is 2.4.13 Focus Appearance, AAA), but a change this subtle is hard to see. Check it with the keyboard.`,
    data,
  };
}

function contrastFinding(el: Element, kind: string, indicator: RGB, adjacent: RGB, ratio: number, text?: RGB): RuleFinding {
  const finding = (summary: string, suggestedValue: string): RuleFinding => ({
    element: el,
    type: CONTRAST.type,
    severity: CONTRAST.severity ?? "Serious",
    description: `The focus indicator (${kind} ${toHex(indicator)}) has a contrast of ${ratio}:1 against the adjacent colour ${toHex(adjacent)}; 3:1 is required.`,
    data: { ruleId: CONTRAST.id, indicator: kind, foreground: toHex(indicator), background: toHex(adjacent), ratio, required: 3 },
    fix: { summary, suggestedValue, docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html" },
  });

  if (kind === "background" && text) {
    const highlight = readableHighlight(indicator, adjacent, text);
    if (highlight) {
      return finding(
        `Use a focus background of ${toHex(highlight)}: ${contrastRatio(highlight, adjacent)}:1 against the unfocused ${toHex(adjacent)}, and the text (${toHex(text)}) stays readable at ${contrastRatio(text, highlight)}:1.`,
        `background-color: ${toHex(highlight)}`,
      );
    }
    // No background passes both checks: a background strong enough to see would make the text unreadable.
    const ring = suggestPassingColor(text, adjacent, 3);
    return finding(
      `A background highlight cannot reach 3:1 here without making the ${toHex(text)} text unreadable. Keep the background and add an outline instead: ${toHex(ring)} has ${contrastRatio(ring, adjacent)}:1 against ${toHex(adjacent)}.`,
      `outline: 2px solid ${toHex(ring)}; outline-offset: 2px`,
    );
  }

  const suggested = suggestPassingColor(indicator, adjacent, 3);
  return finding(
    `Use a focus ${kind} colour of at least ${toHex(suggested)} (${contrastRatio(suggested, adjacent)}:1 against ${toHex(adjacent)}).`,
    `${kind === "outline" ? "outline-color" : kind === "border" ? "border-color" : kind === "background" ? "background-color" : "box-shadow colour"}: ${toHex(suggested)}`,
  );
}

export default rule;
