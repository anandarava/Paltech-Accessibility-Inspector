/**
 * Report exporters. Everything here runs inside the MV3 service worker and
 * only produces strings; downloading is handled by offscreen-client.
 */
import type { ExportFormat, ScanResult } from "@shared/types";
import { buildHtmlReport, buildMultiPageHtmlReport, type ReportMeta } from "./html-report";
import { buildJsonReport, buildJsonReportDocument, toolInfo } from "./json-report";

export interface ReportFile {
  filename: string;
  mime: string;
  content: string;
}

export { buildHtmlReport, buildJsonReport, buildMultiPageHtmlReport };
export type { ReportMeta };

const FORMATS: Record<ExportFormat, { ext: string; mime: string; build: (r: ScanResult, meta: ReportMeta) => string }> = {
  // Every HTML export uses the interactive template (filters, collapsible elements); one scan is its single-page mode.
  html: { ext: "html", mime: "text/html;charset=utf-8", build: (r, meta) => buildMultiPageHtmlReport([r], meta) },
  json: { ext: "json", mime: "application/json;charset=utf-8", build: (r) => buildJsonReport(r) },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "page";
  } catch {
    return "page";
  }
}

/** The application's name for the filename: the scanned site's host without "www."; the first one when the scans span several. */
function appName(results: ScanResult[]): string {
  const host = hostOf(results[0]?.url ?? "").replace(/^www\./i, "");
  return host.replace(/[^a-z0-9.-]+/gi, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 60) || "page";
}

/** "<application name>_Accessibility_Report.<ext>": safe for chrome.downloads on every platform. */
function filenameFor(format: ExportFormat, results: ScanResult[]): string {
  return `${appName(results)}_Accessibility_Report.${FORMATS[format].ext}`;
}

export function reportFilename(format: ExportFormat, result: ScanResult): string {
  return filenameFor(format, [result]);
}

export function buildReport(format: ExportFormat, result: ScanResult, meta: ReportMeta = {}): ReportFile {
  const spec = FORMATS[format];
  if (!spec) throw new Error(`Unsupported export format: ${String(format)}`);
  return { filename: reportFilename(format, result), mime: spec.mime, content: spec.build(result, meta) };
}

/**
 * One file for several scanned pages: the multi-page HTML report, or a JSON document with a `pages`
 * array holding each page's usual export. A single result gets the usual single-scan export (the same template).
 */
export function buildMultiPageReport(format: ExportFormat, results: ScanResult[], meta: ReportMeta = {}, now: Date = new Date()): ReportFile {
  if (results.length === 0) throw new Error("No scans to export.");
  if (results.length === 1) return buildReport(format, results[0], meta);
  const spec = FORMATS[format];
  if (!spec) throw new Error(`Unsupported export format: ${String(format)}`);
  const filename = filenameFor(format, results);
  const content =
    format === "html"
      ? buildMultiPageHtmlReport(results, meta)
      : JSON.stringify({ tool: toolInfo(), exportedAt: now.toISOString(), pages: results.map((r) => buildJsonReportDocument(r, now)) }, null, 2) + "\n";
  return { filename, mime: spec.mime, content };
}
