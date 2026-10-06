/**
 * Issue outlines + numbered badges, and plain selector highlights.
 *
 * Also exports the small geometry / lookup helpers shared by the other overlay
 * layers (tab order, headings, landmarks, names) so they stay consistent.
 *
 * All boxes are positioned in viewport coordinates (getBoundingClientRect) and
 * then shifted by the host's own viewport offset (`Origin`). With a healthy
 * `position: fixed` host that offset is (0, 0); if the page (or the colour
 * blindness `filter` on <html>) turns the host into a containing-block child,
 * the offset keeps the boxes glued to their elements anyway.
 */
import type { Issue } from "@shared/types";
import { EXT_MARKER_ATTR, OVERLAY_HOST_ID } from "@shared/constants";
import type { OverlayColors } from "./types";

/** Viewport offset of the overlay host (subtracted from every client rect). */
export interface Origin {
  x: number;
  y: number;
}

/** Grey used for best-practice issues (never a WCAG failure). */
export const BP_COLOR = "#6b7280";
/** Teal used for heading pills / landmark boxes / tooltips. */
export const INFO_COLOR = "#0b7285";

export const ZERO_ORIGIN: Origin = { x: 0, y: 0 };

/** Upper bound on shadow roots visited when a selector is not found in the light DOM. */
const MAX_SHADOW_ROOTS = 200;

/**
 * querySelector that never throws on an invalid selector. Selectors built by
 * uniqueSelector() are relative to their own root, so when the document has no
 * match the open shadow roots are searched too (breadth-first, first match wins).
 */
