# Module API contract

Every module below is implemented by a different engineer in parallel. Import
paths and exported names are fixed; implementations are free. Path aliases:
`@shared/*` -> `shared/*`, `@src/*` -> `src/*`. All code is TypeScript, strict.

Shared contracts (already written, read them first):
`shared/types.ts`, `shared/messages.ts`, `shared/constants.ts`,
`shared/wcag-map.ts`, `shared/a11y-rules.json`, `manifest.json`,
`src/content/rules/types.ts`, `src/content/overlay/types.ts`.

## Runtime topology

- `src/background/service-worker.ts` is the MV3 service worker (module). It is the
  only place that calls `chrome.scripting`, `chrome.tabs.captureVisibleTab`,
  `chrome.downloads` and `chrome.offscreen`.
- `src/content/content-script.iife.ts` is injected programmatically with
  `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [csFile] })`
  where `import csFile from "@src/content/content-script.iife.ts?script"` (CRXJS builds
  `.iife.ts` files as standalone IIFE bundles). It must be idempotent (guard with
  `window.__a11yCheckerLoaded`).
- `src/content/main-world-hook.iife.ts` is injected with `world: "MAIN"` and only wraps
  `history.pushState/replaceState` to dispatch `window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT))`
  (see `ROUTE_CHANGE_EVENT` in constants). It must also be idempotent.
- Side panel (`src/sidepanel`), DevTools panel (`src/devtools`), Options (`src/options`)
  are React pages. They talk to the SW with `sendToBackground` and to the tab with
  `sendToTab` from `shared/messages.ts`.
- `src/offscreen/offscreen.ts` handles `OFFSCREEN_CROP` and `OFFSCREEN_BUILD_DOWNLOAD`
  messages (the SW has no DOM canvas and no `URL.createObjectURL`).

Message handling rules:
- A listener must `return true` only when it will call `sendResponse` asynchronously.
- All request/response messages resolve to the `Response<T>` envelope.
- `SCAN_RESULT`, `SCAN_PROGRESS`, `SCAN_ERROR`, `PAGE_CHANGED`, `ISSUE_CLICKED`,
  `KEYBOARD_TEST_PROGRESS`, `KEYBOARD_TEST_RESULT`, `EVIDENCE_RESULT`,
  `EXPORT_RESULT` are broadcast events sent with `chrome.runtime.sendMessage`; the UI
  filters on `tabId`. Content scripts do not know their tabId: they send messages
  without one and the SW re-broadcasts with `sender.tab.id` filled in.
- The SW must never throw on an unknown message; respond `{ ok: false, error }`.

## `src/background/storage.ts`

```ts
export function getSettings(): Promise<Settings>
export function saveSettings(s: Settings): Promise<void>
export function getRuleConfig(): Promise<RuleConfig>
export function saveRuleConfig(c: RuleConfig): Promise<void>
export function getBaseline(origin: string): Promise<BaselineEntry[]>
export function addBaseline(origin: string, entries: BaselineEntry[]): Promise<void>
export function removeBaseline(origin: string, fingerprints: string[]): Promise<void>
export function getIgnored(origin: string): Promise<BaselineEntry[]>
export function addIgnored(origin: string, entries: BaselineEntry[]): Promise<void>
export function removeIgnored(origin: string, fingerprints: string[]): Promise<void>
export function getLastResult(tabId: number): Promise<ScanResult | undefined>   // chrome.storage.session
export function setLastResult(tabId: number, r: ScanResult): Promise<void>
export function clearLastResult(tabId: number): Promise<void>
```
Settings/RuleConfig must be deep-merged with the DEFAULT_* constants so
new fields never come back undefined. The options page and side panel may also import
this module (it uses only `chrome.storage`).

## `src/background/injector.ts`

```ts
export function ensureContentScript(tabId: number): Promise<{ injected: boolean; frames: number }>
// Pings the CS with CS_PING; if no answer, injects content-script.iife (allFrames) and the MAIN-world hook.
export function injectMainWorldHook(tabId: number): Promise<void>
```

