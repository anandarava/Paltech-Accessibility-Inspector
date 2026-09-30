/**
 * Content script entry (isolated world, bundled as a standalone IIFE with
 * axe-core). Injected programmatically into every frame; only the top frame
 * mounts the overlay and watches for SPA changes. Every request from the
 * service worker / UI is answered with a `Response` envelope.
 */
import type { Message, Response, ScanOptions } from "@shared/messages";
import { isMessage } from "@shared/messages";
import type { BoundingBox, Issue, KeyboardTestResult, KeyboardTestStep, RuleConfig, RulesFile, ScanResult, Settings } from "@shared/types";
import { DEFAULT_RULE_CONFIG, DEFAULT_SETTINGS } from "@shared/constants";
import rulesJson from "@shared/a11y-rules.json";
import { getRuleConfig, getSettings } from "@src/background/storage";
import type { OverlayController } from "./overlay/types";
import { createOverlay } from "./overlay/overlay-root";
import { startSpaObserver } from "./observers/spa-observer";
import { scanFrame, type FrameScanOutput } from "./scanner";
import { fingerprint, textSnippet } from "./fingerprint";
import { accessibleName, boundingBoxes, getFocusableElements, isExtensionNode, resolveSelector, uniqueSelector } from "./dom-utils";
import { cancelPicker, startPicker } from "./picker";

declare global {
  interface Window {
    __a11yCheckerLoaded?: boolean;
  }
}

type Handled = Response<unknown> | undefined;
type OutboundEvent =
  | { type: "SCAN_PROGRESS"; percent: number; stage: string }
  | { type: "PAGE_CHANGED"; reason: "route" | "dialog" | "dom" }
  | { type: "ISSUE_CLICKED"; issueId: string }
  | { type: "KEYBOARD_TEST_PROGRESS"; step: number; selector: string }
  | { type: "KEYBOARD_TEST_RESULT"; result: KeyboardTestResult }
  | { type: "PICKER_RESULT"; selector: string | null; html?: string };

const RULES_FILE = rulesJson as unknown as RulesFile;
const DEFAULT_SCAN_OPTIONS: ScanOptions = { scope: "page", wcagLevel: "AA", rules: [], includeBestPractices: true };

/** Messages this script answers. Anything else is left for other listeners. */
const HANDLED_TYPES = new Set<string>([
  "CS_PING",
  "SCAN_START",
  "SCAN_RESULT",
  "HIGHLIGHT_ISSUE",
  "TOGGLE_OVERLAY",
  "SET_COLOR_BLINDNESS",
  "HIGHLIGHT_SELECTORS",
  "CLEAR_HIGHLIGHTS",
  "CS_GET_ACTIVE_ELEMENT",
  "CS_FOCUS_FIRST",
  "CS_GET_ELEMENT_BOX",
  "CS_PREPARE_SCREENSHOT",
  "CS_RESTORE_AFTER_SCREENSHOT",
  "CS_SET_ISSUE_STATUS",
  "KEYBOARD_TEST_START",
  "KEYBOARD_TEST_STOP",
  "KEYBOARD_TEST_RESULT",
  "SETTINGS_CHANGED",
  "PICKER_START",
  "PICKER_CANCEL",
]);

/** Overlay-related messages: child frames have no overlay and stay silent so the top frame answers. */
const TOP_ONLY_TYPES = new Set<string>([
  "SCAN_RESULT",
  "HIGHLIGHT_ISSUE",
  "TOGGLE_OVERLAY",
  "SET_COLOR_BLINDNESS",
  "HIGHLIGHT_SELECTORS",
  "CLEAR_HIGHLIGHTS",
  "KEYBOARD_TEST_START",
  "KEYBOARD_TEST_STOP",
  "KEYBOARD_TEST_RESULT",
  "SETTINGS_CHANGED",
  "PICKER_START",
  "PICKER_CANCEL",
]);

/**
 * Messages every frame can answer. When the sender broadcasts to all frames
 * (no frameId) Chrome keeps the first response, so child frames answer after
 * a short delay to let the top frame win; explicit frameId targeting still
 * reaches them.
 */
const CHILD_DELAY_TYPES = new Set<string>(["CS_GET_ACTIVE_ELEMENT", "CS_FOCUS_FIRST", "CS_GET_ELEMENT_BOX", "CS_PREPARE_SCREENSHOT", "CS_RESTORE_AFTER_SCREENSHOT", "CS_SET_ISSUE_STATUS"]);
const CHILD_RESPONSE_DELAY_MS = 25;

