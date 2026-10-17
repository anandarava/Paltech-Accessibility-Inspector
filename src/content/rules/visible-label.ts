/**
 * Visible label rule.
 *
 * Emits:
 *  - FRM-11  a visible form field that has an accessible name but no label
 *            anyone can see (Semi, Moderate, WCAG 3.3.2 Labels or
 *            Instructions). The name comes only from aria-label, from a
 *            visually hidden <label>, or from aria-labelledby pointing at
 *            hidden text, so screen reader users hear a label that sighted
 *            users (including voice-control users) never see.
 *
 * Heuristics and their risks
 * --------------------------
 *  - Fields without any accessible name are FRM-01 (axe `label`), and fields
 *    named only by placeholder or title are FRM-02; both are skipped here.
 *  - "Visible" means rendered, larger than 1x1 px, not clipped away (the
 *    sr-only `clip: rect(0 0 0 0)` / `clip-path: inset(50%)` patterns) and
 *    not moved off screen. A label counts when it holds visible text other
 *    than the field itself.
 *  - Not flagged, because a visible label exists in practice:
 *      - a visible button directly beside a text field (WCAG technique G167,
 *        the "search box + Search button" pattern);
 *      - visible text near the field (up to three ancestor levels, under 200
 *        characters) that contains the accessible name, or is contained in
 *        it. Such text is a visible label even when it is not associated in
 *        code (that would be a 1.3.1 matter, not 3.3.2).
 *  - The result is Semi (needs review): a field can be labelled by a nearby
 *    icon, a heading or an image of text that this check cannot read.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { accessibleName, queryAllIncludingRoot } from "@src/content/dom-utils";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;
const PRIMARY = (() => {
  const d = RULES.find((r) => r.id === "FRM-11");
  if (!d) throw new Error("a11y-rules.json has no rule FRM-11");
  return d;
})();

const CHUNK = 100;
const NEARBY_TEXT_MAX = 200;
const NEARBY_LEVELS = 3;
const BUTTON_GAP_PX = 48;

const CONTROL_SELECTOR =
  "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image']), select, textarea, " +
  "[role='textbox'], [role='searchbox'], [role='combobox'], [role='listbox'], [role='spinbutton'], [role='slider'], [role='checkbox'], [role='radio'], [role='switch']";
const TEXT_LIKE_INPUTS = new Set(["", "text", "search", "email", "url", "tel", "number", "password"]);
const BUTTON_SELECTOR = "button, input[type='submit'], input[type='button'], input[type='image'], [role='button']";

function collapse(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function normalise(s: string): string {
  return collapse(s).toLowerCase().replace(/[:*]+$/, "").trim();
}

/** Rendered on screen: visible, bigger than 1x1 px, not clipped away and not moved off screen. */
export function isShown(el: Element, ctx: RuleContext): boolean {
  if (!ctx.isVisible(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return false;
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  if (view) {
    const pageRight = rect.right + view.scrollX;
    const pageBottom = rect.bottom + view.scrollY;
    if (pageRight <= 0 || pageBottom <= 0) return false;
  }
  for (let node: Element | null = el; node && node !== doc.body; node = node.parentElement) {
    const cs = (view ?? window).getComputedStyle(node);
    if (/^rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)$/.test(cs.clip)) return false;
    if (/^inset\(\s*(50|100)%/.test(cs.clipPath)) return false;
    if (cs.position === "absolute" || cs.position === "fixed") break; // sr-only patterns sit on the element itself
  }
  return true;
}

/** Text of `root` that is shown on screen, leaving out the subtree of `exclude`. */
function shownText(root: Element, exclude: Element | null, ctx: RuleContext): string {
  const parts: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || (exclude && exclude.contains(parent))) continue;
    if (parent.closest("select, option, script, style, template")) continue;
    if (!collapse(n.textContent)) continue;
    if (!isShown(parent, ctx)) continue;
    parts.push(n.textContent ?? "");
  }
  return collapse(parts.join(" "));
}

/** A <label> or aria-labelledby target with text that is shown on screen. */
function hasShownLabel(control: Element, ctx: RuleContext): boolean {
  const labels = (control as HTMLInputElement).labels;
  if (labels) {
    for (const label of Array.from(labels)) {
      if (shownText(label, control, ctx)) return true;
    }
  }
  const doc = control.ownerDocument;
  for (const id of (control.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)) {
    const ref = doc.getElementById(id);
    if (ref && ref !== control && shownText(ref, control, ctx)) return true;
  }
  return false;
}

function isTextLike(control: Element): boolean {
  const tag = control.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return TEXT_LIKE_INPUTS.has((control.getAttribute("type") ?? "").toLowerCase());
  const role = (control.getAttribute("role") ?? "").toLowerCase();
  return role === "textbox" || role === "searchbox" || role === "combobox";
}