export function resolveElement(selector: string): Element | null {
  if (!selector) return null;
  try {
    const direct = document.querySelector(selector);
    if (direct) return direct;
    const queue: ParentNode[] = [document];
    let visited = 0;
    while (queue.length > 0 && visited < MAX_SHADOW_ROOTS) {
      const root = queue.shift()!;
      for (const host of Array.from(root.querySelectorAll("*"))) {
        const shadow = host.shadowRoot;
        if (!shadow || isExtensionNode(host)) continue;
        visited++;
        const hit = shadow.querySelector(selector);
        if (hit) return hit;
        queue.push(shadow);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** True when the element belongs to the extension (overlay host, filters, styles). */
export function isExtensionNode(node: Node | null): boolean {
  if (!node) return false;
  const el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return false;
  if (el.id === OVERLAY_HOST_ID) return true;
  return el.closest(`[${EXT_MARKER_ATTR}]`) !== null;
}

/** Rendered = connected, has a box, not display:none / visibility:hidden. */
export function isRendered(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el.getClientRects().length === 0) return false;
  try {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
  } catch {
    return false;
  }
  return true;
}

/** Bounding rect for an element; for inline elements with several boxes we union them. */
export function elementRect(el: Element): DOMRect {
  return el.getBoundingClientRect();
}

/** Apply a client rect to an absolutely positioned box inside the overlay host. */
export function placeBox(box: HTMLElement, rect: DOMRect, origin: Origin): void {
  box.style.left = `${Math.round(rect.left - origin.x)}px`;
  box.style.top = `${Math.round(rect.top - origin.y)}px`;
  box.style.width = `${Math.max(0, Math.round(rect.width))}px`;
  box.style.height = `${Math.max(0, Math.round(rect.height))}px`;
}

/** Colour used for an issue outline / badge. */
export function issueColor(issue: Issue, colors: OverlayColors["colors"]): string {
  if (issue.wcag.level === "BP") return BP_COLOR;
  if (issue.type === "Semi") return colors.review;
  return colors[issue.severity] ?? colors.Minor;
}

/** Truncate a string for labels / aria-labels. */
export function clip(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

interface HighlightEntry {
  el: Element;
  box: HTMLDivElement;
  badge: HTMLDivElement | null;
  issueId: string;
  index: number;
}

export interface HighlightOptions {
  /** Draw the numbered badges (issues mode). Off for isolated screenshots. */
  withBadges: boolean;
}

/**
 * One instance draws either issues (with badges) or plain selector highlights.
 * The layer element is created by the caller inside the shadow root.
 */
export class Highlighter {
  private readonly layer: HTMLDivElement;
  private entries: HighlightEntry[] = [];
  private colors: OverlayColors;
  private badgeCb: ((issueId: string) => void) | null = null;

  constructor(layer: HTMLDivElement, colors: OverlayColors) {
    this.layer = layer;
    this.colors = colors;
  }

  onBadgeClick(cb: (issueId: string) => void): void {
    this.badgeCb = cb;
  }

  setColors(colors: OverlayColors): void {
    this.colors = colors;
    for (const e of this.entries) {
      if (e.badge) e.badge.style.display = colors.showBadges ? "" : "none";
    }
  }

  /** Rebuild the layer from a list of issues. Badge numbers are index + 1. */
  setIssues(issues: Issue[], options: HighlightOptions, origin: Origin): void {
    this.clear();
    issues.forEach((issue, index) => {
      const el = resolveElement(issue.element.selector);
      if (!el || isExtensionNode(el)) return;
      const color = issueColor(issue, this.colors.colors);
      const box = this.createBox(color);
      box.dataset.issueId = issue.id;
      let badge: HTMLDivElement | null = null;
      if (options.withBadges) {
        badge = this.createBadge(issue, index, color);
        box.appendChild(badge);
      }
      this.layer.appendChild(box);
      this.entries.push({ el, box, badge, issueId: issue.id, index });
    });
    this.reposition(origin);
  }

  /** Outline arbitrary selectors (scope preview) in the accent colour, no badges. */
  setSelectors(selectors: string[], origin: Origin): void {
    this.clear();
    const color = this.colors.colors.review;
    let n = 0;
    for (const selector of selectors) {
      let matches: Element[] = [];
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const el of matches) {
        if (isExtensionNode(el)) continue;
        const box = this.createBox(color);
        this.layer.appendChild(box);
        this.entries.push({ el, box, badge: null, issueId: "", index: n++ });
      }
    }
    this.reposition(origin);
  }

  /** Scroll to the element for an issue and pulse its outline. */
  focus(issueId: string): boolean {
    const entry = this.entries.find((e) => e.issueId === issueId);
    if (!entry || !entry.el.isConnected) return false;
    scrollToElement(entry.el);
    pulse(entry.box);
    return true;
  }

  /** Recompute positions; hides boxes whose element is currently not rendered. */
  reposition(origin: Origin): void {
    for (const e of this.entries) {
      if (!isRendered(e.el)) {
        e.box.style.display = "none";
        continue;
      }
      e.box.style.display = "";
      placeBox(e.box, elementRect(e.el), origin);
    }
  }

  /** Drop boxes whose element left the document. */
  prune(): void {
    if (this.entries.length === 0) return;
    const keep: HighlightEntry[] = [];
    for (const e of this.entries) {
      if (e.el.isConnected) keep.push(e);
      else e.box.remove();
    }
    this.entries = keep;
  }

  clear(): void {
    for (const e of this.entries) e.box.remove();
    this.entries = [];
  }

  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  private createBox(color: string): HTMLDivElement {
    const box = document.createElement("div");
    box.className = "box";
    box.style.setProperty("--c", color);
    return box;
  }

  private createBadge(issue: Issue, index: number, color: string): HTMLDivElement {
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.style.setProperty("--c", color);
    badge.textContent = String(index + 1);
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute("aria-label", `Issue ${index + 1}: ${issue.ruleId} ${clip(issue.title, 80)} (${issue.severity})`);
    badge.title = `${issue.ruleId} · ${clip(issue.title, 80)}`;
    if (!this.colors.showBadges) badge.style.display = "none";

    const activate = (ev: Event): void => {
      ev.preventDefault();
      ev.stopPropagation();
      if (this.badgeCb) {
        try {
          this.badgeCb(issue.id);
        } catch {
          /* callback errors must never break the overlay */
        }
      }
    };
    badge.addEventListener("click", activate);
    badge.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") activate(ev);
    });
    // Keep page handlers (e.g. mousedown-to-close menus) from reacting to the badge.
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup"]) {
      badge.addEventListener(type, (ev) => ev.stopPropagation());
    }
    return badge;
  }
}

/** scrollIntoView (centre, smooth) guarded for detached or odd elements. */
export function scrollToElement(el: Element): void {
  try {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  } catch {
    try {
      el.scrollIntoView();
    } catch {
      /* ignore */
    }
  }
}

/** Restart the pulse animation on a box. */
export function pulse(box: HTMLElement): void {
  box.classList.remove("pulse");
  // Force a reflow so re-adding the class restarts the animation.
  void box.offsetWidth;
  box.classList.add("pulse");
  const done = (): void => {
    box.classList.remove("pulse");
    box.removeEventListener("animationend", done);
  };
  box.addEventListener("animationend", done);
}
