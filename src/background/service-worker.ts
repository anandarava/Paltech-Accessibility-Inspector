/**
 * MV3 service worker: message router and orchestrator.
 *
 * Only place that calls chrome.scripting, chrome.tabs.captureVisibleTab, chrome.downloads
 * and chrome.offscreen.
 *
 * Every UI -> SW request resolves to a `Response<T>` envelope; broadcast events are
 * sent with chrome.runtime.sendMessage and carry `tabId`. Content-script originated
 * events arrive without a tabId and are re-broadcast with `sender.tab.id` filled in.
 */
import type {
  BaselineEntry,
  Issue,
  IssueStatus,
  KeyboardTestResult,
  RuleConfig,
  RuleDefinition,
  RulesFile,
  ScanResult,
  Settings,
  Severity,
} from "@shared/types";
import type { Message, MessageOf, Response, ScanOptions } from "@shared/messages";
import { isMessage, sendToTab } from "@shared/messages";
import { computeScore, isNotConformant, summarize } from "@shared/scoring";
import { wcagDocsUrl } from "@shared/wcag-map";
import { PANEL_PORT_PREFIX } from "@shared/constants";
import rulesJson from "@shared/a11y-rules.json";
import type { FrameScanOutput } from "@src/content/scanner";
import { fingerprint } from "@src/content/fingerprint";
import { buildReport, type ReportMeta } from "@src/background/exporters/index";
import { ensureContentScript } from "./injector";
import {
  addBaseline,
  addIgnored,
  clearLastResult,
  getBaseline,
  getIgnored,
  getLastResult,
  getRuleConfig,
  getSettings,
  removeBaseline,
  removeIgnored,
  setLastResult,
} from "./storage";
import { downloadText } from "./offscreen-client";
import { captureIssueEvidence } from "./evidence";
import { deleteSavedScan, getSavedScan, listSavedScans, renameSavedScan, saveScan } from "./storage";

const RULES_FILE = rulesJson as RulesFile;
const FRAME_SCAN_TIMEOUT_MS = 120_000;
const KEEPALIVE_INTERVAL_MS = 20_000;
const BASELINE_AUTHOR = "tester";
const SCANNABLE_URL_RE = /^(https?|file):/i;
const UNSUPPORTED_PAGE_ERROR = "Only http(s) and file pages can be scanned.";
const NO_ACCESS_ERROR =
  "PalTech A11y Inspector has no access to this tab. Click the PalTech A11y Inspector toolbar icon on this tab to grant access, " +
  "or allow site access for the extension in chrome://extensions.";

/** Broadcast event types the content script may emit without a tabId. */
const CS_EVENT_TYPES: ReadonlySet<string> = new Set([
  "SCAN_PROGRESS",
  "SCAN_ERROR",
  "PAGE_CHANGED",
  "ISSUE_CLICKED",
  "KEYBOARD_TEST_PROGRESS",
  "KEYBOARD_TEST_RESULT",
  "PICKER_RESULT",
]);

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback());
      },
    );
  });
}

/** Fire-and-forget broadcast to extension pages (side panel, devtools, options). */
function broadcast(msg: Message): void {
  try {
    chrome.runtime.sendMessage(msg, () => {
      // Swallow "Receiving end does not exist" when no UI page is open.
      void chrome.runtime.lastError;
    });
  } catch {
    // ignore
  }
}

/** Keep the service worker alive during long operations (scan, keyboard test). */
function keepAlive(): () => void {
  const timer = setInterval(() => {
    void chrome.runtime.getPlatformInfo().catch(() => undefined);
  }, KEEPALIVE_INTERVAL_MS);
  return () => clearInterval(timer);
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function browserLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const match = /Chrome\/(\d+)/.exec(ua);
  let os = "Unknown OS";
  if (/Windows NT 10/.test(ua)) os = "Windows";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(ua)) os = "Linux";
  return `Chrome ${match ? match[1] : "?"} / ${os}`;
}

function makeScanId(date: Date): string {
  return `scan_${date.toISOString().replace(/[:.]/g, "-")}`;
}

function ruleDefinition(id: string): RuleDefinition | undefined {
  return RULES_FILE.rules.find((r) => r.id === id);
}

function isRuleEnabled(id: string, ruleConfig: RuleConfig, options: ScanOptions, settings: Settings): boolean {
  const def = ruleDefinition(id);
  if (!def || !def.enabled) return false;
  if (ruleConfig.disabled.includes(id)) return false;
  if (options.rules.length > 0 && !options.rules.includes(id)) return false;
  if (settings.enabledCategories.length > 0 && !settings.enabledCategories.includes(def.category)) return false;
  return true;
}

