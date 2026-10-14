/**
 * Focus emulation for the duration of a scan.
 *
 * Chrome draws no focus styles (`:focus`, `:focus-visible`, `:focus-within`)
 * on a page whose window does not have focus, and while the tester works in
 * the side panel the page never does. The focus-indicator rules (KBD-05,
 * CLR-05) would then see no change on any element and report every one of
 * them. `Emulation.setFocusEmulationEnabled` (the DevTools "Emulate a focused
 * page" switch) makes the page behave as focused, so the rules see what a
 * keyboard user sees.
 *
 * It needs the `debugger` permission; while attached Chrome shows its
 * "started debugging this browser" bar. Every failure (no permission, a page
 * Chrome will not let extensions debug, the user cancelling the bar) leaves
 * the scan running without emulation, and the focus rule then reports one
 * needs-review note instead of a finding per element.
 */

const PROTOCOL_VERSION = "1.3";

function debuggerApi(): typeof chrome.debugger | undefined {
  return typeof chrome !== "undefined" ? chrome.debugger : undefined;
}

/** Attach to the tab and turn focus emulation on. Resolves false when that is not possible. */
export async function enableFocusEmulation(tabId: number): Promise<boolean> {
  const api = debuggerApi();
  if (!api) return false;
  const target = { tabId };
  try {
    await api.attach(target, PROTOCOL_VERSION);
  } catch {
    return false;
  }
  try {
    await api.sendCommand(target, "Emulation.setFocusEmulationEnabled", { enabled: true });
    return true;
  } catch {
    await api.detach(target).catch(() => undefined);
    return false;
  }
}

/** Turn focus emulation off and detach. Never throws. */
export async function disableFocusEmulation(tabId: number): Promise<void> {
  const api = debuggerApi();
  if (!api) return;
  const target = { tabId };
  await api.sendCommand(target, "Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => undefined);
  await api.detach(target).catch(() => undefined);
}
