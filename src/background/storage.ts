/**
 * Storage access for the PalTech A11y Inspector extension.
 *
 * - `chrome.storage.local`   : settings, rule config, baseline / ignored
 *                              fingerprints per origin, saved scans.
 * - `chrome.storage.session` : the last
 *                              scan result per tab, and evidence screenshots
 *                              stored under separate `evidence:<tabId>:...` keys.
 *
 * Screenshots are kept out of the result blob so that the result (statuses,
 * evidence) can always be written: chrome.storage.session has
 * a hard 10 MB quota shared by all tabs, and a few dozen PNG data URLs easily
 * exceed it. Screenshots live under a byte budget with LRU eviction and are
 * re-attached on read.
 *
 * Settings / RuleConfig are deep-merged with the DEFAULT_*
 * constants so new fields never come back undefined. This module only uses
 * `chrome.storage`, so the options page and side panel may import it as well.
 */
import type {
  BaselineEntry,
  RuleConfig,
  SavedScan,
  SavedScanMeta,
  ScanResult,
  Settings,
} from "@shared/types";
import {
  DEFAULT_RULE_CONFIG,
  DEFAULT_SETTINGS,
  SAVED_SCAN_LIMIT,
  STORAGE_KEYS,
} from "@shared/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `stored` over `defaults`. Arrays and primitives in `stored`
 * replace the default; nested plain objects are merged recursively. Keys with
 * `undefined` or `null` values in `stored` keep the default.
 */
export function deepMerge<T>(defaults: T, stored: unknown): T {
  if (!isPlainObject(defaults)) {
    return (stored === undefined || stored === null ? defaults : (stored as T));
  }
  if (!isPlainObject(stored)) return structuredCloneSafe(defaults);
  const out: Record<string, unknown> = {};
  const base = defaults as unknown as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    const d = base[key];
    const s = stored[key];
    if (s === undefined || s === null) {
      out[key] = structuredCloneSafe(d);
    } else if (isPlainObject(d)) {
      out[key] = deepMerge(d, s);
    } else if (Array.isArray(d)) {
      out[key] = Array.isArray(s) ? [...s] : structuredCloneSafe(d);
    } else if (typeof d === typeof s || d === undefined) {
      out[key] = s;
    } else {
      out[key] = structuredCloneSafe(d);
    }
  }
  // Preserve unknown extra keys the caller stored (forward compatibility).
  for (const key of Object.keys(stored)) {
    if (!(key in out)) out[key] = stored[key];
  }
  return out as T;
}

