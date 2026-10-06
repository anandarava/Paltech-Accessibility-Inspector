/**
 * Colour contrast rules.
 *
 * Emits:
 *  - CLR-01  normal text below 4.5:1 (Auto, Serious)
 *  - CLR-02  large text below 3:1 (Auto, Serious)
 *  - CLR-03  text over an image / gradient / media (Semi, Moderate): the real
 *            background cannot be determined from computed styles alone.
 *  - CLR-04  form control border (or fill) below 3:1 against its surroundings
 *            (Auto, Serious, WCAG 1.4.11).
 *
 * How the background is resolved
 * ------------------------------
 * Computed styles only tell us each element's own `background-color`; what
 * the eye sees is the composite of every ancestor's background. We walk from
 * the text's element up to <html>, compositing each `rgba()` layer over the
 * result of its parent ("source over"), and finally over the canvas behind
 * <html>. The canvas is white unless the root's used `color-scheme` is dark
 * (`:root { color-scheme: dark }` or `<meta name="color-scheme" content="dark">`,
 * or `light dark` while the user prefers dark), in which case Chromium paints
 * the dark `Canvas` system colour (#121212) although `background-color` still
 * computes to transparent. Element `opacity` is folded in by multiplying the
 * alpha of every layer inside that subtree (including the text colour itself),
 * which is a close approximation of group opacity for a single pixel.
 *
 * Known false-positive / false-negative risks (documented on purpose):
 *  - Positioned siblings that overlap the text (a card floating over a hero,
 *    absolutely positioned decorations) are not ancestors and are ignored, so
 *    the background may be wrong in either direction.
 *  - `background-image`, gradients, `mix-blend-mode`, filters, `backdrop-filter`
 *    and `-webkit-background-clip: text` cannot be evaluated; those cases are
 *    downgraded to CLR-03 "needs review" instead of a pass/fail.
 *  - Text shadows and outlines that improve legibility are ignored (WCAG does
 *    allow them to count); such text may be flagged although it passes.
 *  - Disabled controls and placeholder text are exempt from 1.4.3 and skipped.
 *  - Screen-reader-only text (1x1 clipped) is skipped because it is not seen.
 *  - Text inside `aria-hidden="true"` subtrees IS checked: 1.4.3/1.4.11 are
 *    about what sighted users see, and such text (captions, cloned carousel
 *    slides, icon-font glyphs) is still painted. Only rendering (display,
 *    visibility, opacity, box) decides whether text is measured here, not
 *    assistive-technology exposure.
 *  - When no opaque layer is reached and the canvas colour had to be inferred
 *    from a dark colour scheme, findings are downgraded to Semi
 *    (`data.reachedOpaque === false`, `data.canvas === "dark"`).
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { EXT_MARKER_ATTR } from "@shared/constants";
import { blend, contrastRatio, contrastRatioExact, isLargeText, parseColor, suggestPassingColor, toHex, type RGB, type RGBA } from "@shared/color";
import type { CustomRule, RuleContext, RuleFinding } from "./types";
import { queryAllIncludingRoot } from "@src/content/dom-utils";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const PRIMARY = ruleDef("CLR-01");
const LARGE = ruleDef("CLR-02");
const IMAGE = ruleDef("CLR-03");
const BORDER = ruleDef("CLR-04");

/** Number of text nodes / controls processed between yields. */
const CHUNK = 200;

/** Elements whose text content is never rendered as visible page text. */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "HEAD", "META", "LINK", "OPTION", "OPTGROUP", "DATALIST"]);

// ---------------------------------------------------------------------------
// Background resolution (shared with focus-visible.ts)
// ---------------------------------------------------------------------------