function recompute(result: ScanResult): ScanResult {
  result.score = computeScore(result.issues, result.passedRules, result.passedRuleSeverity);
  result.summary = summarize(result.issues, result.passedRules);
  result.notConformant = isNotConformant(result.issues);
  return result;
}

function isIssue(v: unknown): v is Issue {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.ruleId === "string" && typeof o.fingerprint === "string";
}

function isFrameScanOutput(v: unknown): v is FrameScanOutput {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.issues);
}

/** Build a synthetic issue emitted by the service worker (KBD-02 trap). */
function syntheticIssue(
  ruleId: string,
  overrides: Partial<Issue> & { element: Issue["element"]; description: string; fix: Issue["fix"] },
  id: string,
): Issue {
  const def = ruleDefinition(ruleId);
  const wcag = def?.wcag ?? { criterion: "", name: "Best practice", level: "BP" as const };
  const snippet = overrides.element.html.slice(0, 40);
  return {
    id,
    ruleId,
    source: "custom",
    title: def?.check ?? ruleId,
    wcag,
    type: def?.type ?? "Auto",
    severity: def?.severity ?? "Moderate",
    category: def?.category ?? "Other",
    fingerprint: fingerprint(ruleId, overrides.element.selector, snippet),
    status: "new",
    ...overrides,
    description: overrides.description,
    element: overrides.element,
    fix: {
      ...overrides.fix,
      docsUrl: overrides.fix.docsUrl ?? def?.docsUrl ?? (wcag.criterion ? wcagDocsUrl(wcag.criterion) : undefined),
    },
  };
}

// ---------------------------------------------------------------------------
// Per-tab runtime state (in-memory; the SW may be restarted, so nothing critical)
// ---------------------------------------------------------------------------

const scansInProgress = new Map<number, Promise<ScanResult>>();
const lastScanOptions = new Map<number, ScanOptions>();

