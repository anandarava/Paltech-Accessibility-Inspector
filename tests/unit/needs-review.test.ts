import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, failedRules, isNeedsReviewIssue, matchesFilters, matchesTab } from "@src/sidepanel/store";
import { computeScore, summarize } from "@shared/scoring";
import { buildHtmlReport, multiPageReportData } from "@src/background/exporters/html-report";
import { makeIssue, makeScanResult } from "./support/factories";

const failure = () => makeIssue({ ruleId: "CLR-01", title: "Text contrast", severity: "Serious" });
const review = () => makeIssue({ ruleId: "CLR-03", title: "Text over image", severity: "Serious", type: "Semi" });

describe("needs-review findings", () => {
  it("are listed only in the Needs review tab", () => {
    const r = review();
    expect(isNeedsReviewIssue(r)).toBe(true);
    expect(matchesTab(r, "review")).toBe(true);
    for (const tab of ["all", "auto", "bp", "failed", "passed", "na"] as const) expect(matchesTab(r, tab)).toBe(false);

    const f = failure();
    expect(matchesTab(f, "review")).toBe(false);
    expect(matchesTab(f, "all")).toBe(true);
  });

  it("still honour the filters inside their tab", () => {
    const r = review();
    expect(matchesFilters(r, DEFAULT_FILTERS, "review")).toBe(true);
    expect(matchesFilters(r, { ...DEFAULT_FILTERS, severities: ["Critical"] }, "review")).toBe(false);
  });

  it("are not failed rules", () => {
    const rules = failedRules(makeScanResult({ issues: [failure(), review()] }), DEFAULT_FILTERS);
    expect(rules.map((r) => r.ruleId)).toEqual(["CLR-01"]);
  });

  it("do not change the score or the severity totals", () => {
    const withReview = [failure(), review()];
    expect(computeScore(withReview, ["image-alt"])).toBe(computeScore([failure()], ["image-alt"]));
    expect(summarize(withReview, []).serious).toBe(1);
  });

  it("get their own section in the HTML report, outside the totals", () => {
    const html = buildHtmlReport(makeScanResult({ issues: [failure(), review()] }));
    expect(html).toContain("Needs review (1)");
    expect(html).toContain("1 open issues: 0 critical, 1 serious");
    expect(html.match(/<article id="rule-/g)).toHaveLength(1);
    expect(html).not.toContain("Excluded issues");
  });

  it("are shown as the same rule cards as the issues, badged and with their own ids", () => {
    const failing = makeIssue({ ruleId: "CLR-05", title: "Focus indicator below 3:1 against adjacent colors", severity: "Serious" });
    const reviewing = makeIssue({ ruleId: "CLR-05", title: "Focus indicator below 3:1 against adjacent colors", severity: "Serious", type: "Semi" });
    const html = buildHtmlReport(makeScanResult({ issues: [failing, reviewing] }));
    // Same card layout: header, why it matters, how to fix, and the element list.
    const card = /<article id="review-[^"]+" class="rule"[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    expect(card).toContain("Why it matters");
    expect(card).toContain("How to fix");
    expect(card).toContain('<ol class="instances"');
    expect(card).toContain("Needs review · not counted");
    // The same rule as a failure and as a review item: two cards, no duplicate ids.
    const ids = [...html.matchAll(/<article id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(html).toContain('<a href="#h-review">Needs review</a>');
    expect(html).toContain("Rules to review");
    // Still outside the totals.
    expect(html).toContain("1 open issues: 0 critical, 1 serious");
  });

  it("leave the HTML report without a review section when there are none", () => {
    expect(buildHtmlReport(makeScanResult({ issues: [failure()] }))).not.toContain("Needs review");
  });

  it("are neither rules nor excluded issues in the multi-page report", () => {
    const data = multiPageReportData([makeScanResult({ issues: [failure(), review()] })]);
    const page = data.pages[0];
    expect(page.rules).toHaveLength(1);
    expect(page.issuesExcluded).toBe(0);
    // Listed apart, as the same rule cards.
    expect(page.review).toHaveLength(1);
    expect(page.review[0]?.code).toBe("CLR-03");
  });
});
