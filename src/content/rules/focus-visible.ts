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
 *  - Focus indicators are often drawn on a *different* element. When nothing
 *    changes on the element itself, its ::before/::after, up to three
 *    ancestors (a `:focus-within` ring), its first 20 descendants and the
 *    first 20 elements of its shadow root are compared unfocused vs
 *    focused (with page transitions paused); a visible change there counts
 *    as the indicator. Its contrast is not measured. Indicators drawn by
 *    script on canvas or by other far-away elements are still missed.
 *  - Moving focus can trigger page behaviour (opening menus, validation).
 *    Focus is moved with `preventScroll` and restored, but side effects that
 *    the page itself performs on focus cannot be undone.
 *  - Chrome's default focus ring (`outline: auto` in the default colour) is a
 *    dark ring with a white ring around it, visible on any background; its
 *    computed colour only describes the dark part, so it is not measured.
 *  - An indicator is often made of several parts (a white ring inside a blue
 *    one, a yellow highlight with a black underline shadow, an outline plus a
 *    border). Every part is measured and the best one counts: the indicator
 *    is visible when any one part stands out.
 *  - Outer parts (outlines, box-shadows, borders) are measured against the
 *    background *around* the element. Parts drawn inside it (inset
 *    box-shadows, an outline with a negative offset at least its width) are
 *    measured against the element's own focused fill.
 *  - `outline: auto` in any colour is drawn by Chrome with a white outer ring;
 *    that ring is one more part. A strong background change next to a ring
 *    counts as a part too. An element that comes into view only when focused
 *    (a skip link) has appearing as its indicator.
 *  - Before each element is measured, the previous element loses focus, so a
 *    `:focus-within` style on a shared ancestor is not taken as part of the
 *    unfocused state.
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
import { EXT_MARKER_ATTR } from "@shared/constants";
import { getFocusableElements } from "@src/content/dom-utils";
import { isExtensionElement, paintOver, resolveBackground, type BackgroundCache, type BackgroundResolution } from "./contrast";
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

/** A related element (or one of its pseudo-elements) whose look may change when the element is focused. */
interface RelatedPart {
  element: Element;
  pseudo: "::before" | "::after" | null;
}

/** Visual properties of a related part; opacity, visibility and size catch rings that fade or grow in. */
function relatedSnapshot(part: RelatedPart, view: Window): string {
  const cs = view.getComputedStyle(part.element, part.pseudo);
  if (part.pseudo && (cs.content === "none" || cs.content === "normal" || cs.display === "none")) return "";
  const s = snapshot(cs);
  const outline = outlineVisible(s) ? `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}` : "";
  const visible = parseFloat(cs.opacity) > 0.01 && cs.visibility !== "hidden" ? "shown" : "hidden";
  const size = part.pseudo ? `${cs.width} ${cs.height}` : "";
  return [outline, s.boxShadow, s.borderColor, s.borderWidth, s.borderStyle, s.backgroundColor, s.backgroundImage, cs.backgroundSize, cs.backgroundPosition, s.color, s.textDecorationLine, s.textDecorationColor, s.filter, s.transform, visible, size].join("|");
}

const RELATED_ANCESTORS = 3;
const RELATED_DESCENDANTS = 20;
const RELATED_SIBLING_PARTS = 30;

