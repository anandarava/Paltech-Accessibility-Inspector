/**
 * Manual contrast check: the maths behind the side panel's Contrast checker.
 *
 * Uses the same WCAG 2.2 luminance and ratio functions as the scan
 * (`shared/color.ts`), so a colour pair gives the same number in the checker,
 * the issue details and the reports. Pass/fail is decided on the unrounded
 * ratio; the shown ratio is truncated to 2 decimals (never rounded up).
 */
import { blend, contrastRatio, contrastRatioExact, parseColor, suggestPassingColor, toHex, type RGB, type RGBA } from "./color";

export const WHITE: RGB = [255, 255, 255];

/**
 * Parse what a tester types or pastes as a colour: a hex value with or without
 * "#" (3, 4, 6 or 8 digits), or any CSS colour (`rgb()`, `hsl()`, `oklch()`,
 * a colour name). Null when it is not a colour.
 */
export function parseColorInput(text: string): RGBA | null {
  const s = text.trim();
  if (!s) return null;
  if (/^[0-9a-f]{3,8}$/i.test(s) && [3, 4, 6, 8].includes(s.length)) return parseColor(`#${s}`);
  const parsed = parseColor(s);
  if (!parsed) return null;
  if (s.toLowerCase() === "transparent") return null; // nothing to measure
  return parsed;
}

/** One WCAG threshold and whether the pair meets it. */
export interface ContrastCriterion {
  id: "aa-normal" | "aa-large" | "aaa-normal" | "aaa-large" | "non-text";
  label: string;
  criterion: string;
  required: number;
  pass: boolean;
}

export interface ContrastEvaluation {
  /** Text colour as drawn: a translucent text colour blended over the background. */
  foreground: RGB;
  /** Background as drawn: a translucent background blended over white. */
  background: RGB;
  /** Unrounded ratio: compare against thresholds with this one. */
  exact: number;
  /** Ratio truncated to 2 decimals, for display. */
  ratio: number;
  criteria: ContrastCriterion[];
  /** Set when a translucent colour had to be blended, to tell the tester. */
  notes: string[];
}

/**
 * The colours as the browser draws them and the ratio between them. A
 * translucent background is assumed to sit on white (the page canvas); a
 * translucent text colour is blended over the background.
 */
export function evaluateContrast(fg: RGBA, bg: RGBA): ContrastEvaluation {
  const notes: string[] = [];
  const background: RGB = bg[3] >= 0.999 ? [bg[0], bg[1], bg[2]] : blend(bg, WHITE);
  if (bg[3] < 0.999) notes.push(`The background is ${Math.round(bg[3] * 100)}% opaque; it was blended over white. Pick the colour on the page to measure what is really behind it.`);
  const foreground: RGB = fg[3] >= 0.999 ? [fg[0], fg[1], fg[2]] : blend(fg, background);
  if (fg[3] < 0.999) notes.push(`The text colour is ${Math.round(fg[3] * 100)}% opaque; it was blended over the background (${toHex(foreground)} as drawn).`);
  const exact = contrastRatioExact(foreground, background);
  const criteria: ContrastCriterion[] = [
    { id: "aa-normal", label: "Normal text, AA", criterion: "1.4.3", required: 4.5, pass: exact >= 4.5 },
    { id: "aa-large", label: "Large text, AA", criterion: "1.4.3", required: 3, pass: exact >= 3 },
    { id: "aaa-normal", label: "Normal text, AAA", criterion: "1.4.6", required: 7, pass: exact >= 7 },
    { id: "aaa-large", label: "Large text, AAA", criterion: "1.4.6", required: 4.5, pass: exact >= 4.5 },
    { id: "non-text", label: "Icons, borders, focus rings (non-text)", criterion: "1.4.11", required: 3, pass: exact >= 3 },
  ];
  return { foreground, background, exact, ratio: contrastRatio(foreground, background), criteria, notes };
}

/** Nearest passing text colour and nearest passing background for `required`. */
export function suggestFixes(ev: ContrastEvaluation, required: number): { text: RGB; background: RGB } | null {
  if (ev.exact >= required) return null;
  return {
    text: suggestPassingColor(ev.foreground, ev.background, required),
    background: suggestPassingColor(ev.background, ev.foreground, required),
  };
}

/** "#ffffff", or "#ffffff (80% opaque)" for a translucent colour. */
export function describeColor(c: RGBA): string {
  const hex = toHex([c[0], c[1], c[2]]);
  return c[3] >= 0.999 ? hex : `${hex} (${Math.round(c[3] * 100)}% opaque)`;
}
