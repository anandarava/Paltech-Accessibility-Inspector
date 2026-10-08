/**
 * Monkey test: drives a page with seeded random user actions while the built
 * extension (dist/) is loaded, then reports keyboard problems, page errors and
 * accessibility issues that appeared *after* the first scan.
 *
 * Run it through the wrapper (Playwright's CLI rejects unknown flags):
 *
 *   npm run build
 *   npm run test:monkey -- --url keyboard-trap --seed 42
 *
 * See "Monkey test" in README.md for all options. The spec skips itself unless
 * MONKEY_RUN=1 (set by scripts/run-monkey.mjs), so `npm run test:e2e` is not
 * affected.
 *
 * Actions (all through Playwright, i.e. real trusted input events):
 *   click, type, key (Tab, Shift+Tab, Enter, Space, Escape, arrows), scroll,
 *   resize (down to 320px wide), hover
 *
 * Checks
 *   1. Keyboard: focus lost to <body>, focus trap (same few elements for 20+
 *      Tab presses, confirmed by trying Escape), focused element not visible.
 *   2. Page errors: console errors, uncaught exceptions / unhandled rejections,
 *      failed requests.
 *   3. Accessibility: extension scan at the start (baseline), every N actions
 *      and at the end; issues whose fingerprint is not in the baseline are "new".
 *
 * Safety: only the listed URLs are visited, main-frame navigation to another
 * origin is aborted, popups are closed, form submissions (events, submit(),
 * POST navigations) are blocked, dialogs are dismissed, and elements matching
 * delete / logout / pay / buy (etc.) are never clicked or activated.
 *
 * Exit code: the test fails (=> exit 1) on any new Critical/Serious issue, any
 * confirmed keyboard trap or any uncaught page error.
 */
import { test, expect, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Severity, ScanResult } from "@shared/types";
import type { Message, Response, ScanOptions } from "@shared/messages";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = path.resolve(ROOT, process.env.A11Y_E2E_DIST ?? "dist");
const FIXTURES = path.join(ROOT, "fixtures");
const HAS_DIST = existsSync(path.join(DIST, "manifest.json"));

// ---------------------------------------------------------------------------
// Configuration (set by scripts/run-monkey.mjs through MONKEY_CONFIG)
// ---------------------------------------------------------------------------

interface MonkeyConfig {
  /** Pages to test. Full http(s) URLs, or fixture names such as "keyboard-trap". */
  urls: string[];
  seed: number;
  maxActions: number;
  maxTimeMs: number;
  /** Extension scan every N actions. */
  scanEvery: number;
  /** Tab sweep (focus trap check) every N actions. */
  sweepEvery: number;
  /** Tab presses per sweep. */
  sweepTabs: number;
  /** Pause after each action, ms. */
  actionDelayMs: number;
  /** JSON output file (a directory-less name is placed in test-results/monkey/). */
  out?: string;
}

function loadConfig(): MonkeyConfig {
  const given = JSON.parse(process.env.MONKEY_CONFIG ?? "{}") as Partial<MonkeyConfig>;
  return {
    urls: given.urls?.length ? given.urls : ["keyboard-trap"],
    seed: given.seed ?? (Date.now() % 4294967295) + 1,
    maxActions: given.maxActions ?? 200,
    maxTimeMs: given.maxTimeMs ?? 120_000,
    scanEvery: given.scanEvery ?? 50,
    sweepEvery: given.sweepEvery ?? 50,
    sweepTabs: given.sweepTabs ?? 40,
    actionDelayMs: given.actionDelayMs ?? 50,
    out: given.out,
  };
}

const CONFIG = loadConfig();
const SCAN_OPTIONS: ScanOptions = { scope: "page", wcagLevel: "AA", rules: [], includeBestPractices: true };
const VIEWPORTS: Array<[number, number]> = [[320, 568], [360, 640], [375, 667], [768, 1024], [1024, 768], [1280, 900], [1920, 1080]];
const TAB_TRAP_WINDOW = 20; // "same few elements for 20+ Tab presses"
const TAB_TRAP_MAX_DISTINCT = 5;

// ---------------------------------------------------------------------------
// Seeded random generator (mulberry32): same seed => same choices
// ---------------------------------------------------------------------------

function createRng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
      const total = entries.reduce((n, e) => n + e[1], 0);
      let r = next() * total;
      for (const [item, weight] of entries) {
        r -= weight;
        if (r < 0) return item;
      }
      return entries[entries.length - 1][0];
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture server + extension launch helpers (copied from tests/e2e/extension.spec.ts)
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
};

