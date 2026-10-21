/**
 * Manual assessment, service-worker side: open the assessment tab for a page, list the instances
 * an assisted requirement asks about, and pick an element on the page (with a screenshot) for a
 * failure instance.
 */
import type { BoundingBox, Settings } from "@shared/types";
import type { AssessmentKind, Instance } from "@shared/assessment";
import type { MessageOf } from "@shared/messages";
import { sendToTab } from "@shared/messages";
import { SCREENSHOT_PADDING } from "@shared/constants";
import { ensureContentScript } from "./injector";
import { cropImage } from "./offscreen-client";

const ASSESSMENT_PAGE = "src/assessment/index.html";
/** How long the tester has to pick an element. */
const PICK_TIMEOUT_MS = 5 * 60_000;

/** The assessment tab opened for each tested tab and kind, "<tabId>:<kind>" (lost on a service-worker restart: a new tab opens). */
const assessmentTabs = new Map<string, number>();

/** Pickers waiting for the page's PICKER_RESULT, by tab. */
const pickWaiters = new Map<number, (r: { selector: string | null; html?: string }) => void>();

/** The content script reported a pick (or a cancel) in this tab. */
export function notifyPicked(tabId: number, selector: string | null, html?: string): void {
  const resolve = pickWaiters.get(tabId);
  if (!resolve) return;
  pickWaiters.delete(tabId);
  resolve({ selector, html });
}

export function assessmentUrl(tabId: number, kind: AssessmentKind = "quick"): string {
  return chrome.runtime.getURL(`${ASSESSMENT_PAGE}?tabId=${tabId}${kind === "full" ? "&kind=full" : ""}`);
}

export async function openAssessment(msg: MessageOf<"ASSESS_OPEN">): Promise<{ tabId: number }> {
  const target = await chrome.tabs.get(msg.tabId);
  // One assessment tab per tested tab and kind: bring an open one forward.
  const kind = msg.kind ?? "quick";
  const mapKey = `${msg.tabId}:${kind}`;
  const openId = assessmentTabs.get(mapKey);
  if (openId !== undefined) {
    try {
      const open = await chrome.tabs.update(openId, { active: true });
      if (open?.windowId !== undefined) await chrome.windows.update(open.windowId, { focused: true }).catch(() => undefined);
      return { tabId: openId };
    } catch {
      assessmentTabs.delete(mapKey); // closed meanwhile
    }
  }
  const tab = await chrome.tabs.create({ url: assessmentUrl(msg.tabId, kind), index: target.index + 1, windowId: target.windowId, active: true });
  if (tab.id === undefined) throw new Error("Could not open the assessment tab.");
  assessmentTabs.set(mapKey, tab.id);
  return { tabId: tab.id };
}

export async function listAssessInstances(msg: MessageOf<"ASSESS_LIST">): Promise<Instance[]> {
  await ensureContentScript(msg.tabId);
  const res = await sendToTab<Instance[]>(msg.tabId, { type: "CS_ASSESS_LIST", kind: msg.kind }, 0);
  if (!res.ok) throw new Error(res.error ?? "The page did not answer.");
  return Array.isArray(res.data) ? res.data : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(box: BoundingBox, width: number, height: number): BoundingBox | undefined {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(width, box.x + box.width);
  const y1 = Math.min(height, box.y + box.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
}

async function photograph(tabId: number, selector: string, settings: Settings): Promise<string | undefined> {
  const tab = await chrome.tabs.get(tabId);
  const prep = await sendToTab<{ box: BoundingBox; redactBoxes: BoundingBox[]; devicePixelRatio: number }>(tabId, { type: "CS_ASSESS_SHOT_PREPARE", selector }, 0);
  try {
    if (!prep.ok || !prep.data) return undefined;
    const box = clamp(prep.data.box, tab.width ?? Infinity, tab.height ?? Infinity);
    if (!box) return undefined;
    await sleep(150);
    const full = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const redact = settings.maskInputValues || settings.redactSelectors.length > 0 ? prep.data.redactBoxes : [];
    return await cropImage(full, box, SCREENSHOT_PADDING, prep.data.devicePixelRatio || 1, redact);
  } finally {
    await sendToTab(tabId, { type: "CS_RESTORE_AFTER_SCREENSHOT", tabId }, 0);
  }
}

export async function pickForAssessment(
  msg: MessageOf<"ASSESS_PICK">,
  settings: Settings,
): Promise<{ selector: string; html?: string; screenshot?: string } | null> {
  const tab = await chrome.tabs.get(msg.tabId);
  await ensureContentScript(msg.tabId);
  await chrome.tabs.update(msg.tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  pickWaiters.get(msg.tabId)?.({ selector: null });
  const picked = new Promise<{ selector: string | null; html?: string }>((resolve) => {
    pickWaiters.set(msg.tabId, resolve);
    setTimeout(() => notifyPicked(msg.tabId, null), PICK_TIMEOUT_MS);
  });
  const started = await sendToTab(msg.tabId, { type: "PICKER_START", tabId: msg.tabId }, 0);
  if (!started.ok) {
    pickWaiters.delete(msg.tabId);
    throw new Error(started.error ?? "Could not start picking on the page.");
  }
  const { selector, html } = await picked;
  let screenshot: string | undefined;
  try {
    if (selector && msg.screenshot) screenshot = await photograph(msg.tabId, selector, settings).catch(() => undefined);
  } finally {
    if (msg.returnTabId !== undefined) await chrome.tabs.update(msg.returnTabId, { active: true }).catch(() => undefined);
  }
  return selector ? { selector, html, screenshot } : null;
}
