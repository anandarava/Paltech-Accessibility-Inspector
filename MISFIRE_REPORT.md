# Real-site test: misfires and misses

**Date:** 2026-10-15
**Build:** main @ fbe23b5
**Settings:** WCAG 2.2 AA, best practices on, 1280×800 viewport

**Sites scanned (14):**
- gov.uk
- NASA
- W3C WAI
- BBC News
- Wikipedia ("Accessibility")
- MDN (`<b>` page)
- WordPress.org
- Python.org
- Apple
- Microsoft
- GitHub
- Stack Overflow (questions)
- W3C BAD demo (inaccessible "before" page)
- Deque Mars demo

Three sites could not be scanned:
- Allbirds and Airbnb: certificate/proxy error.
- india.gov.in: "Access Denied" (bot block).

**Verdicts:**
- **MISFIRE:** the finding is wrong.
- **NOISE:** technically true, but should not be reported this way: hidden, third-party, duplicated or wrong type.
- **CORRECT:** a real problem.

Nothing has been changed in the code yet. This list is for review only.

---

## 1. Summary, ordered by impact

| # | Rule | Where | Wrong findings | Verdict | Cause (short) |
|---|---|---|---|---|---|
| 1 | CLR-05 focus contrast | SO 34, WordPress 32, Mars 17, Python 11 | ~94 | MISFIRE | Chrome's default `outline: auto` ring is read as a dark #101010 outline |
| 2 | CLR-05 focus contrast | gov.uk 80, SO 39, WordPress buttons | ~120 | MISFIRE | Multi-part focus styles (outline plus ring plus underline) are judged by one part only |
| 3 | CLR-03 contrast over image | Wikipedia 113, Python ~104 | ~217 | NOISE | Small link icons (background-image) beside the text count as "text over an image" |
| 4 | CLR-03 contrast over image | Mars 19 | 19 | MISFIRE (hides real failures) | Images clipped by an `overflow:hidden` carousel are still treated as being behind the text |
| 5 | TGT-01 target size | Wikipedia 98 | 98 | MISFIRE | The inline-link exception only looks at the direct parent; citation links in `<sup>` are inline |
| 6 | TGT-01 target size | Apple 13, SO 1, WordPress 1, W3C WAI 1, Mars ~2 | ~18 | MISFIRE | Hidden skip links (1×1), `pointer-events:none`, clipped or covered elements |
| 7 | KBD-06 focus hidden by sticky header | MDN 26, GitHub 1 | 27 | MISFIRE | The check scrolls with `block:"nearest"`, which real keyboard focus never does; an invisible loader counted as a cover |
| 8 | CLR-04 non-text contrast (borders) | MDN 8, Wikipedia 6, GitHub 5, W3C WAI 2, SO 2, BBC 1 | 24 | MISFIRE | Transparent borders accepted as a boundary; text buttons do not need one |
| 9 | STR-01/02/03/05 page structure | BBC, MDN, Microsoft, NASA (4 each) | 16 | MISFIRE | Page-level rules (title, lang, h1, landmarks) run inside empty ad or tracking iframes |
| 10 | ZM-03 clipped text on zoom | Mars 9 | 9 | MISFIRE | Paragraph margins inflate `scrollHeight`; slides that really are cut off are missed |
| 11 | KBD-05 no visible focus | Apple 7, GitHub 1, Microsoft 1 | 9 | MISFIRE | Focus ring drawn by `::before`/`::after`, an ancestor (`:focus-within`) or inside shadow DOM |
| 12 | ARIA-01 (Semi) | Apple 16 | 16 | NOISE | Elements in hidden carousel slides |
| 13 | ARIA-02 (Semi) | Microsoft 4 | 4 | MISFIRE | Custom elements treated as unnameable; rated Critical |
| 14 | ARIA-03 | SO 3 (and 1 under-rated) | 4 | MISFIRE | 3 references point at ids that do exist; 1 with **all** ids missing should be Auto, not Semi |
| 15 | CLR-01 text contrast | gov.uk 1, Mars 2 | 3 | MISFIRE | Text hidden by `text-indent:-5000px`; text in offscreen, `aria-hidden` Facebook iframes |
| 16 | LNK-03 vague link text | MDN 1 | 1 | MISFIRE | `<a><code>link</code></a>`: "link" is the role name, not vague text |
| 17 | FRM-08 label/name mismatch | Apple 1 | 1 | MISFIRE | axe (experimental rule) counts invisible badge text "0 +" |
| 18 | STR-06 content outside landmarks | gov.uk 1 | 1 | NOISE | The skip link is flagged because cookie-banner links come before it |
| 19 | All Needs review items | everywhere | — | Wrong severity | Severity uses the rule's top severity instead of the actual impact (Microsoft ARIA-02 shows Critical) |

**Total:** roughly **560 of ~1,550 findings** are misfires or noise. More than half of these come from items 1–5.

### Fix status: step 1 (quick wins), done 2026-10-15, not committed

I re-scanned the same 14 sites after the fixes.
- **All findings:** 1,650 → 1,334.
- **Definite findings:** 962 → 683.

| # | Fix | Result on the live sites |
|---|---|---|
| 1 | Chrome's default `outline: auto` ring is treated as passing | CLR-05: Stack Overflow 74 → 42, WordPress 33 → 1, Mars 17 → 0, Python 11 → 0. What remains is item 2. |
| 4 | Images count only with the part a clipping container shows, unless the container also holds the text | Mars: "Countdown" (1.87:1), "Be Bold" and "Step out" are definite CLR-01 again. CLR-03: Mars 95 → 86, Apple 82 → 75. |
| 5 | The inline exception looks through `<sup>`/`<span>` wrappers | TGT-01: Wikipedia 98 → 2 |
| 8 | CLR-04 skips buttons and transparent borders | CLR-04: 25 → 1 (the Stack Overflow search box, which is correct) |
| 9 | Page-level rules are not applied inside child frames; language only when the frame shows text | STR-01/02/03/05: BBC 16 → 0, MDN 15 → 0, Microsoft 13 → 0, Mars 12 → 2 (top page, correct) |
| 15 | Text pushed out of its own box, or above or left of the page, is skipped. Frames nobody can see are dropped. Ratios are truncated (4.49, not 4.5). | gov.uk "Search GOV.UK" gone; Mars Facebook "SECURITY WARNING" ×2 gone |
| 16 | `<a><code>link</code></a>` is not vague | MDN LNK-03 1 → 0 |
| 17 | axe's label/name mismatch dropped when the control shows no text | Apple FRM-08 1 → 0 |
| 18 | axe's `region` dropped on a skip link to a landmark | gov.uk STR-06 2 → 1 (the remaining one is correct) |
| 19 | Needs review severity uses axe's impact, at most Serious | Microsoft ARIA-02 Critical → Serious |

### Fix status: step 2 (medium fixes), done 2026-10-15, not committed

I re-scanned the same 14 sites after step 2.
- **All findings:** 1,334 → 955. At the start of testing it was 1,650.
- **Definite findings:** 683 → 537. At the start of testing it was 962.

