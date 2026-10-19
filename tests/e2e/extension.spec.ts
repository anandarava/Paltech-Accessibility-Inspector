/**
 * End-to-end: load the built extension (dist/) into a persistent Chromium
 * context, serve the fixture pages from a tiny node:http server, trigger a scan
 * through the service worker from the side panel page, and compare the issue
 * counts per project rule id with each fixture's `#expected` manifest.
 *
 * Prerequisite: `npm run build` (the suite skips itself when dist/ is missing).
 *
 * Because Playwright cannot click the toolbar action (which is what grants
 * `activeTab`), the test loads a *copy* of dist/ whose manifest additionally
 * declares `host_permissions` for the fixture origin (127.0.0.1). Nothing in the
 * repository is modified.
 */
import { test, expect, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Issue, KeyboardTestResult, ScanResult } from "@shared/types";
import type { Message, Response, ScanOptions } from "@shared/messages";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = path.resolve(ROOT, process.env.A11Y_E2E_DIST ?? "dist");
const FIXTURES = path.join(ROOT, "fixtures");
const HAS_DIST = existsSync(path.join(DIST, "manifest.json"));

const FIXTURE_PAGES = ["images", "forms", "keyboard-trap", "contrast", "structure", "aria", "links", "spa", "labels-aria"] as const;

type ExpectedCounts = Record<string, number>;

const SCAN_OPTIONS: ScanOptions = { scope: "page", wcagLevel: "AA", rules: [], includeBestPractices: true };

// ---------------------------------------------------------------------------
// Fixture server (node:http, no dependencies)
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
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
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

// ---------------------------------------------------------------------------
// Extension launch helpers
// ---------------------------------------------------------------------------

