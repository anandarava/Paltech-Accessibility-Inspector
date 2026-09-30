/**
 * Offscreen document: performs DOM/canvas work the MV3 service worker cannot.
 *
 *  - OFFSCREEN_CROP: crop a region of a screenshot data URL (with padding and
 *    solid redaction rectangles) and return a PNG data URL.
 *  - OFFSCREEN_BUILD_DOWNLOAD: turn text content into a Blob URL and either
 *    download it here (when chrome.downloads is exposed to this context) or
 *    hand the blob URL back to the service worker, which downloads it and
 *    later sends OFFSCREEN_REVOKE_URL so the blob can be released.
 *
 * Only messages whose type starts with "OFFSCREEN_" are handled here.
 */
import type { BoundingBox } from "@shared/types";
import type { Response } from "@shared/messages";

interface CropMessage {
  type: "OFFSCREEN_CROP";
  dataUrl: string;
  box: BoundingBox;
  padding: number;
  scale: number;
  redactBoxes: BoundingBox[];
}

interface BuildDownloadMessage {
  type: "OFFSCREEN_BUILD_DOWNLOAD";
  filename: string;
  mime: string;
  content: string;
}

interface RevokeMessage {
  type: "OFFSCREEN_REVOKE_URL";
  url: string;
}

const REDACT_FILL = "#333333";
/** Safety net: blob URLs are released after this even if no revoke message arrives. */
const BLOB_TTL_MS = 10 * 60 * 1000;

const liveBlobUrls = new Map<string, number>();

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function normalizeBox(b: unknown): BoundingBox | null {
  if (typeof b !== "object" || b === null) return null;
  const o = b as Record<string, unknown>;
  if (!isFiniteNumber(o.x) || !isFiniteNumber(o.y) || !isFiniteNumber(o.width) || !isFiniteNumber(o.height)) return null;
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

async function loadImage(dataUrl: string): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      return await createImageBitmap(blob);
    } catch {
      // fall back to an <img>
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the screenshot image."));
    img.src = dataUrl;
  });
}

function imageSize(img: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if (img instanceof HTMLImageElement) return { width: img.naturalWidth, height: img.naturalHeight };
  return { width: img.width, height: img.height };
}

async function handleCrop(msg: CropMessage): Promise<string> {
  if (typeof msg.dataUrl !== "string" || !msg.dataUrl.startsWith("data:")) {
    throw new Error("OFFSCREEN_CROP requires a data URL.");
  }
  const box = normalizeBox(msg.box);
  if (!box) throw new Error("OFFSCREEN_CROP requires a bounding box.");
  const scale = isFiniteNumber(msg.scale) && msg.scale > 0 ? msg.scale : 1;
  const padding = isFiniteNumber(msg.padding) && msg.padding >= 0 ? msg.padding : 0;
  const redactBoxes = Array.isArray(msg.redactBoxes)
    ? msg.redactBoxes.map(normalizeBox).filter((b): b is BoundingBox => b !== null)
    : [];

  const img = await loadImage(msg.dataUrl);
  try {
    const { width: imgW, height: imgH } = imageSize(img);
    if (imgW === 0 || imgH === 0) throw new Error("The screenshot image is empty.");

    // Crop region in device pixels, padded and clamped to the image bounds.
    const left = Math.max(0, Math.floor((box.x - padding) * scale));
    const top = Math.max(0, Math.floor((box.y - padding) * scale));
    const right = Math.min(imgW, Math.ceil((box.x + box.width + padding) * scale));
    const bottom = Math.min(imgH, Math.ceil((box.y + box.height + padding) * scale));
    const cropW = Math.max(1, right - left);
    const cropH = Math.max(1, bottom - top);
    if (right <= left || bottom <= top) {
      throw new Error("The element is outside the visible screenshot area.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");

    ctx.drawImage(img, left, top, cropW, cropH, 0, 0, cropW, cropH);

    ctx.fillStyle = REDACT_FILL;
    for (const r of redactBoxes) {
      const rx = Math.floor(r.x * scale) - left;
      const ry = Math.floor(r.y * scale) - top;
      const rw = Math.ceil(r.width * scale);
      const rh = Math.ceil(r.height * scale);
      // Only draw the part that intersects the crop.
      const x0 = Math.max(0, rx);
      const y0 = Math.max(0, ry);
      const x1 = Math.min(cropW, rx + rw);
      const y1 = Math.min(cropH, ry + rh);
      if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    return canvas.toDataURL("image/png");
  } finally {
    if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();
  }
}

function revokeBlobUrl(url: string): void {
  const timer = liveBlobUrls.get(url);
  if (timer !== undefined) {
    clearTimeout(timer);
    liveBlobUrls.delete(url);
  }
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

function downloadsApi(): typeof chrome.downloads | undefined {
  try {
    const api = (chrome as unknown as { downloads?: typeof chrome.downloads }).downloads;
    return api && typeof api.download === "function" ? api : undefined;
  } catch {
    return undefined;
  }
}

async function handleBuildDownload(msg: BuildDownloadMessage): Promise<{ downloadId?: number; url?: string }> {
  if (typeof msg.content !== "string") throw new Error("OFFSCREEN_BUILD_DOWNLOAD requires text content.");
  const mime = typeof msg.mime === "string" && msg.mime ? msg.mime : "text/plain";
  const filename = typeof msg.filename === "string" && msg.filename ? msg.filename : "report.txt";
  const blob = new Blob([msg.content], { type: mime });
  const url = URL.createObjectURL(blob);

  const downloads = downloadsApi();
  if (downloads) {
    // Offscreen documents normally only see chrome.runtime; when chrome.downloads
    // is exposed we finish the job here and revoke once the download settles.
    let downloadId: number;
    try {
      downloadId = await downloads.download({ url, filename, saveAs: false });
    } catch (e) {
      revokeBlobUrl(url);
      throw e;
    }
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return;
      const state = delta.state?.current;
      if (state === "complete" || state === "interrupted" || delta.error) {
        downloads.onChanged.removeListener(listener);
        revokeBlobUrl(url);
      }
    };
    downloads.onChanged.addListener(listener);
    liveBlobUrls.set(
      url,
      window.setTimeout(() => {
        downloads.onChanged.removeListener(listener);
        revokeBlobUrl(url);
      }, BLOB_TTL_MS),
    );
    return { downloadId };
  }

  // Hand the blob URL to the service worker (same extension origin) to download.
  liveBlobUrls.set(
    url,
    window.setTimeout(() => revokeBlobUrl(url), BLOB_TTL_MS),
  );
  return { url };
}

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse: (r: Response) => void) => {
  if (typeof raw !== "object" || raw === null) return false;
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== "string" || !type.startsWith("OFFSCREEN_")) return false;

  const respond = (p: Promise<unknown>) => {
    p.then(
      (data) => sendResponse({ ok: true, data }),
      (e: unknown) => sendResponse({ ok: false, error: describeError(e) }),
    );
    return true;
  };

  switch (type) {
    case "OFFSCREEN_CROP":
      return respond(handleCrop(raw as CropMessage));
    case "OFFSCREEN_BUILD_DOWNLOAD":
      return respond(handleBuildDownload(raw as BuildDownloadMessage));
    case "OFFSCREEN_REVOKE_URL": {
      const url = (raw as RevokeMessage).url;
      if (typeof url === "string") revokeBlobUrl(url);
      sendResponse({ ok: true });
      return false;
    }
    default:
      sendResponse({ ok: false, error: `Unknown offscreen message: ${type}` });
      return false;
  }
});
