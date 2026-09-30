import { describe, expect, it } from "vitest";
import {
  accessibleName,
  getFocusableElements,
  isVisible,
  outerHtmlSnippet,
  uniqueSelector,
  xpath,
  yieldToMain,
} from "@src/content/dom-utils";
import { setBody } from "./support/factories";

function resolveXPath(path: string): Node | null {
  return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

describe("uniqueSelector", () => {
  it("prefers the element id", () => {
    setBody('<main><p id="intro">Hello</p><p>Other</p></main>');
    const el = document.getElementById("intro")!;
    const sel = uniqueSelector(el);
    expect(sel).toContain("#intro");
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
  });

  it("is unique for every sibling of the same type", () => {
    setBody(`
      <main>
        <section class="cards">
          <div class="card"><p class="note">one</p></div>
          <div class="card"><p class="note">two</p></div>
          <div class="card"><p class="note">three</p><p class="note">four</p></div>
        </section>
      </main>`);
    const notes = Array.from(document.querySelectorAll("p.note"));
    const selectors = notes.map((el) => uniqueSelector(el));
    notes.forEach((el, i) => {
      expect(document.querySelectorAll(selectors[i])).toHaveLength(1);
      expect(document.querySelector(selectors[i])).toBe(el);
    });
    expect(new Set(selectors).size).toBe(notes.length);
  });

  it("is unique for deeply nested elements without ids or classes", () => {
    setBody("<div><div><span>a</span><span>b</span></div><div><span>c</span></div></div>");
    const spans = Array.from(document.querySelectorAll("span"));
    for (const span of spans) {
      const sel = uniqueSelector(span);
      expect(document.querySelectorAll(sel)).toHaveLength(1);
      expect(document.querySelector(sel)).toBe(span);
    }
  });

  it("handles ids that need escaping", () => {
    setBody('<div id="a:b.c">x</div>');
    const el = document.getElementById("a:b.c")!;
    const sel = uniqueSelector(el);
    expect(document.querySelector(sel)).toBe(el);
  });

  it("is stable across calls", () => {
    setBody("<ul><li>1</li><li>2</li></ul>");
    const li = document.querySelectorAll("li")[1];
    expect(uniqueSelector(li)).toBe(uniqueSelector(li));
  });
});

describe("xpath", () => {
  it("returns an absolute path starting at /html", () => {
    setBody("<main><section><p>a</p><p>b</p></section></main>");
    const p = document.querySelectorAll("p")[1];
    const path = xpath(p);
    expect(path.startsWith("/html")).toBe(true);
    expect(path.toLowerCase()).toContain("/body");
    expect(path.toLowerCase()).toContain("p[2]");
  });

  it("resolves back to the same element via document.evaluate", () => {
    setBody("<main><div><span>x</span><span>y</span></div><div><span>z</span></div></main>");
    for (const el of Array.from(document.querySelectorAll("span, div"))) {
      expect(resolveXPath(xpath(el))).toBe(el);
    }
  });
});

describe("outerHtmlSnippet", () => {
  it("returns the outer HTML for short elements", () => {
    setBody('<p class="note">Billed annually</p>');
    expect(outerHtmlSnippet(document.querySelector("p")!)).toBe('<p class="note">Billed annually</p>');
  });

  it("truncates to the requested maximum", () => {
    setBody(`<p>${"word ".repeat(200)}</p>`);
    const snippet = outerHtmlSnippet(document.querySelector("p")!, 100);
    expect(snippet.length).toBeLessThanOrEqual(104);
    expect(snippet.startsWith("<p>")).toBe(true);
  });

  it("uses a sensible default maximum around 300 characters", () => {
    setBody(`<p>${"a".repeat(2000)}</p>`);
    expect(outerHtmlSnippet(document.querySelector("p")!).length).toBeLessThanOrEqual(320);
  });
});

describe("isVisible", () => {
  it("is false for display:none, visibility:hidden and hidden elements", () => {
    setBody(`
      <div id="none" style="display:none">a</div>
      <div id="vis" style="visibility:hidden">b</div>
      <div id="hid" hidden>c</div>
      <div style="display:none"><span id="child">d</span></div>`);
    expect(isVisible(document.getElementById("none")!)).toBe(false);
    expect(isVisible(document.getElementById("vis")!)).toBe(false);
    expect(isVisible(document.getElementById("hid")!)).toBe(false);
    expect(isVisible(document.getElementById("child")!)).toBe(false);
  });
});

describe("accessibleName", () => {
  it("prefers aria-labelledby over everything else", () => {
    setBody(`
      <span id="lbl">From labelledby</span>
      <label for="i">From label</label>
      <input id="i" aria-labelledby="lbl" aria-label="From aria-label" title="From title">`);
    expect(accessibleName(document.getElementById("i")!)).toBe("From labelledby");
  });

  it("concatenates multiple aria-labelledby references in order", () => {
    setBody('<span id="a">Billing</span><span id="b">address</span><input id="i" aria-labelledby="a b">');
    expect(accessibleName(document.getElementById("i")!).replace(/\s+/g, " ")).toBe("Billing address");
  });

  it("uses aria-label before label[for]", () => {
    setBody('<label for="i">From label</label><input id="i" aria-label="From aria-label">');
    expect(accessibleName(document.getElementById("i")!)).toBe("From aria-label");
  });

  it("uses label[for] and wrapping labels", () => {
    setBody(`
      <label for="i">Explicit label</label><input id="i">
      <label>Wrapping label <input id="j"></label>`);
    expect(accessibleName(document.getElementById("i")!)).toBe("Explicit label");
    expect(accessibleName(document.getElementById("j")!).trim()).toBe("Wrapping label");
  });

  it("uses alt for images and title as a last resort", () => {
    setBody('<img id="img" alt="A bicycle" title="Ignored"><button id="b" title="From title"></button>');
    expect(accessibleName(document.getElementById("img")!)).toBe("A bicycle");
    expect(accessibleName(document.getElementById("b")!)).toBe("From title");
  });

  it("falls back to text content", () => {
    setBody('<button id="b">  Save   changes </button>');
    expect(accessibleName(document.getElementById("b")!).replace(/\s+/g, " ").trim()).toBe("Save changes");
  });

  it("returns an empty string when nothing names the element", () => {
    setBody('<a id="a" href="#"></a>');
    expect(accessibleName(document.getElementById("a")!)).toBe("");
  });
});

describe("getFocusableElements", () => {
  it("returns natively focusable elements in DOM order", () => {
    setBody(`
      <a id="f1" href="#a">link</a>
      <button id="f2">button</button>
      <input id="f3" type="text">
      <select id="f4"><option>x</option></select>
      <textarea id="f5"></textarea>
      <div id="f6" tabindex="0">custom</div>`);
    const ids = getFocusableElements(document).map((el) => el.id);
    const expected = ["f1", "f2", "f3", "f4", "f5", "f6"];
    expect(ids.filter((id) => expected.includes(id))).toEqual(expected);
  });

  it("excludes disabled controls, tabindex=-1 and links without href", () => {
    setBody(`
      <button id="ok">ok</button>
      <button id="dis" disabled>disabled</button>
      <div id="neg" tabindex="-1">neg</div>
      <a id="nohref">no href</a>
      <input id="hid" type="hidden">`);
    const ids = getFocusableElements(document).map((el) => el.id);
    expect(ids).toContain("ok");
    expect(ids).not.toContain("dis");
    expect(ids).not.toContain("neg");
    expect(ids).not.toContain("nohref");
    expect(ids).not.toContain("hid");
  });

  it("orders positive tabindex values before the natural order", () => {
    setBody(`
      <button id="natural">natural</button>
      <button id="second" tabindex="2">second</button>
      <button id="first" tabindex="1">first</button>`);
    const ids = getFocusableElements(document).map((el) => el.id);
    expect(ids.indexOf("first")).toBeLessThan(ids.indexOf("second"));
    expect(ids.indexOf("second")).toBeLessThan(ids.indexOf("natural"));
  });

  it("only returns elements under the given root", () => {
    setBody('<div id="root"><button id="in">in</button></div><button id="out">out</button>');
    const ids = getFocusableElements(document.getElementById("root")!).map((el) => el.id);
    expect(ids).toContain("in");
    expect(ids).not.toContain("out");
  });
});

describe("yieldToMain", () => {
  it("resolves asynchronously", async () => {
    let flag = false;
    const p = yieldToMain().then(() => {
      flag = true;
    });
    expect(flag).toBe(false);
    await p;
    expect(flag).toBe(true);
  });
});
