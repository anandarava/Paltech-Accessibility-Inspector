/**
 * CI parity example: run the same axe rule selection as the extension inside
 * Playwright and fail the build only on issues that are not in the baseline
 * exported from the extension (Options > Import/Export > Export JSON).
 *
 * Usage
 *   A11Y_URL=https://staging.example.com/pricing \
 *   A11Y_BASELINE=./a11y-checker-config.json \
 *   npx playwright test ci/example.spec.ts
 *
 * Environment
 *   A11Y_URL              page to scan (the test skips itself when unset)
 *   A11Y_BASELINE         baseline file (default ./a11y-baseline.json)
 *   A11Y_BASELINE_ORIGIN  which origin's baseline to use from a config export:
 *                         an origin such as https://www.example.com, or "*" for
 *                         every origin. Defaults to the origin of A11Y_URL and
 *                         falls back to every origin when that one is absent.
 *   A11Y_LEVEL            A | AA | AAA (default AA)
 *   A11Y_BEST_PRACTICES   "false" to drop best-practice rules
 *
 * Baseline file formats accepted by `loadBaseline()`:
 *   1. The config export written by the Options page (`ConfigExport` in
 *      src/options/components/ImportExportSection.tsx):
 *      `{ format: "a11y-checker-config", rules, ruleConfig, baselines: { [origin]: [...] }, ignored: { [origin]: [...] } }`
 *   2. A flat view `{ baseline: [...], ignored?: [...], rules?: RuleConfig }`
 *   3. A bare `BaselineEntry[]`
 *
 * The test injects the bundled axe-core (`axe-core/axe.min.js`, already a
 * dependency of this repo) so no extra package is required. To use
 * `@axe-core/playwright` instead, replace `runAxe()` with:
 *   new AxeBuilder({ page }).options(axeOptions).analyze()
 * The options object is identical.
 *
 * Fingerprints: the extension hashes `ruleId + selector + text snippet` with
 * `fingerprint()` from src/content/fingerprint.ts. This spec imports that
 * exact function (it is pure) and, instead of re-implementing the selector and
 * snippet algorithms, bundles the real `uniqueSelector()` /
 * `resolveSelector()` (src/content/dom-utils.ts) and `textSnippet()`
 * (src/content/fingerprint.ts) with esbuild and injects them into the page, so
 * the fingerprints computed here are byte-for-byte the ones the extension
 * stores. Baseline entries also carry `ruleId` and `selector`, which are used
 * as a secondary match.
 */
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BaselineEntry, RuleConfig, RulesFile, WcagLevel } from "@shared/types";
import { fingerprint } from "@src/content/fingerprint";
import { axeOptionsFromRules, customRuleIds, projectRuleId, type AxeOptions } from "./a11y-rules-to-axe";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGET_URL = process.env.A11Y_URL ?? "http://127.0.0.1:4173/images.html";
const BASELINE_PATH = process.env.A11Y_BASELINE ?? path.resolve(process.cwd(), "a11y-baseline.json");
const BASELINE_ORIGIN = process.env.A11Y_BASELINE_ORIGIN;
const LEVEL = (process.env.A11Y_LEVEL as WcagLevel | undefined) ?? "AA";
const INCLUDE_BEST_PRACTICES = process.env.A11Y_BEST_PRACTICES !== "false";

const rulesFile = JSON.parse(readFileSync(path.join(ROOT, "shared/a11y-rules.json"), "utf8")) as RulesFile;

/** Flat baseline view: `{ baseline: [...], ignored?: [...], rules?: RuleConfig }`. */
interface FlatBaselineExport {
  baseline?: BaselineEntry[];
  ignored?: BaselineEntry[];
  rules?: RuleConfig;
}

/** Mirror of `ConfigExport` from src/options/components/ImportExportSection.tsx (what Options > Export writes). */
interface ConfigExportFile {
  format?: string;
  formatVersion?: number;
  exportedAt?: string;
  rules?: RulesFile;
  ruleConfig?: Partial<RuleConfig>;
  baselines?: Record<string, BaselineEntry[]>;
  ignored?: Record<string, BaselineEntry[]>;
}

const CONFIG_EXPORT_FORMAT = "a11y-checker-config";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isConfigExport(raw: unknown): raw is ConfigExportFile {
  if (!isRecord(raw)) return false;
  if (raw.format === CONFIG_EXPORT_FORMAT) return true;
  // Tolerate a file with the same layout but no format marker.
  return isRecord(raw.baselines) || isRecord(raw.ignored) || isRecord(raw.ruleConfig);
}

function entryArray(v: unknown): BaselineEntry[] {
  return Array.isArray(v) ? (v.filter((e) => isRecord(e) && typeof e.fingerprint === "string") as unknown as BaselineEntry[]) : [];
}

function normalizeRuleConfig(v: Partial<RuleConfig> | undefined): RuleConfig {
  return {
    disabled: Array.isArray(v?.disabled) ? v.disabled.filter((id): id is string => typeof id === "string") : [],
    thresholds: isRecord(v?.thresholds) ? (v.thresholds as RuleConfig["thresholds"]) : {},
  };
}

