/**
 * Landmark layer: dashed boxes around landmark regions with a label that shows
 * the landmark role and its accessible name (e.g. "navigation: Main menu").
 */
import { accessibleName } from "@src/content/dom-utils";
import type { OverlayColors } from "./types";
import { INFO_COLOR, clip, elementRect, isExtensionNode, isRendered, placeBox, type Origin } from "./highlighter";

const LANDMARK_SELECTOR = [
  "header",
  "nav",
  "main",
  "aside",
  "footer",
  "form[aria-label]",
  "form[aria-labelledby]",
  "section[aria-label]",
  "section[aria-labelledby]",
  "[role=banner]",
  "[role=navigation]",
  "[role=main]",
  "[role=complementary]",
  "[role=contentinfo]",
  "[role=form]",
  "[role=region]",
  "[role=search]",
].join(", ");

const LANDMARK_ROLES = new Set(["banner", "navigation", "main", "complementary", "contentinfo", "form", "region", "search"]);

/** Sectioning content / roots that demote <header>/<footer> from banner/contentinfo. */
const SECTIONING = "article, aside, main, nav, section, [role=article], [role=complementary], [role=main], [role=navigation], [role=region]";

const ROLE_COLORS: Record<string, string> = {
  banner: "#7048e8",
  navigation: "#1c7ed6",
  main: "#0ca678",
  complementary: "#e8590c",
  contentinfo: "#7048e8",
  form: "#d6336c",
  region: INFO_COLOR,
  search: "#1c7ed6",
};

/** Landmark role for an element, or "" when it is not a landmark. */
export function landmarkRole(el: Element): string {
  const explicit = (el.getAttribute("role") || "").trim().toLowerCase().split(/\s+/)[0] || "";
  if (explicit) return LANDMARK_ROLES.has(explicit) ? explicit : "";
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "aside":
      return "complementary";
    case "header":
    case "footer": {
      const parent = el.parentElement;
      const nested = parent ? parent.closest(SECTIONING) !== null : false;
      if (nested) return "";
      return tag === "header" ? "banner" : "contentinfo";
    }
    case "form":
      return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "form" : "";
    case "section":
      return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "";
    default:
      return "";
  }
}

interface LandmarkEntry {
  el: Element;
  box: HTMLDivElement;
}

export class LandmarkLayer {
  private readonly layer: HTMLDivElement;
  private entries: LandmarkEntry[] = [];
  private colors: OverlayColors;

  constructor(layer: HTMLDivElement, colors: OverlayColors) {
    this.layer = layer;
    this.colors = colors;
  }

  setColors(colors: OverlayColors): void {
    this.colors = colors;
  }

  draw(origin: Origin): void {
    this.clear();
    const candidates = Array.from(document.querySelectorAll(LANDMARK_SELECTOR));
    for (const el of candidates) {
      if (isExtensionNode(el) || !isRendered(el)) continue;
      const role = landmarkRole(el);
      if (!role) continue;
      let name = "";
      try {
        name = clip(accessibleName(el), 60);
      } catch {
        name = "";
      }
      const color = ROLE_COLORS[role] ?? INFO_COLOR;

      const box = document.createElement("div");
      box.className = "lm";
      box.style.setProperty("--c", color);
      const label = document.createElement("div");
      label.className = "lm-label";
      label.style.setProperty("--c", color);
      label.textContent = name ? `${role}: ${name}` : role;
      label.title = `<${el.tagName.toLowerCase()}> role=${role}${name ? ` name="${name}"` : " (no accessible name)"}`;
      box.appendChild(label);
      this.layer.appendChild(box);
      this.entries.push({ el, box });
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
    const keep: LandmarkEntry[] = [];
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
