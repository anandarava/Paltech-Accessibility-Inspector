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
  `chrome.downloads`, `chrome.offscreen` and `chrome.debugger`.
- `src/background/focus-emulation.ts` attaches `chrome.debugger` to the tab for the
  duration of a scan and sends `Emulation.setFocusEmulationEnabled`, so the page
  behaves as focused and draws its focus styles while the side panel has focus.
  Failures leave the scan running without it.
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
export interface FrameScanOutput { issues: Issue[]; passedRules: string[]; incompleteCount: number; frameUrl: string; isTop: boolean; durationMs: number; hiddenChildFrames?: string[] }
// In child frames, page-level axe rules (document-title, page-has-heading-one, landmark-one-main, bypass) are dropped,
// and language rules only apply when the frame shows text. hiddenChildFrames lists the addresses of child frames nobody
// can see (not rendered, <= 1px, or above/left of the page); the SW drops findings from frames at those addresses.
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

Findings a rule marks `Semi` (undeterminable) are listed on the Needs review
tab, never counted as failures or in the score. With `includeNeedsReview: false`
in the scan options, the scanner and the service worker drop them.

| File | Emits | Notes |
|---|---|---|
| `contrast.ts` | CLR-01, CLR-02, CLR-03, CLR-04 | Walk visible text nodes, ancestor background with alpha blending (`shared/color.ts`), large text 24px / 18.66px bold (weight >= 700), CLR-03 Semi when background-image/video/canvas (a no-repeat icon that stays clear of the text lines is ignored; a gradient is measured against each colour stop: all pass -> pass, all fail -> CLR-01/02 against the most favourable stop, mixed -> CLR-03 with the range) (media counts only with the part an `overflow: hidden` container leaves visible, unless that container also holds the text); text pushed out of its own `overflow: hidden` box or parked above/left of the page is skipped; CLR-04 for field/select/checkbox/radio/switch/slider borders vs surrounding background (not buttons; transparent borders are not drawn). Suggest nearest passing colour by stepping lightness in HSL. Chunk work with `yieldToMain` every 200 nodes. |
| `focus-visible.ts` | KBD-05, CLR-05, CLR-09 | For each focusable: snapshot outline/box-shadow/border/background/color/text-decoration, `el.focus({ preventScroll: true })`, compare; if identical -> KBD-05 (type Semi when `:focus-visible` may not have applied, i.e. when `el.matches(":focus-visible")` is false after focus); if different measure every part of the indicator (outline, each box-shadow entry, border; inset shadows and outlines drawn inside the element against its own focused fill, the rest against the surrounding background) and report CLR-05 when even the best part is < 3:1. Chrome's default `outline: auto` ring passes. When the element itself does not change, its ::before/::after, up to 3 ancestors, its first 20 descendants and its shadow root's first 20 elements are compared unfocused vs focused; a change there is the indicator (not KBD-05). Page transitions are switched off with a temporary style while measuring. The previous element is blurred before each "before" snapshot so `:focus-within` styles do not leak in. A background-only change is measured against the unfocused state: CLR-09 (2.4.13 AAA) in AAA scans, CLR-05 Semi (Needs review) in A/AA scans. Restore original activeElement. Skip if the page has > 400 focusables (report one Semi finding on body explaining the cap). |
| `focus-obscured.ts` | KBD-06 | Scroll the window to the top, then for each focusable in order (cap 400) call `el.focus()` so the browser scrolls it as it does for Tab, keeping scroll positions from one element to the next (fallback `scrollIntoView` block "nearest" when focus cannot move); check `elementFromPoint` on a 3x3 grid inset by 2px; if a visible `position: fixed|sticky` element (not opacity 0 / hidden, more than 2px each way) that is not an ancestor covers the centre -> KBD-06 (Auto when every point is covered, otherwise Semi). Restore focus and every scroll position. |
| `alt-quality.ts` | IMG-02, IMG-03, IMG-08, IMG-09 | Filename regex `\.(jpe?g|png|gif|svg|webp|avif|bmp)$` or `^(IMG|DSC|DCIM)[_-]?\d+`; generic words list; inline svg without role/name/aria-hidden -> IMG-08 Semi; `<img alt="">` with a non-empty `title` and no aria-label/aria-labelledby -> IMG-09. |
| `link-text.ts` | LNK-03, LNK-05 | Vague text list (click here, here, read more, more, learn more, link, details); `target=_blank` with no visible/sr text or aria-label containing "new window"/"new tab"/"opens in" and no rel-annotated icon. |
| `target-size.ts` | TGT-01, TGT-02 | Only interactive targets (a[href], button, input, [role=button|link|checkbox|radio|tab|menuitem|switch]); compute bounding box < 24x24; pass if inline-in-sentence link (text found in the parent, or in the nearest block around inline wrappers such as `<sup>`/`<span>`) or if the 24px circle centred on the target does not intersect any other target's circle (spacing exception). Not targets: `pointer-events: none`, visually hidden (<= 1px, clip, clip-path, opacity 0), cut away by an `overflow: hidden` ancestor, or covered at the centre by another element (inside the viewport). Threshold key `minSize`. TGT-02 (AAA scans only, `ctx.wcagLevel === "AAA"`): every target below `thresholds.enhancedMinSize` (default 44) in either dimension, with the inline and user-agent-control exceptions but no spacing exception. |
| `visible-label.ts` | FRM-11 | Visible field with an author-provided name (aria-label, aria-labelledby or a <label>) but no label text shown on screen (not clipped, larger than 1x1 px, on screen). Skipped when a named button sits beside a text field (G167) or visible text within three ancestor levels matches the name. Semi. |
| `aria-strict.ts` | ARIA-02, ARIA-03, STR-08 | aria-label/aria-labelledby on div, span, p and similar without a role (Auto); ARIA id lists with some missing ids (aria-labelledby Auto, others Semi; aria-controls skipped while aria-expanded="false"); ids referenced by ARIA or <label for> that occur more than once (Auto, on every copy). A definite finding replaces axe-core's "incomplete" one for the same element (dedupeIssues). |
| `forms.ts` | FRM-03, FRM-04, FRM-05, FRM-06 | Group detection by shared `name` across >= 2 radio/checkbox inputs; required via `required`/`aria-required`; error text heuristics: elements with role=alert / `.error`, `[class*=error]`, `[id*=error]` near an input that lack `aria-describedby` linkage; `aria-invalid` missing when such an error is visible. FRM-05/06 are Semi. |
| `keyboard.ts` | KBD-01, KBD-08 | KBD-01: elements with `onclick` attribute or `cursor: pointer` computed style and a click listener heuristic (`onclick`, `role` in interactive set, `data-*click`), that are not focusable (no tabindex/native focusable) and no focusable descendant -> Critical. KBD-08: open `[role=dialog]`/`dialog[open]` that does not contain `document.activeElement` -> Semi. |
| `page-heuristics.ts` | STR-12, STR-07, FRM-12, OTH-02 | All Semi. OTH-02: carousel-like elements (class carousel/slider/slideshow/swiper/slick/marquee/ticker, or aria-roledescription carousel) watched for 2.5 s in the top frame; reported when they change by themselves and no pause/stop/play control is in them or a small wrapper. STR-12: short, bold or large `<p>`/`<div>` text without sentence punctuation, only when the page has no h2–h6 (max 10). STR-07: a table of at least 2x2 cells with no `<th>`, no role and numeric or bordered cells. FRM-12: `select[onchange]` whose handler navigates or submits, with no button in its form. Also new elsewhere: KBD-05 reports an element that drops focus on arrival (F55); IMG-03 adds decorative shape words ("bullet", "arrow"…) and alt text over 300 characters (Semi); ARIA-03 reports an aria-label containing HTML markup; ARIA-04 reports elements Tab reaches inside aria-hidden="true" (iframes included); IMG-03 reports a background image whose only description is a generic title (Semi); contrast reads same-origin background images pixel by pixel; the focus check recognises a page-level overlay moved onto the focused element ("flying focus"); axe `td-has-header` feeds STR-07. |
| `reflow.ts` | ZM-02, ZM-03 | ZM-02 only when `window.innerWidth <= 320` (the page must already be that narrow); check `document.documentElement.scrollWidth > innerWidth`. ZM-03: inject a style tag applying the 1.4.12 spacing (line-height 1.5, paragraph spacing 2em, letter 0.12em, word 0.16em) for a moment, detect `overflow: hidden` elements whose text lines (Range rects) reach outside their client box with the spacing but not without it (a grown `scrollHeight` alone is not clipping: paragraph margin raises it), then remove the style. Text shortened on purpose (`-webkit-line-clamp`, `text-overflow: ellipsis`) is judged by scroll size and reported as Semi. |