| # | Fix | Result on the live sites |
|---|---|---|
| 2 | Every part of a focus indicator is measured and the best part counts. Inset rings and outlines drawn inside the element (negative offset) are measured against the element's own fill. | CLR-05: gov.uk 80 → 1, Stack Overflow 42 → 1, Microsoft 9 → 0, W3C WAI 1 → 0 (definite) |
| 2+ | Found while testing: two older bugs. (a) Border focus indicators were never measured, because `rgb(…)` colours were split on spaces. (b) The previous element's `:focus-within` style leaked into the next element's unfocused state. | W3C WAI search button and Microsoft skip link now judged correctly |
| 3 | A no-repeat icon beside the text is ignored. A gradient is measured against each of its colours: pass on all = pass, fail on all = CLR-01, mixed = CLR-03 with the range. | CLR-03: Wikipedia 113 → 19, Python 106 → 22, Mars 86 → 60. Python CLR-01 48 → 56: 8 real failures that were hidden in Needs review (#999 on a near-white gradient, 2.77:1; footer #75a8d3 on dark blue, 4.2:1). |
| 6 | Not targets: `pointer-events: none`, visually hidden (1×1, clip, opacity 0), clipped away, or covered at the centre | TGT-01: Apple 13 → 0, Stack Overflow 1 → 0, WordPress 1 → 0, W3C WAI 2 → 1. Mars 38 → 33 (links in hidden tabs and in carousel slides that are out of view). |
| 7 | KBD-06 tabs through the elements in order with real `focus()`, keeping the scroll position like a keyboard user, starting at the top. Invisible covers (opacity 0, ≤ 2px) are ignored. | MDN 18 → 0, GitHub 1 → 0. Stack Overflow 5 → 23: **all** are the OneTrust cookie banner covering focused links at the bottom of the screen. That is a real 2.4.11 problem while the banner is shown; grouping (step 3) will make it one item. |
| 12 | A hidden copy of a role already reported as not allowed is dropped | Apple ARIA-01 16 → 0 (needs review), Wikipedia 5 → 0 |
| 14 | axe's open popup references are dropped when the id exists or the control is collapsed. `aria-labelledby` with no existing ids becomes definite. | Stack Overflow ARIA-03: 3 popup cases dropped, 1 now definite. The 40 broken `aria-describedby` remain for grouping. |
| 13 | Microsoft ARIA-02 (custom elements) | Left as Needs review (now Serious, not Critical, from step 1). axe cannot see a custom element's built-in role, so a person must check. |

### Fix status: step 3 (hard fixes), items 10 and 11 done 2026-10-15, not committed

| # | Fix | Result on the live sites |
|---|---|---|
| 10 | ZM-03 now looks at where the text lines are, not at `scrollHeight` (paragraph margin raised it). Text shortened on purpose (line-clamp, ellipsis) goes to Needs review. | Mars 9 → 7, and the 7 are real: with the spacing, the last lines sit at 115–148 px in a 120 px slide. Stack Overflow's 12 clamped question excerpts are now Needs review (13). NASA 3 unchanged (correct). |
| 11 | When the element itself does not change, its ::before/::after, 3 ancestors, first 20 descendants and its web component's shadow content are compared unfocused vs focused. Page transitions are switched off while measuring. | KBD-05: Apple 7 → 0, GitHub 1 → 0, Microsoft 2 → 1. Mars 2 unchanged (correct). |

**Two new correct findings** appeared once transitions were switched off (checked live):
- **GitHub:** a 2px outline drawn inside a #1f6feb button in the same #1f6feb, so it is invisible.
- **Microsoft:** a dark #0e1726 outline on a #0e1726 band around a light button.

**Grouping of repeated findings (option A), done 2026-10-15, not committed.**
- **What it does:** inside each rule, elements with the same cause are listed under one expandable "label × N" row, in both the side panel and the HTML report.
- **What does not change:** counts, score, ignore and baseline.
- **Result on the live sites:**
  - Python CLR-01: 56 → 8 causes.
  - Stack Overflow KBD-06: 20 → 1 cause (the OneTrust banner).
  - Stack Overflow ARIA-03: 40 → 4 causes.
  - Stack Overflow ZM-03: 13 → 1 cause (the clamped excerpts).
  - Mars CLR-03: 60 → 4 causes.

**Remaining focus-contrast findings (CLR-05), each checked live:**
- **gov.uk skip link:** a yellow outline on white (1.34:1). The link is hidden until focused and then appears as a yellow block with black text; the yellow itself does not reach 3:1 against the page.
- **Stack Overflow, 1 button:** a grey outline at 2.26:1. Correct.

**Watch:**
- **Apple, new CLR-01, "Today's Hits":** the gallery slide is off the left edge and its image had not loaded yet (a 1×1 placeholder), so the text was measured against the placeholder colour (#c69851). Correct for what is on screen, but the real image may change it.
- **MDN STR-06 5 → 8:** `region` hits inside MDN's live-example frames, which were not loaded in the first scan. This is not caused by these changes; it fits item 18 / grouping later.

---

## 2. Details

### 1. CLR-05: `outline: auto` read as a dark outline (~94)
- **Seen on:** Stack Overflow 34, WordPress 32, Mars 17, Python 11, and the ministryoftesting footer.
- **Evidence:** the element uses the browser's default focus ring, `outline-style: auto`. Chrome draws this as a two-colour ring (dark plus white) that is visible on any background. We take `outline-color` (#101010 / currentColor) and report low contrast against a dark background.
- **Suggested fix:** when `outline-style` is `auto`, treat the indicator as passing (Chrome's dual ring meets 3:1 on any background), or report it at most as Semi.

### 2. CLR-05: multi-part focus indicators judged by one part (~120)
- **Seen on:**
  - gov.uk 80: a yellow background plus a black underline or inset ring.
  - Stack Overflow 39: a 1px white ring plus a 3px blue ring.
  - WordPress buttons: an outline plus an inset white ring.
- **Evidence:** the check stops at the first visible layer and measures only that. The other layer gives the real contrast.
- **Suggested fix:** measure every part (outline, each box-shadow, border, background and underline) and pass if **any** part reaches 3:1.

### 3. CLR-03: link icons counted as images behind text (~217, noise)
- **Seen on:** Wikipedia 113 (external-link icons), Python ~104 (icon fonts and sprite icons beside links).
- **Evidence:**
  - The background image is a 12–16px icon placed **next to** the text, not under it.
  - On Python, a hidden skip link is also checked.
  - The Apple, NASA and Microsoft media findings are real images under text, and those are correct.
- **Suggested fix:**
  - Ignore background images smaller than about 24px, or images that do not overlap the text's own box (the text range rect, not the element rect).
  - Skip visually hidden text.

### 4. CLR-03: clipped carousel images hide real contrast failures (Mars 19)
- **Evidence:**
  - A 2800px carousel `ul` sits inside an `overflow:hidden` box, so its images reach far outside the visible area.
  - The text that gets demoted to "needs review" has no image behind it (`elementsFromPoint` confirms this).
  - Real failures are lost this way: "Countdown..." is **1.87:1**, "Be Bold..." 4.32:1, "Step out of your comfort zone" 4.495:1.
- **Cause:** `collectMedia` / `overlapsMedia` in `contrast.ts` use the raw image rect without clipping it to its ancestors.
- **Suggested fix:** intersect the media rect with every `overflow ≠ visible` ancestor, or require the image to appear in `elementsFromPoint` at the text centre.
- **Still to check:** whether the same cause explains part of the Apple 82, NASA 41 and Microsoft 35 counts.

### 5. TGT-01: citation links in `<sup>` (Wikipedia 98)
- **Evidence:** the `[1]`, `[2]` reference links and `^` backlinks sit in `<sup>` inside a sentence. WCAG 2.5.8's "inline" exception applies, but `isInlineInSentence()` only looks at the `<sup>`'s own children, so it finds no surrounding text.
- **Suggested fix:** walk up through inline ancestors (`sup`, `sub`, `span`, `cite`, etc.) until a block container, then check that container for sentence text.

### 6. TGT-01: hidden, disabled-pointer or clipped targets (~18)
- **Apple 13:**
  - elements with `pointer-events:none`, which cannot be clicked;
  - sr-only clipped links.
- **Stack Overflow, WordPress:** the skip link is 1×1 until focused. It is not a pointer target.
- **W3C WAI 1, Mars ~2:** the element is covered by another element or clipped by `overflow`.
- **Mars ~35 and W3C BAD:** these are correct.
- **Suggested fix:** skip elements with `pointer-events:none`, visually hidden or clipped elements (reuse `isShown()`), and targets whose centre is covered according to `elementFromPoint`.

### 7. KBD-06: focus hidden by a sticky header (MDN 26, GitHub 1)
- **MDN 26/26:** the check calls `scrollIntoView({block:"nearest"})`, which places the element right at the top edge, under the sticky header. Real Tab focus scrolls the element further into view and respects `scroll-padding-top`, which MDN sets.
- **GitHub:** the skip link was never actually focused, and an opacity-0, 2px loader bar was counted as covering it.
- **Stack Overflow 2:** these are correct (the OneTrust cookie banner covers the focused element).
- **Suggested fix:**
  - Focus the element for real (`el.focus()`) and let the browser scroll it.
  - Only count covers that are visible: opacity above 0, a real size, and not `pointer-events:none`-only overlays.

### 8. CLR-04: borders that do not matter (24)
- **Seen on:** MDN 8, Wikipedia 6, GitHub 5, W3C WAI 2, Stack Overflow 2 of 3, BBC 1.
- **Evidence:**
  - A border with `transparent` colour is measured as if it were visible.
  - Buttons and links identified by their text do not need a visible boundary (WCAG 1.4.11: no boundary is required when the text identifies the control).
- **The Stack Overflow search input is correct.**
- **Suggested fix:**
  - Ignore transparent or zero-width borders.
  - Only require a boundary for inputs and controls that have no text label inside them.

### 9. STR-01/02/03/05 inside empty iframes (16)
- **Seen on:** BBC, MDN, Microsoft, NASA (4 findings each).
- **Evidence:** ad and tracking iframes with no content get "no title", "no lang", "no h1" and "no landmarks".
- **Suggested fix:** run page-level structure rules only on the top document, or skip frames that are hidden, tiny (under 10px) or have no visible text.

### 10. ZM-03: clipped text on zoom (Mars 9/9)
- **Evidence:** `scrollHeight` is larger than `clientHeight` only because the last paragraph's bottom margin spills over, and no text is cut off. At the same time, the slides on Mars that really are cut off were not reported.
- **Also:** Stack Overflow 12 are real but intentional excerpts (`line-clamp` on question previews), so they are better as Semi and grouped. NASA 3 are correct.
- **Suggested fix:**
  - Compare the last text line's rect with the box instead of using `scrollHeight`.
  - Report intentional `line-clamp`/ellipsis as Semi.

### 11. KBD-05: no visible focus indicator, when there is one (9)
- **Apple 7:** the ring is drawn on `::before`/`::after`, or on a parent element.
- **GitHub 1:** the ring is on the ancestor through `:focus-within`.
- **Microsoft 1:** the ring is inside the shadow DOM.
- **Mars 2:** these are correct.
- **Mars "needs review" 6:** these are partly noise, because a "page not focused" note is repeated for every sub-iframe. One note per scan is enough.
- **Suggested fix:**
  - Also compare the styles of the `::before`/`::after` pseudo-elements and up to 3 ancestors before and after focus.
  - Compare a screenshot crop of the area when nothing changes in styles.

### 12–14. ARIA
- **ARIA-01 Apple 16 (Semi):** the elements are in hidden carousel slides. These should be skipped like other hidden content.
- **ARIA-02 Microsoft 4:** custom elements (e.g. `<mscom-…>`) are not `div`/`span`, so our own check does not flag them. The finding comes from axe's "incomplete" result, and the severity is then raised to Critical (see item 19). It should be dropped or shown as low-severity review.
- **ARIA-03 Stack Overflow:**
  - 38 of the 42 Semi findings are correct but noisy (the same component repeated). They should be grouped.
  - 3 are misfires: the ids exist at scan time, most likely inside a template or shadow root, or added late.
  - 1 `aria-labelledby` where **every** id is missing is shown as Semi but should be Auto.
- **Correct, but duplicated (grouping needed, see section 3):**
  - Apple STR-08 18;
  - Python ARIA-05 61 and STR-14 33;
  - the custom ARIA-02 on Apple `<sup>` and on Wikipedia.
- **Missed:** MDN `aria-label` on a `<span>` inside shadow DOM. The custom check does not look into shadow roots.

### 15. CLR-01: text that cannot be seen (3)
- **gov.uk 1:** the "Search GOV.UK" text is moved away with `text-indent:-5000px; overflow:hidden`, and the button shows only an icon.
- **Mars 2:** "SECURITY WARNING" comes from the Facebook `xd_arbiter` iframes, which are `aria-hidden` and placed at y = -10000.
- **Small wording issue (Mars):** a ratio of 4.4955 is shown as "4.5:1 … 4.5:1 is required", which looks contradictory. When it fails, show the value rounded **down** (4.49:1).
- **Suggested fix:**
  - Check that the text's own range rect is inside its `overflow:hidden` ancestor.
  - Skip frames that are offscreen or `aria-hidden`.

### 16. LNK-03: MDN `<code>link</code>` (1)
- **Suggested fix:** do not flag a link whose only content is a `<code>` element, or whose text matches the last part of its URL.
- **Optional, best practice:** treat a meaningful `title` the same as `aria-describedby`. This affects 3 Python "More" links that have `title="More Events"` and similar.

### 17. FRM-08: Apple shopping-bag button (1)
- **Evidence:** the only "visible" text is "0 +" inside an `aria-hidden`, 0×0 badge.
- **Suggested fix:** drop the finding when the element has no visible, non-hidden text, or report axe's experimental rules as Semi. The 6 Microsoft FRM-08 findings are correct ("Shop now" vs "Shop Surface Pro…").

### 18. STR-06: gov.uk skip link (1)
- **Evidence:** axe's skip-link exemption fails because three cookie-banner links come before the skip link in the DOM.
- **Suggested fix:** skip `region` findings for an in-page link that points at an existing `main` or landmark.

### 19. Severity of Needs review items
- **Cause:** `mapAxeRule` uses `def.severity ?? impact`, so every axe "incomplete" result gets the rule's highest severity. For example, a minor axe review becomes Critical.
- **Suggested fix:** use axe's own `impact` for incomplete results, capped at Serious.

---

## 3. Correct findings that are too noisy (grouping)

These are real problems, but the same thing is repeated many times, which makes the list hard to read.

| Site | Rule | Count | What repeats |
|---|---|---|---|
| Python | CLR-01 | 40 of 48 | Each coloured syntax token in one code example |
| Python | ARIA-05 / STR-14 | 61 / 33 | The same footer sitemap pattern |
| Apple | STR-08 | 18 | One finding per element sharing a duplicate id, rather than one per id |
| Stack Overflow | ARIA-03 | 38 | The same component on every question row |
| Stack Overflow | ZM-03 | 12 | Intentional excerpt clamping |
| Mars, W3C WAI | LNK-05, ARIA-02 | 4 | Inside YouTube/Facebook/Twitter iframes (third-party; the author cannot fix them) |

**Suggested fix:**
- Merge findings with the same rule and the same cause (same colours, same pattern or same id) into one finding with "× N elements".
- Mark findings from cross-origin frames as **third-party**.

---

## 4. Missed issues (the extension should have caught these)

Found on the two deliberately broken demos.

| Page | Missed problem | Rule that should catch it | Notes |
|---|---|---|---|
| Mars | "Countdown..." 1.87:1, "Be Bold..." 4.32:1, "Step out..." 4.495:1 | CLR-01 | Lost because of the clipped-carousel bug (item 4) |
| Mars | Two Facebook iframes are `aria-hidden="true"` but reachable by Tab (Tab stops 5 and 6, offscreen) | ARIA-04 / KBD-05 | axe missed it. Easy custom check: `[aria-hidden=true]` with `tabIndex >= 0` |
| Mars | The "Special Offers" carousel moves by itself with no pause button | none (2.2.2) | New Semi check possible |
| W3C BAD | 14 links use `onfocus="blur()"`: focus is removed as soon as it lands (W3C failure F55) | KBD-05 | `focus-visible.ts:248` silently skips elements that lose focus. They should be reported instead |
| W3C BAD | Decorative bullet images with `alt="bullet"` | IMG-03 | Add "bullet", "arrow", "dot" and "border" to the generic-alt word list |
| W3C BAD | Logo alt is about 330 characters long | IMG (Semi) | No alt-length check exists (for example, more than 150 characters) |
| W3C BAD | Background-image `div` whose only text is `title="image"` | IMG-03 (Semi) | Only `img`/`svg` are checked |
| W3C BAD | `<select onchange="location.href=…">` navigates on change (3.2.2) | none | New Semi check possible |
| W3C BAD | Fake headings: `p.subheadline` and `<font><b>` bold text | STR-12 | Only `p.headline` was caught |
| W3C BAD | Bullet-image fake lists, hover-only image swaps | STR-14 / none | Hard to automate; low priority |
| MDN | `aria-label` on a `<span>` inside shadow DOM | ARIA-02 | The custom check does not enter shadow roots |
| Mars | Controls in hidden tabs (unlabelled selects, positive tabindex, broken `label for`) | FRM-01 / KBD-03 | Expected: hidden panels are skipped. Full coverage needs each tab opened |

**Covered correctly on W3C BAD:**
- missing alt (33);
- image links with empty alt (7);
- "Click here" / "Read more" links;
- contrast;
- missing `lang`;
- the unlabelled select.

---

## 5. Checked and correct (no change needed)

- **CLR-01:**
  - Wikipedia 7 (navbox title bars 3.49:1);
  - W3C BAD 2;
  - Stack Overflow 1;
  - Python 8 footer links.
- **LNK-05:**
  - MDN 12;
  - Mars 7 (plus 3 third-party);
  - Stack Overflow 3;
  - W3C BAD 2.
- **LNK-03:**
  - W3C BAD 4;
  - Python 5 (3 borderline, see item 16).
- **FRM-08:** Microsoft 6.
- **KBD-01 (Semi):**
  - Mars 7 (`<a>` with no href);
  - Python 5 (slide pager).
- **STR-06:** gov.uk feedback heading outside landmarks.
- **TGT-01:**
  - Mars ~35;
  - W3C BAD.
- **KBD-06:** Stack Overflow 2.
- **ZM-03:** NASA 3.
- **KBD-05:** Mars 2.
- **CLR-04:** Stack Overflow search input.

## 6. Limits of this test

- Pages are live and may change. A few counts could differ if the scan is run again.
- Only the desktop size (1280×800) and the first view were tested: no logged-in pages, and no tabs or menus opened.
- Not yet checked: whether the CLR-03 clipping bug (item 4) also explains the Apple, NASA and Microsoft counts.

---

# Round 2: validation on 14 new sites (2026-10-15)

**Build:** misfire-fixes branch (steps 1–3, plus cause grouping, which is not committed yet).
**Settings:** WCAG 2.2 AA, best practices on, 1280×800.

**Sites (14):**
- USA.gov
- Canada.ca
- The Guardian
- WebAIM
- A11Y Project
- react.dev
- Stripe
- Shopify
- Harvard
- NHS
- Slack
- Mozilla
- W3Schools
- W3C BAD survey demo

**Not usable:**
- IKEA and Booking.com: certificate error.
- eBay, Medium and NYTimes: bot-block pages.

**Overall:** none of the misfires fixed in round 1 came back. The problems found are new patterns, plus one regression caused by our own gradient fix (R2-1).

Verdicts below come from checking findings on the live pages.

## Misfires, ordered by impact

| # | Rule | Where | Wrong | Cause | Suggested fix |
|---|---|---|---|---|---|
| R2-1 | CLR-01/02 | Harvard 28 | 28 | **FIXED 2026-10-16 (Harvard 28 → 0, Shopify 3 → 0, Mozilla 4 → 0).** **Regression from step 2:** a hover-underline gradient (`background-size: 0px 2px`) is measured as if it filled the text background, giving fg = bg and a ratio of 1. | Work out each gradient layer's painted area (size, position, repeat) like url icons; skip layers with zero area, thin layers, or layers not under the text lines |
| R2-2 | CLR-03 | Stripe 71, Shopify 11, Mozilla 6, react.dev 4, Harvard 2, W3Schools 2 | ~96 | An image counts as "behind the text" even when an opaque box sits between them: the text's own button or chip, or a white card that does not contain the image | Only count media inside the text's nearest opaque-background ancestor, or use `elementsFromPoint` at the line centres and stop at the first opaque layer |
| R2-3 | CLR-03 | Shopify 6 chips | 6 | A multi-layer background whose top layer is a solid gradient (`linear-gradient(#181d20,#181d20)`) still counts the image under it | Treat an opaque, uniform top layer as the background and ignore the layers under it |
| R2-4 | CLR-03 / CLR-02 | Mozilla 4, Shopify 3+1 | 8 | Underline gradients (as R2-1), and an ancestor's `background-clip: text` gradient treated as the background | Same as R2-1; leave `background-clip: text` layers out of the background |
| R2-5 | KBD-06 | Guardian 33 | 33 | A full-screen consent dialog (fixed, 1280×800, page scroll locked, focus trapped inside) gives one finding per element behind it | A cover filling about 90% or more of the viewport, or a modal dialog/iframe: one Needs-review note "a modal overlay covers the page" |
| R2-6 | KBD-01 | Guardian 95 review, A11Y Project 7 | ~100 | Card patterns: an image overlay with `cursor: pointer`, or an onclick div, where the same card already has a link (same place or same href) | Skip when the card holds a focusable link to the same place; never report descendants of an element already reported |
| R2-7 | CLR-05 | Shopify 12 | 12 | `outline: auto` in an author colour: Chrome also draws a white outer ring, but only the default colour (#101010) is exempted | For any `outline: auto`, also count a white part against the surrounding colour |
| R2-8 | CLR-05 | Mozilla 2, NHS 1 | 3 | A strong background change (field turns white, button turns yellow) is ignored once any ring part exists | Add the background change as one more part; pass if it reaches 3:1 |
| R2-9 | KBD-05 | Harvard 4, Stripe 2, A11Y Project 1, WebAIM 1 | 8 | Missed indicators: an underline that grows via `background-size` (not compared); a ring on a sibling element; skip links that slide or un-clip into view on focus | Compare `background-size/position`; include the parent's other children; treat "moves into view or becomes visible on focus" as an indicator |
| R2-10 | KBD-04 | Slack 21, Guardian 6, Shopify 6 | 33 | axe `focus-order-semantics` (experimental) is mapped to 2.4.3 Focus order; it is really "tabindex without a role" | Map it to a best-practice or 4.1.2 review rule |
| R2-11 | OTH-03 | 6 sites, 8 | 8 | Orientation-lock review inside empty about:blank or tracking frames: the hidden-frame skip does not cover about:blank or empty frames | Apply the hidden-frame check to about:blank/srcdoc frames; treat `css-orientation-lock` as page-level (top frame only) |
| R2-12 | STR-06 / STR-13 | Guardian 6 + 2 + 1 | 9 | `region` inside a consent iframe that sits in a dialog; deprecated axe rule `landmark-complementary-is-top-level` on an aside that is not a landmark; axe `frame-tested` for a frame we did scan | Drop `region` in child frames; drop deprecated axe rules; build STR-13 only from our own unscanned frames |
| R2-13 | MED-01 / MED-02 | Guardian, Harvard, Shopify, Slack | 14 | Caption/autoplay reviews on muted background videos with no controls, or an invisible player with no source | Skip muted videos with no controls (read the `muted` property, not the attribute), and invisible videos or videos with no source |
| R2-14 | CLR-05 review | Slack skip link | 1 | Background-change comparison on a skip link that was off-screen before focus | Revealed-on-focus counts as the indicator (as in R2-9) |
| R2-15 | KBD-06 review | W3Schools 2 | 2 | Measured before the site's own scroll-on-focus finished (the link is fully visible about 0.8 s later) | Wait until scroll positions stop changing (about 2 frames or 300 ms) before checking, or re-check once before reporting |
| R2-16 | Small | various | ~10 | - Stripe "Link" is a product name (LNK-03). - A Guardian `href="#"` action link is flagged for opening a new window (LNK-05). - Stripe FRM-08 ×2: the name comes from the card's own visible title. - Mozilla OTH-02: an empty `<blink>` spacer. - Canada.ca ARIA-05: an empty, collapsed listbox. - NHS/Stripe FRM-11: a placeholder plus a button beside it; a value-showing combobox button. - KBD-05 on an `<iframe>`. - Slack ARIA-03: a duplicate of ARIA-01 on the same element. - A11Y Project STR-12: from an experimental rule. | Individual small fixes: skip href "#"/"javascript:" for LNK-05; text equal to the URL's last part for LNK-03; experimental axe rules as needs review; and so on |

## Correct but noisy (volume)
- **Repeated causes:** cause grouping now collapses W3Schools CLR-01 (24 single `<`/`>` brackets), Stripe's 23 animated counter digits, NHS's 5 cookie-banner `region` nodes and Slack STR-08 (one id ×18 copies, identical text).
- **W3Schools STR-06 ×128 and W3C survey ×20:** these pages have no `main`, so every block is reported. Suggestion: one finding "N blocks outside landmarks" when STR-05 also fires.
- **Canada.ca CLR-03 ×6 and WebAIM ×5:** they pass in reality (90% overlay over a picture; a mostly white image). A possible later improvement is blending a translucent overlay over black and white.

## Correct findings worth promoting
- **CLR-06 link colour vs text:** react.dev ×4 (2.01:1, no underline) and Stripe ×1 (1:1) are definite failures; promote to definite when below 3:1 with no underline or weight difference.
- **W3Schools carousel arrows (CLR-03):** they really fail (2.56–2.77).
- **react.dev "example.com":** reported as 2.59 but really 2.2. Translucent layers between a gradient and the text are not composited.

## Verified correct
- **CLR-05:** Guardian 60, W3Schools 23, Slack 6, A11Y Project 6, Stripe 5, Shopify 3 buttons.
- **CLR-01:** W3Schools 52, react.dev 4, Stripe 4.
- **CLR-04:** 3 (Canada.ca, W3Schools, WebAIM).
- **CLR-03:** Guardian 32, plus real image/video cases on Stripe, Shopify, Harvard and react.dev.
- **TGT-01:** Guardian 25, W3Schools 18, W3C survey 2.
- **KBD-05:** Guardian consent `h1`/`p` ×6.
- **LNK-05:** 69.
- **FRM-08:** W3Schools 3, react.dev, Shopify, Stripe 1.
- **ZM-03:** Guardian 1, W3Schools 1.
- **ARIA-01/02:** Guardian, Slack, W3Schools.
- **STR-04/05/02:** all.
- **IMG-08 reviews:** react.dev 14 and others.
- **FRM-03.**

## Missed on the W3C BAD survey page
| Missed barrier | Rule | Automatable? |
|---|---|---|
| Nav links with `onfocus="blur()"` throw focus away (F55); also missed in round 1 | KBD-05 | Yes: after `focus()`, check whether `activeElement` is still the element |
| `<p class="headline">` used as headings; the content has no h2–h6 | STR-12 | Heuristic (needs review) |
| Data table with no `<th>`; bold `<td>` used as the header row | STR-07 | Heuristic (needs review) |
| Layout tables using `<th>` (F46); axe `td-has-header` fires but is not mapped to any project rule | STR-07 | Yes (map the axe rule) |
| `<select onchange="location.href=…">` navigates as soon as it changes (3.2.2) | new | Heuristic |
| Logo alt of about 350 characters | IMG-03 | Heuristic (needs review) |
| A Guardian accessible name containing raw HTML (`aria-label="<span …>"`) | ARIA-03 | Yes |

## Round 2, group 2 fixes (gaps in earlier fixes), done 2026-10-16

| Fix | Result on the live sites |
|---|---|
| `outline: auto` in any colour also counts Chrome's white outer ring | Shopify CLR-05 15 → 3 (the 3 left are real solid outlines) |
| A strong background change next to a ring counts as part of the indicator | Mozilla 2 → 0, NHS 1 → 0 |
| KBD-05: compares `background-size`/`position`, includes siblings in the same parent, and treats "comes into view on focus" (skip links) as the indicator | Harvard 4 → 0, A11Y Project 1 → 0, WebAIM 1 → 0, Slack skip-link review 1 → 0 |
| Child frames: `region` and `css-orientation-lock` are page-level; an empty frame reports nothing | OTH-03 reviews 8 → 0 on the scanned frames; Guardian STR-06 11 → 5 |
| LNK-03: link text equal to the last part of its URL ("Link" at `/payments/link`) | Stripe 1 → 0 |
| KBD-06: a covered element is checked again after 350 ms | No change on W3Schools |

**Not solved yet:**
- **Stripe KBD-05 ×2:** the ring is on a button further up the card than the parent's children.
- **W3Schools KBD-06 ×2 (review):** still flagged even when re-checked 900 ms later, so the cause is not timing. It needs a closer look.
- **Stripe:** one new orientation-lock review in the top frame, which should be looked at.

## Round 2, group 3 fix (image behind an opaque box), done 2026-10-16

**The fix:** an image or video now counts as behind the text only when it is inside the text's nearest box with an opaque background (its own button, chip or card). Media outside that box is covered by it.

**CLR-03 (needs review), re-scanned live:**

| Site | Before | After |
|---|---|---|
| Stripe | 150 | 80 |
| Microsoft | 35 | 17 |
| Apple | 75 | 63 |
| Shopify | 22 | 18 |
| Mozilla | 6 | 0 |
| react.dev | 8 | 4 |
| Harvard | 6 | 4 |
| W3Schools | 1 | 0 |
| NASA | 41 | 40 |

Guardian (29) and Mars (60) are unchanged; those are real text over pictures.

**Now measured instead of sent to review (checked, correct):**
- Stripe: +8 CLR-01, orange "Continue" labels on a peach button, 2.41:1.
- react.dev: +2 CLR-01, "example.com" 2.17:1, matching the live measurement of 2.2.

**Not affected:** the W3Schools carousel arrows are still reported (CLR-02, definite).

**Left in this group:** Shopify's chips whose top layer is a solid gradient (R2-3) and Canada.ca/WebAIM translucent overlays are not covered by this fix.

---

# Round 3: validation on 13 new sites (2026-10-16)

**Build:** misfire-fixes, after groups 1–3 (commit 39c2a5b).

**Sites (13):**
- Australia.gov (myGov)
- Al Jazeera
- NPR
- Vue.js
- Tailwind
- Figma
- Notion
- Atlassian
- MIT
- WHO
- Spotify
- Duolingo
- GitLab

**Not usable:** Etsy and UK Parliament (bot check); Best Buy (certificate error).

**Checked on the live pages:** 1,198 findings.

| Verdict | Findings | Share |
|---|---|---|
| Correct | 618 | 52% |
| Known, not fixed yet (group 4) | 432 | 36% |
| Noise (true, but should not be reported this way) | 77 | 6% |
| New misfire | 71 | 6% |
| **Regression of a fix** | **0** | 0% |

**Known (group 4):**
- NPR cookie scrim: about 290.
- Tailwind with no `main`: 82.
- Cross-origin frames reported as "frame-tested": 17.
- Experimental axe rules: 13.
- Translucent overlays: about 19.
- Muted videos: 5.
- axe `focus-order-semantics`: 5.

**Comparison with earlier rounds:**
- Round 1: about 35% wrong.
- Round 2: about 33% wrong.
- Round 3: 6% new misfires, plus 36% from patterns already known but not fixed.

None of the fixed patterns misfired on these sites.

## New misfires (71)

| Cause | Where | Count | Suggested fix |
|---|---|---|---|
| The page shows focus rings only after a real key press (`no-focus-outline` class, what-input, focus-visible polyfill) | Spotify 18, NPR 2 (KBD-05) | 20 | Send a simulated Tab `keydown`/`keyup` to the page before the focus check |
| Lazy image not loaded yet (0 height), so the text was measured against the page colour | NPR 16 (CLR-01) | 16 | Text over an unloaded `img` (not complete, or 0 height) goes to review |
| Small links inside a whole-card click target | Spotify 10 (TGT-01) | 10 | A target inside a larger target: review at most, worded "inside a larger target" |
| Background painted by `::before`/`::after` (button fills) not considered | Duolingo 7 (CLR-01/03) | 7 | Use an opaque absolutely positioned pseudo-element covering the text as the backdrop |
| Cross-origin child frames report "page not focused" | WHO 2, Atlassian 1, Figma 1 | 4 | Focus inside the frame first, or emulate focus for frame targets; fix the wording |
| Scroll-reveal opacity (cards fade in when scrolled to) | NPR 3 | 3 | Opacity below 1 with a transition on an element outside the viewport goes to review |
| Ring or background on a positioned sibling (a tab indicator pill) | Atlassian 1 CLR-05, 1 CLR-01 | 2 | Use `elementsFromPoint` to find the box actually painted under the text or ring |
| Indicator added one frame after focus (React class swap, JS tilt) | Atlassian 1, Tailwind 1 | 2 | When nothing changed, wait one frame and measure again |
| Screen-reader-only clip on an ancestor, not on the element itself | NPR 2 | 2 | `isVisuallyHiddenText` should walk up the ancestors |
| Hard-stop 1px underline gradient filling the whole box | MIT 2 (CLR-03) | 2 | Treat "transparent except the last ≤2px" gradients as decoration |
| Empty `onclick=""`, and a slider with a range input beside it | Duolingo 1, Spotify 1 (KBD-01) | 2 | Ignore empty handlers; skip when a native control sits next to it |
| Rotating word re-measured by JavaScript | Notion 1 (ZM-03) | 1 | Re-check after a moment, or review when the width comes from an inline style |

## Noise (77)
- **Tailwind 17:** faint decorative class-name text inside `aria-hidden` illustrations. Suggestion: low-alpha `aria-hidden` text goes to review.
- **Duolingo 34:** language items in a carousel scrolled out of view. They are correct once scrolled in; grouping already collapses them.
- **NPR 19:** FRM-08 on the "i" caption toggles.
- **5 sites:** OTH-03 where axe could not read cross-origin CSS.

## Verified correct (highlights)
- **Duolingo KBD-05 120:** real `outline: none` with no replacement.
- **WHO CLR-05 14:** the best part is still under 3:1.
- **KBD-06:** Al Jazeera 13 and Spotify 3 (OneTrust bottom banner), Figma 1.
- **Contrast:**
  - Duolingo CLR-01 85 and CLR-02 11;
  - Vue 13;
  - Tailwind 12;
  - Notion 3;
  - GitLab CLR-03 17;
  - Notion CLR-03 9.
- **ARIA:** Spotify ARIA-01 107 and ARIA-05 56; GitLab, Tailwind and Australia.gov ARIA; NPR/Tailwind ARIA-02 31.
- **Other:**
  - MIT TGT-01 10;
  - ZM-03 on NPR, Spotify, Tailwind and WHO (18);
  - Al Jazeera FRM-08 9;
  - WHO LNK-03 7.

## Round 3 follow-up: A1, A2 and B1 fixed (2026-10-16)

| # | Fix | Result on the live sites |
|---|---|---|
| A1 | KBD-06: a cover over ≥85% of the viewport (cookie scrim, modal backdrop) is reported once as a Needs-review overlay note, and that scan's per-element results (which describe the open dialog) are dropped | NPR 305 → 1, Guardian 33 → 1. Al Jazeera's 13 real banner findings are kept (no full-screen scrim). |
| A2 | `region`: when the page has no main landmark, all "outside landmarks" findings are collapsed into one, with the count and examples | W3Schools 128 → 1, Tailwind 82 → 1, W3C survey 20 → 1, Guardian 8 → 2 |
| B1 | KBD-05: one simulated Tab keydown/keyup before measuring, so pages that show rings only in keyboard mode show them | Spotify 19 → 0, NPR 2 → 0, Guardian consent frame 6 → 0. These 6 were marked "correct" in round 2, but live they show a 4px blue ring after a key press. Duolingo's 120 real ones are unchanged. |

## A3 fixed: card patterns in KBD-01 (2026-10-16)

**Not reported any more:**
- an empty `onclick=""`;
- an element with no area;
- an element inside one already reported;
- a card part whose action the keyboard already has:
  - `onclick="location.href=X"` (its own or its card's) when the card has a focusable link to X;
  - a link drawn on top of the element's centre (hit-tested on screen; off screen, an absolutely positioned link that contains it);
  - a range input beside a slider track.

**Result on the live sites:**

| Site | Before | After | Note |
|---|---|---|---|
| Guardian | 95 | 1 | The remaining one is axe's real scrollable region |
| A11Y Project | 7 | 0 | |
| Duolingo | 1 | 0 | |
| Spotify | 1 | 0 | |
| W3Schools | 3 | 3 | Unchanged; the 1 review left is a scroll button |
| Mars | 7 | 6 | Real `<a>` without href and icon buttons kept |
| Python | 5 | 5 | Real `<a>` without href kept |

**Caught while testing:** a first version that accepted any nearby form control removed real Mars findings ("Add Another Trip", "Add A Traveler"). Narrowed to range sliders and hit-testing before committing.

## B2 and A4–A7 fixed (2026-10-16)

| # | Fix | Result on the live sites |
|---|---|---|
| B2 | Text positioned over a card whose image has not loaded yet (lazy, 0 height) goes to review as text over an image, unless the text has its own opaque box | NPR caption "i": 16 false CLR-01 → 0 (now 17 CLR-03 review); NPR CLR-01 22 → 5 |
| A4 | axe `focus-order-semantics` (experimental: "tabindex without a role") is no longer mapped to 2.4.3 Focus order, so it no longer runs | KBD-04: Slack 21 → 0, Guardian 6 → 0, Shopify 6 → 0, Figma 1 → 0 |
| A5 | axe `frame-tested` is dropped (frames are scanned by the extension; unreachable ones are listed as unscanned frames) | STR-13: Figma 10 → 0, Atlassian 6 → 0, Guardian 1 → 0 |
| A6 | Experimental axe rules go to Needs review; deprecated axe rules are dropped | Experimental definite findings: A11Y Project 1, Atlassian 1, Shopify 1, W3C survey 3 → 0 |
| A7 | `video-caption` / `no-autoplay-audio` dropped for a video nobody hears: muted with no native controls and no player buttons around it, or invisible | Atlassian 4 → 0, Slack 7 → 2. NPR's JW Player video is kept. |

**Caught and corrected while testing:**
1. A first version treated videos with no source as silent. That removed NPR's real JW Player videos, which load their source only on play, so the rule was removed.
2. The lazy-image check first missed NPR, because the image is in a sibling box. A stricter version then flagged a white card in the test page. The final rule uses the text's own opaque box.

**Note:** axe's `audio-caption` is marked deprecated by axe, so NPR's audio-player review (MED-01) is no longer listed.

**Not solved:** Guardian MED 2 → 4 and Shopify still 3. These are videos whose page has player buttons near them; they stay in review.

## Pending misfires batch (2026-10-17)

| # | Fix | Result on the live sites |
|---|---|---|
| B3 | A small target inside a larger target (whole-card click layer) is Needs review with "sits inside a larger target" wording | Spotify TGT-01: 10 definite → 0 (8 now review) |
| B4 | A fill drawn by an absolutely positioned `::before`/`::after` that covers the text is its background (and hides any image) | Duolingo: "Try 1 week free" passes (was 1.08:1); "Get started" now correct, 2.08:1 (was "1:1 white on white"); badge CLR-03 removed |
| B5 | Cross-origin frames: focus something inside the frame first; wording says "embedded frame", not "side panel" | WHO 3 → 2 (with correct wording) |
| B6 | Off-screen text in a card fading in (opacity transition) is review with a note | NPR scroll-reveal cards |
| B7 | Screen-reader-only clip on an ancestor; gradient transparent except its last ≤3px is an underline | NPR "Volume 90%"; MIT hard-stop underline links 2 → 0 |
| B8 | When nothing changes on focus, wait one frame and look again | Atlassian KBD-05 3 → 1 |
| C | LNK-05 skips `href="#"`/`javascript:`; KBD-05 skips `<iframe>`; FRM-11 skips value-showing buttons; empty `<blink>`/`<marquee>` dropped; empty, collapsed listbox (`aria-required-children`) dropped | Guardian LNK-05 3 → 2, Mozilla OTH-02 1 → 0, Canada.ca ARIA-05 1 → 0 |
| Test | The focus check left an empty `style=""` on elements it measured; it now removes it | The "scanning does not leave the page modified" e2e test passes for the first time (31/31) |

**Real findings kept:** Duolingo KBD-05 120, WHO CLR-05 14, MIT TGT-01 10.

**Not done:**
- A8: translucent overlays and solid gradient layers over images.
- B7c: tab pill drawn on a pointer-events:none sibling (Atlassian).
- B9: rotating headline word (Notion).
- Stripe card ring, W3Schools KBD-06 ×2, Slack duplicate ARIA-03 review.
- Missed-issue checks (section D).

## Remaining misfires and missed-issue checks (2026-10-17)

### Misfires
| # | Fix | Result |
|---|---|---|
| A8 | A solid single-colour gradient on top hides the image under it; text that passes over the overlay layers whatever the image shows (composited over black and white, including a positioned tinted band) is not reported | Canada.ca CLR-03 6 → 4 |
| B7c | An absolutely positioned sibling box under the text (a selected tab's pill) is its background | Atlassian CLR-01 2 → 1 |
| B9 | ZM-03 on a box whose width is set by script (inline width or custom property) goes to review | test page |
| C | Focus check also looks at the grandparent's content (rings on a card button); Slack's empty `aria-hidden=""` review dropped | Slack ARIA-03 review 5 → 0 |

### New checks (missed issues)
| Check | Rule | Type | Result |
|---|---|---|---|
| Element drops focus on arrival (`onfocus="blur()"`, F55) | KBD-05 | Definite | W3C BAD home 14, survey 4; 0 on real sites |
| Text styled as a heading when the page has no h2–h6 | STR-12 | Review | test page; 0 on real sites (W3C BAD has wrapper headings, so not fired there) |
| Data table without header cells; axe `td-has-header` mapped | STR-07 | Review | W3C BAD 1 + survey 2; 0 on real sites |
| Drop-down that navigates on change with no button | FRM-12 (new, 3.2.2) | Review | W3C BAD 1 + survey 1; 0 on real sites |
| Decorative shape words in alt ("bullet", "arrow" …); alt over 300 characters | IMG-03 | Definite / review | W3C BAD bullets 2 and the 343-character logo; a 150-character limit flagged 7 Guardian photo captions, so it was raised to 300 |
| aria-label containing HTML markup | ARIA-03 | Definite | test page |

**Also fixed:** all 32 browser tests now pass, including the long-failing "page not modified" test.

**Still open:**
- **Stripe KBD-05 ×2:** the ring is on an element further away than the grandparent.
- **Notion ZM-03 ×1:** its width does not come from an inline style.
- **W3Schools KBD-06 ×2:** cause unknown.
- **WebAIM CLR-03 ×5:** a mostly white image; needs pixel reading.
- **Some Shopify chips.**
- **STR-12 on pages that already have some headings:** not attempted.

## Last misfires and three more checks (2026-10-18)

### Misfires
| Item | Cause found | Fix | Live result |
|---|---|---|---|
| Stripe KBD-05 ×2 | Ring on a "Read the story" element deep inside the card | Look at the first 80 descendants (was 20) | 2 → 0 |
| Notion ZM-03 ×1 | Word width set by script on a parent | Script-set width on the box or 2 parents → review | 1 → 0 |
| Shopify chips | Solid gradient fill not seen as an opaque box | A solid single-colour top layer makes a box opaque | CLR-03 18 → 12 |
| WebAIM CLR-03 ×5 | Background image unreadable | Same-origin background images are read pixel by pixel and measured like a gradient | 5 → 0 |
| WebAIM KBD-05 ×4 + CLR-05 ×17 | "Flying focus": the page draws the ring on an overlay it moves onto the element. These findings also appear with yesterday's build, so the site's behaviour changed. | Recognise a page-level overlay that changes and surrounds the focused element | 21 → 0. The real findings elsewhere are unchanged (Guardian 61, W3Schools 22, WHO 14, Duolingo 120). |
| W3Schools KBD-06 ×2 | Not reproducible outside the extension; a real Tab and sequential focus both leave the link visible | — | Open (review only) |

### New checks
| Check | Rule | Live result |
|---|---|---|
| Elements Tab reaches inside `aria-hidden="true"` (iframes included) | ARIA-04 | Mars: the 2 Facebook frames now caught |
| Carousel that moves by itself with no pause control (watched 2.5 s) | OTH-02 (review) | Stripe's scrolling logo strip (real). Mars' carousel did not move within 6 s in tests, so it is not caught. |
| Background image described only by a generic `title` | IMG-03 (review) | W3C BAD: 3 |

---

# Round 4: 100-site validation (2026-10-19)

**Build:** misfire-fixes @ f557511.

**Coverage:** 100 new sites across 12 types:
- government
- news
- shops
- SaaS
- education
- health
- finance
- travel
- developer docs
- NGOs
- entertainment
- food

**Usable scans:** 80.
- **Web filter:** 13 blocked by this machine's web filter (certificate error).
- **Bot checks:** 7 still showed a bot check after a retry with a normal browser identity.
- **Bot-check pages scanned anyway:** 5 more, see the tool issues below.

**Checked on the live pages:** 4,947 findings, split across 7 parallel verification agents.

| Verdict | Findings | Share of decided findings |
|---|---|---|
| Correct | 3,247 | 78.5% |
| New misfire | 530 | 12.8% |
| Regression (a fixed pattern missed a variant) | 142 | 3.4% |
| Noise | 216 | 5.2% |
| Unverified (blocked live, or review groups not sampled) | 812 | — |

## Problems by cause (largest first)
| # | Cause | About | Where |
|---|---|---|---|
| 1 | Focus-indicator detection gaps: `filter: drop-shadow()` rings, transparent-ring branch skips the "elsewhere" check (Tailwind), ring on an ancestor's ::before/::after, keyboard mode lost after scrolling, outline:auto in child frames and inset forms, underline added on focus | 115 | govscot 51, oxford 28, coursera 10, canva 17, others |
| 2 | Off-canvas drawer text kept by the carousel exception | 144 | udemy |
| 3 | ARIA-04 under a captcha/modal (whole site aria-hidden), and custom ARIA-04 duplicating axe | 142 | target 104, udemy 36, yale 2 |
| 4 | Background under text not found: non-ancestor gradient/image/static sibling, fixed header over a hero, z-index:-1 layer. Falls back to white and reports a definite 1:1 (reachedOpaque false). Also focus rings over media assumed white. | 83 | salesforce 24, canva 9, mayo 10, zoom 7, k8s 8, cdc 5, nswgov 5, dropbox 4, amex 3, oxford 3, stanford 2 |
| 5 | Hidden ad and user-sync frames (0×0, display:none, Chrome image-viewer documents) still scanned | 75 | webmd 56, wise 9, hubspot 5, adidas 3, mailchimp 2 |
| 6 | Shadow DOM: background walk does not follow slots/shadow hosts | 56 (+~380 suspected on Rotten Tomatoes) | paypal |
| 7 | Noise: region flood when the only `<main>` is a tiny widget; duplicate ids whose copies are identical or hidden; FRM-08 review when the name starts with the visible text; KBD-06 not grouped per cover; LNK-03 on href="#"; STR-12 on statistics; 1×1 tracking pixels; KBD-08 on non-modal dialogs | 216 | un 61, wapo 21, bofa 22, mayo 26, others |
| 8 | Smaller: TGT-01 buttons inside code lines (9); FRM-11 aria-hidden label text / aria-hidden="false" (13); KBD-01 nav labels and carousel slides with a button equivalent, "impressions" matching the data-click regex (19); FRM-05/06 banners taken as error messages (4); CLR-03 own translucent button fill dropped (9); SVG pixel sampling ignores background-size (2); no-repeat chevron read as a gradient (4); scroll-driven body colour (6); overflow:clip (2); icon-font ligatures as text (4); background read mid-transition (1); ZM-02 inside a widget iframe (1); page-level heuristic in child frames (6) | ~80 | various |

## Tool issues
- **Slow scans:** CNN 1,229 s, UN 386 s, Target 296 s, Mailchimp 254 s, SoundCloud 179 s, Stanford 163 s.
  - **Cause:** the one-frame wait added in KBD-05 (`requestAnimationFrame` with no timeout). It hangs in throttled or off-screen frames until the 120 s frame timeout, and frames are scanned one after another.
  - **Fix:** a timeout fallback (as `nextFrame()` in the content script already has), plus a time budget for the focus rule.
- **Bot-check and captcha pages scanned as if real:** Emirates, Adidas, Wayfair, Expedia, Target. The scan should detect them and warn.

## New checks from the last batches
Quiet on real sites, apart from:
- STR-12 on statistic numbers (5) and inside child frames (6);
- ARIA-04 duplicates.

OTH-02, FRM-12, IMG-03 background-title and KBD-05 focus-dropped were correct where they fired.

## Slow-scan fix (2026-10-19)

**Cause:** the one-frame wait added in the KBD-05 check (commit d4d4aef) used `requestAnimationFrame` with no time limit. In throttled frames, such as ad or video embeds below the fold or background tabs, it never fired. Each frame then waited until the 120 s frame timeout.

**Fix:**
- The frame wait gives up after 50 ms.
- The focus-visibility check and the focus-hidden check each stop after 20 s. They then add one Needs-review note saying how far they got.

**Re-timed (whole scan, wall clock):**

| Site | Before | After |
|---|---|---|
| CNN | 1,229 s | 37 s |
| UN | 386 s (3 frames timed out) | 17 s (all frames scanned) |
| Mailchimp | 263 s | 14 s |
| SoundCloud | 179 s | 18 s |
| Stanford | 163 s | 10 s |
| Bon Appétit | 106 s | 17 s |

Neither time budget was reached on these sites. The findings are otherwise unchanged: CNN 113 definite before and after. The UN now reports its embedded frames as well (139).

## "Definite only when sure" (2026-10-19)

**Rule:** a contrast or focus-ring failure is definite only when the check is certain. Otherwise it moves to Needs review, with a note saying why.

**What counts as "not sure":**
- the text is placed inside a web component;
- another element (a gradient or image box, a hero photo, a layer behind the page) is drawn behind it at that point, as seen in the browser's own stack of elements;
- no solid background was found and the point could not be checked;
- for focus rings, the element also changes something that cannot be measured (a filter, an underline, the text colour, a transform, a background image).

**Bot checks:** a page that looks like a bot check or access-denied page gets one OTH-04 note, and all its other findings move to Needs review.

**Also:**
- the transparent-ring branch now looks for the ring elsewhere (Tailwind parent rings);
- the carousel watch samples every 250 ms, so two-slide carousels are not missed.

**Re-scan of 21 sites, definite (review):**

Wrong definite failures that moved to review:

| Site | Before | After |
|---|---|---|
| Salesforce, CLR | 24 definite | 24 review |
| Canva, CLR | 9 + 9 definite | all review |
| Mayo, CLR | 3 + 7 definite | all review |
| gov.scot, CLR-05 | 48 definite | 0 definite (51 review) |
| PayPal, CLR-01 | 54 definite | 7 definite |
| K8s, CLR-01 | 19 | 11 (the 11 real kept) |
| Zoom, CLR-01 | 10 | 3 (the 3 real kept) |
| CDC, CLR-05 | 5 | 0 |
| Dropbox, CLR | 4 | 0 |
| Amex, CLR | 3 | 0 |
| Stanford, CLR | 6 | 0 |
| CBC, CLR-05 | 4 | 1 |

Verified real failures that stayed definite:

| Site | Rule | Count |
|---|---|---|
| Duolingo | CLR-01/02 | 132 |
| Duolingo | KBD-05 | 120 |
| Python | CLR-01 | 56 |
| W3Schools | CLR-01 | 54 |
| W3Schools | CLR-05 | 22 |
| Vue | CLR-01 | 13 |
| WHO | CLR-05 | 11 |
| Docker | CLR-01 | 9 |
| Guardian | CLR-05 | 60 of 61 |

**Cost:** K8s CLR-05 10 → review. Those rings do fail, but they were measured against the wrong (white) background, so review is the honest result.

## Contrast background from the element stack (2026-10-19)

**Problem found by the user:** on the Ministry of Testing club page, axe DevTools reported 31 definite contrast failures. We had the same elements with the same colours and ratios, but 28 of them were in Needs review with "Another element (<div>) is drawn behind it".

**Cause:**
- The page has a fixed background box with `background-image: url("")`. The URL is empty, so it draws nothing.
- Our "definite only when sure" check doubted any non-parent element behind the text, instead of working out what it paints.

**Fix (axe-core's approach):**
- The background is worked out from the browser's stack of elements at the text: every box behind it that fully covers it with a plain colour counts, whether it is a parent or not.
- Doubt remains only for another element's image, gradient or media, a box covering the text only partly, web components, and unchecked points.
- An empty `url("")` is no image.
- The stack check runs only for text that fails the first measurement.

**Result on that page:**
- CLR-01: 33 definite, same colours and ratios as axe's 31.
- **The 2 extra are the digit "6"** in the post stats (#4ab234 on white, 2.72:1). axe leaves single characters in review ("too short to determine if it is actual text content"), but the "17" and "79.3k" beside them are reported by axe.
- **The 28 CLR-05 reviews** are background-only focus changes. WCAG AA does not require the focused and unfocused states to contrast (that is 2.4.13, AAA), so they stay as review by design.

## Side by side with axe-core on 55 sites (2026-10-19)

On every site, axe-core 4.13 and PalTech scanned **the same page load**. axe-core is the engine behind axe DevTools Pro's automatic scan; it was run on WCAG 2.0–2.2 A/AA plus best practices, in every frame.

**Scope:**
- **Sites:** 55 usable sites across government, news, shops, SaaS, education, developer docs, health, finance and nonprofits.
- **Excluded:** 7 shop and travel sites failed the network's certificate check. Ars Technica showed a human-verification page and Fidelity a usage-agreement page.

**Method:**
- Findings were paired by element (same rule, then same element by selector, HTML or attribute values).
- A few leftovers were paired by count within the same rule and site.
- 194 sampled findings were checked by hand on the live pages:
  - all 36 cases where axe reported a definite failure and PalTech did not;
  - 118 PalTech-only definite findings, sampled across every rule;
  - 20 PalTech definite findings that axe left for review;
  - 20 findings both tools reported, as a control.
- Rates by rule were scaled up to all findings.

**Results:**

| | axe-core (axe DevTools engine) | PalTech |
|---|---|---|
| Definite findings | 1,273 | 2,566 |
| Of which real (estimated) | **1,254** | **2,191** (1,737 without the LNK-05 best-practice finding) |
| Wrong definite findings | ~19 | ~375 |
| Precision of definite findings | **98.5%** | **85.4%** |
| Real problems the other tool did not report as definite | 17 found only by axe | ~500 WCAG problems found only by PalTech, plus 454 LNK-05 |
| Scan time, 55 sites | 159 s | 1,718 s |

**Where axe and PalTech agree:**
1,237 of axe's 1,273 definite findings are also definite in PalTech:
- 474 of them are axe's `region` findings, which PalTech groups into one note per page.
- All 20 sampled shared findings were real.

**axe-only (36):**
- **19 were axe false positives,** which PalTech was right to drop or send to review:
  - 8 DW and 6 Columbia contrast findings measured against the wrong background;
  - 3 ClickUp target sizes where the spacing exception applies;
  - Samsung `aria-required-parent`;
  - Cloudflare's hover-only background.
- **17 were real.** 10 PalTech missed:
  - contrast;
  - target size on Independent, umich and others;
  - unnamed duplicate landmarks on Dell, Monday and cancer.org.

  7 PalTech sent to review.

**What PalTech finds beyond axe (~500 real):**
- focus indicators below 3:1 (CLR-05, 79% real);
- contrast where axe gave up (CLR-01 with axe "needs review", 10 of 12 real);
- ARIA misuse (ARIA-02/03/04, all real);
- non-text contrast, alt text and form labels.

**Where PalTech's false findings come from:**

| Rule | Definite findings | Real in sample | Estimated false | Cause seen |
|---|---|---|---|---|
| KBD-06 focus obscured | 188 | 4 / 13 | ~130 | Focused by script, not by Tab, so the scroll position differs. After a real Tab the link sits above the cookie banner. |
| CLR-01 (axe silent) | 100 | 5 / 12 | ~58 | Pseudo-element backgrounds (France24), rgba overlays over photos (NPS), text in shadow DOM (Open University), decorative aria-hidden mockups (ClickUp), off-screen sr-only text (Cornell). |
| LNK-03 generic link text | 58 | 0 / 10 | ~58 | "Learn more" next to a heading or in a sentence: the purpose is clear from context (H80), so 2.4.4 passes. |
| KBD-05 no focus indicator | 64 | 4 / 10 | ~38 | Inputs whose focus shows as a caret, a moving label or a placeholder change. A real Tab draws a ring that `focus()` does not. |
| CLR-05 focus indicator | 127 | 11 / 14 | ~27 | Outline measured against the wrong adjacent colour (France24, Princeton, TED). |
| ZM-03 text spacing | 25 | 3 / 7 | ~14 | Decorative mockups and horizontal carousels. |
| Others | | | | STR-02 lang in hidden empty frames; LNK-02 YouTube avatar button; STR-08 duplicate ids that resolve to the same label. |

**Sending LNK-03, KBD-06 and KBD-05 to review alone would lift precision to ~93%.** Fixing their causes would keep the real ones definite.

**Limits:**
- Rates by rule come from 5–14 samples each.
- Pages change between the scan and the check: 3 items were gone.
- Strict 1.4.11 calls on focus rings between 2:1 and 3:1 were counted as real.

## Fixes from the side-by-side run, and a check on 52 fresh sites (2026-10-19)

### What was fixed (generic causes, not site rules)

| Rule | Cause | Fix |
|---|---|---|
| KBD-05 / CLR-05 | Flying-focus box inside a page wrapper not found (DW) | Look for overlay boxes up to three levels below `<body>` and compare with their state before the focus moved. |
| KBD-05 | `outline: auto 0px` still draws Chrome's ring (Verywell, Schwab) | An `auto` outline counts as visible whatever its width. |
| KBD-05 | Text field whose only sign of focus is the text cursor (Lenovo, NerdWallet) | Needs review. |
| KBD-05 | Ring drawn only after a real key press inside a frame from another site (YouTube) | Needs review. |
| KBD-05 | Focus shown by fading (USPS) | An opacity change counts as a visible change. |
| KBD-05 | An element already focused when checked (a dialog's first button) | Blur it first. |
| KBD-05 / KBD-06 | Modal dialog open: a cookie banner opened with `showModal()` or with `aria-modal` (Nature, HubSpot) | One review note for the page behind it, not 97 findings. |
| KBD-06 | 1px screen-reader-only button | Not checked. |
| CLR-05 | Ring judged against the parent's colour (TED, France24, Princeton) | Judge the colours just outside the ring on all four sides. Neighbouring controls are left out. An image or a `::before` paint there gives review. |
| LNK-03 | "Learn more" whose purpose is clear from its context | Not reported when the sentence, list item, cell, cookie-bar text or the card's heading (H80) explains it. |
| CLR-01 | `::before` bands with `translateX(-50%)` and stacked gradient layers (France24) | Measured. |
| CLR-01 | A selected tab's own fill under a grey track (The Verge) | The tab's own fill wins over the sibling box. |
| CLR-01 | A photo in a sibling box (NPS) | Treated as an image behind the text. |
| CLR-01 | Slotted text in an open or closed web component (Open University, PayPal) | Measured where it is drawn, or sent to review. |
| CLR-01 | Text far off the page, or in a 0-height clipped box (Cornell, UCLA, USPS) | Skipped. |
| CLR-01 | Text covered by another box | Review. |
| CLR-01 | `aria-hidden` mock-up text that is not shown anywhere else | Review. |
| CLR-01 | Symbols only ("+", "$") | Review. |
| CLR-01 | Measured as practically invisible (ratio below 1.25:1) | Review: the real background (a video, an animation that has not run) could not be seen. |
| ZM-03 | Decorative boxes, cut-off letter tails, carousels | Decorative boxes and letter tails are skipped; a carousel cut off sideways gives review. |
| STR-08 | Duplicate ids that cause no harm | Not reported when the copies are identical or only the first one is shown. |
| STR-02 etc. | Findings from 0x0 or hidden frames | Dropped. |
| KBD-01 | `data-click` analytics tags and `data-placeholder-expression` | No longer read as click handlers. |

Test pages: `fixtures/side-by-side.html` and `fixtures/modal-dialog.html`, with an end-to-end test for each pattern.

### A method error in the first verification

The KBD-06 checkers focused the link before the target by script and then pressed Tab. That scrolls the page differently from a keyboard user who tabs from the top. With a real Tab walk from the top, 7 of the 9 "false" KBD-06 findings were real: the link was fully under the cookie banner. KBD-06 was right about 11 of 13 checked cases. The second verification used the Tab walk.

### Fresh sites: 52 never used before, side by side with axe-core

The sites cover government, news, SaaS, education, docs, health, finance, nonprofits and science. 200 findings were checked on the live pages.

| | axe-core | PalTech (build before these sites) | PalTech (final build) |
|---|---|---|---|
| Precision of definite findings | 99.4% | 88.3% | **94.3%** |
| Real problems found | ~871 | ~1,835 | ~1,774 |

**Notes on the final build's numbers:**
- **Not fully independent.** The final build was also corrected for patterns first seen on these sites: Nature's modal dialog, `data-click` analytics tags and cookie-bar sentences.
- **Some losses are page variation.** Part of the drop in real findings is the page changing between loads: Zapier's survey panel appears on only some loads.

**Missed by PalTech:** 36 of axe's real definite failures (4%). 21 of them are in PalTech's Needs review.

**Still producing false definite findings (estimated ~106 over 52 sites):**
- KBD-05 rings drawn by `::after` on a focus state;
- CLR-05 against an image section;
- TGT-01 on tokens inside code samples;
- CLR-04 on chips whose text identifies them.
