/**
 * Service-worker side client for the offscreen document (src/offscreen).
 * The SW has no canvas and no URL.createObjectURL, so image cropping and
 * large blob downloads are delegated to the offscreen page.
 */
import type { BoundingBox } from "@shared/types";
import type { Response } from "@shared/messages";

const OFFSCREEN_URL = "src/offscreen/index.html";
/** Data URLs above this size are unreliable with chrome.downloads; use a blob URL instead. */
const DATA_URL_LIMIT_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_SETTLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Internal (SW <-> offscreen only) message used to release a blob URL. */
export const OFFSCREEN_REVOKE_TYPE = "OFFSCREEN_REVOKE_URL";

export interface BuildDownloadResponse {
  /** Present when the offscreen document could call chrome.downloads itself. */
  downloadId?: number;
  /** Present when the offscreen document created a blob URL for the SW to download. */
  url?: string;
}

let creating: Promise<void> | null = null;

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function hasOffscreenDocument(): Promise<boolean> {
  const runtime = chrome.runtime as unknown as {
    getContexts?: (filter: { contextTypes: string[]; documentUrls?: string[] }) => Promise<Array<{ contextType: string }>>;
  };
  if (typeof runtime.getContexts === "function") {
    try {
      const contexts = await runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
      });
      return contexts.length > 0;
    } catch {
      // fall through
    }
  }
  const offscreen = chrome.offscreen as unknown as { hasDocument?: () => Promise<boolean> };
  if (typeof offscreen.hasDocument === "function") {
    try {
      return await offscreen.hasDocument();
    } catch {
      return false;
    }
  }
  return false;
}

/** chrome.offscreen.createDocument with reasons ["BLOBS","DOM_SCRAPING"]; idempotent. */
export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (creating) {
    await creating;
    return;
  }
  creating = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ["BLOBS", "DOM_SCRAPING"],
        justification: "Crop evidence screenshots on a canvas and build report blobs for download.",
      });
    } catch (e) {
      // "Only a single offscreen document may be created" -> another call won the race.
      if (!/single offscreen document|already exists/i.test(describeError(e))) throw e;
    }
  })();
  try {
    await creating;
  } finally {
    creating = null;
  }
}

function sendToOffscreen<T>(msg: Record<string, unknown>): Promise<Response<T>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response: Response<T> | undefined) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else if (!response) resolve({ ok: false, error: "No response from the offscreen document." });
        else resolve(response);
      });
    } catch (e) {
      resolve({ ok: false, error: describeError(e) });
    }
  });
}

/**
 * Crop `box` (CSS px, multiplied by `scale`) out of a PNG/JPEG data URL, padded
 * by `padding` CSS px and clamped to the image, with `redactBoxes` filled solid.
 * Returns a PNG data URL.
 */
export async function cropImage(
  dataUrl: string,
  box: BoundingBox,
  padding: number,
  scale: number,
  redactBoxes: BoundingBox[],
): Promise<string> {
  await ensureOffscreenDocument();
  const res = await sendToOffscreen<string>({
    type: "OFFSCREEN_CROP",
    dataUrl,
    box,
    padding,
    scale,
    redactBoxes,
  });
  if (!res.ok || typeof res.data !== "string") {
    throw new Error(res.error ?? "Cropping the screenshot failed.");
  }
  return res.data;
}

function waitForDownloadToSettle(downloadId: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        chrome.downloads.onChanged.removeListener(listener);
      } catch {
        // ignore
      }
      resolve();
    };
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return;
      const state = delta.state?.current;
      if (state === "complete" || state === "interrupted" || delta.error) finish();
    };
    const timer = setTimeout(finish, DOWNLOAD_SETTLE_TIMEOUT_MS);
    try {
      chrome.downloads.onChanged.addListener(listener);
    } catch {
      finish();
      return;
    }
    // The download may already have finished before the listener was attached.
    chrome.downloads.search({ id: downloadId }, (items) => {
      if (chrome.runtime.lastError) return;
      const item = items?.[0];
      if (item && (item.state === "complete" || item.state === "interrupted")) finish();
    });
  });
}

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Trigger a download of text content. Uses a `data:` URL directly when the
 * content is below 2MB; otherwise builds a blob in the offscreen document.
 * Resolves with the chrome.downloads id.
 */
export async function downloadText(filename: string, mime: string, content: string): Promise<number> {
  const safeName = filename.replace(/[\\/:*?"<>|]+/g, "_").trim() || "report.txt";
  const size = utf8ByteLength(content);

  if (size < DATA_URL_LIMIT_BYTES) {
    const url = `data:${mime};base64,${toBase64(content)}`;
    return chrome.downloads.download({ url, filename: safeName, saveAs: false });
  }

  await ensureOffscreenDocument();
  const res = await sendToOffscreen<BuildDownloadResponse | number>({
    type: "OFFSCREEN_BUILD_DOWNLOAD",
    filename: safeName,
    mime,
    content,
  });
  if (!res.ok) throw new Error(res.error ?? "Building the download failed.");

  const data = res.data;
  if (typeof data === "number") return data;
  if (data && typeof data.downloadId === "number") return data.downloadId;
  if (data && typeof data.url === "string") {
    const url = data.url;
    let downloadId: number;
    try {
      downloadId = await chrome.downloads.download({ url, filename: safeName, saveAs: false });
    } catch (e) {
      void sendToOffscreen({ type: OFFSCREEN_REVOKE_TYPE, url });
      throw e;
    }
    // Release the blob once Chrome has finished reading it.
    void waitForDownloadToSettle(downloadId).then(() => sendToOffscreen({ type: OFFSCREEN_REVOKE_TYPE, url }));
    return downloadId;
  }
  throw new Error("The offscreen document returned an unexpected download response.");
}