function defaultScanOptions(settings: Settings): ScanOptions {
  return {
    scope: "page",
    wcagLevel: settings.wcagLevel,
    wcagVersion: settings.wcagVersion,
    rules: [],
    includeBestPractices: settings.includeBestPractices,
    axeOnly: settings.axeOnly,
  };
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

async function scanFrame(tabId: number, frameId: number, options: ScanOptions): Promise<Response<FrameScanOutput>> {
  const msg: Message = { type: "SCAN_START", tabId, options };
  return withTimeout(sendToTab<FrameScanOutput>(tabId, msg, frameId), FRAME_SCAN_TIMEOUT_MS, () => ({
    ok: false,
    error: "Frame scan timed out.",
  }));
}

function applyKnownStatuses(
  issues: Issue[],
  baseline: BaselineEntry[],
  ignored: BaselineEntry[],
  previous: ScanResult | undefined,
): void {
  const baselineMap = new Map(baseline.map((e) => [e.fingerprint, e] as const));
  const ignoredMap = new Map(ignored.map((e) => [e.fingerprint, e] as const));
  const previousByFp = new Map<string, Issue>();
  if (previous) for (const i of previous.issues) previousByFp.set(i.fingerprint, i);

  for (const issue of issues) {
    const prev = previousByFp.get(issue.fingerprint);
    // Carry over evidence from the previous scan of this tab.
    if (prev?.evidence?.screenshot && !issue.evidence?.screenshot) issue.evidence = prev.evidence;

    const ig = ignoredMap.get(issue.fingerprint);
    const bl = baselineMap.get(issue.fingerprint);
    if (ig) {
      issue.status = "ignored";
      issue.reason = ig.reason;
    } else if (bl) {
      issue.status = "baselined";
      issue.reason = bl.reason;
    } else {
      issue.status = "new";
    }
  }
}

async function performScan(tabId: number, requested: ScanOptions | undefined): Promise<ScanResult> {
  const stopKeepAlive = keepAlive();
  const startedAt = Date.now();
  try {
    const tab = await chrome.tabs.get(tabId);
    // The manifest has no `tabs` permission: `tab.url`/`tab.title` are only populated
    // when the extension has host access to the tab (activeTab grant or an optional
    // host permission). An empty url therefore means "no access", not "not a web page".
    let url = tab.url ?? tab.pendingUrl ?? "";
    let title = tab.title ?? "";
    if (url && !SCANNABLE_URL_RE.test(url)) throw new Error(UNSUPPORTED_PAGE_ERROR);

    broadcast({ type: "SCAN_PROGRESS", tabId, percent: 0, stage: "Preparing page" });
    let injection: Awaited<ReturnType<typeof ensureContentScript>>;
    try {
      injection = await ensureContentScript(tabId);
    } catch (e) {
      if (!url) throw new Error(`${NO_ACCESS_ERROR} (${describeError(e)})`);
      throw e;
    }

    // Host access exists but the Tab object did not carry the url/title: ask the
    // top-frame content script (CS_PING answers with location.href and document.title).
    if (!url || !title) {
      const ping = await sendToTab<{ url?: unknown; title?: unknown }>(tabId, { type: "CS_PING" }, 0);
      if (ping.ok && ping.data) {
        if (!url && typeof ping.data.url === "string") url = ping.data.url;
        if (!title && typeof ping.data.title === "string") title = ping.data.title;
      }
    }
    if (!url) throw new Error(NO_ACCESS_ERROR);
    if (!SCANNABLE_URL_RE.test(url)) throw new Error(UNSUPPORTED_PAGE_ERROR);
    const origin = originOf(url);

    const [settings, ruleConfig, baseline, ignored, previous] = await Promise.all([
      getSettings(),
      getRuleConfig(),
      getBaseline(origin),
      getIgnored(origin),
      getLastResult(tabId),
    ]);

    const options: ScanOptions = {
      ...defaultScanOptions(settings),
      ...(requested ?? {}),
      rules: Array.isArray(requested?.rules) ? requested.rules : [],
    };
    lastScanOptions.set(tabId, options);

    // Push the current overlay colours before the CS draws anything.
    void sendToTab(tabId, settingsChangedMessage(settings), 0);

    // Scan each frame that has the content script (top frame first).
    const frameIds = [...injection.frameIds].sort((a, b) => a - b);
    const issues: Issue[] = [];
    const passedRules = new Set<string>();
    const passedRuleSeverity: Record<string, Severity> = {};
    // A rule is "not applicable" only if it found nothing to test in every scanned frame.
    const inapplicableByFrame: Array<Set<string>> = [];
    const unscannedFrames: string[] = [];
    const seenIds = new Set<string>();
    // Same fingerprint = same finding (baseline/ignore key on it). Drop repeats coming
    // from other frames (e.g. a same-document about:blank child) or the reflow pass.
    const seenFingerprints = new Set<string>();
    const pushIssue = (issue: Issue, idSuffix: string): void => {
      // Only definite findings are reported; undeterminable ("Semi") ones are dropped.
      if (issue.type === "Semi") return;
      if (seenFingerprints.has(issue.fingerprint)) return;
      if (seenIds.has(issue.id)) issue.id = `${issue.id}${idSuffix}`;
      seenIds.add(issue.id);
      seenFingerprints.add(issue.fingerprint);
      issues.push(issue);
    };

    for (let idx = 0; idx < frameIds.length; idx++) {
      const frameId = frameIds[idx];
      broadcast({
        type: "SCAN_PROGRESS",
        tabId,
        percent: Math.round((idx / Math.max(1, frameIds.length)) * 80),
        stage: frameId === 0 ? "Scanning page" : `Scanning frame ${idx} of ${frameIds.length - 1}`,
      });
      const res = await scanFrame(tabId, frameId, options);
      if (!res.ok || !isFrameScanOutput(res.data)) {
        const label = frameId === 0 ? "top frame" : `frame ${frameId}`;
        unscannedFrames.push(`${label}: ${res.error ?? "no result"}`);
        if (frameId === 0) throw new Error(res.error ?? "The page scan returned no result.");
        continue;
      }
      const out = res.data;
      for (const issue of out.issues) {
        if (!isIssue(issue)) continue;
        pushIssue(issue, `@f${frameId}`);
      }
      for (const r of out.passedRules ?? []) passedRules.add(r);
      Object.assign(passedRuleSeverity, out.passedRuleSeverity ?? {});
      inapplicableByFrame.push(new Set(Array.isArray(out.inapplicableRules) ? out.inapplicableRules : []));
      const extraUnscanned = (out as unknown as { unscannedFrames?: unknown; unscanned?: unknown });
      for (const u of [extraUnscanned.unscannedFrames, extraUnscanned.unscanned]) {
        if (Array.isArray(u)) for (const f of u) if (typeof f === "string") unscannedFrames.push(f);
      }
    }

    broadcast({ type: "SCAN_PROGRESS", tabId, percent: 92, stage: "Applying baseline" });
    applyKnownStatuses(issues, baseline, ignored, previous);

    const now = new Date();
    const result: ScanResult = {
      scanId: makeScanId(now),
      url,
      origin,
      title,
      timestamp: now.toISOString(),
      environment: settings.environment || undefined,
      browser: browserLabel(),
      viewport: { width: tab.width ?? 0, height: tab.height ?? 0 },
      wcagLevel: options.wcagLevel,
      wcagVersion: options.wcagVersion ?? "2.2",
      scope: options.scope === "selector" && options.selector ? { kind: "selector", selector: options.selector } : { kind: "page" },
      axeOnly: options.axeOnly === true,
      durationMs: Date.now() - startedAt,
      score: 0,
      notConformant: false,
      summary: { critical: 0, serious: 0, moderate: 0, minor: 0, bestPractice: 0, passed: 0 },
      issues,
      passedRules: [...passedRules],
      passedRuleSeverity,
      inapplicableRules: [...(inapplicableByFrame[0] ?? [])]
        .filter((r) => inapplicableByFrame.every((set) => set.has(r)))
        .filter((r) => !passedRules.has(r) && !issues.some((i) => i.data?.axeRuleId === r))
        .sort(),
      unscannedFrames,
    };
    recompute(result);

    await setLastResult(tabId, result);

    // Give the top frame the merged result so the overlay can draw all issues.
    void sendToTab(tabId, { type: "SCAN_RESULT", tabId, result }, 0);
    broadcast({ type: "SCAN_PROGRESS", tabId, percent: 100, stage: "Done" });
    broadcast({ type: "SCAN_RESULT", tabId, result });
    return result;
  } catch (e) {
    broadcast({ type: "SCAN_ERROR", tabId, error: describeError(e) });
    throw e;
  } finally {
    stopKeepAlive();
  }
}

function startScan(tabId: number, options: ScanOptions | undefined): Promise<ScanResult> {
  const existing = scansInProgress.get(tabId);
  if (existing) return Promise.reject(new Error("A scan is already in progress for this tab."));
  const p = performScan(tabId, options).finally(() => {
    if (scansInProgress.get(tabId) === p) scansInProgress.delete(tabId);
  });
  scansInProgress.set(tabId, p);
  return p;
}

async function maybeAutoRescan(tabId: number): Promise<void> {
  if (scansInProgress.has(tabId)) return;
  const [settings, last] = await Promise.all([getSettings(), getLastResult(tabId)]);
  if (!settings.autoRescan || !last) return;
  // Without host access (e.g. activeTab revoked by a cross-origin navigation) the
  // Tab object carries no url and the rescan cannot succeed; skip it quietly rather
  // than raising a spurious SCAN_ERROR. The user can rescan explicitly.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!(tab.url ?? tab.pendingUrl)) return;
  } catch {
    return;
  }
  const options = lastScanOptions.get(tabId) ?? {
    ...defaultScanOptions(settings),
    wcagLevel: last.wcagLevel,
  };
  await startScan(tabId, options).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Result mutation helpers (status changes, evidence)
// ---------------------------------------------------------------------------

async function requireLastResult(tabId: number): Promise<ScanResult> {
  const result = await getLastResult(tabId);
  if (!result) throw new Error("No scan result for this tab. Run a scan first.");
  return result;
}

async function pushStatusToContentScript(tabId: number, issue: Issue): Promise<void> {
  await sendToTab(tabId, { type: "CS_SET_ISSUE_STATUS", tabId, issueId: issue.id, status: issue.status, reason: issue.reason }, 0);
}

function entriesFor(issues: Issue[], reason: string): BaselineEntry[] {
  const createdAt = new Date().toISOString();
  return issues.map((i) => ({
    fingerprint: i.fingerprint,
    ruleId: i.ruleId,
    selector: i.element.selector,
    reason,
    author: BASELINE_AUTHOR,
    createdAt,
  }));
}

/**
 * Changes to a tab's stored result are read-modify-write. Two of them at once
 * (e.g. Ignore and Add to baseline, or a screenshot finishing while an issue is
 * ignored) would each write back their own copy and lose the other's change,
 * so every such change for a tab runs after the previous one has finished.
 */
const resultLocks = new Map<number, Promise<unknown>>();

function withResultLock<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  const previous = resultLocks.get(tabId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const settled = run.catch(() => undefined);
  resultLocks.set(tabId, settled);
  void settled.then(() => {
    if (resultLocks.get(tabId) === settled) resultLocks.delete(tabId);
  });
  return run;
}

function markIssues(
  tabId: number,
  issueIds: string[],
  status: IssueStatus,
  reason: string,
  persist: (origin: string, entries: BaselineEntry[]) => Promise<void>,
): Promise<ScanResult> {
  return withResultLock(tabId, () => markIssuesNow(tabId, issueIds, status, reason, persist));
}

async function markIssuesNow(
  tabId: number,
  issueIds: string[],
  status: IssueStatus,
  reason: string,
  persist: (origin: string, entries: BaselineEntry[]) => Promise<void>,
): Promise<ScanResult> {
  const result = await requireLastResult(tabId);
  const wanted = new Set(issueIds);
  const targets = result.issues.filter((i) => wanted.has(i.id));
  if (targets.length === 0) throw new Error("None of the selected issues exist in the current result.");
  await persist(result.origin, entriesFor(targets, reason));
  for (const issue of targets) {
    issue.status = status;
    issue.reason = reason;
  }
  recompute(result);
  await setLastResult(tabId, result);
  await Promise.all(targets.map((i) => pushStatusToContentScript(tabId, i)));
  // No SCAN_RESULT broadcast here: the UI applies the status locally and the
  // panel treats SCAN_RESULT as a finished scan (toast). The updated result is returned.
  return result;
}

/** After BASELINE_REMOVE / IGNORE_REMOVE: reset matching issues in every open tab of that origin. */
async function unmarkIssues(origin: string, fingerprints: string[], fromStatus: IssueStatus): Promise<void> {
  const fps = new Set(fingerprints);
  const normalizedOrigin = originOf(origin);
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      const tabId = tab.id;
      await withResultLock(tabId, async () => {
      const result = await getLastResult(tabId);
      if (!result || originOf(result.origin) !== normalizedOrigin) return;
      const changed: Issue[] = [];
      for (const issue of result.issues) {
        if (issue.status === fromStatus && fps.has(issue.fingerprint)) {
          issue.status = "new";
          issue.reason = undefined;
          changed.push(issue);
        }
      }
      if (changed.length === 0) return;
      recompute(result);
      await setLastResult(tabId, result);
      await Promise.all(changed.map((i) => pushStatusToContentScript(tabId, i)));
      broadcast({ type: "SCAN_RESULT", tabId, result });
      });
    }),
  );
}

