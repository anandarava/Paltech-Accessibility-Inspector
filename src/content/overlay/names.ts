/**
 * Accessible-names layer: on mouseover (capturing listener on document) show a
 * tooltip with the element's role, accessible name and states, roughly what a
 * screen reader would announce. The tooltip lives inside the overlay shadow
 * root; the hovered element also gets a thin outline.
 */
import { accessibleName } from "@src/content/dom-utils";
import type { OverlayColors } from "./types";
import { INFO_COLOR, clip, elementRect, isExtensionNode, isRendered, placeBox, type Origin } from "./highlighter";

const INPUT_ROLES: Record<string, string> = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
  email: "textbox",
  tel: "textbox",
  text: "textbox",
  url: "textbox",
  password: "textbox",
};

const TAG_ROLES: Record<string, string> = {
  article: "article",
  aside: "complementary",
  button: "button",
  datalist: "listbox",
  dd: "definition",
  details: "group",
  dfn: "term",
  dialog: "dialog",
  dl: "list",
  dt: "term",
  fieldset: "group",
  figure: "figure",
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  hr: "separator",
  html: "document",
  img: "img",
  li: "listitem",
  main: "main",
  math: "math",
  menu: "list",
  meter: "meter",
  nav: "navigation",
  ol: "list",
  optgroup: "group",
  option: "option",
  output: "status",
  p: "paragraph",
  progress: "progressbar",
  search: "search",
  summary: "button",
  table: "table",
  tbody: "rowgroup",
  td: "cell",
  textarea: "textbox",
  tfoot: "rowgroup",
  th: "columnheader",
  thead: "rowgroup",
  tr: "row",
  ul: "list",
  blockquote: "blockquote",
  caption: "caption",
  code: "code",
  em: "emphasis",
  strong: "strong",
  sub: "subscript",
  sup: "superscript",
  time: "time",
  del: "deletion",
  ins: "insertion",
};

/** Explicit role, else the implicit ARIA role for the tag; "" for generic elements. */
export function elementRole(el: Element): string {
  const explicit = (el.getAttribute("role") || "").trim().toLowerCase().split(/\s+/)[0] || "";
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "a":
    case "area":
      return el.hasAttribute("href") ? "link" : "";
    case "input": {
      const type = ((el as HTMLInputElement).type || "text").toLowerCase();
      if (el.hasAttribute("list") && ["text", "search", "url", "tel", "email"].includes(type)) return "combobox";
      return INPUT_ROLES[type] ?? "";
    }
    case "select": {
      const s = el as HTMLSelectElement;
      return s.multiple || s.size > 1 ? "listbox" : "combobox";
    }
    case "img":
      return el.getAttribute("alt") === "" ? "presentation" : "img";
    case "header":
      return el.parentElement?.closest("article, aside, main, nav, section") ? "" : "banner";
    case "footer":
      return el.parentElement?.closest("article, aside, main, nav, section") ? "" : "contentinfo";
    case "section":
      return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "";
    case "svg":
      return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "img" : "";
    case "th": {
      const scope = (el.getAttribute("scope") || "").toLowerCase();
      return scope === "row" ? "rowheader" : "columnheader";
    }
    default:
      return TAG_ROLES[tag] ?? "";
  }
}

