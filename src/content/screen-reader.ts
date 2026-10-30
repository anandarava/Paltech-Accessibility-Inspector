/**
 * Screen reader view, page side.
 *
 * buildPageTree() is the fallback used when Chrome's accessibility tree cannot be
 * read through the debugger: an approximate tree built from the HTML with the same
 * role, name and state logic as the names overlay. srTargetElement() finds the
 * element of a transcript line so the overlay can outline it.
 */
import type { PageTree, SrNode } from "@shared/announce";
import { accessibleName, isExtensionNode, resolveSelector } from "./dom-utils";
import { elementRole } from "./overlay/names";

/** Stop after this many nodes; very large pages get a partial transcript. */
const MAX_NODES = 20000;

/** Must match SR_TARGET_ATTR in src/background/screen-reader.ts. */
const SR_TARGET_ATTR = "data-pt-sr-target";

const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "title"]);

/** Roles whose name a screen reader announces; plain wrappers are not named (and naming is slow). */
const NAMED_ROLES = new Set([
  "button", "link", "checkbox", "radio", "switch", "textbox", "searchbox", "combobox", "listbox", "slider", "spinbutton",
  "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem", "progressbar", "meter", "heading", "image",
  "banner", "navigation", "main", "contentinfo", "complementary", "search", "region", "form", "group", "radiogroup",
  "dialog", "alertdialog", "figure", "article", "table", "grid", "treegrid", "toolbar", "tablist", "menu", "menubar", "tree",
]);

/** Elements of the last tree built, by node id, for highlighting. */
let lastElements = new Map<string, Node>();

function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v === null ? undefined : v;
}

function propsOf(el: Element, role: string): SrNode["props"] {
  const props: SrNode["props"] = {};
  const input = el as HTMLInputElement;
  const tag = el.localName;
  const ariaChecked = attr(el, "aria-checked");
  if (ariaChecked !== undefined) props.checked = ariaChecked;
  else if (tag === "input" && (input.type === "checkbox" || input.type === "radio")) props.checked = input.indeterminate ? "mixed" : String(input.checked);
  const pressed = attr(el, "aria-pressed");
  if (pressed !== undefined) props.pressed = pressed;
  const expanded = attr(el, "aria-expanded");
  if (expanded === "true" || expanded === "false") props.expanded = expanded === "true";
  else if (tag === "summary" && el.parentElement?.localName === "details") props.expanded = (el.parentElement as HTMLDetailsElement).open;
  if (attr(el, "aria-selected") === "true") props.selected = true;
  if (("disabled" in input && input.disabled === true) || attr(el, "aria-disabled") === "true" || el.closest("fieldset:disabled") !== null) props.disabled = true;
  if (("required" in input && input.required === true) || attr(el, "aria-required") === "true") props.required = true;
  if (("readOnly" in input && input.readOnly === true) || attr(el, "aria-readonly") === "true") props.readonly = true;
  const invalid = attr(el, "aria-invalid");
  if (invalid !== undefined) props.invalid = invalid;
  const popup = attr(el, "aria-haspopup");
  if (popup !== undefined && popup !== "false") props.hasPopup = popup;
  if ((tag === "select" && (el as HTMLSelectElement).multiple) || attr(el, "aria-multiselectable") === "true") props.multiselectable = true;
  if (role === "heading") {
    const level = Number(attr(el, "aria-level") ?? /^h([1-6])$/.exec(tag)?.[1] ?? 2);
    if (level > 0) props.level = level;
  }
  return props;
}

function valueOf(el: Element, role: string): string | undefined {
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text;
  if (el instanceof HTMLInputElement) {
    if (el.type === "password") return el.value ? "•".repeat(Math.min(el.value.length, 8)) : undefined;
    if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "slider" || role === "spinbutton") return el.value || undefined;
    return undefined;
  }
  if (el instanceof HTMLTextAreaElement) return el.value || undefined;
  return attr(el, "aria-valuetext") ?? attr(el, "aria-valuenow");
}

function descriptionOf(el: Element): string | undefined {
  const ids = attr(el, "aria-describedby")?.trim().split(/\s+/) ?? [];
  const root = el.getRootNode() as Document | ShadowRoot;
  const text = ids
    .map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id))?.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

