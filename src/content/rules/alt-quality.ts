/**
 * Alternative-text quality rules.
 *
 * Emits:
 *  - IMG-02  alt text is a filename or URL (Auto, Serious)
 *  - IMG-03  alt text is a generic word such as "image" or "icon" (Auto, Moderate)
 *  - IMG-08  inline <svg> with no role, no accessible name and no aria-hidden
 *            (Semi, Moderate): it may be decorative, but a screen reader will
 *            still expose it (often as "group" or by reading its <title>).
 *
 * Heuristics and their risks
 * --------------------------
 *  - Filenames are recognised by an image extension at the end of the text, a
 *    camera-style prefix (IMG_1234, DSC0001, DCIM-..., P1000123), a URL, or a
 *    slash-separated path with at least two slashes or a file extension.
 *    Product codes that happen to look like this are a false-positive risk;
 *    "P30 Pro"-style names and "Yes/No"-style pairs are deliberately excluded.
 *  - The generic-word list is matched only when the *whole* alt (after
 *    trimming punctuation) is one of the words, so "Photo of the team at the
 *    2024 offsite" is not flagged. "logo" alone is flagged because it does
 *    not identify whose logo it is; a site that consistently uses a visible
 *    caption next to it will see a false positive.
 *  - `[role=img]` elements and `<svg role=img>` are checked through their
 *    accessible name with the same lists.
 *  - IMG-08 skips svgs inside a control that already has an accessible name
 *    (an icon inside `<button aria-label="Close">`) because the icon is
 *    harmless there; it also skips hidden images.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { accessibleName, queryAllIncludingRoot } from "@src/content/dom-utils";
import { isExtensionElement } from "./contrast";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const PRIMARY = ruleDef("IMG-02");
const GENERIC = ruleDef("IMG-03");
const SVG = ruleDef("IMG-08");
const CHUNK = 200;

export const FILENAME_RE = /\.(jpe?g|png|gif|svg|webp|avif|bmp|tiff?|ico)$/i;
/**
 * Camera-style filenames: IMG_1234, DSC0001, DCIM-..., PXL_..., DSCN..., SAM_... need only two
 * digits. A bare "P" prefix (Panasonic/Olympus: P1000123) needs four or more digits and must not
 * be followed by a letter or digit, so product names such as "P30 Pro", "P45 form",
 * "P100 respirator" or "p90x workout" are not treated as filenames.
 */
export const CAMERA_RE = /^(IMG|DSC|DCIM|PXL|DSCN|SAM)[_-]?\d{2,}|^P\d{4,}(?![a-z0-9])/i;
const URL_RE = /^(https?:)?\/\/|^data:image\//i;
/**
 * Slash-separated paths: either at least two slashes ("images/products/hero") or a single
 * directory plus a file with an extension ("assets/hero.webp", "docs/brochure.pdf"). A single
 * slash between two words ("Yes/No", "AC/DC", "On/Off", "Input/Output", "24/7") is ordinary
 * text, not a path.
 */
const PATH_RE = /^[\w-]+(\/[\w.-]+){2,}$|^[\w-]+(\/[\w.-]+)*\/[\w-]+\.[a-z]{2,4}$/i;

export const GENERIC_WORDS = new Set([
  "image",
  "images",
  "img",
  "photo",
  "photograph",
  "picture",
  "pic",
  "icon",
  "graphic",
  "graphics",
  "logo",
  "banner",
  "thumbnail",
  "thumb",
  "screenshot",
  "figure",
  "illustration",
  "spacer",
  "placeholder",
  "untitled",
  "alt",
  "alt text",
  "image description",
  "no description",
  "default",
  "temp",
  "test",
]);

/** Normalise alt text for word matching: lower-case, collapse spaces, strip surrounding punctuation. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .trim();
}

/** Classify a text alternative: "filename", "generic" or null. */
export function classifyAlt(alt: string): "filename" | "generic" | null {
  const raw = alt.trim();
  if (!raw) return null;
  if (FILENAME_RE.test(raw) || CAMERA_RE.test(raw) || URL_RE.test(raw) || PATH_RE.test(raw)) return "filename";
  const norm = normalise(raw);
  if (!norm) return "generic"; // only punctuation, e.g. "-" or "*"
  if (GENERIC_WORDS.has(norm)) return "generic";
  // "image 1", "photo 2", "icon-3": generic word plus a counter
  const counter = /^([a-z ]+?)[\s_-]*\d+$/.exec(norm);
  if (counter && GENERIC_WORDS.has(counter[1]?.trim() ?? "")) return "generic";
  return null;
}

function altFinding(el: Element, alt: string, kind: "filename" | "generic", source: string): RuleFinding {
  const def = kind === "filename" ? PRIMARY : GENERIC;
  return {
    element: el,
    type: def.type,
    severity: def.severity ?? "Moderate",
    description:
      kind === "filename"
        ? `The ${source} "${alt}" looks like a filename or URL; screen reader users hear it instead of a description of the image.`
        : `The ${source} "${alt}" is generic and does not describe what the image conveys.`,
    data: { ruleId: def.id, alt, source, kind },
    fix: {
      summary:
        kind === "filename"
          ? "Replace the filename with a short description of the image's purpose, or use alt=\"\" if it is decorative."
          : "Describe the content or function of the image (for example the text on a logo, or the action of an icon button), or use alt=\"\" if it is purely decorative.",
      docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html",
    },
  };
}

