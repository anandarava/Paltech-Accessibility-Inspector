import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableFocusEmulation, enableFocusEmulation } from "@src/background/focus-emulation";
import { readableHighlight, rule as focusVisible } from "@src/content/rules/focus-visible";
import { contrastRatioExact } from "@shared/color";
import { findingRuleId, makeRuleContext, setBody } from "./support/factories";

type Debugger = {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
};

function installDebugger(overrides: Partial<Debugger> = {}): Debugger {
  const api: Debugger = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { debugger: api };
  return api;
}

describe("focus emulation", () => {
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("attaches to the tab and turns focus emulation on", async () => {
    const api = installDebugger();
    await expect(enableFocusEmulation(7)).resolves.toBe(true);
    expect(api.attach).toHaveBeenCalledWith({ tabId: 7 }, "1.3");
    expect(api.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, "Emulation.setFocusEmulationEnabled", { enabled: true });
  });

  it("turns emulation off and detaches afterwards", async () => {
    const api = installDebugger();
    await disableFocusEmulation(7);
    expect(api.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, "Emulation.setFocusEmulationEnabled", { enabled: false });
    expect(api.detach).toHaveBeenCalledWith({ tabId: 7 });
  });

  it("reports false when it cannot attach (no permission, or a page Chrome will not let extensions debug)", async () => {
    const api = installDebugger({ attach: vi.fn().mockRejectedValue(new Error("Cannot access a chrome:// URL")) });
    await expect(enableFocusEmulation(7)).resolves.toBe(false);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it("detaches again when the emulation command fails", async () => {
    const api = installDebugger({ sendCommand: vi.fn().mockRejectedValue(new Error("unsupported")) });
    await expect(enableFocusEmulation(7)).resolves.toBe(false);
    expect(api.detach).toHaveBeenCalledWith({ tabId: 7 });
  });

  it("does nothing without the debugger API", async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {};
    await expect(enableFocusEmulation(7)).resolves.toBe(false);
    await expect(disableFocusEmulation(7)).resolves.toBeUndefined();
  });

  it("never throws while turning emulation off", async () => {
    installDebugger({ sendCommand: vi.fn().mockRejectedValue(new Error("detached")), detach: vi.fn().mockRejectedValue(new Error("detached")) });
    await expect(disableFocusEmulation(7)).resolves.toBeUndefined();
  });
});

describe("focus-indicator rule on a page without focus", () => {
  let hasFocus: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  afterEach(() => {
    hasFocus.mockRestore();
  });

  it("reports one needs-review note instead of a finding per element", async () => {
    setBody(`<a href="#a">One</a><a href="#b">Two</a><button type="button">Three</button>`);
    const findings = await focusVisible.run(makeRuleContext(document));
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("Semi");
    expect(findingRuleId(findings[0], focusVisible.id)).toBe("KBD-05");
    expect(findings[0].data?.pageFocused).toBe(false);
  });

  it("reports nothing when there is nothing focusable", async () => {
    setBody(`<p>No controls here.</p>`);
    expect(await focusVisible.run(makeRuleContext(document))).toEqual([]);
  });
});

describe("suggested focus background", () => {
  const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

  it("finds no background for dark text on white, so an outline is suggested instead (Discourse sidebar)", () => {
    expect(readableHighlight(rgb("#f2f2f2"), rgb("#ffffff"), rgb("#434343"))).toBeNull();
  });

  it("finds a background that is visible against the unfocused state and keeps the text readable", () => {
    const unfocused = rgb("#4ab234");
    const text = rgb("#ffffff");
    const highlight = readableHighlight(rgb("#388627"), unfocused, text);
    expect(highlight).not.toBeNull();
    expect(contrastRatioExact(highlight!, unfocused)).toBeGreaterThanOrEqual(3);
    expect(contrastRatioExact(text, highlight!)).toBeGreaterThanOrEqual(4.5);
  });
});