Every rule must skip `ctx.isExtensionNode(el)` and invisible elements, and never leave the page
modified (restore focus, scroll, injected styles).

## `shared/cause.ts` (pure, unit-tested)

`issueCause(issue): { key, label }` and `groupByCause(items, causeOf)`. The cause of a finding is
read from its data where the rule records it (colour pair for CLR-*, indicator colours for
CLR-05/09, `obscuredBy` for KBD-06, the id for STR-08, the text for LNK-03), otherwise it is the
element kind (`<tag.class>` without generated classes) plus the message with quoted values, ids
and numbers removed. Used by `IssueList` (rule mode: shared causes become an expandable
"label × N" row) and by the HTML report (`TemplateElement.cause` / `causeLabel`, rendered as a
`details.cause` group). Grouping never changes counts, score, ignore or baseline.

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

## Contrast checker and manual checks

- `shared/contrast-check.ts`: `parseColorInput` (hex with or without `#`, any CSS colour),
  `evaluateContrast(fg, bg)` (translucent colours blended as drawn; ratio truncated for display,
  pass/fail on the unrounded ratio; AA, AAA and non-text criteria), `suggestFixes`.
- `src/content/color-pick.ts`: `elementColors(el)`: the exact computed text colour (with
  ancestor opacity) and the background from the contrast rule, with `backgroundSure`.