/** Parts that commonly draw a focus indicator for `el`: its pseudo-elements, ancestors, descendants and shadow content. */
function relatedParts(el: Element): RelatedPart[] {
  const parts: RelatedPart[] = [
    { element: el, pseudo: "::before" },
    { element: el, pseudo: "::after" },
  ];
  let node: Element | null = el;
  for (let i = 0; i < RELATED_ANCESTORS; i++) {
    const root: Node = node.getRootNode();
    node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    if (!node || node === el.ownerDocument.body || node === el.ownerDocument.documentElement) break;
    parts.push({ element: node, pseudo: null }, { element: node, pseudo: "::before" }, { element: node, pseudo: "::after" });
  }
  for (const child of Array.from(el.querySelectorAll("*")).slice(0, RELATED_DESCENDANTS)) parts.push({ element: child, pseudo: null });
  // A ring on a sibling (a card's "Read the story" button lights up when the card link has focus).
  const parent = el.parentElement;
  if (parent && parent !== el.ownerDocument.body) {
    const siblings = Array.from(parent.querySelectorAll("*")).filter((n) => n !== el && !el.contains(n)).slice(0, RELATED_SIBLING_PARTS);
    for (const s of siblings) parts.push({ element: s, pseudo: null }, { element: s, pseudo: "::before" }, { element: s, pseudo: "::after" });
  }
  // A web component draws its ring inside its shadow root (`:host(:focus) .ring`, or a focused inner control).
  const shadow = el.shadowRoot;
  if (shadow) {
    for (const child of Array.from(shadow.querySelectorAll("*")).slice(0, RELATED_DESCENDANTS)) {
      if (child.localName !== "style") parts.push({ element: child, pseudo: null }, { element: child, pseudo: "::before" }, { element: child, pseudo: "::after" });
    }
  }
  return parts;
}

/**
 * True when focusing `el` (currently focused) visibly changes one of its
 * related parts. The element is briefly blurred to read the unfocused state,
 * then focused again.
 */
function indicatorElsewhere(el: HTMLElement, view: Window): boolean {
  const parts = relatedParts(el);
  const focused = parts.map((p) => relatedSnapshot(p, view));
  el.blur();
  // Shadow content only has its focused element while focused: compare the same parts.
  const unfocused = parts.map((p) => relatedSnapshot(p, view));
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  return focused.some((f, i) => f !== unfocused[i] && (f !== "" || unfocused[i] !== ""));
}

/**
 * True when the element is out of sight unfocused and comes into view on focus:
 * a skip link parked off-screen (`top: -40px`, `left: -9999px`) or clipped
 * (`clip: rect(0 0 0 0)`) that appears when tabbed to. Appearing is the indicator.
 */
function hiddenUntilFocused(el: Element, view: Window, before: { rect: DOMRect; clipped: boolean; opacity: number }): boolean {
  const out = (r: DOMRect, clipped: boolean, opacity: number): boolean =>
    clipped || opacity <= 0.01 || r.width <= 1 || r.height <= 1 || r.right + view.scrollX <= 0 || r.bottom + view.scrollY <= 0 || r.bottom <= 0;
  if (!out(before.rect, before.clipped, before.opacity)) return false;
  const cs = view.getComputedStyle(el);
  return !out(el.getBoundingClientRect(), isClipped(cs), parseFloat(cs.opacity));
}

function isClipped(cs: CSSStyleDeclaration): boolean {
  return /^rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)$/.test(cs.clip) || /^inset\(\s*(50|100)%/.test(cs.clipPath);
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

/** Offsets, blur and spread of one shadow entry, in px (missing ones are 0). */
function shadowLengths(entry: string): number[] {
  const lengths = entry.replace(/(rgba?|hsla?|color)\([^)]*\)/gi, "").match(/-?[\d.]+(?:px)?(?=\s|$)/g) ?? [];
  return lengths.map((l) => parseFloat(l) || 0);
}

export interface ShadowPart {
  /** Colour with its own alpha: a translucent ring is blended with what is behind it before measuring. */
  color: RGBA;
  /** Drawn inside the element, on its own fill, rather than on the page around it. */
  inset: boolean;
}

/**
 * The box-shadow entries that make up a focus indicator. A page often carries a
 * decorative shadow (e.g. `rgba(0,0,0,.075) 0 1px 1px inset`) before focus, so
 * the entries new on focus are returned when there are any, otherwise all of
 * them. Entries that draw nothing (no offset, blur or spread) and transparent
 * ones are left out. Indicators are often made of several entries (a white
 * ring inside a blue one, a yellow highlight with a black underline); each is
 * judged on its own and the best one counts.
 */
