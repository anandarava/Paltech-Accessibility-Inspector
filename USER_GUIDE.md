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
8. [Keyboard test](#8-keyboard-test)
9. [Save, compare, rescan and reset](#9-save-compare-rescan-and-reset)
10. [Export reports](#10-export-reports)
11. [Options page](#11-options-page)
12. [Limits and troubleshooting](#12-limits-and-troubleshooting)

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

Below the summary, the tabs choose what the list shows:

| Tab | What it shows |
| --- | --- |
| All | Every open issue |
| WCAG issues | Failures of a WCAG success criterion |
| Best practices | Recommendations that are not WCAG failures |
| Failed rules | One row per failed rule with its WCAG reference, severity and element count |
| Passed rules | Rules that passed on this page |
| Not applicable rules | Rules that found nothing to test (for example no video on the page) |

To narrow the list, type in the search box (rule, selector or WCAG number), use **Group** to list by rule or by category, and use the **Severity**, **Category** and **Status** menus. Status defaults to **Open**. Choose **Ignored** or **Baselined** to review excluded issues, or use the shortcuts **Open only**, **Excluded only** and **All**. At least one status always stays ticked.

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

## 9. Save, compare, rescan and reset

**Each tab works on its own.** The panel keeps a separate result, filters, scope and open view for every tab, so switching tabs and coming back restores what you left. If you close the panel and open it again, the last scan of the current tab comes back.

**Save a scan.**

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

## 10. Export reports

Use **Export** in the footer to download the current scan.

| Option | Use it for |
| --- | --- |
| HTML report with screenshots | Clients and stakeholders. Captures a screenshot of the first element of each failed rule (up to 25) before building the report. The page scrolls while it runs and the tab must stay visible. |
| HTML report | A summary and developer details without screenshots. |
| JSON | Raw results for tooling and CI. |

The HTML report has two parts. **Part 1** is a plain-language summary for team leads and clients: the verdict, the score, the severity breakdown, the problems to fix first, who is affected, what was tested and the limits of automated testing. **Part 2** is for developers: every affected element with its measurements, a fix, the selector, the HTML and the screenshot.

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
- Contrast over images, gradients and video cannot be decided automatically, so those cases are not reported.
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

**Privacy.** Scanning runs entirely in your browser and the extension makes no network requests of its own. Screenshots are taken only when you ask for them, input values are masked and elements matching your redaction selectors (by default password fields and `.pii`) are blurred before an image is stored.