function hasSvgName(svg: Element): boolean {
  const label = svg.getAttribute("aria-label");
  if (label && label.trim()) return true;
  const labelledBy = svg.getAttribute("aria-labelledby");
  if (labelledBy && labelledBy.trim()) return true;
  for (const child of Array.from(svg.children)) {
    if (child.tagName.toLowerCase() === "title" && (child.textContent ?? "").trim()) return true;
  }
  return false;
}

/** Closest interactive ancestor that carries its own accessible name (icon-in-button case). */
function insideNamedControl(svg: Element): boolean {
  const control = svg.closest("a[href], button, [role='button'], [role='link'], [role='tab'], [role='menuitem'], summary, label");
  if (!control) return false;
  try {
    return accessibleName(control).trim().length > 0;
  } catch {
    return false;
  }
}

export const rule: CustomRule = {
  id: PRIMARY.id,
  emits: [GENERIC.id, SVG.id],
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Serious",
  defaultFix: {
    summary: "Write alt text that conveys the purpose of the image, or alt=\"\" for decorative images.",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];

    // --- img[alt], input[type=image][alt], area[alt] -----------------------
    let images: Element[] = [];
    try {
      images = Array.from(queryAllIncludingRoot(ctx.root, "img[alt], input[type='image'][alt], area[alt]"));
    } catch {
      images = [];
    }
    for (let i = 0; i < images.length; i++) {
      if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
      const el = images[i];
      if (!el) continue;
      try {
        if (isExtensionElement(el, ctx)) continue;
        const alt = el.getAttribute("alt") ?? "";
        if (!alt.trim()) continue; // decorative
        if (el.getAttribute("role") === "presentation" || el.getAttribute("role") === "none") continue;
        if (el.getAttribute("aria-hidden") === "true") continue;
        // aria-label / aria-labelledby override alt in the accessible name; judge what is actually announced.
        const ariaLabel = el.getAttribute("aria-label");
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy && labelledBy.trim()) continue;
        const text = ariaLabel && ariaLabel.trim() ? ariaLabel : alt;
        const source = ariaLabel && ariaLabel.trim() ? "aria-label" : "alt text";
        if (!(el instanceof HTMLAreaElement) && !ctx.isVisible(el)) continue;
        const kind = classifyAlt(text);
        if (kind) findings.push(altFinding(el, text.trim(), kind, source));
      } catch {
        // next
      }
    }

    // --- [role=img] and svg[role=img]: same lists on the accessible name ---
    let roleImgs: Element[] = [];
    try {
      roleImgs = Array.from(queryAllIncludingRoot(ctx.root, "[role='img']"));
    } catch {
      roleImgs = [];
    }
    for (let i = 0; i < roleImgs.length; i++) {
      if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
      const el = roleImgs[i];
      if (!el) continue;
      try {
        if (el.tagName.toLowerCase() === "img") continue; // handled above
        if (isExtensionElement(el, ctx) || !ctx.isVisible(el)) continue;
        if (el.getAttribute("aria-hidden") === "true") continue;
        const name = accessibleName(el).trim();
        if (!name) continue; // missing name is IMG-05 (axe)
        const kind = classifyAlt(name);
        if (kind) findings.push(altFinding(el, name, kind, "accessible name"));
      } catch {
        // next
      }
    }

    // --- IMG-08: inline svg without role/name/aria-hidden ------------------
    let svgs: Element[] = [];
    try {
      svgs = Array.from(queryAllIncludingRoot(ctx.root, "svg"));
    } catch {
      svgs = [];
    }
    for (let i = 0; i < svgs.length; i++) {
      if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
      const svg = svgs[i];
      if (!svg) continue;
      try {
        if (svg.closest("svg") !== svg) continue; // nested svg: judge the outermost only
        if (isExtensionElement(svg, ctx) || !ctx.isVisible(svg)) continue;
        if (svg.getAttribute("aria-hidden") === "true") continue;
        if (svg.closest("[aria-hidden='true']")) continue;
        const role = (svg.getAttribute("role") ?? "").trim();
        if (role) continue;
        if (hasSvgName(svg)) continue;
        if (insideNamedControl(svg)) continue;
        const rect = svg.getBoundingClientRect();
        findings.push({
          element: svg,
          type: SVG.type,
          severity: SVG.severity ?? "Moderate",
          description: `This inline <svg> (${Math.round(rect.width)}x${Math.round(rect.height)}px) has no role, no accessible name (<title>, aria-label or aria-labelledby) and no aria-hidden="true". If it conveys information it needs role="img" and a name; if it is decorative it should be hidden from assistive technology.`,
          data: { ruleId: SVG.id, width: Math.round(rect.width), height: Math.round(rect.height) },
          fix: {
            summary: "Add role=\"img\" plus aria-label or a <title> element for meaningful graphics; add aria-hidden=\"true\" (and focusable=\"false\") for decorative ones.",
            suggestedValue: "aria-hidden=\"true\"",
            docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html",
          },
        });
      } catch {
        // next
      }
    }

    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
