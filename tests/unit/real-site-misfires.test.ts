/**
 * Regression tests for misfires found by scanning real sites (MISFIRE_REPORT.md).
 * Layout-dependent cases (clipping, inline targets, focus rings) are covered by
 * the e2e fixtures; these cover the logic jsdom can run.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AxeResults, NodeResult, Result } from "axe-core";
import rulesFile from "@shared/a11y-rules.json";
import type { RulesFile } from "@shared/types";
import { normalizeAxeResults } from "@src/content/normalizer";
import { filterFrameLevelIssues } from "@src/content/scanner";
import { firstBorderColor, isDefaultFocusRing } from "@src/content/rules/focus-visible";
import { isCodeTerm, rule as linkText } from "@src/content/rules/link-text";
import { gradientStops, rule as contrast } from "@src/content/rules/contrast";
import { findingRuleId, makeIssue, makeRuleContext, setBody } from "./support/factories";

const RULES = rulesFile as unknown as RulesFile;

function axeResult(id: string, tags: string[], selector: string, impact: string | null, nodeImpact?: string): Result {
  return {
    id,
    tags,
    help: "Help",
    helpUrl: "",
    description: "Description",
    impact,
    nodes: [{ html: "<x>", target: [selector], any: [], all: [], none: [], impact: nodeImpact } as unknown as NodeResult],
  } as unknown as Result;
}

function results(violations: Result[], incomplete: Result[] = []): AxeResults {
  return { violations, incomplete, passes: [], inapplicable: [] } as unknown as AxeResults;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("CLR-05: Chrome's default focus ring", () => {
  it("recognises outline: auto in the default ring colour", () => {
    expect(isDefaultFocusRing({ outlineStyle: "auto", outlineColor: "rgb(16, 16, 16)" })).toBe(true);
  });

  it("measures an author colour or a solid outline as usual", () => {
    expect(isDefaultFocusRing({ outlineStyle: "auto", outlineColor: "rgb(200, 200, 200)" })).toBe(false);
    expect(isDefaultFocusRing({ outlineStyle: "solid", outlineColor: "rgb(16, 16, 16)" })).toBe(false);
  });
});

describe("CLR-05: border indicators", () => {
  it("reads a border colour that contains spaces", () => {
    const s = { borderColor: "rgb(255, 255, 255) rgb(255, 255, 255) rgb(255, 255, 255) rgb(255, 255, 255)", borderWidth: "2px 2px 2px 2px", borderStyle: "solid solid solid solid" };
    expect(firstBorderColor(s)).toBe("rgb(255, 255, 255)");
  });

  it("takes the first side that is drawn", () => {
    const s = { borderColor: "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0) rgb(11, 12, 12) rgba(0, 0, 0, 0)", borderWidth: "0px 0px 4px 0px", borderStyle: "none none solid none" };
    expect(firstBorderColor(s)).toBe("rgb(11, 12, 12)");
  });
});

describe("page-level rules inside child frames", () => {
  const axeIssue = (axeRuleId: string) => makeIssue({ source: "axe", data: { axeRuleId } });

  it("drops title, h1, main and bypass findings in a child frame", () => {
    const issues = ["document-title", "page-has-heading-one", "landmark-one-main", "bypass", "image-alt"].map(axeIssue);
    const kept = filterFrameLevelIssues(issues, false, document);
    expect(kept.map((i) => i.data?.axeRuleId)).toEqual(["image-alt"]);
  });

  it("keeps them in the top frame", () => {
    const issues = ["document-title", "landmark-one-main"].map(axeIssue);
    expect(filterFrameLevelIssues(issues, true, document)).toHaveLength(2);
  });

  it("drops a missing lang only in a frame without text", () => {
    const issues = [axeIssue("html-has-lang")];
    setBody("");
    expect(filterFrameLevelIssues(issues, false, document)).toHaveLength(0);
    setBody("<p>Hello</p>");
    // jsdom has no innerText; the frame is treated as having text.
    Object.defineProperty(document.body, "innerText", { value: "Hello", configurable: true });
    expect(filterFrameLevelIssues(issues, false, document)).toHaveLength(1);
  });
});

describe("axe results known to misfire", () => {
  it("drops label-content-name-mismatch when the control shows no text", () => {
    setBody('<a id="bag" href="/bag" aria-label="Shopping Bag"><span aria-hidden="true">0 +</span></a>');
    const issues = normalizeAxeResults(results([axeResult("label-content-name-mismatch", ["wcag21a", "wcag253", "experimental"], "#bag", "serious")]), RULES);
    expect(issues).toHaveLength(0);
  });

  it("drops region on a skip link that points to the main landmark", () => {
    setBody('<a id="cookies" href="/help/cookies">Cookies</a><a id="skip" href="#content">Skip to main content</a><main id="content">x</main>');
    const issues = normalizeAxeResults(results([axeResult("region", ["cat.keyboard", "best-practice"], "#skip", "moderate")]), RULES);
    expect(issues).toHaveLength(0);
  });

  it("keeps region on other content outside landmarks", () => {
    setBody('<h2 id="feedback">Is this page useful?</h2><main id="content">x</main>');
    const issues = normalizeAxeResults(results([axeResult("region", ["cat.keyboard", "best-practice"], "#feedback", "moderate")]), RULES);
    expect(issues).toHaveLength(1);
  });
});

describe("axe needs-review results this extension can settle", () => {
  function reviewNode(selector: string, data: unknown, message = "msg"): NodeResult {
    return { html: "<x>", target: [selector], any: [{ id: "c", message, data }], all: [], none: [], impact: "serious" } as unknown as NodeResult;
  }
  function result(id: string, nodes: NodeResult[]): Result {
    return { id, tags: ["wcag2a", "wcag412"], help: "Help", helpUrl: "", description: "Description", impact: "serious", nodes } as unknown as Result;
  }

  it("drops a hidden copy of a role already reported as not allowed", () => {
    setBody('<ul><li id="shown" role="tabpanel">a</li><li id="hidden" role="tabpanel" hidden>b</li><li id="other" role="slider" hidden>c</li></ul>');
    const issues = normalizeAxeResults(
      results([result("aria-allowed-role", [reviewNode("#shown", ["tabpanel"])])], [result("aria-allowed-role", [reviewNode("#hidden", ["tabpanel"]), reviewNode("#other", ["slider"])])]),
      RULES,
    );
    expect(issues.map((i) => `${i.element.selector}/${i.type}`)).toEqual(["#shown/Auto", "#other/Semi"]);
  });

  it("drops a popup reference that exists, or belongs to a collapsed control", () => {
    setBody('<button id="a" aria-haspopup="true" aria-controls="menu">A</button><div id="menu"></div><button id="b" aria-haspopup="true" aria-expanded="false" aria-controls="later">B</button><button id="c" aria-haspopup="true" aria-controls="gone">C</button>');
    const nodes = [
      reviewNode("#a", { messageKey: "controlsWithinPopup", needsReview: 'aria-controls="menu"' }),
      reviewNode("#b", { messageKey: "controlsWithinPopup", needsReview: 'aria-controls="later"' }),
      reviewNode("#c", { messageKey: "controlsWithinPopup", needsReview: 'aria-controls="gone"' }),
    ];
    const issues = normalizeAxeResults(results([], [result("aria-valid-attr-value", nodes)]), RULES);
    expect(issues.map((i) => i.element.selector)).toEqual(["#c"]);
  });

  it("makes aria-labelledby with no existing ids a definite failure", () => {
    setBody('<div id="d" role="dialog" aria-labelledby="t1 t2">x</div><div id="e" role="dialog" aria-describedby="n1">y</div>');
    const issues = normalizeAxeResults(
      results([], [result("aria-valid-attr-value", [
        reviewNode("#d", { messageKey: "noId", needsReview: 'aria-labelledby="t1 t2"' }),
        reviewNode("#e", { messageKey: "noId", needsReview: 'aria-describedby="n1"' }),
      ])]),
      RULES,
    );
    expect(issues.map((i) => `${i.element.selector}/${i.type}`)).toEqual(["#d/Auto", "#e/Semi"]);
    expect(issues[0]?.description).toContain("no name from aria-labelledby");
  });
});

describe("needs review severity", () => {
  it("uses axe's impact for an undecided result, not the project rule's severity", () => {
    setBody('<div id="d" aria-label="x">x</div>');
    const issues = normalizeAxeResults(results([], [axeResult("aria-prohibited-attr", ["wcag2a", "wcag412"], "#d", "serious", "moderate")]), RULES);
    expect(issues[0]?.type).toBe("Semi");
    expect(issues[0]?.severity).toBe("Moderate");
  });

  it("never rates an undecided result Critical", () => {
    setBody('<div id="d" aria-label="x">x</div>');
    const issues = normalizeAxeResults(results([], [axeResult("aria-prohibited-attr", ["wcag2a", "wcag412"], "#d", "critical", "critical")]), RULES);
    expect(issues[0]?.severity).toBe("Serious");
  });
});

describe("LNK-03: a code term is not vague text", () => {
  it("recognises a link whose text is one code element", () => {
    setBody('<a id="a" href="/Roles/link_role"><code>link</code></a><a id="b" href="/x">link</a>');
    expect(isCodeTerm(document.getElementById("a") as Element)).toBe(true);
    expect(isCodeTerm(document.getElementById("b") as Element)).toBe(false);
  });

  it("does not flag the code term but still flags plain vague text", async () => {
    setBody('<p><a id="a" href="/Roles/link_role"><code>link</code></a> and <a id="b" href="/x">link</a></p>');
    const findings = await linkText.run(makeRuleContext(document));
    const vague = findings.filter((f) => findingRuleId(f, linkText.id) === "LNK-03").map((f) => f.element.id);
    expect(vague).toEqual(["b"]);
  });
});

describe("CLR-01/03: gradients", () => {
  it("reads the colour stops of a computed gradient", () => {
    expect(gradientStops("linear-gradient(rgb(55, 118, 171) 10%, rgba(43, 91, 132, 0.5) 90%)")).toEqual([
      [55, 118, 171, 1],
      [43, 91, 132, 0.5],
    ]);
  });
});

describe("CLR-04: boundaries", () => {
  async function borderFindings(html: string): Promise<string[]> {
    setBody(html);
    const findings = await contrast.run(makeRuleContext(document));
    return findings.filter((f) => findingRuleId(f, contrast.id) === "CLR-04").map((f) => f.element.id);
  }

  it("does not ask a button for a boundary", async () => {
    expect(await borderFindings('<div style="background:#fff"><button id="b" style="border:1px solid #fff;background:transparent">Menu</button><input id="s" type="submit" value="Go" style="border:1px solid #fff;background:transparent"></div>')).toEqual([]);
  });

  it("ignores a transparent border", async () => {
    expect(await borderFindings('<div style="background:#fff"><input id="i" style="border:1px solid transparent;background:transparent"></div>')).toEqual([]);
  });

  it("still flags a faint field border", async () => {
    expect(await borderFindings('<div style="background:#fff"><input id="i" style="border:1px solid #babfc5;background:#fff"></div>')).toEqual(["i"]);
  });
});