function structuredCloneSafe<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function localGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(key, (items) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(items?.[key] as T | undefined);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function localSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function sessionArea(): chrome.storage.StorageArea {
  // chrome.storage.session exists from Chrome 102; fall back to local if absent
  // (e.g. when the module is evaluated in a test environment).
  const area = (chrome.storage as unknown as { session?: chrome.storage.StorageArea }).session;
  return area ?? chrome.storage.local;
}

function sessionGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    try {
      sessionArea().get(key, (items) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(items?.[key] as T | undefined);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function sessionSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      sessionArea().set({ [key]: value }, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function sessionGetMany(keys: string[]): Promise<Record<string, unknown>> {
  if (keys.length === 0) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    try {
      sessionArea().get(keys, (items) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve((items ?? {}) as Record<string, unknown>);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function sessionRemove(key: string | string[]): Promise<void> {
  if (Array.isArray(key) && key.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      sessionArea().remove(key, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin;
  }
}

function isBaselineEntry(value: unknown): value is BaselineEntry {
  return isPlainObject(value) && typeof value.fingerprint === "string";
}

async function getEntries(key: string): Promise<BaselineEntry[]> {
  const stored = await localGet<unknown>(key);
  if (!Array.isArray(stored)) return [];
  return stored.filter(isBaselineEntry).map((e) => ({
    fingerprint: e.fingerprint,
    ruleId: typeof e.ruleId === "string" ? e.ruleId : "",
    selector: typeof e.selector === "string" ? e.selector : "",
    reason: typeof e.reason === "string" ? e.reason : "",
    author: typeof e.author === "string" ? e.author : "",
    createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date().toISOString(),
  }));
}

/** Serialises read-modify-write sections per storage key so concurrent calls cannot lose data. */
const keyLocks = new Map<string, Promise<unknown>>();

function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const settled = run.catch(() => undefined);
  keyLocks.set(key, settled);
  void settled.then(() => {
    if (keyLocks.get(key) === settled) keyLocks.delete(key);
  });
  return run;
}

function addEntries(key: string, entries: BaselineEntry[]): Promise<void> {
  return withKeyLock(key, () => addEntriesNow(key, entries));
}

function removeEntries(key: string, fingerprints: string[]): Promise<void> {
  return withKeyLock(key, () => removeEntriesNow(key, fingerprints));
}

async function addEntriesNow(key: string, entries: BaselineEntry[]): Promise<void> {
  const existing = await getEntries(key);
  const byFingerprint = new Map<string, BaselineEntry>();
  for (const e of existing) byFingerprint.set(e.fingerprint, e);
  for (const e of entries) {
    if (!e || typeof e.fingerprint !== "string" || !e.fingerprint) continue;
    byFingerprint.set(e.fingerprint, {
      fingerprint: e.fingerprint,
      ruleId: e.ruleId ?? "",
      selector: e.selector ?? "",
      reason: e.reason ?? "",
      author: e.author ?? "",
      createdAt: e.createdAt ?? new Date().toISOString(),
    });
  }
  await localSet(key, [...byFingerprint.values()]);
}

async function removeEntriesNow(key: string, fingerprints: string[]): Promise<void> {
  const remove = new Set(fingerprints);
  const existing = await getEntries(key);
  const next = existing.filter((e) => !remove.has(e.fingerprint));
  if (next.length === existing.length) return;
  await localSet(key, next);
}

// ---------------------------------------------------------------------------
// Settings / rules
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  const stored = await localGet<unknown>(STORAGE_KEYS.settings);
  return deepMerge<Settings>(DEFAULT_SETTINGS, stored);
}

export async function saveSettings(s: Settings): Promise<void> {
  await localSet(STORAGE_KEYS.settings, deepMerge<Settings>(DEFAULT_SETTINGS, s));
}

export async function getRuleConfig(): Promise<RuleConfig> {
  const stored = await localGet<unknown>(STORAGE_KEYS.rules);
  const merged = deepMerge<RuleConfig>(DEFAULT_RULE_CONFIG, stored);
  if (!Array.isArray(merged.disabled)) merged.disabled = [];
  if (!isPlainObject(merged.thresholds)) merged.thresholds = {};
  return merged;
}

export async function saveRuleConfig(c: RuleConfig): Promise<void> {
  await localSet(STORAGE_KEYS.rules, deepMerge<RuleConfig>(DEFAULT_RULE_CONFIG, c));
}

// ---------------------------------------------------------------------------
// Baseline / ignored (per origin)
// ---------------------------------------------------------------------------

export function getBaseline(origin: string): Promise<BaselineEntry[]> {
  return getEntries(STORAGE_KEYS.baseline(normalizeOrigin(origin)));
}

export function addBaseline(origin: string, entries: BaselineEntry[]): Promise<void> {
  return addEntries(STORAGE_KEYS.baseline(normalizeOrigin(origin)), entries);
}

export function removeBaseline(origin: string, fingerprints: string[]): Promise<void> {
  return removeEntries(STORAGE_KEYS.baseline(normalizeOrigin(origin)), fingerprints);
}

export function getIgnored(origin: string): Promise<BaselineEntry[]> {
  return getEntries(STORAGE_KEYS.ignored(normalizeOrigin(origin)));
}

export function addIgnored(origin: string, entries: BaselineEntry[]): Promise<void> {
  return addEntries(STORAGE_KEYS.ignored(normalizeOrigin(origin)), entries);
}

export function removeIgnored(origin: string, fingerprints: string[]): Promise<void> {
  return removeEntries(STORAGE_KEYS.ignored(normalizeOrigin(origin)), fingerprints);
}

// ---------------------------------------------------------------------------
// Last result per tab (session storage)
//
// The ScanResult is stored WITHOUT screenshots. Every `issue.evidence.screenshot`
// data URL is written to its own `evidence:<tabId>:<kind>:<id>` key and tracked in a small index so that:
//   - the result blob stays small and status writes never
//     fail because of accumulated screenshots;
//   - screenshots share a byte budget (EVIDENCE_BUDGET_BYTES) well below the
//     10 MB session quota, with least-recently-stored eviction across tabs;
//   - a quota error while writing a screenshot evicts older screenshots and
//     retries instead of failing the whole write;
//   - closing a tab (clearLastResult) or a new scan (different scanId) drops
//     the tab's screenshots.
// getLastResult re-attaches the stored screenshots, so callers see the same
// shape as before.
// ---------------------------------------------------------------------------

/** Total bytes of screenshot data kept in session storage across all tabs. */
const EVIDENCE_BUDGET_BYTES = 6 * 1024 * 1024;
/** A single screenshot larger than this is never stored (it would dominate the budget). */
const EVIDENCE_MAX_ITEM_BYTES = 2 * 1024 * 1024;
const EVIDENCE_INDEX_KEY = "evidence:index";
const EVIDENCE_KEY_PREFIX = "evidence:";

type EvidenceKind = "i";

interface EvidenceEntry {
  tabId: number;
  scanId: string;
  kind: EvidenceKind;
  /** Issue id. */
  id: string;
  bytes: number;
  hash: string;
  /** Monotonic insertion order; smaller = older (eviction candidate). */
  seq: number;
}

interface EvidenceIndex {
  seq: number;
  entries: Record<string, EvidenceEntry>;
}

interface PendingShot {
  key: string;
  kind: EvidenceKind;
  id: string;
  dataUrl: string;
}

function evidenceKey(tabId: number, kind: EvidenceKind, id: string): string {
  return `${EVIDENCE_KEY_PREFIX}${tabId}:${kind}:${id}`;
}

function isQuotaError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /quota/i.test(message);
}

/** Approximate bytes chrome.storage will account for a string value under `key`. */
function estimateBytes(key: string, value: string): number {
  return key.length + value.length + 8;
}

/**
 * Cheap change-detection hash for a data URL: length plus FNV-1a over a
 * bounded sample of characters (data URLs of different captures differ
 * throughout, so sampling is sufficient to detect a re-capture).
 */
function sampleHash(value: string): string {
  const len = value.length;
  const step = Math.max(1, Math.floor(len / 4096));
  let h = 0x811c9dc5;
  for (let i = 0; i < len; i += step) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${len}:${h.toString(16)}`;
}

function isEvidenceEntry(value: unknown): value is EvidenceEntry {
  return (
    isPlainObject(value) &&
    typeof value.tabId === "number" &&
    typeof value.scanId === "string" &&
    value.kind === "i" &&
    typeof value.id === "string" &&
    typeof value.bytes === "number" &&
    typeof value.hash === "string" &&
    typeof value.seq === "number"
  );
}

async function loadEvidenceIndex(): Promise<EvidenceIndex> {
  const stored = await sessionGet<unknown>(EVIDENCE_INDEX_KEY);
  const index: EvidenceIndex = { seq: 0, entries: {} };
  if (!isPlainObject(stored)) return index;
  if (typeof stored.seq === "number" && Number.isFinite(stored.seq)) index.seq = stored.seq;
  if (isPlainObject(stored.entries)) {
    for (const [key, entry] of Object.entries(stored.entries)) {
      if (key.startsWith(EVIDENCE_KEY_PREFIX) && isEvidenceEntry(entry)) index.entries[key] = entry;
    }
  }
  return index;
}

function saveEvidenceIndex(index: EvidenceIndex): Promise<void> {
  return sessionSet(EVIDENCE_INDEX_KEY, index);
}

function evidenceBytes(index: EvidenceIndex): number {
  let total = 0;
  for (const entry of Object.values(index.entries)) total += entry.bytes;
  return total;
}

/** Keys of the index entries for `tabId`, optionally only those NOT belonging to `scanId`. */
function evidenceKeysForTab(index: EvidenceIndex, tabId: number, exceptScanId?: string): string[] {
  return Object.entries(index.entries)
    .filter(([, e]) => e.tabId === tabId && (exceptScanId === undefined || e.scanId !== exceptScanId))
    .map(([key]) => key);
}

/**
 * Remove the oldest evictable screenshot from storage and the index.
 * Returns false when nothing could be evicted.
 */
async function evictOldestEvidence(index: EvidenceIndex, protectedKeys: Set<string>): Promise<boolean> {
  let oldestKey: string | undefined;
  let oldestSeq = Number.POSITIVE_INFINITY;
  for (const [key, entry] of Object.entries(index.entries)) {
    if (protectedKeys.has(key)) continue;
    if (entry.seq < oldestSeq) {
      oldestSeq = entry.seq;
      oldestKey = key;
    }
  }
  if (oldestKey === undefined) return false;
  delete index.entries[oldestKey];
  await sessionRemove(oldestKey).catch(() => undefined);
  return true;
}

/** Evict everything held in the index (used when the result itself does not fit). */
async function evictAllEvidence(index: EvidenceIndex): Promise<number> {
  const keys = Object.keys(index.entries);
  if (keys.length === 0) return 0;
  index.entries = {};
  await sessionRemove(keys).catch(() => undefined);
  return keys.length;
}

/**
 * Serialises evidence-index read-modify-write cycles. Several handlers write
 * results concurrently (e.g. unmarkIssues over every tab), and a lost index
 * update would orphan screenshot keys or double-count the budget.
 */
let evidenceQueue: Promise<unknown> = Promise.resolve();

function withEvidenceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = evidenceQueue.then(fn, fn);
  evidenceQueue = run.catch(() => undefined);
  return run;
}

/**
 * Split `r` into a screenshot-free copy (safe to persist) and the list of
 * screenshots to store separately. The caller's object is never mutated.
 */
function stripScreenshots(tabId: number, r: ScanResult): { stripped: ScanResult; shots: PendingShot[] } {
  const shots: PendingShot[] = [];
  const seen = new Set<string>();

  const issues = Array.isArray(r.issues)
    ? r.issues.map((issue) => {
        const shot = issue.evidence?.screenshot;
        if (typeof shot !== "string" || shot.length === 0) return issue;
        const key = evidenceKey(tabId, "i", issue.id);
        if (!seen.has(key)) {
          seen.add(key);
          shots.push({ key, kind: "i", id: issue.id, dataUrl: shot });
        }
        const { screenshot: _dropped, ...rest } = issue.evidence ?? {};
        return { ...issue, evidence: rest };
      })
    : r.issues;

  return { stripped: { ...r, issues }, shots };
}

/** Re-attach stored screenshots to a result read back from storage (mutates `result`, which is our own copy). */
async function attachScreenshots(tabId: number, result: ScanResult): Promise<void> {
  let index: EvidenceIndex;
  try {
    index = await loadEvidenceIndex();
  } catch {
    return;
  }
  const wanted = Object.entries(index.entries).filter(([, e]) => e.tabId === tabId && e.scanId === result.scanId);
  if (wanted.length === 0) return;

  let items: Record<string, unknown>;
  try {
    items = await sessionGetMany(wanted.map(([key]) => key));
  } catch {
    return;
  }

  const issueShots = new Map<string, string>();
  for (const [key, entry] of wanted) {
    const value = items[key];
    if (typeof value !== "string" || value.length === 0 || entry.kind !== "i") continue;
    issueShots.set(entry.id, value);
  }

  if (issueShots.size > 0 && Array.isArray(result.issues)) {
    for (const issue of result.issues) {
      const shot = issueShots.get(issue.id);
      if (shot) issue.evidence = { ...(issue.evidence ?? {}), screenshot: shot };
    }
  }
}

export async function getLastResult(tabId: number): Promise<ScanResult | undefined> {
  const stored = await sessionGet<unknown>(STORAGE_KEYS.lastResult(tabId));
  if (!isPlainObject(stored) || typeof stored.scanId !== "string" || !Array.isArray(stored.issues)) return undefined;
  const result = stored as unknown as ScanResult;
  await attachScreenshots(tabId, result);
  return result;
}

export async function setLastResult(tabId: number, r: ScanResult): Promise<void> {
  const { stripped, shots } = stripScreenshots(tabId, r);
  const resultKey = STORAGE_KEYS.lastResult(tabId);

  await withEvidenceLock(async () => {
    const index = await loadEvidenceIndex();
    let indexDirty = false;

    // 1. The result itself must always be written. If even the screenshot-free
    //    blob does not fit, free the evidence area and retry once.
    try {
      await sessionSet(resultKey, stripped);
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      const evicted = await evictAllEvidence(index);
      if (evicted > 0) {
        indexDirty = true;
        await saveEvidenceIndex(index).catch(() => undefined);
      }
      try {
        await sessionSet(resultKey, stripped);
      } catch (e2) {
        if (!isQuotaError(e2)) throw e2;
        throw new Error(
          `Extension session storage is full: could not save the scan result for tab ${tabId} ` +
            `(${evicted} screenshot(s) were discarded to make room). Close other scanned tabs and retry.`,
        );
      }
    }

    // 2. Screenshots of a previous scan in this tab are stale: drop them.
    const stale = evidenceKeysForTab(index, tabId, stripped.scanId);
    if (stale.length > 0) {
      for (const key of stale) delete index.entries[key];
      await sessionRemove(stale).catch(() => undefined);
      indexDirty = true;
    }

    // 3. Store new / changed screenshots under the byte budget.
    const protectedKeys = new Set<string>();
    const dropped: string[] = [];
    let evictedCount = 0;

    for (const shot of shots) {
      const hash = sampleHash(shot.dataUrl);
      const existing = index.entries[shot.key];
      if (existing && existing.scanId === stripped.scanId && existing.hash === hash && existing.bytes > 0) {
        protectedKeys.add(shot.key);
        continue; // unchanged, already stored
      }

      const bytes = estimateBytes(shot.key, shot.dataUrl);
      if (bytes > EVIDENCE_MAX_ITEM_BYTES) {
        dropped.push(shot.id);
        continue;
      }

      // Replacing an entry frees its bytes first.
      if (existing) {
        delete index.entries[shot.key];
        indexDirty = true;
      }

      // Make room by evicting least-recently-stored screenshots (never ones from this batch).
      while (evidenceBytes(index) + bytes > EVIDENCE_BUDGET_BYTES) {
        if (!(await evictOldestEvidence(index, protectedKeys))) break;
        evictedCount++;
        indexDirty = true;
      }
      if (evidenceBytes(index) + bytes > EVIDENCE_BUDGET_BYTES) {
        dropped.push(shot.id);
        continue;
      }

      // Write, retrying on quota errors by evicting more.
      let written = false;
      for (;;) {
        try {
          await sessionSet(shot.key, shot.dataUrl);
          written = true;
          break;
        } catch (e) {
          if (!isQuotaError(e)) throw e;
          if (!(await evictOldestEvidence(index, protectedKeys))) break;
          evictedCount++;
          indexDirty = true;
        }
      }
      if (!written) {
        dropped.push(shot.id);
        continue;
      }

      index.seq += 1;
      index.entries[shot.key] = {
        tabId,
        scanId: stripped.scanId,
        kind: shot.kind,
        id: shot.id,
        bytes,
        hash,
        seq: index.seq,
      };
      protectedKeys.add(shot.key);
      indexDirty = true;
    }

    if (indexDirty) await saveEvidenceIndex(index);

    if (evictedCount > 0 || dropped.length > 0) {
      const parts: string[] = [];
      if (evictedCount > 0) parts.push(`evicted ${evictedCount} older screenshot(s)`);
      if (dropped.length > 0) parts.push(`could not store ${dropped.length} screenshot(s): ${dropped.join(", ")}`);
      console.warn(
        `[a11y-checker] evidence storage full (budget ${Math.round(EVIDENCE_BUDGET_BYTES / 1024 / 1024)} MB): ${parts.join("; ")}. ` +
          "Export the report or close other scanned tabs to free space.",
      );
    }
  });
}

const scanOptionsKey = (tabId: number): string => `scanOptions:${tabId}`;

/** Options of the tab's last scan; kept in session storage so they survive service-worker suspension. */
export async function getScanOptions<T>(tabId: number): Promise<T | undefined> {
  const v = await sessionGet<unknown>(scanOptionsKey(tabId));
  return isPlainObject(v) ? (v as unknown as T) : undefined;
}

export function setScanOptions(tabId: number, options: unknown): Promise<void> {
  return sessionSet(scanOptionsKey(tabId), options);
}

export function clearScanOptions(tabId: number): Promise<void> {
  return sessionRemove(scanOptionsKey(tabId));
}

/**
 * Drop the stored scan result, evidence and scan options of every tab (session storage only:
 * saved scans, baselines and settings are untouched). Returns the tab ids that had data.
 */
export async function clearAllTabData(): Promise<number[]> {
  const items = await new Promise<Record<string, unknown>>((resolve, reject) => {
    try {
      sessionArea().get(null, (all) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve((all ?? {}) as Record<string, unknown>);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
  const tabIds = new Set<number>();
  for (const key of Object.keys(items)) {
    const m = /^(?:lastResult|scanOptions):(\d+)$/.exec(key);
    if (m) tabIds.add(Number(m[1]));
  }
  for (const tabId of tabIds) {
    await clearLastResult(tabId).catch(() => undefined);
    await clearScanOptions(tabId).catch(() => undefined);
  }
  return [...tabIds];
}

export async function clearLastResult(tabId: number): Promise<void> {
  await sessionRemove(STORAGE_KEYS.lastResult(tabId));
  await withEvidenceLock(async () => {
    const index = await loadEvidenceIndex();
    const keys = evidenceKeysForTab(index, tabId);
    if (keys.length === 0) return;
    for (const key of keys) delete index.entries[key];
    await sessionRemove(keys).catch(() => undefined);
    await saveEvidenceIndex(index);
  });
}

// ---------------------------------------------------------------------------
// Saved scans (chrome.storage.local, newest first, capped at SAVED_SCAN_LIMIT)
//
// The index holds only metadata so listing never loads full results; each
// result (screenshots included) lives under its own `savedScan:<id>` key.
// ---------------------------------------------------------------------------

function localRemove(key: string | string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.remove(key, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function isSavedScanMeta(value: unknown): value is SavedScanMeta {
  return isPlainObject(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.savedAt === "string";
}

export async function listSavedScans(): Promise<SavedScanMeta[]> {
  const stored = await localGet<unknown>(STORAGE_KEYS.savedScanIndex);
  return Array.isArray(stored) ? stored.filter(isSavedScanMeta) : [];
}

export async function getSavedScan(id: string): Promise<SavedScan | undefined> {
  const index = await listSavedScans();
  const meta = index.find((m) => m.id === id);
  if (!meta) return undefined;
  const result = await localGet<unknown>(STORAGE_KEYS.savedScan(id));
  if (!isPlainObject(result) || !Array.isArray(result.issues)) return undefined;
  return { meta, result: result as unknown as ScanResult };
}

/** Store a named copy of a result. Returns the metadata; the oldest saves beyond the limit are dropped. */
export async function saveScan(name: string, result: ScanResult): Promise<SavedScanMeta> {
  const savedAt = new Date().toISOString();
  const id = `saved_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const meta: SavedScanMeta = {
    id,
    name: name.trim() || result.title || result.url,
    url: result.url,
    title: result.title,
    timestamp: result.timestamp,
    savedAt,
    score: result.score,
    summary: result.summary,
    wcagLevel: result.wcagLevel,
    wcagVersion: result.wcagVersion ?? "2.2",
    scope: result.scope,
    issueCount: result.issues.length,
  };
  await localSet(STORAGE_KEYS.savedScan(id), result);
  let dropped: SavedScanMeta[] = [];
  try {
    await withKeyLock(STORAGE_KEYS.savedScanIndex, async () => {
      const index = [meta, ...(await listSavedScans())];
      dropped = index.splice(SAVED_SCAN_LIMIT);
      await localSet(STORAGE_KEYS.savedScanIndex, index);
    });
  } catch (e) {
    await localRemove(STORAGE_KEYS.savedScan(id)).catch(() => undefined);
    throw e;
  }
  if (dropped.length) await localRemove(dropped.map((m) => STORAGE_KEYS.savedScan(m.id)));
  return meta;
}

export function renameSavedScan(id: string, name: string): Promise<SavedScanMeta> {
  return withKeyLock(STORAGE_KEYS.savedScanIndex, async () => {
    const index = await listSavedScans();
    const meta = index.find((m) => m.id === id);
    if (!meta) throw new Error("That saved scan no longer exists.");
    meta.name = name.trim() || meta.name;
    await localSet(STORAGE_KEYS.savedScanIndex, index);
    return meta;
  });
}

export async function deleteSavedScan(id: string): Promise<void> {
  await withKeyLock(STORAGE_KEYS.savedScanIndex, async () => {
    const index = await listSavedScans();
    await localSet(
      STORAGE_KEYS.savedScanIndex,
      index.filter((m) => m.id !== id),
    );
  });
  await localRemove(STORAGE_KEYS.savedScan(id));
}