function targetOrigin(): string | null {
  try {
    return new URL(TARGET_URL).origin;
  } catch {
    return null;
  }
}

/**
 * Picks the entries for one origin (or every origin) out of the per-origin
 * maps written by the Options export.
 */
function selectOriginEntries(
  baselines: Record<string, BaselineEntry[]>,
  ignored: Record<string, BaselineEntry[]>,
): { entries: BaselineEntry[]; origin: string } {
  const origins = Array.from(new Set([...Object.keys(baselines), ...Object.keys(ignored)]));
  const flatten = () => origins.flatMap((o) => [...entryArray(baselines[o]), ...entryArray(ignored[o])]);

  const wanted = BASELINE_ORIGIN && BASELINE_ORIGIN !== "*" ? BASELINE_ORIGIN : BASELINE_ORIGIN === "*" ? null : targetOrigin();
  if (wanted === null) return { entries: flatten(), origin: "*" };

  if (origins.includes(wanted)) {
    return { entries: [...entryArray(baselines[wanted]), ...entryArray(ignored[wanted])], origin: wanted };
  }
  if (BASELINE_ORIGIN) {
    // An explicit origin that is not in the file: nothing is baselined.
    return { entries: [], origin: wanted };
  }
  // The target origin is not in the export (e.g. baseline captured on production,
  // scan running against staging): use every origin rather than nothing.
  return { entries: flatten(), origin: "*" };
}

function loadBaseline(): { entries: BaselineEntry[]; ruleConfig: RuleConfig; source: string } {
  const empty: RuleConfig = { disabled: [], thresholds: {} };
  if (!existsSync(BASELINE_PATH)) return { entries: [], ruleConfig: empty, source: "none (file not found)" };
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as unknown;

  if (Array.isArray(raw)) return { entries: entryArray(raw), ruleConfig: empty, source: "bare array" };

  if (isConfigExport(raw)) {
    const baselines = isRecord(raw.baselines) ? raw.baselines : {};
    const ignored = isRecord(raw.ignored) ? raw.ignored : {};
    const { entries, origin } = selectOriginEntries(baselines, ignored);
    const ruleConfig = normalizeRuleConfig(raw.ruleConfig);
    // The export also reflects disabled rules as `enabled: false` in its rule
    // catalogue; honour that too so a file whose ruleConfig was stripped still agrees.
    const exportedRules = isRecord(raw.rules) && Array.isArray(raw.rules.rules) ? raw.rules.rules : [];
    for (const rule of exportedRules) {
      if (isRecord(rule) && typeof rule.id === "string" && rule.enabled === false && !ruleConfig.disabled.includes(rule.id)) {
        const catalogueRule = rulesFile.rules.find((r) => r.id === rule.id);
        if (catalogueRule?.enabled) ruleConfig.disabled.push(rule.id);
      }
    }
    return { entries, ruleConfig, source: `config export (origin ${origin})` };
  }

  if (isRecord(raw)) {
    const flat = raw as FlatBaselineExport;
    return {
      entries: [...entryArray(flat.baseline), ...entryArray(flat.ignored)],
      ruleConfig: normalizeRuleConfig(flat.rules),
      source: "flat baseline",
    };
  }

  return { entries: [], ruleConfig: empty, source: "unrecognised (ignored)" };
}

/** axe target: one selector per frame; a nested array is a shadow-DOM chain. */
type AxeTarget = Array<string | string[]>;

interface AxeNodeResult {
  target: AxeTarget;
  html: string;
  failureSummary?: string;
}
interface AxeRuleResult {
  id: string;
  impact?: string;
  help: string;
  helpUrl: string;
  nodes: AxeNodeResult[];
}
interface AxeResultsLite {
  violations: AxeRuleResult[];
}

interface CiIssue {
  axeRuleId: string;
  ruleId: string;
  selector: string;
  axeTarget: string;
  snippet: string;
  fingerprint: string;
  help: string;
  helpUrl: string;
}

/** Name of the global the parity bundle is exposed under inside the page. */
const PARITY_GLOBAL = "__a11yCheckerParity";

interface ParityApi {
  uniqueSelector(el: Element): string;
  resolveSelector(selector: string, root?: ParentNode): Element | null;
  textSnippet(el: Element): string;
}

let parityBundleCache: string | undefined;

/**
 * Bundles the extension's real selector / snippet helpers into a browser IIFE
 * with esbuild (a dependency of vite, so already installed). The bundle is
 * built once per worker and injected into every page before axe runs.
 */
