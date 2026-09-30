/**
 * Report exporters. Everything here runs inside the MV3 service worker and
 * only produces strings; downloading is handled by offscreen-client.
 */
import type { ExportFormat, ScanResult } from "@shared/types";
import { buildHtmlReport, type ReportMeta } from "./html-report";
import { buildJsonReport } from "./json-report";

export interface ReportFile {
  filename: string;
  mime: string;
  content: string;
}

export { buildHtmlReport, buildJsonReport };
export type { ReportMeta };

const FORMATS: Record<ExportFormat, { ext: string; mime: string; build: (r: ScanResult, meta: ReportMeta) => string }> = {
  html: { ext: "html", mime: "text/html;charset=utf-8", build: buildHtmlReport },
  json: { ext: "json", mime: "application/json;charset=utf-8", build: (r) => buildJsonReport(r) },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "page";
  } catch {
    return "page";
  }
}

function stamp(iso: string): string {
  const parsed = new Date(iso);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Filename that is safe for chrome.downloads on every platform. */
export function reportFilename(format: ExportFormat, result: ScanResult): string {
  const host = hostOf(result.url).replace(/[^a-z0-9.-]+/gi, "_").slice(0, 60);
  return `a11y-report_${host}_${stamp(result.timestamp)}.${FORMATS[format].ext}`;
}

export function buildReport(format: ExportFormat, result: ScanResult, meta: ReportMeta = {}): ReportFile {
  const spec = FORMATS[format];
  if (!spec) throw new Error(`Unsupported export format: ${String(format)}`);
  return { filename: reportFilename(format, result), mime: spec.mime, content: spec.build(result, meta) };
}