function ariaBool(el: Element, attr: string): boolean | undefined {
  const v = el.getAttribute(attr);
  if (v === null) return undefined;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

/** States a screen reader would announce: disabled, checked, expanded, required, invalid (+ pressed/selected). */
export function elementStates(el: Element): string[] {
  const states: string[] = [];
  const form = el as HTMLInputElement;
  const tag = el.tagName.toLowerCase();

  const disabled = ("disabled" in form && typeof form.disabled === "boolean" && form.disabled) || ariaBool(el, "aria-disabled") === true || el.closest("fieldset:disabled") !== null;
  if (disabled) states.push("disabled");

  const ariaChecked = el.getAttribute("aria-checked");
  if (ariaChecked === "mixed") states.push("partially checked");
  else if (ariaChecked === "true") states.push("checked");
  else if (ariaChecked === "false") states.push("not checked");
  else if (tag === "input" && (form.type === "checkbox" || form.type === "radio")) {
    if (form.indeterminate) states.push("partially checked");
    else states.push(form.checked ? "checked" : "not checked");
  }

  const expanded = ariaBool(el, "aria-expanded");
  if (expanded !== undefined) states.push(expanded ? "expanded" : "collapsed");
  else if (tag === "summary") {
    const details = el.closest("details");
    if (details) states.push(details.open ? "expanded" : "collapsed");
  }

  const required = ("required" in form && typeof form.required === "boolean" && form.required) || ariaBool(el, "aria-required") === true;
  if (required) states.push("required");

  const ariaInvalid = el.getAttribute("aria-invalid");
  if (ariaInvalid && ariaInvalid !== "false") states.push("invalid");
  else if ("validity" in form && form.validity instanceof ValidityState && form.willValidate && !form.validity.valid) states.push("invalid");

  const pressed = ariaBool(el, "aria-pressed");
  if (pressed !== undefined) states.push(pressed ? "pressed" : "not pressed");
  const selected = ariaBool(el, "aria-selected");
  if (selected !== undefined) states.push(selected ? "selected" : "not selected");
  if (el.getAttribute("aria-current") && el.getAttribute("aria-current") !== "false") states.push("current");
  if (("readOnly" in form && typeof form.readOnly === "boolean" && form.readOnly) || ariaBool(el, "aria-readonly") === true) states.push("read-only");
  if (ariaBool(el, "aria-hidden") === true) states.push("hidden from assistive tech");
  const level = el.getAttribute("aria-level") || (/^h([1-6])$/i.exec(tag)?.[1] ?? "");
  if (level && elementRole(el) === "heading") states.push(`level ${level}`);
  return states;
}

export class NamesLayer {
  private readonly layer: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private readonly outline: HTMLDivElement;
  private readonly roleLine: HTMLDivElement;
  private readonly nameLine: HTMLDivElement;
  private readonly stateLine: HTMLDivElement;
  private current: Element | null = null;
  private enabled = false;
  private colors: OverlayColors;
  private lastOrigin: Origin = { x: 0, y: 0 };
  private readonly onOver = (ev: Event): void => this.handleOver(ev);
  private readonly onLeave = (): void => this.hideTooltip();

  constructor(layer: HTMLDivElement, colors: OverlayColors) {
    this.layer = layer;
    this.colors = colors;
    this.outline = document.createElement("div");
    this.outline.className = "box thin";
    this.outline.style.setProperty("--c", INFO_COLOR);
    this.outline.style.display = "none";
    this.tooltip = document.createElement("div");
    this.tooltip.className = "tooltip";
    this.tooltip.setAttribute("role", "tooltip");
    this.tooltip.style.display = "none";
    this.roleLine = document.createElement("div");
    this.roleLine.className = "tt-role";
    this.nameLine = document.createElement("div");
    this.nameLine.className = "tt-name";
    this.stateLine = document.createElement("div");
    this.stateLine.className = "tt-state";
    this.tooltip.append(this.roleLine, this.nameLine, this.stateLine);
    this.layer.append(this.outline, this.tooltip);
  }

  setColors(colors: OverlayColors): void {
    this.colors = colors;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.addEventListener("mouseover", this.onOver, true);
    document.addEventListener("mouseleave", this.onLeave, true);
    window.addEventListener("blur", this.onLeave);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    document.removeEventListener("mouseover", this.onOver, true);
    document.removeEventListener("mouseleave", this.onLeave, true);
    window.removeEventListener("blur", this.onLeave);
    this.hideTooltip();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  reposition(origin: Origin): void {
    this.lastOrigin = origin;
    if (!this.current) return;
    if (!isRendered(this.current)) {
      this.hideTooltip();
      return;
    }
    const rect = elementRect(this.current);
    placeBox(this.outline, rect, origin);
    this.outline.style.display = "";
    this.placeTooltip(rect, origin);
  }

  prune(): void {
    if (this.current && !this.current.isConnected) this.hideTooltip();
  }

  clear(): void {
    this.hideTooltip();
  }

  private handleOver(ev: Event): void {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (isExtensionNode(target)) return;
    if (target === document.documentElement && this.current) return;
    if (target === this.current) return;
    this.current = target;
    this.fill(target);
    this.reposition(this.lastOrigin);
  }

  private fill(el: Element): void {
    const role = elementRole(el) || `generic (${el.tagName.toLowerCase()})`;
    let name = "";
    try {
      name = accessibleName(el);
    } catch {
      name = "";
    }
    const states = elementStates(el);
    this.roleLine.textContent = role;
    this.nameLine.textContent = name ? `“${clip(name, 120)}”` : "(no accessible name)";
    this.nameLine.classList.toggle("empty", !name);
    this.stateLine.textContent = states.join(", ");
    this.stateLine.style.display = states.length ? "" : "none";
    this.tooltip.style.display = "";
  }

  private placeTooltip(rect: DOMRect, origin: Origin): void {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    // Measure after content is set.
    this.tooltip.style.left = "0px";
    this.tooltip.style.top = "0px";
    const tw = this.tooltip.offsetWidth;
    const th = this.tooltip.offsetHeight;
    const gap = 6;
    let left = rect.left;
    let top = rect.bottom + gap;
    if (top + th > vh && rect.top - gap - th >= 0) top = rect.top - gap - th;
    if (top + th > vh) top = Math.max(0, vh - th);
    if (left + tw > vw) left = Math.max(0, vw - tw);
    if (left < 0) left = 0;
    this.tooltip.style.left = `${Math.round(left - origin.x)}px`;
    this.tooltip.style.top = `${Math.round(top - origin.y)}px`;
  }

  private hideTooltip(): void {
    this.current = null;
    this.tooltip.style.display = "none";
    this.outline.style.display = "none";
  }
}
