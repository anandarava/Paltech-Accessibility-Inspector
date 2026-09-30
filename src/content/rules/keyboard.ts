/**
 * Keyboard operability rules.
 *
 * Emits:
 *  - KBD-01  clickable element not keyboard focusable (Auto, Critical; the
 *            `cursor: pointer`-only signal is reported as Semi)
 *  - KBD-08  open dialog that does not contain the focus (Semi, Serious)
 *
 * Heuristics and their risks
 * --------------------------
 *  - "Clickable" is inferred from: an `onclick` attribute, an interactive
 *    ARIA role (button, link, menuitem, tab, checkbox, radio, switch, option,
 *    treeitem), a `data-*click*` attribute (common in framework markup), or
 *    `cursor: pointer` set on the element itself (not inherited from its
 *    parent). Listeners added with addEventListener are invisible to content
 *    scripts, so JS-only click handlers on plain divs are missed unless they
 *    also set a pointer cursor (false negative), and a pointer cursor used
 *    for decoration produces a false positive; that is why pointer-only
 *    findings are Semi.
 *  - "Focusable" means: native focusable element (link with href, enabled
 *    button/input/select/textarea, summary, iframe, contenteditable, media
 *    with controls), or a tabindex attribute, or a focusable descendant (the
 *    inner control is what receives focus), or a focusable ancestor (a span
 *    inside a button). <label> is skipped because clicking it focuses its
 *    control; <option> and <summary> are skipped as natively operable.
 *  - Composite widgets: option/menuitem/treeitem/tab/gridcell elements are
 *    expected NOT to be focusable when a composite widget manages focus with
 *    `aria-activedescendant` (combobox + listbox as in MUI Autocomplete,
 *    React-Select, downshift; menus and trees using activedescendant). Such an
 *    element is skipped when its id is referenced by any
 *    `[aria-activedescendant]`, or when its closest listbox/menu/menubar/tree/
 *    tablist/grid container is focusable, carries `aria-activedescendant`, or
 *    is referenced by `aria-controls`/`aria-owns` of a focusable element (the
 *    attribute is often only set while an option is highlighted). A role-only
 *    finding inside such a container without any of that evidence is
 *    downgraded to Semi, because roving focus may be assigned at runtime.
 *  - KBD-08 looks at `[role=dialog]`, `[role=alertdialog]` and `<dialog open>`
 *    that are visible and not aria-hidden. Non-modal dialogs that open on
 *    load (cookie banners) and dialogs the tester opened before scanning may
 *    legitimately not hold focus, hence Semi.
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

const PRIMARY = ruleDef("KBD-01");
const DIALOG = ruleDef("KBD-08");
const CHUNK = 200;
const MAX_ELEMENTS = 15000;

const INTERACTIVE_ROLES = new Set(["button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "checkbox", "radio", "switch", "option", "treeitem"]);
const NATIVE_FOCUSABLE = "a[href], area[href], button, input:not([type='hidden']), select, textarea, summary, iframe, object, embed, audio[controls], video[controls], [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']";
const FOCUSABLE = `${NATIVE_FOCUSABLE}, [tabindex]`;
/** Roles whose focus is normally managed by a composite parent (listbox, menu, tree, tablist, grid). */
const COMPOSITE_CHILD_ROLES = new Set(["option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "treeitem", "gridcell", "row", "columnheader", "rowheader"]);
const COMPOSITE_CONTAINER = "[role='listbox'], [role='menu'], [role='menubar'], [role='tree'], [role='treegrid'], [role='tablist'], [role='grid'], [role='combobox'], [role='radiogroup']";
const SKIP_TAGS = new Set(["HTML", "BODY", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "LABEL", "OPTION", "SUMMARY", "SVG", "PATH", "G", "USE", "BR", "WBR"]);

function hasDataClickAttribute(el: Element): boolean {
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-") && /click|tap|press/i.test(attr.name)) return true;
  }
  return false;
}

function isDisabled(el: Element): boolean {
  return el.matches(":disabled") || (el.getAttribute("aria-disabled") ?? "").toLowerCase() === "true";
}

function isFocusable(el: Element): boolean {
  if (el.hasAttribute("tabindex")) {
    const t = parseInt(el.getAttribute("tabindex") ?? "", 10);
    if (Number.isFinite(t)) return true;
  }
  if (el.matches(NATIVE_FOCUSABLE) && !isDisabled(el)) return true;
  return false;
}

/** Ids referenced by attributes that mark a composite widget as managing focus for other elements. */
interface CompositeRefs {
  /** Ids named by any `aria-activedescendant` in the document. */
  activeDescendant: Set<string>;
  /** Ids named by `aria-controls` / `aria-owns` of a focusable element (e.g. a combobox input). */
  controlledByFocusable: Set<string>;
}

function collectCompositeRefs(root: ParentNode): CompositeRefs {
  const refs: CompositeRefs = { activeDescendant: new Set(), controlledByFocusable: new Set() };
  try {
    for (const el of Array.from(root.querySelectorAll("[aria-activedescendant]"))) {
      const id = (el.getAttribute("aria-activedescendant") ?? "").trim();
      if (id) refs.activeDescendant.add(id);
    }
    for (const el of Array.from(root.querySelectorAll("[aria-controls], [aria-owns]"))) {
      if (!isFocusable(el) && !el.closest(FOCUSABLE)) continue;
      const ids = `${el.getAttribute("aria-controls") ?? ""} ${el.getAttribute("aria-owns") ?? ""}`.split(/\s+/);
      for (const id of ids) if (id) refs.controlledByFocusable.add(id);
    }
  } catch {
    // partial refs are still useful
  }
  return refs;
}

type CompositeStatus = "none" | "managed" | "unmanaged";

/**
 * Classifies an element with a composite-child role: "managed" when a composite
 * widget demonstrably owns its focus (aria-activedescendant or a focusable
 * controller), "unmanaged" when it sits in a composite container without that
 * evidence, "none" when it is not inside a composite container at all.
 */
function compositeStatus(el: Element, role: string, refs: CompositeRefs): CompositeStatus {
  const id = el.id;
  if (id && (refs.activeDescendant.has(id) || refs.controlledByFocusable.has(id))) return "managed";
  if (!COMPOSITE_CHILD_ROLES.has(role)) return "none";
  if (el.closest("[aria-activedescendant]")) return "managed";
  const container = el.parentElement?.closest(COMPOSITE_CONTAINER) ?? null;
  if (!container) return "none";
  if (isFocusable(container)) return "managed";
  if (container.hasAttribute("aria-activedescendant")) return "managed";
  if (container.id && refs.controlledByFocusable.has(container.id)) return "managed";
  // Nested composites (listbox inside a combobox wrapper, group inside a tree): check outer containers too.
  let outer = container.parentElement?.closest(COMPOSITE_CONTAINER) ?? null;
  while (outer) {
    if (isFocusable(outer) || outer.hasAttribute("aria-activedescendant") || (outer.id && refs.controlledByFocusable.has(outer.id))) return "managed";
    outer = outer.parentElement?.closest(COMPOSITE_CONTAINER) ?? null;
  }
  return "unmanaged";
}

export const rule: CustomRule = {
  id: PRIMARY.id,
  emits: [DIALOG.id],
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Critical",
  defaultFix: {
    summary: "Use a native <button> or <a href>, or add tabindex=\"0\", an appropriate role and Enter/Space key handling to the element.",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
    const view = doc.defaultView ?? window;

    // --- KBD-01 ---------------------------------------------------------------
    let all: Element[] = [];
    try {
      all = Array.from(ctx.root.querySelectorAll("*")).slice(0, MAX_ELEMENTS);
    } catch {
      all = [];
    }
    const reported = new Set<Element>();
    const compositeRefs = collectCompositeRefs(ctx.root);
    for (let i = 0; i < all.length; i++) {
      if (i > 0 && i % CHUNK === 0) {
        await ctx.yieldToMain();
        ctx.progress?.(Math.round((i / all.length) * 90));
      }
      const el = all[i];
      if (!el) continue;
      try {
        if (SKIP_TAGS.has(el.tagName.toUpperCase())) continue;
        if (el.closest("svg")) continue;
        if (isExtensionElement(el, ctx)) continue;

        const role = (el.getAttribute("role") ?? "").trim().toLowerCase();
        const hasOnclick = el.hasAttribute("onclick");
        const hasRole = INTERACTIVE_ROLES.has(role);
        const hasDataClick = hasDataClickAttribute(el);
        let pointerOwn = false;
        let signals: string[] = [];
        if (hasOnclick) signals.push("onclick attribute");
        if (hasRole) signals.push(`role="${role}"`);
        if (hasDataClick) signals.push("data-*click attribute");
        if (signals.length === 0) {
          // Cheap pre-filter before getComputedStyle: elements with no children of their own text are rarely clickable containers.
          const cs = view.getComputedStyle(el);
          if (cs.cursor !== "pointer") continue;
          const parent = el.parentElement;
          const parentCursor = parent ? view.getComputedStyle(parent).cursor : "";
          if (parentCursor === "pointer") continue; // inherited from a clickable ancestor
          pointerOwn = true;
          signals = ["cursor: pointer"];
        }
        if (!ctx.isVisible(el)) continue;
        if (isDisabled(el)) continue;
        if (isFocusable(el)) continue;
        if (el.closest(FOCUSABLE) && el.closest(FOCUSABLE) !== el) continue; // focusable ancestor operates it
        if (el.querySelector(FOCUSABLE)) continue; // focusable descendant operates it
        if (el.querySelector("[onclick], [role='button'], [role='link']")) continue; // inner clickable is the real control
        // Composite widgets (combobox/listbox, menu, tree, tablist, grid) manage focus for their children via
        // aria-activedescendant or a focusable container; non-focusable options/items are then the correct pattern.
        const composite = compositeStatus(el, role, compositeRefs);
        if (composite === "managed") continue;
        const inComposite = hasRole && !pointerOwn && composite === "unmanaged";
        // A pointer cursor on a large container (cards, rows) usually wraps a real link; only flag leaf-ish elements.
        if (pointerOwn && el.getElementsByTagName("*").length > 40) continue;
        if (reported.has(el)) continue;
        reported.add(el);

        let name = "";
        try {
          name = accessibleName(el).trim();
        } catch {
          name = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        }
        const label = name ? `"${name.length > 60 ? `${name.slice(0, 59)}…` : name}"` : `<${el.tagName.toLowerCase()}>`;
        let description: string;
        if (pointerOwn) {
          description = `${label} is styled as clickable (cursor: pointer) but is not keyboard focusable (no tabindex, not a native control, no focusable descendant). Confirm it responds to clicks; if so, keyboard users cannot reach it.`;
        } else if (inComposite) {
          description = `${label} (${signals.join(", ")}) is inside a composite widget whose container is not focusable and does not use aria-activedescendant. Confirm the widget moves focus to its items (roving tabindex) or manages them with aria-activedescendant; otherwise keyboard users cannot reach it.`;
        } else {
          description = `${label} is clickable (${signals.join(", ")}) but is not keyboard focusable: it has no tabindex, is not a native control, and contains no focusable element.`;
        }
        findings.push({
          element: el,
          type: pointerOwn || inComposite ? "Semi" : PRIMARY.type,
          severity: PRIMARY.severity ?? "Critical",
          description,
          data: { ruleId: PRIMARY.id, signals, role: role || null, tag: el.tagName.toLowerCase(), composite: inComposite },
          fix: {
            summary: inComposite
              ? `Make the composite container focusable (tabindex="0") and manage the active role="${role}" with aria-activedescendant, or give the current item tabindex="0" (roving tabindex) with arrow-key handling.`
              : hasRole
                ? `Add tabindex="0" and keyboard handling (Enter${role === "button" || role === "checkbox" || role === "switch" ? " and Space" : ""}) to the role="${role}" element, or replace it with the native element.`
                : "Replace the element with a <button> (or <a href>), or add role, tabindex=\"0\" and a keydown handler for Enter/Space.",
            suggestedValue: hasRole ? 'tabindex="0"' : "<button type=\"button\">…</button>",
            docsUrl: inComposite ? "https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/" : "https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html",
          },
        });
      } catch {
        // next
      }
    }

    // --- KBD-08 ---------------------------------------------------------------
    try {
      const dialogs = Array.from(ctx.root.querySelectorAll("[role='dialog'], [role='alertdialog'], dialog[open]"));
      const active = doc.activeElement;
      for (const dialog of dialogs) {
        try {
          if (isExtensionElement(dialog, ctx) || !ctx.isVisible(dialog)) continue;
          if ((dialog.getAttribute("aria-hidden") ?? "").toLowerCase() === "true") continue;
          if (dialog instanceof HTMLDialogElement && !dialog.open) continue;
          if (dialog.closest("[aria-hidden='true']")) continue;
          if (active && (dialog === active || dialog.contains(active))) continue;
          const modal = (dialog.getAttribute("aria-modal") ?? "").toLowerCase() === "true" || (dialog instanceof HTMLDialogElement && dialog.matches(":modal"));
          let name = "";
          try {
            name = accessibleName(dialog).trim();
          } catch {
            name = "";
          }
          findings.push({
            element: dialog,
            type: DIALOG.type,
            severity: DIALOG.severity ?? "Serious",
            description: `The open ${modal ? "modal " : ""}dialog${name ? ` "${name}"` : ""} does not contain the keyboard focus (focus is on ${active && active !== doc.body ? `<${active.tagName.toLowerCase()}>` : "the page body"}). Confirm focus moves into the dialog when it opens and returns to the trigger when it closes.`,
            data: { ruleId: DIALOG.id, modal, name: name || null, activeElement: active ? active.tagName.toLowerCase() : null },
            fix: {
              summary: "When the dialog opens, move focus to its first focusable control (or the dialog itself with tabindex=\"-1\"); trap focus inside while it is modal and restore focus to the opening control on close.",
              docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html",
            },
          });
        } catch {
          // next dialog
        }
      }
    } catch {
      // ignore
    }
    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
