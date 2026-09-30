/**
 * Tab-order layer: an SVG with numbered circles at each focus stop, joined by
 * arrows in visit order, plus translucent red rectangles over trapped elements.
 */
import type { KeyboardTestStep } from "@shared/types";
import type { OverlayColors } from "./types";
import { elementRect, isExtensionNode, isRendered, resolveElement, type Origin } from "./highlighter";

const SVG_NS = "http://www.w3.org/2000/svg";
const RADIUS = 11;
const ARROW_ID = "a11y-checker-arrow";
const TRAP_COLOR = "#d7263d";

interface Stop {
  step: KeyboardTestStep;
  /** Resolved element, or null when the selector no longer matches (we fall back to the recorded box). */
  el: Element | null;
  group: SVGGElement;
}

interface Trap {
  el: Element;
  rect: SVGRectElement;
}

export class TabOrderLayer {
  private readonly svg: SVGSVGElement;
  private readonly defs: SVGDefsElement;
  private readonly arrowPath: SVGPathElement;
  private readonly trapsGroup: SVGGElement;
  private readonly linesGroup: SVGGElement;
  private readonly stopsGroup: SVGGElement;
  private stops: Stop[] = [];
  private traps: Trap[] = [];
  private lines: SVGLineElement[] = [];
  private colors: OverlayColors;

