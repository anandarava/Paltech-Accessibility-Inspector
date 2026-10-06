/**
 * Regression tests for a batch of content-script fixes: opacity compositing,
 * focus-ring shadow selection, shadow-aware element resolution, SVG xpaths,
 * hidden headings in the level-skip check, SPA body replacement and
 * fingerprints across shadow roots.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contrastRatioExact } from "@shared/color";
import rulesFile from "@shared/a11y-rules.json";
import type { RulesFile } from "@shared/types";
import { paintOver, resolveBackground } from "@src/content/rules/contrast";
import { shadowColor } from "@src/content/rules/focus-visible";
import { resolveElement } from "@src/content/overlay/highlighter";
import { HeadingLayer } from "@src/content/overlay/heading-map";
import { startSpaObserver } from "@src/content/observers/spa-observer";
import { fingerprint, textSnippet } from "@src/content/fingerprint";
import { dedupeIssues, normalizeCustomFindings } from "@src/content/normalizer";
import { fingerprintSelector, uniqueSelector, xpath } from "@src/content/dom-utils";
import type { CustomRule } from "@src/content/rules/types";
import { setBody } from "./support/factories";

const RULES = rulesFile as unknown as RulesFile;

describe("contrast opacity compositing", () => {
  it("applies a group's opacity exactly once", () => {
    setBody('<div style="background:#fff"><div style="opacity:.5;background:#000"><p id="t" style="color:#fff">x</p></div></div>');
    const bg = resolveBackground(document.getElementById("t"));
    const text = paintOver(bg, [255, 255, 255, 1]);
    // White text on a black card faded 50% over white: text stays white, card becomes mid grey (~3.9:1).
    expect(text).toEqual([255, 255, 255]);
    const ratio = contrastRatioExact(text, bg.color);
    expect(ratio).toBeGreaterThan(3.8);
    expect(ratio).toBeLessThan(4.1);
  });

  it("is plain source-over blending without an opacity group", () => {
    setBody('<div style="background:#fff"><p id="t">x</p></div>');
    const bg = resolveBackground(document.getElementById("t"));
    expect(paintOver(bg, [0, 0, 0, 0.5])).toEqual([128, 128, 128]);
  });

  it("fades text on a transparent faded group against the backdrop", () => {
    setBody('<div style="background:#fff"><div style="opacity:.5"><p id="t">x</p></div></div>');
    const bg = resolveBackground(document.getElementById("t"));
    expect(paintOver(bg, [0, 0, 0, 1])).toEqual([128, 128, 128]);
  });
});

describe("focus-visible shadowColor", () => {
  it("prefers the shadow added on focus over a decorative pre-existing one", () => {
    const before = "rgba(0, 0, 0, 0.075) 0px 1px 1px 0px inset";
    const after = "rgba(0, 0, 0, 0.075) 0px 1px 1px 0px inset, rgba(13, 110, 253, 0.25) 0px 0px 0px 4px";
    expect(shadowColor(after, before)).toEqual([13, 110, 253, 0.25]);
  });

  it("falls back to the non-inset ring with spread when nothing is new", () => {
    const list = "rgba(0, 0, 0, 0.075) 0px 1px 1px 0px inset, rgb(13, 110, 253) 0px 0px 0px 3px";
    expect(shadowColor(list, list)).toEqual([13, 110, 253, 1]);
  });

  it("returns null for none", () => {
    expect(shadowColor("none")).toBeNull();
  });
});

describe("resolveElement", () => {
  it("resolves selectors that only exist inside an open shadow root", () => {
    setBody('<div id="host"></div><button id="light">a</button>');
    const root = document.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = '<button id="inner">b</button>';
    expect(resolveElement("#inner")).toBe(root.getElementById("inner"));
    expect(resolveElement("#light")).toBe(document.getElementById("light"));
    expect(resolveElement("#missing")).toBeNull();
  });
});

describe("xpath for foreign-namespace elements", () => {
  it("uses local-name(.) steps for SVG and resolves back to the element", () => {
    setBody('<main><svg><path id="p1" d="M0 0"/><path id="p2" d="M1 1"/></svg><svg><path id="p3" d="M2 2"/></svg></main>');
    for (const id of ["p1", "p2", "p3"]) {
      const el = document.getElementById(id)!;
      const path = xpath(el);
      expect(path).toContain("*[local-name(.)='path']");
      expect(document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue).toBe(el);
    }
  });
});

describe("heading map", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      const hidden = this.closest("[hidden]") !== null;
      return (hidden ? [] : [{}]) as unknown as DOMRectList;
    });
  });

  it("ignores hidden headings when checking for skipped levels", () => {
    setBody("<h1>Title</h1><h3 hidden>Hidden</h3><h2>Section</h2>");
    const layer = document.createElement("div");
    new HeadingLayer(layer, { colors: { Critical: "#f00" }, showBadges: true } as never).draw({ x: 0, y: 0 });
    expect(layer.querySelectorAll(".pill")).toHaveLength(2);
    expect(layer.querySelectorAll(".pill.skipped")).toHaveLength(0);
  });

  it("still flags a genuine skip between rendered headings", () => {
    setBody("<h1>Title</h1><h3>Jump</h3>");
    const layer = document.createElement("div");
    new HeadingLayer(layer, { colors: { Critical: "#f00" }, showBadges: true } as never).draw({ x: 0, y: 0 });
    expect(layer.querySelectorAll(".pill.skipped")).toHaveLength(1);
  });
});

describe("spa observer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-attaches and reports when document.body is replaced", async () => {
    setBody("<p>old</p>");
    const onChange = vi.fn();
    const stop = startSpaObserver(onChange);
    const next = document.createElement("body");
    next.innerHTML = "<p>new</p>";
    document.body.replaceWith(next);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onChange).toHaveBeenCalledWith("dom");
    stop();
  });
});

describe("fingerprints across shadow roots", () => {
  const rule: CustomRule = {
    id: "CLR-01",
    title: "Contrast",
    category: "Visual",
    wcag: { criterion: "1.4.3", name: "Contrast (Minimum)", level: "AA" },
    type: "Auto",
    severity: "Serious",
    defaultFix: { summary: "Fix it" },
    async run() {
      return [];
    },
  } as unknown as CustomRule;

  it("keeps light-DOM fingerprints unchanged", () => {
    setBody('<p id="a">Hello</p>');
    const el = document.getElementById("a")!;
    const [issue] = normalizeCustomFindings(rule, [{ element: el, description: "x" }], RULES);
    expect(issue.fingerprint).toBe(fingerprint("CLR-01", uniqueSelector(el), textSnippet(el)));
    expect(fingerprintSelector(el, issue.element.selector)).toBe(issue.element.selector);
  });

  it("distinguishes identical elements in different shadow roots", () => {
    setBody('<x-card id="one"></x-card><x-card id="two"></x-card>');
    const inner: Element[] = [];
    for (const id of ["one", "two"]) {
      const root = document.getElementById(id)!.attachShadow({ mode: "open" });
      root.innerHTML = "<p>Same text</p>";
      inner.push(root.querySelector("p")!);
    }
    const issues = normalizeCustomFindings(
      rule,
      inner.map((element) => ({ element, description: "x" })),
      RULES,
    );
    expect(issues[0].element.selector).toBe(issues[1].element.selector);
    expect(issues[0].fingerprint).not.toBe(issues[1].fingerprint);
    expect(dedupeIssues(issues)).toHaveLength(2);
  });
});
