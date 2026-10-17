/**
 * ARIA checks stricter than axe-core.
 *
 * Emits:
 *  - ARIA-02  aria-label / aria-labelledby on an element whose role cannot be
 *             named: a div, span, p and similar with no role. ARIA 1.2 forbids
 *             naming these roles and screen readers may drop the name. axe-core
 *             reports this only as "incomplete". (Auto; Serious when the
 *             element is focusable, as its name is then lost entirely,
 *             otherwise Moderate)
 *  - ARIA-03  an ARIA id reference naming ids that do not exist, when other
 *             ids in the same attribute do (axe-core only fails an attribute
 *             when none of its ids resolve). aria-labelledby: Auto, the name
 *             is incomplete. aria-describedby / -controls / -owns / -flowto /
 *             -details: Semi, because ids are often added later on purpose
 *             (an error message that appears on submit).
 *  - STR-08   an id referenced by ARIA or <label for> that more than one
 *             element carries, so the reference may resolve to the wrong one
 *             (axe-core reports duplicate-id-aria only as "incomplete").
 *             Reported on every element with that id. (Auto, Serious)
 *
 * When axe-core reports the same element under the same project rule as
 * "incomplete", the definite finding here replaces it (dedupeIssues).
 * Only the document (or the scanned subtree) is searched; ids inside shadow
 * roots are scoped to their root and are not compared with the document.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { getFocusableElements, queryAllIncludingRoot } from "@src/content/dom-utils";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const NAMING = ruleDef("ARIA-02");
const REFERENCE = ruleDef("ARIA-03");
const DUPLICATE = ruleDef("STR-08");
const CHUNK = 200;

/** Elements whose implicit role (generic, paragraph, emphasis, strong, code...) cannot be named. */
const UNNAMEABLE_TAGS = new Set(["div", "span", "p", "b", "i", "u", "s", "small", "em", "strong", "code", "pre", "sub", "sup", "del", "ins", "data", "bdi", "bdo", "q", "samp", "kbd", "var"]);
/** ID-reference attributes checked for partly broken references. */
const REFERENCE_ATTRS = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-flowto", "aria-details"] as const;
/** All attributes that point at ids, for the duplicate-id check. */
const ID_REFERENCE_ATTRS = [...REFERENCE_ATTRS, "aria-activedescendant", "aria-errormessage"] as const;

function ids(value: string | null): string[] {
  return (value ?? "").split(/\s+/).filter(Boolean);
}

function snippet(el: Element): string {
  return `<${el.tagName.toLowerCase()}>`;
}

function namingFindings(el: Element, focusable: Set<Element>, doc: Document): RuleFinding | null {
  if (!UNNAMEABLE_TAGS.has(el.tagName.toLowerCase())) return null;
  if ((el.getAttribute("role") ?? "").trim()) return null; // explicit roles are axe-core's aria-prohibited-attr
  const label = (el.getAttribute("aria-label") ?? "").trim();
  const labelledBy = ids(el.getAttribute("aria-labelledby")).filter((id) => doc.getElementById(id));
  if (!label && labelledBy.length === 0) return null;
  const attr = label ? `aria-label="${label}"` : `aria-labelledby="${el.getAttribute("aria-labelledby")}"`;
  const isFocusable = focusable.has(el);
  return {
    element: el,
    type: NAMING.type,
    severity: isFocusable ? "Serious" : "Moderate",
    description: `This ${snippet(el)} has ${attr}, but a ${el.tagName.toLowerCase()} without a role cannot be named: ARIA forbids it and screen readers may ignore the label${isFocusable ? ". The element is focusable, so keyboard and screen reader users may reach it with no name at all" : ""}.`,
    data: { ruleId: NAMING.id, attribute: label ? "aria-label" : "aria-labelledby", focusable: isFocusable },
    fix: {
      summary: "Give the element a role that can be named (for example role=\"region\", \"group\" or \"navigation\", or use <nav> or <section>), or remove the label and show the text on the page.",
      docsUrl: "https://www.w3.org/TR/wai-aria-1.2/#prohibitedattributes",
    },
  };
}