export interface BackgroundResolution {
  /** Effective opaque background colour behind the element's content box. */
  color: RGB;
  /** True when any layer up to the first opaque one paints a background-image/gradient. */
  hasImage: boolean;
  /** Product of `opacity` from this element up to the root (1 = fully opaque group). */
  cumulativeOpacity: number;
  /**
   * Backdrop as seen from inside the innermost `opacity < 1` group (that group's own fade not applied).
   * Text and borders painted in the group are faded by `cumulativeOpacity` relative to THIS colour,
   * not relative to `color`, so each opacity is applied exactly once (see `paintOver`).
   */
  inner: RGB;
  /** True when at least one layer (own or ancestor) was fully opaque before reaching the canvas. */
  reachedOpaque: boolean;
  /** Canvas colour scheme the walk fell back on when no opaque layer was reached ("light" = white canvas). */
  canvas: CanvasScheme;
}

export type CanvasScheme = "light" | "dark";

export type BackgroundCache = Map<Element, BackgroundResolution>;

const WHITE: RGB = [255, 255, 255];
/** Chromium's dark `Canvas` system colour (#121212), painted behind <html> when the used colour scheme is dark. */
const DARK_CANVAS: RGB = [18, 18, 18];

/** Rendered `color-scheme` keywords of the root element, lower-cased (empty when unavailable). */
function rootColorScheme(doc: Document): string[] {
  let value = "";
  try {
    const root = doc.documentElement;
    const view = doc.defaultView ?? window;
    if (root) {
      const cs = view.getComputedStyle(root);
      value = (cs.colorScheme || cs.getPropertyValue("color-scheme") || "").trim();
    }
  } catch {
    value = "";
  }
  if (!value || value === "normal") {
    // <meta name="color-scheme"> is a presentational hint on the root; read it directly
    // in case the engine does not reflect it in the computed style.
    try {
      const meta = doc.querySelector("meta[name='color-scheme' i]") as HTMLMetaElement | null;
      const content = meta?.content?.trim() ?? "";
      if (content) value = content;
    } catch {
      // ignore
    }
  }
  return value.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Colour scheme used for the canvas behind <html> (Chromium: white for light/normal, #121212 for dark). */
export function canvasScheme(doc: Document): CanvasScheme {
  const keywords = rootColorScheme(doc);
  const hasDark = keywords.includes("dark");
  if (!hasDark) return "light";
  const hasLight = keywords.includes("light");
  if (!hasLight) return "dark"; // "dark" or "only dark"
  try {
    const view = doc.defaultView ?? window;
    return view.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function canvasResolution(doc: Document | null): BackgroundResolution {
  const scheme: CanvasScheme = doc ? canvasScheme(doc) : "light";
  return { color: scheme === "dark" ? DARK_CANVAS : WHITE, hasImage: false, cumulativeOpacity: 1, inner: scheme === "dark" ? DARK_CANVAS : WHITE, reachedOpaque: false, canvas: scheme };
}

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) return root.host;
  return null;
}

function readOpacity(cs: CSSStyleDeclaration): number {
  const o = parseFloat(cs.opacity);
  return Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 1;
}

/**
 * Resolve the composite background behind `el`, walking ancestors (through
 * shadow hosts) and compositing translucent layers until an opaque one is
 * found or the canvas is reached. The canvas is white, or Chromium's dark
 * `Canvas` colour when the root's used `color-scheme` is dark (see
 * `canvasScheme`). Results are memoised in `cache` because siblings share
 * almost all of their ancestor chain (the canvas lookup therefore happens
 * once per cache, when <html> is resolved).
 */
export function resolveBackground(el: Element | null, cache: BackgroundCache = new Map()): BackgroundResolution {
  if (!el) return canvasResolution(null);
  const cached = cache.get(el);
  if (cached) return cached;

  let result: BackgroundResolution;
  try {
    const parentEl = parentOf(el);
    const parent = parentEl ? resolveBackground(parentEl, cache) : canvasResolution(el.ownerDocument);
    const view = el.ownerDocument.defaultView ?? window;
    const cs = view.getComputedStyle(el);
    const ownOpacity = readOpacity(cs);
    const cumulativeOpacity = parent.cumulativeOpacity * ownOpacity;
    const own = parseColor(cs.backgroundColor) ?? [0, 0, 0, 0];
    // A new opacity group starts here: its content is composited unfaded over the parent's final colour.
    const innerBase = ownOpacity < 1 ? parent.color : parent.inner;
    const ownRaw = Math.min(1, Math.max(0, own[3]));
    const inner: RGB = ownRaw > 0 ? blend([own[0], own[1], own[2], ownRaw], innerBase) : innerBase;
    const alpha = Math.min(1, Math.max(0, own[3])) * cumulativeOpacity;
    const ownImage = cs.backgroundImage !== "none" && cs.backgroundImage !== "";
    if (alpha >= 0.999) {
      result = { color: [own[0], own[1], own[2]], hasImage: ownImage, cumulativeOpacity, inner, reachedOpaque: true, canvas: parent.canvas };
    } else {
      const layer: RGBA = [own[0], own[1], own[2], alpha];
      result = {
        color: alpha > 0 ? blend(layer, parent.color) : parent.color,
        hasImage: ownImage || parent.hasImage,
        cumulativeOpacity,
        inner,
        reachedOpaque: parent.reachedOpaque,
        canvas: parent.canvas,
      };
    }
  } catch {
    result = { color: WHITE, hasImage: false, cumulativeOpacity: 1, inner: WHITE, reachedOpaque: false, canvas: "light" };
  }
  cache.set(el, result);
  return result;
}

/**
 * Composite a (possibly translucent) foreground painted inside `bg`'s opacity
 * group onto the resolved backdrop. The group's fade applies once, to the
 * difference between the painted colour and the group's own backdrop:
 * `color + K * alpha * (fg - inner)`. With no `opacity < 1` ancestor this is
 * plain source-over blending.
 */
export function paintOver(bg: BackgroundResolution, fg: RGBA): RGB {
  const k = Math.min(1, Math.max(0, fg[3])) * bg.cumulativeOpacity;
  const ch = (i: 0 | 1 | 2): number => Math.min(255, Math.max(0, Math.round(bg.color[i] + k * (fg[i] - bg.inner[i]))));
  return [ch(0), ch(1), ch(2)];
}

/** Parse a computed font-weight ("400", "bold", "normal", "bolder"). */
export function parseFontWeight(value: string): number {
  const n = parseInt(value, 10);
  if (Number.isFinite(n)) return n;
  const v = value.trim().toLowerCase();
  if (v === "bold" || v === "bolder") return 700;
  return 400;
}

/** True for elements the extension injected (defensive complement to ctx.isExtensionNode). */
export function isExtensionElement(el: Element, ctx: RuleContext): boolean {
  try {
    if (ctx.isExtensionNode(el)) return true;
    return el.closest(`[${EXT_MARKER_ATTR}]`) !== null;
  } catch {
    return false;
  }
}

/**
 * True when the element is painted: not display:none in its ancestry, not
 * visibility:hidden/collapse or opacity:0 on itself, and it has a box.
 *
 * Deliberately NOT `ctx.isVisible`: that predicate also returns false inside
 * `aria-hidden="true"` subtrees, which only affects assistive-technology
 * exposure. Contrast (1.4.3, 1.4.6, 1.4.11) is about what sighted users see,
 * and aria-hidden text is still rendered.
 */
export function isRendered(el: Element): boolean {
  try {
    if (!el.isConnected) return false;
    const doc = el.ownerDocument;
    if (el === doc.documentElement || el === doc.body) return true;
    const view = doc.defaultView ?? window;
    const rootBox = doc.documentElement?.getBoundingClientRect();
    const hasLayout = !!rootBox && (rootBox.width > 0 || rootBox.height > 0);
    const withCheck = el as Element & {
      checkVisibility?: (opts?: { visibilityProperty?: boolean; opacityProperty?: boolean; contentVisibilityAuto?: boolean }) => boolean;
    };
    if (hasLayout && typeof withCheck.checkVisibility === "function") {
      if (!withCheck.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true })) return false;
    } else {
      let node: Element | null = el;
      while (node) {
        const style = view.getComputedStyle(node);
        if (style.display === "none") return false;
        if (node === el && (style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0")) return false;
        node = node.parentElement;
      }
    }
    if (!hasLayout) return true; // no layout engine (jsdom / display:none frame): style checks are all we have
    const style = view.getComputedStyle(el);
    if (style.opacity === "0") return false;
    const rects = el.getClientRects();
    if (rects.length === 0) {
      return el.namespaceURI === "http://www.w3.org/2000/svg" && el.getBoundingClientRect().width > 0;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // Zero-size boxes may still paint overflowing children.
      return style.overflow !== "hidden" && Array.from(el.children).some((c) => c.getClientRects().length > 0);
    }
    return true;
  } catch {
    return false;
  }
}

/** Screen-reader-only text (clip/clip-path/1px boxes) is not seen and must not be measured. */
function isVisuallyHiddenText(el: Element, cs: CSSStyleDeclaration): boolean {
  const clip = cs.clip;
  if (clip && /rect\(\s*0(px)?[,\s]+0(px)?[,\s]+0(px)?[,\s]+0(px)?\s*\)/.test(clip) && cs.position === "absolute") return true;
  const clipPath = cs.clipPath;
  if (clipPath && /inset\(\s*(50%|100%)/.test(clipPath)) return true;
  if (cs.overflow === "hidden" || cs.overflowX === "hidden" || cs.overflowY === "hidden") {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 && rect.height <= 1) return true;
  }
  return false;
}

function truncate(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

function docOf(root: Document | Element): Document {
  return root.ownerDocument ?? (root as Document);
}

// ---------------------------------------------------------------------------
// Text contrast
// ---------------------------------------------------------------------------

interface TextGroup {
  element: Element;
  nodes: Text[];
}

/**
 * Collect rendered text nodes and group them by their parent element (one
 * finding per element). Uses `isRendered`, not `ctx.isVisible`, so text inside
 * aria-hidden subtrees (still painted for sighted users) is measured.
 */
async function collectTextGroups(ctx: RuleContext): Promise<TextGroup[]> {
  const doc = docOf(ctx.root);
  const groups = new Map<Element, TextGroup>();
  const skipped = new Set<Element>();
  const walker = doc.createTreeWalker(ctx.root, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    count++;
    if (count % CHUNK === 0) await ctx.yieldToMain();
    try {
      const text = node as Text;
      if (!text.data || !/\S/.test(text.data)) continue;
      const el = text.parentElement;
      if (!el) continue;
      const existing = groups.get(el);
      if (existing) {
        existing.nodes.push(text);
        continue;
      }
      if (skipped.has(el)) continue;
      if (SKIP_TAGS.has(el.tagName) || el.closest("svg, math") || isExtensionElement(el, ctx) || !isRendered(el)) {
        skipped.add(el);
        continue;
      }
      groups.set(el, { element: el, nodes: [text] });
    } catch {
      // Ignore this node; never let one broken node abort the rule.
    }
  }
  return [...groups.values()];
}

/** Union of the line boxes of the group's text nodes (viewport coordinates). */
function textRect(group: TextGroup): Rect | null {
  let rect: Rect | null = null;
  for (const node of group.nodes) {
    try {
      const range = node.ownerDocument.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      range.detach();
      if (r.width <= 0 || r.height <= 0) continue;
      rect = rect
        ? { left: Math.min(rect.left, r.left), top: Math.min(rect.top, r.top), right: Math.max(rect.right, r.right), bottom: Math.max(rect.bottom, r.bottom) }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    } catch {
      // ignore
    }
  }
  return rect;
}

interface MediaBox {
  element: Element;
  rect: Rect;
}

/** Rendered media elements that could sit behind text (img/video/canvas/picture/object/embed); aria-hidden media still paints. */
function collectMedia(ctx: RuleContext): MediaBox[] {
  const out: MediaBox[] = [];
  try {
    const list = ctx.root.querySelectorAll("img, video, canvas, picture, object, embed");
    const max = Math.min(list.length, 1500);
    for (let i = 0; i < max; i++) {
      const el = list[i];
      if (!el || isExtensionElement(el, ctx) || !isRendered(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      out.push({ element: el, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
    }
  } catch {
    // ignore
  }
  return out;
}

/** True when a media element that is neither ancestor nor descendant overlaps most of the text box. */
function overlapsMedia(group: TextGroup, rect: Rect, media: MediaBox[]): Element | null {
  const area = (rect.right - rect.left) * (rect.bottom - rect.top);
  if (area <= 0) return null;
  for (const m of media) {
    if (m.element === group.element || m.element.contains(group.element) || group.element.contains(m.element)) continue;
    if (intersectionArea(rect, m.rect) >= area * 0.25) return m.element;
  }
  return null;
}

/**
 * Description suffix (and Semi marker) when the background was not an opaque
 * author layer but the canvas inferred from a dark colour scheme. Browsers
 * other than Chromium, forced-colors mode or a UA theme may paint a different
 * canvas, so such findings are reported as Semi for review. A white canvas is
 * the interoperable default and stays Auto.
 */
function inferredCanvasNote(bg: BackgroundResolution): string {
  if (bg.reachedOpaque || bg.canvas !== "dark") return "";
  return " No opaque background was found; the dark canvas colour was inferred from the page's color-scheme, so please verify the rendered background.";
}

async function checkText(ctx: RuleContext, findings: RuleFinding[], cache: BackgroundCache): Promise<void> {
  const groups = await collectTextGroups(ctx);
  const media = collectMedia(ctx);
  const total = groups.length;
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % CHUNK === 0) {
      await ctx.yieldToMain();
      ctx.progress?.(Math.round((i / Math.max(1, total)) * 50));
    }
    const group = groups[i];
    if (!group) continue;
    try {
      const el = group.element;
      const view = el.ownerDocument.defaultView ?? window;
      const cs = view.getComputedStyle(el);
      if (isVisuallyHiddenText(el, cs)) continue;
      const fontSize = parseFloat(cs.fontSize);
      if (!Number.isFinite(fontSize) || fontSize <= 0) continue;
      const fontWeight = parseFontWeight(cs.fontWeight);
      // Disabled controls (and their labels/legends) are exempt from 1.4.3.
      if (el.closest(":disabled, [aria-disabled='true']")) continue;

      const fillColor = cs.webkitTextFillColor && cs.webkitTextFillColor !== "" ? cs.webkitTextFillColor : cs.color;
      const fg = parseColor(fillColor) ?? parseColor(cs.color);
      if (!fg) continue;

      const bg = resolveBackground(el, cache);
      const textAlpha = fg[3] * bg.cumulativeOpacity;
      if (textAlpha <= 0.01) continue; // invisible text (hidden on purpose)

      const snippet = truncate(group.nodes.map((n) => n.data).join(" "));
      const large = isLargeText(fontSize, fontWeight);
      const required = large ? 3 : 4.5;

      const clipText = cs.webkitBackgroundClip === "text" || (cs as unknown as { backgroundClip?: string }).backgroundClip === "text";
      const rect = textRect(group);
      const mediaBehind = rect ? overlapsMedia(group, rect, media) : null;
      if (bg.hasImage || clipText || mediaBehind) {
        const reason = mediaBehind
          ? `sits over a <${mediaBehind.tagName.toLowerCase()}> element`
          : clipText
            ? "uses background-clip: text"
            : "has a background image or gradient behind it";
        findings.push({
          element: el,
          type: IMAGE.type,
          severity: IMAGE.severity ?? PRIMARY.severity ?? "Moderate",
          description: `Text "${snippet}" ${reason}, so its contrast cannot be computed automatically. Text colour ${toHex([fg[0], fg[1], fg[2]])}; ${required}:1 is required for ${large ? "large" : "normal"} text (${Math.round(fontSize * 100) / 100}px, weight ${fontWeight}).`,
          data: {
            ruleId: IMAGE.id,
            foreground: toHex([fg[0], fg[1], fg[2]]),
            background: null,
            ratio: null,
            required,
            fontSize,
            fontWeight,
            reason: mediaBehind ? "media" : clipText ? "background-clip" : "background-image",
            text: snippet,
          },
          fix: {
            summary: "Verify the contrast against the darkest/lightest part of the image with a colour picker, or add a solid or semi-opaque overlay behind the text.",
            docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
          },
        });
        continue;
      }

      const fgOpaque = paintOver(bg, fg);
      const ratio = contrastRatio(fgOpaque, bg.color);
      if (contrastRatioExact(fgOpaque, bg.color) >= required) continue;

      const suggested = suggestPassingColor(fgOpaque, bg.color, required);
      const def = large ? LARGE : PRIMARY;
      const fgHex = toHex(fgOpaque);
      const bgHex = toHex(bg.color);
      const inferredCanvas = inferredCanvasNote(bg);
      findings.push({
        element: el,
        type: inferredCanvas ? "Semi" : def.type,
        severity: def.severity ?? "Serious",
        description: `Text "${snippet}" has a contrast ratio of ${ratio}:1 (${fgHex} on ${bgHex}); ${required}:1 is required for ${large ? "large" : "normal"} text (${Math.round(fontSize * 100) / 100}px, weight ${fontWeight}).${inferredCanvas}`,
        data: {
          ruleId: def.id,
          foreground: fgHex,
          background: bgHex,
          ratio,
          required,
          fontSize,
          fontWeight,
          textOpacity: Math.round(textAlpha * 100) / 100,
          text: snippet,
          reachedOpaque: bg.reachedOpaque,
          canvas: bg.canvas,
        },
        fix: {
          summary: `Change the text colour to ${toHex(suggested)} (${contrastRatio(suggested, bg.color)}:1 against ${bgHex}) or adjust the background so the ratio reaches ${required}:1.`,
          suggestedValue: `color: ${toHex(suggested)}`,
          docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
        },
      });
    } catch {
      // Per-element defensive catch: continue with the next group.
    }
  }
}

// ---------------------------------------------------------------------------
// CLR-04: control boundaries
// ---------------------------------------------------------------------------

const CONTROL_SELECTOR = "input, select, textarea, button, [role='checkbox'], [role='radio'], [role='switch'], [role='slider']";

interface BorderInfo {
  color: RGBA;
  width: number;
  side: string;
}

/** First painted border side (width > 0, style not none/hidden) with a parseable colour. */
function paintedBorder(cs: CSSStyleDeclaration): BorderInfo | null {
  const sides: Array<[string, string, string, string]> = [
    ["top", cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor],
    ["right", cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor],
    ["bottom", cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor],
    ["left", cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor],
  ];
  for (const [side, w, style, color] of sides) {
    const width = parseFloat(w);
    if (!Number.isFinite(width) || width <= 0) continue;
    if (style === "none" || style === "hidden") continue;
    const parsed = parseColor(color);
    if (!parsed) continue;
    return { color: parsed, width, side };
  }
  return null;
}

async function checkControls(ctx: RuleContext, findings: RuleFinding[], cache: BackgroundCache): Promise<void> {
  let controls: Element[] = [];
  try {
    controls = Array.from(queryAllIncludingRoot(ctx.root, CONTROL_SELECTOR));
  } catch {
    return;
  }
  const total = controls.length;
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % CHUNK === 0) {
      await ctx.yieldToMain();
      ctx.progress?.(50 + Math.round((i / Math.max(1, total)) * 50));
    }
    const el = controls[i];
    if (!el) continue;
    try {
      // Rendered-only check: an aria-hidden control is still painted and its boundary must still be perceivable.
      if (isExtensionElement(el, ctx) || !isRendered(el)) continue;
      if (el instanceof HTMLInputElement && (el.type === "hidden")) continue;
      if (el.matches(":disabled, [aria-disabled='true']")) continue; // inactive controls are exempt
      const view = el.ownerDocument.defaultView ?? window;
      const cs = view.getComputedStyle(el);
      // Native-appearance checkbox/radio/range/color/file controls are drawn by the UA;
      // their computed border colours do not describe what is painted.
      if (el instanceof HTMLInputElement && ["checkbox", "radio", "range", "color", "file"].includes(el.type)) {
        const appearance = (cs as unknown as { appearance?: string }).appearance ?? "";
        if (appearance !== "none") continue;
      }
      if (cs.backgroundImage && cs.backgroundImage !== "none") continue; // undeterminable (custom icons/gradients)
      const border = paintedBorder(cs);
      if (!border) continue;

      const surrounding = resolveBackground(parentOf(el), cache);
      if (surrounding.hasImage) continue; // cannot compare against an image

      const borderRgb = paintOver(surrounding, border.color);
      const borderRatio = contrastRatio(borderRgb, surrounding.color);
      if (contrastRatioExact(borderRgb, surrounding.color) >= 3) continue;

      // A strongly contrasting fill also identifies the component boundary.
      const ownBg = parseColor(cs.backgroundColor);
      let fillRatio = 1;
      let fillHex: string | null = null;
      if (ownBg && ownBg[3] > 0) {
        const fill = paintOver(surrounding, ownBg);
        fillRatio = contrastRatio(fill, surrounding.color);
        fillHex = toHex(fill);
        if (contrastRatioExact(fill, surrounding.color) >= 3) continue;
      }

      const suggested = suggestPassingColor(borderRgb, surrounding.color, 3);
      const bgHex = toHex(surrounding.color);
      const inferredCanvas = inferredCanvasNote(surrounding);
      findings.push({
        element: el,
        type: inferredCanvas ? "Semi" : BORDER.type,
        severity: BORDER.severity ?? "Serious",
        description: `The ${border.width}px ${border.side} border of this ${el.tagName.toLowerCase()} (${toHex(borderRgb)}) has a contrast of ${borderRatio}:1 against the surrounding background ${bgHex}${fillHex ? `, and its fill ${fillHex} only reaches ${fillRatio}:1` : ""}; 3:1 is required to identify the control boundary.${inferredCanvas}`,
        data: {
          ruleId: BORDER.id,
          foreground: toHex(borderRgb),
          background: bgHex,
          ratio: borderRatio,
          required: 3,
          borderWidth: border.width,
          borderSide: border.side,
          fill: fillHex,
          fillRatio: fillHex ? fillRatio : null,
          reachedOpaque: surrounding.reachedOpaque,
          canvas: surrounding.canvas,
        },
        fix: {
          summary: `Use a border colour of at least ${toHex(suggested)} (${contrastRatio(suggested, surrounding.color)}:1), or give the control a fill that contrasts 3:1 with its surroundings.`,
          suggestedValue: `border-color: ${toHex(suggested)}`,
          docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html",
        },
      });
    } catch {
      // continue with the next control
    }
  }
}

// ---------------------------------------------------------------------------

export const rule: CustomRule = {
  id: PRIMARY.id,
  emits: [LARGE.id, IMAGE.id, BORDER.id],
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Serious",
  defaultFix: {
    summary: "Increase the contrast between text and its background to at least 4.5:1 (3:1 for large text).",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    const cache: BackgroundCache = new Map();
    try {
      await checkText(ctx, findings, cache);
    } catch {
      // A failure in the text pass must not prevent the control pass.
    }
    try {
      await checkControls(ctx, findings, cache);
    } catch {
      // ignore
    }
    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