## `src/background/evidence.ts`

```ts
export function captureIssueEvidence(tabId: number, result: ScanResult, issueIds: string[], settings: Settings): Promise<Record<string, string>>
// For each issue: CS_PREPARE_SCREENSHOT (CS scrolls into view, isolates outline, returns viewport box + redact boxes),
// chrome.tabs.captureVisibleTab(windowId, { format: "png" }), crop via offscreen OFFSCREEN_CROP with
// SCREENSHOT_PADDING and devicePixelRatio scale, then CS_RESTORE_AFTER_SCREENSHOT. Returns issueId -> data URL.
```

## `src/background/offscreen-client.ts`

```ts
export function ensureOffscreenDocument(): Promise<void>  // chrome.offscreen.createDocument with reasons ["BLOBS","DOM_SCRAPING"], idempotent
export function cropImage(dataUrl: string, box: BoundingBox, padding: number, scale: number, redactBoxes: BoundingBox[]): Promise<string>
export function downloadText(filename: string, mime: string, content: string): Promise<number> // uses data: URL directly when < 2MB, else offscreen blob URL; returns downloadId
```

## `src/background/exporters/index.ts`

```ts
export interface ReportFile { filename: string; mime: string; content: string }
export function buildReport(format: ExportFormat, result: ScanResult, meta?: ReportMeta): ReportFile
```
`html-report.ts` exports `buildHtmlReport(result, meta?: ReportMeta): string` (`ReportMeta`:
preparedBy, organisation, logo data URL). Self-contained (inline CSS, no external requests, itself
accessible). Part 1 is the summary for stakeholders, Part 2 the developer details. Plain-language text
per rule (headline, impact, fix, users affected, effort) comes from `report-guidance.ts`
(`guidanceFor`, `SEVERITY_MEANING`). `EXPORT_REPORT` accepts `screenshots: true` to capture the first
open element of each failed rule (max 25) before building. `json-report.ts` exports `buildJsonReport(result): string`.

## `src/content/content-script.iife.ts`

Entry: guards double-load, creates the overlay (`createOverlay()` from `./overlay/overlay-root`),
registers the `chrome.runtime.onMessage` listener for every `CS_*` message plus `SCAN_START`,
`HIGHLIGHT_ISSUE`, `TOGGLE_OVERLAY`, `SET_COLOR_BLINDNESS`, `HIGHLIGHT_SELECTORS`,
`CLEAR_HIGHLIGHTS`, `CS_SET_ISSUE_STATUS`, starts the SPA observer
(`startSpaObserver(cb)` from `./observers/spa-observer`), keeps the last `ScanResult` in memory,
and forwards overlay badge clicks as `ISSUE_CLICKED`. Only the top frame draws the overlay and
sends `SCAN_RESULT`; child frames answer `SCAN_START` with their own issues and the top frame
merges them (the SW calls each frame via `frameId` and passes frame results in a second message
if needed; simplest: the SW scans every frame with `sendToTab(tabId, msg, frameId)`, collects
`{ issues, passes, unscanned }` from each, and merges in the SW). Choose the SW-merge design.