/** Copy dist/ to a temp dir and add host permissions for the fixture origin (plus any extra permissions). */
function prepareExtensionCopy(extraPermissions: string[] = []): string {
  const dir = mkdtempSync(path.join(tmpdir(), "a11y-checker-ext-"));
  cpSync(DIST, dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const hosts = new Set<string>(Array.isArray(manifest.host_permissions) ? (manifest.host_permissions as string[]) : []);
  hosts.add("http://127.0.0.1/*");
  hosts.add("http://localhost/*");
  manifest.host_permissions = [...hosts];
  if (extraPermissions.length) {
    const perms = new Set<string>(Array.isArray(manifest.permissions) ? (manifest.permissions as string[]) : []);
    for (const p of extraPermissions) perms.add(p);
    manifest.permissions = [...perms];
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

async function launchWithExtension(extensionDir: string): Promise<{ context: BrowserContext; userDataDir: string }> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "a11y-checker-profile-"));
  const headed = process.env.A11Y_E2E_HEADED === "1";
  const args = [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  try {
    // The "chromium" channel is the full Chromium build, which supports
    // extensions in headless mode (the default headless shell does not).
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

// ---------------------------------------------------------------------------
// Messaging helpers (run inside the side panel page, which has chrome.* access)
// ---------------------------------------------------------------------------

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

async function findTabId(panel: Page, url: string): Promise<number> {
  const id = await panel.evaluate(async (target) => {
    const byUrl = await chrome.tabs.query({ url: target + "*" });
    const hit = byUrl.find((t) => typeof t.id === "number");
    if (hit?.id !== undefined) return hit.id;
    const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return active[0]?.id ?? -1;
  }, url);
  if (id < 0) throw new Error(`Could not resolve a tab id for ${url}`);
  return id;
}

async function waitForScanResult(panel: Page, tabId: number, url: string, timeoutMs = 90_000): Promise<ScanResult> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    const res = await sendToBackground<ScanResult>(panel, { type: "GET_LAST_RESULT", tabId });
    if (res.ok && res.data && Array.isArray(res.data.issues) && res.data.url.startsWith(url.split("?")[0])) return res.data;
    if (!res.ok && res.error) lastError = res.error;
    await panel.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for the scan result of ${url}${lastError ? ` (last error: ${lastError})` : ""}`);
}

async function scanFixture(context: BrowserContext, panel: Page, url: string): Promise<{ page: Page; result: ScanResult; expected: ExpectedCounts; expectedBp: ExpectedCounts }> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  const expected = await page.evaluate(() => JSON.parse(document.getElementById("expected")?.textContent ?? "{}") as Record<string, number>);
  const expectedBp = await page.evaluate(() => JSON.parse(document.getElementById("expected-best-practice")?.textContent ?? "{}") as Record<string, number>);
  await page.bringToFront();

  const tabId = await findTabId(panel, url);
  const started = await sendToBackground(panel, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
  expect(started.ok, `SCAN_START was rejected: ${started.error ?? "unknown error"}`).toBe(true);

  const result = await waitForScanResult(panel, tabId, url);
  return { page, result, expected, expectedBp };
}

function countDefinite(issues: Issue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    if (issue.type !== "Auto") continue;
    if (issue.status !== "new") continue;
    counts[issue.ruleId] = (counts[issue.ruleId] ?? 0) + 1;
  }
  return counts;
}

function describeIssues(issues: Issue[]): string {
  return issues
    .map((i) => `  ${i.ruleId.padEnd(8)} ${i.type.padEnd(6)} ${i.severity.padEnd(8)} ${i.element.selector}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("PalTech A11y Inspector extension", () => {
  test.skip(!HAS_DIST, `Extension build not found at ${DIST}. Run "npm run build" first.`);
  // Tests share one browser context (beforeAll) but each fixture test is
  // independent, so a failing fixture does not skip the others.

  let server: Server;
  let baseUrl: string;
  let context: BrowserContext;
  let extensionDir: string;
  let userDataDir: string;
  let extensionId: string;
  let panel: Page;

  test.beforeAll(async () => {
    ({ server, baseUrl } = await startServer());
    extensionDir = prepareExtensionCopy();
    ({ context, userDataDir } = await launchWithExtension(extensionDir));
    const worker = await waitForServiceWorker(context);
    extensionId = new URL(worker.url()).host;
    panel = await context.newPage();
    // Bound to a tab that does not exist: the harness page is only a chrome.* messaging
    // endpoint and must not act as an open panel for the fixture tabs.
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=2147483000`, { waitUntil: "load" });
    // Collect broadcast events (PAGE_CHANGED etc.) for the SPA test.
    await panel.evaluate(() => {
      const w = window as unknown as { __a11yEvents: unknown[] };
      w.__a11yEvents = [];
      chrome.runtime.onMessage.addListener((message: unknown) => {
        w.__a11yEvents.push(message);
      });
    });
  });

  test.afterAll(async () => {
    await context?.close().catch(() => undefined);
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    for (const dir of [extensionDir, userDataDir]) {
      if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test("service worker is running and the side panel page loads", async () => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    await expect(panel.locator("body")).toBeVisible();
    const settings = await sendToBackground<Record<string, unknown>>(panel, { type: "GET_SETTINGS" });
    expect(settings.ok).toBe(true);
    expect(settings.data).toBeTruthy();
  });

  for (const name of FIXTURE_PAGES) {
    test(`finds the planted issues in ${name}.html`, async () => {
      const url = `${baseUrl}/${name}.html`;
      const { page, result, expected, expectedBp } = await scanFixture(context, panel, url);
      try {
        expect(Object.keys(expected).length, `${name}.html has no #expected manifest`).toBeGreaterThan(0);
        const counts = countDefinite(result.issues);
        const detail = `\nFound issues:\n${describeIssues(result.issues)}\n`;
        const all = { ...expected, ...(SCAN_OPTIONS.includeBestPractices ? expectedBp : {}) };
        const misses: string[] = [];
        for (const [ruleId, minimum] of Object.entries(all)) {
          const found = counts[ruleId] ?? 0;
          if (found < minimum) misses.push(`${ruleId}: expected >= ${minimum}, found ${found}`);
        }
        expect(misses, `Missing findings in ${name}.html:\n  ${misses.join("\n  ")}${detail}`).toEqual([]);

        // Sanity checks on the result envelope.
        expect(result.url.startsWith(url)).toBe(true);
        expect(result.wcagLevel).toBe("AA");
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        for (const issue of result.issues) {
          expect(issue.fingerprint).toMatch(/^[0-9a-f]{8}$/);
          expect(issue.element.selector.length).toBeGreaterThan(0);
          expect(issue.element.selector).not.toContain("a11y-checker-overlay-host");
        }
        // Needs-review findings are only ever "Semi"; definite findings stay "Auto".
        expect(result.issues.filter((i) => i.type !== "Auto" && i.type !== "Semi")).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }

  test("scanning does not leave the page modified", async () => {
    const url = `${baseUrl}/keyboard-trap.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const before = await page.evaluate(() => ({
      html: document.body.innerHTML,
      scroll: [window.scrollX, window.scrollY],
      styles: document.querySelectorAll("style").length,
    }));
    await page.bringToFront();
    const tabId = await findTabId(panel, url);
    await sendToBackground(panel, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
    await waitForScanResult(panel, tabId, url);
    // Hide the overlay so its host (outside body's original content) does not count.
    await sendToBackground(panel, { type: "TOGGLE_OVERLAY", tabId, visible: false, mode: "off" });
    const after = await page.evaluate((hostId) => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(`#${hostId}, [data-a11y-checker]`).forEach((n) => n.remove());
      return {
        html: clone.innerHTML,
        scroll: [window.scrollX, window.scrollY],
        styles: Array.from(document.querySelectorAll("style")).filter((s) => !s.hasAttribute("data-a11y-checker")).length,
        activeIsBody: document.activeElement === document.body || document.activeElement === null,
      };
    }, "a11y-checker-overlay-host");
    await page.close();
    expect(after.scroll).toEqual(before.scroll);
    expect(after.styles).toBe(before.styles);
    expect(after.activeIsBody).toBe(true);
    expect(after.html).toBe(before.html);
  });

  test("spa.html: route change and dialog open are reported as PAGE_CHANGED", async () => {
    const url = `${baseUrl}/spa.html`;
    const { page, result } = await scanFixture(context, panel, url);
    try {
      const tabId = await findTabId(panel, url);
      expect(result.issues.length).toBeGreaterThan(0);
      await panel.evaluate(() => ((window as unknown as { __a11yEvents: unknown[] }).__a11yEvents = []));

      await page.click('a[data-view="products"]');
      await expect
        .poll(
          () =>
            panel.evaluate(
              (id) => (window as unknown as { __a11yEvents: Array<{ type?: string; tabId?: number; reason?: string }> }).__a11yEvents.some((m) => m.type === "PAGE_CHANGED" && m.tabId === id && m.reason === "route"),
              tabId,
            ),
          { timeout: 15_000, message: "PAGE_CHANGED (route) was not broadcast after pushState navigation" },
        )
        .toBe(true);

      // The observer debounces changes (SPA_DEBOUNCE_MS = 800) and reports only
      // the highest-priority reason per window (route > dialog > dom), so let
      // the route window close before opening the dialog, as a tester would.
      await page.waitForTimeout(1_500);
      await panel.evaluate(() => ((window as unknown as { __a11yEvents: unknown[] }).__a11yEvents = []));
      await page.click("#open-cart");
      await expect
        .poll(
          () =>
            panel.evaluate(
              (id) => (window as unknown as { __a11yEvents: Array<{ type?: string; tabId?: number; reason?: string }> }).__a11yEvents.some((m) => m.type === "PAGE_CHANGED" && m.tabId === id && m.reason === "dialog"),
              tabId,
            ),
          { timeout: 15_000, message: "PAGE_CHANGED (dialog) was not broadcast after opening the cart dialog" },
        )
        .toBe(true);

      // A rescan of the products view finds the issues planted there.
      const expectedAfter = await page.evaluate(() => JSON.parse(document.getElementById("expected-after-change")?.textContent ?? "{}") as { route?: Record<string, number | string>; dialog?: Record<string, number> });
      await page.keyboard.press("Escape");
      await sendToBackground(panel, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
      await panel.waitForTimeout(1_000);
      const rescanned = await waitForScanResult(panel, tabId, url);
      const counts = countDefinite(rescanned.issues);
      for (const [ruleId, minimum] of Object.entries(expectedAfter.route ?? {})) {
        if (typeof minimum !== "number") continue;
        expect(counts[ruleId] ?? 0, `${ruleId} after route change`).toBeGreaterThanOrEqual(minimum);
      }
    } finally {
      await page.close();
    }
  });

  // ---- axe DevTools parity features --------------------------------------

  async function openFixture(name: string): Promise<{ page: Page; tabId: number; url: string }> {
    const url = `${baseUrl}/${name}.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.bringToFront();
    return { page, tabId: await findTabId(panel, url), url };
  }

  async function scan(tabId: number, options: Partial<ScanOptions> = {}): Promise<ScanResult> {
    const res = await sendToBackground<ScanResult>(panel, { type: "SCAN_START", tabId, options: { ...SCAN_OPTIONS, ...options } });
    expect(res.ok, `SCAN_START failed: ${res.error ?? ""}`).toBe(true);
    return res.data as ScanResult;
  }

  test("scan part of page: only elements inside the selector are reported", async () => {
    const { page, tabId } = await openFixture("forms");
    try {
      const full = await scan(tabId);
      const scope = 'section[aria-labelledby="bad-form-heading"]';
      const part = await scan(tabId, { scope: "selector", selector: scope });
      expect(part.scope).toEqual({ kind: "selector", selector: scope });
      expect(part.issues.length).toBeGreaterThan(0);
      expect(part.issues.length).toBeLessThanOrEqual(full.issues.length);
      // The accessible form next to it has nothing to report when scanned on its own.
      const clean = await scan(tabId, { scope: "selector", selector: 'section[aria-labelledby="good-form-heading"]' });
      expect(clean.issues.length).toBeLessThan(full.issues.length);
      const outside = await page.evaluate(
        ({ root, selectors }) => {
          const container = document.querySelector(root)!;
          return selectors.filter((s) => {
            const el = document.querySelector(s);
            return !el || !container.contains(el);
          });
        },
        { root: scope, selectors: part.issues.map((i) => i.element.selector) },
      );
      expect(outside, "issues outside the scanned part").toEqual([]);
    } finally {
      await page.close();
    }
  });

  test("WCAG version: 2.0 drops 2.2-only target size findings", async () => {
    const { page, tabId } = await openFixture("links");
    try {
      const v22 = await scan(tabId, { wcagVersion: "2.2" });
      expect(v22.wcagVersion).toBe("2.2");
      expect(v22.issues.some((i) => i.ruleId === "TGT-01")).toBe(true);
      const v20 = await scan(tabId, { wcagVersion: "2.0" });
      expect(v20.wcagVersion).toBe("2.0");
      expect(v20.issues.some((i) => i.wcag.criterion === "2.5.8")).toBe(false);
      expect(v20.issues.some((i) => i.ruleId === "LNK-01")).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("undeterminable findings are reported for review, and can be switched off", async () => {
    const { page, tabId } = await openFixture("contrast");
    try {
      const result = await scan(tabId);
      // contrast.html plants text over a gradient (CLR-03), which cannot be decided automatically.
      const clr03 = result.issues.filter((i) => i.ruleId === "CLR-03");
      expect(clr03.length).toBeGreaterThan(0);
      expect(clr03.every((i) => i.type === "Semi")).toBe(true);
      expect(result.issues.some((i) => i.ruleId === "CLR-01" && i.type === "Auto")).toBe(true);

      const off = await scan(tabId, { includeNeedsReview: false });
      expect(off.issues.filter((i) => i.type === "Semi")).toEqual([]);
      expect(off.issues.some((i) => i.ruleId === "CLR-01")).toBe(true);
      // Review findings never move the score.
      expect(off.score).toBe(result.score);
    } finally {
      await page.close();
    }
  });

  test("focus indicators: transparent rings and invisible outline changes are not mistaken for the indicator", async () => {
    const { page, tabId } = await openFixture("focus-indicators");
    try {
      // A tester clicks with the mouse before scanning, so Chrome would not apply
      // :focus-visible to programmatic focus unless the rule forces it.
      await page.click("#start");
      // Reproduce the side panel: the tester's focus is elsewhere, so the page has no focus
      // and Chrome draws no focus styles. Playwright normally fakes focus for every page;
      // switch that off and bring another tab forward. The scan must emulate focus itself.
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      await panel.bringToFront();
      expect(await page.evaluate(() => document.hasFocus())).toBe(false);
      const result = await scan(tabId);
      const rulesFor = (id: string) =>
        result.issues.filter((i) => i.element.selector === `#${id}` && ["KBD-05", "CLR-05"].includes(i.ruleId)).map((i) => i.ruleId);
      expect(rulesFor("bg-strong")).toEqual([]);
      expect(rulesFor("bg-faint")).toEqual(["CLR-05"]);
      expect(rulesFor("outline-transparent-shadow")).toEqual([]);
      expect(rulesFor("fv-strong")).toEqual([]);
      expect(rulesFor("fv-faint")).toEqual(["CLR-05"]);
      // A faint grey behind dark text cannot be darkened without hurting the text: suggest an outline.
      const faint = result.issues.find((i) => i.element.selector === "#fv-faint" && i.ruleId === "CLR-05");
      expect(faint?.fix?.suggestedValue).toMatch(/^outline: 2px solid #[0-9a-f]{6}; outline-offset: 2px$/);
      // A background-only change is judged against the unfocused state, which WCAG requires only
      // at AAA (2.4.13): an AA scan lists it for review, an AAA scan reports it as CLR-09.
      expect(faint?.type).toBe("Semi");
      expect(result.issues.find((i) => i.element.selector === "#bg-faint" && i.ruleId === "CLR-05")?.type).toBe("Semi");
      const aaa = await scan(tabId, { wcagLevel: "AAA" });
      const atAaa = (id: string) =>
        aaa.issues.filter((i) => i.element.selector === `#${id}` && ["CLR-05", "CLR-09"].includes(i.ruleId)).map((i) => `${i.ruleId}/${i.type}`);
      expect(atAaa("fv-faint")).toEqual(["CLR-09/Auto"]);
      expect(atAaa("bg-faint")).toEqual(["CLR-09/Auto"]);
      expect(rulesFor("transparent-only")).toEqual(["KBD-05"]);
      expect(rulesFor("nothing")).toEqual(["KBD-05"]);
      // Indicators of several parts pass when one part stands out, and fail when none does.
      expect(rulesFor("two-rings")).toEqual([]);
      expect(rulesFor("highlight-underline")).toEqual([]);
      expect(rulesFor("inset-ring")).toEqual([]);
      expect(rulesFor("two-faint")).toEqual(["CLR-05"]);
      expect(rulesFor("inside-outline")).toEqual([]);
      // Rings drawn on a pseudo-element, the parent, a child or inside a web component are indicators.
      for (const id of ["pseudo-ring", "parent-ring", "child-ring", "shadow-ring"]) expect(rulesFor(id), id).toEqual([]);
      // Round 2: coloured auto outline, background change plus ring, grown underline, sibling ring, slide-in skip link.
      for (const id of ["auto-color", "bg-plus-ring", "grow-underline", "card-link", "slide-skip"]) expect(rulesFor(id), id).toEqual([]);
      // Rings switched on by the first key press (Spotify) are found after a simulated Tab.
      expect(rulesFor("after-key")).toEqual([]);
      // A ring added a frame after focus is found.
      expect(rulesFor("late-ring")).toEqual([]);
      // A ring drawn by a moving page-level overlay (flying focus) is the indicator.
      expect(rulesFor("flying")).toEqual([]);
      // The previous element's :focus-within style is not part of the next element's unfocused state.
      expect(rulesFor("fw-button")).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test("axe-core only: custom rules are skipped and axe's own rules take over", async () => {
    const { page, tabId } = await openFixture("contrast");
    try {
      const full = await scan(tabId);
      expect(full.issues.some((i) => i.source === "custom")).toBe(true);
      const axeOnly = await scan(tabId, { axeOnly: true });
      expect(axeOnly.axeOnly).toBe(true);
      expect(axeOnly.issues.filter((i) => i.source !== "axe")).toEqual([]);
      // axe's color-contrast runs again once the custom contrast rule stands down.
      expect(axeOnly.issues.some((i) => i.data?.axeRuleId === "color-contrast")).toBe(true);
      // Rules with nothing to test are listed as not applicable, never also as passed or failed.
      const na = axeOnly.inapplicableRules ?? [];
      expect(na).toContain("video-caption");
      expect(na.filter((r) => axeOnly.passedRules.includes(r))).toEqual([]);
      expect(na.filter((r) => axeOnly.issues.some((i) => i.data?.axeRuleId === r))).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test("visible labels and strict ARIA: exactly the planted elements, each classified correctly", async () => {
    const { page, tabId } = await openFixture("labels-aria");
    try {
      const result = await scan(tabId);
      const found = (ruleId: string) =>
        result.issues
          .filter((i) => i.ruleId === ruleId)
          .map((i) => `${/id="([^"]+)"/.exec(i.element.html)?.[1] ?? i.element.selector}/${i.type}`)
          .sort();
      // Item 3: named only by aria-label, a visually hidden label or hidden text; never the labelled look-alikes.
      expect(found("FRM-11")).toEqual(["f1/Semi", "f2/Semi", "f3/Semi", "f4/Semi"]);
      // Item 4: definite where axe-core says "incomplete", and no leftover needs-review duplicate.
      expect(found("ARIA-02")).toEqual(["a1/Auto", "a2/Auto"]);
      // One issue per element: where axe-core already fails it (the focusable span), its finding is kept.
      expect(result.issues.filter((i) => i.ruleId === "ARIA-02" && i.element.html.includes('id="a1"'))).toHaveLength(1);
      expect(found("ARIA-03")).toEqual(["c1/Auto", "c2/Semi"]);
      expect(found("STR-08")).toEqual(["dup-note/Auto", "dup-note/Auto"]);
    } finally {
      await page.close();
    }
  });

  test("target size: 24px at AA with the spacing exception, 44px at AAA without it", async () => {
    const { page, tabId } = await openFixture("target-size");
    try {
      const ids = (result: ScanResult, ruleId: string) =>
        result.issues.filter((i) => i.ruleId === ruleId).map((i) => /id="([^"]+)"/.exec(i.element.html)?.[1] ?? i.element.selector).sort();
      const aa = await scan(tabId);
      expect(ids(aa, "TGT-01")).toEqual(["t-tiny1", "t-tiny2"]);
      expect(ids(aa, "TGT-02")).toEqual([]);
      const aaa = await scan(tabId, { wcagLevel: "AAA" });
      expect(ids(aaa, "TGT-02")).toEqual(["t-30", "t-tiny1", "t-tiny2", "t-wide"]);
      expect(ids(aaa, "TGT-01")).toEqual(["t-tiny1", "t-tiny2"]);
      expect(aaa.issues.find((i) => i.ruleId === "TGT-02")?.wcag).toMatchObject({ criterion: "2.5.5", level: "AAA" });
    } finally {
      await page.close();
    }
  });

  test("contrast checker: exact element colours, and a manual check that survives rescans and can be undone", async () => {
    const { page, tabId } = await openFixture("side-by-side");
    try {
      const idOf = (i: Issue) => /id="([^"]+)"/.exec(i.element.html)?.[1] ?? "";
      const find = (r: ScanResult, id: string) => r.issues.find((i) => idOf(i) === id && /^CLR-0[12]$/.test(i.ruleId)) as Issue;
      let result = await scan(tabId);
      const mockup = find(result, "mockup-text");
      expect(mockup.type).toBe("Semi");

      // The page side: our drawings hidden, the element measured from its CSS.
      const prep = await sendToBackground<{ colors?: { foreground: string; background: string; backgroundSure: boolean; large: boolean } }>(panel, { type: "COLOR_PREPARE", tabId, issueId: mockup.id });
      expect(prep.ok, prep.error).toBe(true);
      expect(prep.data?.colors).toMatchObject({ foreground: "#9a9a9a", background: "#ffffff", large: false });
      const alpha = await sendToBackground<unknown>(panel, { type: "COLOR_RESTORE", tabId });
      expect(alpha.ok).toBe(true);
      const colours = await panel.evaluate(async (t) => (await chrome.tabs.sendMessage(t, { type: "CS_ELEMENT_COLORS", tabId: t, selector: "#alpha-text" }, { frameId: 0 })) as { ok: boolean; data?: { foreground: string } }, tabId);
      expect(colours.data?.foreground).toBe("rgba(0, 0, 0, 0.5)");

      // Confirmed failure: definite now and after a rescan.
      const check = { verdict: "fail" as const, foreground: "#9a9a9a", background: "#ffffff", ratio: 2.81, required: 4.5, foregroundSource: "element" as const, backgroundSource: "picked" as const };
      const set = await sendToBackground<ScanResult>(panel, { type: "MANUAL_CHECK_SET", tabId, issueId: mockup.id, check });
      expect(set.ok, set.error).toBe(true);
      expect(find(set.data as ScanResult, "mockup-text")).toMatchObject({ type: "Auto", manualCheck: { verdict: "fail", originalType: "Semi" } });
      result = await scan(tabId);
      expect(find(result, "mockup-text")).toMatchObject({ type: "Auto", manualCheck: { verdict: "fail", ratio: 2.81 } });

      // Removing the check gives back what the scan reported, here and after a rescan.
      const removed = await sendToBackground<ScanResult>(panel, { type: "MANUAL_CHECK_REMOVE", tabId, issueId: find(result, "mockup-text").id });
      expect(removed.ok, removed.error).toBe(true);
      expect(find(removed.data as ScanResult, "mockup-text").type).toBe("Semi");
      result = await scan(tabId);
      expect(find(result, "mockup-text").manualCheck).toBeUndefined();
      expect(find(result, "mockup-text").type).toBe("Semi");

      // "Passes": ignored as a false positive with the measured colours, kept on rescan; Restore clears it.
      const covered = find(result, "covered-text");
      const pass = await sendToBackground<ScanResult>(panel, { type: "MANUAL_CHECK_SET", tabId, issueId: covered.id, check: { ...check, verdict: "pass", foreground: "#9a9a9a", background: "#222222", ratio: 6.25 } });
      expect(pass.ok, pass.error).toBe(true);
      expect(find(pass.data as ScanResult, "covered-text")).toMatchObject({ status: "ignored", manualCheck: { verdict: "pass" } });
      expect(find(pass.data as ScanResult, "covered-text").reason).toMatch(/^Checked by eye: #9a9a9a on #222222 is 6.25:1/);
      result = await scan(tabId);
      expect(find(result, "covered-text")).toMatchObject({ status: "ignored", manualCheck: { verdict: "pass" } });
      const restore = await sendToBackground(panel, { type: "IGNORE_REMOVE", origin: result.origin, fingerprints: [find(result, "covered-text").fingerprint] });
      expect(restore.ok).toBe(true);
      result = await scan(tabId);
      expect(find(result, "covered-text").status).toBe("new");
      expect(find(result, "covered-text").manualCheck).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  test("contrast checker panel: typed colours give the WCAG ratio, verdicts and a passing fix", async () => {
    const { page, tabId } = await openFixture("side-by-side");
    const ui = await context.newPage();
    try {
      await ui.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`, { waitUntil: "load" });
      await ui.getByRole("button", { name: "Contrast checker" }).first().click();
      await expect(ui.getByRole("heading", { name: "Contrast checker" })).toBeVisible();
      await ui.getByLabel("Text colour", { exact: true }).fill("777777");
      await ui.getByLabel("Background colour", { exact: true }).fill("#fff");
      const result = ui.locator("[aria-live=polite]").filter({ hasText: ":1" });
      // #777777 on white is 4.4781:1: shown truncated as 4.47, and it fails normal text.
      await expect(result).toContainText("4.47:1");
      await expect(result).toContainText("Fails 4.5:1");
      await ui.getByRole("radio", { name: /Large text/ }).check();
      await expect(result).toContainText("Passes 3:1");
      await ui.getByRole("radio", { name: /Normal text/ }).check();
      // The suggested text colour passes when tried.
      await ui.getByRole("button", { name: "Try it" }).first().click();
      await expect(result).toContainText("Passes 4.5:1");
      // An invalid entry is explained, not silently ignored.
      await ui.getByLabel("Background colour", { exact: true }).fill("not-a-colour");
      await expect(ui.getByText(/Not a colour/)).toBeVisible();
    } finally {
      await ui.close();
      await page.close();
    }
  });

  test("check by eye from a finding: prefilled exact colours, and the verdict shows on the finding", async () => {
    const { page, tabId } = await openFixture("side-by-side");
    const ui = await context.newPage();
    try {
      await ui.setViewportSize({ width: 420, height: 900 });
      await ui.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`, { waitUntil: "load" });
      await ui.getByRole("button", { name: /Start scan|Rescan page/ }).first().click();
      await expect(ui.getByRole("tab", { name: /Needs review/ })).toBeVisible({ timeout: 60_000 });
      await ui.getByRole("tab", { name: /Needs review/ }).click();
      await ui.getByText(/Normal text contrast below 4.5:1/).first().click();
      await ui.getByText(/9:14 am/).first().click();
      await ui.getByRole("button", { name: "Check by eye" }).first().click();
      await expect(ui.getByRole("heading", { name: "Check contrast by eye" })).toBeVisible();
      // The exact CSS colour of the element, and the scan's (certain) background.
      await expect(ui.getByLabel("Text colour", { exact: true })).toHaveValue("#9a9a9a");
      await expect(ui.getByLabel("Background colour", { exact: true })).toHaveValue("#ffffff");
      await expect(ui.locator("[aria-live=polite]").filter({ hasText: ":1" })).toContainText("2.81:1");
      // Only the verdict the measurement supports is offered.
      await expect(ui.getByRole("button", { name: /Passes: mark as false positive/ })).toHaveCount(0);
      await ui.getByRole("button", { name: /Fails: confirm the failure/ }).click();
      await expect(ui.getByText(/Fails \(confirmed\)/)).toBeVisible();
      await expect(ui.getByRole("button", { name: "Remove check" })).toBeVisible();
      await ui.getByRole("button", { name: "Remove check" }).click();
      await expect(ui.getByRole("button", { name: "Check by eye" }).first()).toBeVisible();
    } finally {
      await ui.close();
      await page.close();
    }
  });

  test("modal dialog open: one note for the page behind it, not a finding per link", async () => {
    const { page, tabId } = await openFixture("modal-dialog");
    try {
      const result = await scan(tabId);
      const focus = result.issues.filter((i) => i.ruleId === "KBD-05" || i.ruleId === "KBD-06");
      expect(focus.filter((i) => i.type !== "Semi").map((i) => i.element.selector)).toEqual([]);
      expect(focus.filter((i) => i.data?.modalDialog === true).map((i) => i.ruleId).sort()).toEqual(["KBD-05", "KBD-06"]);
    } finally {
      await page.close();
    }
  });

  test("side-by-side misfires: fine patterns are not definite failures", async () => {
    const { page, tabId } = await openFixture("side-by-side");
    try {
      const result = await scan(tabId);
      const idOf = (i: Issue) => /id="([^"]+)"/.exec(i.element.html)?.[1] ?? i.element.selector;
      const on = (id: string, prefix: string) => result.issues.filter((i) => idOf(i) === id && i.ruleId.startsWith(prefix)).map((i) => `${i.ruleId} ${i.type}`);
      // Far off-page labels, a ::before band, a tab's own fill, a dark panel over a photo: no contrast finding.
      for (const id of ["far-off", "band-text", "pill-tab", "photo-credit"]) expect(on(id, "CLR"), id).toEqual([]);
      // A lone symbol may be an icon or part of a value ("10M+"): for review.
      expect(on("sym-only", "CLR")).toEqual(["CLR-01 Semi"]);
      // Decoration hidden from screen readers, and text with a panel drawn over it: for review only.
      expect(on("mockup-text", "CLR")).toEqual(["CLR-01 Semi"]);
      expect(on("covered-text", "CLR")).toEqual(["CLR-01 Semi"]);
      // A flying-focus box, an `auto` outline of width 0 and a ring that stands out on black are indicators.
      for (const id of ["fly-link", "auto-zero", "ring-on-dark"]) expect([...on(id, "KBD-05"), ...on(id, "CLR-05")], id).toEqual([]);
      // A text field whose only sign of focus is the text cursor: for review.
      expect(on("caret-only", "KBD-05")).toEqual(["KBD-05 Semi"]);
      // Decoration clipped by text spacing is not lost content.
      expect(on("deco-clip", "ZM-03")).toEqual([]);
      // Analytics and template data attributes do not make an element clickable.
      expect([...on("analytics-tag", "KBD-01"), ...on("template-token", "KBD-01")]).toEqual([]);
      // Fading on focus is a visible change; text in a collapsed box is never shown; a cookie-bar sentence explains its link.
      expect(on("fade-focus", "KBD-05")).toEqual([]);
      expect(on("collapsed-link", "CLR")).toEqual([]);
      expect(on("cookie-more", "LNK-03")).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test("real-site patterns: no false findings, and the look-alikes are still reported", async () => {
    const { page, tabId } = await openFixture("real-site-cases");
    try {
      const result = await scan(tabId);
      const idOf = (i: Issue) => /id="([^"]+)"/.exec(i.element.html)?.[1] ?? i.element.selector;
      const rulesOn = (id: string) => result.issues.filter((i) => idOf(i) === id).map((i) => i.ruleId).sort();
      // Chrome's two-colour default ring is visible on the dark band.
      expect(rulesOn("default-ring").filter((r) => r === "CLR-05" || r === "KBD-05")).toEqual([]);
      // Text pushed out of its button or parked left of the page is not seen; shown text still is.
      expect(rulesOn("icon-search").filter((r) => r.startsWith("CLR-0"))).toEqual([]);
      expect(rulesOn("offscreen")).toEqual([]);
      expect(rulesOn("low")).toContain("CLR-01");
      // A carousel slide waiting outside the window is shown later and still counts.
      expect(rulesOn("slide-two")).toContain("CLR-01");
      // The clipped image strip is not behind the text below it: a definite failure, not "needs review".
      expect(rulesOn("countdown")).toEqual(["CLR-01"]);
      // A gallery window holding both a caption and its image does not separate them.
      expect(rulesOn("gallery-caption")).toEqual(["CLR-03"]);
      // An icon beside the text is not behind it; one under the text still is.
      expect(rulesOn("ext-link").filter((r) => r.startsWith("CLR"))).toEqual([]);
      expect(rulesOn("icon-under").filter((r) => r.startsWith("CLR"))).toEqual(["CLR-03"]);
      // Gradients are measured on each colour.
      expect(rulesOn("grad-pass").filter((r) => r.startsWith("CLR"))).toEqual([]);
      expect(rulesOn("grad-fail").filter((r) => r.startsWith("CLR"))).toEqual(["CLR-01"]);
      // Underline and clip-text gradients are not the background (Harvard, Shopify).
      expect(rulesOn("underline-grad").filter((r) => r.startsWith("CLR"))).toEqual([]);
      expect(rulesOn("clip-grad").filter((r) => r.startsWith("CLR"))).toEqual([]);
      // A white card or a button with its own fill hides the photo under it; bare text is still over it.
      expect(rulesOn("on-card").filter((r) => r.startsWith("CLR"))).toEqual([]);
      expect(rulesOn("on-button").filter((r) => r.startsWith("CLR"))).toEqual([]);
      expect(rulesOn("on-photo").filter((r) => r.startsWith("CLR"))).toEqual(["CLR-03"]);
      // A caption over a lazy image that has not loaded is text over an image, not white on white.
      expect(rulesOn("lazy-caption").filter((r) => r.startsWith("CLR"))).toEqual(["CLR-03"]);
      // A solid top layer hides the image; a 90% band keeps text readable; a sibling pill is the background.
      expect(rulesOn("solid-chip").filter((r) => r.startsWith("CLR"))).toEqual([]);
      // Definite only when sure: an unknown background (sibling gradient, web component) is Needs review.
      const clrTypes = (id: string) => result.issues.filter((i) => idOf(i) === id && /^CLR-0[12]$/.test(i.ruleId)).map((i) => i.type);
      // A gradient drawn by a sibling box is an image behind the text: CLR-03 (cannot be measured), for review.
      expect(result.issues.filter((i) => idOf(i) === "on-grad-sibling" && /^CLR-0[123]$/.test(i.ruleId)).map((i) => `${i.ruleId} ${i.type}`)).toEqual(["CLR-03 Semi"]);
      expect(clrTypes("in-component")).toEqual(["Semi"]);
      expect(clrTypes("plain-fail")).toEqual(["Auto"]);
      expect(rulesOn("over-light-image").filter((r) => r.startsWith("CLR"))).toEqual([]);
      expect(rulesOn("over-band").filter((r) => r.startsWith("CLR"))).toEqual([]);
      expect(rulesOn("on-pill").filter((r) => r.startsWith("CLR"))).toEqual([]);
      // Width set by script: clipping goes to review.
      expect(result.issues.filter((i) => idOf(i) === "scripted-word" && i.ruleId === "ZM-03").map((i) => i.type)).toEqual(["Semi"]);
      // ::before fills are the background: white passes, green under white text fails.
      expect(rulesOn("pseudo-pass").filter((r) => r.startsWith("CLR"))).toEqual([]);
      expect(rulesOn("pseudo-fail").filter((r) => r.startsWith("CLR"))).toEqual(["CLR-01"]);
      expect(rulesOn("sr-inner")).toEqual([]);
      expect(rulesOn("hardstop").filter((r) => r.startsWith("CLR"))).toEqual([]);
      // A small link inside a whole-card click layer is listed for review, not as a failure.
      expect(result.issues.filter((i) => idOf(i) === "card-title" && i.ruleId === "TGT-01").map((i) => i.type)).toEqual(["Semi"]);
      expect(rulesOn("hash-blank")).not.toContain("LNK-05");
      expect(rulesOn("grad-mixed").filter((r) => r.startsWith("CLR"))).toEqual(["CLR-03"]);
      // Citation links in <sup> and back-links in <span> sit in text: the inline exception applies.
      for (const id of ["cite-1", "cite-2", "back-1", "back-2"]) expect(rulesOn(id).filter((r) => r.startsWith("TGT"))).toEqual([]);
      // Text spacing: margin below the text is not clipping; cut-off text is; ellipsis is for review.
      const zm = (id: string) => result.issues.filter((i) => idOf(i) === id && i.ruleId === "ZM-03").map((i) => i.type);
      expect(zm("zm-margin")).toEqual([]);
      expect(zm("zm-clip")).toEqual(["Auto"]);
      expect(zm("zm-ellipsis")).toEqual(["Semi"]);
      // Focus scrolls a link in a scrolled sidebar clear of the sidebar's sticky header.
      expect(rulesOn("sb-first")).not.toContain("KBD-06");
      // KBD-01: card parts with a keyboard equivalent are not flagged; a clickable div without one is.
      for (const id of ["k-overlay-media", "k-same-href", "k-empty"]) expect(rulesOn(id), id).not.toContain("KBD-01");
      expect(rulesOn("k-real")).toContain("KBD-01");
      // Hidden, click-through and covered targets are not targets; the visible tiny ones still fail.
      for (const id of ["skip-hidden", "chevron", "covered"]) expect(rulesOn(id).filter((r) => r.startsWith("TGT"))).toEqual([]);
      expect(rulesOn("tiny-a")).toContain("TGT-01");
      // <a><code>link</code></a> names a term.
      expect(rulesOn("code-link")).not.toContain("LNK-03");
      // Child frames: no page-level findings in the empty frame, nothing at all from the parked one.
      const fromFrames = result.issues.filter((i) => (i.frameId ?? 0) !== 0);
      expect(fromFrames.filter((i) => ["STR-01", "STR-02", "STR-03", "STR-05"].includes(i.ruleId)).map((i) => i.ruleId)).toEqual([]);
      expect(result.issues.filter((i) => i.element.html.includes("parked-warning"))).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test("missed checks: thrown-away focus, fake headings, headerless tables, navigating selects, alt and name problems", async () => {
    const { page, tabId } = await openFixture("missed-checks");
    try {
      const result = await scan(tabId);
      const idOf = (i: Issue) => /id="([^"]+)"/.exec(i.element.html)?.[1] ?? i.element.selector;
      const rulesOn = (id: string) => result.issues.filter((i) => idOf(i) === id).map((i) => i.ruleId);
      expect(rulesOn("blur-link")).toContain("KBD-05");
      expect(rulesOn("ok-link")).not.toContain("KBD-05");
      expect(rulesOn("fake-h1")).toContain("STR-12");
      expect(result.issues.some((i) => i.ruleId === "STR-12" && /Last week/.test(i.description))).toBe(true);
      expect(rulesOn("fine-sentence")).not.toContain("STR-12");
      expect(rulesOn("body-1")).not.toContain("STR-12");
      expect(rulesOn("data-table")).toContain("STR-07");
      expect(rulesOn("layout-table")).not.toContain("STR-07");
      expect(rulesOn("quick")).toContain("FRM-12");
      expect(rulesOn("quick-go")).not.toContain("FRM-12");
      expect(rulesOn("bullet-img")).toContain("IMG-03");
      expect(result.issues.filter((i) => idOf(i) === "long-alt" && i.ruleId === "IMG-03").map((i) => i.type)).toEqual(["Semi"]);
      expect(rulesOn("markup-label")).toContain("ARIA-03");
      // Tab still reaches these inside aria-hidden; tabindex=-1 is fine.
      expect(rulesOn("hidden-link")).toContain("ARIA-04");
      expect(rulesOn("hidden-frame")).toContain("ARIA-04");
      expect(rulesOn("hidden-ok")).not.toContain("ARIA-04");
      // Moving by itself without a pause control.
      expect(rulesOn("auto-carousel")).toContain("OTH-02");
      expect(rulesOn("paused-carousel")).not.toContain("OTH-02");
      // Background picture described only by "image".
      expect(rulesOn("bg-generic")).toContain("IMG-03");
      expect(rulesOn("bg-named")).not.toContain("IMG-03");
    } finally {
      await page.close();
    }
  });

  test("view element: finds a re-drawn element, explains a removed one, and reaches cross-origin frames", async () => {
    const { page, tabId } = await openFixture("locate");
    try {
      await page.waitForFunction(() => document.querySelector("iframe")?.contentWindow !== null);
      await page.waitForTimeout(500);
      const result = await scan(tabId);
      const byClass = (cls: string) => result.issues.find((i) => i.ruleId === "IMG-01" && i.element.html.includes(`class="${cls}"`));
      const redrawn = byClass("redrawn");
      const gone = byClass("gone");
      const inFrame = byClass("in-frame");
      expect(redrawn && gone && inFrame, "scan found the three images").toBeTruthy();
      expect(inFrame?.frameId ?? 0).not.toBe(0);
      await page.evaluate(() => (window as unknown as { changePage(): void }).changePage());
      const show = (issueId: string) => sendToBackground<{ found: boolean }>(panel, { type: "HIGHLIGHT_ISSUE", tabId, issueId });
      expect((await show(redrawn!.id)).ok).toBe(true);
      const vague = result.issues.find((i) => i.ruleId === "LNK-03" && i.element.html.includes("click here"));
      expect(vague, "scan found the vague link").toBeTruthy();
      expect((await show(vague!.id)).ok).toBe(true);
      const removed = await show(gone!.id);
      expect(removed.ok).toBe(false);
      expect(removed.error).toMatch(/changed since the scan/);
      const viaFrame = await sendToBackground<{ found: boolean }>(panel, { type: "LOCATE_IN_FRAME", tabId, frameId: inFrame!.frameId as number, issueId: inFrame!.id });
      expect(viaFrame.ok, viaFrame.error).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("bot-check page: one warning and every other finding moved to Needs review", async () => {
    const { page, tabId } = await openFixture("bot-check");
    try {
      const result = await scan(tabId);
      expect(result.issues.some((i) => i.ruleId === "OTH-04")).toBe(true);
      expect(result.issues.filter((i) => i.type !== "Semi").map((i) => i.ruleId)).toEqual([]);
      expect(result.issues.some((i) => i.ruleId === "IMG-01")).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("full-screen overlay and missing main: one finding each, not one per element", async () => {
    const { page, tabId } = await openFixture("overlay-no-main");
    try {
      const result = await scan(tabId);
      const obscured = result.issues.filter((i) => i.ruleId === "KBD-06");
      expect(obscured.map((i) => `${i.type}/${i.data?.overlay === true}`)).toEqual(["Semi/true"]);
      const region = result.issues.filter((i) => i.data?.axeRuleId === "region");
      expect(region).toHaveLength(1);
      expect(Number(region[0]?.data?.regionCount)).toBeGreaterThan(3);
    } finally {
      await page.close();
    }
  });

  test("the summary can be resized to give the issue list more room", async () => {
    const { page, tabId } = await openFixture("images");
    const panelTab = await context.newPage();
    try {
      await panelTab.setViewportSize({ width: 420, height: 800 });
      await panelTab.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`, { waitUntil: "load" });
      await scan(tabId);
      const divider = panelTab.getByRole("separator", { name: "Resize summary" });
      await expect(divider).toBeVisible();
      const summaryHeight = () => panelTab.locator("#summary-region").evaluate((el) => el.getBoundingClientRect().height);
      const full = await summaryHeight();
      expect(full).toBeGreaterThan(100);

      // Drag the divider up by 100px: the summary shrinks by the same amount.
      const box = (await divider.boundingBox())!;
      await panelTab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await panelTab.mouse.down();
      await panelTab.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 100, { steps: 5 });
      await panelTab.mouse.up();
      expect(Math.round(await summaryHeight())).toBe(Math.round(full - 100));

      // Keyboard: Home hides it (and takes it out of the tab order), End shows all of it.
      await divider.focus();
      await panelTab.keyboard.press("Home");
      expect(await summaryHeight()).toBe(0);
      await expect(panelTab.locator("#summary-region")).toHaveCSS("visibility", "hidden");
      await expect(divider).toHaveAttribute("aria-valuetext", "Summary hidden");
      await panelTab.keyboard.press("End");
      expect(Math.round(await summaryHeight())).toBe(Math.round(full));

      // The chosen size is remembered when the panel is opened again.
      await panelTab.keyboard.press("Home");
      await panelTab.reload({ waitUntil: "load" });
      await expect(panelTab.getByRole("separator", { name: "Resize summary" })).toHaveAttribute("aria-valuetext", "Summary hidden");
      await panelTab.getByRole("separator", { name: "Resize summary" }).press("End");
    } finally {
      await panelTab.close();
      await page.close();
    }
  });

  test("closing the panel removes the overlay from the page", async () => {
    const { page, tabId } = await openFixture("images");
    const panelTab = await context.newPage();
    try {
      await panelTab.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`, { waitUntil: "load" });
      await scan(tabId);
      const hostDisplay = () =>
        page.evaluate(() => {
          const host = document.getElementById("a11y-checker-overlay-host");
          return host ? getComputedStyle(host).display : "missing";
        });
      await expect.poll(hostDisplay).toBe("block");
      await panelTab.close();
      await expect.poll(hostDisplay, { timeout: 10_000, message: "overlay still visible after the panel closed" }).toBe("none");
    } finally {
      if (!panelTab.isClosed()) await panelTab.close();
      await page.close();
    }
  });

  test("screenshot: captures a cropped image of the issue's element", async () => {
    const { page, tabId } = await openFixture("images");
    try {
      const result = await scan(tabId);
      const target = result.issues.find((i) => i.ruleId === "IMG-01");
      expect(target, "images.html should have an IMG-01 issue").toBeTruthy();
      await page.bringToFront();
      const res = await sendToBackground<Record<string, string>>(panel, { type: "CAPTURE_EVIDENCE", tabId, issueIds: [target!.id] });
      expect(res.ok, res.error).toBe(true);
      expect(res.data?.[target!.id]).toMatch(/^data:image\/png;base64,/);
      const stored = await sendToBackground<ScanResult>(panel, { type: "GET_LAST_RESULT", tabId });
      expect(stored.data?.issues.find((i) => i.id === target!.id)?.evidence?.screenshot).toMatch(/^data:image\/png/);
    } finally {
      await page.close();
    }
  });

  test("screenshot: explains why a zero-size element cannot be photographed", async () => {
    const { page, tabId } = await openFixture("images");
    try {
      const result = await scan(tabId);
      const area = result.issues.find((i) => i.element.selector.startsWith("area"));
      expect(area, "images.html should have an issue on an <area>").toBeTruthy();
      await page.bringToFront();
      const res = await sendToBackground(panel, { type: "CAPTURE_EVIDENCE", tabId, issueIds: [area!.id] });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("no visible size");
    } finally {
      await page.close();
    }
  });

  test("ignore then restore: the issue counts again, now and on the next scan", async () => {
    const { page, tabId } = await openFixture("links");
    try {
      const result = await scan(tabId);
      const target = result.issues.find((i) => i.status === "new")!;
      const ignored = await sendToBackground<ScanResult>(panel, { type: "IGNORE_ADD", tabId, issueIds: [target.id], reason: "e2e: false positive" });
      expect(ignored.ok, ignored.error).toBe(true);
      expect(ignored.data!.issues.find((i) => i.id === target.id)?.status).toBe("ignored");
      expect((await scan(tabId)).issues.find((i) => i.fingerprint === target.fingerprint)?.status).toBe("ignored");

      const restored = await sendToBackground(panel, { type: "IGNORE_REMOVE", origin: result.origin, fingerprints: [target.fingerprint] });
      expect(restored.ok, restored.error).toBe(true);
      const now = await sendToBackground<ScanResult>(panel, { type: "GET_LAST_RESULT", tabId });
      const back = now.data!.issues.find((i) => i.fingerprint === target.fingerprint);
      expect(back?.status).toBe("new");
      expect(back?.reason).toBeUndefined();
      expect((await scan(tabId)).issues.find((i) => i.fingerprint === target.fingerprint)?.status).toBe("new");
    } finally {
      await page.close();
    }
  });

  test("ignore and baseline sent at the same moment are both kept", async () => {
    const { page, tabId } = await openFixture("images");
    try {
      const result = await scan(tabId);
      const [a, b] = result.issues.filter((i) => i.status === "new");
      await Promise.all([
        sendToBackground(panel, { type: "IGNORE_ADD", tabId, issueIds: [a.id], reason: "e2e" }),
        sendToBackground(panel, { type: "BASELINE_ADD", tabId, issueIds: [b.id], reason: "e2e" }),
      ]);
      const now = await sendToBackground<ScanResult>(panel, { type: "GET_LAST_RESULT", tabId });
      expect(now.data!.issues.find((i) => i.id === a.id)?.status).toBe("ignored");
      expect(now.data!.issues.find((i) => i.id === b.id)?.status).toBe("baselined");
      await sendToBackground(panel, { type: "IGNORE_REMOVE", origin: result.origin, fingerprints: [a.fingerprint] });
      await sendToBackground(panel, { type: "BASELINE_REMOVE", origin: result.origin, fingerprints: [b.fingerprint] });
    } finally {
      await page.close();
    }
  });

  test("saved scans: save, list, get, rename, delete", async () => {
    const { page, tabId, url } = await openFixture("images");
    try {
      await scan(tabId);
      const saved = await sendToBackground<{ id: string; name: string }>(panel, { type: "SAVED_SCAN_SAVE", tabId, name: "e2e images" });
      expect(saved.ok).toBe(true);
      const id = saved.data!.id;
      const list = await sendToBackground<Array<{ id: string; name: string; url: string }>>(panel, { type: "SAVED_SCANS_LIST" });
      expect(list.data?.some((m) => m.id === id && m.url.startsWith(url))).toBe(true);
      const got = await sendToBackground<{ result: ScanResult }>(panel, { type: "SAVED_SCAN_GET", id });
      expect(got.data?.result.issues.length).toBeGreaterThan(0);
      const renamed = await sendToBackground<{ name: string }>(panel, { type: "SAVED_SCAN_RENAME", id, name: "renamed" });
      expect(renamed.data?.name).toBe("renamed");
      expect((await sendToBackground(panel, { type: "SAVED_SCAN_DELETE", id })).ok).toBe(true);
      const after = await sendToBackground<Array<{ id: string }>>(panel, { type: "SAVED_SCANS_LIST" });
      expect(after.data?.some((m) => m.id === id)).toBe(false);
    } finally {
      await page.close();
    }
  });

  test("element picker: clicking an element broadcasts its selector", async () => {
    const { page, tabId } = await openFixture("forms");
    try {
      await scan(tabId);
      await panel.evaluate(() => ((window as unknown as { __a11yEvents: unknown[] }).__a11yEvents = []));
      const started = await sendToBackground(panel, { type: "PICKER_START", tabId });
      expect(started.ok, started.error).toBe(true);
      const box = await page.locator("#ok-name").boundingBox();
      await page.mouse.move(box!.x + 5, box!.y + 5);
      await page.mouse.click(box!.x + 5, box!.y + 5);
      await expect
        .poll(() =>
          panel.evaluate(
            (id) =>
              (window as unknown as { __a11yEvents: Array<{ type?: string; tabId?: number; selector?: string }> }).__a11yEvents.find(
                (m) => m.type === "PICKER_RESULT" && m.tabId === id,
              )?.selector ?? null,
            tabId,
          ),
        )
        .toBe("#ok-name");
      // The picker cleans up after itself.
      expect(await page.locator("[data-a11y-checker=picker]").count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Keyboard test: the tester presses Tab and the page records where focus goes.
// ---------------------------------------------------------------------------

test.describe("Keyboard test", () => {
  test.skip(!HAS_DIST, `Extension build not found at ${DIST}. Run "npm run build" first.`);

  let server: Server;
  let baseUrl: string;
  let context: BrowserContext;
  let extensionDir: string;
  let userDataDir: string;
  let panel: Page;

  test.beforeAll(async () => {
    ({ server, baseUrl } = await startServer());
    extensionDir = prepareExtensionCopy();
    ({ context, userDataDir } = await launchWithExtension(extensionDir));
    const worker = await waitForServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=2147483000`, { waitUntil: "load" });
    await panel.evaluate(() => {
      const w = window as unknown as { __kbd: unknown[] };
      w.__kbd = [];
      chrome.runtime.onMessage.addListener((m: { type?: string }) => {
        if (m.type === "KEYBOARD_TEST_RESULT") w.__kbd.push(m);
      });
    });
  });

  test.afterAll(async () => {
    await context?.close().catch(() => undefined);
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    for (const dir of [extensionDir, userDataDir]) if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  async function open(name: string): Promise<{ page: Page; tabId: number }> {
    const url = `${baseUrl}/${name}.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.bringToFront();
    const tabId = await findTabId(panel, url);
    const res = await sendToBackground(panel, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
    expect(res.ok, res.error).toBe(true);
    return { page, tabId };
  }

  type Kbd = { tabId?: number; result: KeyboardTestResult };
  const results = (tabId: number) =>
    panel.evaluate((id) => (window as unknown as { __kbd: Kbd[] }).__kbd.filter((m) => m.tabId === id).map((m) => m.result), tabId);

  test("finds the planted trap from the tester's own Tab presses, and records KBD-02", async () => {
    const { page, tabId } = await open("keyboard-trap");
    try {
      // Leave focus inside the trap first: guided mode must not treat it as the starting point.
      await page.focus("#tag-editor button");
      const started = await sendToBackground(panel, { type: "KEYBOARD_TEST_START", tabId, maxTabs: 200, mode: "guided" });
      expect(started.ok, started.error).toBe(true);
      await page.mouse.click(5, 5);
      for (let i = 0; i < 40 && (await results(tabId)).length === 0; i++) await page.keyboard.press("Tab");
      const [result] = await results(tabId);
      expect(result?.mode).toBe("guided");
      expect(result?.trapDetected).toBe(true);
      expect(result?.trapElements.some((s) => s.startsWith("#tag-editor"))).toBe(true);
      await expect
        .poll(async () => (await sendToBackground<ScanResult>(panel, { type: "GET_LAST_RESULT", tabId })).data?.issues.some((i) => i.ruleId === "KBD-02"))
        .toBe(true);
    } finally {
      await page.close();
    }
  });

  test("completes a cycle on a page without a trap, and Stop returns a partial result", async () => {
    const { page, tabId } = await open("forms");
    try {
      // Stop part-way.
      await sendToBackground(panel, { type: "KEYBOARD_TEST_START", tabId, maxTabs: 200, mode: "guided" });
      await page.mouse.click(5, 5);
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(50);
      }
      const stopped = await sendToBackground<KeyboardTestResult>(panel, { type: "KEYBOARD_TEST_STOP", tabId });
      expect(stopped.ok, stopped.error).toBe(true);
      expect(stopped.data?.path.length).toBeGreaterThanOrEqual(2);
      expect(stopped.data?.cycleCompleted).toBe(false);

      // Tab all the way round.
      const before = (await results(tabId)).length;
      await sendToBackground(panel, { type: "KEYBOARD_TEST_START", tabId, maxTabs: 200, mode: "guided" });
      await page.mouse.click(5, 5);
      for (let i = 0; i < 150 && (await results(tabId)).length === before; i++) await page.keyboard.press("Tab");
      const done = (await results(tabId))[before];
      expect(done?.trapDetected).toBe(false);
      expect(done?.cycleCompleted).toBe(true);
    } finally {
      await page.close();
    }
  });
});
