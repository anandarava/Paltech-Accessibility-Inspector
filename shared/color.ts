/**
 * Pure colour maths for the contrast rules and the UI.
 *
 * - No DOM access, no globals: safe to use from the content script, the
 *   service worker, React pages and unit tests.
 * - Luminance/contrast follow WCAG 2.2 (sRGB, 0.04045 linearisation threshold).
 * - `parseColor` understands everything `getComputedStyle` can hand back in
 *   Chromium (`rgb()`, `rgba()`, modern space-separated syntax, `color(srgb ...)`)
 *   plus the author-side forms that show up in inline styles and tests
 *   (`#hex` in 3/4/6/8 digits, `hsl()`, `transparent`, common named colours).
 */

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

/** Small named-colour table: CSS basic colours plus a few very common extended ones. */
const NAMED: Record<string, RGB> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  aqua: [0, 255, 255],
  magenta: [255, 0, 255],
  fuchsia: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  lime: [0, 255, 0],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  purple: [128, 0, 128],
  orange: [255, 165, 0],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  whitesmoke: [245, 245, 245],
  gainsboro: [220, 220, 220],
  brown: [165, 42, 42],
  pink: [255, 192, 203],
  gold: [255, 215, 0],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  tomato: [255, 99, 71],
  crimson: [220, 20, 60],
  coral: [255, 127, 80],
  salmon: [250, 128, 114],
  khaki: [240, 230, 140],
  beige: [245, 245, 220],
  ivory: [255, 255, 240],
  tan: [210, 180, 140],
  skyblue: [135, 206, 235],
  steelblue: [70, 130, 180],
  royalblue: [65, 105, 225],
  dodgerblue: [30, 144, 255],
  forestgreen: [34, 139, 34],
  seagreen: [46, 139, 87],
  darkgreen: [0, 100, 0],
  darkblue: [0, 0, 139],
  darkred: [139, 0, 0],
  rebeccapurple: [102, 51, 153],
};