  constructor(parent: HTMLElement, colors: OverlayColors) {
    this.colors = colors;
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "taborder");
    this.svg.setAttribute("aria-hidden", "true");
    this.defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", ARROW_ID);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("markerUnits", "strokeWidth");
    marker.setAttribute("orient", "auto");
    this.arrowPath = document.createElementNS(SVG_NS, "path");
    this.arrowPath.setAttribute("d", "M0,0 L10,5 L0,10 Z");
    this.arrowPath.setAttribute("fill", colors.colors.review);
    marker.appendChild(this.arrowPath);
    this.defs.appendChild(marker);
    this.svg.appendChild(this.defs);
    this.trapsGroup = document.createElementNS(SVG_NS, "g");
    this.linesGroup = document.createElementNS(SVG_NS, "g");
    this.stopsGroup = document.createElementNS(SVG_NS, "g");
    this.svg.append(this.trapsGroup, this.linesGroup, this.stopsGroup);
    this.svg.style.display = "none";
    parent.appendChild(this.svg);
  }

  setColors(colors: OverlayColors): void {
    this.colors = colors;
    this.arrowPath.setAttribute("fill", colors.colors.review);
    for (const s of this.stops) {
      const circle = s.group.querySelector("circle");
      if (circle) circle.setAttribute("fill", colors.colors.review);
    }
    for (const l of this.lines) l.setAttribute("stroke", colors.colors.review);
  }

  draw(path: KeyboardTestStep[], trapSelectors: string[], origin: Origin): void {
    this.clear();
    this.svg.style.display = "";
    const color = this.colors.colors.review;

    path.forEach((step, i) => {
      const el = resolveElement(step.selector);
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", "stop");
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", String(RADIUS));
      circle.setAttribute("fill", color);
      circle.setAttribute("stroke", "#fff");
      circle.setAttribute("stroke-width", "1.5");
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.textContent = String(i + 1);
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${i + 1}. ${step.tagName.toLowerCase()} ${step.accessibleName || step.selector}`;
      group.append(title, circle, text);
      this.stopsGroup.appendChild(group);
      this.stops.push({ step, el: el && !isExtensionNode(el) ? el : null, group });
    });

    for (const selector of trapSelectors) {
      let matches: Element[] = [];
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const el of matches) {
        if (isExtensionNode(el)) continue;
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("class", "trap");
        rect.setAttribute("fill", TRAP_COLOR);
        rect.setAttribute("fill-opacity", "0.25");
        rect.setAttribute("stroke", TRAP_COLOR);
        rect.setAttribute("stroke-width", "2");
        rect.setAttribute("stroke-dasharray", "6 3");
        const title = document.createElementNS(SVG_NS, "title");
        title.textContent = `Keyboard trap: ${selector}`;
        rect.appendChild(title);
        this.trapsGroup.appendChild(rect);
        this.traps.push({ el, rect });
      }
    }

    this.reposition(origin);
  }

  reposition(origin: Origin): void {
    if (this.stops.length === 0 && this.traps.length === 0) return;
    const color = this.colors.colors.review;
    const centres: Array<{ x: number; y: number } | null> = [];

    for (const s of this.stops) {
      const c = this.centreOf(s, origin);
      centres.push(c);
      if (!c) {
        s.group.style.display = "none";
        continue;
      }
      s.group.style.display = "";
      s.group.setAttribute("transform", `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`);
    }

    // Rebuild lines between consecutive visible stops.
    for (const l of this.lines) l.remove();
    this.lines = [];
    let prev: { x: number; y: number } | null = null;
    for (const c of centres) {
      if (!c) continue;
      if (prev) {
        const dx = c.x - prev.x;
        const dy = c.y - prev.y;
        const len = Math.hypot(dx, dy);
        if (len > RADIUS * 2 + 2) {
          const ux = dx / len;
          const uy = dy / len;
          const line = document.createElementNS(SVG_NS, "line");
          line.setAttribute("x1", (prev.x + ux * RADIUS).toFixed(1));
          line.setAttribute("y1", (prev.y + uy * RADIUS).toFixed(1));
          line.setAttribute("x2", (c.x - ux * (RADIUS + 2)).toFixed(1));
          line.setAttribute("y2", (c.y - uy * (RADIUS + 2)).toFixed(1));
          line.setAttribute("stroke", color);
          line.setAttribute("stroke-width", "2");
          line.setAttribute("marker-end", `url(#${ARROW_ID})`);
          this.linesGroup.appendChild(line);
          this.lines.push(line);
        }
      }
      prev = c;
    }

    for (const t of this.traps) {
      if (!isRendered(t.el)) {
        t.rect.style.display = "none";
        continue;
      }
      t.rect.style.display = "";
      const r = elementRect(t.el);
      t.rect.setAttribute("x", (r.left - origin.x).toFixed(1));
      t.rect.setAttribute("y", (r.top - origin.y).toFixed(1));
      t.rect.setAttribute("width", Math.max(0, r.width).toFixed(1));
      t.rect.setAttribute("height", Math.max(0, r.height).toFixed(1));
    }
  }

  /** Drop stops / traps whose (resolved) element left the document. */
  prune(): void {
    const stops: Stop[] = [];
    for (const s of this.stops) {
      if (s.el && !s.el.isConnected) s.group.remove();
      else stops.push(s);
    }
    this.stops = stops;
    const traps: Trap[] = [];
    for (const t of this.traps) {
      if (!t.el.isConnected) t.rect.remove();
      else traps.push(t);
    }
    this.traps = traps;
  }

  clear(): void {
    for (const s of this.stops) s.group.remove();
    for (const t of this.traps) t.rect.remove();
    for (const l of this.lines) l.remove();
    this.stops = [];
    this.traps = [];
    this.lines = [];
    this.svg.style.display = "none";
  }

  private centreOf(stop: Stop, origin: Origin): { x: number; y: number } | null {
    if (stop.el) {
      if (!isRendered(stop.el)) return null;
      const r = elementRect(stop.el);
      return { x: r.left + r.width / 2 - origin.x, y: r.top + r.height / 2 - origin.y };
    }
    // Fallback: the box recorded at test time is in page coordinates.
    const b = stop.step.boundingBox;
    if (!b || (b.width === 0 && b.height === 0)) return null;
    return { x: b.x + b.width / 2 - window.scrollX - origin.x, y: b.y + b.height / 2 - window.scrollY - origin.y };
  }
}
