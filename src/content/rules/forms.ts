/**
 * Form rules.
 *
 * Emits:
 *  - FRM-02  placeholder is the only label (Auto, Serious)
 *  - FRM-03  radio/checkbox group with no group label (Auto, Moderate)
 *  - FRM-04  required field not indicated programmatically (Auto, Moderate)
 *  - FRM-05  error message not linked via aria-describedby/aria-errormessage (Semi, Serious)
 *  - FRM-06  field with a visible error lacks aria-invalid="true" (Semi, Moderate)
 *
 * Heuristics and their risks
 * --------------------------
 *  - FRM-02: axe's `label` rule accepts a non-empty placeholder as a name, so
 *    `<input placeholder="Department">` never reaches FRM-01, and axe's
 *    `label-title-only` (mapped to FRM-02 in a11y-rules.json) only covers
 *    title-only controls. This module fills the gap: a visible text-like
 *    control (text/search/email/url/tel/password/number input, textarea, or
 *    role=textbox|searchbox|combobox with placeholder/aria-placeholder) whose
 *    placeholder is non-empty and that has no <label> with text (for= or
 *    wrapping), no aria-label, no resolving aria-labelledby and no title is
 *    reported. Controls with a title are left to axe so they are not counted
 *    twice.
 *  - FRM-03: a "group" is >= 2 radio/checkbox inputs sharing a `name` inside
 *    the same form (or the same root when there is no form). The group is
 *    labelled when the members' nearest common ancestor, or one of its
 *    ancestors, is a <fieldset> with a non-empty <legend> (or aria-label /
 *    resolving aria-labelledby), or a `role=group|radiogroup` with a
 *    non-empty aria-label or an aria-labelledby that resolves to text.
 *    group/radiogroup are name-from-author roles, so their text content is
 *    deliberately NOT treated as a name (it would be the members' labels).
 *    A <table>/<tr> row scheme is not considered (data tables of checkboxes
 *    will be flagged). A single "accept terms" checkbox is not a group and
 *    is never flagged.
 *  - FRM-04: the field's label text (from <label>, aria-labelledby or the
 *    accessible name) contains "*" or the word "required" but the control
 *    has neither `required` nor `aria-required="true"`. Labels that use a
 *    star for something else ("*price includes VAT") are a false-positive
 *    risk; a required indicator placed outside the label is a false negative.
 *  - FRM-05/06: "error elements" are visible elements with role=alert, or a
 *    class/id containing error/invalid, that hold a short text and no form
 *    controls. The associated field is the nearest control in the same
 *    container searched outwards up to four levels (looking backwards in
 *    DOM order first, as messages usually follow the field). Both findings
 *    are Semi because the linkage may exist through a live region or the
 *    "error" element may be a static hint. Skipped when the element carries
 *    the text "no error(s)".
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { accessibleName } from "@src/content/dom-utils";
import { isExtensionElement } from "./contrast";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const PRIMARY = ruleDef("FRM-03");
const PLACEHOLDER = ruleDef("FRM-02");
const REQUIRED = ruleDef("FRM-04");
const ERROR_LINK = ruleDef("FRM-05");
const INVALID = ruleDef("FRM-06");
const CHUNK = 100;

const CONTROL_SELECTOR = "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image']), select, textarea, [role='textbox'], [role='combobox'], [role='listbox'], [role='spinbutton'], [role='slider']";
const ERROR_SELECTOR = "[role='alert'], .error, [class*='error'], [class*='Error'], [id*='error'], [id*='Error'], [class*='invalid'], [id*='invalid']";
const NO_ERROR_RE = /^\s*no\s+errors?\b/i;

function docOf(root: Document | Element): Document {
  return root.ownerDocument ?? (root as Document);
}

function text(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function idRefsText(el: Element, attr: string, doc: Document): string {
  const refs = el.getAttribute(attr);
  if (!refs) return "";
  return refs
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => text(doc.getElementById(id)))
    .join(" ");
}

// ---------------------------------------------------------------------------
// FRM-03
// ---------------------------------------------------------------------------

function commonAncestor(elements: Element[]): Element | null {
  let ancestor: Element | null = elements[0]?.parentElement ?? null;
  while (ancestor) {
    const a: Element = ancestor;
    if (elements.every((e) => a.contains(e))) return a;
    ancestor = a.parentElement;
  }
  return null;
}

/**
 * Text an aria-labelledby reference contributes: aria-label, a control's
 * value, or its text content. Ids that do not resolve contribute nothing.
 */
