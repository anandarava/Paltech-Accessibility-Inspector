/**
 * Contract for the on-page overlay (Shadow DOM layer) used by the content script.
 * `src/content/overlay/overlay-root.ts` exports `createOverlay(): OverlayController`.
 */
import type { Issue, OverlayMode, ColorBlindnessMode, Severity, KeyboardTestStep } from "@shared/types";

export interface OverlayColors {
  colors: Record<Severity | "review", string>;
  showBadges: boolean;
}

export interface OverlayController {
  /** Mount the shadow host into document.documentElement (idempotent). */
  mount(): void;
  /** Remove the shadow host and all listeners. */
  destroy(): void;
  /** Hide the overlay host entirely (used during scans and screenshots). */
  hide(): void;
  show(): void;
  isVisible(): boolean;
  setColors(colors: OverlayColors): void;
  /** Switch what is drawn. "off" clears everything. */
  setMode(mode: OverlayMode): void;
  getMode(): OverlayMode;
  /** Provide issues for "issues" mode; element lookup is by Issue.element.selector. */
  setIssues(issues: Issue[]): void;
  /** Scroll to one issue's element and keep its outline pulsing until clearFocus() or the next focusIssue(); false if the element no longer exists. */
  focusIssue(issueId: string): boolean;
  /** Remove the pulsing outline drawn by focusIssue(). */
  clearFocus(): void;
  /** Highlight arbitrary selectors (manual checklist). Cleared by clearHighlights(). */
  highlightSelectors(selectors: string[]): void;
  clearHighlights(): void;
  /** Draw only one issue outline (evidence screenshots), remembering previous state. */
  isolateIssue(issueId: string): void;
  /** Restore state saved by isolateIssue(). */
  restore(): void;
  /** Draw a tab-order path (numbered circles joined by arrows) and shade trapped selectors. */
  drawTabOrder(path: KeyboardTestStep[], trapSelectors: string[]): void;
  /** Apply a colour-blindness SVG filter to the page (not to the overlay). */
  setColorBlindness(mode: ColorBlindnessMode): void;
  /** Register the badge click callback (content script forwards ISSUE_CLICKED). */
  onBadgeClick(cb: (issueId: string) => void): void;
  /** Recompute all positions (after layout change). */
  reposition(): void;
}