function serveFixtures(req: IncomingMessage, res: ServerResponse): void {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.resolve(FIXTURES, "." + pathname);
    if (!file.startsWith(FIXTURES + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(err instanceof Error ? err.message : String(err));
  }
}

function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(serveFixtures);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Fixture server did not bind to a port"));
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

/** Copy dist/ to a temp dir and add host permissions (the toolbar click that grants activeTab cannot be automated). */
function prepareExtensionCopy(extraHostPatterns: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "a11y-monkey-ext-"));
  cpSync(DIST, dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const hosts = new Set<string>(Array.isArray(manifest.host_permissions) ? (manifest.host_permissions as string[]) : []);
  hosts.add("http://127.0.0.1/*");
  hosts.add("http://localhost/*");
  for (const h of extraHostPatterns) hosts.add(h);
  manifest.host_permissions = [...hosts];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

async function launchWithExtension(extensionDir: string): Promise<{ context: BrowserContext; userDataDir: string }> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "a11y-monkey-profile-"));
  const headed = process.env.A11Y_E2E_HEADED === "1";
  const args = [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, "--no-first-run", "--no-default-browser-check"];
  try {
    const context = await chromium.launchPersistentContext(userDataDir, { channel: "chromium", headless: !headed, args, viewport: { width: 1280, height: 900 } });
    return { context, userDataDir };
  } catch {
    const context = await chromium.launchPersistentContext(userDataDir, { headless: false, args, viewport: { width: 1280, height: 900 } });
    return { context, userDataDir };
  }
}

async function waitForServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  if (existing) return existing;
  return context.waitForEvent("serviceworker", { timeout: 30_000 });
}

