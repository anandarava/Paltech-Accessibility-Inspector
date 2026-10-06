import { beforeEach, describe, expect, it } from "vitest";

const session = new Map<string, unknown>();
const local = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get(key: string | string[] | null, cb: (items: Record<string, unknown>) => void) {
      const keys = key === null ? [...store.keys()] : Array.isArray(key) ? key : [key];
      cb(Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))])));
    },
    set(items: Record<string, unknown>, cb: () => void) {
      for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
      cb();
    },
    remove(key: string | string[], cb: () => void) {
      for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
      cb();
    },
  };
}

describe("clearAllTabData", () => {
  beforeEach(() => {
    session.clear();
    local.clear();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { lastError: undefined },
      storage: { local: area(local), session: area(session) },
    };
  });

  it("drops every tab's result and scan options but keeps saved data", async () => {
    session.set("lastResult:11", { scanId: "a" });
    session.set("lastResult:12", { scanId: "b" });
    session.set("scanOptions:12", { scope: "page" });
    session.set("somethingElse", 1);
    local.set("savedScanIndex", [{ id: "x" }]);
    local.set("settings", { wcagLevel: "AA" });

    const { clearAllTabData } = await import("@src/background/storage");
    const ids = await clearAllTabData();

    expect(ids.sort()).toEqual([11, 12]);
    expect([...session.keys()]).toEqual(["somethingElse"]);
    expect([...local.keys()].sort()).toEqual(["savedScanIndex", "settings"]);
  });

  it("returns an empty list when nothing is stored", async () => {
    const { clearAllTabData } = await import("@src/background/storage");
    expect(await clearAllTabData()).toEqual([]);
  });
});
