/**
 * Manual assessment helpers: list the elements an assisted requirement asks the tester to judge
 * (links, images, headings, form fields, controls), in document order, visible ones only.
 */
import { instanceKey, type Instance, type InstanceKind } from "@shared/assessment";
import { accessibleName, isExtensionNode, isVisible, outerHtmlSnippet, uniqueSelector } from "./dom-utils";

const MAX_INSTANCES = 300;

const SELECTORS: Record<InstanceKind, string> = {
  links: "a[href], area[href], [role=link]",
  images: "img, svg[role=img], [role=img], input[type=image], area[alt]",
  headings: "h1, h2, h3, h4, h5, h6, [role=heading]",
  fields:
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea, [contenteditable=''], [contenteditable=true], [role=textbox], [role=combobox], [role=searchbox], [role=spinbutton], [role=listbox]",
  controls:
    "button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=slider], [role=combobox], [role=textbox], [role=menuitem]",
};

function collapse(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function fileName(src: string): string {
  try {
    const u = new URL(src, location.href);
    if (u.protocol === "data:") return "(inline image)";
    return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? u.hostname);
  } catch {
    return src.slice(0, 60);
  }
}

function relativeHref(el: Element): string {
  const raw = el.getAttribute("href") ?? "";
  try {
    const u = new URL(raw, location.href);
    return u.origin === location.origin ? u.pathname + u.search + u.hash : u.toString();
  } catch {
    return raw;
  }
}

function describe(kind: InstanceKind, el: Element): { text: string; detail: string } {
  const name = collapse(accessibleName(el));
  switch (kind) {
    case "links":
      return { text: name || "(no name)", detail: el.hasAttribute("href") ? relativeHref(el) : "(no href)" };
    case "images": {
      const src = el.getAttribute("src") ?? el.querySelector("image")?.getAttribute("href") ?? "";
      const alt = el.getAttribute("alt");
      const hidden = el.getAttribute("aria-hidden") === "true" || el.getAttribute("role") === "presentation" || el.getAttribute("role") === "none";
      const detail = hidden ? "Hidden (decorative)" : alt === "" ? 'alt="" (decorative)' : name ? name : "No text alternative";
      return { text: src ? fileName(src) : el.tagName.toLowerCase(), detail };
    }
    case "headings": {
      const level = /^H([1-6])$/.exec(el.tagName)?.[1] ?? el.getAttribute("aria-level") ?? "2";
      return { text: collapse(el.textContent) || "(empty heading)", detail: `Level ${level}` };
    }
    case "fields": {
      const type = el instanceof HTMLInputElement ? el.type : el.getAttribute("role") ?? el.tagName.toLowerCase();
      const placeholder = el.getAttribute("placeholder");
      const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true";
      return {
        text: name || "(no label)",
        detail: [type, placeholder ? `placeholder "${collapse(placeholder)}"` : "", required ? "required" : ""].filter(Boolean).join(" · "),
      };
    }
    case "controls": {
      const role = el.getAttribute("role") ?? (el instanceof HTMLInputElement ? `${el.type} field` : el.tagName.toLowerCase());
      return { text: name || "(no name)", detail: role };
    }
  }
}

export function listInstances(kind: InstanceKind, root: Document = document): Instance[] {
  const out: Instance[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(root.querySelectorAll(SELECTORS[kind]))) {
    if (out.length >= MAX_INSTANCES) break;
    if (isExtensionNode(el)) continue;
    // Hidden images and headings are not judged; decorative images hidden with aria-hidden are listed when rendered.
    if (!isVisible(el)) continue;
    let selector: string;
    try {
      selector = uniqueSelector(el);
    } catch {
      continue;
    }
    if (seen.has(selector)) continue;
    seen.add(selector);
    const { text, detail } = describe(kind, el);
    out.push({ key: instanceKey(selector, text), selector, text, detail, html: outerHtmlSnippet(el, 200) });
  }
  return out;
}
