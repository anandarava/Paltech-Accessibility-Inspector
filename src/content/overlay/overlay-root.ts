/**
 * Overlay root: a fixed, pointer-transparent host attached to <html> with a
 * closed shadow root. Everything the extension draws on the page lives here:
 *
 *   issues     outlines + numbered badges (Highlighter)
 *   highlights arbitrary selector outlines for the manual checklist (Highlighter)
 *   taborder   SVG numbered path + trap shading (TabOrderLayer)
 *   headings   H1..H6 pills (HeadingLayer)
 *   landmarks  dashed landmark boxes (LandmarkLayer)
 *   names      hover tooltip with role / name / state (NamesLayer)
 *
 * Positions are recomputed from getBoundingClientRect on scroll / resize
 * (passive, rAF-throttled) and when document.body resizes; a MutationObserver
 * only drops boxes whose element left the document.
 */
import type { ColorBlindnessMode, Issue, KeyboardTestStep, OverlayMode } from "@shared/types";
import { DEFAULT_SETTINGS, EXT_MARKER_ATTR, OVERLAY_HOST_ID } from "@shared/constants";
import { applyColorBlindness, removeColorBlindness } from "@src/content/simulators/color-blindness";
import type { OverlayColors, OverlayController } from "./types";
import { Highlighter, isExtensionNode, pulse, resolveElement, scrollToElement, type Origin, ZERO_ORIGIN, isRendered, elementRect, placeBox, issueColor } from "./highlighter";
import { TabOrderLayer } from "./tab-order";
import { HeadingLayer } from "./heading-map";
import { LandmarkLayer } from "./landmarks";
import { NamesLayer } from "./names";

const HOST_STYLE =
  "all:initial!important;position:fixed!important;inset:0!important;top:0!important;left:0!important;width:auto!important;height:auto!important;" +
  "margin:0!important;padding:0!important;border:0!important;overflow:visible!important;pointer-events:none!important;" +
  "z-index:2147483647!important;display:block!important;contain:layout style!important;";

const SHADOW_CSS = `
:host { font: 11px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; }
*, *::before, *::after { box-sizing: border-box; }
.layer { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.box {
  position: absolute; pointer-events: none;
  border: 2px solid var(--c, #2e86de); border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.55), 0 0 0 1px rgba(0,0,0,.25);
}
.box.thin { border-width: 1px; box-shadow: none; }
.box.pulse { animation: a11y-pulse 0.9s ease-out 3; }
/* The issue open in the panel: pulses until another issue is opened or the panel leaves it. */
.box.focused { border-width: 3px; animation: a11y-pulse 1.2s ease-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .box.pulse, .box.focused { animation: none; }
  .box.focused { box-shadow: 0 0 0 2px #fff, 0 0 0 5px var(--c, #2e86de); }
}
@keyframes a11y-pulse {
  0%   { box-shadow: 0 0 0 0 var(--c, #2e86de), inset 0 0 0 1px rgba(255,255,255,.55); }
  60%  { box-shadow: 0 0 0 12px rgba(0,0,0,0), inset 0 0 0 1px rgba(255,255,255,.55); }
  100% { box-shadow: 0 0 0 0 rgba(0,0,0,0), inset 0 0 0 1px rgba(255,255,255,.55); }
}
.badge {
  position: absolute; left: -2px; top: -2px; transform: translate(-40%, -40%);
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
  background: var(--c, #2e86de); color: #fff; font-weight: 700; font-size: 11px; line-height: 20px;
  text-align: center; white-space: nowrap; text-shadow: 0 0 2px rgba(0,0,0,.9), 0 1px 1px rgba(0,0,0,.6);
  box-shadow: 0 0 0 1.5px #fff, 0 1px 4px rgba(0,0,0,.5);
  pointer-events: auto; cursor: pointer; user-select: none; -webkit-user-select: none;
}
.badge:hover { filter: brightness(1.1); }
.badge:focus { outline: none; }
.badge:focus-visible { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #000; }
.pill, .lm-label {
  position: absolute; left: -1px; top: -1px; transform: translateY(-100%);
  padding: 1px 5px; border-radius: 3px 3px 3px 0;
  background: var(--c, #0b7285); color: #fff; font-weight: 700; font-size: 11px; line-height: 15px;
  white-space: nowrap; text-shadow: 0 0 2px rgba(0,0,0,.9), 0 1px 1px rgba(0,0,0,.6);
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
}
.lm { position: absolute; pointer-events: none; border: 2px dashed var(--c, #0b7285); border-radius: 3px; background: color-mix(in srgb, var(--c, #0b7285) 6%, transparent); }
.lm-label { transform: none; left: 0; top: 0; border-radius: 0 0 3px 0; font-weight: 600; }
svg.taborder { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
svg.taborder text { fill: #fff; font: 700 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; paint-order: stroke; stroke: rgba(0,0,0,.75); stroke-width: 2px; stroke-linejoin: round; }
.tooltip {
  position: absolute; max-width: 360px; padding: 6px 8px; border-radius: 4px;
  background: rgba(17, 24, 39, .95); color: #fff; font-size: 11px; line-height: 1.35;
  box-shadow: 0 2px 8px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.15);
  text-shadow: 0 1px 1px rgba(0,0,0,.6); pointer-events: none; white-space: normal; word-break: break-word;
}
.tooltip .tt-role { font-weight: 700; text-transform: lowercase; color: #ffd43b; }
.tooltip .tt-name { margin-top: 2px; }
.tooltip .tt-name.empty { font-style: italic; color: #ffa8a8; }
.tooltip .tt-state { margin-top: 2px; color: #a5d8ff; }
`;

