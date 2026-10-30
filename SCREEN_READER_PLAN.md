# Screen Reader Simulator Plan

**Goal:** Let a sighted tester see, and hear, what a screen reader user gets from a page, without installing NVDA, JAWS or VoiceOver.
**Status:** Phase 1 built on branch `screen-reader`, plus Speak and Copy from later phases. Phase 2 (Tab stops, Follow focus, voice settings, live regions) and Phase 3 (reports, iframes) are still to do.

---

## Why

The automated scan already finds many problems that affect blind users: missing alt text, unlabelled fields, broken ARIA, heading structure, nested controls (KBD-10). What it can't show is the **experience**: the order things are read in, what each control is called, and what is missing or said twice.

Today a tester has to install a real screen reader and learn to use it to see that. Most testers don't, so those checks are skipped.

None of the tools in the 14 Oct 2026 comparison (axe DevTools, WAVE, ARC Toolkit, IBM Equal Access, Accessibility Insights, Siteimprove) has a built-in screen reader view. This would set PalTech apart.

---

## What the tester sees

A new **Screen reader** button in the side panel's Actions row, next to Keyboard test and Contrast checker. It opens this view:

```
┌─ Screen reader ──────────────────────────────────────────┐
│ ◀ Back                                                   │
│                                                          │
│ View: [Everything ▾]   ▶ Speak  ⏸  ⏮ ⏭   ☐ Follow focus  │
│ Everything · Tab stops · Headings · Landmarks · Links ·  │
│ Form fields                                              │
│──────────────────────────────────────────────────────────│
│  1  banner landmark                                      │
│  2  link, "Home"                                         │
│  3  navigation landmark, "Main"                          │
│  4  list, 4 items                                        │
│  5  heading, level 1, "Patient intake"                   │
│  6  group, "Known allergies"                             │
│  7  radio button, not checked,                           │
│     "Yes (Patient has Known Allergies)", 1 of 2          │
│                               ⚠ KBD-10 Nested control    │
│  8    radio button, not checked,                         │
│       "Yes (Patient has Known Allergies)"                │
│  9  button, "Submit"                                     │
│──────────────────────────────────────────────────────────│
│ 42 lines · 3 with problems        Export transcript ▾    │
└──────────────────────────────────────────────────────────┘
```

- **Each line** is one thing the screen reader announces, in the order it reads them.
- **Click a line** to highlight and scroll to the element on the page (the same highlight the issue list uses).
- **⚠ markers** link a line to a scan finding. Clicking the marker opens that issue.
- **Speak** reads the lines aloud from the selected line onwards. The line being spoken is highlighted in the list and on the page.
- **Follow focus**: while it's on, every time focus moves on the page (Tab, a click, a script), the panel announces the newly focused element, like a real screen reader does.

### Views

| View | What it lists | What it helps find |
|---|---|---|
| Everything | Every announced item in reading order | Reading order problems, decorative content being read, hidden content that is still read |
| Tab stops | Only elements reached with Tab, in Tab order | Unnamed controls, double stops (the nested radio above), controls that can't be reached |
| Headings | Headings with their levels | Skipped levels, missing H1, headings that aren't marked up as headings |
| Landmarks | Landmarks with their names | Missing main landmark, several unnamed navigation landmarks |
| Links | All links with their names | "Click here", "Read more", links with the same name but different targets |
| Form fields | Fields with name, role, required, invalid and description | Missing labels, error messages not tied to their field |