function computeIsTop(): boolean {
  try {
    return window === window.top;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const isTop = computeIsTop();
let overlay: OverlayController | null = null;
let stopSpaObserver: (() => void) | null = null;
let settings: Settings = DEFAULT_SETTINGS;
/** Merged result pushed by the service worker (when it forwards SCAN_RESULT to the tab). */
let lastResult: ScanResult | null = null;
/** Issues produced by this frame's most recent scan (used until a merged result arrives). */
let localIssues: Issue[] = [];
let lastScanOptions: ScanOptions | null = null;
let lastKeyboardPath: KeyboardTestStep[] = [];
let lastTrapSelectors: string[] = [];
let tornDown = false;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ok<T>(data?: T): Response<T> {
  return data === undefined ? { ok: true } : { ok: true, data };
}

function fail(error: string): Response<never> {
  return { ok: false, error };
}

function teardown(): void {
  if (tornDown) return;
  tornDown = true;
  try {
    stopSpaObserver?.();
  } catch {
    /* ignore */
  }
  stopSpaObserver = null;
  try {
    stopGuidedKeyboardTest(false);
  } catch {
    /* ignore */
  }
  try {
    cancelPicker();
  } catch {
    /* ignore */
  }
  try {
    overlay?.setColorBlindness("none");
    overlay?.destroy();
  } catch {
    /* ignore */
  }
  overlay = null;
}

/** Fire-and-forget broadcast to the service worker (no tabId: the SW fills it in). */
function sendEvent(event: OutboundEvent): void {
  if (tornDown) return;
  try {
    chrome.runtime.sendMessage(event as unknown as Message, () => {
      // Reading lastError marks it handled; a sleeping/absent receiver is not an error here.
      void chrome.runtime.lastError;
    });
  } catch (e) {
    // "Extension context invalidated": the extension was reloaded; leave the page clean.
    if (/context invalidated/i.test(errorMessage(e))) teardown();
  }
}

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      requestAnimationFrame(() => finish());
    } catch {
      finish();
    }
    // Hidden tabs never fire rAF; do not hang the caller.
    setTimeout(finish, 150);
  });
}

async function loadSettings(): Promise<Settings> {
  try {
    const s = await getSettings();
    if (s && typeof s === "object") settings = s;
  } catch {
    settings = DEFAULT_SETTINGS;
  }
  return settings;
}

async function loadRuleConfig(): Promise<RuleConfig> {
  try {
    const c = await getRuleConfig();
    if (c && typeof c === "object" && Array.isArray(c.disabled)) return { disabled: c.disabled, thresholds: c.thresholds ?? {} };
  } catch {
    /* fall back below */
  }
  return { disabled: [...DEFAULT_RULE_CONFIG.disabled], thresholds: { ...DEFAULT_RULE_CONFIG.thresholds } };
}

function allIssues(): Issue[] {
  if (lastResult) return lastResult.issues;
  return localIssues;
}

function isActiveIssue(issue: Issue): boolean {
  return issue.status === "new";
}

function findIssue(issueId: string): Issue | undefined {
  return localIssues.find((i) => i.id === issueId) ?? lastResult?.issues.find((i) => i.id === issueId);
}

// ---------------------------------------------------------------------------
// Element lookup across documents
//
// Issue selectors / xpaths are relative to the root the scanner found the
// element in: the top document, an open shadow root, or a child frame (the
// service worker merges every frame's issues into one list and always talks
// to frame 0). Lookups therefore try the top document first and fall back to
// every same-origin frame and open shadow root, verifying candidates against
// the issue fingerprint so a child-frame `#email` is never mistaken for an
// unrelated top-frame `#email`. Cross-origin frames stay out of reach.
// ---------------------------------------------------------------------------

const MAX_ROOT_DEPTH = 8;
const MAX_ROOTS = 200;

interface SearchRoot {
  root: Document | ShadowRoot;
  /** Top-viewport coordinates of this root's (0, 0); non-zero inside frames. */
  offsetX: number;
  offsetY: number;
  /** Part of the top viewport this root can paint into (null = unbounded). */
  clip: BoundingBox | null;
}

