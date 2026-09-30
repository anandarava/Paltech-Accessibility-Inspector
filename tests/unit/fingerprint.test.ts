import { describe, expect, it } from "vitest";
import { fingerprint, textSnippet } from "@src/content/fingerprint";
import { setBody } from "./support/factories";

const HEX8 = /^[0-9a-f]{8}$/;

describe("fingerprint", () => {
  it("returns exactly 8 lowercase hex characters", () => {
    expect(fingerprint("CLR-01", "#pricing > p.note", "Billed annually")).toMatch(HEX8);
    expect(fingerprint("", "", "")).toMatch(HEX8);
  });

  it("is deterministic for the same inputs", () => {
    const a = fingerprint("IMG-01", "main > img:nth-of-type(2)", "");
    const b = fingerprint("IMG-01", "main > img:nth-of-type(2)", "");
    expect(a).toBe(b);
  });

  it("differs when the selector differs", () => {
    const a = fingerprint("IMG-01", "main > img:nth-of-type(1)", "");
    const b = fingerprint("IMG-01", "main > img:nth-of-type(2)", "");
    expect(a).not.toBe(b);
  });

  it("differs when the rule id differs", () => {
    const a = fingerprint("IMG-02", "#hero", "IMG_2031.jpg");
    const b = fingerprint("IMG-03", "#hero", "IMG_2031.jpg");
    expect(a).not.toBe(b);
  });

  it("differs when the text snippet differs", () => {
    const a = fingerprint("LNK-03", "a.more", "click here");
    const b = fingerprint("LNK-03", "a.more", "read more");
    expect(a).not.toBe(b);
  });

  it("does not collide across a set of similar inputs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(fingerprint("KBD-05", `button:nth-of-type(${i})`, `Button ${i}`));
    }
    expect(seen.size).toBe(200);
  });
});

describe("textSnippet", () => {
  it("returns trimmed text content", () => {
    setBody('<p id="p">   Billed   annually  </p>');
    const snippet = textSnippet(document.getElementById("p")!);
    expect(snippet.startsWith("Billed")).toBe(true);
    expect(snippet.endsWith("annually")).toBe(true);
    expect(snippet).toBe(snippet.trim());
  });

  it("caps the snippet at 40 characters", () => {
    setBody(`<p id="p">${"x".repeat(200)}</p>`);
    expect(textSnippet(document.getElementById("p")!).length).toBeLessThanOrEqual(40);
  });

  it("uses the alt text of an image", () => {
    setBody('<img id="i" alt="Blue mountain bike" src="x.png">');
    expect(textSnippet(document.getElementById("i")!)).toBe("Blue mountain bike");
  });

  it("uses aria-label when there is no text content", () => {
    setBody('<button id="b" aria-label="Close dialog"></button>');
    expect(textSnippet(document.getElementById("b")!)).toBe("Close dialog");
  });

  it("returns an empty string for an element with nothing to describe", () => {
    setBody('<div id="d"></div>');
    expect(textSnippet(document.getElementById("d")!)).toBe("");
  });
});
