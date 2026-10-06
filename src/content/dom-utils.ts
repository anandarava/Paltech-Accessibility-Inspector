/**
 * DOM helpers shared by the scanner, normalizer, custom rules, overlay and
 * the content-script message handlers. Pure functions over the live DOM; none
 * of them modify the page.
 */
import type { BoundingBox } from "@shared/types";
import { EXT_MARKER_ATTR, MAX_HTML_SNIPPET, OVERLAY_HOST_ID } from "@shared/constants";

const EXTENSION_SELECTOR = `#${OVERLAY_HOST_ID}, [${EXT_MARKER_ATTR}]`;

/** True when the element belongs to the extension (overlay host or a marked node). */
export function isExtensionNode(el: Element | null | undefined): boolean {
  if (!el) return false;
  try {
    if (el.matches(EXTENSION_SELECTOR) || el.closest(EXTENSION_SELECTOR) !== null) return true;
  } catch {
    /* detached or exotic node */
  }
  // Nodes inside the overlay's shadow tree: walk to the shadow host.
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) return isExtensionNode(root.host);
  return false;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/([^\w-])/g, "\\$1");
}

/** A class name that looks hand-written (not a CSS-module hash or utility with state). */
function isStableClass(cls: string): boolean {
  if (cls.length === 0 || cls.length > 32) return false;
  if (/\d{3,}/.test(cls)) return false;
  if (/^(is-|has-|js-|active|hover|focus|selected|open)/i.test(cls)) return false;
  if (/^[a-z]+_[A-Za-z0-9]{5,}$/.test(cls) || /__[A-Za-z0-9]{5,}$/.test(cls)) return false; // css-module style
  if (/^[A-Za-z0-9]{6,}$/.test(cls) && /\d/.test(cls) && /[A-Z]/.test(cls)) return false; // hashed
  return /^-?[_A-Za-z][-\w]*$/.test(cls);
}

function queryRoot(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument;
}

function countMatches(root: ParentNode, selector: string): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return -1;
  }
}

function idSelector(el: Element, root: ParentNode): string | null {
  const id = el.getAttribute("id");
  if (!id || /\s/.test(id)) return null;
  const sel = `#${cssEscape(id)}`;
  return countMatches(root, sel) === 1 ? sel : null;
}

function segmentFor(el: Element): string {
  const tag = cssEscape(el.localName || el.tagName.toLowerCase());
  const parent = el.parentElement;
  let seg = tag;
  const classes = Array.from(el.classList).filter(isStableClass).slice(0, 2);
  if (classes.length) seg += classes.map((c) => `.${cssEscape(c)}`).join("");
  if (!parent) return seg;
  const sameTag = Array.from(parent.children).filter((c) => c.localName === el.localName);
  if (sameTag.length > 1) {
    const withSameClasses = sameTag.filter((c) => classes.every((cls) => c.classList.contains(cls)));
    if (withSameClasses.length > 1) {
      seg += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
    }
  }
  return seg;
}

/**
 * Builds a short CSS selector that matches exactly one element in its root
 * (document or shadow root). Prefers a unique id, then the shortest ancestor
 * path (with :nth-of-type where needed) that is unique. Falls back to a full
 * path from the root when nothing shorter is unique.
 */
export function uniqueSelector(el: Element): string {
  const root = queryRoot(el);
  const direct = idSelector(el, root);
  if (direct) return direct;
  if (el === el.ownerDocument.documentElement) return "html";
  if (el === el.ownerDocument.body) return "body";

  const segments: string[] = [];
  let current: Element | null = el;
  while (current) {
    const anchor = current === el ? null : idSelector(current, root);
    if (anchor) {
      segments.unshift(anchor);
      const sel = segments.join(" > ");
      if (countMatches(root, sel) === 1) return sel;
      segments.shift();
    }
    segments.unshift(segmentFor(current));
    const candidate = segments.join(" > ");
    if (countMatches(root, candidate) === 1) return candidate;
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    current = parent;
  }
  // Last resort: a fully-indexed path from the root, which is always unique.
  const parts: string[] = [];
  let node: Element | null = el;
  while (node) {
    const parent: Element | null = node.parentElement;
    let seg = cssEscape(node.localName);
    if (parent) {
      const idx = Array.from(parent.children).filter((c) => c.localName === node!.localName).indexOf(node) + 1;
      seg += `:nth-of-type(${idx})`;
    }
    parts.unshift(seg);
    node = parent;
  }
  return parts.join(" > ");
}