- Messages:
  - `COLOR_PREPARE` / `COLOR_RESTORE` (UI -> SW -> `CS_COLOR_PREPARE` / `CS_COLOR_RESTORE`):
    hide the overlay, scroll to (and for focus rings focus) the finding's element, and answer
    with its `ElementColors`. The SW turns on focus emulation for a focus-ring check and off
    on restore.
  - `CS_ELEMENT_COLORS` (UI -> CS): colours of the element chosen with the picker. The panel's
    `colorPicking` flag routes the `PICKER_RESULT` to the checker instead of the scan scope.
  - `MANUAL_CHECK_SET` / `MANUAL_CHECK_REMOVE` (UI -> SW): record or undo a `ManualCheck` on
    an issue.
- Verdicts:
  - **pass:** the issue is ignored for the origin, with the measured colours as the reason.
  - **fail:** the issue becomes `Auto`; a previous "pass" ignore is removed.
- Storage and rescans: checks are stored per origin under `manualChecks:<origin>`, keyed by
  fingerprint, and reapplied after every scan (`applyManualChecks`). `IGNORE_REMOVE` also
  drops a "pass" check.

## Site scan

- `shared/site-crawl.ts` (pure, unit-tested): types (`SiteScanOptions`, `SitePage`, `SiteScanState`),
  `normalizeUrl` (no tracking parameters, sorted query, no trailing slash; a `#/route` or
  `#!/route` is kept as a page, any other fragment dropped; null for other protocols and files),
  `hashRoute`, `isExcluded`, `templateKey` (ids become `*`, query ignored, lower case), `samePage`
  (case-insensitive), `groupTemplates` (a folder with `SIBLING_THRESHOLD` or more sitemap pages
  becomes one template; menu-found pages are never folded), `extractLinks`,
  `parseSitemap`, `robotsSitemaps`, `rankPages` (start page, linked pages, deeper links, then
  sitemap-only pages) and `choosePages` (ticks up to `maxPages`, `perTemplate` per template; keeps
  pages the tester ticked or unticked, `userSet`).