interface SavedState {
  mode: OverlayMode;
  issues: Issue[];
  highlightsDisplay: string;
}

interface Flash {
  el: Element;
  box: HTMLDivElement;
}

export function createOverlay(): OverlayController {
  let host: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  let layers: {
    highlights: HTMLDivElement;
    issues: HTMLDivElement;
    flash: HTMLDivElement;
    headings: HTMLDivElement;
    landmarks: HTMLDivElement;
    taborder: HTMLDivElement;
    names: HTMLDivElement;
  } | null = null;
  let issuesLayer: Highlighter | null = null;
  let highlightLayer: Highlighter | null = null;
  let tabLayer: TabOrderLayer | null = null;
  let headingLayer: HeadingLayer | null = null;
  let landmarkLayer: LandmarkLayer | null = null;
  let namesLayer: NamesLayer | null = null;

  let mode: OverlayMode = "off";
  let issues: Issue[] = [];
  let highlighted: string[] = [];
  let tabPath: KeyboardTestStep[] = [];
  let trapSelectors: string[] = [];
  let colors: OverlayColors = {
    colors: { ...DEFAULT_SETTINGS.overlay.colors },
    showBadges: DEFAULT_SETTINGS.overlay.showBadges,
  };
  let visible = true;
  let isolated: Issue | null = null;
  let saved: SavedState | null = null;
  let badgeCb: ((issueId: string) => void) | null = null;
  let flash: Flash | null = null;
  /** Issue shown with the persistent focus outline (restored after an evidence screenshot). */
  let focusedId: string | null = null;

  let resizeObserver: ResizeObserver | null = null;
  let observedBody: Element | null = null;
  let mutationObserver: MutationObserver | null = null;
  let rafId = 0;
  let needPrune = false;

  // ---------- host ----------

  function ensureBodyObserved(): void {
    if (!resizeObserver) return;
    const target = document.body ?? document.documentElement;
    try {
      resizeObserver.disconnect();
      resizeObserver.observe(target);
      if (target !== document.documentElement) resizeObserver.observe(document.documentElement);
      observedBody = document.body;
    } catch {
      /* ResizeObserver can throw on detached nodes; ignore */
    }
  }

  function scheduleFrame(prune: boolean): void {
    if (prune) needPrune = true;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!host) return;
      if (needPrune) {
        needPrune = false;
        pruneAll();
      }
      repositionAll();
    });
  }

  const onScroll = (): void => scheduleFrame(false);
  const onResize = (): void => scheduleFrame(false);

  const onMutations = (records: MutationRecord[]): void => {
    if (!host) return;
    let relevant = false;
    for (const r of records) {
      if (isExtensionNode(r.target)) continue;
      // Skip records that only add/remove our own nodes (host, filter svg, style).
      const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
      if (nodes.length > 0 && nodes.every((n) => isExtensionNode(n))) continue;
      relevant = true;
      break;
    }
    if (!relevant) return;
    // If the page wiped <html> children, re-attach the host.
    if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
    // <body> replaced (e.g. by a framework re-mount): re-observe the new one.
    if (resizeObserver && observedBody !== document.body) ensureBodyObserved();
    scheduleFrame(true);
  };

  function mount(): void {
    if (host && shadow && layers) {
      if (!host.isConnected) document.documentElement.appendChild(host);
      return;
    }
    host = document.createElement("div");
    host.id = OVERLAY_HOST_ID;
    host.setAttribute(EXT_MARKER_ATTR, "overlay");
    host.setAttribute("aria-label", "PalTech A11y Inspector overlay");
    host.style.cssText = HOST_STYLE;
    shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = SHADOW_CSS;
    shadow.appendChild(style);

    const root = shadow;
    const mk = (name: string): HTMLDivElement => {
      const div = document.createElement("div");
      div.className = `layer ${name}`;
      root.appendChild(div);
      return div;
    };
    layers = {
      landmarks: mk("landmarks"),
      headings: mk("headings"),
      highlights: mk("highlights"),
      issues: mk("issues"),
      flash: mk("flash"),
      taborder: mk("taborder-wrap"),
      names: mk("names"),
    };
    issuesLayer = new Highlighter(layers.issues, colors);
    if (badgeCb) issuesLayer.onBadgeClick(badgeCb);
    highlightLayer = new Highlighter(layers.highlights, colors);
    tabLayer = new TabOrderLayer(layers.taborder, colors);
    headingLayer = new HeadingLayer(layers.headings, colors);
    landmarkLayer = new LandmarkLayer(layers.landmarks, colors);
    namesLayer = new NamesLayer(layers.names, colors);

    document.documentElement.appendChild(host);
    if (!visible) host.style.setProperty("display", "none", "important");

    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => scheduleFrame(false));
      ensureBodyObserved();
    }
    mutationObserver = new MutationObserver(onMutations);
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function destroy(): void {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    window.removeEventListener("resize", onResize);
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedBody = null;
    mutationObserver?.disconnect();
    mutationObserver = null;
    clearFlash();
    namesLayer?.disable();
    issuesLayer?.clear();
    highlightLayer?.clear();
    tabLayer?.clear();
    headingLayer?.clear();
    landmarkLayer?.clear();
    host?.remove();
    host = null;
    shadow = null;
    layers = null;
    issuesLayer = null;
    highlightLayer = null;
    tabLayer = null;
    headingLayer = null;
    landmarkLayer = null;
    namesLayer = null;
    mode = "off";
    issues = [];
    highlighted = [];
    tabPath = [];
    trapSelectors = [];
    isolated = null;
    saved = null;
    removeColorBlindness();
  }

  // ---------- geometry ----------

  function origin(): Origin {
    if (!host || !host.isConnected) return ZERO_ORIGIN;
    const r = host.getBoundingClientRect();
    // A healthy fixed host sits at (0,0); anything else (page transforms, filter
    // on <html>) is compensated for here.
    return { x: r.left, y: r.top };
  }

  function repositionAll(): void {
    if (!host || !visible) return;
    const o = origin();
    highlightLayer?.reposition(o);
    switch (mode) {
      case "issues":
        issuesLayer?.reposition(o);
        break;
      case "taborder":
        tabLayer?.reposition(o);
        break;
      case "headings":
        headingLayer?.reposition(o);
        break;
      case "landmarks":
        landmarkLayer?.reposition(o);
        break;
      case "names":
        namesLayer?.reposition(o);
        break;
      case "off":
        break;
    }
    if (flash) {
      if (isRendered(flash.el)) {
        flash.box.style.display = "";
        placeBox(flash.box, elementRect(flash.el), o);
      } else {
        flash.box.style.display = "none";
      }
    }
  }

  function pruneAll(): void {
    issuesLayer?.prune();
    highlightLayer?.prune();
    tabLayer?.prune();
    headingLayer?.prune();
    landmarkLayer?.prune();
    namesLayer?.prune();
    if (flash && !flash.el.isConnected) clearFlash();
  }

  // ---------- rendering ----------

  function clearModeLayers(): void {
    issuesLayer?.clear();
    tabLayer?.clear();
    headingLayer?.clear();
    landmarkLayer?.clear();
    namesLayer?.disable();
    namesLayer?.clear();
  }

  function render(): void {
    if (mode === "off") {
      if (!host) return;
      clearModeLayers();
      return;
    }
    mount();
    clearModeLayers();
    const o = origin();
    switch (mode) {
      case "issues":
        if (isolated) issuesLayer?.setIssues([isolated], { withBadges: false }, o);
        else issuesLayer?.setIssues(issues, { withBadges: true }, o);
        break;
      case "taborder":
        tabLayer?.draw(tabPath, trapSelectors, o);
        break;
      case "headings":
        headingLayer?.draw(o);
        break;
      case "landmarks":
        landmarkLayer?.draw(o);
        break;
      case "names":
        namesLayer?.enable();
        break;
    }
  }

  function clearFlash(): void {
    if (!flash) return;
    flash.box.remove();
    flash = null;
  }

  /**
   * Continuously pulsing outline around the issue that is open in the panel.
   * Drawn in its own layer (above the issue outlines) so it survives redraws of
   * the active overlay mode; it stays until clearFocus() or another focusIssue().
   */
  function flashElement(el: Element, color: string): void {
    if (!layers) return;
    clearFlash();
    const box = document.createElement("div");
    box.className = "box focused";
    box.style.setProperty("--c", color);
    layers.flash.appendChild(box);
    flash = { el, box };
    placeBox(box, elementRect(el), origin());
  }

  // ---------- controller ----------

  const controller: OverlayController = {
    mount,
    destroy,

    hide(): void {
      visible = false;
      host?.style.setProperty("display", "none", "important");
    },

    show(): void {
      visible = true;
      if (host) {
        host.style.setProperty("display", "block", "important");
        scheduleFrame(false);
      }
    },

    isVisible(): boolean {
      return visible && host !== null && host.isConnected;
    },

    setColors(next: OverlayColors): void {
      colors = { colors: { ...colors.colors, ...next.colors }, showBadges: next.showBadges };
      issuesLayer?.setColors(colors);
      highlightLayer?.setColors(colors);
      tabLayer?.setColors(colors);
      headingLayer?.setColors(colors);
      landmarkLayer?.setColors(colors);
      namesLayer?.setColors(colors);
      // Outline colours are baked in at draw time; redraw the active mode.
      if (host && mode !== "off") render();
      if (host && highlighted.length) highlightLayer?.setSelectors(highlighted, origin());
    },

    setMode(next: OverlayMode): void {
      mode = next;
      render();
    },

    getMode(): OverlayMode {
      return mode;
    },

    setIssues(next: Issue[]): void {
      issues = next.slice();
      // The pulsing issue is gone (a rescan gives every issue a new id): stop pulsing.
      if (focusedId && !issues.some((i) => i.id === focusedId) && isolated?.id !== focusedId) {
        focusedId = null;
        clearFlash();
      }
      if (mode === "issues" && !isolated) render();
    },

    focusIssue(issueId: string): boolean {
      const issue = issues.find((i) => i.id === issueId) ?? (isolated?.id === issueId ? isolated : undefined);
      if (!issue) return false;
      const el = resolveElement(issue.element.selector);
      if (!el || !el.isConnected) return false;
      mount();
      focusedId = issue.id;
      scrollToElement(el);
      flashElement(el, issueColor(issue, colors.colors));
      return true;
    },

    clearFocus(): void {
      focusedId = null;
      clearFlash();
    },

    highlightSelectors(selectors: string[]): void {
      highlighted = selectors.slice();
      mount();
      highlightLayer?.setSelectors(highlighted, origin());
    },

    clearHighlights(): void {
      highlighted = [];
      highlightLayer?.clear();
    },

    isolateIssue(issueId: string): void {
      const issue = issues.find((i) => i.id === issueId);
      if (!issue) return;
      mount();
      if (!saved) {
        saved = { mode, issues, highlightsDisplay: layers?.highlights.style.display ?? "" };
      }
      clearFlash();
      if (layers) layers.highlights.style.display = "none";
      isolated = issue;
      mode = "issues";
      render();
      repositionAll();
    },

    restore(): void {
      if (!saved) {
        isolated = null;
        return;
      }
      const s = saved;
      saved = null;
      isolated = null;
      if (layers) layers.highlights.style.display = s.highlightsDisplay;
      issues = s.issues;
      mode = s.mode;
      render();
      // Put the focus outline back (without scrolling) if an issue was open before the screenshot.
      const focused = focusedId ? issues.find((i) => i.id === focusedId) : undefined;
      const el = focused ? resolveElement(focused.element.selector) : null;
      if (focused && el?.isConnected) flashElement(el, issueColor(focused, colors.colors));
    },

    drawTabOrder(path: KeyboardTestStep[], traps: string[]): void {
      tabPath = path.slice();
      trapSelectors = traps.slice();
      mode = "taborder";
      render();
    },

    setColorBlindness(cvd: ColorBlindnessMode): void {
      try {
        applyColorBlindness(cvd);
      } catch {
        /* a broken page DOM must not break the overlay */
      }
      // The filter changes the host's containing block; re-anchor everything.
      scheduleFrame(false);
    },

    onBadgeClick(cb: (issueId: string) => void): void {
      badgeCb = cb;
      issuesLayer?.onBadgeClick(cb);
    },

    reposition(): void {
      if (!host) return;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (needPrune) {
        needPrune = false;
        pruneAll();
      }
      repositionAll();
    },
  };

  return controller;
}
