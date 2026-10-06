import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { BaselineEntry, RuleConfig, RulesFile, Settings } from "@shared/types";
import { DEFAULT_RULE_CONFIG, DEFAULT_SETTINGS, STORAGE_KEYS } from "@shared/constants";
import { sendToBackground } from "@shared/messages";
import rulesJson from "@shared/a11y-rules.json";
import { addBaseline, addIgnored, getBaseline, getIgnored, getRuleConfig, getSettings, saveRuleConfig, saveSettings } from "@src/background/storage";
import { GeneralSection } from "./components/GeneralSection";
import { CategoriesSection } from "./components/CategoriesSection";
import { RulesSection } from "./components/RulesSection";
import { PrivacySection, parseSelectorLines } from "./components/PrivacySection";
import { BaselinesSection, loadBaselineStore, type BaselineStore } from "./components/BaselinesSection";
import { ImportExportSection, type ImportPayload } from "./components/ImportExportSection";
import { Button, InlineStatus, errorText, type StatusMessage } from "./components/ui";

const rulesFile = rulesJson as unknown as RulesFile;

const NAV: Array<{ id: string; label: string }> = [
  { id: "general", label: "General" },
  { id: "categories", label: "Categories" },
  { id: "rules", label: "Rules" },
  { id: "privacy", label: "Screenshots and privacy" },
  { id: "baselines", label: "Baselines and ignored" },
  { id: "import-export", label: "Import and export" },
];

interface LoadedState {
  settings: Settings;
  ruleConfig: RuleConfig;
}

function cloneSettings(s: Settings): Settings {
  return {
    ...s,
    enabledCategories: [...s.enabledCategories],
    redactSelectors: [...s.redactSelectors],
    overlay: { ...s.overlay, colors: { ...s.overlay.colors } },
  };
}

function cloneRuleConfig(c: RuleConfig): RuleConfig {
  const thresholds: RuleConfig["thresholds"] = {};
  for (const [k, v] of Object.entries(c.thresholds)) thresholds[k] = { ...v };
  return { disabled: [...c.disabled], thresholds };
}

/** Defensive merge so the page never renders undefined fields even if storage returns a partial object. */
function withDefaults<T extends object>(defaults: T, value: Partial<T> | undefined): T {
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  if (value) {
    for (const [k, v] of Object.entries(value)) {
      const d = (defaults as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof d === "object" && d !== null && !Array.isArray(d) && typeof v === "object" && v !== null && !Array.isArray(v)) {
        out[k] = { ...(d as Record<string, unknown>), ...(v as Record<string, unknown>) };
      } else {
        out[k] = v;
      }
    }
  }
  return out as T;
}

async function loadAll(): Promise<LoadedState> {
  const [settings, ruleConfig] = await Promise.all([getSettings(), getRuleConfig()]);
  return {
    settings: withDefaults(DEFAULT_SETTINGS, settings),
    ruleConfig: withDefaults(DEFAULT_RULE_CONFIG, ruleConfig),
  };
}