/** Attach captured screenshots to the latest stored result (capture takes seconds; other changes may land meanwhile). */
function storeEvidence(tabId: number, screenshots: Record<string, string>): Promise<void> {
  return withResultLock(tabId, async () => {
    const result = await getLastResult(tabId);
    if (!result) return;
    const capturedAt = new Date().toISOString();
    for (const issue of result.issues) {
      const shot = screenshots[issue.id];
      if (shot) issue.evidence = { screenshot: shot, capturedAt };
    }
    await setLastResult(tabId, result);
  });
}

function settingsChangedMessage(settings: Settings): Message {
  // SETTINGS_CHANGED carries no payload in the contract; the CS reads the overlay
  // colours from the extra `settings` field when present.
  const msg = { type: "SETTINGS_CHANGED" as const, settings };
  return msg as unknown as Message;
}

async function pushSettingsToTabs(settings: Settings): Promise<void> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      // Only tabs that hold a result have (or had) the content script; the CS
      // ignores the message when it is not loaded (sendToTab resolves ok:false).
      const result = await getLastResult(tab.id);
      if (!result) return;
      await sendToTab(tab.id, settingsChangedMessage(settings), 0);
    }),
  );
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

type Sender = chrome.runtime.MessageSender;

async function handleMessage(msg: Message, sender: Sender): Promise<unknown> {
  const senderTabId = sender.tab?.id;

  // Events originating in a content script: fill in the tabId and re-broadcast.
  if (senderTabId !== undefined && CS_EVENT_TYPES.has(msg.type)) {
    const withTab = { ...msg, tabId: senderTabId } as Message;
    broadcast(withTab);
    if (withTab.type === "PAGE_CHANGED") void maybeAutoRescan(senderTabId);
    if (withTab.type === "KEYBOARD_TEST_RESULT" && withTab.result?.trapDetected) {
      // Guided mode: the content script found the trap; record KBD-02 exactly like
      // (awaited so SCAN_RESULT follows the KEYBOARD_TEST_RESULT).
      try {
        await recordTrapIssue(senderTabId, withTab.result);
      } catch (e) {
        console.warn(`[a11y-checker] recording KBD-02 for tab ${senderTabId} failed: ${describeError(e)}`);
      }
    }
    return undefined;
  }

  switch (msg.type) {
    case "SCAN_START":
      return startScan(msg.tabId, msg.options);

    case "SCAN_PROGRESS":
    case "SCAN_ERROR":
    case "ISSUE_CLICKED":
    case "KEYBOARD_TEST_PROGRESS":
    case "KEYBOARD_TEST_RESULT":
    case "EVIDENCE_RESULT":
    case "EXPORT_RESULT":
      broadcast(msg);
      return undefined;

    case "SCAN_RESULT":
      // A merged result handed to us by another context: persist and re-broadcast.
      if (msg.result && typeof msg.tabId === "number") {
        await setLastResult(msg.tabId, msg.result);
        broadcast(msg);
      }
      return undefined;

    case "PAGE_CHANGED":
      broadcast(msg);
      void maybeAutoRescan(msg.tabId);
      return undefined;

    case "KEYBOARD_TEST_START":
      return handleKeyboardTestStart(msg);

    case "KEYBOARD_TEST_STOP": {
      // The content script records the test; it answers with the partial
      // KeyboardTestResult (also broadcast as KEYBOARD_TEST_RESULT).
      const res = await sendToTab(msg.tabId, msg, 0);
      return res.ok ? res.data : undefined;
    }

    case "CAPTURE_EVIDENCE": {
      const result = await requireLastResult(msg.tabId);
      const settings = await getSettings();
      const screenshots = await captureIssueEvidence(msg.tabId, result, msg.issueIds, settings);
      await storeEvidence(msg.tabId, screenshots);
      broadcast({ type: "EVIDENCE_RESULT", tabId: msg.tabId, screenshots });
      return screenshots;
    }

    case "EXPORT_REPORT":
      return handleExport(msg);

    case "BASELINE_ADD":
      return markIssues(msg.tabId, msg.issueIds, "baselined", msg.reason, addBaseline);

    case "IGNORE_ADD":
      return markIssues(msg.tabId, msg.issueIds, "ignored", msg.reason, addIgnored);

    case "BASELINE_REMOVE":
      await removeBaseline(msg.origin, msg.fingerprints);
      await unmarkIssues(msg.origin, msg.fingerprints, "baselined");
      return undefined;

    case "IGNORE_REMOVE":
      await removeIgnored(msg.origin, msg.fingerprints);
      await unmarkIssues(msg.origin, msg.fingerprints, "ignored");
      return undefined;

    case "GET_LAST_RESULT":
      return getLastResult(msg.tabId);

    case "PICKER_START":
    case "PICKER_CANCEL": {
      await ensureContentScript(msg.tabId);
      const res = await sendToTab(msg.tabId, msg, 0);
      if (!res.ok) throw new Error(res.error ?? "The content script did not respond.");
      return res.data;
    }

    case "PICKER_RESULT":
      broadcast(msg);
      return undefined;

    case "SAVED_SCANS_LIST":
      return listSavedScans();

    case "SAVED_SCAN_SAVE": {
      const result = await requireLastResult(msg.tabId);
      return saveScan(msg.name, result);
    }

    case "SAVED_SCAN_GET": {
      const saved = await getSavedScan(msg.id);
      if (!saved) throw new Error("That saved scan no longer exists.");
      return saved;
    }

    case "SAVED_SCAN_RENAME":
      return renameSavedScan(msg.id, msg.name);

    case "SAVED_SCAN_DELETE":
      await deleteSavedScan(msg.id);
      return undefined;

    case "SAVED_SCAN_EXPORT": {
      const saved = await getSavedScan(msg.id);
      if (!saved) throw new Error("That saved scan no longer exists.");
      const file = buildReport(msg.format, saved.result, await reportMeta());
      const downloadId = await downloadText(file.filename, file.mime, file.content);
      return { downloadId, filename: file.filename };
    }

    case "GET_SETTINGS":
      return getSettings();

    case "SETTINGS_CHANGED": {
      const settings = await getSettings();
      await pushSettingsToTabs(settings);
      return settings;
    }

    // UI -> CS messages that reached us by mistake: forward to the top frame.
    case "HIGHLIGHT_ISSUE":
    case "CLEAR_ISSUE_FOCUS":
    case "TOGGLE_OVERLAY":
    case "SET_COLOR_BLINDNESS":
    case "HIGHLIGHT_SELECTORS":
    case "CLEAR_HIGHLIGHTS": {
      await ensureContentScript(msg.tabId);
      const res = await sendToTab(msg.tabId, msg, 0);
      if (!res.ok) throw new Error(res.error ?? "The content script did not respond.");
      return res.data;
    }

    case "CS_PING":
      return { pong: true, context: "service-worker" };

    case "CS_GET_ACTIVE_ELEMENT":
    case "CS_FOCUS_FIRST":
    case "CS_GET_ELEMENT_BOX":
    case "CS_PREPARE_SCREENSHOT":
    case "CS_RESTORE_AFTER_SCREENSHOT":
    case "CS_SET_ISSUE_STATUS": {
      const res = await sendToTab(msg.tabId, msg, 0);
      if (!res.ok) throw new Error(res.error ?? "The content script did not respond.");
      return res.data;
    }

    case "OFFSCREEN_CROP":
    case "OFFSCREEN_BUILD_DOWNLOAD":
      // Handled by the offscreen document (filtered before dispatch as well).
      return undefined;

    default: {
      const unknown = msg as { type?: unknown };
      throw new Error(`Unknown message type: ${String(unknown.type)}`);
    }
  }
}

