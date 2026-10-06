import { describe, expect, it } from "vitest";
import { displayUrl, sameUrlIgnoringHash, scoreBand, splitScanName } from "@src/sidepanel/components/scanRowHelpers";

describe("saved scan row helpers", () => {
  it("bands scores", () => {
    expect([100, 90, 89, 50, 49, 0].map(scoreBand)).toEqual(["good", "good", "fair", "fair", "poor", "poor"]);
  });
  it("splits names on the last dash separator", () => {
    expect(splitScanName("test – 6 Oct 2026, 16:58")).toEqual({ title: "test", when: "6 Oct 2026, 16:58" });
    expect(splitScanName("a – b – 6 Oct")).toEqual({ title: "a – b", when: "6 Oct" });
    expect(splitScanName("plain")).toEqual({ title: "plain", when: null });
  });
  it("strips the scheme and compares ignoring hash", () => {
    expect(displayUrl("https://x.com/a")).toBe("x.com/a");
    expect(sameUrlIgnoringHash("https://x.com/a#b", "https://x.com/a")).toBe(true);
    expect(sameUrlIgnoringHash("https://x.com/a", "https://x.com/b")).toBe(false);
    expect(sameUrlIgnoringHash(undefined, "https://x.com/b")).toBe(false);
  });
});
