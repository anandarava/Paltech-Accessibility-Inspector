import { describe, expect, it } from "vitest";
import {
  FULL_REQUIREMENTS,
  FULL_TESTS,
  QUICK_ASSESS,
  locate,
  moveToFull,
  buildAssessmentHtml,
  criteriaConformance,
  buildAssessmentJson,
  failuresOf,
  newAssessment,
  pageKey,
  parseAssessment,
  requirementStatus,
  storageKey,
  summarize,
  type AssessmentState,
} from "@shared/assessment";

const req = (id: string) => QUICK_ASSESS.find((r) => r.id === id)!;
const links = [
  { key: "a", selector: "#a", text: "Return to cart", detail: "/cart", html: "<a>" },
  { key: "b", selector: "#b", text: "Click here", detail: "/terms", html: "<a>" },
];

describe("Quick Assess catalogue", () => {
  it("has 10 requirements with unique ids, steps and a fix", () => {
    expect(QUICK_ASSESS).toHaveLength(10);
    expect(new Set(QUICK_ASSESS.map((r) => r.id)).size).toBe(10);
    for (const r of QUICK_ASSESS) {
      expect(r.steps.length).toBeGreaterThan(1);
      expect(r.fix).toBeTruthy();
      if (r.kind === "assisted") expect(r.instances).toBeTruthy();
    }
  });
});

describe("requirementStatus", () => {
  it("manual: the recorded verdict, else to do", () => {
    expect(requirementStatus(req("keyboard-navigation"), undefined)).toBe("todo");
    expect(requirementStatus(req("keyboard-navigation"), { verdict: "fail", failures: [], marks: {} })).toBe("fail");
  });
  it("assisted: any failed instance fails it, all passed passes it, otherwise to do", () => {
    const r = req("link-purpose");
    expect(requirementStatus(r, { failures: [], marks: { a: "pass" }, instances: links })).toBe("todo");
    expect(requirementStatus(r, { failures: [], marks: { a: "pass", b: "pass" }, instances: links })).toBe("pass");
    expect(requirementStatus(r, { failures: [], marks: { b: "fail" }, instances: links })).toBe("fail");
    // nothing on the page: the tester's verdict decides
    expect(requirementStatus(r, { verdict: "pass", failures: [], marks: {}, instances: [] })).toBe("pass");
  });
});

describe("summary, failures and keys", () => {
  const state: AssessmentState = {
    ...newAssessment("https://shop.example/checkout#pay", "Checkout"),
    results: {
      "keyboard-navigation": { verdict: "fail", failures: [{ id: "f1", description: "Saved card link not reachable", selector: "#saved" }], marks: {} },
      "link-purpose": { failures: [], marks: { a: "pass", b: "fail" }, notes: { b: "Terms not named" }, instances: links },
      reflow: { verdict: "pass", failures: [], marks: {} },
    },
  };
  it("counts passed, failed and to do, and finds the next requirement", () => {
    const s = summarize(state);
    expect(s).toMatchObject({ total: 10, passed: 1, failed: 2, todo: 7, percent: 30 });
    expect(s.next?.id).toBe("image-function");
  });
  it("turns failed instances into failures with the tester's note", () => {
    expect(failuresOf(req("link-purpose"), state.results["link-purpose"])).toEqual([expect.objectContaining({ description: "Terms not named", selector: "#b" })]);
  });
  it("keys a page without its fragment", () => {
    expect(pageKey("https://shop.example/checkout#pay")).toBe("https://shop.example/checkout");
    expect(storageKey("https://shop.example/checkout#x")).toBe("assessment:quick:https://shop.example/checkout");
  });
  it("builds an HTML report and a JSON export by success criterion", () => {
    const html = buildAssessmentHtml(state, { description: "Before release <v2>" });
    expect(html).toContain("Does not conform");
    expect(html).toContain("Saved card link not reachable");
    expect(html).toContain("Before release &lt;v2&gt;");
    const json = JSON.parse(buildAssessmentJson(state));
    expect(json.byCriterion["2.4.4"].status).toBe("fail");
    expect(json.byCriterion["1.4.10"].status).toBe("pass");
    expect(json.summary.next).toBe("image-function");
  });
  it("loads a saved file, and rejects other files", () => {
    const loaded = parseAssessment(JSON.stringify(state));
    expect(summarize(loaded).failed).toBe(2);
    expect(() => parseAssessment("not json")).toThrow(/not JSON/);
    expect(() => parseAssessment(JSON.stringify({ hello: 1 }))).toThrow(/Quick Assess/);
  });
});

