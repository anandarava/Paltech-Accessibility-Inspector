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