Exports for other modules:
```ts
// src/content/scanner.ts
export interface FrameScanOutput { issues: Issue[]; passedRules: string[]; incompleteCount: number; frameUrl: string; isTop: boolean; durationMs: number }
export function scanFrame(options: ScanOptions, rulesFile: RulesFile, ruleConfig: RuleConfig, ctxExtras: { isExtensionNode(el: Element): boolean; onProgress(percent: number, stage: string): void }): Promise<FrameScanOutput>
// Runs axe.run with runOnly tags by level (tags: A -> wcag2a,wcag21a; AA adds wcag2aa,wcag21aa,wcag22aa; AAA adds wcag2aaa; plus "best-practice" when includeBestPractices),
// exclude the overlay host, resultTypes violations+incomplete; then runs CUSTOM_RULES; then normalize().

// src/content/normalizer.ts
export function normalizeAxeResults(results: axe.AxeResults, rulesFile: RulesFile): Issue[]
export function normalizeCustomFindings(rule: CustomRule, findings: RuleFinding[], rulesFile: RulesFile): Issue[]
export function dedupeIssues(issues: Issue[]): Issue[]   // same fingerprint -> keep first

// src/content/fingerprint.ts
export function fingerprint(ruleId: string, selector: string, textSnippet: string): string  // 8-hex FNV-1a/djb2, deterministic, no crypto API
export function textSnippet(el: Element): string   // trimmed textContent or alt/aria-label, max 40 chars

// src/content/dom-utils.ts
export function uniqueSelector(el: Element): string   // id > short unique path with :nth-of-type; must be unique via querySelectorAll length===1
export function xpath(el: Element): string
export function outerHtmlSnippet(el: Element, max?: number): string
export function isVisible(el: Element): boolean
export function boundingBoxes(el: Element): { page: BoundingBox; viewport: BoundingBox }
export function getFocusableElements(root: ParentNode): HTMLElement[]   // tabbable order approximation
export function accessibleName(el: Element): string   // simplified accname: aria-labelledby > aria-label > label[for]/wrapping label > alt > text content > title
// (title is the last resort, per accname; descendant <input> values are only
//  read for button/submit/reset, so field values never leak into issue text)
export function yieldToMain(): Promise<void>


// src/content/rules/index.ts
export const CUSTOM_RULES: CustomRule[]
```
Score and summary (`computeScore(issues)`, `summarize(issues)`, `isNotConformant(issues)`) live in
`shared/scoring.ts` (pure, used by CS, SW, UI, tests):
```ts
export function computeScore(issues: Issue[], passedRules?: string[], passedSeverity?: Record<string, Severity>): number   // Lighthouse-style weighted pass rate; weights 10/7/3/1; BP as Minor
export function summarize(issues: Issue[], passedRules: string[]): ScanSummary
export function isNotConformant(issues: Issue[]): boolean  // any Critical, non-BP, status new
```

## `src/content/rules/*.ts` (each exports `rule: CustomRule`)

Findings a rule marks `Semi` (undeterminable) are dropped by the scanner and
the service worker; only definite findings are reported.