function parityBundle(): string {
  if (parityBundleCache !== undefined) return parityBundleCache;
  type EsbuildLite = {
    buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
  };
  let esbuild: EsbuildLite;
  try {
    esbuild = require("esbuild") as EsbuildLite;
  } catch (err) {
    throw new Error(
      `ci/example.spec.ts needs esbuild to bundle src/content/dom-utils.ts for fingerprint parity (npm i -D esbuild): ${String(err)}`,
    );
  }
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        'export { uniqueSelector, resolveSelector } from "@src/content/dom-utils";',
        'export { textSnippet } from "@src/content/fingerprint";',
      ].join("\n"),
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: PARITY_GLOBAL,
    platform: "browser",
    target: "es2020",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "silent",
  });
  parityBundleCache = result.outputFiles[0]?.text ?? "";
  if (!parityBundleCache) throw new Error("esbuild produced no output for the parity bundle");
  return parityBundleCache;
}

/**
 * Runs in the page. Resolves the axe target exactly as
 * src/content/normalizer.ts does (walking shadow-DOM chains) and returns the
 * selector / snippet produced by the extension's own helpers.
 */
function computeElementIdentity(args: { target: AxeTarget; global: string }): { selector: string; snippet: string } | null {
  const api = (window as unknown as Record<string, ParityApi | undefined>)[args.global];
  if (!api) return null;

  let root: ParentNode = document;
  let found: Element | null = null;
  for (const part of args.target) {
    const chain = Array.isArray(part) ? part : [part];
    for (const selector of chain) {
      if (typeof selector !== "string") return null;
      found = api.resolveSelector(selector, root);
      if (!found) return null;
      root = found.shadowRoot ?? found;
    }
  }
  if (!found) return null;
  return { selector: api.uniqueSelector(found), snippet: api.textSnippet(found) };
}

/** Same as `axeTargetToString()` in src/content/normalizer.ts. */
function axeTargetToString(target: AxeTarget): string {
  return target.map((part) => (Array.isArray(part) ? part.join(" >>> ") : String(part))).join(" ");
}

function collapse(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

async function runAxe(page: Page, options: AxeOptions): Promise<AxeResultsLite> {
  await page.addScriptTag({ content: parityBundle() });
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async (opts) => {
    const axe = (window as unknown as { axe: { run(ctx: Document, o: unknown): Promise<AxeResultsLite> } }).axe;
    const results = await axe.run(document, { ...opts, resultTypes: ["violations"] });
    return { violations: results.violations };
  }, options as unknown as Record<string, unknown>);
}

async function toCiIssues(page: Page, results: AxeRuleResult[]): Promise<CiIssue[]> {
  const issues: CiIssue[] = [];
  for (const rule of results) {
    const ruleId = projectRuleId(rule.id, rulesFile);
    for (const node of rule.nodes) {
      const axeTarget = axeTargetToString(node.target);
      const identity = await page.evaluate(computeElementIdentity, { target: node.target, global: PARITY_GLOBAL });
      // Fallbacks mirror normalizer.ts for an element axe reported but that cannot be resolved.
      const selector = identity?.selector ?? axeTarget;
      const snippet = identity?.snippet ?? collapse(node.html).slice(0, 40);
      issues.push({
        axeRuleId: rule.id,
        ruleId,
        selector,
        axeTarget,
        snippet,
        fingerprint: fingerprint(ruleId, selector, snippet),
        help: rule.help,
        helpUrl: rule.helpUrl,
      });
    }
  }
  return issues;
}

function isBaselined(issue: CiIssue, baseline: BaselineEntry[]): boolean {
  return baseline.some(
    (b) =>
      b.fingerprint === issue.fingerprint ||
      (b.ruleId === issue.ruleId && (b.selector === issue.selector || b.selector === issue.axeTarget)),
  );
}

test.describe("accessibility parity with the PalTech A11y Inspector extension", () => {
  test.skip(!process.env.A11Y_URL, "Set A11Y_URL (and optionally A11Y_BASELINE) to run the CI parity example.");

  test(`no new WCAG ${LEVEL} violations on ${TARGET_URL}`, async ({ page }) => {
    const { entries, ruleConfig, source } = loadBaseline();
    const axeOptions = axeOptionsFromRules(rulesFile, ruleConfig, LEVEL, INCLUDE_BEST_PRACTICES);

    await page.goto(TARGET_URL, { waitUntil: "load" });
    const results = await runAxe(page, axeOptions);
    const violations = await toCiIssues(page, results.violations);

    const newIssues = violations.filter((v) => !isBaselined(v, entries));
    const baselined = violations.length - newIssues.length;

    const custom = customRuleIds(rulesFile, ruleConfig);
    console.log(
      [
        `baseline: ${entries.length} entr${entries.length === 1 ? "y" : "ies"} from ${source}; ${ruleConfig.disabled.length} rule(s) disabled`,
        `axe: ${violations.length} violation(s), ${baselined} baselined`,
        `not covered by axe (extension custom rules): ${custom.join(", ")}`,
      ].join("\n"),
    );

    const report = newIssues
      .map((i) => `  [${i.ruleId} / ${i.axeRuleId}] ${i.selector} (${i.fingerprint}) - ${i.help}\n    ${i.helpUrl}`)
      .join("\n");
    expect(newIssues, `New accessibility issues not in the baseline:\n${report}`).toEqual([]);
  });
});
