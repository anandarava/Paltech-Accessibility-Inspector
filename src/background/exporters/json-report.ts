/**
 * JSON export: a pretty-printed ScanResult with top-level `tool` and
 * `exportedAt` metadata. Screenshots (which can be several MB of base64)
 * are stripped unless the whole set is small, so the file stays portable
 * and diff-friendly for CI comparison.
 */
import type { Issue, ScanResult } from "@shared/types";

/** Total base64 payload (bytes, approximated by string length) allowed before screenshots are dropped. */
export const JSON_SCREENSHOT_BUDGET_BYTES = 200 * 1024;

export interface ToolInfo {
  name: string;
  version: string;
}

/** Name/version of the extension, safe to call outside an extension context (unit tests). */
export function toolInfo(): ToolInfo {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getManifest === "function") {
      const m = chrome.runtime.getManifest();
      if (m && typeof m.name === "string" && typeof m.version === "string") {
        return { name: m.name, version: m.version };
      }
    }
  } catch {
    // Not running inside the extension; fall through to the static default.
  }
  return { name: "PalTech A11y Inspector", version: "1.0.0" };
}

export interface JsonReportDocument extends ScanResult {
  tool: ToolInfo;
  exportedAt: string;
  /** True when embedded screenshots were removed to keep the file small. */
  screenshotsStripped: boolean;
  /** Number of screenshots removed (0 when none were stripped). */
  screenshotsOmitted: number;
}

function screenshotBytes(result: ScanResult): number {
  let total = 0;
  for (const issue of result.issues ?? []) {
    const s = issue.evidence?.screenshot;
    if (typeof s === "string") total += s.length;
  }
  return total;
}

function stripIssue(issue: Issue): Issue {
  if (!issue.evidence || issue.evidence.screenshot === undefined) return issue;
  const { screenshot: _dropped, ...rest } = issue.evidence;
  const evidence = Object.keys(rest).length > 0 ? rest : undefined;
  return evidence ? { ...issue, evidence } : { ...issue, evidence: undefined };
}

/** Build the export document without mutating the input result. */
export function buildJsonReportDocument(result: ScanResult, now: Date = new Date()): JsonReportDocument {
  const issues = result.issues ?? [];
  const strip = screenshotBytes(result) > JSON_SCREENSHOT_BUDGET_BYTES;

  let omitted = 0;
  const outIssues = strip
    ? issues.map((i) => {
        if (typeof i.evidence?.screenshot === "string") omitted++;
        return stripIssue(i);
      })
    : issues;

  return {
    tool: toolInfo(),
    exportedAt: now.toISOString(),
    screenshotsStripped: strip,
    screenshotsOmitted: omitted,
    ...result,
    issues: outIssues,
  };
}

export function buildJsonReport(result: ScanResult): string {
  return JSON.stringify(buildJsonReportDocument(result), null, 2) + "\n";
}