function clamp255(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(255, Math.max(0, Math.round(v)));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/** Parse one channel token: "255", "50%", "none" (treated as 0). */
function channel(token: string, scale: number): number | null {
  if (token === "none") return 0;
  if (token.endsWith("%")) {
    const p = parseFloat(token);
    return Number.isNaN(p) ? null : (p / 100) * scale;
  }
  const n = parseFloat(token);
  return Number.isNaN(n) ? null : n;
}

/** Parse an alpha token: "0.5", "50%", "none" (missing -> 1). */
function alphaToken(token: string | undefined): number | null {
  if (token === undefined) return 1;
  if (token === "none") return 0;
  if (token.endsWith("%")) {
    const p = parseFloat(token);
    return Number.isNaN(p) ? null : clamp01(p / 100);
  }
  const n = parseFloat(token);
  return Number.isNaN(n) ? null : clamp01(n);
}

function parseHex(s: string): RGBA | null {
  const hex = s.slice(1);
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  const h = (i: number): number => parseInt(hex.charAt(i) + hex.charAt(i), 16);
  const hh = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
  switch (hex.length) {
    case 3:
      return [h(0), h(1), h(2), 1];
    case 4:
      return [h(0), h(1), h(2), h(3) / 255];
    case 6:
      return [hh(0), hh(2), hh(4), 1];
    case 8:
      return [hh(0), hh(2), hh(4), hh(6) / 255];
    default:
      return null;
  }
}

function hueToken(token: string): number | null {
  if (token === "none") return 0;
  const m = /^(-?[\d.]+(?:e[-+]?\d+)?)(deg|grad|rad|turn)?$/.exec(token);
  if (!m) return null;
  const v = parseFloat(m[1] ?? "");
  if (Number.isNaN(v)) return null;
  switch (m[2]) {
    case "grad":
      return v * 0.9;
    case "rad":
      return (v * 180) / Math.PI;
    case "turn":
      return v * 360;
    default:
      return v;
  }
}

/**
 * Parse a CSS colour into [r, g, b, a] (channels 0-255, alpha 0-1).
 * Returns null for values that cannot be resolved without context
 * (`currentcolor`, `inherit`, custom properties, unknown names).
 */
export function parseColor(css: string): RGBA | null {
  if (typeof css !== "string") return null;
  const s = css.trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent") return [0, 0, 0, 0];
  const named = NAMED[s];
  if (named) return [named[0], named[1], named[2], 1];
  if (s.startsWith("#")) return parseHex(s);

  const fn = /^([a-z]+)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const name = fn[1] ?? "";
  // Normalise "r, g, b, a", "r g b / a" and "r g b" into one token list.
  const tokens = (fn[2] ?? "")
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (name === "rgb" || name === "rgba") {
    if (tokens.length < 3) return null;
    const r = channel(tokens[0] ?? "", 255);
    const g = channel(tokens[1] ?? "", 255);
    const b = channel(tokens[2] ?? "", 255);
    const a = alphaToken(tokens[3]);
    if (r === null || g === null || b === null || a === null) return null;
    return [clamp255(r), clamp255(g), clamp255(b), a];
  }

  if (name === "hsl" || name === "hsla") {
    if (tokens.length < 3) return null;
    const h = hueToken(tokens[0] ?? "");
    const satTok = tokens[1] ?? "";
    const lightTok = tokens[2] ?? "";
    const sat = channel(satTok, 1);
    const light = channel(lightTok, 1);
    const a = alphaToken(tokens[3]);
    if (h === null || sat === null || light === null || a === null) return null;
    // Percent tokens are already scaled to 0..1; bare numbers are percentages too.
    const sv = satTok.endsWith("%") ? sat : sat / 100;
    const lv = lightTok.endsWith("%") ? light : light / 100;
    const rgb = hslToRgb(h, clamp01(sv) * 100, clamp01(lv) * 100);
    return [rgb[0], rgb[1], rgb[2], a];
  }

  if (name === "color") {
    // color(srgb r g b [/ a]) with channels in 0..1 (or percentages).
    if (tokens.length < 4 || tokens[0] !== "srgb") return null;
    const r = channel(tokens[1] ?? "", 1);
    const g = channel(tokens[2] ?? "", 1);
    const b = channel(tokens[3] ?? "", 1);
    const a = alphaToken(tokens[4]);
    if (r === null || g === null || b === null || a === null) return null;
    return [clamp255(r * 255), clamp255(g * 255), clamp255(b * 255), a];
  }

  return null;
}

/** Relative luminance per WCAG 2.2 (sRGB, 0.04045 threshold). */
export function luminance(rgb: RGB): number {
  const lin = (v: number): number => {
    const c = clamp255(v) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** Contrast ratio between two opaque colours, rounded to 2 decimals (1..21). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  const ratio = (light + 0.05) / (dark + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** Composite a translucent colour over an opaque one ("source over"). */
export function blend(top: RGBA, bottom: RGB): RGB {
  const a = clamp01(top[3]);
  return [
    clamp255(top[0] * a + bottom[0] * (1 - a)),
    clamp255(top[1] * a + bottom[1] * (1 - a)),
    clamp255(top[2] * a + bottom[2] * (1 - a)),
  ];
}

/** Lower-case "#rrggbb". */
export function toHex(rgb: RGB): string {
  return "#" + rgb.map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
}

/** RGB (0-255) -> HSL (h 0-360, s 0-100, l 0-100). */
export function rgbToHsl(rgb: RGB): [number, number, number] {
  const r = clamp255(rgb[0]) / 255;
  const g = clamp255(rgb[1]) / 255;
  const b = clamp255(rgb[2]) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s * 100, l * 100];
}

/** HSL (h 0-360, s 0-100, l 0-100) -> RGB (0-255). */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = clamp01(s / 100);
  const ll = clamp01(l / 100);
  if (ss === 0) {
    const v = clamp255(ll * 255);
    return [v, v, v];
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hue = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [clamp255(hue(hh + 1 / 3) * 255), clamp255(hue(hh) * 255), clamp255(hue(hh - 1 / 3) * 255)];
}

/**
 * Suggest the nearest colour to `fg` (same hue and saturation, lightness
 * adjusted in 1% steps) that reaches `target` contrast against `bg`.
 * Darkens first when the background is light, lightens first otherwise;
 * tries the opposite direction if the first one runs out of range, and
 * finally falls back to whichever of black/white contrasts better.
 */
export function suggestPassingColor(fg: RGB, bg: RGB, target: number): RGB {
  const start: RGB = [clamp255(fg[0]), clamp255(fg[1]), clamp255(fg[2])];
  if (contrastRatio(start, bg) >= target) return start;
  const [h, s, l] = rgbToHsl(start);
  // Luminance ~0.179 is where black and white contrast equally against bg.
  const bgIsLight = luminance(bg) > 0.179;
  const directions: Array<1 | -1> = bgIsLight ? [-1, 1] : [1, -1];
  for (const dir of directions) {
    for (let step = 1; step <= 100; step++) {
      const nl = l + dir * step;
      if (nl < 0 || nl > 100) break;
      const candidate = hslToRgb(h, s, nl);
      if (contrastRatio(candidate, bg) >= target) return candidate;
    }
  }
  const black: RGB = [0, 0, 0];
  const white: RGB = [255, 255, 255];
  return contrastRatio(black, bg) >= contrastRatio(white, bg) ? black : white;
}

/**
 * WCAG "large text": at least 18pt (24px) regular, or at least 14pt
 * (18.66px) with font-weight >= 700.
 */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  if (!Number.isFinite(fontSizePx)) return false;
  if (fontSizePx >= 24) return true;
  const weight = Number.isFinite(fontWeight) ? fontWeight : 400;
  return fontSizePx >= 18.66 && weight >= 700;
}
