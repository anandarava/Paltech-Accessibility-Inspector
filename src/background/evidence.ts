/**
 * Evidence capture: for each issue, ask the content script to scroll the element
 * into view and isolate its outline, capture the visible tab, crop the element
 * region (with padding, at devicePixelRatio) in the offscreen document while
 * redacting sensitive regions, then restore the page.
 */
import type { BoundingBox, Issue, ScanResult, Settings } from "@shared/types";
import { SCREENSHOT_PADDING } from "@shared/constants";
import { sendToTab } from "@shared/messages";
import { cropImage } from "./offscreen-client";

/** chrome.tabs.captureVisibleTab is limited to 2 calls per second. */
const CAPTURE_INTERVAL_MS = 550;
/** Time for scrollIntoView / outline isolation to paint before capturing. */
const SETTLE_MS = 120;
const PREPARE_TIMEOUT_MS = 8000;

interface PrepareData {
  box: BoundingBox;
  redactBoxes: BoundingBox[];
  scale: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function asBox(b: unknown): BoundingBox | undefined {
  if (typeof b !== "object" || b === null) return undefined;
  const o = b as Record<string, unknown>;
  const x = o.x ?? o.left;
  const y = o.y ?? o.top;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(o.width) || !isFiniteNumber(o.height)) return undefined;
  return { x, y, width: o.width, height: o.height };
}

/**
 * The CS_PREPARE_SCREENSHOT response shape is owned by the content script; accept
 * the documented form ({ box, redactBoxes, scale }) plus common aliases.
 */
function parsePrepareData(data: unknown, issue: Issue): PrepareData | undefined {
  const o = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const box =
    asBox(o.box) ??
    asBox(o.viewportBox) ??
    asBox(o.rect) ??
    asBox(o.boundingBox) ??
    (issue.element.viewportBox ? asBox(issue.element.viewportBox) : undefined);
  if (!box) return undefined;
  const rawRedact = o.redactBoxes ?? o.redact ?? o.redactions;
  const redactBoxes = Array.isArray(rawRedact)
    ? rawRedact.map(asBox).filter((b): b is BoundingBox => b !== undefined)
    : [];
  const rawScale = o.scale ?? o.devicePixelRatio ?? o.dpr;
  const scale = isFiniteNumber(rawScale) && rawScale > 0 ? rawScale : 1;
  return { box, redactBoxes, scale };
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function clampToViewport(box: BoundingBox, width: number, height: number): BoundingBox | undefined {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(width, box.x + box.width);
  const y1 = Math.min(height, box.y + box.height);
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Thrown when the target tab stops being the visible tab of its window mid-capture. */
class TabNotVisibleError extends Error {
  constructor() {
    super("The tab is no longer visible (another tab was activated); capture aborted.");
    this.name = "TabNotVisibleError";
  }
}

/**
 * captureVisibleTab captures whichever tab is currently visible in the window,
 * not a specific tabId, so re-check that our tab is still the active one in its
 * window immediately before every capture.
 */
async function assertTabVisible(tabId: number, windowId: number): Promise<void> {
  let t: chrome.tabs.Tab;
  try {
    t = await chrome.tabs.get(tabId);
  } catch {
    throw new TabNotVisibleError();
  }
  if (!t.active || t.windowId !== windowId) throw new TabNotVisibleError();
}

async function captureVisible(windowId: number): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw new Error("captureVisibleTab returned no image.");
  }
  return dataUrl;
}

/**
 * Capture a cropped screenshot for each requested issue. Issues that cannot be
 * captured (element gone, off-screen, capture denied) are skipped; the page is
 * always restored. Returns issueId -> PNG data URL.
 */
export async function captureIssueEvidence(
  tabId: number,
  result: ScanResult,
  issueIds: string[],
  settings: Settings,
): Promise<Record<string, string>> {
  const screenshots: Record<string, string> = {};
  const wanted = new Set(issueIds);
  const issues = result.issues.filter((i) => wanted.has(i.id));
  if (issues.length === 0) return screenshots;

  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) {
    throw new Error("The tab must be visible (active in its window) to capture screenshots.");
  }
  const windowId = tab.windowId;
  const viewportW = tab.width ?? Number.POSITIVE_INFINITY;
  const viewportH = tab.height ?? Number.POSITIVE_INFINITY;
  const padding = SCREENSHOT_PADDING;
  const errors: string[] = [];
  let lastCaptureAt = 0;
  let aborted: TabNotVisibleError | undefined;

  for (const issue of issues) {
    let prepared = false;
    try {
      const prep = await withTimeout(
        sendToTab<unknown>(tabId, { type: "CS_PREPARE_SCREENSHOT", tabId, issueId: issue.id }, 0),
        PREPARE_TIMEOUT_MS,
        "Timed out preparing the element for a screenshot.",
      );
      prepared = true;
      if (!prep.ok) throw new Error(prep.error ?? "The content script could not prepare the element.");
      const data = parsePrepareData(prep.data, issue);
      if (!data) throw new Error("The element could not be located on the page.");
      if (data.box.width <= 0 || data.box.height <= 0) {
        throw new Error("The element has no visible size on screen (it is hidden, or an image-map area), so there is nothing to photograph.");
      }
      const box = clampToViewport(data.box, viewportW, viewportH);
      if (!box) throw new Error("The element could not be scrolled into the visible part of the page.");

      await sleep(SETTLE_MS);
      const wait = CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
      if (wait > 0) await sleep(wait);
      // Re-validate right before capturing: if the user switched tabs while we
      // were waiting, captureVisibleTab would return pixels of a different tab.
      await assertTabVisible(tabId, windowId);
      lastCaptureAt = Date.now();
      let full: string;
      try {
        full = await captureVisible(windowId);
      } catch (e) {
        if (/<all_urls>|activeTab/i.test(describeError(e))) {
          throw new Error("Chrome did not allow a screenshot of this tab. Click the PalTech A11y Inspector toolbar icon on this tab, then try again.");
        }
        throw e;
      }

      // Redaction: boxes reported by the CS (configured selectors + masked inputs).
      // When masking is off, only the explicitly configured selectors are honoured
      // by the CS, so nothing extra to do here beyond passing them through.
      const redactBoxes = settings.maskInputValues || settings.redactSelectors.length > 0 ? data.redactBoxes : [];
      screenshots[issue.id] = await cropImage(full, box, padding, data.scale, redactBoxes);
    } catch (e) {
      if (e instanceof TabNotVisibleError) aborted = e;
      errors.push(`${issue.id}: ${describeError(e)}`);
    } finally {
      if (prepared) {
        await sendToTab(tabId, { type: "CS_RESTORE_AFTER_SCREENSHOT", tabId }, 0);
      }
    }
    // Once the tab is no longer visible every further capture would be of the
    // wrong tab, so stop here rather than continuing through the remaining issues.
    if (aborted) break;
  }

  if (aborted) {
    const captured = Object.keys(screenshots).length;
    throw new Error(
      `${aborted.message} ${captured} of ${issues.length} screenshot(s) were captured before the tab was switched.`,
    );
  }
  if (Object.keys(screenshots).length === 0 && errors.length > 0) {
    // Report each distinct reason once (without issue ids), so one unphotographable
    // element does not hide the real cause for the others.
    const reasons = [...new Set(errors.map((e) => e.replace(/^[^:]+:\s*/, "")))];
    throw new Error(`No screenshots could be captured. ${reasons.join(" ")}`);
  }
  if (errors.length > 0) {
    console.warn(`[a11y-checker] evidence capture skipped ${errors.length} issue(s): ${errors.join("; ")}`);
  }
  return screenshots;
}
