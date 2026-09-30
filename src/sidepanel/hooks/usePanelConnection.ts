import { useEffect } from "react";
import { PANEL_PORT_PREFIX } from "@shared/constants";
import { useStore } from "@src/sidepanel/store";

const RECONNECT_DELAY_MS = 1_000;

/**
 * Keeps a port open to the service worker for the tab this panel shows. The
 * service worker clears the page's overlay (badges, outlines, highlights,
 * colour-blindness filter, picker) once no panel is connected for that tab,
 * i.e. when the panel is closed or moves to another tab.
 *
 * The MV3 service worker may be stopped while idle, which drops the port from
 * its side; the panel then reconnects so the worker (restarted) knows again.
 */
export function usePanelConnection(): void {
  const tabId = useStore((s) => s.tabId);
  useEffect(() => {
    if (tabId === null) return;
    let port: chrome.runtime.Port | null = null;
    let timer: number | undefined;
    let disposed = false;
    const connect = (): void => {
      if (disposed) return;
      try {
        port = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });
      } catch {
        timer = window.setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        port = null;
        if (!disposed) timer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      try {
        port?.disconnect();
      } catch {
        /* already closed */
      }
    };
  }, [tabId]);
}