describe("Full Assessment catalogue", () => {
  it("has 23 tests with unique requirement ids and Quick Assess as a subset", () => {
    expect(FULL_TESTS).toHaveLength(23);
    expect(new Set(FULL_REQUIREMENTS.map((r) => r.id)).size).toBe(FULL_REQUIREMENTS.length);
    for (const q of QUICK_ASSESS) expect(FULL_REQUIREMENTS).toContain(q);
    for (const t of FULL_TESTS) expect(t.requirements.length).toBeGreaterThan(0);
  });
  it("covers every WCAG 2.2 A and AA success criterion except the obsolete 4.1.1", () => {
    const aaa = new Set(FULL_REQUIREMENTS.map((r) => r.wcag.criterion));
    const wcag22aa = [
      "1.1.1", "1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5",
      "1.4.1", "1.4.2", "1.4.3", "1.4.4", "1.4.5", "1.4.10", "1.4.11", "1.4.12", "1.4.13",
      "2.1.1", "2.1.2", "2.1.4", "2.2.1", "2.2.2", "2.3.1", "2.4.1", "2.4.2", "2.4.3", "2.4.4", "2.4.5", "2.4.6", "2.4.7", "2.4.11",
      "2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.7", "2.5.8", "3.1.1", "3.1.2", "3.2.1", "3.2.2", "3.2.3", "3.2.4", "3.2.6",
      "3.3.1", "3.3.2", "3.3.3", "3.3.4", "3.3.7", "3.3.8", "4.1.2", "4.1.3",
    ];
    expect(wcag22aa.filter((c) => !aaa.has(c))).toEqual([]);
  });
  it("numbers requirements by test", () => {
    expect(locate("no-keyboard-traps")?.number).toBe("1.2");
    expect(locate("focus-order")?.test.name).toBe("Focus");
  });
});

describe("Quick Assess to Full Assessment", () => {
  it("carries shared results over, keeping results the Full Assessment already has", () => {
    const quick: AssessmentState = {
      ...newAssessment("https://shop.example/", "Shop"),
      results: { reflow: { verdict: "pass", failures: [], marks: {} }, "keyboard-navigation": { verdict: "fail", failures: [], marks: {} } },
    };
    const full = { ...newAssessment("https://shop.example/", "Shop", undefined, "full"), results: { "keyboard-navigation": { verdict: "pass" as const, failures: [], marks: {} } } };
    const moved = moveToFull(quick, full);
    expect(moved.kind).toBe("full");
    expect(moved.results.reflow.verdict).toBe("pass");
    expect(moved.results["keyboard-navigation"].verdict).toBe("pass");
    expect(summarize(moved).total).toBe(FULL_REQUIREMENTS.length);
    expect(storageKey("https://shop.example/", "full")).toBe("assessment:full:https://shop.example/");
    expect(parseAssessment(JSON.stringify(moved)).kind).toBe("full");
    expect(buildAssessmentHtml(moved)).toContain("Full Assessment · 23 tests");
  });
});

describe("HTML report", () => {
  const state: AssessmentState = {
    ...newAssessment("https://shop.example/checkout", "Checkout", undefined, "full"),
    results: {
      "keyboard-navigation": { verdict: "fail", failures: [{ id: "f1", description: "Saved card link not reachable", selector: "#saved" }], marks: {} },
      "focus-indicator": { verdict: "fail", failures: [], marks: {} },
      "no-keyboard-traps": { verdict: "pass", failures: [], marks: {} },
      reflow: { verdict: "pass", failures: [], marks: {} },
    },
  };
  const html = buildAssessmentHtml(state, { preparedBy: "QA team" });
  it("puts the verdict, the top issues and an issue card per failure in the report", () => {
    expect(html).toContain("Does not conform · 2 failures");
    expect(html).toContain("Top issues to fix first");
    expect(html).toContain("A11Y-001");
    expect(html).toContain("A11Y-002");
    expect(html).toContain("Assessed by QA team");
    // Level A failure (2.1.1) is listed before the AA one (2.4.7).
    expect(html.indexOf("Saved card link not reachable")).toBeLessThan(html.indexOf("Visible focus: marked as failing"));
  });
  it("adds the success-criterion appendix unless switched off", () => {
    expect(html).toContain("Appendix: conformance by WCAG success criterion");
    expect(html).toMatch(/2\.1\.1<\/strong> Keyboard<\/td><td>A<\/td><td><span class="conf c-d">Does not support/);
    expect(buildAssessmentHtml(state, { criteriaTable: false })).not.toContain("Appendix:");
  });
  it("maps requirement results to conformance per criterion", () => {
    const rows = Object.fromEntries(criteriaConformance(state).map((c) => [c.criterion, c.conformance]));
    expect(rows["2.1.1"]).toBe("Does not support"); // keyboard-navigation failed, the other 2.1.1 requirements untested: a fail and no pass
    expect(rows["2.1.2"]).toBe("Supports");
    expect(rows["1.4.10"]).toBe("Supports");
    expect(rows["3.1.1"]).toBe("Not evaluated");
  });
});