export function Options(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(() => cloneSettings(DEFAULT_SETTINGS));
  const [redactText, setRedactText] = useState(DEFAULT_SETTINGS.redactSelectors.join("\n"));
  const [ruleConfig, setRuleConfig] = useState<RuleConfig>(() => cloneRuleConfig(DEFAULT_RULE_CONFIG));
  /** The rule configuration as persisted; Export uses this, not the unsaved draft. */
  const [savedRuleConfig, setSavedRuleConfig] = useState<RuleConfig>(() => cloneRuleConfig(DEFAULT_RULE_CONFIG));
  const [store, setStore] = useState<BaselineStore>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const savedRef = useRef<LoadedState | null>(null);
  /** Settings fields edited on this page since the last load/save; only these are written on save. */
  const editedRef = useRef<Set<keyof Settings>>(new Set());
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const reloadBaselines = useCallback(async (): Promise<void> => {
    try {
      setStore(await loadBaselineStore());
    } catch (e) {
      setStatus({ kind: "error", text: `Could not load baselines: ${errorText(e)}` });
    }
  }, []);

  const applyLoaded = useCallback((loaded: LoadedState): void => {
    savedRef.current = loaded;
    setSavedRuleConfig(cloneRuleConfig(loaded.ruleConfig));
    setSettings(cloneSettings(loaded.settings));
    setRedactText(loaded.settings.redactSelectors.join("\n"));
    setRuleConfig(cloneRuleConfig(loaded.ruleConfig));
    editedRef.current = new Set();
    setDirty(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadAll();
        if (cancelled) return;
        applyLoaded(loaded);
        await reloadBaselines();
      } catch (e) {
        if (!cancelled) setLoadError(errorText(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyLoaded, reloadBaselines]);

  // Keep baselines (and, when nothing is being edited, the settings form) in step with storage
  // changes made elsewhere, e.g. the side panel adding a baseline or changing a setting.
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area !== "local") return;
      const keys = Object.keys(changes);
      if (keys.some((k) => k.startsWith("baseline:") || k.startsWith("ignored:"))) void reloadBaselines();
      if (keys.includes(STORAGE_KEYS.settings) && !dirtyRef.current) {
        void loadAll().then((loaded) => {
          if (!dirtyRef.current) applyLoaded(loaded);
        }, () => undefined);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [applyLoaded, reloadBaselines]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const markDirty = (): void => setDirty(true);

  const patchSettings = (patch: Partial<Settings>): void => {
    setSettings((s) => ({ ...s, ...patch }));
    for (const k of Object.keys(patch) as Array<keyof Settings>) editedRef.current.add(k);
    markDirty();
  };

  const notifySettingsChanged = async (): Promise<void> => {
    const res = await sendToBackground({ type: "SETTINGS_CHANGED" });
    // The service worker may be asleep or not yet handle this message; that is not a save failure.
    if (!res.ok && res.error && !/receiving end does not exist|message port closed/i.test(res.error)) {
      setStatus((s) => (s?.kind === "error" ? s : { kind: "info", text: `Saved. Background could not be notified: ${res.error}` }));
    }
  };

  const save = async (): Promise<void> => {
    if (saving || loading) return;
    setSaving(true);
    setStatus({ kind: "info", text: "Saving…" });
    try {
      // Re-read the stored settings and overwrite only the fields edited on this page, so changes
      // made in the side panel since this page was opened are not reverted.
      const nextSettings = cloneSettings(withDefaults(DEFAULT_SETTINGS, await getSettings()));
      const edited = editedRef.current;
      const target = nextSettings as unknown as Record<string, unknown>;
      for (const key of edited) {
        const v = (settings as unknown as Record<string, unknown>)[key];
        target[key] = typeof v === "string" ? v.trim() : v;
      }
      if (edited.has("redactSelectors")) nextSettings.redactSelectors = parseSelectorLines(redactText);
      const nextRuleConfig = cloneRuleConfig(ruleConfig);
      await saveSettings(nextSettings);
      await saveRuleConfig(nextRuleConfig);

      applyLoaded({ settings: nextSettings, ruleConfig: nextRuleConfig });
      setStatus({ kind: "success", text: `Settings saved at ${new Date().toLocaleTimeString()}.` });
      await notifySettingsChanged();
    } catch (e) {
      setStatus({ kind: "error", text: `Could not save settings: ${errorText(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const discard = (): void => {
    if (!savedRef.current) return;
    applyLoaded(savedRef.current);
    setStatus({ kind: "info", text: "Unsaved changes discarded." });
  };

  const importConfig = async (payload: ImportPayload): Promise<{ disabledAdded: number; thresholdsMerged: number; baselinesAdded: number; ignoredAdded: number }> => {
    // Merge into the persisted rule config (not the unsaved draft) so the import is durable,
    // then bring the draft in line with it while keeping other unsaved edits.
    const current = withDefaults(DEFAULT_RULE_CONFIG, await getRuleConfig());
    const merged = cloneRuleConfig(current);
    let disabledAdded = 0;
    for (const id of payload.ruleConfig.disabled) {
      if (!merged.disabled.includes(id)) {
        merged.disabled.push(id);
        disabledAdded++;
      }
    }
    let thresholdsMerged = 0;
    for (const [ruleId, values] of Object.entries(payload.ruleConfig.thresholds)) {
      merged.thresholds[ruleId] = { ...(merged.thresholds[ruleId] ?? {}), ...values };
      thresholdsMerged += Object.keys(values).length;
    }
    await saveRuleConfig(merged);

    const addNew = async (
      lists: Record<string, BaselineEntry[]>,
      existing: (origin: string) => Promise<BaselineEntry[]>,
      add: (origin: string, entries: BaselineEntry[]) => Promise<void>,
    ): Promise<number> => {
      let n = 0;
      for (const [origin, entries] of Object.entries(lists)) {
        // Read the persisted list per origin (not the page-load snapshot) and dedupe within the payload too.
        const known = new Set((await existing(origin)).map((e) => e.fingerprint));
        const fresh: BaselineEntry[] = [];
        for (const e of entries) {
          if (known.has(e.fingerprint)) continue;
          known.add(e.fingerprint);
          fresh.push(e);
        }
        if (fresh.length) {
          await add(origin, fresh);
          n += fresh.length;
        }
      }
      return n;
    };
    const baselinesAdded = await addNew(payload.baselines, getBaseline, addBaseline);
    const ignoredAdded = await addNew(payload.ignored, getIgnored, addIgnored);

    // Reflect the merge in the draft: keep any unsaved disables/thresholds too.
    setRuleConfig((draft) => {
      const next = cloneRuleConfig(merged);
      for (const id of draft.disabled) if (!next.disabled.includes(id)) next.disabled.push(id);
      for (const [ruleId, values] of Object.entries(draft.thresholds)) next.thresholds[ruleId] = { ...(next.thresholds[ruleId] ?? {}), ...values };
      return next;
    });
    if (savedRef.current) savedRef.current = { ...savedRef.current, ruleConfig: merged };
    setSavedRuleConfig(cloneRuleConfig(merged));
    await reloadBaselines();
    await notifySettingsChanged();
    return { disabledAdded, thresholdsMerged, baselinesAdded, ignoredAdded };
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-bold">PalTech A11y Inspector settings</h1>
        <p role="status" aria-live="polite" className="mt-4 text-sm text-slate-600">
          Loading settings…
        </p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-bold">PalTech A11y Inspector settings</h1>
        <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Settings could not be loaded: {loadError}
        </p>
        <Button className="mt-3" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </main>
    );
  }

  return (
    <div className="min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-xl font-bold text-slate-900">PalTech A11y Inspector settings</h1>
          <span className="text-xs text-slate-500">WCAG 2.2 · rule set {rulesFile.version}</span>
          <div className="ml-auto flex items-center gap-2">
            {/* Always mounted so the live region exists before its text changes; otherwise screen readers never announce it. */}
            <span className="text-xs font-medium text-amber-700" aria-live="polite">
              {dirty ? "Unsaved changes" : ""}
            </span>
            <Button onClick={discard} disabled={!dirty || saving}>
              Discard
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-2">
          <InlineStatus id="global-status" status={status} />
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <nav aria-label="Settings sections" className="sticky top-28 hidden h-fit w-52 shrink-0 md:block">
          <ul className="space-y-1 text-sm">
            {NAV.map((n) => (
              <li key={n.id}>
                <a href={`#${n.id}`} className="block rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" className="min-w-0 flex-1 space-y-6" tabIndex={-1}>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <GeneralSection settings={settings} onChange={patchSettings} />
            <CategoriesSection enabled={settings.enabledCategories} onChange={(next) => patchSettings({ enabledCategories: next })} />
            <RulesSection
              rulesFile={rulesFile}
              config={ruleConfig}
              onChange={(next) => {
                setRuleConfig(next);
                markDirty();
              }}
            />
            <PrivacySection
              settings={settings}
              redactText={redactText}
              onRedactTextChange={(t) => {
                setRedactText(t);
                editedRef.current.add("redactSelectors");
                markDirty();
              }}
              onChange={patchSettings}
            />
            <div className="flex justify-end gap-2">
              <Button onClick={discard} disabled={!dirty || saving}>
                Discard
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>

          <BaselinesSection store={store} onReload={reloadBaselines} />
          <ImportExportSection
            rulesFile={rulesFile}
            ruleConfig={savedRuleConfig}
            hasUnsavedRuleChanges={JSON.stringify(ruleConfig) !== JSON.stringify(savedRuleConfig)}
            store={store}
            onImport={importConfig}
            onResetRules={() => {
              setRuleConfig(cloneRuleConfig(DEFAULT_RULE_CONFIG));
              markDirty();
            }}
          />
        </main>
      </div>
    </div>
  );
}
