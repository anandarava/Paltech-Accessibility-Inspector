import { describe, expect, it } from "vitest";
import { effectivePassedRules, summarize } from "@shared/scoring";
import { makeIssue } from "./support/factories";

describe("summarize passed count", () => {
  it("excludes rules that also failed (e.g. passed in one frame, failed in another)", () => {
    const issues = [makeIssue({ ruleId: "IMG-01", data: { axeRuleId: "image-alt" } }), makeIssue({ ruleId: "CUSTOM-1" })];
    const passed = ["image-alt", "CUSTOM-1", "label", "label"];
    expect(effectivePassedRules(issues, passed)).toEqual(["label"]);
    expect(summarize(issues, passed).passed).toBe(1);
  });

  it("still counts a rule whose findings are all baselined", () => {
    const issues = [makeIssue({ ruleId: "label", status: "baselined" })];
    expect(summarize(issues, ["label"]).passed).toBe(1);
  });
});
