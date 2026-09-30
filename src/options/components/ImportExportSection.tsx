import { useMemo, useRef, useState, type JSX } from "react";
import type { BaselineEntry, RuleConfig, RulesFile } from "@shared/types";
import { Section, Fieldset, Button, InlineStatus, errorText, type StatusMessage } from "./ui";
import type { BaselineStore } from "./BaselinesSection";

export const EXPORT_FORMAT = "a11y-checker-config";
export const EXPORT_FORMAT_VERSION = 1;

/** Shape of the JSON file produced by Export and accepted by Import (CI reads the same file). */
export interface ConfigExport {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: string;
  rules: RulesFile;
  ruleConfig: RuleConfig;
  baselines: Record<string, BaselineEntry[]>;
  ignored: Record<string, BaselineEntry[]>;
}

export interface ImportPayload {
  ruleConfig: RuleConfig;
  baselines: Record<string, BaselineEntry[]>;
  ignored: Record<string, BaselineEntry[]>;
  rulesVersion?: string;
  warnings: string[];
}

export function buildExport(rulesFile: RulesFile, ruleConfig: RuleConfig, store: BaselineStore): ConfigExport {
  const baselines: Record<string, BaselineEntry[]> = {};
  const ignored: Record<string, BaselineEntry[]> = {};
  for (const [origin, lists] of Object.entries(store)) {
    if (lists.baseline.length) baselines[origin] = lists.baseline;
    if (lists.ignored.length) ignored[origin] = lists.ignored;
  }
  // Reflect disabled rules in the exported rule set so CI tooling that only reads `rules` agrees.
  const rules: RulesFile = {
    ...rulesFile,
    rules: rulesFile.rules.map((r) => (ruleConfig.disabled.includes(r.id) ? { ...r, enabled: false } : r)),
  };
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    rules,
    ruleConfig: { disabled: [...ruleConfig.disabled], thresholds: { ...ruleConfig.thresholds } },
    baselines,
    ignored,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseEntries(v: unknown, label: string, warnings: string[]): Record<string, BaselineEntry[]> {
  const out: Record<string, BaselineEntry[]> = {};
  if (v === undefined) return out;
  if (!isRecord(v)) {
    warnings.push(`"${label}" is not an object keyed by origin and was skipped.`);
    return out;
  }
  for (const [origin, list] of Object.entries(v)) {
    if (!Array.isArray(list)) {
      warnings.push(`"${label}" for ${origin} is not a list and was skipped.`);
      continue;
    }
    const entries: BaselineEntry[] = [];
    for (const item of list) {
      if (!isRecord(item) || typeof item.fingerprint !== "string" || typeof item.ruleId !== "string") {
        warnings.push(`Skipped a malformed ${label} entry for ${origin}.`);
        continue;
      }
      entries.push({
        fingerprint: item.fingerprint,
        ruleId: item.ruleId,
        selector: typeof item.selector === "string" ? item.selector : "",
        reason: typeof item.reason === "string" ? item.reason : "Imported",
        author: typeof item.author === "string" ? item.author : "import",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      });
    }
    if (entries.length) out[origin] = entries;
  }
  return out;
}

/** Validate an import file. Throws with a readable message when the file is unusable. */
export function parseImport(text: string): ImportPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!isRecord(raw)) throw new Error("The file does not contain a JSON object.");
  const warnings: string[] = [];

  // Accept either a full export or a bare RuleConfig / RulesFile for convenience.
  const ruleConfig: RuleConfig = { disabled: [], thresholds: {} };
  const cfgSource = isRecord(raw.ruleConfig) ? raw.ruleConfig : Array.isArray(raw.disabled) || isRecord(raw.thresholds) ? raw : undefined;
  if (cfgSource) {
    if (Array.isArray(cfgSource.disabled)) {
      ruleConfig.disabled = cfgSource.disabled.filter((x): x is string => typeof x === "string");
    }
    if (isRecord(cfgSource.thresholds)) {
      for (const [ruleId, values] of Object.entries(cfgSource.thresholds)) {
        if (!isRecord(values)) continue;
        const clean: Record<string, number> = {};
        for (const [k, n] of Object.entries(values)) if (typeof n === "number" && Number.isFinite(n)) clean[k] = n;
        if (Object.keys(clean).length) ruleConfig.thresholds[ruleId] = clean;
      }
    }
  }

  let rulesVersion: string | undefined;
  const rulesSource = isRecord(raw.rules) ? raw.rules : Array.isArray(raw.rules) ? raw : undefined;
  if (rulesSource && Array.isArray(rulesSource.rules)) {
    if (typeof rulesSource.version === "string") rulesVersion = rulesSource.version;
    for (const r of rulesSource.rules) {
      if (isRecord(r) && typeof r.id === "string" && r.enabled === false && !ruleConfig.disabled.includes(r.id)) {
        ruleConfig.disabled.push(r.id);
      }
    }
  }

  const baselines = parseEntries(raw.baselines, "baselines", warnings);
  const ignored = parseEntries(raw.ignored, "ignored", warnings);

  const hasAnything =
    ruleConfig.disabled.length > 0 || Object.keys(ruleConfig.thresholds).length > 0 || Object.keys(baselines).length > 0 || Object.keys(ignored).length > 0 || rulesSource !== undefined;
  if (!hasAnything) throw new Error("The file contains no rule configuration, baselines or ignored entries.");

  return { ruleConfig, baselines, ignored, rulesVersion, warnings };
}

