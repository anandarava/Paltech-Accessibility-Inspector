import { beforeEach, describe, expect, it } from "vitest";

const local = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get(key: string | string[], cb: (items: Record<string, unknown>) => void) {
      const keys = Array.isArray(key) ? key : [key];
      // Resolve on a later tick so overlapping read-modify-write cycles interleave.
      setTimeout(() => cb(Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))]))), 5);
    },
    set(items: Record<string, unknown>, cb: () => void) {
      setTimeout(() => {
        for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
        cb();
      }, 1);
    },
    remove(key: string | string[], cb: () => void) {
      for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
      setTimeout(cb, 1);
    },
  };
}

describe("storage read-modify-write locking", () => {
  beforeEach(() => {
    local.clear();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { lastError: undefined },
      storage: { local: area(local), session: area(new Map()) },
    };
  });

  const entry = (fp: string) => ({ fingerprint: fp, ruleId: "r", selector: "s", reason: "", author: "a", createdAt: "2020-01-01T00:00:00Z" });

  it("does not lose concurrent baseline additions", async () => {
    const { addBaseline, getBaseline } = await import("@src/background/storage");
    await Promise.all([addBaseline("https://a.test", [entry("1")]), addBaseline("https://a.test", [entry("2")]), addBaseline("https://a.test", [entry("3")])]);
    expect((await getBaseline("https://a.test")).map((e) => e.fingerprint).sort()).toEqual(["1", "2", "3"]);
  });

  it("does not lose concurrent saved-scan index writes and rename keeps blobs", async () => {
    const { saveScan, listSavedScans } = await import("@src/background/storage");
    const mk = (u: string) => ({ url: u, title: u, timestamp: "t", score: 1, summary: {}, wcagLevel: "AA", scope: { kind: "page" }, issues: [] }) as never;
    await Promise.all([saveScan("a", mk("a")), saveScan("b", mk("b")), saveScan("c", mk("c"))]);
    expect((await listSavedScans()).length).toBe(3);
  });
});
