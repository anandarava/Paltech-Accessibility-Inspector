# PalTech A11y Inspector: User Guide

A guide for testers and developers who use the extension day to day.

## Contents

1. [What it is](#1-what-it-is)
2. [Install and open it](#2-install-and-open-it)
3. [Quick start: run your first scan](#3-quick-start-run-your-first-scan)
4. [Read the results](#4-read-the-results)
5. [Work with an issue](#5-work-with-an-issue)
6. [Scan options](#6-scan-options)
7. [Overlay and colour-blindness simulation](#7-overlay-and-colour-blindness-simulation)
8. [Keyboard test](#8-keyboard-test) (and the [Contrast checker](#contrast-checker))
9. [Save, compare, rescan and reset](#9-save-compare-rescan-and-reset) (and [Site scan](#site-scan))
10. [Export reports](#10-export-reports)
11. [Options page](#11-options-page)
12. [Limits and troubleshooting](#12-limits-and-troubleshooting)
13. [Manual testing: Quick Assess and Full Assessment](#13-manual-testing-quick-assess-and-full-assessment)

---

## 1. What it is

The PalTech A11y Inspector scans the page you are looking at for WCAG accessibility failures, outlines each failing element on the page, explains how to fix it, and exports the findings as a report.

It runs in Chrome and Edge and checks against WCAG 2.0, 2.1 or 2.2 at Level A, AA or AAA. It combines the axe-core engine with extra checks of its own: contrast with transparency, focus visibility, alt text quality, vague link text, target size, form grouping, keyboard reachability and reflow.

- **Definite failures only.** Results the tool cannot decide automatically are left out rather than shown for review.
- **Local.** Scanning happens in your browser. Nothing leaves your machine unless you export a report.
- **Not a certificate.** Automated checks find roughly 30 to 40 percent of accessibility problems. Keyboard testing, a screen reader and manual review are still part of any sign-off.

## 2. Install and open it

Load the built extension in Chrome 116 or later (or Edge) from the project's `dist` folder.

1. Build it once: run `npm install`, then `npm run build` (Node 20 or later).
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Choose **Load unpacked** and select the `dist` folder.
4. Pin the extension to the toolbar.

There are three ways to use it:

- **Side panel.** Click the toolbar icon on any web page. The panel follows the tab you are on. Close it with the cross at the top right.
- **DevTools panel.** Open DevTools and choose **PalTech A11y Inspector**. It adds one extra option: scan the element selected in the Elements panel.
- **Options page.** Open it from the extension's details on the extensions page. It holds the settings that apply to every scan and report.

Chrome's own pages, the Chrome Web Store and other restricted pages cannot be scanned. The panel tells you when the current tab is one of them.

## 3. Quick start: run your first scan

Open the panel on the page you want to test and press **Start scan**; the results appear in a few seconds.

Before a tab has been scanned, the panel shows the landing page with the scan settings in one card:

1. **Scan type.** Choose **Full page**, or **Part of page** and then **Pick an element on the page** (see [Scan options](#6-scan-options)).
2. **WCAG version.** 2.0, 2.1 or 2.2. 2.2 is the latest.
3. **Level.** A (Minimum), AA (Recommended, what most laws require) or AAA (Enhanced).
4. **Best practices.** Keep it ticked to include recommendations that are not strict WCAG failures.
5. **axe-core only.** Tick it to run only axe-core's own rules, so counts match axe DevTools.
6. Press **Start scan**.

A progress bar shows the stage, and a message **Scan complete · N issues found** appears when it ends. The same version, level and checkbox settings then sit in the panel header, where you can change them before a rescan.

Two small links under the card, **Keyboard test** and **Saved scans**, work before any scan has run.

## 4. Read the results

The top of the results is a summary: how many issues, how serious, and whether the page is conformant.

- **Donut and severity tiles.** The donut shows the total number of open issues. The tiles count Critical, Serious, Moderate and Minor. Click a tile to show only that severity.
- **Three boxes.** *axe-core / advanced* splits issues by who found them (axe-core or the extension's own rules). *Best practice* counts recommendations. *Excluded* counts issues you ignored or baselined. Each number is clickable.
- **Score.** *Accessibility score N / 100* is a weighted pass rate over the rules that applied to the page (Critical 10, Serious 7, Moderate 3, Minor 1). 90 to 100 is Good, 50 to 89 Needs improvement, below 50 Poor. A rule counts once however many elements fail it.
- **Conformance.** *No critical WCAG issues* turns into a red *Not conformant (WCAG level)* label whenever an open Critical WCAG issue exists, whatever the score. The score is a trend indicator, not a certificate.
- **Rules passed.** The green count shows how many rules passed.

**More room for the list.** Drag the divider under the summary up to shrink the summary, or all the way up to hide it; drag it down to bring it back. Double-click the divider to hide or show the summary. From the keyboard, tab to the divider and use Arrow Up and Arrow Down, Home to hide the summary or End to show all of it. The panel remembers the size you choose.

Below the summary, the tabs choose what the list shows:

| Tab | What it shows |
| --- | --- |
| All | Every open issue |
| WCAG issues | Failures of a WCAG success criterion |
| Best practices | Recommendations that are not WCAG failures |
| Needs review | Checks the automated rules could not decide, such as text over a background image. Check each by hand. They are not counted as failures or in the score |
| Failed rules | One row per failed rule with its WCAG reference, severity and element count |
| Passed rules | Rules that passed on this page |
| Not applicable rules | Rules that found nothing to test (for example no video on the page) |

To narrow the list, type in the search box (rule, selector or WCAG number), use **Group** to list by rule or by category, and use the **Severity**, **Category** and **Status** menus. When grouped by rule, elements that have the same cause (for example the same text and background colours, or the same cookie banner covering them) are collected under one row ending in "× N"; open it to see each element. This only shortens the list: every element still counts in the totals and the score, and can be ignored or baselined on its own. The HTML report groups elements the same way. Status defaults to **Open**. Choose **Ignored** or **Baselined** to review excluded issues, or use the shortcuts **Open only**, **Excluded only** and **All**. At least one status always stays ticked.

In rule view, each card shows a coloured dot for severity, the rule name with the number of failing elements, then the rule id, the WCAG criterion and a severity badge. Click a card to expand it.

## 5. Work with an issue

Expand a rule card to see what is wrong and how to fix it, then act on one element at a time.

An expanded card shows:

- **Issue.** What the rule found, in plain language.
- **Suggested fix.** What to change.
- **Instances.** When a rule fails on several elements, each one is listed with a number that matches its badge on the page. Click one to select it. The buttons below act on the selected instance, which is the first by default.

The buttons:

- **View element.** Scrolls to the element on the page and draws an outline around it. It works even when the overlay is off: the overlay appears for about four seconds and hides again.
- **Mark as reviewed.** Asks for a reason, then ignores the issue for this site (origin). Use it for false positives. The issue moves to **Excluded** and no longer counts toward the totals or the score. You can find it again under **Status: Ignored**.
- **More details.** Opens the full view for that issue: measurements (for contrast, the colours and a suggested passing colour), selector and HTML, an evidence screenshot, copy as plain text, baseline or ignore, and stepping between the instances of the rule. **Back** returns to the list.

**Baselined** means "known and accepted for now". It excludes the issue like Ignored does, but marks it as a deliberate decision rather than a false positive. Both lists are kept per site and can be reviewed and removed in the Options page.

## 6. Scan options

Choose what to scan and which rules apply. The settings are the same on the landing page and in the header; changing one changes the other.

- **Full page or part of page.** Choose **Part of page**, then **Pick an element on the page**. Hover the page and click an element. The arrow keys move to the parent or child element, and **Esc** cancels. Only that element and everything inside it is scanned. In the DevTools panel, **Scan selected element ($0)** scans the element selected in the Elements panel. The scope button in the action row (**Full page** or **Part of page**) changes it later.
- **WCAG version.** Findings for success criteria newer than the chosen version are dropped.
- **Level.** A, AA or AAA. Higher levels include the lower ones.
- **Best practices.** Includes recommendations. They count toward the totals but never trigger the *Not conformant* label.
- **axe-core only.** Skips the extension's own rules and uses axe's own contrast and target-size checks, so results line up with axe DevTools at the same version and level.

**What runs for each combination**

The **Best practices** and **axe-core only** checkboxes together decide which groups of rules run. Pick the row that matches your goal.

| Best practices | axe-core only | axe-core WCAG rules | axe-core best-practice rules | Advanced rules | Use it for |
| :---: | :---: | :---: | :---: | :---: | --- |
| ✗ | ✗ | ✓ | ✗ | ✓ | Client WCAG compliance report |
| ✓ | ✗ | ✓ | ✓ | ✓ | Most thorough QA testing (default) |
| ✗ | ✓ | ✓ | ✗ | ✗ | Strict axe-core WCAG check only |
| ✓ | ✓ | ✓ | ✓ | ✗ | Matching axe DevTools results |

*Advanced rules* are the extension's own checks (the ones counted under "advanced" in the results summary). *axe-core best-practice rules* are axe's recommendations that are not WCAG failures.

The reflow check (content at 320 CSS pixels wide) only runs when the browser window is 320 pixels wide or narrower. Narrow the window or zoom to 400 percent before scanning to include it.

## 7. Overlay and colour-blindness simulation

The **Overlay** menu draws information on the page itself. After a scan it switches to **Issues**.

| Mode | What it draws |
| --- | --- |
| Off | Hides the overlay |
| Issues | Numbered outlines around each issue |
| Tab order | The numbered focus path |
| Headings | H1 to H6 labels, with skipped levels marked |
| Landmarks | Dashed boxes around page regions |
| Accessible names | A tooltip with role, name and state when you hover an element |

Under **Colour-blindness simulation**, choose **Protanopia** (red-blind), **Deuteranopia** (green-blind), **Tritanopia** (blue-blind) or **Achromatopsia** (greyscale) to see the page as people with those conditions do. **None** turns it off. The overlay button shows a small badge while a simulation is active.

The overlay and the simulation are removed from the page when you close the panel or switch to another tab.

## 8. Keyboard test

The keyboard test records where focus goes while you press Tab, and reports keyboard traps and elements that focus never reaches (WCAG 2.1.1, 2.1.2 and 2.4.3).

1. Open **Keyboard test** from the action row and press **Start test**.
2. Click into the page, then press **Tab** repeatedly. **Shift+Tab** goes back.
3. The test ends by itself when focus returns to the first element or a trap is found. Press **Stop** to end it early.

The result shows the focus path and whether a trap was found. **Show tab order** draws the path on the page. A found trap is added to the scan results as a Critical issue.

The test does not press keys for you: it only records what you press.

### Contrast checker

The Contrast checker measures two colours and shows the WCAG contrast ratio. It uses the same formula as the scan, so the numbers always match. Open it with **Contrast checker** in the action row.

**Enter the colours:**
- **Type** a value: a hex code with or without `#` (`1a1a1a`, `#fff`), `rgb()`, `hsl()` or a colour name. Or use the colour square.
- **Pick on page** opens the browser's eyedropper. Click anywhere on screen. It reads the colour as it is drawn, so photos, gradients and video are measured as they look.
- **From element** lets you click an element on the page. It reads the exact CSS colour of its text, which is more accurate for text than the eyedropper: picking text pixels lands on the blurred edges of letters and reads too light.

**Text over a photo or gradient:** pick a few more background points behind it with **+ Pick another background point**. The lowest ratio counts.

**Choose the requirement:** normal text (4.5:1), large text (3:1), or icons, borders and focus rings (3:1). The result shows the ratio, pass or fail at AA and AAA, and the nearest passing text and background colours, which you can try or copy.

The ratio is truncated to two decimals, never rounded up: 4.478:1 shows as 4.47:1 and fails 4.5:1.

#### Check a finding by eye

Contrast findings (CLR-01 to CLR-05) have a **Check by eye** button, in the rule panel and in the issue details. Use it for findings in **Needs review** (text over images, gradients, video, or a background the scan could not see) and for any result you doubt.

1. **Open the checker.** It opens with the element's exact text colour, and with the background where the scan is sure of it. The element is scrolled into view. For a focus-ring finding (CLR-05) it is also focused, and the page is kept "focused" so the ring stays drawn while you pick.
2. **Pick or correct the colours.** Whatever the extension draws on the page is hidden while you pick.
3. **Record the result.** Only the verdict your measurement supports is offered:
   - **Passes: mark as false positive.** The finding is ignored for this site, with the measured colours as the reason.
   - **Fails: confirm the failure.** A Needs review finding becomes a definite failure and counts in the score.

The result is kept for the site and applied again when you rescan. It shows on the finding with the colours, ratio and date, and **Remove check** undoes it. HTML reports show confirmed failures as "Confirmed by eye" with the colours; JSON reports include the full check.

## 9. Save, compare, rescan and reset

**Each tab works on its own.** The panel keeps a separate result, filters, scope and open view for every tab, so switching tabs and coming back restores what you left. If you close the panel and open it again, the last scan of the current tab comes back.

**Save a scan.** Keep **Include screenshots** ticked (the default) to photograph every failed element while the page is open; the saved scan's reports and comparisons then show them, even after the page has changed.

1. Click **Save scan** in the footer.
2. Type a name (for example *Checkout page*) and press **Save**. The date and time are added to the name.
3. The **Saved scans** page opens with the new entry at the top.

**Saved scans** (the **Saved Scans** button in the action row) lists up to 100 saved scans. Each row shows the score, the name and date, the address, and chips for the WCAG version and level and the number of issues at each severity. Use it to:

- **Open.** View the saved scan read-only. **Back to live results** returns to the current scan.
- **Export.** Download it as an HTML report or JSON.
- **More (the three dots).** **Rename**, **Rescan this page**, or **Delete…** (asks for confirmation).
- **Compare.** Tick two saved scans, or one scan to compare with the current scan, then press **Compare**. The result lists issues as new, fixed or unchanged.

**Rescan this page** is available when the current tab is on the same address as the saved scan. It applies the scan's WCAG version and level and scans again. On any other tab it is greyed out.

**Rescan page** (the blue button at the left of the action row) runs the scan again with the current settings. When the page changes while the panel is open (a new route, a dialog, a large update), a banner offers to rescan.

**Reset** (footer) clears the current tab's results, filters, keyboard test and on-page highlights so you can start again. Saved scans, baselines, ignore lists and settings are kept. It asks for confirmation first.

### Site scan

Scan many pages of one application from its address. Open it with **Scan whole site** on the start screen, or **Site scan** in the action row.

1. **Set up.** Enter the application's address (it starts with the current tab's address) and **Pages to scan** (default 100). **More options** holds the rest:
   - **Only pages under**: keeps the scan inside one application when several share the address. Filled in from a deep address (`https://apps.example.com/hrms/dashboard` gives `/hrms/`); empty scans the whole site.
   - **Link depth**: how many clicks from the start page to follow (default 3).
   - **Use the site's sitemap**: also read `robots.txt` and `sitemap.xml`.
   - **Follow every link**: off by default; PalTech then follows the site's navigation (menus, header, footer, sidebars, tabs, breadcrumbs), and links in the page content add a page only when it is a new kind of page.
   - **Skip addresses containing**: log-out, delete, unsubscribe, language-switch and similar links are never opened, since opening them changes data or the account's settings. Add your own (for example `/admin/*`).

   The list keeps **one row per screen**. Detail pages, whose address carries an id (`/products/1`, `/Event/EventDetails/226492`), are left out so that the screen itself (`/products`) is scanned, and so are other views of a listed screen (`/report?status=3` when `/report` is listed). The summary says how many were left out; add any of them by hand.
2. **Find pages.** PalTech reads the sitemap, opens the start page to read its menus (including ones built by script), and follows links. In an application built by script (Angular, React and similar), where the pages' HTML has no links, it opens each page in the scan window to read its menus and tabs. A menu address that only redirects to another page (for example `/me` to `/me/time-sheet`) is listed as "Redirects to …" and not scanned twice. In hash-routed apps (addresses like `app.example.com/#/leave`), each `#/route` is its own page and is loaded fresh before it is scanned; plain `#section` links are not pages. It uses your browser's sign-in, so sign in to the application first to reach pages behind a login.
3. **Review the list.** The start page and its menu pages come first; the rest are ticked up to the page limit. Unticked pages say why ("Similar to 3 pages already listed", "Over the page limit"). Tick or untick pages, or type an address or path (`/checkout/step-2`) in **Add a page** for pages no link reaches. To check whether a page was found, type part of its address or title in **Search pages**; the list narrows as you type and shows how many pages match. If nothing matches, the page was not found and you can add it.
4. **Scan.** Pages open one at a time in a separate window. Leave it open; it can sit behind other windows but must not be minimised. Links the rendered pages show are added to the list as the scan goes. **Pause** and **Stop** act between pages; **Resume** continues. If the window is closed or the browser restarts, the run pauses and can be resumed.
5. **Results.** Each page shows its score, issues, items to review and scan time. **View** opens that page in the current tab with its results in the panel, and outlines its issues on the page (**Issues** overlay), so you can see each problem in place; **View element** and the other overlays work as after a scan. A bar says it is the site scan result (rescan to check the page as it is now), and **Back to site scan** returns. **Export HTML** downloads one report for all scanned pages, and **Export JSON** the same results as JSON. With **Include screenshots** (More options, on by default) every failed element of each page is photographed while the page is open in the scan window, so the report shows them; this makes the scan slower. **New site scan** clears the run.
6. **Rescan after fixes.** **Rescan all** scans every scanned page again, and **Rescan** on a row scans just that page, with no need to find the pages again. Each page shows what changed since its last scan, for example *Score 91 (was 88) · 12 (was 18) issues*, and the report uses the new results.

Pages reached only by filling in forms, opening dialogs or following e-mailed links are not found automatically: add them by hand.

## 10. Export reports

Use **Export** in the footer to download the current scan.

| Option | Use it for |
| --- | --- |
| HTML report with screenshots | Clients and stakeholders. Takes a screenshot of every failed element (and one per Needs review card) before building the report, so each element in the report shows how it looks. The page scrolls while it runs and the tab must stay visible; a page with many issues takes longer (about half a second per element). |
| HTML report | A summary and developer details without screenshots. |
| JSON | Raw results for tooling and CI. |

Every HTML report, for one scan or several saved scans, uses the same layout. **Part 1** is a plain-language summary for team leads and clients: the verdict, the score, the severity breakdown, the problems to fix first, who is affected, what was tested and the limits of automated testing. **Part 2** is for developers: one card per rule, listing every affected element with its measurements, a fix, the selector, the HTML and the screenshot. **Needs review** follows, with the same cards marked *Needs review · not counted*.

**Filter and browse.** A filter bar sits above the rule cards in Part 2:

| Filter | What it does |
| --- | --- |
| Severity | Show only Critical, Serious, Moderate or Minor findings (combine several) |
| Show | All, only the issues, or only the Needs review findings |
| Search | Matches element text, selector or fingerprint |
| Rule, Category, Effort, Affects | Narrow to one rule, one category (for example Forms), one effort level or one group of users |

Rules start collapsed to one line each (rule, severity, number of elements): click a rule, or tab to it and press Enter, to open it. Inside a rule, each element is one line you can open. **Expand all** opens every rule; click it again to open every element too. **Collapse all** closes everything. Links in the summary and the *Failed rules* table open the rule they point to. **Reset filters** brings everything back. The line under the filters says how many elements are shown. The summary in Part 1 always shows the full totals. A report of several saved scans adds a list of pages on the left and an overview of all pages. The report needs JavaScript to display: open it in a browser.

The organisation name and the *Prepared by* line shown on the report are set in the Options page.

## 11. Options page

The Options page holds what applies to every scan and report.

- **General settings.** Defaults such as WCAG version and level, best practices and axe-core only.
- **Rules.** Turn rules on or off and adjust thresholds. The rule filter on this page does not save the form when you press Enter.
- **Baselines and ignore lists.** Lists per site, with the reason and author of each entry. Remove single entries or all of them for a site.
- **Report details.** The organisation and *Prepared by* shown on exported reports.
- **Import and export.** Export your baseline, ignore list and rule configuration as a JSON file, and import one. The export contains the saved configuration, not unsaved edits. Imports are checked: unknown rules are dropped and thresholds are kept within their allowed ranges.

Changes are saved with the **Save** button. Settings changed in the side panel are not overwritten when you save here.

## 12. Limits and troubleshooting

**What the tool cannot do**

- It finds roughly 30 to 40 percent of accessibility problems. Test with a keyboard and a screen reader (NVDA, JAWS, VoiceOver or TalkBack) as well.
- It cannot judge whether alt text, labels or instructions are accurate. It catches obvious patterns such as filenames and generic words.
- Contrast over images, gradients and video cannot be decided automatically. Those cases are listed on the **Needs review** tab for you to check.
- Content in cross-origin iframes may not be scanned. Such frames are listed as not scanned.
- Canvas content (charts, games) cannot be inspected.
- Issues that only appear after an interaction (hover menus, error messages, later views of a single-page app) are found only if you trigger that state before scanning.

**Common questions**

| Problem | What to do |
| --- | --- |
| The panel says it cannot scan the page | Chrome pages, the Web Store and some other pages are off limits. Open a normal web page and try again. |
| Results look out of date | Press **Rescan page**. A *Page changed* banner appears when the page has changed since the scan. |
| An element's outline does not show | Use **View element**. If the element is gone, the page has changed: rescan. |
| Screenshots in the report are missing | Keep the tab visible and active while the report builds. The page scrolls during capture. |
| A count differs from axe DevTools | Tick **axe-core only** and use the same WCAG version and level. |
| Cursor or layout looks wrong after an update | Reload the extension on `chrome://extensions` and reload the page. |
| You want to start over on a tab | Press **Reset** in the footer. |
| A yellow bar says the extension "started debugging this browser" | This is expected during a scan. To check focus indicators, the extension makes the page behave as if it had keyboard focus (the side panel has it while you work), then switches this off. The bar closes when the scan ends. If you cancel it, focus indicators are not checked and one note appears under **Needs review**. |

**Privacy.** Scanning runs entirely in your browser and the extension makes no network requests of its own. Screenshots are taken only when you ask for them, input values are masked and elements matching your redaction selectors (by default password fields and `.pii`) are blurred before an image is stored.

## 13. Manual testing: Quick Assess and Full Assessment

Automated checks find about a third of accessibility problems; the rest need a person. **Quick Assess** guides you through 10 key requirements by hand; **Full Assessment** covers every WCAG 2.2 A and AA success criterion that needs a person, in 23 tests and 85 requirements.

**Choose the mode.** The first time the panel opens it asks **How do you want to test?**: **Automated** (the scans in this guide) or **Manual**. Tick **Remember my choice** to skip the question next time. Switch at any time with **Automated | Manual** at the top of the panel.

**Start.** In Manual mode, open the page you want to test and click **Quick Assess** or **Full Assessment**. Each opens in a tab of its own next to the page, tied to that page. When an assessment of the page is in progress, the panel shows its progress and a **Continue** button.

**The assessment tab.**

- **Overview**: progress, the number of requirements passed, failed and still to do, and **Start** / **Up next**. The left side lists the 10 requirements with a ✓ or ✕ once they have a result.
- **A requirement**: what it means, its WCAG criterion, **How to test** (steps), and a **Visual helper** that marks things on the page while it is on (the focus path numbered as you press Tab, headings, landmarks, or the elements listed).
  - **Manual** requirements (Keyboard navigation, Focus order, Missing headings, Bypass blocks, Reflow): choose **Pass** or **Fail**. For a failure, **Add a failure instance**: describe it and, optionally, **Pick on page**: the page comes forward, you click the element, and you return with its selector and a screenshot.
  - **Assisted** requirements (Link purpose, Image function, UI component contrast, Heading level, Instructions): PalTech lists the links, images, controls, headings or form fields on the page. Mark each **Pass** or **Fail** (add why it fails), use **Show** to find one on the page, and **Pass unmarked instances** to pass the rest. **Refresh list** reads the page again (for example after opening a menu).
- **Top bar**: **Export result** (an HTML report or JSON by WCAG success criterion, with or without screenshots; see *The assessment report* below), **Download** (a .json file of the assessment), **Load** (a downloaded file), **Start over**. Quick Assess also has **Move to Full Assessment**: it opens the Full Assessment of the page with your Quick Assess results already in it (the 10 Quick Assess requirements are part of the Full Assessment).

**The assessment report.** The HTML report has three parts. **Summary** (for team leads and clients): the verdict, passed / failed / not tested, results by WCAG principle, the top issues to fix first, what was tested and next steps. **Issues to fix**: one numbered card per failing instance (A11Y-001, …) with its screenshot, requirement, element, what was expected and how to fix it; filter by **High** (Level A) or **Medium** (Level AA), or **Copy all as CSV** to paste into a bug tracker. **Appendix** (optional, on by default): conformance by WCAG success criterion in ACR / VPAT style (Supports, Partially supports, Does not support, Not evaluated) with remarks. In the Export dialog, **Assessed by** puts your name on the report (it is remembered), and the appendix checkbox turns the appendix on or off.

**Full Assessment.** The Overview shows the progress, **Continue** (the next requirement to do), filters (All, In progress, Failed, Not started) and a card per test with a bar for its requirements. On the left, the 23 tests: the one you are in opens as a dropdown with **Getting started** (what the test covers, its WCAG criteria and its checks) and its numbered checks (1.1, 1.2 …) with ✓, ✕ or an empty circle. Requirement pages work as in Quick Assess; **Next** carries on into the next test.

Results are saved for the page as you go, so you can close the tab and continue later. **Load saved assessment** in the panel loads a downloaded file for the page that is open.