export function focusShadows(boxShadow: string, before = "none"): ShadowPart[] {
  if (!boxShadow || boxShadow === "none") return [];
  const entries = splitShadows(boxShadow);
  const previous = new Set(splitShadows(before === "none" ? "" : before));
  const added = entries.filter((e) => !previous.has(e));
  const parts: ShadowPart[] = [];
  for (const entry of added.length ? added : entries) {
    if (!shadowLengths(entry).some((n) => n !== 0)) continue;
    const m = /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?!inset\b)[a-z]+\b)/i.exec(entry);
    const color = m ? parseColor(m[1] ?? "") : null;
    if (!color || color[3] <= 0.01) continue;
    parts.push({ color, inset: /\binset\b/i.test(entry) });
  }
  return parts;
}

function outlineVisible(s: StyleSnapshot): boolean {
  const w = parseFloat(s.outlineWidth);
  return s.outlineStyle !== "none" && Number.isFinite(w) && w > 0;
}

/**
 * Chrome's default focus ring: `outline-style: auto` in the default
 * `-webkit-focus-ring-color` (computed as rgb(16, 16, 16)). Since Chrome 83 it
 * is drawn as a dark inner ring with a white outer ring, so one of the two
 * reaches 3:1 on any background; the computed colour describes only the dark
 * ring. An author colour with `auto` is measured as usual.
 */
export function isDefaultFocusRing(s: Pick<StyleSnapshot, "outlineStyle" | "outlineColor">): boolean {
  if (s.outlineStyle !== "auto") return false;
  const c = parseColor(s.outlineColor);
  return !!c && c[0] === 16 && c[1] === 16 && c[2] === 16 && c[3] >= 0.99;
}

/**
 * Colour of the first drawn border side (width > 0, style not none/hidden).
 * The snapshot joins the four sides with spaces, and colours such as
 * `rgb(255, 255, 255)` contain spaces themselves, so the colours are matched
 * whole rather than split on spaces.
 */
