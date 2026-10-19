import { describe, expect, it } from "vitest";
import { contrastRatioExact, type RGBA } from "@shared/color";
import { describeColor, evaluateContrast, parseColorInput, suggestFixes } from "@shared/contrast-check";

const pass = (fg: string, bg: string, id: string) =>
  evaluateContrast(parseColorInput(fg) as RGBA, parseColorInput(bg) as RGBA).criteria.find((c) => c.id === id)?.pass;

describe("parseColorInput", () => {
  it("accepts hex with or without #, in 3, 4, 6 and 8 digits", () => {
    expect(parseColorInput("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColorInput("fff")).toEqual([255, 255, 255, 1]);
    expect(parseColorInput("1A1A1A")).toEqual([26, 26, 26, 1]);
    expect(parseColorInput("  #0b4f9c  ")).toEqual([11, 79, 156, 1]);
    expect(parseColorInput("#00000080")?.[3]).toBeCloseTo(128 / 255, 5);
  });

  it("accepts CSS colours and rejects anything else", () => {
    expect(parseColorInput("rgb(26, 26, 26)")).toEqual([26, 26, 26, 1]);
    expect(parseColorInput("hsl(0 0% 100%)")).toEqual([255, 255, 255, 1]);
    expect(parseColorInput("rebeccapurple")).toEqual([102, 51, 153, 1]);
    expect(parseColorInput("")).toBeNull();
    expect(parseColorInput("#12")).toBeNull();
    expect(parseColorInput("12345")).toBeNull();
    expect(parseColorInput("not a colour")).toBeNull();
    expect(parseColorInput("transparent")).toBeNull();
  });
});

describe("evaluateContrast", () => {
  it("gives the WCAG ratio: black on white is 21:1, same colours 1:1", () => {
    expect(evaluateContrast([0, 0, 0, 1], [255, 255, 255, 1]).ratio).toBe(21);
    expect(evaluateContrast([119, 119, 119, 1], [119, 119, 119, 1]).ratio).toBe(1);
  });

  it("decides at the exact thresholds, never rounding up", () => {
    // #767676 on white is 4.54:1 (the classic lightest passing grey); #777777 is 4.47:1.
    expect(pass("#767676", "#ffffff", "aa-normal")).toBe(true);
    expect(pass("#777777", "#ffffff", "aa-normal")).toBe(false);
    // #949494 on white is 3.03:1: passes large text and non-text, fails normal text; #959595 is 2.995:1.
    expect(pass("#949494", "#ffffff", "aa-large")).toBe(true);
    expect(pass("#959595", "#ffffff", "aa-large")).toBe(false);
    expect(pass("#949494", "#ffffff", "non-text")).toBe(true);
    expect(pass("#949494", "#ffffff", "aa-normal")).toBe(false);
    // #595959 on white is 7.0:1 for AAA.
    expect(pass("#595959", "#ffffff", "aaa-normal")).toBe(true);
    expect(pass("#5a5a5a", "#ffffff", "aaa-normal")).toBe(false);
  });

  it("shows a ratio truncated, not rounded, so a shown pass is a real pass", () => {
    const ev = evaluateContrast([119, 119, 119, 1], [255, 255, 255, 1]);
    expect(ev.exact).toBeLessThan(4.5);
    expect(ev.ratio).toBe(Math.floor(ev.exact * 100) / 100);
    expect(ev.ratio).toBeLessThan(4.5);
  });

  it("blends a translucent text colour over the background, and a translucent background over white", () => {
    const ev = evaluateContrast([0, 0, 0, 0.5], [255, 255, 255, 1]);
    expect(ev.foreground).toEqual([128, 128, 128]);
    expect(ev.notes.length).toBe(1);
    const bg = evaluateContrast([0, 0, 0, 1], [0, 0, 0, 0.5]);
    expect(bg.background).toEqual([128, 128, 128]);
    expect(bg.notes[0]).toMatch(/blended over white/);
  });
});

describe("suggestFixes", () => {
  it("suggests a text colour and a background that each reach the requirement", () => {
    const ev = evaluateContrast([153, 153, 153, 1], [255, 255, 255, 1]);
    const fixes = suggestFixes(ev, 4.5);
    expect(fixes).not.toBeNull();
    expect(contrastRatioExact(fixes!.text, ev.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatioExact(ev.foreground, fixes!.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("suggests nothing when the pair already passes", () => {
    expect(suggestFixes(evaluateContrast([0, 0, 0, 1], [255, 255, 255, 1]), 4.5)).toBeNull();
  });
});

describe("describeColor", () => {
  it("names opaque colours by hex and says how opaque a translucent one is", () => {
    expect(describeColor([255, 0, 0, 1])).toBe("#ff0000");
    expect(describeColor([255, 0, 0, 0.5])).toBe("#ff0000 (50% opaque)");
  });
});
