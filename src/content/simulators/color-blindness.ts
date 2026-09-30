/**
 * Colour-vision-deficiency simulator.
 *
 * Injects (once) a zero-sized <svg> holding a <filter id="a11y-checker-cvd">
 * with an feColorMatrix, then applies `filter: url(#a11y-checker-cvd)` to
 * <html> through a marked <style> element. Mode "none" removes the style (the
 * filter definition stays, it is inert without the style).
 *
 * Matrices are the full-severity (1.0) simulation matrices from
 * Machado, Oliveira & Fernandes, "A Physiologically-based Model for Simulation
 * of Color Vision Deficiency", IEEE TVCG 2009. Achromatopsia uses the Rec. 709
 * luminance weights (0.2126, 0.7152, 0.0722) on every channel.
 *
 * NOTE: the overlay host is a child of <html>, so it is filtered too: badges
 * and outlines are shown as a colour-blind tester would see them. That is
 * deliberate (a page-only filter would need the host outside <html>, which is
 * impossible). A side effect of `filter` on the root element is that the
 * element becomes the containing block for `position: fixed` descendants; the
 * overlay compensates by subtracting its own client-rect offset when it draws.
 */
import { EXT_MARKER_ATTR } from "@shared/constants";
import type { ColorBlindnessMode } from "@shared/types";

export const CVD_FILTER_ID = "a11y-checker-cvd";
const SVG_MARKER = "cvd-filter";
const STYLE_MARKER = "cvd-style";
const SVG_NS = "http://www.w3.org/2000/svg";

type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const MACHADO_2009: Record<Exclude<ColorBlindnessMode, "none">, Matrix3> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
  achromatopsia: [
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
  ],
};

/** The 4x5 feColorMatrix `values` string for a mode. */
export function colorMatrixValues(mode: Exclude<ColorBlindnessMode, "none">): string {
  const m = MACHADO_2009[mode];
  const rows = m.map((r) => `${r[0]} ${r[1]} ${r[2]} 0 0`);
  rows.push("0 0 0 1 0");
  return rows.join("  ");
}

function findSvg(): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>(`svg[${EXT_MARKER_ATTR}="${SVG_MARKER}"]`);
}

function findStyle(): HTMLStyleElement | null {
  return document.querySelector<HTMLStyleElement>(`style[${EXT_MARKER_ATTR}="${STYLE_MARKER}"]`);
}

function ensureSvg(): { svg: SVGSVGElement; matrix: SVGFEColorMatrixElement } {
  let svg = findSvg();
  let matrix = svg ? svg.querySelector<SVGFEColorMatrixElement>("feColorMatrix") : null;
  if (svg && matrix) return { svg, matrix };
  if (svg) svg.remove();

  svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute(EXT_MARKER_ATTR, SVG_MARKER);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute!important;width:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important;";

  const filter = document.createElementNS(SVG_NS, "filter");
  filter.setAttribute("id", CVD_FILTER_ID);
  filter.setAttribute("color-interpolation-filters", "sRGB");
  matrix = document.createElementNS(SVG_NS, "feColorMatrix");
  matrix.setAttribute("type", "matrix");
  matrix.setAttribute("in", "SourceGraphic");
  filter.appendChild(matrix);
  svg.appendChild(filter);
  // Attached to <html>, not <body>, so body mutation observers (ours and the page's) do not see it.
  document.documentElement.appendChild(svg);
  return { svg, matrix };
}

/**
 * Apply (or, with "none", remove) the colour-blindness filter on <html>.
 * Idempotent; safe to call repeatedly with the same mode.
 */
export function applyColorBlindness(mode: ColorBlindnessMode): void {
  if (mode === "none") {
    findStyle()?.remove();
    return;
  }
  if (!(mode in MACHADO_2009)) {
    findStyle()?.remove();
    return;
  }
  const { matrix } = ensureSvg();
  matrix.setAttribute("values", colorMatrixValues(mode));

  let style = findStyle();
  if (!style) {
    style = document.createElement("style");
    style.setAttribute(EXT_MARKER_ATTR, STYLE_MARKER);
    (document.head ?? document.documentElement).appendChild(style);
  }
  const css = `html { filter: url(#${CVD_FILTER_ID}) !important; }`;
  if (style.textContent !== css) style.textContent = css;
  style.dataset.cvdMode = mode;
}

/** Remove both the style and the filter definition (used on overlay destroy). */
export function removeColorBlindness(): void {
  findStyle()?.remove();
  findSvg()?.remove();
}

/** Currently applied mode, derived from the DOM (survives content-script reloads). */
export function currentColorBlindness(): ColorBlindnessMode {
  const style = findStyle();
  const mode = style?.dataset.cvdMode;
  if (mode && mode in MACHADO_2009) return mode as ColorBlindnessMode;
  return "none";
}