| File | Emits | Notes |
|---|---|---|
| `contrast.ts` | CLR-01, CLR-02, CLR-03, CLR-04 | Walk visible text nodes, ancestor background with alpha blending (`shared/color.ts`), large text 24px / 18.66px bold (weight >= 700), CLR-03 Semi when background-image/gradient/video/canvas; CLR-04 for input/button/select borders vs surrounding background. Suggest nearest passing colour by stepping lightness in HSL. Chunk work with `yieldToMain` every 200 nodes. |
| `focus-visible.ts` | KBD-05, CLR-05 | For each focusable: snapshot outline/box-shadow/border/background/color/text-decoration, `el.focus({ preventScroll: true })`, compare; if identical -> KBD-05 (type Semi when `:focus-visible` may not have applied, i.e. when `el.matches(":focus-visible")` is false after focus); if different compute indicator contrast vs adjacent background -> CLR-05 when < 3:1. Restore original activeElement. Skip if the page has > 400 focusables (report one Semi finding on body explaining the cap). |
| `focus-obscured.ts` | KBD-06 | For each focusable (cap 400): scrollIntoView block "nearest", check `elementFromPoint` at centre and at the four corners inset by 2px; if a `position: fixed|sticky` element that is not an ancestor covers the centre -> KBD-06. Restore scroll position. |
| `alt-quality.ts` | IMG-02, IMG-03, IMG-08 | Filename regex `\.(jpe?g|png|gif|svg|webp|avif|bmp)$` or `^(IMG|DSC|DCIM)[_-]?\d+`; generic words list; inline svg without role/name/aria-hidden -> IMG-08 Semi. |
| `link-text.ts` | LNK-03, LNK-05 | Vague text list (click here, here, read more, more, learn more, link, details); `target=_blank` with no visible/sr text or aria-label containing "new window"/"new tab"/"opens in" and no rel-annotated icon. |
| `target-size.ts` | TGT-01 | Only interactive targets (a[href], button, input, [role=button|link|checkbox|radio|tab|menuitem|switch]); compute bounding box < 24x24; pass if inline-in-sentence link or if the 24px circle centred on the target does not intersect any other target's circle (spacing exception). Threshold key `minSize`. |
| `forms.ts` | FRM-03, FRM-04, FRM-05, FRM-06 | Group detection by shared `name` across >= 2 radio/checkbox inputs; required via `required`/`aria-required`; error text heuristics: elements with role=alert / `.error`, `[class*=error]`, `[id*=error]` near an input that lack `aria-describedby` linkage; `aria-invalid` missing when such an error is visible. FRM-05/06 are Semi. |
| `keyboard.ts` | KBD-01, KBD-08 | KBD-01: elements with `onclick` attribute or `cursor: pointer` computed style and a click listener heuristic (`onclick`, `role` in interactive set, `data-*click`), that are not focusable (no tabindex/native focusable) and no focusable descendant -> Critical. KBD-08: open `[role=dialog]`/`dialog[open]` that does not contain `document.activeElement` -> Semi. |
| `reflow.ts` | ZM-02, ZM-03 | ZM-02 only when `window.innerWidth <= 320` (the page must already be that narrow); check `document.documentElement.scrollWidth > innerWidth`. ZM-03: inject a style tag applying the 1.4.12 spacing (line-height 1.5, paragraph spacing 2em, letter 0.12em, word 0.16em) for a moment, detect elements whose `scrollWidth/scrollHeight` exceed client size with `overflow: hidden` and text inside, then remove the style. |

Every rule must skip `ctx.isExtensionNode(el)` and invisible elements, and never leave the page
modified (restore focus, scroll, injected styles).

## `shared/color.ts` (pure, unit-tested)

```ts
export type RGB = [number, number, number]; export type RGBA = [number, number, number, number]
export function parseColor(css: string): RGBA | null       // rgb(), rgba(), #hex (3,4,6,8), transparent, named basics via a small table, "color(srgb ...)" optional
export function luminance(rgb: RGB): number                // WCAG 2.2, 0.04045 threshold
export function contrastRatio(a: RGB, b: RGB): number      // rounded to 2 decimals
export function blend(top: RGBA, bottom: RGB): RGB
export function toHex(rgb: RGB): string
export function suggestPassingColor(fg: RGB, bg: RGB, target: number): RGB  // adjust lightness stepwise keeping hue/sat; darken first if bg is light else lighten
export function isLargeText(fontSizePx: number, fontWeight: number): boolean
```

## `src/content/overlay/overlay-root.ts`

`export function createOverlay(): OverlayController` (see `overlay/types.ts`). Host element
id `OVERLAY_HOST_ID`, attribute `EXT_MARKER_ATTR`, `position: fixed; inset: 0; pointer-events: none; z-index: 2147483647`,
closed shadow root, badges have `pointer-events: auto`. Helper modules: `highlighter.ts`
(outlines + numbered badges by severity colour), `tab-order.ts` (SVG path with numbered circles and
arrows), `heading-map.ts` (H1–H6 labels, skipped levels red), `landmarks.ts` (dashed boxes with
labels), `names.ts` (hover tooltip with role/name/state using `accessibleName` from dom-utils),
`color-blindness.ts` under `src/content/simulators/` exports `applyColorBlindness(mode)` that injects an
SVG `<filter>` with feColorMatrix (Machado 2009 matrices for protanopia/deuteranopia/tritanopia,
grayscale for achromatopsia) on `html` via a `filter: url(#...)` style, excluding the overlay host.
Positions update on scroll/resize (passive listeners) and `ResizeObserver` on `document.body`.

