import { describe, expect, it } from "vitest";
import { computeScore, isNotConformant, summarize } from "@shared/scoring";
import { makeIssue } from "./support/factories";

describe("computeScore (Lighthouse-style weighted pass rate)", () => {
  // Weights: Critical 10, Serious 7, Moderate 3, Minor 1.
  it("returns 100 when no rule applies", () => {
    expect(computeScore([])).toBe(100);
  });

  it("returns 100 when every applicable rule passes", () => {
    expect(computeScore([], ["image-alt", "label"], { "image-alt": "Critical", label: "Critical" })).toBe(100);
  });

  it("is the weight of passed rules over the weight of all applicable rules", () => {
    // 35 passed Moderate rules = 105; failed: one Serious rule (7) + one Moderate rule (3).
    const passed = Array.from({ length: 35 }, (_, n) => `rule-${n}`);
    const severity = Object.fromEntries(passed.map((id) => [id, "Moderate" as const]));
    const issues = [
      ...Array.from({ length: 11 }, () => makeIssue({ ruleId: "CLR-01", severity: "Serious" })),
      ...Array.from({ length: 23 }, () => makeIssue({ ruleId: "TGT-01", severity: "Moderate" })),
    ];
    // round(100 x 105 / (105 + 7 + 3)) = 91
    expect(computeScore(issues, passed, severity)).toBe(91);
  });

  it("counts a failed rule once, however many elements fail", () => {
    const one = computeScore([makeIssue({ ruleId: "CLR-01", severity: "Serious" })], ["a"], { a: "Serious" });
    const many = computeScore(
      Array.from({ length: 50 }, () => makeIssue({ ruleId: "CLR-01", severity: "Serious" })),
      ["a"],
      { a: "Serious" },
    );
    expect(one).toBe(50);
    expect(many).toBe(one);
  });

  it("weights a failed rule by its most severe open finding", () => {
    const issues = [makeIssue({ ruleId: "ARIA-02", severity: "Minor" }), makeIssue({ ruleId: "ARIA-02", severity: "Critical" })];
    // passed 10 / (10 + 10)
    expect(computeScore(issues, ["x"], { x: "Critical" })).toBe(50);
  });

  it("leaves out rules whose findings are all baselined, ignored or fixed", () => {
    const issues = [
      makeIssue({ ruleId: "A", severity: "Critical", status: "baselined" }),
      makeIssue({ ruleId: "B", severity: "Critical", status: "ignored" }),
      makeIssue({ ruleId: "C", severity: "Critical", status: "fixed" }),
    ];
    expect(computeScore(issues, ["x"], { x: "Minor" })).toBe(100);
  });

  it("does not count a rule as passed when it also failed (e.g. in another frame)", () => {
    const issues = [makeIssue({ ruleId: "IMG-01", severity: "Critical", data: { axeRuleId: "image-alt" } })];
    expect(computeScore(issues, ["image-alt"], { "image-alt": "Critical" })).toBe(0);
  });

  it("does not count undeterminable (Semi) findings", () => {
    expect(computeScore([makeIssue({ severity: "Critical", type: "Semi" })], ["x"], { x: "Minor" })).toBe(100);
  });

  it("weighs best-practice rules as Minor and defaults unknown passed rules to Moderate", () => {
    const issues = [makeIssue({ ruleId: "STR-06", severity: "Serious", bestPractice: true })];
    // passed: 1 unknown (Moderate 3); failed: best practice (Minor 1) -> 3 / 4
    expect(computeScore(issues, ["legacy-rule"])).toBe(75);
  });
});

describe("summarize", () => {
  it("counts active issues by severity and best practice, ignoring Semi findings", () => {
    const issues = [
      makeIssue({ severity: "Critical" }),
      makeIssue({ severity: "Serious" }),
      makeIssue({ severity: "Serious" }),
      makeIssue({ severity: "Moderate" }),
      makeIssue({ severity: "Minor" }),
      makeIssue({ severity: "Serious", type: "Semi" }),
      makeIssue({ severity: "Moderate", bestPractice: true }),
      makeIssue({ severity: "Critical", status: "baselined" }),
      makeIssue({ severity: "Critical", status: "ignored" }),
    ];
    expect(summarize(issues, ["a", "b", "c"])).toEqual({
      critical: 1,
      serious: 2,
      moderate: 1,
      minor: 1,
      bestPractice: 1,
      passed: 3,
    });
  });

  it("returns zeros for an empty scan", () => {
    expect(summarize([], [])).toEqual({ critical: 0, serious: 0, moderate: 0, minor: 0, bestPractice: 0, passed: 0 });
  });
});

describe("isNotConformant", () => {
  it("is true for an active definite Critical WCAG issue", () => {
    expect(isNotConformant([makeIssue({ severity: "Critical" })])).toBe(true);
  });

  it("is false when the only criticals are baselined, ignored, Semi, or best practice", () => {
    expect(isNotConformant([makeIssue({ severity: "Critical", status: "baselined" })])).toBe(false);
    expect(isNotConformant([makeIssue({ severity: "Critical", status: "ignored" })])).toBe(false);
    expect(isNotConformant([makeIssue({ severity: "Critical", type: "Semi" })])).toBe(false);
    expect(isNotConformant([makeIssue({ severity: "Critical", bestPractice: true })])).toBe(false);
  });

  it("is false for serious and lower severities", () => {
    expect(isNotConformant([makeIssue({ severity: "Serious" }), makeIssue({ severity: "Moderate" })])).toBe(false);
    expect(isNotConformant([])).toBe(false);
  });
});