/**
 * Turn a detected keyboard trap into a synthetic KBD-02 issue on the tab's last
 * scan result (score, exports and baseline then all see it). Shared by
 * the keyboard test (CS KEYBOARD_TEST_RESULT).
 * Returns the number of issues added.
 */
function recordTrapIssue(tabId: number, result: KeyboardTestResult): Promise<number> {
  return withResultLock(tabId, () => recordTrapIssueNow(tabId, result));
}

async function recordTrapIssueNow(tabId: number, result: KeyboardTestResult): Promise<number> {
  const trapElements = Array.isArray(result.trapElements) ? result.trapElements.filter((s) => typeof s === "string") : [];
  if (!result.trapDetected || trapElements.length === 0) return 0;
  const last = await getLastResult(tabId);
  if (!last) return 0;
  const path = Array.isArray(result.path) ? result.path : [];

  const existing = new Set(last.issues.map((i) => i.fingerprint));
  let added = 0;
  for (const selector of trapElements) {
    const step = path.find((p) => p.selector === selector);
    const issue = syntheticIssue(
      "KBD-02",
      {
        type: "Auto",
        description:
          `Keyboard focus is trapped inside a group of ${trapElements.length} element(s) ` +
          `(${trapElements.join(", ")}). Tab, Shift+Tab and Escape do not move focus out of the group.`,
        element: {
          selector,
          xpath: "",
          html: step ? `<${step.tagName.toLowerCase() || "element"}>` : "",
          boundingBox: step?.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
        },
        fix: {
          summary:
            "Ensure focus can leave the component with Tab/Shift+Tab, or document and implement Escape to close it and return focus.",
        },
        data: { trapElements, pathLength: path.length, mode: result.mode },
      },
      `sw_kbd02_${last.issues.length + added}`,
    );
    if (existing.has(issue.fingerprint)) continue;
    existing.add(issue.fingerprint);
    last.issues.push(issue);
    added++;
  }
  if (added > 0) {
    const [baseline, ignored] = await Promise.all([getBaseline(last.origin), getIgnored(last.origin)]);
    applyKnownStatuses(last.issues, baseline, ignored, undefined);
    recompute(last);
    await setLastResult(tabId, last);
    void sendToTab(tabId, { type: "SCAN_RESULT", tabId, result: last }, 0);
    broadcast({ type: "SCAN_RESULT", tabId, result: last });
  }
  return added;
}