export function firstBorderColor(s: Pick<StyleSnapshot, "borderColor" | "borderWidth" | "borderStyle">): string {
  const colors = s.borderColor.match(/(?:rgba?|hsla?|color)\([^)]*\)|#[0-9a-f]{3,8}\b|[a-z]+/gi) ?? [];
  const widths = s.borderWidth.split(/\s+/);
  const styles = s.borderStyle.split(/\s+/);
  for (let i = 0; i < 4; i++) {
    if ((parseFloat(widths[i] ?? "0") || 0) <= 0 || styles[i] === "none" || styles[i] === "hidden") continue;
    return colors[i] ?? colors[0] ?? "";
  }
  return "";
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
    // Switch off transitions on the page while measuring, so a ring that fades or grows in on a
    // pseudo-element or ancestor shows its end state at once (removed in `finally`).
    const pause = doc.createElement("style");
    pause.setAttribute(EXT_MARKER_ATTR, "focus-transition-pause");
    pause.textContent = "*, *::before, *::after { transition: none !important; }";

    try {
      (doc.head ?? doc.documentElement).appendChild(pause);
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
          let placement: { rect: DOMRect; clipped: boolean; opacity: number };
          try {
            styleDecl.setProperty("transition", "none", "important");
            // The unfocused state must not carry the previous element's focus: a `:focus-within`
            // style on a shared ancestor (a search form) would already show in "before".
            const previous = doc.activeElement;
            if (previous instanceof HTMLElement && previous !== doc.body && previous !== el) previous.blur();
            const beforeStyle = view.getComputedStyle(el);
            before = snapshot(beforeStyle);
            placement = { rect: el.getBoundingClientRect(), clipped: isClipped(beforeStyle), opacity: parseFloat(beforeStyle.opacity) };
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

          if (hiddenUntilFocused(el, view, placement)) continue; // appears only when focused: that is the indicator
          if (diff.length === 0 && indicatorElsewhere(el, view)) continue; // drawn on a pseudo-element, ancestor, child or sibling
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

          // Every part of a ring-like change: the outline, each box-shadow entry, the border.
          // A transparent part (e.g. the common `outline: 2px solid transparent` kept for
          // forced-colours mode) draws nothing and is not the indicator. An inset shadow is
          // drawn on the element's own fill, so it is measured against that fill.
          const rings: Array<{ kind: string; indicator: RGB | null; adjacent: RGB }> = [];
          const outlineChanged = diff.includes("outlineStyle") || diff.includes("outlineWidth") || diff.includes("outlineColor") || diff.includes("outlineOffset");
          let ownFill: BackgroundResolution | null = null;
          const fill = (): BackgroundResolution => (ownFill ??= resolveBackground(el, new Map())); // the focused fill: not from the shared cache
          if (outlineVisible(after) && outlineChanged) {
            // A negative outline-offset of at least the outline's width draws it inside the element, on its own fill.
            const inside = parseFloat(after.outlineOffset) + parseFloat(after.outlineWidth) <= 0;
            const outlineColor = parseColor(after.outlineColor);
            if (inside) rings.push({ kind: "inset outline", indicator: outlineColor && outlineColor[3] > 0.01 ? paintOver(fill(), outlineColor) : null, adjacent: fill().color });
            else rings.push({ kind: "outline", indicator: compose(after.outlineColor), adjacent: surrounding.color });
            // `outline: auto` in any colour: Chrome draws a white ring around the author colour.
            if (!inside && after.outlineStyle === "auto") rings.push({ kind: "outline (browser's white outer ring)", indicator: [255, 255, 255], adjacent: surrounding.color });
          }
          if (diff.includes("boxShadow")) {
            const parts = focusShadows(after.boxShadow, before.boxShadow);
            // Only transparent or empty shadows changed: recorded so the change is reported as invisible.
            if (parts.length === 0 && after.boxShadow !== "none") rings.push({ kind: "box-shadow", indicator: null, adjacent: surrounding.color });
            for (const part of parts) {
              if (part.inset) {
                rings.push({ kind: "inset box-shadow", indicator: part.color[3] > 0.01 ? paintOver(fill(), part.color) : null, adjacent: fill().color });
              } else {
                rings.push({ kind: "box-shadow", indicator: composeRgba(part.color), adjacent: surrounding.color });
              }
            }
          }
          if (diff.includes("borderColor") || diff.includes("borderWidth") || diff.includes("borderStyle")) {
            rings.push({ kind: "border", indicator: compose(firstBorderColor(after)), adjacent: surrounding.color });
          }

          const visibleRings = rings.filter((r): r is { kind: string; indicator: RGB; adjacent: RGB } => r.indicator !== null);
          if (visibleRings.length > 0 && diff.includes("backgroundColor")) {
            // A strong background change (a field turning white, a button turning yellow) is a part
            // of the indicator too: it passes when it stands out from the surroundings or the old fill.
            const b = compose(after.backgroundColor);
            const a = compose(before.backgroundColor) ?? surrounding.color;
            if (b && Math.max(contrastRatioExact(b, surrounding.color), contrastRatioExact(b, a)) >= 3) continue;
          }
          if (visibleRings.length > 0) {
            if (outlineVisible(after) && isDefaultFocusRing(after)) continue; // the browser's two-colour ring
            if (surrounding.hasImage) continue; // cannot judge contrast against an image
            // The indicator is visible when any one of its parts stands out: judge the best part.
            let best = visibleRings[0] as (typeof visibleRings)[number];
            let bestRatio = contrastRatioExact(best.indicator, best.adjacent);
            for (const r of visibleRings.slice(1)) {
              const ratio = contrastRatioExact(r.indicator, r.adjacent);
              if (ratio > bestRatio) {
                best = r;
                bestRatio = ratio;
              }
            }
            if (bestRatio < 3) findings.push(contrastFinding(el, best.kind, best.indicator, best.adjacent, contrastRatio(best.indicator, best.adjacent)));
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
      pause.remove();
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