function labelledByText(el: Element, doc: Document): string {
  const refs = el.getAttribute("aria-labelledby");
  if (!refs) return "";
  return refs
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => {
      const ref = doc.getElementById(id);
      if (!ref) return "";
      const ariaLabel = (ref.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      if (ariaLabel) return ariaLabel;
      if (ref instanceof HTMLInputElement || ref instanceof HTMLTextAreaElement) return ref.value.replace(/\s+/g, " ").trim();
      if (ref instanceof HTMLSelectElement) return text(ref.selectedOptions[0] ?? null);
      return text(ref);
    })
    .filter(Boolean)
    .join(" ");
}

/** True when the element is labelled by author: non-empty aria-label or a resolving aria-labelledby. */
function hasAuthorName(el: Element, doc: Document): boolean {
  if ((el.getAttribute("aria-label") ?? "").trim()) return true;
  return labelledByText(el, doc).length > 0;
}

/**
 * Whether `el` provides an accessible group name for the controls inside it.
 * <fieldset>: non-empty <legend>, aria-label or resolving aria-labelledby.
 * role=group|radiogroup: aria-label or resolving aria-labelledby only. These
 * roles do not take their name from content, so text inside the wrapper (which
 * is just the members' own labels) must not count.
 */
function hasGroupLabel(el: Element): boolean {
  const doc = el.ownerDocument;
  if (el.tagName === "FIELDSET") {
    const legend = Array.from(el.children).find((c) => c.tagName === "LEGEND");
    if (legend && text(legend)) return true;
    if (hasAuthorName(el, doc)) return true;
  }
  const role = (el.getAttribute("role") ?? "").trim().toLowerCase();
  if (role === "group" || role === "radiogroup") {
    if (hasAuthorName(el, doc)) return true;
  }
  return false;
}

