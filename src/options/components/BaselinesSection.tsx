import { useState, type JSX } from "react";
import type { BaselineEntry } from "@shared/types";
import { STORAGE_KEYS } from "@shared/constants";
import { sendToBackground } from "@shared/messages";
import { getBaseline, getIgnored, removeBaseline, removeIgnored } from "@src/background/storage";
import { Section, Fieldset, SelectField, Button, InlineStatus, formatDate, errorText, type StatusMessage } from "./ui";

export type ListKind = "baseline" | "ignored";

export interface OriginLists {
  baseline: BaselineEntry[];
  ignored: BaselineEntry[];
}

export type BaselineStore = Record<string, OriginLists>;

const BASELINE_PREFIX = "baseline:";
const IGNORED_PREFIX = "ignored:";

/** Errors from chrome.runtime.sendMessage that mean nobody received the message (SW asleep / not loaded). */
const TRANSPORT_ERROR = /receiving end does not exist|message port closed/i;

/**
 * Remove entries through the service worker so it can also reset the matching issues in
 * every open tab of that origin (stored result, overlay status, panel broadcast). Only when
 * the SW cannot be reached at all do we fall back to editing storage directly.
 */
async function removeEntries(kind: ListKind, origin: string, fingerprints: string[]): Promise<void> {
  const res = await sendToBackground({ type: kind === "baseline" ? "BASELINE_REMOVE" : "IGNORE_REMOVE", origin, fingerprints });
  if (res.ok) return;
  if (res.error && !TRANSPORT_ERROR.test(res.error)) throw new Error(res.error);
  if (kind === "baseline") await removeBaseline(origin, fingerprints);
  else await removeIgnored(origin, fingerprints);
}

function isBaselineEntry(v: unknown): v is BaselineEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.fingerprint === "string" && typeof e.ruleId === "string";
}

function coerceEntries(v: unknown): BaselineEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isBaselineEntry).map((e) => ({
    fingerprint: e.fingerprint,
    ruleId: e.ruleId,
    selector: typeof e.selector === "string" ? e.selector : "",
    reason: typeof e.reason === "string" ? e.reason : "",
    author: typeof e.author === "string" ? e.author : "",
    createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
  }));
}

/**
 * Discover every origin with a baseline or ignore list by scanning chrome.storage.local
 * keys, then load the lists through the storage module so its normalisation applies.
 */
export async function loadBaselineStore(): Promise<BaselineStore> {
  const all = await chrome.storage.local.get(null);
  const origins = new Set<string>();
  for (const key of Object.keys(all)) {
    if (key.startsWith(BASELINE_PREFIX)) origins.add(key.slice(BASELINE_PREFIX.length));
    else if (key.startsWith(IGNORED_PREFIX)) origins.add(key.slice(IGNORED_PREFIX.length));
  }
  const store: BaselineStore = {};
  for (const origin of [...origins].sort()) {
    let baseline: BaselineEntry[];
    let ignored: BaselineEntry[];
    try {
      baseline = await getBaseline(origin);
    } catch {
      baseline = coerceEntries(all[STORAGE_KEYS.baseline(origin)]);
    }
    try {
      ignored = await getIgnored(origin);
    } catch {
      ignored = coerceEntries(all[STORAGE_KEYS.ignored(origin)]);
    }
    store[origin] = { baseline: coerceEntries(baseline), ignored: coerceEntries(ignored) };
  }
  return store;
}

function EntryTable(props: {
  kind: ListKind;
  origin: string;
  entries: BaselineEntry[];
  busy: boolean;
  onRemove: (kind: ListKind, fingerprints: string[]) => void;
}): JSX.Element {
  const { kind, entries, busy, onRemove } = props;
  const title = kind === "baseline" ? "Baselined issues" : "Ignored issues";
  const description =
    kind === "baseline"
      ? "Known, accepted issues. Hidden by default and excluded from the score; CI treats them as expected."
      : "Findings marked as false positives. Hidden by default and excluded from the score.";
  return (
    <Fieldset legend={`${title} (${entries.length})`} description={description}>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing recorded for this origin.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                {title} for {props.origin}
              </caption>
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Fingerprint
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Rule
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Selector
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Reason
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Author
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.fingerprint} className="border-t border-slate-200 align-top">
                    <th scope="row" className="px-3 py-2 font-mono text-xs font-normal">
                      {e.fingerprint}
                    </th>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{e.ruleId}</td>
                    <td className="max-w-xs break-all px-3 py-2 font-mono text-xs">{e.selector || "—"}</td>
                    <td className="max-w-xs px-3 py-2">{e.reason || "—"}</td>
                    <td className="px-3 py-2">{e.author || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(e.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => onRemove(kind, [e.fingerprint])}
                        aria-label={`Remove ${kind === "baseline" ? "baseline" : "ignore"} entry ${e.ruleId} ${e.fingerprint}`}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove all ${entries.length} ${kind === "baseline" ? "baselined" : "ignored"} entries for ${props.origin}?`)) {
                  onRemove(
                    kind,
                    entries.map((e) => e.fingerprint),
                  );
                }
              }}
            >
              Remove all {kind === "baseline" ? "baselined" : "ignored"} entries
            </Button>
          </div>
        </>
      )}
    </Fieldset>
  );
}

export function BaselinesSection(props: { store: BaselineStore; onReload: () => Promise<void> }): JSX.Element {
  const { store, onReload } = props;
  const origins = Object.keys(store);
  const [selected, setSelected] = useState<string>("");
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [busy, setBusy] = useState(false);

  const origin = origins.includes(selected) ? selected : (origins[0] ?? "");
  const lists = origin ? store[origin] : undefined;

  const remove = async (kind: ListKind, fingerprints: string[]): Promise<void> => {
    if (!origin || busy) return;
    setBusy(true);
    try {
      await removeEntries(kind, origin, fingerprints);
      await onReload();
      setStatus({
        kind: "success",
        text: `Removed ${fingerprints.length} ${kind === "baseline" ? "baseline" : "ignore"} ${fingerprints.length === 1 ? "entry" : "entries"} for ${origin}.`,
      });
    } catch (e) {
      setStatus({ kind: "error", text: `Could not remove: ${errorText(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id="baselines"
      title="Baselines and ignored issues"
      description="Issues accepted (baselined) or dismissed (ignored) from the side panel, grouped by site origin."
    >
      {origins.length === 0 ? (
        <p className="text-sm text-slate-600">No baselines or ignored issues have been recorded yet. Use “Add to baseline” or “Ignore” on an issue in the side panel.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,28rem)_auto] sm:items-end">
            <SelectField
              id="baseline-origin"
              label="Origin"
              value={origin}
              onChange={setSelected}
              options={origins.map((o) => ({
                value: o,
                label: `${o} (${store[o]?.baseline.length ?? 0} baselined, ${store[o]?.ignored.length ?? 0} ignored)`,
              }))}
            />
            <Button onClick={() => void onReload()} disabled={busy}>
              Refresh
            </Button>
          </div>
          {lists ? (
            <>
              <EntryTable kind="baseline" origin={origin} entries={lists.baseline} busy={busy} onRemove={(k, f) => void remove(k, f)} />
              <EntryTable kind="ignored" origin={origin} entries={lists.ignored} busy={busy} onRemove={(k, f) => void remove(k, f)} />
            </>
          ) : null}
        </>
      )}
      <InlineStatus status={status} />
    </Section>
  );
}
