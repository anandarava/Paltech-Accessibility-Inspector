import { beforeEach, describe, expect, it } from "vitest";
import { rule } from "@src/content/rules/link-text";
import type { RuleFinding } from "@src/content/rules/types";
import { findingRuleId, makeRuleContext, setBody } from "./support/factories";

async function run(html: string): Promise<Array<RuleFinding & { ruleId: string }>> {
  setBody(html);
  const findings = await rule.run(makeRuleContext(document));
  return findings.map((f) => ({ ...f, ruleId: findingRuleId(f, rule.id) }));
}

function idsFor(findings: Array<{ ruleId: string; element: Element }>, id: string): string[] {
  return findings
    .filter((f) => f.ruleId === id)
    .map((f) => f.element.id)
    .sort();
}

describe("link-text rule", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("declares LNK-03 and LNK-05", () => {
    const ids = new Set([rule.id, ...(rule.emits ?? [])]);
    expect(ids.has("LNK-03")).toBe(true);
    expect(ids.has("LNK-05")).toBe(true);
  });

  it("flags vague link text (LNK-03)", async () => {
    const findings = await run(`
      <a id="a" href="/pricing">Click here</a>
      <a id="b" href="/blog/1">Read more</a>
      <a id="c" href="/notes">here</a>
      <a id="d" href="/docs">Learn more</a>
      <a id="e" href="/x">more</a>
      <a id="f" href="/y">link</a>
      <a id="g" href="/z">Details</a>`);
    expect(idsFor(findings, "LNK-03")).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("ignores punctuation, case and surrounding whitespace in vague text", async () => {
    const findings = await run(`
      <a id="a" href="/1">  CLICK HERE!  </a>
      <a id="b" href="/2">Read more...</a>`);
    expect(idsFor(findings, "LNK-03")).toEqual(["a", "b"]);
  });

  it("does not flag descriptive link text", async () => {
    const findings = await run(`
      <a id="a" href="/pricing">Compare pricing plans</a>
      <a id="b" href="/blog/1">Read more about the contrast engine</a>
      <a id="c" href="/notes">Release notes for version 1.0</a>`);
    expect(idsFor(findings, "LNK-03")).toEqual([]);
  });

  it("flags target=_blank links that do not warn about the new window (LNK-05)", async () => {
    const findings = await run(`
      <a id="a" href="https://example.com/status" target="_blank" rel="noopener">Status page</a>
      <a id="b" href="https://example.com/roadmap" target="_blank">Roadmap</a>`);
    expect(idsFor(findings, "LNK-05")).toEqual(["a", "b"]);
  });

  it("accepts visible text, screen-reader text, or aria-label warnings for new windows", async () => {
    const findings = await run(`
      <a id="a" href="https://example.com/1" target="_blank">Repository (opens in a new tab)</a>
      <a id="b" href="https://example.com/2" target="_blank">Docs <span class="sr-only">opens in new window</span></a>
      <a id="c" href="https://example.com/3" target="_blank" aria-label="Figma, opens in new window">Figma</a>
      <a id="d" href="https://example.com/4" target="_blank">Roadmap (new tab)</a>`);
    expect(idsFor(findings, "LNK-05")).toEqual([]);
  });

  it("does not flag links without target=_blank for LNK-05", async () => {
    const findings = await run('<a id="a" href="/same-window">Same window</a><a id="b" href="/x" target="_self">Self</a>');
    expect(idsFor(findings, "LNK-05")).toEqual([]);
  });

  it("skips invisible links and extension nodes", async () => {
    setBody(`
      <a id="hidden" href="/1" style="display:none">click here</a>
      <a id="ext" href="/2" data-a11y-checker="1">click here</a>
      <a id="shown" href="/3">click here</a>`);
    const ctx = makeRuleContext(document);
    ctx.isExtensionNode = (el) => el.hasAttribute("data-a11y-checker");
    const findings = await rule.run(ctx);
    const ids = findings.map((f) => f.element.id);
    expect(ids).toContain("shown");
    expect(ids).not.toContain("hidden");
    expect(ids).not.toContain("ext");
  });

  it("returns an empty list for a page without links", async () => {
    expect(await run("<p>No links.</p>")).toEqual([]);
  });
});