- `src/background/site-scan.ts`: one site scan at a time, state in `chrome.storage.local` under
  `siteScan:state`, each page's `ScanResult` under `siteScan:result:<id>:<index>`.
  - Discovery: sitemaps (robots.txt, /sitemap.xml, indexes; up to 5000 pages), the start page's
    links rendered (in the scan window) and from its HTML, then breadth-first to `maxDepth`, with
    the tester's cookies. When the rendered start page has over twice the links of its HTML
    (a script-built app), deeper pages are read rendered too (up to 60), and an address that
    redirects after loading is marked skipped with its landing page listed instead; otherwise
    deeper pages are fetched. Only `perTemplate` pages of each template are read for links
    (the rest of /product/* stays listed, unopened). Opening another `#/route` of the same document waits for the
    route to commit and reloads the tab, so each route is scanned from a fresh load. `options.within` keeps discovery inside one folder. A sitemap page
    that is also linked is ranked as linked.
  - Scanning: a normal window of its own (background tabs are throttled), one page at a time:
    load, wait for `complete` plus 2.5 s, add the rendered page's links, run the normal scan
    (`startScan`; `options.quick`, no longer offered in the panel, passes `ScanOptions.skipRules = SLOW_RULE_IDS`). Off-site redirects
    and redirects to an already-scanned page are skipped. Auto-rescan is off for that tab.
  - A service-worker restart turns a running scan into "paused"; closing the window pauses it.
- Messages (UI -> SW): `SITE_SCAN_GET`, `SITE_SCAN_DISCOVER {url, options}`,
  `SITE_SCAN_SET_PAGES {include?, add?}` (adding a listed page ticks it), `SITE_SCAN_START`
  (also resumes), `SITE_SCAN_RESCAN {indexes?}` (scanned or failed pages again, only those, keeping
  their last figures in `previous`), `SITE_SCAN_PAUSE`, `SITE_SCAN_STOP`, `SITE_SCAN_RESULT {index}`,
  `SITE_SCAN_EXPORT {format}` (multi-page report of the scanned pages), `SITE_SCAN_CLEAR`.
  Every change is broadcast as `SITE_SCAN_STATE {state}`.
- One row per screen: `addPage` leaves out (and counts in `found.details`) any non-manual page whose
  `templateKey` has an id (`*`), and any whose template is already listed. `perTemplate` is fixed at 1
  (no longer in the panel); `maxPages` defaults to 100.
- Navigation-first discovery (`options.allLinks` off, the default): `renderedLinks` and
  `extractLinkInfo` mark each link `nav` when it sits inside `NAV_SELECTOR` (nav, header, footer,
  aside, navigation / tablist / menu roles, breadcrumbs). Navigation links are listed; a content
  link is listed only as the first page of its kind (`templateKey` with an id: one page;
  `similarKey` folder of named pages: up to 3), and further ones increment that page's `similar`.
  A page without any navigation has all its links treated as navigation.
- `ScanOptions.skipRules`: rule ids treated as disabled for that scan only (`disabledRuleIds`).
- Side panel: `SiteScan.tsx` (view `"site"`, opened from the start screen's **Scan whole site** or the action row); **View** opens a page's result through
  `openSaved` with id `<site id>:<index>`, and the banner then offers **Back to site scan**.

## Manual assessment (Quick Assess and Full Assessment)

- `shared/assessment-catalogue.ts`: every requirement once; `FULL_TESTS` (23 tests, the order of the
  Full Assessment), `FULL_REQUIREMENTS`, `QUICK_REQUIREMENTS` (the same objects, so ids are shared)
  and `locate(id)` (test and "1.3" number). A unit test checks every WCAG 2.2 A/AA criterion except
  4.1.1 is covered.
- `AssessmentState.kind` is "quick" or "full"; `storageKey(url, kind)` = `assessment:<kind>:<url>`;
  `requirementsFor(kind)`, `moveToFull(quick, full?)` (shared requirements keep an existing Full
  result). `ASSESS_OPEN {tabId, kind?}` opens `index.html?tabId=…&kind=full`; one tab per page and
  kind. `src/assessment/FullAssessment.tsx`: `FullNav`, `FullOverview`, `TestView` (#test/<id>).

- `shared/assessment.ts` (pure, unit-tested): `QUICK_ASSESS` (10 requirements: kind `manual` or
  `assisted`, WCAG, steps, `helper`, `instances` kind, fix), `AssessmentState` (one page, saved in
  `chrome.storage.local` under `storageKey(url)` = `assessment:quick:<url without #>`),
  `requirementStatus` (manual: the verdict; assisted: any failed instance fails, all passed
  passes; none on the page: the verdict), `summarize`, `failuresOf`, `parseAssessment` (loading a
  file), `criteriaConformance(state)` (per success criterion: Supports / Partially supports /
  Does not support / Not evaluated), `buildAssessmentHtml(state, ReportOptions)` (summary,
  numbered issue cards with High / Medium filters and CSV copy, and with `criteriaTable` (default
  true) an ACR / VPAT style appendix; `preparedBy` prints "Assessed by"), `buildAssessmentJson`
  (with `byCriterion`).
- `src/content/assess.ts`: `listInstances(kind)` for links, images, headings, fields and controls
  (visible ones, selector, name, detail).
- Messages: `ASSESS_OPEN {tabId}` opens (or brings forward) `src/assessment/index.html?tabId=…`;
  `ASSESS_LIST {tabId, kind}` → `CS_ASSESS_LIST`; `ASSESS_PICK {tabId, screenshot, returnTabId}`
  brings the page forward, runs the element picker, photographs the element
  (`CS_ASSESS_SHOT_PREPARE`, captureVisibleTab, offscreen crop) and returns to the assessment tab.
  Visual helpers reuse `KEYBOARD_TEST_START/STOP` with `TOGGLE_OVERLAY` "taborder" (the overlay
  now numbers each stop live), "headings", "landmarks", and `HIGHLIGHT_SELECTORS`.
- `src/assessment/AssessmentApp.tsx`: the tab (Overview, requirement pages, failure and export
  dialogs); `src/background/assess.ts`: the service-worker side; side panel
  `components/ManualView.tsx`: `useTestingMode` (`chrome.storage.local` `testingMode`),
  `ModeChoice`, `ModeSwitch`, `ManualView`.
