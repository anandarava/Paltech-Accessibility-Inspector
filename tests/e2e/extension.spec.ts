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

const FIXTURE_PAGES = ["images", "forms", "keyboard-trap", "contrast", "structure", "aria", "links", "spa"] as const;

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
        // Only definite findings are reported.
        expect(result.issues.filter((i) => i.type === "Semi")).toEqual([]);
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

  test("undeterminable findings are not reported", async () => {
    const { page, tabId } = await openFixture("contrast");
    try {
      const result = await scan(tabId);
      // contrast.html plants text over a gradient (CLR-03), which cannot be decided automatically.
      expect(result.issues.some((i) => i.ruleId === "CLR-03")).toBe(false);
      expect(result.issues.filter((i) => i.type === "Semi")).toEqual([]);
      expect(result.issues.some((i) => i.ruleId === "CLR-01")).toBe(true);
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