/** chrome.runtime.sendMessage from the side panel page (which has chrome.* access). */
async function sendToBackground<T>(panel: Page, msg: Message): Promise<Response<T>> {
  return panel.evaluate(async (m) => {
    try {
      const response = (await chrome.runtime.sendMessage(m)) as Response<T> | undefined;
      return response ?? { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, msg);
}

/** Tab id of the page under test (the side panel harness is a tab too, so match by URL). */
async function resolveTabId(panel: Page, pageUrl: string): Promise<number> {
  const target = pageUrl.split("#")[0];
  const id = await panel.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const hit = tabs.find((t) => typeof t.id === "number" && (t.url ?? "").split("#")[0] === url) ?? tabs.find((t) => typeof t.id === "number" && t.active && (t.url ?? "").startsWith("http"));
    return hit?.id ?? -1;
  }, target);
  if (id < 0) throw new Error(`Could not resolve a tab id for ${pageUrl}`);
  return id;
}

// ---------------------------------------------------------------------------
// Page-side helpers, installed before any page script runs
// ---------------------------------------------------------------------------

interface Candidate {
  x: number;
  y: number;
  sel: string;
  label: string;
}

interface FocusSnapshot {
  sel: string;
  isBody: boolean;
  /** Position of the focused element in DOM-order tabbables, -1 if not in the list. */
  tabPos: number;
  tabCount: number;
  /** Whether the element that had focus at the previous snapshot is still in the DOM. */
  prevConnected: boolean | null;
  /** null when visible, else why not. */
  reason: string | null;
  dangerous: boolean;
  /** Focus is inside the extension's own overlay (not part of the page under test). */
  ours: boolean;
}

async function installPageHelpers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__monkey) return;

    // Never submit real forms: cancel submit events and neuter submit()/requestSubmit().
    document.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        w.__monkeyBlockedSubmits = ((w.__monkeyBlockedSubmits as number) ?? 0) + 1;
      },
      true,
    );
    HTMLFormElement.prototype.submit = function () {
      w.__monkeyBlockedSubmits = ((w.__monkeyBlockedSubmits as number) ?? 0) + 1;
    };
    HTMLFormElement.prototype.requestSubmit = HTMLFormElement.prototype.submit;

    const INTERACTIVE =
      'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[onclick],[tabindex]:not([tabindex="-1"])';
    const DANGER = /\b(delete|remove account|log ?out|sign ?out|pay|payment|buy|purchase|checkout)\b/;
    const ATTRS = ["id", "name", "class", "title", "aria-label", "alt", "value", "href", "data-testid", "placeholder"];
    const norm = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-./:?=&#]+/g, " ").toLowerCase();

    const isOurs = (el: Element) => !!el.closest("#a11y-checker-overlay-host,[data-a11y-checker]");

    /** delete/logout/pay/buy in the element's own text or attributes, or in a nearby interactive ancestor. */
    function dangerous(el: Element): boolean {
      const chain: Element[] = [el];
      let p = el.parentElement;
      for (let i = 0; p && i < 3; i++, p = p.parentElement) if (p.matches(INTERACTIVE)) chain.push(p);
      return chain.some((c) => {
        const parts: string[] = [];
        for (const a of ATTRS) {
          const v = c.getAttribute(a);
          if (v) parts.push(v);
        }
        const text = ((c as HTMLElement).innerText || c.textContent || "").trim();
        if (text && text.length <= 60) parts.push(text);
        return DANGER.test(norm(parts.join(" | ")));
      });
    }

    function cssPath(el: Element): string {
      if (el === document.body) return "body";
      if (el === document.documentElement) return "html";
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
        let part = cur.tagName.toLowerCase();
        if (cur.id && document.querySelectorAll("#" + CSS.escape(cur.id)).length === 1) {
          parts.unshift("#" + CSS.escape(cur.id));
          break;
        }
        const parent: Element | null = cur.parentElement;
        if (parent) {
          const me: Element = cur;
          const same = Array.from(parent.children).filter((c) => c.tagName === me.tagName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(me) + 1})`;
        }
        parts.unshift(part);
        cur = parent;
      }
      return parts.join(" > ");
    }

    function visibleRect(el: Element): DOMRect | null {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.pointerEvents === "none") return null;
      return r;
    }

    /** Elements Tab can reach, in DOM order. */
    function tabbables(): Element[] {
      return Array.from(document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable=true]')).filter((e) => {
        if ((e as HTMLInputElement).disabled || isOurs(e)) return false;
        const ti = e.getAttribute("tabindex");
        if (ti !== null && Number(ti) < 0) return false;
        const cs = getComputedStyle(e);
        return cs.visibility !== "hidden" && cs.display !== "none";
      });
    }

    function collect(kind: string): Candidate[] {
      const selector =
        kind === "type"
          ? 'input:not([type]),input[type=text],input[type=email],input[type=search],input[type=tel],input[type=url],input[type=password],input[type=number],textarea,[contenteditable=""],[contenteditable=true]'
          : INTERACTIVE;
      const out: Candidate[] = [];
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (isOurs(el) || (el as HTMLInputElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
        if (kind === "type" && (el as HTMLInputElement).readOnly) continue;
        if (dangerous(el)) continue;
        if (kind === "click") {
          // Form submission, file pickers, and links that leave the origin / open new tabs are off limits.
          if (el.matches("input[type=submit],input[type=image],input[type=reset],input[type=file],button[type=submit]")) continue;
          if (el.matches("button:not([type])") && (el as HTMLButtonElement).form) continue;
          const a = el.closest("a[href]") as HTMLAnchorElement | null;
          if (a && (a.origin !== location.origin || (a.target && a.target !== "_self") || /^(mailto|tel|javascript):/i.test(a.getAttribute("href") ?? ""))) continue;
        }
        const r = visibleRect(el);
        if (!r) continue;
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(hit === el || el.contains(hit))) continue; // covered by something else
        out.push({ x, y, sel: cssPath(el), label: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("name") || "").trim().slice(0, 40) });
      }
      return out;
    }

    /** Where focus is, whether it is visible, and where it was at the previous snapshot. */
    function snapshot(): FocusSnapshot {
      const last = w.__monkeyLast as Element | undefined;
      const prevConnected = last ? last.isConnected : null;
      const el = document.activeElement;
      w.__monkeyLast = el ?? undefined;
      const isBody = !el || el === document.body || el === document.documentElement;
      const snap: FocusSnapshot = { sel: isBody ? "body" : cssPath(el), isBody, tabPos: -1, tabCount: 0, prevConnected, reason: null, dangerous: false, ours: false };
      if (el && isOurs(el)) {
        snap.ours = true;
        return snap;
      }
      const list = tabbables();
      snap.tabCount = list.length;
      if (isBody || !el) return snap;
      snap.tabPos = list.indexOf(el);
      snap.dangerous = dangerous(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") snap.reason = "hidden (display:none / visibility:hidden)";
      else if (cs.opacity === "0") snap.reason = "transparent (opacity:0)";
      else if (r.width < 1 || r.height < 1) snap.reason = "zero size";
      else if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) snap.reason = "outside the viewport";
      else {
        const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
        const hit = document.elementFromPoint(cx, cy);
        if (hit && !isOurs(hit) && !el.contains(hit) && !hit.contains(el)) snap.reason = `covered by ${cssPath(hit)}`;
      }
      return snap;
    }

    /** Put the sequential-focus starting point at the top of the document. */
    function resetFocusStart(): void {
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.scrollTo(0, 0);
      const sel = getSelection();
      if (sel) {
        sel.removeAllRanges();
        const range = document.createRange();
        range.setStart(document.body, 0);
        range.collapse(true);
        sel.addRange(range);
      }
      w.__monkeyLast = undefined;
    }

    w.__monkey = {
      collect,
      snapshot,
      resetFocusStart,
      blockedSubmits: () => (w.__monkeyBlockedSubmits as number) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

interface ActionRecord {
  step: number;
  atMs: number;
  type: "click" | "type" | "key" | "scroll" | "resize" | "hover" | "tab-sweep";
  selector?: string;
  label?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  dx?: number;
  dy?: number;
  viewport?: [number, number];
  skipped?: string;
  error?: string;
}

interface NewIssue {
  ruleId: string;
  severity: Severity;
  title: string;
  selector: string;
  wcag: string;
  fingerprint: string;
  firstSeenStep: number;
  scan: string;
  url: string;
  viewport: { width: number; height: number };
}

interface PageError {
  step: number;
  message: string;
  stack?: string;
  url?: string;
}

interface TrapFinding {
  step: number;
  elements: string[];
  tabPresses: number;
  escapeTried: boolean;
  /** true when the lock was a dismissible dialog (Escape released focus): reported as info, not a failure. */
  dismissible: boolean;
}

const SEVERITY_ORDER: Severity[] = ["Critical", "Serious", "Moderate", "Minor"];

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

test.describe("Monkey test", () => {
  test.skip(process.env.MONKEY_RUN !== "1", 'Run with "npm run test:monkey" (sets MONKEY_RUN=1).');
  test.skip(!HAS_DIST, `Extension build not found at ${DIST}. Run "npm run build" first.`);

  let server: Server;
  let baseUrl: string;
  let context: BrowserContext;
  let extensionDir = "";
  let userDataDir = "";
  let panel: Page;
  const targets: string[] = [];

  test.beforeAll(async () => {
    ({ server, baseUrl } = await startServer());
    // Resolve the listed pages. Only these URLs are ever visited.
    for (const raw of CONFIG.urls) {
      if (/^https?:\/\//i.test(raw)) targets.push(raw);
      else targets.push(`${baseUrl}/${raw.replace(/^\/+/, "").replace(/(\.html?)?$/, ".html")}`);
    }
    const hostPatterns = [...new Set(targets.map((t) => `${new URL(t).origin}/*`))];
    extensionDir = prepareExtensionCopy(hostPatterns);
    ({ context, userDataDir } = await launchWithExtension(extensionDir));
    const worker = await waitForServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    panel = await context.newPage();
    // Messaging endpoint only; bound to a tab id that does not exist so it is not treated as a panel for the page under test.
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=2147483000`, { waitUntil: "load" });
  });

  test.afterAll(async () => {
    await context?.close().catch(() => undefined);
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    for (const dir of [extensionDir, userDataDir]) if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  for (const [index, rawUrl] of CONFIG.urls.entries()) {
    test(`monkey run ${index + 1}/${CONFIG.urls.length}: ${rawUrl}`, async ({}, testInfo) => {
      test.setTimeout(CONFIG.maxTimeMs + 10 * 60_000);
      const startUrl = targets[index];
      const origin = new URL(startUrl).origin;
      const rng = createRng(CONFIG.seed);
      const t0 = Date.now();

      // ---- collectors ----
      const actions: ActionRecord[] = [];
      const uncaught: PageError[] = [];
      const consoleErrors: PageError[] = [];
      const failedRequests: PageError[] = [];
      const blockedNavigations: Array<{ step: number; url: string; why: string }> = [];
      const lostFocus: Array<{ step: number; after: string; selector: string; reason: string; count: number }> = [];
      const notVisible: Array<{ step: number; selector: string; reason: string }> = [];
      const traps: TrapFinding[] = [];
      const newIssues = new Map<string, NewIssue>();
      const scans: Array<{ label: string; step: number; issues: number; newIssues: number; durationMs: number; error?: string }> = [];
      // Baseline = the first scan of each page (keyed by origin + path). "New" means: not in that page's first scan.
      const baselines = new Map<string, Set<string>>();
      let step = 0;
      let baselineScanId = "";
      let lastScanId = "";
      let prevSnap: FocusSnapshot | null = null;

      // ---- page + safety nets ----
      const page = await context.newPage();
      await installPageHelpers(page);
      const blockedUrls = new Set<string>();

      await page.route("**/*", async (route) => {
        const req = route.request();
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
          let why = "";
          try {
            const u = new URL(req.url());
            if (u.origin !== origin) why = "navigation to another origin";
            else if (req.method() !== "GET") why = `${req.method()} navigation (form submission)`;
          } catch {
            why = "unparseable URL";
          }
          if (why) {
            blockedUrls.add(req.url());
            blockedNavigations.push({ step, url: req.url(), why });
            await route.abort("blockedbyclient");
            return;
          }
        }
        await route.continue();
      });
      page.on("popup", (popup) => {
        blockedNavigations.push({ step, url: popup.url(), why: "popup closed" });
        void popup.close().catch(() => undefined);
      });
      page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
      page.on("pageerror", (err) => uncaught.push({ step, message: err.message, stack: err.stack }));
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (text.startsWith("Failed to load resource")) return; // reported via request/response events
        consoleErrors.push({ step, message: text, url: msg.location().url });
      });
      page.on("requestfailed", (req) => {
        if (blockedUrls.has(req.url()) || /\/favicon\.ico$/.test(req.url())) return;
        failedRequests.push({ step, message: `${req.method()} ${req.url()} failed: ${req.failure()?.errorText ?? "unknown"}` });
      });
      page.on("response", (res) => {
        if (res.status() >= 400 && !/\/favicon\.ico$/.test(res.url())) failedRequests.push({ step, message: `${res.request().method()} ${res.url()} -> ${res.status()}` });
      });

      // ---- helpers bound to this page ----
      const callMonkey = async <T,>(method: string): Promise<T | undefined> => {
        for (let i = 0; i < 3; i++) {
          try {
            return await page.evaluate((m) => (window as unknown as { __monkey?: Record<string, () => unknown> }).__monkey?.[m]?.() as T | undefined, method);
          } catch {
            if (page.isClosed()) return undefined;
            await page.waitForLoadState("domcontentloaded").catch(() => undefined); // navigation in flight
            await page.waitForTimeout(100);
          }
        }
        return undefined;
      };
      const collect = async (kind: string): Promise<Candidate[]> => {
        for (let i = 0; i < 3; i++) {
          try {
            return await page.evaluate((k) => ((window as unknown as { __monkey: { collect: (kind: string) => Candidate[] } }).__monkey.collect(k)), kind);
          } catch {
            if (page.isClosed()) return [];
            await page.waitForLoadState("domcontentloaded").catch(() => undefined);
            await page.waitForTimeout(100);
          }
        }
        return [];
      };

      const record = (rec: Omit<ActionRecord, "step" | "atMs">): ActionRecord => {
        const full: ActionRecord = { step, atMs: Date.now() - t0, ...rec };
        actions.push(full);
        return full;
      };

      /**
       * Wait until the page stops moving (navigation finished, scroll position stable for 3 frames), so the next
       * action sees the same layout on every run with the same seed.
       */
      async function settle(): Promise<void> {
        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
        await page
          .evaluate(
            () =>
              new Promise<void>((resolve) => {
                let last = "";
                let stable = 0;
                const started = performance.now();
                const tick = () => {
                  const pos = `${scrollX},${scrollY}`;
                  stable = pos === last ? stable + 1 : 0;
                  last = pos;
                  if (stable >= 3 || performance.now() - started > 1500) resolve();
                  else requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              }),
          )
          .catch(() => undefined);
      }

      /** Focus checks after an action. `key` is set for keyboard actions only. */
      async function observe(key: string | null): Promise<FocusSnapshot | null> {
        const snap = await callMonkey<FocusSnapshot>("snapshot");
        if (!snap) return null;
        if (snap.ours) return snap; // the extension's overlay took focus: not the page's behaviour
        // Visibility is judged after keyboard actions only: the browser scrolls focus into view for those,
        // whereas a scroll/resize/click can legitimately move the focused element away.
        if (key && !snap.isBody && snap.reason && !notVisible.some((n) => n.selector === snap.sel && n.reason === snap.reason)) {
          notVisible.push({ step, selector: snap.sel, reason: snap.reason });
        }
        if (key && prevSnap && !prevSnap.isBody && snap.isBody) {
          // Tab off the last / Shift+Tab off the first element leaves the document: normal.
          const leftDocument = (key === "Tab" && prevSnap.tabPos === prevSnap.tabCount - 1) || (key === "Shift+Tab" && prevSnap.tabPos === 0);
          if (!leftDocument) {
            const reason = snap.prevConnected === false ? "focused element was removed from the DOM" : "focus dropped to <body>";
            const existing = lostFocus.find((l) => l.selector === prevSnap!.sel && l.reason === reason);
            if (existing) existing.count++;
            else lostFocus.push({ step, after: key, selector: prevSnap.sel, reason, count: 1 });
          }
        }
        prevSnap = snap;
        return snap;
      }

      // ---- accessibility scan through the extension ----
      async function runScan(label: string): Promise<void> {
        const started = Date.now();
        try {
          await page.bringToFront();
          const tabId = await resolveTabId(panel, page.url());
          const res = await sendToBackground<ScanResult>(panel, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
          if (!res.ok) throw new Error(res.error ?? "SCAN_START rejected");
          // The result may come back directly; otherwise poll GET_LAST_RESULT for a new scan id.
          let result: ScanResult | undefined = res.data && Array.isArray(res.data.issues) ? res.data : undefined;
          const deadline = Date.now() + 90_000;
          while ((!result || result.scanId === lastScanId) && Date.now() < deadline) {
            const last = await sendToBackground<ScanResult>(panel, { type: "GET_LAST_RESULT", tabId });
            if (last.ok && last.data && Array.isArray(last.data.issues) && last.data.scanId !== lastScanId) result = last.data;
            else await panel.waitForTimeout(400);
          }
          if (!result || result.scanId === lastScanId) throw new Error("scan result did not arrive in time");
          lastScanId = result.scanId;

          const pageKey = new URL(result.url).origin + new URL(result.url).pathname;
          const baseline = baselines.get(pageKey);
          if (!baseline) {
            // First time this page is scanned: it becomes the page's baseline.
            baselines.set(pageKey, new Set(result.issues.map((i) => i.fingerprint)));
            if (!baselineScanId) baselineScanId = result.scanId;
            scans.push({ label: `${label} (baseline of ${new URL(pageKey).pathname})`, step, issues: result.issues.length, newIssues: 0, durationMs: Date.now() - started });
            return;
          }
          let fresh = 0;
          for (const issue of result.issues) {
            if (issue.status !== "new" || baseline.has(issue.fingerprint) || newIssues.has(issue.fingerprint)) continue;
            fresh++;
            newIssues.set(issue.fingerprint, {
              ruleId: issue.ruleId,
              severity: issue.severity,
              title: issue.title,
              selector: issue.element.selector,
              wcag: issue.wcag.criterion ? `${issue.wcag.criterion} ${issue.wcag.name}` : "best practice",
              fingerprint: issue.fingerprint,
              firstSeenStep: step,
              scan: label,
              url: result.url,
              viewport: result.viewport,
            });
          }
          scans.push({ label, step, issues: result.issues.length, newIssues: fresh, durationMs: Date.now() - started });
        } catch (e) {
          scans.push({ label, step, issues: 0, newIssues: 0, durationMs: Date.now() - started, error: e instanceof Error ? e.message : String(e) });
        }
      }

      // ---- keyboard trap detection ----
      /** Tab `sweepTabs` times from the top of the page; report if the tail cycles through only a few elements. */
      async function tabSweep(label: string): Promise<void> {
        for (let round = 0; round < 2; round++) {
          await callMonkey("resetFocusStart");
          prevSnap = null;
          const path: string[] = [];
          let tabCount = 0;
          for (let i = 0; i < CONFIG.sweepTabs && !page.isClosed(); i++) {
            await page.keyboard.press("Tab");
            const snap = await observe("Tab");
            if (snap?.ours) continue;
            path.push(snap?.sel ?? "?");
            tabCount = snap?.tabCount ?? tabCount;
          }
          record({ type: "tab-sweep", key: `Tab x${path.length}`, label });
          const tail = path.slice(-TAB_TRAP_WINDOW);
          const distinct = [...new Set(tail)];
          const suspect = path.length >= TAB_TRAP_WINDOW && distinct.length <= TAB_TRAP_MAX_DISTINCT && tabCount > distinct.length;
          if (!suspect) return;

          // Is it a real trap, or a dialog that releases focus on Escape?
          await page.keyboard.press("Escape");
          let escaped = false;
          for (let i = 0; i < 8 && !escaped; i++) {
            await page.keyboard.press("Tab");
            const snap = await observe("Tab");
            if (snap && !snap.ours && !snap.isBody && !distinct.includes(snap.sel)) escaped = true;
          }
          const finding: TrapFinding = { step, elements: distinct, tabPresses: path.length, escapeTried: true, dismissible: escaped };
          if (!traps.some((t) => t.elements.join("|") === finding.elements.join("|"))) traps.push(finding);
          if (!escaped) return;
          // A dismissible dialog hid the rest of the page: sweep again from the top now that it is closed.
        }
      }

      // ---- monkey actions ----
      const KEYS = ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Enter", "Space", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"] as const;
      const SNIPPETS = ["hello", "test 123", "😀 emoji", "<b>x</b>", "' OR 1=1 --", "مرحبا", "   ", "0", "-1", "a@b", "ünïcödé", "x".repeat(60)];
      const randomText = (): string => (rng.next() < 0.5 ? rng.pick(SNIPPETS) : Array.from({ length: rng.int(1, 16) }, () => String.fromCharCode(rng.int(33, 126))).join(""));

      async function randomAction(): Promise<ActionRecord> {
        const type = rng.weighted<ActionRecord["type"]>([["click", 30], ["key", 28], ["type", 12], ["scroll", 10], ["hover", 10], ["resize", 5]]);
        switch (type) {
          case "click":
          case "hover": {
            const cands = await collect("click");
            if (!cands.length) return record({ type, skipped: "no candidates" });
            const c = rng.pick(cands);
            const rec = record({ type, selector: c.sel, label: c.label, x: c.x, y: c.y });
            if (type === "click") await page.mouse.click(c.x, c.y);
            else await page.mouse.move(c.x, c.y);
            return rec;
          }
          case "type": {
            const cands = await collect("type");
            if (!cands.length) return record({ type, skipped: "no candidates" });
            const c = rng.pick(cands);
            const text = randomText();
            const rec = record({ type, selector: c.sel, x: c.x, y: c.y, text });
            await page.mouse.click(c.x, c.y);
            await page.keyboard.type(text);
            return rec;
          }
          case "key": {
            let key: string = rng.pick(KEYS);
            // Never activate a delete/logout/pay/buy control with the keyboard.
            if ((key === "Enter" || key === "Space") && (await callMonkey<FocusSnapshot>("snapshot"))?.dangerous) key = "Tab";
            const rec = record({ type, key });
            await page.keyboard.press(key === "Space" ? " " : key);
            return rec;
          }
          case "scroll": {
            const vp = page.viewportSize() ?? { width: 1280, height: 900 };
            const x = rng.int(0, vp.width - 1);
            const y = rng.int(0, vp.height - 1);
            const dy = rng.int(-700, 700);
            const dx = rng.next() < 0.2 ? rng.int(-300, 300) : 0;
            const rec = record({ type, x, y, dx, dy });
            await page.mouse.move(x, y);
            await page.mouse.wheel(dx, dy);
            return rec;
          }
          default: {
            const [width, height] = rng.pick(VIEWPORTS);
            const rec = record({ type: "resize", viewport: [width, height] });
            await page.setViewportSize({ width, height });
            return rec;
          }
        }
      }

      // =======================  run  =======================
      process.stdout.write(`\n[monkey] ${startUrl}\n[monkey] seed ${CONFIG.seed}  (replay: npm run test:monkey -- --url ${rawUrl} --seed ${CONFIG.seed})\n`);
      await page.goto(startUrl, { waitUntil: "load" });
      await runScan("start");
      await tabSweep("initial");

      let stoppedBecause = "max actions reached";
      while (step < CONFIG.maxActions) {
        if (Date.now() - t0 >= CONFIG.maxTimeMs) {
          stoppedBecause = "max time reached";
          break;
        }
        if (page.isClosed()) {
          stoppedBecause = "page closed";
          break;
        }
        step++;
        let rec: ActionRecord | undefined;
        try {
          rec = await randomAction();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (actions[actions.length - 1]?.step === step) actions[actions.length - 1].error = msg;
          else record({ type: "click", error: msg });
        }
        await page.waitForTimeout(CONFIG.actionDelayMs);
        await settle();
        await observe(rec?.type === "key" ? (rec.key ?? null) : null);
        if (step % CONFIG.sweepEvery === 0) await tabSweep(`step ${step}`);
        if (step % CONFIG.scanEvery === 0) await runScan(`step ${step}`);
      }
      await tabSweep("final");
      await runScan("final");

      const blockedSubmits = (await callMonkey<number>("blockedSubmits")) ?? 0;
      const finalUrl = page.url();
      await page.close().catch(() => undefined);

      // =======================  report  =======================
      const issues = [...newIssues.values()];
      const grouped = new Map<string, { ruleId: string; severity: Severity; count: number; title: string; selectors: string[] }>();
      for (const i of issues) {
        const key = `${i.ruleId}|${i.severity}`;
        const g = grouped.get(key) ?? { ruleId: i.ruleId, severity: i.severity, count: 0, title: i.title, selectors: [] };
        g.count++;
        if (g.selectors.length < 10) g.selectors.push(i.selector);
        grouped.set(key, g);
      }
      const groups = [...grouped.values()].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.ruleId.localeCompare(b.ruleId));
      const blockingIssues = issues.filter((i) => i.severity === "Critical" || i.severity === "Serious");
      const confirmedTraps = traps.filter((t) => !t.dismissible);

      const reasons: string[] = [];
      if (blockingIssues.length) reasons.push(`${blockingIssues.length} new Critical/Serious accessibility issue(s)`);
      if (confirmedTraps.length) reasons.push(`${confirmedTraps.length} keyboard trap(s)`);
      if (uncaught.length) reasons.push(`${uncaught.length} uncaught page error(s)`);

      const report = {
        tool: "PalTech A11y Inspector monkey test",
        seed: CONFIG.seed,
        url: startUrl,
        finalUrl,
        startedAt: new Date(t0).toISOString(),
        durationMs: Date.now() - t0,
        stoppedBecause,
        options: { maxActions: CONFIG.maxActions, maxTimeMs: CONFIG.maxTimeMs, scanEvery: CONFIG.scanEvery, sweepEvery: CONFIG.sweepEvery, sweepTabs: CONFIG.sweepTabs, actionDelayMs: CONFIG.actionDelayMs },
        actionsTaken: step,
        actions,
        baseline: { scanId: baselineScanId, pages: [...baselines].map(([page, set]) => ({ page, issues: set.size })) },
        scans,
        newIssues: issues,
        newIssuesByRule: groups,
        errors: { uncaught, console: consoleErrors, failedRequests },
        keyboard: { traps, lostFocus, focusNotVisible: notVisible },
        safety: { blockedNavigations, blockedFormSubmits: blockedSubmits },
        verdict: { failed: reasons.length > 0, reasons },
      };

      const outFile = CONFIG.out
        ? path.resolve(ROOT, CONFIG.out)
        : path.join(ROOT, "test-results", "monkey", `monkey-${new URL(startUrl).hostname}-${path.basename(new URL(startUrl).pathname, ".html") || "index"}-seed${CONFIG.seed}.json`);
      mkdirSync(path.dirname(outFile), { recursive: true });
      writeFileSync(outFile, JSON.stringify(report, null, 2));
      await testInfo.attach("monkey-report.json", { path: outFile, contentType: "application/json" });

      // ---- readable summary ----
      const L: string[] = [];
      const counts: Record<string, number> = {};
      for (const a of actions) counts[a.type] = (counts[a.type] ?? 0) + 1;
      L.push("", "================ Monkey test summary ================");
      L.push(`URL      ${startUrl}`);
      L.push(`Seed     ${CONFIG.seed}`);
      L.push(`Actions  ${step} in ${(report.durationMs / 1000).toFixed(1)}s (${stoppedBecause})  [${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}]`);
      L.push(`Scans    ${scans.length} (first-scan baseline: ${[...baselines.values()].map((b) => b.size).join(" + ")} issues; ${scans.filter((s) => s.error).length} failed)`);
      L.push("", `New accessibility issues: ${issues.length}`);
      for (const g of groups) L.push(`  [${g.severity}] ${g.ruleId} x${g.count}  ${g.title}  e.g. ${g.selectors[0]}`);
      L.push("", `Keyboard traps: ${confirmedTraps.length}${traps.length > confirmedTraps.length ? ` (+${traps.length - confirmedTraps.length} dismissible dialog)` : ""}`);
      for (const t of traps) L.push(`  ${t.dismissible ? "(dismissible) " : ""}${t.elements.join(", ")}  [found at step ${t.step}, ${t.tabPresses} Tab presses]`);
      L.push(`Focus lost to body: ${lostFocus.length}`);
      for (const l of lostFocus.slice(0, 5)) L.push(`  after ${l.after} on ${l.selector}: ${l.reason} (x${l.count})`);
      L.push(`Focused element not visible: ${notVisible.length}`);
      for (const n of notVisible.slice(0, 5)) L.push(`  ${n.selector}: ${n.reason}`);
      L.push("", `Page errors: ${uncaught.length} uncaught, ${consoleErrors.length} console errors, ${failedRequests.length} failed requests`);
      for (const e of uncaught.slice(0, 5)) L.push(`  uncaught (step ${e.step}): ${e.message.split("\n")[0]}`);
      L.push(`Blocked by safety rules: ${blockedNavigations.length} navigations/popups, ${blockedSubmits} form submits`);
      L.push("", `JSON report: ${outFile}`);
      L.push(reasons.length ? `RESULT: FAIL - ${reasons.join("; ")}` : "RESULT: PASS");
      L.push("=====================================================", "");
      process.stdout.write(L.join("\n"));

      // Exit code 1 comes from this assertion.
      expect(reasons, `Monkey test found problems (seed ${CONFIG.seed}); see ${outFile}`).toEqual([]);
    });
  }
});