/**
 * The content script records focus changes while the tester presses Tab; it
 * broadcasts KEYBOARD_TEST_PROGRESS / RESULT (re-broadcast above, where a
 * detected trap is recorded as KBD-02).
 */
async function handleKeyboardTestStart(msg: MessageOf<"KEYBOARD_TEST_START">): Promise<unknown> {
  await ensureContentScript(msg.tabId);
  const res = await sendToTab(msg.tabId, { ...msg, mode: "guided" }, 0);
  if (!res.ok) throw new Error(res.error ?? "The content script could not start the keyboard test.");
  return res.data;
}

/** Most elements a "with screenshots" export captures (about 0.6 s each). */
const EXPORT_SCREENSHOT_LIMIT = 25;

let logoDataUrl: Promise<string | undefined> | undefined;

/** The extension logo as a data: URL, embedded in the HTML report header. */
function loadLogo(): Promise<string | undefined> {
  logoDataUrl ??= (async () => {
    try {
      const res = await fetch(chrome.runtime.getURL("icons/48.png"));
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return `data:image/png;base64,${btoa(binary)}`;
    } catch {
      return undefined;
    }
  })();
  return logoDataUrl;
}

async function reportMeta(): Promise<ReportMeta> {
  const settings = await getSettings();
  return { preparedBy: settings.reportPreparedBy, organisation: settings.reportOrganisation, logo: await loadLogo() };
}

