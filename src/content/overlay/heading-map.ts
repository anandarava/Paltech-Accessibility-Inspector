/**
 * Heading map layer: an "H1".."H6" pill at the top-left of every heading plus a
 * thin outline. A heading whose level jumps by more than one from the previous
 * heading in document order is drawn red with a "skipped" hint.
 */
import type { OverlayColors } from "./types";
import { INFO_COLOR, clip, elementRect, isExtensionNode, isRendered, placeBox, type Origin } from "./highlighter";

interface HeadingEntry {
  el: Element;
  box: HTMLDivElement;
  pill: HTMLDivElement;
}

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6, [role=heading]";

/** Heading level from aria-level (role=heading) or the tag name; 0 when not a heading. */
export function headingLevel(el: Element): number {
  const role = (el.getAttribute("role") || "").trim().toLowerCase();
  const tagMatch = /^h([1-6])$/i.exec(el.tagName);
  if (role === "heading") {
    const raw = parseInt(el.getAttribute("aria-level") || "", 10);
    if (Number.isFinite(raw) && raw >= 1) return Math.min(raw, 9);
    return tagMatch ? Number(tagMatch[1]) : 2; // ARIA default level is 2
  }
  if (role && role !== "heading") return 0; // e.g. <h2 role="presentation">
  return tagMatch ? Number(tagMatch[1]) : 0;
}

export class HeadingLayer {
  private readonly layer: HTMLDivElement;
  private entries: HeadingEntry[] = [];
  private colors: OverlayColors;

  constructor(layer: HTMLDivElement, colors: OverlayColors) {
    this.layer = layer;
    this.colors = colors;
  }

  setColors(colors: OverlayColors): void {
    this.colors = colors;
    for (const e of this.entries) {
      if (e.pill.classList.contains("skipped")) {
        e.box.style.setProperty("--c", colors.colors.Critical);
        e.pill.style.setProperty("--c", colors.colors.Critical);
      }
    }
  }

  draw(origin: Origin): void {
    this.clear();
    let previous = 0;
    const headings = Array.from(document.querySelectorAll(HEADING_SELECTOR));
    for (const el of headings) {
      if (isExtensionNode(el)) continue;
      const level = headingLevel(el);
      if (level === 0) continue;
      if (!isRendered(el)) {
        // Hidden headings still count in the outline order for AT, but we cannot draw them.
        previous = level;
        continue;
      }
      const skipped = previous > 0 && level > previous + 1;
      const color = skipped ? this.colors.colors.Critical : INFO_COLOR;

      const box = document.createElement("div");
      box.className = "box thin";
      box.style.setProperty("--c", color);

      const pill = document.createElement("div");
      pill.className = "pill" + (skipped ? " skipped" : "");
      pill.style.setProperty("--c", color);
      pill.textContent = skipped ? `H${level} · skipped H${previous + 1}` : `H${level}`;
      pill.title = `${skipped ? `Skipped level: H${previous} → H${level}. ` : ""}${clip(el.textContent || "", 80)}`;
      box.appendChild(pill);

      this.layer.appendChild(box);
      this.entries.push({ el, box, pill });
      previous = level;
    }
    this.reposition(origin);
  }

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

  prune(): void {
    const keep: HeadingEntry[] = [];
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
}