export function ImportExportSection(props: {
  rulesFile: RulesFile;
  ruleConfig: RuleConfig;
  store: BaselineStore;
  onImport: (payload: ImportPayload) => Promise<{ disabledAdded: number; thresholdsMerged: number; baselinesAdded: number; ignoredAdded: number }>;
  onResetRules: () => void;
}): JSX.Element {
  const { rulesFile, ruleConfig, store, onImport, onResetRules } = props;
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportHref = useMemo(() => {
    const json = JSON.stringify(buildExport(rulesFile, ruleConfig, store), null, 2);
    return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  }, [rulesFile, ruleConfig, store]);

  const filename = `a11y-checker-config-${new Date().toISOString().slice(0, 10)}.json`;

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file || busy) return;
    setBusy(true);
    setStatus({ kind: "info", text: `Reading ${file.name}…` });
    try {
      const text = await file.text();
      const payload = parseImport(text);
      const result = await onImport(payload);
      const parts = [
        `${result.disabledAdded} rule${result.disabledAdded === 1 ? "" : "s"} disabled`,
        `${result.thresholdsMerged} threshold${result.thresholdsMerged === 1 ? "" : "s"} merged`,
        `${result.baselinesAdded} baseline ${result.baselinesAdded === 1 ? "entry" : "entries"} added`,
        `${result.ignoredAdded} ignored ${result.ignoredAdded === 1 ? "entry" : "entries"} added`,
      ];
      const warn = payload.warnings.length ? ` ${payload.warnings.length} item(s) skipped: ${payload.warnings.slice(0, 3).join(" ")}` : "";
      const version = payload.rulesVersion && payload.rulesVersion !== rulesFile.version ? ` Note: the file was made with rule set ${payload.rulesVersion}; this build uses ${rulesFile.version}.` : "";
      setStatus({ kind: "success", text: `Imported ${file.name}: ${parts.join(", ")}.${warn}${version}` });
    } catch (e) {
      setStatus({ kind: "error", text: `Import failed: ${errorText(e)}` });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const configured = ruleConfig.disabled.length > 0 || Object.keys(ruleConfig.thresholds).length > 0;

  return (
    <Section
      id="import-export"
      title="Import and export"
      description="Share the rule set, rule overrides and baselines with teammates or a CI pipeline so everyone checks against the same configuration."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Fieldset legend="Export" description="One JSON file containing a11y-rules.json (with disabled rules marked), your rule overrides and every baseline and ignore list.">
          <a
            href={exportHref}
            download={filename}
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-100"
          >
            Download {filename}
          </a>
          <p className="text-xs text-slate-500">
            {rulesFile.rules.length} rules · {ruleConfig.disabled.length} disabled · {Object.values(store).reduce((n, l) => n + l.baseline.length, 0)} baselined ·{" "}
            {Object.values(store).reduce((n, l) => n + l.ignored.length, 0)} ignored
          </p>
        </Fieldset>

        <Fieldset legend="Import" description="Merges into the current configuration: disabled rules and thresholds are combined, baselines and ignore lists are added per origin. Nothing is removed.">
          <div>
            <label htmlFor="import-file" className="block text-sm font-medium text-slate-800">
              Configuration file (.json)
            </label>
            <input
              id="import-file"
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-100"
              disabled={busy}
              onChange={(e) => void handleFile(e.target.files?.[0])}
              aria-describedby="import-file-hint"
            />
            <p id="import-file-hint" className="mt-1 text-xs text-slate-500">
              Accepts a file exported from this page, a bare rule configuration, or an a11y-rules.json. Changes are saved immediately.
            </p>
          </div>
          <div>
            <Button
              variant="danger"
              disabled={!configured || busy}
              onClick={() => {
                if (window.confirm("Re-enable every rule and clear all thresholds? Baselines are kept.")) {
                  onResetRules();
                  setStatus({ kind: "info", text: "Rule overrides reset to defaults. Save changes to apply." });
                }
              }}
            >
              Reset rule overrides
            </Button>
          </div>
        </Fieldset>
      </div>
      <InlineStatus status={status} />
    </Section>
  );
}