interface SearchRoots {
  roots: SearchRoot[];
  /** Top-viewport boxes of rendered frames whose document is not accessible (cross-origin / sandboxed). */
  opaqueFrames: BoundingBox[];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function intersectBox(a: BoundingBox, b: BoundingBox | null): BoundingBox | null {
  if (!b) return a;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** localName rather than instanceof: elements of child documents belong to another realm. */
function isFrameElement(el: Element): el is HTMLIFrameElement | HTMLFrameElement {
  return el.localName === "iframe" || el.localName === "frame";
}

function frameDocument(frame: HTMLIFrameElement | HTMLFrameElement): Document | null {
  try {
    const doc = frame.contentDocument;
    return doc && doc.documentElement ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Purely visual visibility, i.e. "will the screenshot show it". Unlike
 * dom-utils isVisible() it ignores aria-hidden (the page behind an open modal
 * is aria-hidden yet still painted) and errs on the side of "rendered".
 */
function isRenderedForRedaction(el: Element): boolean {
  if (!el.isConnected) return false;
  try {
    const withCheck = el as Element & { checkVisibility?: (opts?: { visibilityProperty?: boolean; opacityProperty?: boolean }) => boolean };
    if (typeof withCheck.checkVisibility === "function") return withCheck.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const view = el.ownerDocument.defaultView ?? window;
    let node: Element | null = el;
    while (node) {
      if (view.getComputedStyle(node).display === "none") return false;
      node = node.parentElement;
    }
    const style = view.getComputedStyle(el);
    return style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
  } catch {
    return true;
  }
}

/** The top document plus every open shadow root and same-origin frame document, with their viewport offsets. */
function collectSearchRoots(): SearchRoots {
  const out: SearchRoots = { roots: [], opaqueFrames: [] };
  const visit = (root: Document | ShadowRoot, offsetX: number, offsetY: number, clip: BoundingBox | null, depth: number): void => {
    if (out.roots.length >= MAX_ROOTS) return;
    out.roots.push({ root, offsetX, offsetY, clip });
    if (depth >= MAX_ROOT_DEPTH) return;
    let elements: Element[];
    try {
      elements = Array.from(root.querySelectorAll("*"));
    } catch {
      return;
    }
    for (const el of elements) {
      if (out.roots.length >= MAX_ROOTS) return;
      if (isExtensionNode(el)) continue;
      if (el.shadowRoot) visit(el.shadowRoot, offsetX, offsetY, clip, depth + 1);
      if (!isFrameElement(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const doc = frameDocument(el);
      if (doc) {
        // A child document paints inside the frame's content box.
        const x = offsetX + rect.left + el.clientLeft;
        const y = offsetY + rect.top + el.clientTop;
        const contentBox: BoundingBox = { x, y, width: el.clientWidth, height: el.clientHeight };
        visit(doc, x, y, intersectBox(contentBox, clip) ?? { x, y, width: 0, height: 0 }, depth + 1);
      } else if (isRenderedForRedaction(el)) {
        const box = intersectBox({ x: offsetX + rect.left, y: offsetY + rect.top, width: rect.width, height: rect.height }, clip);
        if (box) out.opaqueFrames.push(box);
      }
    }
  };
  visit(document, 0, 0, null, 0);
  return out;
}

function resolveByXPath(path: string, doc: Document): Element | null {
  if (!path || path.includes("//")) return null;
  try {
    const result = doc.evaluate(path, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const node = result.singleNodeValue;
    return node && node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
  } catch {
    return null;
  }
}

function resolveInRoot(issue: Issue, root: Document | ShadowRoot): Element | null {
  const el = resolveSelector(issue.element.selector, root);
  if (el) return el;
  return root.nodeType === Node.DOCUMENT_NODE ? resolveByXPath(issue.element.xpath, root as Document) : null;
}

/** True when `el` still hashes to the issue's fingerprint (same rule, selector and text). */
function matchesFingerprint(issue: Issue, el: Element): boolean {
  if (!issue.fingerprint) return true;
  try {
    return fingerprint(issue.ruleId, issue.element.selector, textSnippet(el)) === issue.fingerprint;
  } catch {
    return false;
  }
}

/**
 * Resolves the element of an issue. The top document wins when its match is
 * verified by the fingerprint; otherwise same-origin frames and open shadow
 * roots are searched, and an unverified top-document match (text may simply
 * have changed) is kept as the fallback. `roots` lets callers that resolve
 * many issues share one DOM walk.
 */
function elementForIssue(issue: Issue, roots?: () => SearchRoot[]): Element | null {
  const direct = resolveInRoot(issue, document);
  if (direct && matchesFingerprint(issue, direct)) return direct;
  let fallback = direct;
  const scopes = roots ? roots() : collectSearchRoots().roots;
  for (const scope of scopes) {
    if (scope.root === document) continue;
    const el = resolveInRoot(issue, scope.root);
    if (!el) continue;
    if (matchesFingerprint(issue, el)) return el;
    if (!fallback) fallback = el;
  }
  return fallback;
}

/**
 * Viewport box of an element in top-frame coordinates: getBoundingClientRect()
 * is relative to the element's own frame, so walk up the (same-origin) frame
 * elements, clipping to each frame's content box on the way.
 */
function topViewportBox(el: Element): BoundingBox {
  const rect = el.getBoundingClientRect();
  let box: BoundingBox = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  let win: Window | null = el.ownerDocument.defaultView;
  for (let guard = 0; win && win !== window && guard < MAX_ROOT_DEPTH; guard++) {
    let frame: Element | null = null;
    try {
      frame = win.frameElement;
    } catch {
      break;
    }
    if (!frame) break;
    const clipped = intersectBox(box, { x: 0, y: 0, width: frame.clientWidth, height: frame.clientHeight });
    const fr = frame.getBoundingClientRect();
    const dx = fr.left + frame.clientLeft;
    const dy = fr.top + frame.clientTop;
    box = clipped ? { x: clipped.x + dx, y: clipped.y + dy, width: clipped.width, height: clipped.height } : { x: box.x + dx, y: box.y + dy, width: 0, height: 0 };
    win = frame.ownerDocument.defaultView;
  }
  return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
}

// ---------------------------------------------------------------------------
// Overlay issue list
// ---------------------------------------------------------------------------

/** A selector that matches nothing: the overlay skips the entry but its index (badge number) is preserved. */
const OVERLAY_HIDDEN_SELECTOR = ":not(*)";

function hiddenFromOverlay(issue: Issue): Issue {
  return { ...issue, element: { ...issue.element, selector: OVERLAY_HIDDEN_SELECTOR } };
}

/**
 * The list handed to the overlay. It keeps exactly the order and length of
 * allIssues(), so badge numbers (index + 1) equal the side panel's
 * issueNumbers() and stay put when an issue is ignored or baselined. Entries
 * that must not be drawn (inactive, or living in a child frame / shadow root
 * the overlay cannot resolve, where the selector could even hit an unrelated
 * top-frame element) are replaced by a copy whose selector matches nothing.
 */
function overlayIssues(): Issue[] {
  let roots: SearchRoot[] | null = null;
  const getRoots = (): SearchRoot[] => {
    if (!roots) roots = collectSearchRoots().roots;
    return roots;
  };
  return allIssues().map((issue) => {
    if (!isActiveIssue(issue)) return hiddenFromOverlay(issue);
    const el = elementForIssue(issue, getRoots);
    if (el && el.getRootNode() !== document) return hiddenFromOverlay(issue);
    return issue;
  });
}

function pushOverlayIssues(): void {
  if (!overlay) return;
  try {
    overlay.setIssues(overlayIssues());
  } catch (e) {
    console.warn("[a11y-checker] overlay.setIssues failed:", e);
  }
}

function applyOverlayColors(): void {
  if (!overlay) return;
  try {
    overlay.setColors({ colors: { ...DEFAULT_SETTINGS.overlay.colors, ...(settings.overlay?.colors ?? {}) }, showBadges: settings.overlay?.showBadges ?? true });
  } catch (e) {
    console.warn("[a11y-checker] overlay.setColors failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Focus / keyboard helpers
// ---------------------------------------------------------------------------

let focusableCache: { at: number; list: HTMLElement[] } | null = null;

function focusables(): HTMLElement[] {
  const now = performance.now();
  if (focusableCache && now - focusableCache.at < 500) return focusableCache.list;
  const list = getFocusableElements(document);
  focusableCache = { at: now, list };
  return list;
}

function deepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  let guard = 0;
  while (el && el.shadowRoot && el.shadowRoot.activeElement && guard++ < 20) el = el.shadowRoot.activeElement;
  return el;
}

function describeElement(el: Element | null, index: number): KeyboardTestStep {
  if (!el || el === document.body || el === document.documentElement) {
    const body = document.body ?? document.documentElement;
    return { index, selector: "body", boundingBox: boundingBoxes(body).page, tagName: "BODY", accessibleName: "" };
  }
  const isFrame = el.localName === "iframe" || el.localName === "frame";
  return {
    index,
    selector: uniqueSelector(el),
    boundingBox: boundingBoxes(el).page,
    tagName: isFrame ? "IFRAME" : el.tagName.toUpperCase(),
    accessibleName: isFrame ? accessibleName(el) || (el.getAttribute("src") ?? "") : accessibleName(el),
  };
}

function describeActive(): KeyboardTestStep {
  const el = deepActiveElement();
  const index = el instanceof HTMLElement ? focusables().indexOf(el) : -1;
  return describeElement(el, index);
}

function staticTabOrder(): KeyboardTestStep[] {
  return focusables()
    .slice(0, 500)
    .map((el, i) => describeElement(el, i));
}

// ---------------------------------------------------------------------------
// Keyboard test: record focus changes while the tester presses Tab in the page.
// The cycle ends when focus returns to the first element Tabbed to; a small set
// of elements repeating (or a short loop back to the start) is a trap. Broadcasts
// KEYBOARD_TEST_PROGRESS / RESULT; the service worker fills in the tabId.
// ---------------------------------------------------------------------------

const GUIDED_TRAP_WINDOW = 8;
const GUIDED_TRAP_MAX_DISTINCT = 4;
const GUIDED_MAX_FOCUSABLES = 2000;

interface GuidedSession {
  limit: number;
  path: KeyboardTestStep[];
  focusables: string[];
  trapDetected: boolean;
  trapElements: string[];
  cycleCompleted: boolean;
  lastElement: Element | null;
  onFocusIn: (event: FocusEvent) => void;
}

let guided: GuidedSession | null = null;

/** Same heuristic as keyboard-tester.ts: a small subset of elements repeating periodically. */
function detectRepeatingSubset(path: KeyboardTestStep[]): Set<string> | null {
  if (path.length < GUIDED_TRAP_WINDOW) return null;
  const window = path.slice(-GUIDED_TRAP_WINDOW).map((s) => s.selector);
  const counts = new Map<string, number>();
  for (const s of window) counts.set(s, (counts.get(s) ?? 0) + 1);
  if (counts.size > GUIDED_TRAP_MAX_DISTINCT) return null;
  for (const c of counts.values()) if (c < 2) return null;
  const period = counts.size;
  for (let i = period; i < window.length; i++) if (window[i] !== window[i - period]) return null;
  return new Set(counts.keys());
}

function guidedResult(session: GuidedSession): KeyboardTestResult {
  const visited = new Set(session.path.map((s) => s.selector));
  return {
    path: session.path,
    trapDetected: session.trapDetected,
    trapElements: session.trapElements,
    unreachedFocusables: session.focusables.filter((sel) => !visited.has(sel)),
    cycleCompleted: session.cycleCompleted,
    mode: "guided",
  };
}

function recordGuidedStep(session: GuidedSession, el: Element | null): void {
  if (el && isExtensionNode(el)) return;
  if (el === session.lastElement) return;
  session.lastElement = el;
  const step = describeElement(el, session.path.length);
  session.path.push(step);
  sendEvent({ type: "KEYBOARD_TEST_PROGRESS", step: step.index, selector: step.selector });

  const start = session.path[0];
  if (session.path.length > 2 && start && step.selector === start.selector) {
    // Back at the start. A short loop that never reached the rest of the page's
    // focusables is a trap around the start element, not a completed cycle.
    const loop = new Set(session.path.slice(0, -1).map((s) => s.selector));
    const missedOthers = session.focusables.some((sel) => !loop.has(sel));
    if (loop.size <= GUIDED_TRAP_MAX_DISTINCT && missedOthers) {
      session.trapDetected = true;
      session.trapElements = [...loop];
    } else {
      session.cycleCompleted = true;
    }
    stopGuidedKeyboardTest(true);
    return;
  }
  const subset = detectRepeatingSubset(session.path);
  if (subset) {
    // Only a trap when the subset excludes the rest of the page's focusables.
    const excludesOthers = session.focusables.length === 0 ? true : session.focusables.some((sel) => !subset.has(sel));
    if (excludesOthers) {
      session.trapDetected = true;
      session.trapElements = [...subset];
      stopGuidedKeyboardTest(true);
      return;
    }
  }
  if (session.path.length - 1 >= session.limit) stopGuidedKeyboardTest(true);
}

function startGuidedKeyboardTest(maxTabs: number): void {
  if (guided) stopGuidedKeyboardTest(true);
  const limit = Number.isFinite(maxTabs) && maxTabs > 0 ? Math.floor(maxTabs) : 200;
  focusableCache = null;
  const selectors: string[] = [];
  for (const el of focusables().slice(0, GUIDED_MAX_FOCUSABLES)) {
    try {
      selectors.push(uniqueSelector(el));
    } catch {
      /* skip unresolvable element */
    }
  }
  const session: GuidedSession = {
    limit,
    path: [],
    focusables: selectors,
    trapDetected: false,
    trapElements: [],
    cycleCompleted: false,
    lastElement: null,
    onFocusIn: () => {
      if (guided !== session) return;
      // Let nested shadow roots settle on their active element before reading it.
      setTimeout(() => {
        if (guided === session) recordGuidedStep(session, deepActiveElement());
      }, 0);
    },
  };
  guided = session;
  document.addEventListener("focusin", session.onFocusIn, true);
  // The cycle starts at the first element the tester Tabs to. Whatever had focus
  // before Start was pressed (e.g. an element left inside a trap by an earlier
  // test) is not the starting point; returning to it proves nothing.
}

/** Ends the guided session; with `broadcast` the result is sent to the UI and drawn on the overlay. */
function stopGuidedKeyboardTest(broadcast: boolean): KeyboardTestResult | undefined {
  const session = guided;
  if (!session) return undefined;
  guided = null;
  // Focus changes are recorded a tick after they happen; when Stop arrives right
  // after a Tab, take the element that has focus now so the last step is kept.
  const current = deepActiveElement();
  if (
    session.path.length > 0 &&
    current &&
    current !== session.lastElement &&
    current !== document.body &&
    current !== document.documentElement &&
    !isExtensionNode(current)
  ) {
    session.lastElement = current;
    session.path.push(describeElement(current, session.path.length));
  }
  try {
    document.removeEventListener("focusin", session.onFocusIn, true);
  } catch {
    /* ignore */
  }
  const result = guidedResult(session);
  if (!broadcast) return result;
  lastKeyboardPath = result.path;
  lastTrapSelectors = result.trapElements;
  if (overlay) {
    try {
      if (overlay.getMode() === "taborder") overlay.drawTabOrder(lastKeyboardPath, lastTrapSelectors);
    } catch (e) {
      console.warn("[a11y-checker] overlay.drawTabOrder failed:", e);
    }
  }
  sendEvent({ type: "KEYBOARD_TEST_RESULT", result });
  return result;
}

// ---------------------------------------------------------------------------
// Screenshot helpers
// ---------------------------------------------------------------------------

function intersectsViewport(box: BoundingBox): boolean {
  return box.width > 0 && box.height > 0 && box.x < window.innerWidth && box.y < window.innerHeight && box.x + box.width > 0 && box.y + box.height > 0;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

/** Input types that never render a user-entered value worth masking. */
const NON_TEXT_INPUT_TYPES = new Set(["hidden", "button", "submit", "reset", "checkbox", "radio", "range", "color", "image", "file"]);

/**
 * Viewport boxes that must be painted over before a screenshot leaves the page.
 *
 * Three properties matter here, and each is a fix for a way PII used to leak:
 *  - Visibility is judged visually (`isRenderedForRedaction`), never with
 *    dom-utils `isVisible()`: modal libraries mark the page behind a dialog
 *    `aria-hidden="true"` while it stays fully painted behind a translucent
 *    backdrop, so a semantic check would skip exactly the content on screen.
 *  - The search walks open shadow roots and same-origin frame documents
 *    (`collectSearchRoots`), because `document.querySelectorAll` pierces
 *    neither, and web-component form fields live in shadow trees.
 *  - Frames whose document cannot be read (cross-origin, sandboxed) are
 *    redacted whole when masking is on: their contents are unknowable, so the
 *    safe assumption is that they show something private.
 *
 * When in doubt this over-redacts. A black rectangle too many costs the tester
 * a re-take; one too few puts a password in an exported report.
 */
function redactionBoxes(msg: Record<string, unknown>): BoundingBox[] {
  const boxes: BoundingBox[] = [];
  const seen = new Set<Element>();
  const { roots, opaqueFrames } = collectSearchRoots();

  const push = (el: Element, scope: SearchRoot): void => {
    if (seen.has(el) || isExtensionNode(el) || !isRenderedForRedaction(el)) return;
    seen.add(el);
    let rect: DOMRect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      return;
    }
    if (rect.width <= 0 || rect.height <= 0) return;
    // getBoundingClientRect is relative to the element's own view, so shift it
    // into top-viewport coordinates and clip it to what the frame can paint.
    const box = intersectBox(
      { x: scope.offsetX + rect.left, y: scope.offsetY + rect.top, width: rect.width, height: rect.height },
      scope.clip,
    );
    if (box && intersectsViewport(box)) boxes.push(box);
  };

  const selectors = readStringArray(msg.redactSelectors ?? settings.redactSelectors);
  const maskInputValues = typeof msg.maskInputValues === "boolean" ? msg.maskInputValues : settings.maskInputValues === true;

  for (const scope of roots) {
    for (const selector of selectors) {
      let matches: Element[] = [];
      try {
        matches = Array.from(scope.root.querySelectorAll(selector));
      } catch {
        matches = [];
      }
      for (const el of matches) push(el, scope);
    }
    if (!maskInputValues) continue;
    let fields: Array<HTMLInputElement | HTMLTextAreaElement> = [];
    try {
      fields = Array.from(scope.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
    } catch {
      fields = [];
    }
    for (const field of fields) {
      const type = (field as HTMLInputElement).type;
      if (field.localName === "input" && NON_TEXT_INPUT_TYPES.has(type)) continue;
      if (field.value.trim().length === 0) continue;
      push(field, scope);
    }
  }

  // Unreadable frames: redact the whole frame rather than guess at its contents.
  if (maskInputValues) {
    for (const frameBox of opaqueFrames) {
      if (intersectsViewport(frameBox)) boxes.push(frameBox);
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

async function handleScanStart(options: ScanOptions): Promise<Response<FrameScanOutput>> {
  const scanOptions: ScanOptions = {
    scope: options?.scope === "selector" ? "selector" : "page",
    selector: typeof options?.selector === "string" ? options.selector : undefined,
    wcagLevel: options?.wcagLevel === "A" || options?.wcagLevel === "AAA" ? options.wcagLevel : "AA",
    wcagVersion: options?.wcagVersion === "2.0" || options?.wcagVersion === "2.1" ? options.wcagVersion : "2.2",
    rules: readStringArray(options?.rules),
    includeBestPractices: options?.includeBestPractices !== false,
    axeOnly: options?.axeOnly === true,
  };
  lastScanOptions = scanOptions;
  const ruleConfig = await loadRuleConfig();
  const wasVisible = overlay?.isVisible() ?? false;
  try {
    overlay?.hide();
    // A new scan replaces every issue, so the pulse on the issue open in the panel no longer applies.
    overlay?.clearFocus();
  } catch {
    /* ignore */
  }
  try {
    const output = await scanFrame(scanOptions, RULES_FILE, ruleConfig, {
      isExtensionNode,
      onProgress: (percent, stage) => {
        if (isTop) sendEvent({ type: "SCAN_PROGRESS", percent, stage });
      },
    });
    localIssues = output.issues;
    lastResult = null;
    if (isTop) {
      if (overlay) {
        pushOverlayIssues();
        try {
          // A finished scan always shows its issues, whatever overlay was on before
          // (the panel switches its Overlay menu to "Issues" at the same moment).
          overlay.setMode("issues");
        } catch {
          /* ignore */
        }
      }
    }
    return ok(output);
  } finally {
    try {
      if (overlay && (wasVisible || isTop)) overlay.show();
      overlay?.reposition();
    } catch {
      /* ignore */
    }
  }
}

async function handlePrepareScreenshot(msg: Record<string, unknown>, issueId: string): Promise<Handled> {
  const issue = findIssue(issueId);
  if (!issue) return fail(`Unknown issue "${issueId}"`);
  const el = elementForIssue(issue);
  if (!el) return fail("The element for this issue no longer exists on the page");
  try {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
  } catch {
    try {
      el.scrollIntoView();
    } catch {
      /* ignore */
    }
  }
  await nextFrame();
  await nextFrame();
  if (overlay) {
    try {
      overlay.isolateIssue(issueId);
      overlay.show();
      overlay.reposition();
    } catch (e) {
      console.warn("[a11y-checker] overlay.isolateIssue failed:", e);
    }
    await nextFrame();
  }
  // topViewportBox, not boundingBoxes().viewport: an issue found in a child
  // frame has a rect relative to that frame, and the screenshot is of the whole
  // top viewport, so the crop region has to be translated and clipped per frame.
  const box = topViewportBox(el);
  const redactBoxes = redactionBoxes(msg);
  return ok({ box, redactBoxes, devicePixelRatio: window.devicePixelRatio || 1 });
}

function handleSetIssueStatus(issueId: string, status: Issue["status"], reason?: string): Handled {
  let found = false;
  const apply = (issue: Issue): void => {
    if (issue.id !== issueId) return;
    found = true;
    issue.status = status;
    if (reason !== undefined) issue.reason = reason;
  };
  localIssues.forEach(apply);
  lastResult?.issues.forEach(apply);
  if (isTop) pushOverlayIssues();
  return found ? ok({ issueId, status }) : fail(`Unknown issue "${issueId}"`);
}

function requireOverlay(): OverlayController {
  if (!overlay) throw new Error("Overlay is not available in this frame");
  return overlay;
}

async function handle(msg: Message): Promise<Handled> {
  const raw = msg as unknown as Record<string, unknown>;
  switch (msg.type) {
    case "CS_PING":
      return ok({ loaded: true, isTop, url: location.href, title: document.title });

    case "SCAN_START":
      return handleScanStart(msg.options);

    case "SCAN_RESULT": {
      lastResult = msg.result;
      localIssues = [];
      pushOverlayIssues();
      return ok();
    }

    case "HIGHLIGHT_ISSUE": {
      const ov = requireOverlay();
      let found = false;
      try {
        found = ov.focusIssue(msg.issueId);
      } catch (e) {
        return fail(errorMessage(e));
      }
      if (!found) {
        const issue = findIssue(msg.issueId);
        const el = issue ? elementForIssue(issue) : null;
        if (!el) return fail("The element for this issue no longer exists on the page");
        try {
          el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        } catch {
          /* ignore */
        }
      }
      return ok({ found });
    }

    case "TOGGLE_OVERLAY": {
      const ov = requireOverlay();
      if (!msg.visible) {
        ov.setMode("off");
        ov.hide();
        return ok({ mode: "off" });
      }
      ov.show();
      ov.setMode(msg.mode);
      if (msg.mode === "issues") pushOverlayIssues();
      if (msg.mode === "taborder") {
        const path = lastKeyboardPath.length ? lastKeyboardPath : staticTabOrder();
        ov.drawTabOrder(path, lastTrapSelectors);
      }
      ov.reposition();
      return ok({ mode: ov.getMode() });
    }

    case "SET_COLOR_BLINDNESS":
      requireOverlay().setColorBlindness(msg.mode);
      return ok({ mode: msg.mode });

    case "HIGHLIGHT_SELECTORS": {
      const ov = requireOverlay();
      ov.show();
      const selectors = readStringArray(msg.selectors);
      ov.highlightSelectors(selectors);
      if (msg.scroll && selectors[0]) {
        try {
          resolveSelector(selectors[0])?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
          window.setTimeout(() => ov.reposition(), 400);
        } catch {
          /* ignore */
        }
      }
      return ok();
    }

    case "CLEAR_HIGHLIGHTS":
      requireOverlay().clearHighlights();
      return ok();

    case "CS_GET_ACTIVE_ELEMENT":
      return ok(describeActive());

    case "CS_FOCUS_FIRST": {
      const active = deepActiveElement();
      if (active instanceof HTMLElement && active !== document.body) {
        try {
          active.blur();
        } catch {
          /* ignore */
        }
      }
      try {
        document.body?.focus();
      } catch {
        /* ignore */
      }
      focusableCache = null;
      const list = focusables();
      const first = list[0];
      if (first) {
        try {
          first.focus();
        } catch {
          /* ignore */
        }
      }
      // The step of the newly focused element plus every tabbable selector, so the
      // keyboard tester can report focusables the Tab cycle never reached.
      const selectors: string[] = [];
      for (const el of list.slice(0, 2000)) {
        try {
          selectors.push(uniqueSelector(el));
        } catch {
          /* skip unresolvable element */
        }
      }
      return ok({ ...describeActive(), focusables: selectors, focusableCount: list.length });
    }

    case "CS_GET_ELEMENT_BOX": {
      let el: Element | null = null;
      if (msg.issueId) {
        const issue = findIssue(msg.issueId);
        if (!issue) return fail(`Unknown issue "${msg.issueId}"`);
        el = elementForIssue(issue);
      } else if (msg.selector) {
        el = resolveSelector(msg.selector);
      }
      if (!el) return fail("Element not found");
      const boxes = boundingBoxes(el);
      return ok({ viewport: boxes.viewport, page: boxes.page, devicePixelRatio: window.devicePixelRatio || 1 });
    }

    case "CS_PREPARE_SCREENSHOT":
      return handlePrepareScreenshot(raw, msg.issueId);

    case "CS_RESTORE_AFTER_SCREENSHOT":
      try {
        overlay?.restore();
        overlay?.reposition();
      } catch (e) {
        return fail(errorMessage(e));
      }
      return ok();

    case "CS_SET_ISSUE_STATUS":
      return handleSetIssueStatus(msg.issueId, msg.status, msg.reason);


    case "KEYBOARD_TEST_START": {
      startGuidedKeyboardTest(msg.maxTabs);
      // No data: the panel keeps "running" until KEYBOARD_TEST_RESULT arrives.
      return ok();
    }

    case "KEYBOARD_TEST_STOP": {
      // Returns the (partial) guided result so the STOP response can carry it;
      // the result is broadcast as KEYBOARD_TEST_RESULT as well.
      const result = stopGuidedKeyboardTest(true);
      return result ? ok(result) : ok();
    }

    case "KEYBOARD_TEST_RESULT": {
      lastKeyboardPath = Array.isArray(msg.result?.path) ? msg.result.path : [];
      lastTrapSelectors = readStringArray(msg.result?.trapElements);
      if (overlay) {
        try {
          if (overlay.getMode() === "taborder") overlay.drawTabOrder(lastKeyboardPath, lastTrapSelectors);
        } catch (e) {
          console.warn("[a11y-checker] overlay.drawTabOrder failed:", e);
        }
      }
      return ok();
    }

    case "SETTINGS_CHANGED":
      await loadSettings();
      applyOverlayColors();
      return ok();

    case "PICKER_START": {
      const wasVisible = overlay?.isVisible() ?? false;
      overlay?.hide();
      startPicker((result) => {
        if (wasVisible) overlay?.show();
        sendEvent({ type: "PICKER_RESULT", selector: result.selector, html: result.html });
      });
      return ok();
    }

    case "PICKER_CANCEL":
      cancelPicker();
      return ok();


    default:
      return undefined;
  }
}

function onMessage(raw: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: Response<unknown>) => void): boolean {
  if (tornDown || !isMessage(raw)) return false;
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  const type = raw.type;
  if (!HANDLED_TYPES.has(type)) return false;
  if (!isTop && TOP_ONLY_TYPES.has(type)) return false;
  const delay = !isTop && CHILD_DELAY_TYPES.has(type) ? CHILD_RESPONSE_DELAY_MS : 0;

  const respond = (response: Response<unknown>): void => {
    try {
      sendResponse(response);
    } catch {
      /* channel already closed */
    }
  };

  handle(raw)
    .then((response) => {
      const envelope = response ?? ok();
      if (delay > 0) setTimeout(() => respond(envelope), delay);
      else respond(envelope);
    })
    .catch((e: unknown) => respond(fail(errorMessage(e))));
  return true;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function init(): void {
  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch (e) {
    console.warn("[a11y-checker] could not register message listener:", e);
    return;
  }
  if (!isTop) return;

  try {
    overlay = createOverlay();
    overlay.mount();
    overlay.onBadgeClick((issueId) => sendEvent({ type: "ISSUE_CLICKED", issueId }));
  } catch (e) {
    console.warn("[a11y-checker] overlay could not be created:", e);
    overlay = null;
  }

  void loadSettings().then(() => applyOverlayColors());

  try {
    stopSpaObserver = startSpaObserver((reason) => {
      sendEvent({ type: "PAGE_CHANGED", reason });
      try {
        overlay?.reposition();
      } catch {
        /* ignore */
      }
    });
  } catch (e) {
    console.warn("[a11y-checker] SPA observer could not start:", e);
    stopSpaObserver = null;
  }

  window.addEventListener(
    "pagehide",
    (event) => {
      // A bfcache'd page keeps our state; a real unload should not leave listeners behind.
      if (!event.persisted) {
        try {
          stopSpaObserver?.();
        } catch {
          /* ignore */
        }
      }
    },
    { passive: true },
  );
}

if (!window.__a11yCheckerLoaded) {
  window.__a11yCheckerLoaded = true;
  init();
}
