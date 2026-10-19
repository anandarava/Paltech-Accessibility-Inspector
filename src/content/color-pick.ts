/**
 * Colours of an element for the side panel's Contrast checker.
 *
 * The text colour is the computed CSS colour, exactly, with the element's own
 * alpha and every ancestor's opacity applied: picking text pixels with an
 * eyedropper lands on anti-aliased edges and reads too light, so the CSS value
 * is the accurate one. The background is the one the contrast rule works out
 * from the element's ancestors; `backgroundSure` is false when an image,
 * gradient or a box that is not an ancestor may be behind the text, and the
 * tester should then pick the background on the page instead.
 */
import { isLargeText, parseColor, toHex } from "@shared/color";
import type { ElementColors } from "@shared/types";
import { parseFontWeight, resolveBackground, saveScroll, stackBackground } from "./rules/contrast";

export function elementColors(el: Element): ElementColors {
  const view = el.ownerDocument.defaultView ?? window;
  const cs = view.getComputedStyle(el);
  const fill = cs.webkitTextFillColor && cs.webkitTextFillColor !== "" ? cs.webkitTextFillColor : cs.color;
  const fg = parseColor(fill) ?? parseColor(cs.color) ?? [0, 0, 0, 1];
  const bg = resolveBackground(el);
  const alpha = Math.max(0, Math.min(1, fg[3] * bg.cumulativeOpacity));
  const fontSize = parseFloat(cs.fontSize) || 16;
  const fontWeight = parseFontWeight(cs.fontWeight);
  let sure = bg.reachedOpaque && !bg.hasImage;
  let background = bg.color;
  if (sure) {
    // The browser's own stack at the element: a box that is not an ancestor may be behind it.
    const restore = saveScroll(el);
    try {
      const r = el.getBoundingClientRect();
      const found = stackBackground(el, { x: r.left + Math.min(r.width / 2, 8), y: r.top + r.height / 2 }, bg.reachedOpaque);
      if (found.doubt) sure = false;
      else if (found.color) background = found.color;
    } finally {
      restore();
    }
  }
  return {
    foreground: alpha >= 0.999 ? toHex([fg[0], fg[1], fg[2]]) : `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, ${Math.round(alpha * 1000) / 1000})`,
    background: toHex(background),
    backgroundSure: sure,
    fontSize,
    fontWeight,
    large: isLargeText(fontSize, fontWeight),
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
  };
}
