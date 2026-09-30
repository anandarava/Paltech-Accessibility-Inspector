/**
 * Regression tests for the axe -> Issue normalizer.
 *
 * The case that matters most here: several axe rules are mapped to a project
 * rule id in shared/wcag-map.ts for grouping purposes, but are tagged
 * `best-practice` only. Reporting those as definite WCAG Level A/AA failures
 * inflates the severity counts and, worse, can flip a page to the
 * "Not conformant" label over something WCAG never required.
 */
import { describe, expect, it } from "vitest";
import type { AxeResults, Result, NodeResult } from "axe-core";
import { normalizeAxeResults } from "@src/content/normalizer";
import rulesFile from "@shared/a11y-rules.json";
import type { RulesFile } from "@shared/types";

const RULES = rulesFile as unknown as RulesFile;

function node(html: string, target: string): NodeResult {
  return {
    html,
    target: [target],
    any: [],
    all: [],
    none: [],
    failureSummary: "Fix this",
  } as unknown as NodeResult;
}

function axeRule(id: string, tags: string[], nodes: NodeResult[], help = "Help text"): Result {
  return {
    id,
    tags,
    help,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}`,
    description: help,
    impact: "moderate",
    nodes,
  } as unknown as Result;
}

function results(violations: Result[], incomplete: Result[] = []): AxeResults {
  return { violations, incomplete, passes: [], inapplicable: [] } as unknown as AxeResults;
}

describe("normalizeAxeResults", () => {
  it("reports a best-practice-only axe rule as best practice, not as a WCAG failure", () => {
    // `region` is mapped to STR-06 but is tagged best-practice only.
    const issues = normalizeAxeResults(
      results([axeRule("region", ["cat.keyboard", "best-practice"], [node("<div>x</div>", "div")])]),
      RULES,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].wcag.level).toBe("BP");
    expect(issues[0].wcag.criterion).toBe("");
  });

  it("keeps the real criterion and level for a genuine WCAG rule", () => {
    const issues = normalizeAxeResults(
      results([axeRule("image-alt", ["cat.text-alternatives", "wcag2a", "wcag111"], [node("<img>", "img")])]),
      RULES,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe("IMG-01");
    expect(issues[0].wcag).toMatchObject({ criterion: "1.1.1", level: "A" });
  });

  it("never maps anything to the removed 4.1.1 Parsing criterion", () => {
    const issues = normalizeAxeResults(
      results([
        axeRule("duplicate-id-aria", ["cat.parsing", "wcag2a", "wcag412"], [node("<div id=a></div>", "#a")]),
        axeRule("region", ["cat.keyboard", "best-practice"], [node("<div>x</div>", "div")]),
        axeRule("image-alt", ["cat.text-alternatives", "wcag2a", "wcag111"], [node("<img>", "img")]),
      ]),
      RULES,
    );

    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(issue.wcag.criterion).not.toBe("4.1.1");
  });

  it("marks incomplete results as Semi so they never count toward the score", () => {
    const issues = normalizeAxeResults(
      results([], [axeRule("color-contrast", ["cat.color", "wcag2aa", "wcag143"], [node("<p>x</p>", "p")])]),
      RULES,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("Semi");
  });

  it("gives every issue a stable 8-character fingerprint", () => {
    const build = (): ReturnType<typeof normalizeAxeResults> =>
      normalizeAxeResults(results([axeRule("image-alt", ["wcag2a", "wcag111"], [node("<img>", "img")])]), RULES);

    const first = build();
    const second = build();
    expect(first[0].fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(first[0].fingerprint).toBe(second[0].fingerprint);
  });
});
