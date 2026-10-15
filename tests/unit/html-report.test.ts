import { describe, expect, it } from "vitest";
import { buildHtmlReport, buildMultiPageHtmlReport, multiPageReportData } from "@src/background/exporters/html-report";
import { buildMultiPageReport, buildReport } from "@src/background/exporters/index";
import { makeIssue, makeScanResult } from "./support/factories";

describe("buildHtmlReport", () => {
  it("is a self-contained page: CSP, no scripts, no external resources", () => {
    const html = buildHtmlReport(makeScanResult());
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/src="https?:/i);
  });

  it("escapes untrusted page content", () => {
    const issue = makeIssue({ title: "<img src=x onerror=alert(1)>", element: { html: '<b onclick="x()">hi</b>' } });
    const html = buildHtmlReport(makeScanResult({ issues: [issue], title: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;b onclick=&quot;x()&quot;&gt;hi&lt;/b&gt;");
  });

  it("has no WCAG conformance table", () => {
    expect(buildHtmlReport(makeScanResult())).not.toContain("Conformance by success criterion");
  });

  it("shows the score, the donut total and one details block per failed rule", () => {
    const issues = [
      makeIssue({ ruleId: "CLR-01", title: "Text contrast", severity: "Serious" }),
      makeIssue({ ruleId: "CLR-01", title: "Text contrast", severity: "Serious" }),
      makeIssue({ ruleId: "IMG-01", title: "Missing alt", severity: "Critical" }),
    ];
    const html = buildHtmlReport(makeScanResult({ issues, score: 77 }));
    expect(html).toContain("Accessibility score 77 out of 100");
    expect(html).toContain("3 open issues: 1 critical, 2 serious, 0 moderate, 0 minor");
    expect(html.match(/<article id="rule-/g)).toHaveLength(2);
    expect(html).toContain("Element 2 of 2");
  });

  it("lists baselined and ignored issues separately, outside the totals", () => {
    const issues = [makeIssue({ severity: "Serious" }), makeIssue({ severity: "Critical", status: "ignored", reason: "false positive" })];
    const html = buildHtmlReport(makeScanResult({ issues }));
    expect(html).toContain("Excluded issues (1)");
    expect(html).toContain("Ignored (false positive)");
    expect(html).toContain("1 open issues: 0 critical, 1 serious");
    expect(html).toContain("false positive");
  });

  it("has a plain-language summary part and a developer part", () => {
    const issues = [makeIssue({ ruleId: "CLR-01", severity: "Serious" }), makeIssue({ ruleId: "IMG-01", title: "Missing alt", severity: "Critical" })];
    const html = buildHtmlReport(makeScanResult({ issues }));
    expect(html).toContain("Part 1 · Summary");
    expect(html).toContain("Part 2 · Developer details");
    expect(html).toContain("critical barriers found");
    expect(html).toContain("Fix these first");
    expect(html).toContain("Images have no text description");
    expect(html).toContain("Who is affected");
    expect(html).toContain("Screen reader users");
    expect(html).toContain("roughly 30–40%");
  });

  it("keeps XPath and fingerprint inside the collapsed technical details", () => {
    const issue = makeIssue({ fingerprint: "abc12345" });
    const html = buildHtmlReport(makeScanResult({ issues: [issue] }));
    const tech = html.indexOf('<details class="tech">');
    expect(tech).toBeGreaterThan(-1);
    expect(html.indexOf("abc12345")).toBeGreaterThan(tech);
    expect(html.indexOf(issue.element.xpath)).toBeGreaterThan(tech);
  });

  it("strips framework comments from HTML snippets", () => {
    const issue = makeIssue({ element: { html: '<span class="x">Log In<!----></span>' } });
    const html = buildHtmlReport(makeScanResult({ issues: [issue] }));
    expect(html).not.toContain("&lt;!----&gt;");
    expect(html).toContain("&lt;span class=&quot;x&quot;&gt;Log In&lt;/span&gt;");
  });

  it("shows each element's own contrast values with a suggested colour, including axe results", () => {
    const axe = makeIssue({
      source: "axe",
      description: "Ensure the contrast meets thresholds. Element has insufficient color contrast of 2.72.",
      data: { axeRuleId: "color-contrast", checks: [{ id: "color-contrast", data: { fgColor: "#ffffff", bgColor: "#4ab234", contrastRatio: 2.72, expectedContrastRatio: "4.5:1", fontSize: "12.0pt (16px)" } }] },
      fix: { summary: "Elements must meet contrast thresholds.", suggestedValue: undefined },
    });
    const html = buildHtmlReport(makeScanResult({ issues: [axe] }));
    expect(html).toContain("has a contrast of 2.72:1 (#ffffff on #4ab234). At least 4.5:1 is needed.");
    expect(html).toContain("Suggested");
    expect(html).not.toContain("Ensure the contrast meets thresholds. Element has insufficient");
  });

  it("points out elements that share one selector pattern", () => {
    const issues = [1, 2, 3].map((n) => makeIssue({ element: { selector: `tr:nth-of-type(${n}) > td > span.number` } }));
    const html = buildHtmlReport(makeScanResult({ issues }));
    expect(html).toContain("Likely fewer fixes than elements");
    expect(html).toContain("<b>3 elements</b> share <code>tr &gt; td &gt; span.number</code>");
  });

  it("shows the organisation and author only when given", () => {
    expect(buildHtmlReport(makeScanResult())).not.toContain("Prepared by");
    const html = buildHtmlReport(makeScanResult(), { preparedBy: "QA team", organisation: "Acme <Ltd>" });
    expect(html).toContain("<dt>Prepared by</dt><dd>QA team</dd>");
    expect(html).toContain("Acme &lt;Ltd&gt;");
  });
});

describe("severity filter in the developer details", () => {
  const mixed = [
    makeIssue({ ruleId: "IMG-01", title: "Missing alt", severity: "Critical" }),
    makeIssue({ ruleId: "IMG-01", title: "Missing alt", severity: "Critical" }),
    makeIssue({ ruleId: "CLR-01", title: "Text contrast", severity: "Moderate" }),
  ];

  it("has one toggle per severity that occurs, all ticked, and tags rules and elements", () => {
    const html = buildHtmlReport(makeScanResult({ issues: mixed }));
    expect(html).toContain('class="devfilter"');
    expect(html).toContain('<input type="checkbox" class="sr-only" id="f-Critical" checked>');
    expect(html).toContain('<input type="checkbox" class="sr-only" id="f-Moderate" checked>');
    expect(html).not.toContain('id="f-Serious"');
    expect(html).not.toContain('id="f-Minor"');
    expect(html).toContain('<label for="f-Critical" class="fchip">');
    expect(html.match(/<li class="inst" data-sev="Critical">/g)).toHaveLength(2);
    expect(html.match(/<li class="inst" data-sev="Moderate">/g)).toHaveLength(1);
    expect(html).toContain('<article id="rule-img-01');
    expect(html).toMatch(/<article id="rule-img-01[^>]*data-sevs="Critical"/);
    expect(html).toMatch(/<tr data-sevs="Moderate">/);
  });

  it("keeps the report script-free and shows a notice only when no severity is ticked", () => {
    const html = buildHtmlReport(makeScanResult({ issues: mixed }));
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("#f-Critical:not(:checked)~#f-Moderate:not(:checked)~.nothing{display:block}");
  });

  it("shows no filter when every issue has the same severity", () => {
    const html = buildHtmlReport(makeScanResult({ issues: [mixed[0], mixed[1]] }));
    expect(html).not.toContain('class="devfilter"');
    expect(html).not.toContain('type="checkbox"');
  });
});

describe("multi-page report", () => {
  const home = makeScanResult({
    title: "Home",
    url: "https://example.com/",
    score: 80,
    issues: [
      makeIssue({ ruleId: "IMG-01", title: "Missing alt", severity: "Critical" }),
      makeIssue({ ruleId: "CLR-01", title: "Text contrast", severity: "Moderate" }),
      makeIssue({ ruleId: "CLR-01", title: "Text contrast", severity: "Moderate", status: "ignored" }),
    ],
  });
  const checkout = makeScanResult({
    title: "Checkout </script><script>alert(1)</script>",
    url: "https://example.com/checkout",
    score: 40,
    issues: [makeIssue({ ruleId: "IMG-01", title: "Missing alt", severity: "Critical" })],
  });

  /** The JSON embedded in the report, parsed back. */
  const embedded = (html: string) => JSON.parse(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(html)![1]);

  it("maps each scan to one page with its open issues grouped by rule", () => {
    const data = multiPageReportData([home, checkout]);
    expect(data.pages.map((p) => p.title)).toEqual(["Home", "Checkout </script><script>alert(1)</script>"]);
    expect(data.pages[0].rules.map((r) => [r.code, r.severity, r.elements.length])).toEqual([
      ["IMG-01", "Critical", 1],
      ["CLR-01", "Moderate", 1],
    ]);
    expect(data.pages[0].issuesExcluded).toBe(1);
    expect(data.pages[0].rules[0].why).toBeTruthy();
    expect(data.site.origin).toBe("https://example.com");
  });

  it("embeds the data so page text cannot break out of the script block", () => {
    const html = buildMultiPageHtmlReport([home, checkout]);
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).not.toContain("__REPORT_DATA__");
    expect(embedded(html).pages[1].title).toBe("Checkout </script><script>alert(1)</script>");
  });

  it("allows only its own renderer script, with a fresh nonce per export", () => {
    const a = buildMultiPageHtmlReport([home, checkout]);
    const b = buildMultiPageHtmlReport([home, checkout]);
    const nonce = /script-src 'nonce-([0-9a-f]{32})'/.exec(a)?.[1];
    expect(nonce).toBeDefined();
    expect(a).toContain(`<script nonce="${nonce}">`);
    expect(a).not.toContain("__CSP_NONCE__");
    // The data block and the renderer; "<script" also appears in a comment inside the renderer.
    expect(a.match(/<script (?:type|nonce)=/g)).toHaveLength(2);
    expect(a).not.toMatch(/<script>/);
    expect(/script-src 'nonce-([0-9a-f]{32})'/.exec(b)?.[1]).not.toBe(nonce);
  });

  it("names one file for all pages; one scan gets its own file name and the same interactive template", () => {
    const now = new Date(2026, 9, 12, 9, 30, 0);
    expect(buildMultiPageReport("html", [home, checkout], {}, now).filename).toBe("a11y-report_2-pages_20261012-093000.html");
    expect(JSON.parse(buildMultiPageReport("json", [home, checkout], {}, now).content).pages).toHaveLength(2);
    const single = buildMultiPageReport("html", [home], {}, now);
    expect(single.filename).not.toContain("pages");
    expect(single.content).toContain('id="report-data"');
    expect(single.content).toMatch(/script-src 'nonce-[0-9a-f]{32}'/);
  });

  it("every HTML export, single scan included, uses the interactive template", () => {
    const html = buildReport("html", home).content;
    expect(html).toContain('id="report-data"');
    expect(html).toContain("Accessibility report template (multi-page)");
  });

  it("carries the Options page organisation and prepared-by into the template", () => {
    const data = multiPageReportData([home], { organisation: "PalTech", preparedBy: "QA team" });
    expect(data.organisation).toBe("PalTech");
    expect(data.preparedBy).toBe("QA team");
    expect(multiPageReportData([home]).preparedBy).toBe("");
  });
});