/**
 * Selector used as the identity part of an issue fingerprint. uniqueSelector()
 * is only unique within the element's own root, so the same selector inside two
 * shadow roots (repeated web components) would collide. For elements in shadow
 * trees the host path is prefixed ("host >>> inner"); light-DOM elements keep
 * their plain selector, so existing fingerprints and baselines stay valid.
 */
export function fingerprintSelector(el: Element, selector: string): string {
  const hosts: string[] = [];
  let root = el.getRootNode();
  for (let guard = 0; root instanceof ShadowRoot && guard < 50; guard++) {
    try {
      hosts.unshift(uniqueSelector(root.host));
    } catch {
      hosts.unshift(root.host.localName);
    }
    root = root.host.getRootNode();
  }
  return hosts.length > 0 ? `${hosts.join(" >>> ")} >>> ${selector}` : selector;
}

const HTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * Absolute XPath (/html/body/div[2]/p); indexes only when a sibling shares the tag.
 * Elements outside the HTML namespace (SVG, MathML) cannot be matched by a bare
 * name in XPath 1.0, so they use `*[local-name(.)='svg']` steps.
 */
export function xpath(el: Element): string {
  const parts: string[] = [];
  let node: Node | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const parent: Node | null = element.parentNode;
    const foreign = !!element.namespaceURI && element.namespaceURI !== HTML_NS;
    let seg = foreign ? `*[local-name(.)='${element.localName}']` : element.localName || element.tagName.toLowerCase();
    if (parent && (parent.nodeType === Node.ELEMENT_NODE || parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE)) {
      // The index counts only siblings the step itself matches (same name and namespace).
      const siblings = Array.from((parent as ParentNode).children).filter((c) => c.localName === element.localName && c.namespaceURI === element.namespaceURI);
      if (siblings.length > 1) seg += `[${siblings.indexOf(element) + 1}]`;
    }
    parts.unshift(seg);
    if (parent instanceof ShadowRoot) {
      // Continue from the shadow host; the boundary is marked with "//".
      parts.unshift("/");
      node = parent.host;
      continue;
    }
    node = parent;
  }
  return "/" + parts.join("/").replace(/\/\/\//g, "//");
}

/** Whitespace-collapsed outerHTML, truncated to `max` characters (default MAX_HTML_SNIPPET). */
export function outerHtmlSnippet(el: Element, max: number = MAX_HTML_SNIPPET): string {
  let html = "";
  try {
    html = el.outerHTML;
  } catch {
    html = `<${el.localName}>`;
  }
  html = html.replace(/\s+/g, " ").trim();
  if (html.length <= max) return html;
  const openEnd = html.indexOf(">");
  if (openEnd > 0 && openEnd + 1 <= max) {
    // Keep the whole opening tag when it fits, then as much content as possible.
    return html.slice(0, max - 1) + "…";
  }
  return html.slice(0, max - 1) + "…";
}

function ariaHiddenInTree(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    if (node.getAttribute("aria-hidden") === "true") return true;
    const parent: Element | null = node.parentElement;
    if (!parent) {
      const root = node.getRootNode();
      node = root instanceof ShadowRoot ? root.host : null;
    } else {
      node = parent;
    }
  }
  return false;
}

/**
 * A document without a layout engine (jsdom in unit tests, or a display:none
 * frame) reports a zero-size root; box checks are meaningless there.
 */
