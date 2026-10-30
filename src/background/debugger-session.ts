/**
 * One shared chrome.debugger connection per tab.
 *
 * Chrome allows a single debugger connection per tab and extension, and
 * several features need it at once (focus emulation during a scan, the screen
 * reader view). Each user acquires the connection and releases it when done;
 * it is attached on the first acquire and detached on the last release.
 *
 * While attached Chrome shows its "started debugging this browser" bar. The
 * tester can close that bar at any time, which detaches every user.
 */

const PROTOCOL_VERSION = "1.3";

const holders = new Map<number, number>();
const attaching = new Map<number, Promise<boolean>>();
const detachListeners = new Set<(tabId: number) => void>();

function debuggerApi(): typeof chrome.debugger | undefined {
  return typeof chrome !== "undefined" ? chrome.debugger : undefined;
}

async function attach(tabId: number): Promise<boolean> {
  const api = debuggerApi();
  if (!api) return false;
  try {
    await api.attach({ tabId }, PROTOCOL_VERSION);
    return true;
  } catch (e) {
    // Still attached from before the service worker restarted? Then a command goes through;
    // when another extension holds the tab it does not.
    if (!/already attached/i.test(e instanceof Error ? e.message : String(e))) return false;
    try {
      await api.sendCommand({ tabId }, "Runtime.evaluate", { expression: "1" });
      return true;
    } catch {
      return false;
    }
  }
}

/** Attach (or share the existing connection). Resolves false when the tab cannot be debugged. */
export async function acquireDebugger(tabId: number): Promise<boolean> {
  const held = holders.get(tabId) ?? 0;
  if (held > 0) {
    holders.set(tabId, held + 1);
    return true;
  }
  let pending = attaching.get(tabId);
  if (!pending) {
    pending = attach(tabId).finally(() => attaching.delete(tabId));
    attaching.set(tabId, pending);
  }
  const ok = await pending;
  if (ok) holders.set(tabId, (holders.get(tabId) ?? 0) + 1);
  return ok;
}

/** Give up one use; the last one detaches. Never throws. */
export async function releaseDebugger(tabId: number): Promise<void> {
  const held = holders.get(tabId) ?? 0;
  if (held > 1) {
    holders.set(tabId, held - 1);
    return;
  }
  holders.delete(tabId);
  await debuggerApi()?.detach({ tabId }).catch(() => undefined);
}

export function sendDebuggerCommand<T = unknown>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
  const api = debuggerApi();
  if (!api) return Promise.reject(new Error("The debugger is not available."));
  return api.sendCommand({ tabId }, method, params) as Promise<T>;
}

/** Called when the connection to a tab ends without a release (bar closed, tab closed, DevTools took over). */
export function onDebuggerDetached(listener: (tabId: number) => void): void {
  detachListeners.add(listener);
}

debuggerApi()?.onDetach?.addListener((source) => {
  if (source.tabId === undefined) return;
  holders.delete(source.tabId);
  for (const listener of detachListeners) listener(source.tabId);
});
