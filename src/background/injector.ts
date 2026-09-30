/**
 * Programmatic injection of the content script (all frames) and the MAIN-world
 * history hook. Both scripts are idempotent, so re-injecting is harmless, but
 * we avoid it where possible by probing each frame first.
 */
import csFile from "@src/content/content-script.iife.ts?script";
import hookFile from "@src/content/main-world-hook.iife.ts?script";
import { sendToTab } from "@shared/messages";

export interface InjectionSummary {
  /** True when at least one frame received a fresh copy of the content script. */
  injected: boolean;
  /** Number of frames that now have the content script. */
  frames: number;
  /** Frame ids (0 = top) that have the content script; scan each with `sendToTab(tabId, msg, frameId)`. */
  frameIds: number[];
  /**
   * Child frames that needed the content script but could not be injected (for
   * example they navigated away between probe and injection). They are not in
   * `frameIds`; callers should report them as unscanned rather than silently skip them.
   */
  failedFrames: Array<{ frameId: number; error: string }>;
}

const PING_TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Returns true when the top frame answers CS_PING. */
export async function pingContentScript(tabId: number, frameId = 0): Promise<boolean> {
  const res = await withTimeout(sendToTab(tabId, { type: "CS_PING" }, frameId), PING_TIMEOUT_MS, { ok: false });
  return res.ok;
}

/**
 * Probe every frame the extension can script and report whether the content
 * script is already loaded there (`window.__a11yCheckerLoaded`).
 */
async function probeFrames(tabId: number): Promise<Array<{ frameId: number; loaded: boolean }>> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => Boolean((window as unknown as { __a11yCheckerLoaded?: unknown }).__a11yCheckerLoaded),
  });
  const out: Array<{ frameId: number; loaded: boolean }> = [];
  for (const r of results ?? []) {
    if (typeof r.frameId !== "number") continue;
    out.push({ frameId: r.frameId, loaded: r.result === true });
  }
  // Top frame first, then children in ascending order.
  out.sort((a, b) => a.frameId - b.frameId);
  return out;
}

/** Inject the MAIN-world history hook into the top frame (idempotent). */
export async function injectMainWorldHook(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [hookFile],
      world: "MAIN",
    });
  } catch (e) {
    // The hook is an enhancement (SPA route detection); the scan works without it.
    console.warn(`[a11y-checker] MAIN-world hook injection failed for tab ${tabId}: ${describeError(e)}`);
  }
}

/**
 * Pings the CS with CS_PING; if no answer, injects content-script.iife (allFrames)
 * and the MAIN-world hook. Also injects into any child frame that appeared after
 * the first injection. Rejects when the tab cannot be scripted at all
 * (chrome://, the Web Store, PDF viewer, missing host permission...).
 */
export async function ensureContentScript(tabId: number): Promise<InjectionSummary> {
  const topAlive = await pingContentScript(tabId, 0);

  let frames: Array<{ frameId: number; loaded: boolean }>;
  try {
    frames = await probeFrames(tabId);
  } catch (e) {
    throw new Error(
      `Cannot access this page (${describeError(e)}). Chrome internal pages, the Web Store and pages without host permission cannot be scanned.`,
    );
  }

  if (frames.length === 0) {
    throw new Error("No scriptable frames found in this tab.");
  }

  const missing = frames.filter((f) => !f.loaded || (f.frameId === 0 && !topAlive)).map((f) => f.frameId);
  let injected = false;
  const failedFrames: Array<{ frameId: number; error: string }> = [];

  if (missing.length > 0) {
    const injectedIds = new Set<number>();
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: missing },
        files: [csFile],
      });
      for (const r of results ?? []) if (typeof r.frameId === "number") injectedIds.add(r.frameId);
    } catch (e) {
      // Chrome validates the whole frameIds list up front, so one child frame that
      // navigated away between probe and injection rejects the batch without
      // injecting anywhere. Retry frame by frame so the surviving frames still get
      // the script, and record the ones that are gone.
      console.warn(`[a11y-checker] batch injection failed on tab ${tabId}, retrying per frame: ${describeError(e)}`);
      const settled = await Promise.allSettled(
        missing.map((frameId) =>
          chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            files: [csFile],
          }),
        ),
      );
      settled.forEach((r, i) => {
        const frameId = missing[i];
        if (r.status === "fulfilled") {
          injectedIds.add(frameId);
        } else {
          failedFrames.push({ frameId, error: describeError(r.reason) });
        }
      });
      const topFailure = failedFrames.find((f) => f.frameId === 0);
      if (topFailure) {
        throw new Error(`Content script injection failed: ${topFailure.error}`);
      }
      if (failedFrames.length > 0) {
        console.warn(
          `[a11y-checker] could not inject into frame(s) ${failedFrames.map((f) => f.frameId).join(", ")} on tab ${tabId}`,
        );
      }
    }
    injected = injectedIds.size > 0 || missing.includes(0);
    for (const f of frames) if (injectedIds.has(f.frameId)) f.loaded = true;

    if (missing.includes(0)) {
      await injectMainWorldHook(tabId);
    }
  }

  // Confirm the top frame now answers; the scan cannot proceed without it.
  if (!topAlive) {
    const alive = await pingContentScript(tabId, 0);
    if (!alive) {
      throw new Error("The content script did not respond after injection. Reload the page and try again.");
    }
    const top = frames.find((f) => f.frameId === 0);
    if (top) top.loaded = true;
  }

  const frameIds = frames.filter((f) => f.loaded).map((f) => f.frameId);
  // Only child frames count as failures here; a top-frame failure has already thrown.
  const failed = failedFrames.filter((f) => f.frameId !== 0 && !frameIds.includes(f.frameId));
  return { injected, frames: frameIds.length, frameIds, failedFrames: failed };
}