function hasLayout(doc: Document): boolean {
  const root = doc.documentElement;
  if (!root) return false;
  const rect = root.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function visibleByStyleOnly(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    if (node.hasAttribute("hidden")) return false;
    const style = getComputedStyle(node);
    if (style.display === "none") return false;
    if (node === el && (style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0")) return false;
    node = node.parentElement;
  }
  return true;
}

/**
 * True when the element is rendered: not display:none / visibility:hidden /
 * opacity 0 on itself, not inside an aria-hidden subtree, and has a box.
 */
export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  if (ariaHiddenInTree(el)) return false;
  const doc = el.ownerDocument;
  if (el === doc.documentElement || el === doc.body) return true;
  if (!hasLayout(doc)) return visibleByStyleOnly(el);
  const withCheck = el as Element & {
    checkVisibility?: (opts?: { visibilityProperty?: boolean; opacityProperty?: boolean; contentVisibilityAuto?: boolean }) => boolean;
  };
  if (typeof withCheck.checkVisibility === "function") {
    if (!withCheck.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true })) return false;
  } else {
    let node: Element | null = el;
    while (node) {
      const style = getComputedStyle(node);
      if (style.display === "none") return false;
      if (node === el && (style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0")) return false;
      node = node.parentElement;
    }
  }
  const style = getComputedStyle(el);
  if (style.opacity === "0") return false;
  const rects = el.getClientRects();
  if (rects.length === 0) {
    // Inline elements with only text still produce rects; SVG children may not.
    return el.namespaceURI === "http://www.w3.org/2000/svg" && el.getBoundingClientRect().width > 0;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    // Zero-size but may still render overflowing children (e.g. wrapper divs).
    return el.childElementCount > 0 && style.overflow !== "hidden" && Array.from(el.children).some((c) => c.getClientRects().length > 0);
  }
  return true;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Bounding boxes in page (document) and viewport coordinates. */
export function boundingBoxes(el: Element): { page: BoundingBox; viewport: BoundingBox } {
  const rect = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView ?? window;
  const viewport: BoundingBox = { x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height) };
  const page: BoundingBox = {
    x: round(rect.left + win.scrollX),
    y: round(rect.top + win.scrollY),
    width: viewport.width,
    height: viewport.height,
  };
  return { page, viewport };
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "iframe",
  "object",
  "embed",
  "audio[controls]",
  "video[controls]",
  "summary",
  "[tabindex]",
  "[contenteditable]",
].join(",");

function isNativelyFocusable(el: HTMLElement): boolean {
  const tag = el.localName;
  if (tag === "a" || tag === "area") return el.hasAttribute("href");
  if (tag === "input") return (el as HTMLInputElement).type !== "hidden";
  if (tag === "button" || tag === "select" || tag === "textarea" || tag === "iframe" || tag === "object" || tag === "embed") return true;
  if (tag === "audio" || tag === "video") return el.hasAttribute("controls");
  if (tag === "summary") {
    const details = el.parentElement;
    return details?.localName === "details" && details.querySelector(":scope > summary") === el;
  }
  if (el.isContentEditable && el.getAttribute("contenteditable") !== "false") return true;
  return false;
}

function isDisabled(el: HTMLElement): boolean {
  if (el.matches(":disabled")) return true;
  if (el.closest("fieldset:disabled") && !el.closest("fieldset:disabled > legend")) return true;
  return false;
}

function isInert(el: Element): boolean {
  return el.closest("[inert]") !== null;
}

function tabIndexOf(el: HTMLElement): number | null {
  const attr = el.getAttribute("tabindex");
  if (attr === null) return isNativelyFocusable(el) ? 0 : null;
  const n = Number.parseInt(attr, 10);
  if (Number.isNaN(n)) return isNativelyFocusable(el) ? 0 : null;
  return n;
}

function inClosedDetails(el: Element): boolean {
  let node: Element | null = el.parentElement;
  while (node) {
    if (node.localName === "details" && !(node as HTMLDetailsElement).open) {
      const summary = node.querySelector(":scope > summary");
      if (!summary || !summary.contains(el)) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Approximation of the sequential focus navigation order: elements with a
 * positive tabindex first (ascending, then DOM order), then tabindex 0 /
 * natively focusable elements in DOM order. Skips disabled, inert, hidden,
 * tabindex=-1 and extension elements.
 */
export function getFocusableElements(root: ParentNode): HTMLElement[] {
  let candidates: Element[];
  try {
    candidates = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR));
  } catch {
    return [];
  }
  const positive: Array<{ el: HTMLElement; tabIndex: number; order: number }> = [];
  const natural: HTMLElement[] = [];
  let order = 0;
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) {
      // SVG <a href> or focusable SVG with tabindex.
      if (candidate instanceof SVGElement && candidate.hasAttribute("tabindex")) {
        const ti = Number.parseInt(candidate.getAttribute("tabindex") ?? "", 10);
        if (!Number.isNaN(ti) && ti >= 0 && !isExtensionNode(candidate) && isVisible(candidate)) {
          natural.push(candidate as unknown as HTMLElement);
        }
      }
      continue;
    }
    if (isExtensionNode(candidate)) continue;
    const ti = tabIndexOf(candidate);
    if (ti === null || ti < 0) continue;
    if (isDisabled(candidate) || isInert(candidate) || inClosedDetails(candidate)) continue;
    if (candidate.localName === "input" && (candidate as HTMLInputElement).type === "radio") {
      // Only the checked radio (or the first when none is checked) of a group is tabbable.
      const radio = candidate as HTMLInputElement;
      if (radio.name) {
        const group = Array.from(candidates).filter(
          (c): c is HTMLInputElement => c instanceof HTMLInputElement && c.type === "radio" && c.name === radio.name && c.form === radio.form,
        );
        const checked = group.find((r) => r.checked);
        if ((checked && checked !== radio) || (!checked && group[0] !== radio)) continue;
      }
    }
    if (!isVisible(candidate)) continue;
    if (ti > 0) positive.push({ el: candidate, tabIndex: ti, order: order++ });
    else natural.push(candidate);
  }
  positive.sort((a, b) => a.tabIndex - b.tabIndex || a.order - b.order);
  return [...positive.map((p) => p.el), ...natural];
}

