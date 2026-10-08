import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Base64 } from "@src/background/exporters/sha256";

const node = (text: string): string => createHash("sha256").update(text).digest("base64");

describe("sha256Base64", () => {
  it("matches the known digest of 'abc'", () => {
    expect(sha256Base64("abc")).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  });
  it("matches node's crypto for empty, short, block-boundary and non-ASCII text", () => {
    for (const text of ["", "a", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(1000), "naïve – café ✓ 日本語"]) {
      expect(sha256Base64(text)).toBe(node(text));
    }
  });
});