## `src/content/observers/spa-observer.ts`

```ts
export function startSpaObserver(onChange: (reason: "route" | "dialog" | "dom") => void): () => void
```
Listens to `ROUTE_CHANGE_EVENT`, `popstate`, `hashchange`; MutationObserver on body that fires
"dialog" when a `[role=dialog]`, `dialog[open]`, or `[aria-modal=true]` becomes visible, and "dom"
when more than 20% of `body.getElementsByTagName("*").length` changed since last baseline;
ignores extension nodes; debounced by `SPA_DEBOUNCE_MS`. Returns a stop function.

## Side panel `src/sidepanel`

`main.tsx` mounts `<App />`. `store.ts` is a zustand store holding: `tabId`, `result`, `scanning`,
`progress`, `selectedIssueId`, `filters` (severities, categories, hideBaselined, hideIgnored,
showBestPractice), `overlayMode`, `colorBlindness`, `keyboardResult`, `settings`,
`toast`. Components: `ScanButton`, `ScoreCard`, `Filters`, `IssueList` (grouped by category, numbered
badges matching overlay numbers = index in the filtered list), `IssueDetail` (element, selector copy,
data table, fix, Highlight / Copy / Screenshot / Ignore / Baseline actions with reason prompt),
`KeyboardTest` (the content script records focus while the tester presses Tab), `OverlayMenu`,
`ExportMenu`, `Toast`. The panel resolves `tabId` from
`chrome.tabs.query({ active: true, lastFocusedWindow: true })` and follows `chrome.tabs.onActivated`.
The panel itself must be keyboard operable with visible focus and proper ARIA.
`src/devtools/devtools.ts` calls `chrome.devtools.panels.create("PalTech A11y Inspector", "icons/16.png", "src/devtools/panel.html")`;
`src/devtools/panel.tsx` renders the same `<App />` with `tabId = chrome.devtools.inspectedWindow.tabId`
and an "Inspect" action that runs `chrome.devtools.inspectedWindow.eval("inspect(document.querySelector(<selector>))")`.

## Options `src/options`

`main.tsx` mounts `<Options />`: WCAG level, category toggles, best-practice toggle, auto-rescan,
environment name, redaction selectors, per-rule enable/disable table (from `a11y-rules.json`),
thresholds (TGT-01 minSize), baseline/ignore manager per origin (list, remove),
import/export of `a11y-rules.json` + baseline as JSON (for CI parity). Uses `storage.ts`.

## CI parity `ci/`

`ci/a11y-rules-to-axe.ts` exports `axeOptionsFromRules(rulesFile, ruleConfig, level)` producing
`{ runOnly, rules }` for `@axe-core/playwright` / `cypress-axe`, and `ci/example.spec.ts` shows a
Playwright test that loads `shared/a11y-rules.json` and a `baseline.json` export and fails on new
fingerprints (uses the same `fingerprint()` and `uniqueSelector()` logic re-implemented for the
Playwright context, or evaluates them in page via `page.evaluate`).

## Tests

`vitest.config.ts` with `environment: "jsdom"`, `include: ["tests/unit/**/*.test.ts"]`, alias
`@shared`, `@src`. Unit tests: `shared/color.ts`, `shared/scoring.ts`, `src/content/fingerprint.ts`,
`src/content/dom-utils.ts` (uniqueSelector/xpath/accessibleName), `src/background/exporters/html-report.ts`, `json-report.ts`,
`src/content/rules/alt-quality.ts` and `link-text.ts` (jsdom). `playwright.config.ts` + `tests/e2e`
load the unpacked `dist` with `chromium.launchPersistentContext` and `--load-extension`, open a
fixture page, trigger a scan through the service worker (`context.serviceWorkers()`), and assert
counts from the fixture's `<script type="application/json" id="expected">` manifest.
Fixtures in `fixtures/*.html` (images, forms, keyboard-trap, contrast, structure, aria, links) each
include that expected-results manifest.