function collapse(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function textFromContent(el: Element, depth = 0): string {
  if (depth > 20) return "";
  const parts: string[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.textContent ?? "");
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const c = child as Element;
    if (c.getAttribute("aria-hidden") === "true") continue;
    if (isExtensionNode(c)) continue;
    const label = collapse(c.getAttribute("aria-label"));
    if (label) {
      parts.push(" " + label + " ");
      continue;
    }
    if (c.localName === "img" || c.localName === "area") {
      parts.push(" " + collapse(c.getAttribute("alt")) + " ");
      continue;
    }
    if (c.localName === "svg") {
      const title = c.querySelector(":scope > title");
      if (title) parts.push(" " + collapse(title.textContent) + " ");
      continue;
    }
    if (c.localName === "input") {
      // Only the label of button-like inputs is part of an ancestor's name.
      // User-typed values (text, email, password, card numbers, ...) are never
      // copied: accessible names end up in issue text that is exported and
      // posted to trackers, so a leaked value would leave the page.
      const input = c as HTMLInputElement;
      const type = (input.getAttribute("type") ?? "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") {
        parts.push(" " + collapse(input.value) + " ");
      } else if (type === "image") {
        parts.push(" " + collapse(input.getAttribute("alt")) + " ");
      }
      continue;
    }
    if (c.localName === "select" || c.localName === "textarea" || c.localName === "script" || c.localName === "style") continue;
    parts.push(textFromContent(c, depth + 1));
  }
  return collapse(parts.join(""));
}

function labelTextExcluding(label: Element, control: Element): string {
  const parts: string[] = [];
  for (const child of Array.from(label.childNodes)) {
    if (child === control) continue;
    if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent ?? "");
    else if (child.nodeType === Node.ELEMENT_NODE) {
      const c = child as Element;
      if (c.contains(control)) parts.push(labelTextExcluding(c, control));
      else parts.push(textFromContent(c));
    }
  }
  return collapse(parts.join(" "));
}

/**
 * Simplified accessible-name computation (accname 1.2 order):
 * aria-labelledby > aria-label > label[for] / wrapping label > alt > text content > title.
 * Name from content (step 2G) precedes the title tooltip (2I); only iframe /
 * fieldset / figure / table, which do not name from content, use title first.
 * User-typed input values are never part of a name (see textFromContent).
 */