async function checkGroups(ctx: RuleContext, findings: RuleFinding[]): Promise<void> {
  const inputs = Array.from(ctx.root.querySelectorAll("input[type='radio'][name], input[type='checkbox'][name]")) as HTMLInputElement[];
  const groups = new Map<string, HTMLInputElement[]>();
  for (let i = 0; i < inputs.length; i++) {
    if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
    const input = inputs[i];
    if (!input) continue;
    try {
      if (isExtensionElement(input, ctx) || !ctx.isVisible(input)) continue;
      const name = input.name.trim();
      if (!name) continue;
      const formKey = input.form ? (input.form.id || input.form.getAttribute("name") || "form") + "@" + Array.from(docOf(ctx.root).forms).indexOf(input.form) : "noform";
      const key = `${input.type}|${formKey}|${name}`;
      const list = groups.get(key);
      if (list) list.push(input);
      else groups.set(key, [input]);
    } catch {
      // next
    }
  }
  for (const [key, members] of groups) {
    try {
      if (members.length < 2) continue;
      const first = members[0];
      if (!first) continue;
      let ancestor = commonAncestor(members);
      let labelled = false;
      while (ancestor && ancestor !== docOf(ctx.root).documentElement) {
        if (hasGroupLabel(ancestor)) {
          labelled = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (labelled) continue;
      const type = first.type;
      findings.push({
        element: first,
        type: PRIMARY.type,
        severity: PRIMARY.severity ?? "Moderate",
        description: `${members.length} ${type} inputs named "${first.name}" form a group, but no <fieldset> with a <legend> or role="group"/"radiogroup" with an accessible name wraps them, so the question they answer is not announced.`,
        data: { ruleId: PRIMARY.id, groupName: first.name, inputType: type, memberCount: members.length, groupKey: key },
        fix: {
          summary: "Wrap the group in <fieldset> with a <legend> that states the question, or use role=\"group\"/\"radiogroup\" with aria-labelledby pointing at the visible heading.",
          suggestedValue: `<fieldset><legend>\u2026</legend> \u2026 </fieldset>`,
          docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html",
        },
      });
    } catch {
      // next group
    }
  }
}

// ---------------------------------------------------------------------------
// FRM-02
// ---------------------------------------------------------------------------

const PLACEHOLDER_SELECTOR =
  "input[placeholder]:not([type]), input[placeholder][type='text'], input[placeholder][type='search'], input[placeholder][type='email'], input[placeholder][type='url'], input[placeholder][type='tel'], input[placeholder][type='password'], input[placeholder][type='number'], textarea[placeholder], [role='textbox'][placeholder], [role='textbox'][aria-placeholder], [role='searchbox'][placeholder], [role='searchbox'][aria-placeholder], [role='combobox'][placeholder], [role='combobox'][aria-placeholder]";

/** A <label> counts when it has text or an image/labelled child (an empty <label> names nothing). */
function labelHasContent(label: Element): boolean {
  if (text(label)) return true;
  return label.querySelector("img[alt]:not([alt='']), [aria-label]:not([aria-label=''])") !== null;
}

/** True when a control has a real label other than its placeholder (or a title, which axe already reports). */
function hasNonPlaceholderLabel(control: Element, doc: Document): boolean {
  if (hasAuthorName(control, doc)) return true;
  if ((control.getAttribute("title") ?? "").trim()) return true; // axe label-title-only -> FRM-02
  const labels = (control as HTMLInputElement).labels;
  if (labels && Array.from(labels).some(labelHasContent)) return true;
  // Non-labelable ARIA widgets: a wrapping <label> is still a visible label.
  const wrapping = control.closest("label");
  if (wrapping && labelHasContent(wrapping)) return true;
  return false;
}

async function checkPlaceholderOnly(ctx: RuleContext, findings: RuleFinding[]): Promise<void> {
  const doc = docOf(ctx.root);
  let controls: Element[] = [];
  try {
    controls = Array.from(ctx.root.querySelectorAll(PLACEHOLDER_SELECTOR));
  } catch {
    return;
  }
  for (let i = 0; i < controls.length; i++) {
    if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
    const control = controls[i];
    if (!control) continue;
    try {
      if (isExtensionElement(control, ctx) || !ctx.isVisible(control)) continue;
      const placeholder = (control.getAttribute("placeholder") ?? control.getAttribute("aria-placeholder") ?? "").replace(/\s+/g, " ").trim();
      if (!placeholder) continue;
      if (hasNonPlaceholderLabel(control, doc)) continue;
      findings.push({
        element: control,
        type: PLACEHOLDER.type,
        severity: PLACEHOLDER.severity ?? "Serious",
        description: `The placeholder "${placeholder.length > 80 ? `${placeholder.slice(0, 79)}…` : placeholder}" is the only label for this ${control.tagName.toLowerCase()}. Placeholder text disappears once a value is typed, is often low-contrast and is not reliably announced as a label, so the field needs a persistent label.`,
        data: { ruleId: PLACEHOLDER.id, placeholder },
        fix: {
          summary: "Add a visible <label for=\"…\"> (or aria-labelledby pointing at visible text) that names the field; keep the placeholder only as an example value.",
          suggestedValue: `<label for="${control.id || "field-id"}">${placeholder}</label>`,
          docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html",
        },
      });
    } catch {
      // next
    }
  }
}

// ---------------------------------------------------------------------------
// FRM-04
// ---------------------------------------------------------------------------

function labelTextFor(control: Element, doc: Document): string {
  const parts: string[] = [];
  const labels = (control as HTMLInputElement).labels;
  if (labels) for (const l of Array.from(labels)) parts.push(text(l));
  parts.push(idRefsText(control, "aria-labelledby", doc));
  parts.push(control.getAttribute("aria-label") ?? "");
  if (parts.every((p) => !p.trim())) {
    try {
      parts.push(accessibleName(control));
    } catch {
      // ignore
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const REQUIRED_TEXT_RE = /(^|[\s(])required\b|\*|\(mandatory\)|\bmandatory\b/i;

function isProgrammaticallyRequired(control: Element): boolean {
  if (control.hasAttribute("required")) return true;
  return (control.getAttribute("aria-required") ?? "").trim().toLowerCase() === "true";
}

async function checkRequired(ctx: RuleContext, findings: RuleFinding[]): Promise<void> {
  const doc = docOf(ctx.root);
  const controls = Array.from(ctx.root.querySelectorAll(CONTROL_SELECTOR));
  for (let i = 0; i < controls.length; i++) {
    if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
    const control = controls[i];
    if (!control) continue;
    try {
      if (isExtensionElement(control, ctx) || !ctx.isVisible(control)) continue;
      if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) continue; // group-level semantics
      if (isProgrammaticallyRequired(control)) continue;
      const label = labelTextFor(control, doc);
      if (!label) continue;
      if (!REQUIRED_TEXT_RE.test(label)) continue;
      if (/\boptional\b/i.test(label)) continue;
      findings.push({
        element: control,
        type: REQUIRED.type,
        severity: REQUIRED.severity ?? "Moderate",
        description: `The label "${label.length > 80 ? `${label.slice(0, 79)}\u2026` : label}" indicates the field is required, but the control has neither the required attribute nor aria-required="true", so assistive technology does not announce it as required.`,
        data: { ruleId: REQUIRED.id, label },
        fix: {
          summary: "Add the required attribute (or aria-required=\"true\" for custom widgets) to the control so the requirement is exposed programmatically.",
          suggestedValue: "required",
          docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html",
        },
      });
    } catch {
      // next
    }
  }
}

// ---------------------------------------------------------------------------
// FRM-05 / FRM-06
// ---------------------------------------------------------------------------

/** Find the form control an error message most likely belongs to. */
function associatedControl(error: Element, ctx: RuleContext): Element | null {
  // Explicit reverse links: any control that references this error by id.
  if (error.id) {
    try {
      const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(error.id) : error.id.replace(/["\\]/g, "\\$&");
      const linked = ctx.root.querySelector(`[aria-describedby~="${esc}"], [aria-errormessage~="${esc}"]`);
      if (linked) return linked;
    } catch {
      // ignore
    }
  }
  let container: Element | null = error.parentElement;
  for (let depth = 0; container && depth < 4; depth++) {
    const controls = Array.from(container.querySelectorAll(CONTROL_SELECTOR)).filter((c) => !isExtensionElement(c, ctx) && ctx.isVisible(c));
    if (controls.length > 0) {
      // Prefer the last control that precedes the message in DOM order.
      let best: Element | null = null;
      for (const c of controls) {
        const pos = c.compareDocumentPosition(error);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) best = c; // c precedes error
      }
      return best ?? controls[0] ?? null;
    }
    if (container.tagName === "FORM") break;
    container = container.parentElement;
  }
  return null;
}

function referencesId(control: Element, attr: string, id: string): boolean {
  const refs = control.getAttribute(attr);
  if (!refs) return false;
  return refs.split(/\s+/).includes(id);
}

async function checkErrors(ctx: RuleContext, findings: RuleFinding[]): Promise<void> {
  let candidates: Element[] = [];
  try {
    candidates = Array.from(ctx.root.querySelectorAll(ERROR_SELECTOR));
  } catch {
    return;
  }
  const reportedLink = new Set<Element>();
  const reportedInvalid = new Set<Element>();
  for (let i = 0; i < candidates.length; i++) {
    if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
    const error = candidates[i];
    if (!error) continue;
    try {
      if (isExtensionElement(error, ctx) || !ctx.isVisible(error)) continue;
      if (error.matches(CONTROL_SELECTOR) || error.tagName === "FORM" || error.tagName === "LABEL" || error.tagName === "BUTTON" || error.tagName === "A") continue;
      if (error.querySelector(CONTROL_SELECTOR)) continue; // container, not a message
      if (error.querySelector(ERROR_SELECTOR)) continue; // let the inner message be judged
      const message = text(error);
      if (!message || message.length > 240) continue;
      if (NO_ERROR_RE.test(message)) continue;
      const control = associatedControl(error, ctx);
      if (!control) continue;

      const linked =
        (error.id && (referencesId(control, "aria-describedby", error.id) || referencesId(control, "aria-errormessage", error.id))) ||
        // The message may live inside an element that is referenced.
        Array.from(error.parentElement ? [error.parentElement] : []).some((p) => p.id && referencesId(control, "aria-describedby", p.id));

      if (!linked && !reportedLink.has(control)) {
        reportedLink.add(control);
        findings.push({
          element: control,
          type: ERROR_LINK.type,
          severity: ERROR_LINK.severity ?? "Serious",
          description: `The message "${message.length > 80 ? `${message.slice(0, 79)}\u2026` : message}" looks like an error for this ${control.tagName.toLowerCase()} but is not referenced by aria-describedby or aria-errormessage${error.id ? "" : " (the message has no id)"}. Confirm it is an error message and link it.`,
          data: { ruleId: ERROR_LINK.id, message, errorElementId: error.id || null, errorElementTag: error.tagName.toLowerCase() },
          fix: {
            summary: "Give the error message an id and reference it from the field with aria-describedby (or aria-errormessage together with aria-invalid=\"true\").",
            suggestedValue: `aria-describedby="${error.id || "field-error"}"`,
            docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html",
          },
        });
      }

      const ariaInvalid = (control.getAttribute("aria-invalid") ?? "").trim().toLowerCase();
      if (ariaInvalid !== "true" && ariaInvalid !== "grammar" && ariaInvalid !== "spelling" && !reportedInvalid.has(control)) {
        reportedInvalid.add(control);
        findings.push({
          element: control,
          type: INVALID.type,
          severity: INVALID.severity ?? "Moderate",
          description: `A visible error message ("${message.length > 80 ? `${message.slice(0, 79)}\u2026` : message}") is shown for this ${control.tagName.toLowerCase()} but it does not carry aria-invalid="true", so screen readers do not announce the field as invalid. Confirm the field is currently in an error state.`,
          data: { ruleId: INVALID.id, message, ariaInvalid: ariaInvalid || null },
          fix: {
            summary: "Set aria-invalid=\"true\" on the field while it is in error and remove it once the value is valid.",
            suggestedValue: "aria-invalid=\"true\"",
            docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html",
          },
        });
      }
    } catch {
      // next
    }
  }
}

// ---------------------------------------------------------------------------

export const rule: CustomRule = {
  id: PRIMARY.id,
  emits: [PLACEHOLDER.id, REQUIRED.id, ERROR_LINK.id, INVALID.id],
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Moderate",
  defaultFix: {
    summary: "Group related radio buttons and checkboxes with <fieldset>/<legend> and expose required and error states programmatically.",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    const steps: Array<(c: RuleContext, f: RuleFinding[]) => Promise<void>> = [checkGroups, checkPlaceholderOnly, checkRequired, checkErrors];
    for (let i = 0; i < steps.length; i++) {
      try {
        await steps[i]?.(ctx, findings);
      } catch {
        // one failing sub-check must not hide the others
      }
      ctx.progress?.(Math.round(((i + 1) / steps.length) * 100));
      await ctx.yieldToMain();
    }
    return findings;
  },
};

export default rule;