/** WCAG technique G167: a visible, named button right beside a text field labels its purpose. */
function hasAdjacentButton(control: Element, ctx: RuleContext): boolean {
  if (!isTextLike(control)) return false;
  const box = control.getBoundingClientRect();
  const scope = control.parentElement?.parentElement ?? control.parentElement;
  if (!scope) return false;
  for (const button of Array.from(scope.querySelectorAll(BUTTON_SELECTOR))) {
    if (button === control || !isShown(button, ctx)) continue;
    let name = "";
    try {
      name = accessibleName(button).trim();
    } catch {
      name = "";
    }
    if (!name) continue;
    const b = button.getBoundingClientRect();
    const verticalOverlap = Math.min(box.bottom, b.bottom) - Math.max(box.top, b.top) > 0;
    const gap = b.left >= box.right ? b.left - box.right : box.left >= b.right ? box.left - b.right : 0;
    if (verticalOverlap && gap <= BUTTON_GAP_PX) return true;
  }
  return false;
}

/** Visible text near the field that carries the same words as its accessible name. */
function hasNearbyText(control: Element, name: string, ctx: RuleContext): boolean {
  const target = normalise(name);
  if (target.length < 2) return false;
  let node: Element | null = control.parentElement;
  for (let level = 0; node && level < NEARBY_LEVELS; level++, node = node.parentElement) {
    const nearby = normalise(shownText(node, control, ctx));
    if (nearby.length > NEARBY_TEXT_MAX) return false;
    if (!nearby) continue;
    if (nearby.includes(target) || (nearby.length >= 3 && target.includes(nearby))) return true;
  }
  return false;
}

/**
 * True when the name is author-provided: aria-label, a resolving aria-labelledby,
 * or a <label> with text. Anything else (option text of an unlabelled <select>,
 * content of a custom widget) is not a label, and an unlabelled field is FRM-01.
 */
function hasLabelSource(control: Element): boolean {
  if (collapse(control.getAttribute("aria-label"))) return true;
  const doc = control.ownerDocument;
  if (ids(control.getAttribute("aria-labelledby")).some((id) => collapse(doc.getElementById(id)?.textContent))) return true;
  const labels = (control as HTMLInputElement).labels;
  return !!labels && Array.from(labels).some((label) => collapse(label.textContent));
}

function ids(value: string | null): string[] {
  return (value ?? "").split(/\s+/).filter(Boolean);
}

/** Where the accessible name comes from, for the description. */
function nameSource(control: Element): string {
  if (collapse(control.getAttribute("aria-labelledby"))) return "aria-labelledby pointing at hidden text";
  if (collapse(control.getAttribute("aria-label"))) return "aria-label";
  return "a visually hidden label";
}

function describe(control: Element): string {
  const tag = control.tagName.toLowerCase();
  const role = control.getAttribute("role");
  if (role) return `${role} (<${tag}>)`;
  if (tag === "input") return `${control.getAttribute("type") || "text"} field`;
  return tag === "select" ? "drop-down" : tag === "textarea" ? "text area" : tag;
}

export const rule: CustomRule = {
  id: PRIMARY.id,
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Moderate",
  defaultFix: {
    summary: "Show a visible label with the field: a <label> element, or visible text referenced with aria-labelledby. If you keep aria-label, start it with the visible label text.",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    let controls: Element[] = [];
    try {
      controls = queryAllIncludingRoot(ctx.root, CONTROL_SELECTOR);
    } catch {
      return findings;
    }
    for (let i = 0; i < controls.length; i++) {
      if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
      const control = controls[i];
      if (!control) continue;
      try {
        if (ctx.isExtensionNode(control) || !isShown(control, ctx)) continue;
        let name = "";
        try {
          name = collapse(accessibleName(control));
        } catch {
          continue;
        }
        if (!name || !hasLabelSource(control)) continue; // no label at all: FRM-01
        if (control.localName === "button" && collapse(control.textContent)) continue; // a value-showing button (role=combobox) shows its text
        if (name === collapse(control.getAttribute("placeholder")) || name === collapse(control.getAttribute("aria-placeholder"))) continue; // FRM-02
        if (name === collapse(control.getAttribute("title"))) continue; // title-only: axe label-title-only (FRM-02)
        if (hasShownLabel(control, ctx)) continue;
        if (hasAdjacentButton(control, ctx)) continue;
        if (hasNearbyText(control, name, ctx)) continue;
        const source = nameSource(control);
        findings.push({
          element: control,
          type: PRIMARY.type,
          severity: PRIMARY.severity ?? "Moderate",
          description: `This ${describe(control)} is named "${name}" only by ${source}; no label is shown with it on screen. Screen reader users hear the name, but sighted users, including voice-control users who say the label to click, do not see it. Check that a visible label or instruction is present.`,
          data: { ruleId: PRIMARY.id, name, nameSource: source },
          fix: {
            summary: `Show "${name}" as a visible label: a <label> element, or visible text referenced with aria-labelledby. If you keep aria-label, start it with the visible label text.`,
            docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html",
          },
        });
      } catch {
        // next control
      }
    }
    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
