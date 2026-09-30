/**
 * MAIN-world hook (injected with chrome.scripting.executeScript world: "MAIN").
 *
 * Wraps history.pushState / replaceState so the content script (isolated
 * world) learns about SPA route changes through a DOM CustomEvent. Runs in the
 * page's JavaScript world: it must not use any chrome.* API and must be
 * idempotent because the service worker may inject it more than once.
 */
import { ROUTE_CHANGE_EVENT } from "@shared/constants";

type HistoryMethod = "pushState" | "replaceState";
type HookedWindow = Window & { __a11yCheckerHistoryHooked?: boolean };

(function installHistoryHook(): void {
  const win = window as HookedWindow;
  if (win.__a11yCheckerHistoryHooked) return;
  const historyObject = win.history;
  if (!historyObject) return;
  win.__a11yCheckerHistoryHooked = true;

  const notify = (method: HistoryMethod, url: string | URL | null | undefined): void => {
    try {
      win.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT, { detail: { method, url: url == null ? null : String(url) } }));
    } catch {
      /* dispatching must never break the page's navigation */
    }
  };

  const wrap = (method: HistoryMethod): void => {
    const original = historyObject[method];
    if (typeof original !== "function") return;
    const wrapped = function (this: History, ...args: Parameters<History[HistoryMethod]>): void {
      original.apply(this, args);
      notify(method, args[2]);
    };
    try {
      Object.defineProperty(wrapped, "name", { value: method, configurable: true });
      Object.defineProperty(wrapped, "toString", { value: () => original.toString(), configurable: true });
    } catch {
      /* cosmetic only */
    }
    try {
      Object.defineProperty(historyObject, method, { value: wrapped, configurable: true, writable: true });
    } catch {
      (historyObject as unknown as Record<string, unknown>)[method] = wrapped;
    }
  };

  wrap("pushState");
  wrap("replaceState");
})();