/**
 * Screenshot the first open element of each failed rule that has none yet, so
 * the report shows readers what each problem looks like. The page scrolls
 * while this runs; failures are skipped rather than failing the export.
 */
async function captureReportScreenshots(tabId: number, result: ScanResult): Promise<void> {
  const seen = new Set<string>();
  const wanted: string[] = [];
  for (const issue of result.issues) {
    if (issue.status !== "new") continue;
    const key = `${issue.ruleId} ${issue.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!issue.evidence?.screenshot) wanted.push(issue.id);
    if (wanted.length >= EXPORT_SCREENSHOT_LIMIT) break;
  }
  if (wanted.length === 0) return;
  try {
    const screenshots = await captureIssueEvidence(tabId, result, wanted, await getSettings());
    await storeEvidence(tabId, screenshots);
    broadcast({ type: "EVIDENCE_RESULT", tabId, screenshots });
  } catch (e) {
    console.warn(`[a11y-checker] report screenshots skipped: ${describeError(e)}`);
  }
}

async function handleExport(msg: MessageOf<"EXPORT_REPORT">): Promise<unknown> {
  const { tabId } = msg;
  try {
    if (msg.screenshots && msg.format === "html") await captureReportScreenshots(tabId, await requireLastResult(tabId));
    const result = await requireLastResult(tabId);
    const file = buildReport(msg.format, result, await reportMeta());
    const downloadId = await downloadText(file.filename, file.mime, file.content);
    broadcast({ type: "EXPORT_RESULT", tabId, ok: true, filename: file.filename });
    return { downloadId, filename: file.filename };
  } catch (e) {
    broadcast({ type: "EXPORT_RESULT", tabId, ok: false, error: describeError(e) });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function configureSidePanel(): void {
  try {
    const sidePanel = (chrome as unknown as { sidePanel?: typeof chrome.sidePanel }).sidePanel;
    if (!sidePanel || typeof sidePanel.setPanelBehavior !== "function") return;
    void sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e: unknown) => {
      console.warn(`[a11y-checker] setPanelBehavior failed: ${describeError(e)}`);
    });
  } catch (e) {
    console.warn(`[a11y-checker] setPanelBehavior failed: ${describeError(e)}`);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanel();
});
chrome.runtime.onStartup.addListener(() => {
  configureSidePanel();
});
configureSidePanel();

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse: (r: Response) => void) => {
  if (!isMessage(raw)) {
    sendResponse({ ok: false, error: "Malformed message: missing type." });
    return false;
  }
  if (raw.type.startsWith("OFFSCREEN_")) {
    // Handled by the offscreen document; do not claim the response channel.
    return false;
  }
  handleMessage(raw, sender).then(
    (data) => {
      try {
        sendResponse(data === undefined ? { ok: true } : { ok: true, data });
      } catch {
        // channel closed
      }
    },
    (e: unknown) => {
      try {
        sendResponse({ ok: false, error: describeError(e) });
      } catch {
        // channel closed
      }
    },
  );
  return true;
});

// ---------------------------------------------------------------------------
// Panel lifetime: clear the page overlay once no panel shows the tab any more
// ---------------------------------------------------------------------------

/** Open panel ports per tab (side panel and DevTools can both show one tab). */
const panelPorts = new Map<number, number>();
/** Grace period so a reloading panel reconnects before the page is cleared. */
const PANEL_CLOSE_GRACE_MS = 500;

/** Remove everything the extension drew or changed on the page. Best effort: the page may have no content script. */
async function clearPageOverlay(tabId: number): Promise<void> {
  const messages: Message[] = [
    { type: "TOGGLE_OVERLAY", tabId, visible: false, mode: "off" },
    { type: "CLEAR_HIGHLIGHTS", tabId },
    { type: "CLEAR_ISSUE_FOCUS", tabId },
    { type: "SET_COLOR_BLINDNESS", tabId, mode: "none" },
    { type: "PICKER_CANCEL", tabId },
    { type: "KEYBOARD_TEST_STOP", tabId },
  ];
  for (const msg of messages) await sendToTab(tabId, msg, 0);
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(PANEL_PORT_PREFIX)) return;
  const tabId = Number(port.name.slice(PANEL_PORT_PREFIX.length));
  if (!Number.isInteger(tabId)) return;
  panelPorts.set(tabId, (panelPorts.get(tabId) ?? 0) + 1);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    const left = (panelPorts.get(tabId) ?? 1) - 1;
    if (left > 0) {
      panelPorts.set(tabId, left);
      return;
    }
    panelPorts.delete(tabId);
    setTimeout(() => {
      if ((panelPorts.get(tabId) ?? 0) > 0) return;
      void clearPageOverlay(tabId).catch(() => undefined);
    }, PANEL_CLOSE_GRACE_MS);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastScanOptions.delete(tabId);
  void clearLastResult(tabId).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  void (async () => {
    try {
      const last = await getLastResult(tabId);
      if (!last) return;
      broadcast({ type: "PAGE_CHANGED", tabId, reason: "route" });
      await maybeAutoRescan(tabId);
    } catch (e) {
      console.warn(`[a11y-checker] onUpdated handling failed: ${describeError(e)}`);
    }
  })();
});
