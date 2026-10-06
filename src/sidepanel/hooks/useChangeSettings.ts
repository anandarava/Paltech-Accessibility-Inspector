import { useCallback } from "react";
import type { Settings } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { saveSettings } from "@src/background/storage";
import { useStore } from "@src/sidepanel/store";

/** Returns the handler that updates the shared settings, persists them and tells other pages. */
export function useChangeSettings(): (patch: Partial<Settings>, what: string) => Promise<void> {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const showToast = useStore((s) => s.showToast);
  return useCallback(
    async (patch, what) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      try {
        await saveSettings(next);
        // Let other extension pages (options, other panels) refresh.
        void sendToBackground({ type: "SETTINGS_CHANGED" });
      } catch (e) {
        showToast({ kind: "error", message: `Could not save the ${what}: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [settings, setSettings, showToast],
  );
}
