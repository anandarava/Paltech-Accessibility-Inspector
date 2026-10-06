import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, useStore } from "@src/sidepanel/store";
import { makeScanResult } from "./support/factories";

describe("panel state is kept separately for each tab", () => {
  beforeEach(() => {
    useStore.setState({ tabId: null, tabStates: {}, scanningTabs: [] });
    useStore.getState().resetForTab();
    useStore.getState().setFilters({ ...DEFAULT_FILTERS });
  });

  it("starts a tab it has not shown before on the landing state", () => {
    const s = useStore.getState();
    s.setTabId(1);
    s.setResult(makeScanResult());
    s.setTabId(2);
    const now = useStore.getState();
    expect(now.tabId).toBe(2);
    expect(now.result).toBeUndefined();
    expect(now.view).toBe("list");
    expect(now.filters.statuses).toEqual(["new"]);
  });

  it("restores a tab's result, filters, view and scope when the panel returns to it", () => {
    const s = useStore.getState();
    s.setTabId(1);
    const result = makeScanResult();
    s.setResult(result);
    s.setFilters({ severities: ["Critical"], search: "alt" });
    s.setResultTab("bp");
    s.setGroupBy("category");
    s.setScope({ kind: "selector", selector: "main" });
    s.setView("keyboard");

    s.setTabId(2);
    useStore.getState().setFilters({ search: "other" });
    useStore.getState().setScope({ kind: "page" });

    useStore.getState().setTabId(1);
    const back = useStore.getState();
    expect(back.result).toBe(result);
    expect(back.filters.severities).toEqual(["Critical"]);
    expect(back.filters.search).toBe("alt");
    expect(back.resultTab).toBe("bp");
    expect(back.groupBy).toBe("category");
    expect(back.scope).toEqual({ kind: "selector", selector: "main" });
    expect(back.view).toBe("keyboard");

    useStore.getState().setTabId(2);
    expect(useStore.getState().filters.search).toBe("other");
  });

  it("does not carry on-page state (overlay, running keyboard test, picker) over to another tab", () => {
    const s = useStore.getState();
    s.setTabId(1);
    s.setOverlayMode("issues");
    s.setColorBlindness("achromatopsia");
    s.setKeyboardRunning(true);
    s.setPicking(true);
    s.setTabId(2);
    const now = useStore.getState();
    expect(now.overlayMode).toBe("off");
    expect(now.colorBlindness).toBe("none");
    expect(now.keyboardRunning).toBe(false);
    expect(now.picking).toBe(false);
  });

  it("keeps showing a scan that is still running on the tab it returns to", () => {
    const s = useStore.getState();
    s.setTabId(1);
    s.markScanning(1, true);
    s.setScanning(true);
    s.setTabId(2);
    expect(useStore.getState().scanning).toBe(false);
    useStore.getState().setTabId(1);
    expect(useStore.getState().scanning).toBe(true);
  });
});