/** aria-label holding HTML markup (a template bug): screen readers read the tags out. */
function markupInLabel(el: Element): RuleFinding | null {
  const label = el.getAttribute("aria-label") ?? "";
  if (!/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(label)) return null;
  return {
    element: el,
    type: REFERENCE.type,
    severity: "Serious",
    description: `The aria-label of this ${snippet(el)} contains HTML markup ("${label.length > 80 ? `${label.slice(0, 79)}…` : label}"), so screen readers announce the tags and attributes as part of its name.`,
    data: { ruleId: REFERENCE.id, attribute: "aria-label", markup: true },
    fix: { summary: "Put plain text in aria-label (the visible link text), or remove aria-label and let the element's content name it.", docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html" },
  };
}

function referenceFindings(el: Element, doc: Document): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const attr of REFERENCE_ATTRS) {
    const refs = ids(el.getAttribute(attr));
    if (refs.length < 2) continue; // a single missing id is axe-core's aria-valid-attr-value
    const missing = refs.filter((id) => !doc.getElementById(id));
    if (missing.length === 0 || missing.length === refs.length) continue; // none missing, or all missing (axe-core)
    if (attr === "aria-controls" && el.getAttribute("aria-expanded") === "false") continue; // collapsed panels render later
    const definite = attr === "aria-labelledby";
    out.push({
      element: el,
      type: definite ? REFERENCE.type : "Semi",
      severity: definite ? "Serious" : "Moderate",
      description: `${attr} on this ${snippet(el)} references ${missing.map((id) => `"${id}"`).join(", ")}, which ${missing.length === 1 ? "does" : "do"} not exist on the page${definite ? ", so its accessible name is incomplete" : ". If the element is added later (for example an error message), this is fine; otherwise the reference is broken"}.`,
      data: { ruleId: REFERENCE.id, attribute: attr, missing, present: refs.filter((id) => !missing.includes(id)) },
      fix: {
        summary: `Remove ${missing.map((id) => `"${id}"`).join(", ")} from ${attr}, or give the intended element that id.`,
        docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html",
      },
    });
  }
  return out;
}

export const rule: CustomRule = {
  id: NAMING.id,
  emits: [REFERENCE.id, DUPLICATE.id],
  title: "ARIA checks stricter than axe-core",
  category: NAMING.category,
  wcag: NAMING.wcag,
  type: NAMING.type,
  severity: NAMING.severity ?? "Serious",
  defaultFix: {
    summary: "Use ARIA only as the specification allows, and make every ARIA id reference point at exactly one existing element.",
    docsUrl: "https://www.w3.org/TR/wai-aria-1.2/",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
    let elements: Element[] = [];
    try {
      elements = queryAllIncludingRoot(ctx.root, "[aria-label], [aria-labelledby], [aria-describedby], [aria-controls], [aria-owns], [aria-flowto], [aria-details], [aria-activedescendant], [aria-errormessage], label[for]");
    } catch {
      return findings;
    }
    let focusable = new Set<Element>();
    try {
      focusable = new Set(getFocusableElements(ctx.root));
    } catch {
      // treat nothing as focusable
    }

    // Ids referenced by ARIA or <label for>, with one referencing element each for the description.
    const referenced = new Map<string, { by: Element; attr: string }>();
    for (let i = 0; i < elements.length; i++) {
      if (i > 0 && i % CHUNK === 0) await ctx.yieldToMain();
      const el = elements[i];
      if (!el || ctx.isExtensionNode(el)) continue;
      try {
        for (const attr of ID_REFERENCE_ATTRS) for (const id of ids(el.getAttribute(attr))) if (!referenced.has(id)) referenced.set(id, { by: el, attr });
        if (el.tagName.toLowerCase() === "label") {
          const id = (el.getAttribute("for") ?? "").trim();
          if (id && !referenced.has(id)) referenced.set(id, { by: el, attr: "for" });
        }
        if (!ctx.isVisible(el)) continue;
        const named = namingFindings(el, focusable, doc);
        if (named) findings.push(named);
        findings.push(...referenceFindings(el, doc));
        const markup = markupInLabel(el);
        if (markup) findings.push(markup);
      } catch {
        // next element
      }
    }

    // STR-08: a referenced id carried by more than one element.
    const counts = new Map<string, Element[]>();
    for (const el of Array.from(doc.querySelectorAll("[id]"))) {
      if (ctx.isExtensionNode(el)) continue;
      const id = el.id;
      if (!referenced.has(id)) continue;
      const list = counts.get(id);
      if (list) list.push(el);
      else counts.set(id, [el]);
    }
    for (const [id, owners] of counts) {
      if (owners.length < 2) continue;
      const ref = referenced.get(id);
      if (!ref) continue;
      for (const owner of owners) {
        if (ctx.root !== doc && !(ctx.root as Element).contains(owner)) continue;
        findings.push({
          element: owner,
          type: DUPLICATE.type,
          severity: "Serious",
          description: `The id "${id}" is used by ${owners.length} elements, and ${ref.attr === "for" ? "a <label for>" : ref.attr} on a ${snippet(ref.by)} refers to it. The reference resolves to the first one, which may not be the element meant.`,
          data: { ruleId: DUPLICATE.id, id, count: owners.length, referencedBy: ref.attr },
          fix: {
            summary: `Give each element a unique id, and point ${ref.attr === "for" ? "the label" : ref.attr} at the right one.`,
            docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html",
          },
        });
      }
    }

    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