/** Children as rendered: an open shadow root replaces the light DOM, a slot shows what is assigned to it. */
function renderedChildren(el: Element): Node[] {
  if (el.shadowRoot) return [...el.shadowRoot.childNodes];
  if (el instanceof HTMLSlotElement) {
    const assigned = el.assignedNodes({ flatten: true });
    return assigned.length ? assigned : [...el.childNodes];
  }
  return [...el.childNodes];
}

/** Chrome's names for roles that the names overlay calls differently. */
function treeRole(role: string): string {
  if (role === "") return "generic";
  if (role === "img") return "image";
  if (role === "presentation") return "none";
  if (role === "document") return "generic";
  return role;
}

/** Build the tree of the page from its HTML and resolve `selectors` to node ids. */
export function buildPageTree(selectors: string[]): PageTree {
  const nodes: SrNode[] = [];
  const elements = new Map<string, Node>();
  const idOf = new Map<Node, string>();
  let truncated = false;

  const add = (node: Omit<SrNode, "id" | "children">, dom: Node | null, parent: SrNode | null): SrNode => {
    const n: SrNode = { ...node, id: String(nodes.length), children: [] };
    nodes.push(n);
    if (dom) {
      elements.set(n.id, dom);
      idOf.set(dom, n.id);
    }
    parent?.children.push(n.id);
    return n;
  };

  const root = add({ role: "RootWebArea", name: document.title, ignored: false, props: {} }, document.documentElement, null);

  const visit = (dom: Node, parent: SrNode, visible: boolean): void => {
    if (nodes.length >= MAX_NODES) {
      truncated = true;
      return;
    }
    if (dom.nodeType === Node.TEXT_NODE) {
      const text = (dom.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text && visible) add({ role: "StaticText", name: text, ignored: false, props: {} }, dom, parent);
      return;
    }
    if (dom.nodeType !== Node.ELEMENT_NODE) return;
    const el = dom as Element;
    const tag = el.localName;
    if (SKIPPED_TAGS.has(tag) || isExtensionNode(el)) return;
    if (el.getAttribute("aria-hidden") === "true" || (el instanceof HTMLInputElement && el.type === "hidden")) return;
    const style = getComputedStyle(el);
    if (style.display === "none") return;
    const shown = style.visibility === "visible";
    if (tag === "br") {
      add({ role: "LineBreak", name: "", ignored: false, props: {} }, el, parent);
      return;
    }
    const role = treeRole(elementRole(el));
    if (role === "none" || !shown) {
      // Not announced itself; its content may be (visibility can be turned back on below it).
      const transparent = add({ role: "none", name: "", ignored: true, props: {} }, el, parent);
      for (const c of renderedChildren(el)) visit(c, transparent, shown);
      return;
    }
    const node = add(
      {
        role,
        name: NAMED_ROLES.has(role) ? accessibleName(el) : "",
        description: NAMED_ROLES.has(role) ? descriptionOf(el) : undefined,
        value: valueOf(el, role),
        ignored: false,
        props: propsOf(el, role),
        inline: style.display.startsWith("inline") || style.display === "contents",
      },
      el,
      parent,
    );
    // A select's options are its value, not separate content.
    if (tag === "select") return;
    for (const c of renderedChildren(el)) visit(c, node, true);
  };

  if (document.body) visit(document.body, root, true);

  const matches: Record<string, string> = {};
  for (const selector of selectors) {
    const el = resolveSelector(selector);
    const id = el ? idOf.get(el) : undefined;
    if (id !== undefined) matches[selector] = id;
  }
  lastElements = elements;
  return { nodes, rootId: root.id, matches, truncated };
}

/**
 * The element to outline for a transcript line: the HTML tree's node, or the element
 * the debugger marked (the mark is removed). Text nodes give their parent element and
 * elements inside shadow roots their host, which is what the overlay can reach.
 */
export function srTargetElement(nodeId?: string): Element | null {
  let found: Node | null | undefined;
  if (nodeId !== undefined) found = lastElements.get(nodeId);
  else {
    found = document.querySelector(`[${SR_TARGET_ATTR}]`);
    (found as Element | null)?.removeAttribute(SR_TARGET_ATTR);
  }
  let el: Element | null = found ? (found.nodeType === Node.ELEMENT_NODE ? (found as Element) : found.parentElement) : null;
  while (el && el.getRootNode() instanceof ShadowRoot) el = (el.getRootNode() as ShadowRoot).host;
  return el && el.isConnected ? el : null;
}
