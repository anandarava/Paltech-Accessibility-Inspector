import { describe, expect, it } from "vitest";
import {
  blend,
  contrastRatio,
  isLargeText,
  luminance,
  parseColor,
  suggestPassingColor,
  toHex,
  type RGB,
  type RGBA,
} from "@shared/color";

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

describe("parseColor", () => {
  it("parses 6-digit and 3-digit hex", () => {
    expect(parseColor("#777777")).toEqual([119, 119, 119, 1]);
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#F00")).toEqual([255, 0, 0, 1]);
  });

  it("parses 8-digit and 4-digit hex with alpha", () => {
    const eight = parseColor("#00000080");
    expect(eight).not.toBeNull();
    expect(eight!.slice(0, 3)).toEqual([0, 0, 0]);
    expect(eight![3]).toBeCloseTo(0.5, 1);

    const four = parseColor("#f008");
    expect(four).not.toBeNull();
    expect(four!.slice(0, 3)).toEqual([255, 0, 0]);
    expect(four![3]).toBeCloseTo(0.53, 1);
  });

  it("parses rgb() and rgba() functional notation", () => {
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1]);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30, 0.5]);
    expect(parseColor("rgb(255,255,255)")).toEqual([255, 255, 255, 1]);
  });

  it("parses transparent as fully transparent", () => {
    const t = parseColor("transparent");
    expect(t).not.toBeNull();
    expect(t![3]).toBe(0);
  });

  it("parses basic named colours", () => {
    expect(parseColor("white")).toEqual([255, 255, 255, 1]);
    expect(parseColor("black")).toEqual([0, 0, 0, 1]);
    expect(parseColor("red")).toEqual([255, 0, 0, 1]);
  });

  it("returns null for unparseable input", () => {
    expect(parseColor("")).toBeNull();
    expect(parseColor("not-a-colour")).toBeNull();
    expect(parseColor("#12")).toBeNull();
  });
});

describe("luminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(luminance(BLACK)).toBeCloseTo(0, 6);
    expect(luminance(WHITE)).toBeCloseTo(1, 6);
  });

  it("uses the WCAG 2.2 sRGB linearisation (0.04045 threshold)", () => {
    // 119/255 = 0.4667 -> ((0.4667 + 0.055) / 1.055) ^ 2.4 = 0.1845
    expect(luminance([119, 119, 119])).toBeCloseTo(0.1845, 3);
    // Below the threshold: 10/255 / 12.92
    expect(luminance([10, 10, 10])).toBeCloseTo(10 / 255 / 12.92, 5);
    // Channel weights: pure green is the brightest primary
    expect(luminance([0, 255, 0])).toBeCloseTo(0.7152, 4);
    expect(luminance([255, 0, 0])).toBeCloseTo(0.2126, 4);
    expect(luminance([0, 0, 255])).toBeCloseTo(0.0722, 4);
  });
});

describe("contrastRatio", () => {
  it("returns 21 for black on white and 1 for identical colours", () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(21);
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
  });

  it("is symmetric", () => {
    expect(contrastRatio([119, 119, 119], WHITE)).toBe(contrastRatio(WHITE, [119, 119, 119]));
  });

  it("computes #777777 on #FFFFFF as 4.48 (fails AA) and #767676 as 4.54 (passes)", () => {
    expect(contrastRatio([0x77, 0x77, 0x77], WHITE)).toBe(4.48);
    expect(contrastRatio([0x76, 0x76, 0x76], WHITE)).toBe(4.54);
  });

  it("rounds to two decimals", () => {
    const ratio = contrastRatio([0x8a, 0x8a, 0x8a], WHITE);
    expect(ratio).toBeCloseTo(3.45, 2);
    expect(Number(ratio.toFixed(2))).toBe(ratio);
  });
});

describe("blend", () => {
  it("returns the bottom colour when the top is fully transparent", () => {
    expect(blend([255, 0, 0, 0], WHITE)).toEqual(WHITE);
  });

  it("returns the top colour when it is opaque", () => {
    expect(blend([12, 34, 56, 1], WHITE)).toEqual([12, 34, 56]);
  });

  it("alpha-composites 50% red over white", () => {
    const top: RGBA = [255, 0, 0, 0.5];
    const out = blend(top, WHITE);
    expect(out[0]).toBe(255);
    expect(out[1]).toBeGreaterThanOrEqual(127);
    expect(out[1]).toBeLessThanOrEqual(128);
    expect(out[2]).toBeGreaterThanOrEqual(127);
    expect(out[2]).toBeLessThanOrEqual(128);
  });

  it("produces integer channels within 0..255", () => {
    const out = blend([10, 200, 30, 0.33], [250, 5, 125]);
    for (const c of out) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
  });
});

describe("toHex", () => {
  it("formats as a 6-digit lowercase-insensitive hex string", () => {
    expect(toHex(WHITE).toLowerCase()).toBe("#ffffff");
    expect(toHex([0x76, 0x76, 0x76]).toLowerCase()).toBe("#767676");
    expect(toHex([0, 1, 2]).toLowerCase()).toBe("#000102");
  });

  it("round-trips through parseColor", () => {
    const rgb: RGB = [18, 52, 86];
    expect(parseColor(toHex(rgb))).toEqual([18, 52, 86, 1]);
  });
});

describe("suggestPassingColor", () => {
  it("reaches the 4.5:1 target for #777777 on white by darkening", () => {
    const fg: RGB = [0x77, 0x77, 0x77];
    const out = suggestPassingColor(fg, WHITE, 4.5);
    expect(contrastRatio(out, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(out)).toBeLessThan(luminance(fg));
  });

  it("reaches the target on a dark background by lightening", () => {
    const fg: RGB = [0x60, 0x60, 0x60];
    const out = suggestPassingColor(fg, BLACK, 4.5);
    expect(contrastRatio(out, BLACK)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(out)).toBeGreaterThan(luminance(fg));
  });

  it("reaches a 3:1 target for large text", () => {
    const out = suggestPassingColor([0xa0, 0xa0, 0xa0], WHITE, 3);
    expect(contrastRatio(out, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it("keeps the hue family of a coloured foreground", () => {
    const fg: RGB = [230, 90, 90]; // light red, ~3.1:1 on white
    const out = suggestPassingColor(fg, WHITE, 4.5);
    expect(contrastRatio(out, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[0]).toBeGreaterThan(out[2]);
  });

  it("leaves a colour that already passes (practically) unchanged", () => {
    const fg: RGB = [0x33, 0x33, 0x33];
    const out = suggestPassingColor(fg, WHITE, 4.5);
    out.forEach((c, i) => expect(Math.abs(c - fg[i])).toBeLessThanOrEqual(1));
  });

  it("returns valid channels for extreme inputs", () => {
    for (const fg of [WHITE, BLACK, [128, 128, 128] as RGB]) {
      const out = suggestPassingColor(fg, [128, 128, 128], 4.5);
      for (const c of out) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("isLargeText", () => {
  it("treats 24px regular text as large and anything smaller as normal", () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(23.9, 400)).toBe(false);
    expect(isLargeText(32, 100)).toBe(true);
  });

  it("treats 18.66px bold (weight >= 700) as large", () => {
    expect(isLargeText(18.66, 700)).toBe(true);
    expect(isLargeText(18.67, 700)).toBe(true);
    expect(isLargeText(18.66, 400)).toBe(false);
    expect(isLargeText(18.66, 600)).toBe(false);
    expect(isLargeText(18.5, 700)).toBe(false);
    expect(isLargeText(18.66, 900)).toBe(true);
  });
});
