/**
 * axe DevTools parity features: definite-only scoring, WCAG
 * version selection, result tabs / search, failed rules and saved-scan names.
 */
import { describe, expect, it } from "vitest";
import { computeScore, isNotConformant, summarize } from "@shared/scoring";
import { axeTagsFor, criterionInVersion, criterionVersion } from "@shared/wcag-map";
import { DEFAULT_FILTERS, failedRules, matchesFilters, ruleGroupKey } from "@src/sidepanel/store";
import { savedScanName } from "@src/sidepanel/components/SavedScans";
import { makeIssue, makeScanResult } from "./support/factories";

describe("undeterminable findings", () => {
  it("never count toward the score, summary or conformance", () => {
    const semi = makeIssue({ type: "Semi", severity: "Critical" });
    expect(computeScore([semi])).toBe(100);
    const s = summarize([semi], []);
    expect(s.critical).toBe(0);
    expect(isNotConformant([semi])).toBe(false);
  });

  it("Manual Critical findings make the page not conformant", () => {
    expect(isNotConformant([makeIssue({ type: "Manual", severity: "Critical", source: "manual" })])).toBe(true);
  });
});

describe("WCAG version selection", () => {
  it("knows which version introduced a criterion", () => {
    expect(criterionVersion("1.1.1")).toBe("2.0");
    expect(criterionVersion("1.4.10")).toBe("2.1");
    expect(criterionVersion("2.5.8")).toBe("2.2");
    expect(criterionInVersion("2.5.8", "2.1")).toBe(false);
    expect(criterionInVersion("1.4.11", "2.1")).toBe(true);
    expect(criterionInVersion("1.4.11", "2.0")).toBe(false);
    expect(criterionInVersion("", "2.0")).toBe(true);
  });

  it("maps version and level to axe tags", () => {
    expect(axeTagsFor("2.2", "AA")).toEqual(["wcag2a", "wcag21a", "wcag2aa", "wcag21aa", "wcag22aa"]);
    expect(axeTagsFor("2.1", "AA")).toEqual(["wcag2a", "wcag21a", "wcag2aa", "wcag21aa"]);
    expect(axeTagsFor("2.0", "A")).toEqual(["wcag2a"]);
    expect(axeTagsFor("2.2", "AAA")).toEqual(["wcag2a", "wcag21a", "wcag2aa", "wcag21aa", "wcag22aa", "wcag2aaa"]);
  });
});

describe("result tabs and search", () => {
  const auto = makeIssue({ title: "Image missing alt", ruleId: "IMG-01", element: { selector: "#hero img" } });
  const guided = makeIssue({ type: "Manual", source: "manual", title: "Heading does not describe its section" });
  const bp = makeIssue({ bestPractice: true, title: "Landmark missing" });

  it("splits issues into the axe-style tabs", () => {
    const f = DEFAULT_FILTERS;
    expect([auto, guided, bp].filter((i) => matchesFilters(i, f, "all"))).toHaveLength(3);
    expect([auto, guided, bp].filter((i) => matchesFilters(i, f, "auto"))).toEqual([auto, guided]);
    expect([auto, guided, bp].filter((i) => matchesFilters(i, f, "bp"))).toEqual([bp]);
    expect([auto, guided, bp].filter((i) => matchesFilters(i, f, "passed"))).toEqual([]);
  });

  it("filters by status: open by default, only ignored, or everything", () => {
    const open = makeIssue();
    const ignored = makeIssue({ status: "ignored" });
    const baselined = makeIssue({ status: "baselined" });
    const all = [open, ignored, baselined];
    expect(all.filter((i) => matchesFilters(i, DEFAULT_FILTERS))).toEqual([open]);
    expect(all.filter((i) => matchesFilters(i, { ...DEFAULT_FILTERS, statuses: ["ignored"] }))).toEqual([ignored]);
    expect(all.filter((i) => matchesFilters(i, { ...DEFAULT_FILTERS, statuses: ["ignored", "baselined"] }))).toEqual([ignored, baselined]);
    expect(all.filter((i) => matchesFilters(i, { ...DEFAULT_FILTERS, statuses: [] }))).toEqual(all);
    // Combines with the other filters.
    expect(matchesFilters(ignored, { ...DEFAULT_FILTERS, statuses: ["ignored"], severities: ["Critical"] })).toBe(false);
  });

  it("searches title, rule id and selector with all terms required", () => {
    expect(matchesFilters(auto, { ...DEFAULT_FILTERS, search: "img-01" })).toBe(true);
    expect(matchesFilters(auto, { ...DEFAULT_FILTERS, search: "hero alt" })).toBe(true);
    expect(matchesFilters(auto, { ...DEFAULT_FILTERS, search: "hero zebra" })).toBe(false);
  });

  it("groups instances of the same rule together", () => {
    const a = makeIssue({ ruleId: "CLR-01", title: "Text contrast" });
    const b = makeIssue({ ruleId: "CLR-01", title: "Text contrast" });
    expect(ruleGroupKey(a)).toBe(ruleGroupKey(b));
    expect(ruleGroupKey(a)).not.toBe(ruleGroupKey(auto));
  });
});

describe("saved scan names", () => {
  it("adds the save date and time to the name the tester typed", () => {
    const name = savedScanName("  Checkout page  ", new Date(2026, 8, 29, 12, 13));
    expect(name.startsWith("Checkout page – ")).toBe(true);
    expect(name).toMatch(/2026/);
    expect(name).toMatch(/12:13|12\.13/);
  });
});
