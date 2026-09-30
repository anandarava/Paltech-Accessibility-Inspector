import { beforeEach, describe, expect, it } from "vitest";
import { rule } from "@src/content/rules/alt-quality";
import type { RuleFinding } from "@src/content/rules/types";
import { findingRuleId, makeRuleContext, setBody } from "./support/factories";

const SRC = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

async function run(html: string): Promise<Array<RuleFinding & { ruleId: string }>> {
  setBody(html);
  const findings = await rule.run(makeRuleContext(document));
  return findings.map((f) => ({ ...f, ruleId: findingRuleId(f, rule.id) }));
}

function byRule<T extends { ruleId: string }>(findings: T[], id: string): T[] {
  return findings.filter((f) => f.ruleId === id);
}

describe("alt-quality rule", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("declares the ids it emits", () => {
    const ids = new Set([rule.id, ...(rule.emits ?? [])]);
    expect(ids.has("IMG-02")).toBe(true);
    expect(ids.has("IMG-03")).toBe(true);
    expect(ids.has("IMG-08")).toBe(true);
    expect(rule.category).toBe("Images and Media");
    expect(rule.wcag.criterion).toBe("1.1.1");
  });

  it("flags alt text that is a filename (IMG-02)", async () => {
    const findings = await run(`
      <img id="a" alt="IMG_2031.jpg" src="${SRC}">
      <img id="b" alt="hero-banner-final.png" src="${SRC}">
      <img id="c" alt="DSC_0042" src="${SRC}">
      <img id="d" alt="Blue mountain bike leaning against a fence" src="${SRC}">`);
    const ids = byRule(findings, "IMG-02").map((f) => f.element.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("flags generic alt text (IMG-03) and is case-insensitive", async () => {
    const findings = await run(`
      <img id="a" alt="image" src="${SRC}">
      <img id="b" alt="Photo" src="${SRC}">
      <img id="c" alt=" icon " src="${SRC}">
      <img id="d" alt="Chart of monthly revenue" src="${SRC}">`);
    const ids = byRule(findings, "IMG-03").map((f) => f.element.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
    expect(findings.some((f) => f.element.id === "d")).toBe(false);
  });

  it("does not flag decorative images or images without alt (those belong to IMG-01)", async () => {
    const findings = await run(`
      <img id="empty" alt="" src="${SRC}">
      <img id="missing" src="${SRC}">
      <img id="pres" role="presentation" alt="" src="${SRC}">`);
    expect(findings.filter((f) => ["IMG-02", "IMG-03"].includes(f.ruleId))).toHaveLength(0);
  });

  it("flags a bare inline svg as needs-review (IMG-08, Semi)", async () => {
    const findings = await run(`
      <svg id="bare" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>`);
    const bare = byRule(findings, "IMG-08");
    expect(bare).toHaveLength(1);
    expect(bare[0].element.id).toBe("bare");
    expect(bare[0].type ?? rule.type).toBe("Semi");
  });

  it("does not flag svgs that are hidden, named, or have a role", async () => {
    const findings = await run(`
      <svg id="hidden" aria-hidden="true" width="24" height="24"></svg>
      <svg id="labelled" aria-label="Sales trend" width="24" height="24"></svg>
      <svg id="titled" role="img" width="24" height="24"><title>Sales trend</title></svg>
      <svg id="pres" role="presentation" width="24" height="24"></svg>`);
    expect(byRule(findings, "IMG-08")).toHaveLength(0);
  });

  it("skips invisible images and extension nodes", async () => {
    setBody(`
      <img id="hidden" alt="IMG_0001.jpg" src="${SRC}" style="display:none">
      <img id="ext" alt="IMG_0002.jpg" src="${SRC}" data-a11y-checker="1">
      <img id="shown" alt="IMG_0003.jpg" src="${SRC}">`);
    const ctx = makeRuleContext(document);
    ctx.isExtensionNode = (el) => el.hasAttribute("data-a11y-checker");
    const findings = await rule.run(ctx);
    const ids = findings.map((f) => f.element.id);
    expect(ids).toContain("shown");
    expect(ids).not.toContain("hidden");
    expect(ids).not.toContain("ext");
  });

  it("returns findings with a description and structured data", async () => {
    const findings = await run(`<img id="a" alt="IMG_2031.jpg" src="${SRC}">`);
    expect(findings).toHaveLength(1);
    expect(findings[0].description.length).toBeGreaterThan(0);
    expect(findings[0].description).toContain("IMG_2031.jpg");
  });

  it("returns an empty list for a page without images", async () => {
    const findings = await run("<p>No images here.</p>");
    expect(findings).toEqual([]);
  });
});
