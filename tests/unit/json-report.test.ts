import { describe, expect, it, vi } from "vitest";
import { buildJsonReport } from "@src/background/exporters/json-report";
import type { ScanResult } from "@shared/types";
import { makeIssue, makeScanResult } from "./support/factories";

describe("buildJsonReport", () => {
  it("returns valid JSON that contains the scan result", () => {
    const result = makeScanResult();
    const parsed = JSON.parse(buildJsonReport(result)) as Record<string, unknown>;
    expect(parsed).toBeTypeOf("object");
    // The exporter may wrap the result (e.g. { version, result }) or emit it flat.
    const scan = ("issues" in parsed ? parsed : (parsed.result as Record<string, unknown>)) as unknown as ScanResult;
    expect(scan.scanId).toBe(result.scanId);
    expect(scan.url).toBe(result.url);
    expect(scan.issues).toHaveLength(result.issues.length);
    expect(scan.summary).toEqual(result.summary);
  });

  it("preserves every issue's rule id, fingerprint and selector", () => {
    const issues = [
      makeIssue({ ruleId: "IMG-01", fingerprint: "0a1b2c3d", element: { selector: "main > img" } }),
      makeIssue({ ruleId: "CLR-01", fingerprint: "ffffffff", element: { selector: "#pricing > p" } }),
    ];
    const parsed = JSON.parse(buildJsonReport(makeScanResult({ issues })));
    const scan = ("issues" in parsed ? parsed : parsed.result) as ScanResult;
    expect(scan.issues.map((i) => [i.ruleId, i.fingerprint, i.element.selector])).toEqual([
      ["IMG-01", "0a1b2c3d", "main > img"],
      ["CLR-01", "ffffffff", "#pricing > p"],
    ]);
  });

  it("escapes strings that contain quotes, backslashes and control characters", () => {
    const issue = makeIssue({ description: 'He said "hi"\\ and\tleft\n', element: { html: '<a href="x?a=1&b=2">"</a>' } });
    const text = buildJsonReport(makeScanResult({ issues: [issue] }));
    const parsed = JSON.parse(text);
    const scan = ("issues" in parsed ? parsed : parsed.result) as ScanResult;
    expect(scan.issues[0].description).toBe('He said "hi"\\ and\tleft\n');
    expect(scan.issues[0].element.html).toBe('<a href="x?a=1&b=2">"</a>');
  });

  it("is deterministic for the same input", () => {
    // `exportedAt` is the current time: freeze the clock so both calls see the same millisecond.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:20:00.000Z"));
    try {
      const result = makeScanResult();
      expect(buildJsonReport(result)).toBe(buildJsonReport(result));
    } finally {
      vi.useRealTimers();
    }
  });
});