The Headings, Landmarks, Links and Form fields views match the lists real screen readers offer (the NVDA Elements List, VoiceOver's Rotor), so testers learn the same way of navigating.

---

## How it works

### 1. Read the browser's accessibility tree

Chrome builds an **accessibility tree** from every page. Screen readers read that tree, not the HTML. Through the `debugger` permission the extension already has, it can ask Chrome for the same tree:

```
Side panel ──SR_GET_TRANSCRIPT──▶ Background service worker
                                     │ chrome.debugger.attach(tab)
                                     │ Accessibility.enable
                                     │ Accessibility.getFullAXTree
                                     ▼
                         Chrome's accessibility tree
                         (role, name, value, states,
                          backendDOMNodeId per node)
                                     │
                     build transcript lines (shared/announce.ts)
                                     │
Side panel ◀──SR_TRANSCRIPT───────────┘
```

Each node in the tree carries what a screen reader uses: its **role** (button, link, heading), **name** ("Submit"), **value**, **states** (checked, expanded, required, invalid, disabled), heading level, and position in a set ("1 of 2").

Because this is Chrome's own computed tree, it already handles `aria-labelledby`, `<label>`, `aria-hidden`, `display: none`, `role="presentation"` and shadow DOM exactly as Chrome exposes them to screen readers. We don't re-implement any of those rules.

### 2. Turn nodes into announcements

A new pure module, `shared/announce.ts`, turns one tree node into the text a screen reader would say. Examples:

| Node | Announcement |
|---|---|
| role `button`, name "Submit" | button, "Submit" |
| role `heading`, level 2, name "Allergies" | heading, level 2, "Allergies" |
| role `radio`, checked false, 1 of 2, name "Yes" | radio button, not checked, "Yes", 1 of 2 |
| role `textbox`, required, invalid, name "Email", description "Enter a valid email" | edit, required, invalid entry, "Email", "Enter a valid email" |
| role `link`, name "" | link (no name) ⚠ |
| role `navigation`, name "Main" | navigation landmark, "Main" |

Rules for building the list:
- Skip nodes Chrome marks as **ignored** (hidden, `aria-hidden`, presentational).
- Join plain text runs into one line, as screen readers do in browse mode.
- Announce entering a landmark, list ("list, 4 items") or table ("table, 5 rows, 3 columns").
- Use **neutral wording** close to NVDA's, because NVDA is the most used screen reader with Chrome. The wording is a guide, not a promise of what every screen reader says (see "Limits").

Keeping this a pure function (tree node in, text out) makes it easy to unit-test.

### 3. Link lines to page elements and to findings

Every tree node has a `backendDOMNodeId`. To highlight a line's element:

1. The background service worker calls `DOM.resolveNode` with that id, then `Runtime.callFunctionOn` to set a temporary `data-pt-sr` marker attribute on the element.
2. The content script finds the element by the marker and uses the existing highlighter ([highlighter.ts](src/content/overlay/highlighter.ts)) to outline and scroll to it.

To link lines to scan findings, the content script matches each finding's `selector` (already stored on every issue) against the marked elements. Lines without a scan finding are still checked on the spot for a few problems that only show up in the transcript:
- an interactive role with no name
- an interactive element inside another interactive element (two stops for one control)
- the same element announced twice in a row

### 4. Tab-stops view

The accessibility tree tells us what is focusable, not the order Tab visits it in. The Tab stops view reuses the Tab order the Keyboard test already works out ([KeyboardTest.tsx](src/sidepanel/components/KeyboardTest.tsx), [tab-order.ts](src/content/overlay/tab-order.ts)), then looks up each stop's announcement in the tree.

### 5. Follow focus

The content script listens for `focusin` on the page. On each focus change it marks the element and asks the background for that element's announcement (`DOM.querySelector` on the marker, then `Accessibility.getPartialAXTree`). The panel shows the line and, if Speak is on, says it.

### 6. Speaking

The side panel uses the browser's built-in speech (`speechSynthesis`). It works in extension pages with **no extra permission**. Settings in Options: voice, rate (default 1.2×), and whether to speak the role first ("button, Submit") or the name first ("Submit, button").

### 7. Keeping up with page changes

The view stays current when the page changes:
- The existing `PAGE_CHANGED` event (route change, dialog opened, large DOM change) triggers a refresh, with a "Page changed – Refresh" banner like the issue list has.
- **Live regions** (`aria-live`, `role="alert"`, `role="status"`): the content script watches them with a `MutationObserver`. New text shows up at the bottom of the panel as "Announced: …", which shows whether status messages ("Saved", "3 results found") actually reach screen reader users.

### 8. Sharing one debugger connection

Chrome allows **one debugger connection per tab per extension**. Focus emulation ([focus-emulation.ts](src/background/focus-emulation.ts)) already attaches during scans and in the Contrast checker. A small `debugger-session.ts` module will own the connection and count who is using it. It attaches on first use and detaches only when nobody needs it, so the scan and the screen reader view can't knock each other off.

While attached, Chrome shows its "PalTech Accessibility Testing started debugging this browser" bar. The view attaches when it opens and detaches when the tester leaves it, so the bar appears only while the view is in use.

### 9. When the debugger isn't available

Some pages refuse a debugger (Chrome Web Store pages, `chrome://` pages), and a tester can cancel the debugging bar. In that case the view falls back to the names the extension already computes in the content script ([dom-utils.ts](src/content/dom-utils.ts), used by the names overlay). The view shows a notice: "Approximate: built from the page's HTML, not from Chrome's accessibility tree."

---

## Reports

- **HTML report:** an optional "Screen reader transcript" section at the end, with the Tab stops and Headings views (most useful for developers) and a link from each problem line to its finding.
- **JSON export:** the full transcript as data, so CI can compare transcripts between releases.
- **Export transcript** in the view: copy as text or download as `.txt` / `.csv` to attach to bug tickets.
- Off by default in reports, switched on in Options, to keep reports short.

---

## Limits (shown in the view's help text)

- **It is a simulation.** NVDA, JAWS, VoiceOver and TalkBack each phrase things a little differently and have their own bugs. The view shows what the page tells assistive technology, which is where most real problems are. Sign-off for critical flows (login, checkout, patient forms) should still include a real screen reader.
- **Reading order is DOM order**, which is what screen readers use. Where the visual order differs (CSS grid, flex `order`, absolute positioning), that is a real problem for users and the view will show it.
- **Cross-origin iframes** (embedded maps, payment forms) aren't covered in the first version. They need a separate debugger connection per frame. Phase 3.
- **Canvas, images of text and PDF viewers** show only what their accessibility markup provides, which is also what a real screen reader gets.

---

## Files

| File | Change |
|---|---|
| `src/background/debugger-session.ts` | **New.** Shared attach/detach with use counting. |
| [src/background/focus-emulation.ts](src/background/focus-emulation.ts) | Use the shared session instead of attaching directly. |
| `src/background/screen-reader.ts` | **New.** Fetch the tree, resolve nodes to elements, follow focus. |
| `shared/announce.ts` | **New.** Tree node to announcement text. Pure, unit-tested. |
| [shared/types.ts](shared/types.ts) | `TranscriptLine`, `Transcript` types. |
| [shared/messages.ts](shared/messages.ts) | `SR_GET_TRANSCRIPT`, `SR_TRANSCRIPT`, `SR_HIGHLIGHT_LINE`, `SR_FOCUS_LINE`, `SR_LIVE_ANNOUNCEMENT`. |
| `src/content/screen-reader.ts` | **New.** Marker lookup, focus listener, live-region observer. |
| `src/sidepanel/components/ScreenReaderView.tsx` | **New.** The view, its filters and Speak controls. |
| [src/sidepanel/store.ts](src/sidepanel/store.ts) | Add `"reader"` to `View`. |
| [src/sidepanel/App.tsx](src/sidepanel/App.tsx) | Screen reader button in the Actions row and on the landing view. |
| [src/options/Options.tsx](src/options/Options.tsx) | Voice, rate, announcement order, include in reports. |
| [src/background/exporters/](src/background/exporters/) | Transcript section in HTML and JSON reports. |
| Docs | README, USER_GUIDE, USER_MANUAL: new section with screenshots. |

---

## Phases

| Phase | Scope | Effort |
|---|---|---|
| **1. Transcript** | Shared debugger session; Everything, Headings, Landmarks, Links and Form fields views; click to highlight; no-name and nested-control markers; HTML fallback | Medium (about 1–1.5 weeks) |
| **2. Hear it and follow it** | Speak with voice and rate settings; Tab stops view; Follow focus; links to scan findings; live-region announcements | Medium (about 1 week) |
| **3. Share it** | Transcript in HTML/JSON reports and export; refresh on page change; same-origin iframes, then cross-origin iframes | Medium (about 1 week) |

Phase 1 is useful on its own: a tester can read the transcript and spot problems without any speech.

---

## Testing

- **Unit tests** for `shared/announce.ts`: one test per role and state combination in the table above, plus unnamed controls, nested controls and ignored nodes.
- **E2E tests** in [tests/e2e/](tests/e2e/) on the existing [fixtures/](fixtures/) pages: open the view, check the transcript for known lines, click a line and check the highlight.
- **Compare with a real screen reader:** for 5 fixture pages, record what NVDA + Chrome says (manually, once) and check the transcript gives the same role, name and states in the same order. Wording differences are fine; missing or extra items aren't. Repeat when Chrome changes its accessibility tree in a way that affects the transcript.

---

## Decisions needed

1. **Wording style:** neutral NVDA-like wording (proposed), or a choice of NVDA / VoiceOver style in Options?
2. **Transcript in reports:** off by default (proposed) or on?
3. **Debugging bar:** is Chrome's "started debugging this browser" bar acceptable to testers while the view is open? It can't be hidden; the HTML fallback is the only way to avoid it.
4. **Later, outside the extension:** add real NVDA/VoiceOver runs to CI with Guidepup for critical flows? Not part of this plan.