export function accessibleName(el: Element): string {
  const root = queryRoot(el);
  const labelledBy = collapse(el.getAttribute("aria-labelledby"));
  if (labelledBy) {
    const names = labelledBy
      .split(" ")
      .map((id) => {
        const ref = root.getElementById ? root.getElementById(id) : root.querySelector(`#${cssEscape(id)}`);
        if (!ref) return "";
        if (ref === el) return collapse(el.getAttribute("aria-label")) || textFromContent(el);
        const refLabel = collapse(ref.getAttribute("aria-label"));
        if (refLabel) return refLabel;
        if (ref instanceof HTMLInputElement) return ref.type === "password" ? "" : collapse(ref.value);
        if (ref instanceof HTMLTextAreaElement) return collapse(ref.value);
        if (ref instanceof HTMLSelectElement) return collapse(ref.selectedOptions[0]?.textContent);
        return textFromContent(ref);
      })
      .filter(Boolean);
    if (names.length) return names.join(" ");
  }
  const ariaLabel = collapse(el.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;

  const tag = el.localName;
  const isLabelable =
    (tag === "input" && (el as HTMLInputElement).type !== "hidden") ||
    tag === "select" ||
    tag === "textarea" ||
    tag === "meter" ||
    tag === "progress" ||
    tag === "output" ||
    tag === "button";
  if (isLabelable) {
    const id = el.getAttribute("id");
    const labels: Element[] = [];
    if (id) {
      try {
        labels.push(...Array.from(root.querySelectorAll(`label[for="${cssEscape(id)}"]`)));
      } catch {
        /* ignore */
      }
    }
    const wrapping = el.closest("label");
    if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);
    const labelText = labels.map((l) => labelTextExcluding(l, el)).filter(Boolean).join(" ");
    if (labelText) return labelText;
    if (tag === "input") {
      const input = el as HTMLInputElement;
      if (input.type === "image") {
        const alt = collapse(input.getAttribute("alt"));
        if (alt) return alt;
      }
      if (input.type === "button" || input.type === "submit" || input.type === "reset") {
        const value = collapse(input.value);
        if (value) return value;
        if (input.type === "submit") return "Submit";
        if (input.type === "reset") return "Reset";
      }
    }
  }
  if (tag === "img" || tag === "area") {
    const alt = collapse(el.getAttribute("alt"));
    if (alt) return alt;
  }
  if (tag === "svg") {
    const title = el.querySelector(":scope > title");
    const t = collapse(title?.textContent);
    if (t) return t;
  }
  if (tag === "iframe" || tag === "frame" || tag === "fieldset" || tag === "figure" || tag === "table") {
    const title = collapse(el.getAttribute("title"));
    if (title) return title;
    const child =
      tag === "fieldset" ? el.querySelector(":scope > legend") : tag === "figure" ? el.querySelector(":scope > figcaption") : tag === "table" ? el.querySelector(":scope > caption") : null;
    const childText = child ? textFromContent(child) : "";
    if (childText) return childText;
  }
  // Name from content comes before the title tooltip (accname 2G before 2I).
  const content = textFromContent(el);
  if (content) return content;
  const title = collapse(el.getAttribute("title"));
  if (title) return title;
  if (tag === "input" || tag === "textarea") {
    const placeholder = collapse(el.getAttribute("placeholder"));
    if (placeholder) return placeholder;
  }
  return "";
}

type SchedulerLike = { yield?: () => Promise<void> };

/** Yield to the event loop (scheduler.yield when available, else a MessageChannel macrotask). */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (scheduler && typeof scheduler.yield === "function") {
    try {
      return scheduler.yield();
    } catch {
      /* fall through */
    }
  }
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel === "function") {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** Resolve a selector produced by uniqueSelector() back to an element, or null. */
export function resolveSelector(selector: string, root: ParentNode = document): Element | null {
  if (!selector) return null;
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * `root.querySelectorAll(selector)` that also returns `root` itself when it matches.
 * Scoped scans (picker, "scan this element") use an element as the root, and plain
 * `querySelectorAll` never matches the element it is called on.
 */
export function queryAllIncludingRoot(root: Document | Element, selector: string): Element[] {
  const found = Array.from(root.querySelectorAll(selector));
  if (root.nodeType === 1 && (root as Element).matches(selector)) found.unshift(root as Element);
  return found;
}
