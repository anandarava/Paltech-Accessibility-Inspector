# Rules guide: what PalTech A11y Inspector checks

This guide explains where the extension's rules come from, who wrote them,
which rules are best practices, which are the extension's own "advanced"
rules, and what runs when you tick **Best practices** and **axe-core only**.

Checked against axe-core 4.13.0, the version bundled with the extension.

## 1. Who created the rules

| Source | Who made it | What it provides | Where it is in this project |
|---|---|---|---|
| **WCAG** (Web Content Accessibility Guidelines) | **W3C**, the World Wide Web Consortium ([w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/)) | The requirements themselves ("success criteria" such as 1.1.1 or 1.4.3), each with a level (A, AA, AAA) | Not code. The extension maps each criterion to its version and level in [shared/wcag-map.ts](shared/wcag-map.ts) |
| **axe-core** | **Deque Systems** (the makers of axe DevTools), open source | Automatic checks for many WCAG criteria, plus 30 best-practice checks | The `axe-core` package (`node_modules/axe-core`). Deque's rule list: [dequeuniversity.com/rules/axe/4.13](https://dequeuniversity.com/rules/axe/4.13) |
| **Advanced rules** | **PalTech A11y Inspector** (this project) | Checks axe-core does not have, and stronger versions of a few axe-core checks | Code in [src/content/rules/](src/content/rules/) |
| **Rule catalogue** | **PalTech A11y Inspector** | One entry per reported rule (id such as `CLR-01`, title, WCAG criterion, severity), used to name and group every finding | [shared/a11y-rules.json](shared/a11y-rules.json) |

Every axe-core finding is renamed to a catalogue id so both sources appear in
one list, e.g. axe-core's `image-alt` is reported as **IMG-01**. The original
axe-core id is still shown in the issue's **Technical details**.

## 2. What runs when you tick each option

The two checkboxes at the top of the panel choose which rules run on the
**next** scan. They do not change results you already have.

| Best practices | axe-core only | axe-core WCAG rules | axe-core best-practice rules | Advanced rules | Use it for |
|---|---|---|---|---|---|
| ✗ | ✗ | ✓ | ✗ | ✓ | **Client WCAG compliance report**: every WCAG check, nothing that is not a WCAG rule (see the known gap in section 6) |
| ✓ | ✗ | ✓ | ✓ | ✓ | **Most thorough QA testing** (default): everything |
| ✗ | ✓ | ✓ | ✗ | ✗ | Strict axe-core WCAG check only |
| ✓ | ✓ | ✓ | ✓ | ✗ | **Matching axe DevTools** results |

### Contrast, target size and text spacing

When both engines have a rule for the same requirement, this is what runs:

| WCAG requirement | axe-core only ✗ (advanced rules on) | axe-core only ✓ |
|---|---|---|
| 1.4.3 Text contrast | Extension's **CLR-01 / CLR-02** (axe-core's `color-contrast` is switched off) | axe-core's `color-contrast` (reported as CLR-01) |
| 2.5.8 Target size | Extension's **TGT-01** (axe-core's `target-size` is switched off) | axe-core's `target-size` (reported as TGT-01) |
| 1.4.12 Text spacing | **Both** run: the extension's ZM-03 and axe-core's `avoid-inline-spacing`, both reported as ZM-03 | axe-core's `avoid-inline-spacing` (reported as ZM-03) |

### WCAG version and level

- **WCAG version** (2.0 / 2.1 / 2.2) applies to every rule. For example, with
  2.1 the 2.2-only checks for target size (2.5.8) and focus not obscured
  (2.4.11) are skipped.
- **WCAG level** (A / AA / AAA): each level includes the lower ones (AA means
  A + AA). It controls which **axe-core** rules run. The advanced rules run at
  every level, but their findings for a stricter level than the one chosen are
  dropped, so a Level A scan shows no AA findings. Best-practice findings are
  kept at every level.

### Not controlled by these options

- **KBD-02 Keyboard trap** comes from the **Keyboard test** button, not from
  the scan. It is recorded whenever the Keyboard test finds a trap, whatever
  the checkboxes say.
- **ZM-02 Reflow** only runs when the page is 320 px wide or narrower (resize
  the window or zoom to 400% before scanning).

## 3. Best-practice rules

Best practices are recommendations that make a page easier to use but are
**not** WCAG requirements. They never make a page fail WCAG. In the panel they
appear on the **Best practices** tab with a "Best practice" badge; in the HTML
report they are marked "Best practice (not a WCAG failure)" and listed after
the WCAG problems. They count lightly in the score (like Minor issues).

### 3a. axe-core's best-practice rules (created by Deque)

These 30 rules run only when **Best practices** is ticked. They run with
**axe-core only** ticked or not.

| axe-core rule | Reported as | What it checks |
|---|---|---|
| `accesskeys` | KBD-11 | accesskey attribute value should be unique |
| `aria-allowed-role` | ARIA-01 | ARIA role should be appropriate for the element |
| `aria-dialog-name` | ARIA-07 | ARIA dialog and alertdialog nodes should have an accessible name |
| `aria-text` | ARIA-01 | "role=text" should have no focusable descendants |
| `aria-treeitem-name` | ARIA-07 | ARIA treeitem nodes should have an accessible name |
| `empty-heading` | STR-12 | Headings should not be empty |
| `empty-table-header` | its axe-core id | Table header text should not be empty |
| `focus-order-semantics` | its axe-core id | Elements in the focus order should have an appropriate role |
| `frame-tested` | STR-13 | Frames should be tested with axe-core |
| `heading-order` | STR-04 | Heading levels should only increase by one |
| `hidden-content` | its axe-core id | Hidden content on the page should be analyzed |
| `image-redundant-alt` | IMG-04 | Alternative text of images should not be repeated as text |
| `label-title-only` | FRM-02 | Form elements should have a visible label |
| `landmark-banner-is-top-level` | STR-06 | Banner landmark should not be contained in another landmark |
| `landmark-complementary-is-top-level` | STR-06 | Aside should not be contained in another landmark |
| `landmark-contentinfo-is-top-level` | STR-06 | Contentinfo landmark should not be contained in another landmark |
| `landmark-main-is-top-level` | STR-06 | Main landmark should not be contained in another landmark |
| `landmark-no-duplicate-banner` | STR-06 | Document should not have more than one banner landmark |
| `landmark-no-duplicate-contentinfo` | STR-06 | Document should not have more than one contentinfo landmark |
| `landmark-no-duplicate-main` | STR-05 | Document should not have more than one main landmark |
| `landmark-one-main` | STR-05 | Document should have one main landmark |
| `landmark-unique` | STR-06 | Landmarks should have a unique role or role/label/title combination |
| `meta-viewport-large` | ZM-01 | Users should be able to zoom and scale the text up to 500% |
| `page-has-heading-one` | STR-03 | Page should contain a level-one heading |
| `presentation-role-conflict` | ARIA-01 | Elements marked as presentational should be consistently ignored |
| `region` | STR-06 | All page content should be contained by landmarks |
| `scope-attr-valid` | STR-07 | scope attribute should be used correctly |
| `skip-link` | KBD-07 | The skip-link target should exist and be focusable |
| `tabindex` | KBD-03 | Elements should not have tabindex greater than zero |
| `table-duplicate-name` | STR-07 | Tables should not have the same summary and caption |

### 3b. The extension's own best-practice rules (created by PalTech A11y Inspector)

| Rule | Severity | What it checks | Runs when |
|---|---|---|---|
| LNK-03 | Moderate | Vague link text ("click here", "read more") | axe-core only is ✗ (Best practices is currently ignored, see section 6) |
| LNK-05 | Minor | Link opens a new window without warning | axe-core only is ✗ (Best practices is currently ignored, see section 6) |

### 3c. Catalogue entries filed under best practice

The catalogue ([shared/a11y-rules.json](shared/a11y-rules.json)) also files
these under best practice. They come from axe-core rules that axe-core itself
labels as WCAG (mostly AAA), so they run with the WCAG level, not with the Best
practices box:

| Rule | axe-core rule | axe-core's WCAG label |
|---|---|---|
| CLR-08 Text contrast below 7:1 | `color-contrast-enhanced` | 1.4.6 AAA (runs at AAA) |
| LNK-04 Same link text, different destinations | `identical-links-same-purpose` | 2.4.9 AAA (runs at AAA) |
| FRM-10 Form field has multiple labels | `form-field-multiple-labels` | 3.3.2 A |

## 4. Advanced rules (created by PalTech A11y Inspector)

These run only when **axe-core only** is ✗. They are counted as the second
number on the **axe-core / advanced** card in the scan summary, and labelled
"PalTech A11y Inspector rule" in issue details and reports. The code is in
[src/content/rules/](src/content/rules/); each file starts with a comment
listing the rules it emits and the risks of its heuristics.

### 4a. Checks axe-core does not have

| Rule | WCAG | Severity | What it checks | Why axe-core does not cover it |
|---|---|---|---|---|
| IMG-02 | 1.1.1 A | Serious | Alt text is a filename (e.g. `IMG_2031.jpg`) | axe's `image-alt` only checks that alt text exists, not what it says |
| IMG-03 | 1.1.1 A | Moderate | Alt text is generic ("image", "photo", "icon") | Same: axe does not judge alt wording |
| IMG-09 | 1.1.1 A | Serious | Image marked decorative (`alt=""`) but has a `title` | axe treats `alt=""` as decorative and passes the image without looking at the title |
| CLR-04 | 1.4.11 AA | Serious | UI component borders or icons below 3:1 | axe has no rule for 1.4.11 Non-text Contrast |
| CLR-05 | 1.4.11 AA | Serious | Focus ring (outline, shadow or border) below 3:1 against its surroundings. A focus shown only by a subtle background change is listed under **Needs review** in A/AA scans, because WCAG AA does not require an element's focused and unfocused states to contrast | Same criterion (1.4.11) |
| CLR-09 | 2.4.13 AAA | Moderate | Focus shown only by a background change below 3:1 against the unfocused state (AAA scans only) | axe has no rule for 2.4.13 |
| FRM-02 | 3.3.2 A | Serious | Placeholder is the only label | axe's `label-title-only` covers title-only labels; FRM-02 covers the placeholder case |
| FRM-03 | 1.3.1 A | Moderate | Radio or checkbox group without a group label | axe once had `radiogroup` / `checkboxgroup` rules but removed them |
| FRM-12 | 3.2.2 A | Serious | A `<select>` whose inline `onchange` navigates or submits, with no button in its form (Needs review) | axe has no rule for 3.2.2 |
| FRM-11 | 3.3.2 A | Moderate | Field named only by aria-label, a visually hidden label or hidden text, with no label shown on screen (Needs review). Not flagged when a visible button sits beside the field or nearby visible text says the same | axe accepts any accessible name, visible or not |
| ARIA-02 | 4.1.2 A | Moderate (Serious if focusable) | aria-label / aria-labelledby on a div, span, p and similar without a role, which ARIA forbids | axe's `aria-prohibited-attr` reports this only as "incomplete" |
| ARIA-03 | 4.1.2 A | Serious | An ARIA id list where some ids do not exist (aria-labelledby: definite; aria-describedby, -controls, -owns, -flowto, -details: Needs review) | axe fails an attribute only when none of its ids exist |
| STR-08 | 4.1.2 A | Serious | An id used by more than one element and referenced by ARIA or `<label for>`. Not reported when the copies are identical or only the first (the one the reference finds) is shown | axe's `duplicate-id-aria` reports this only as "incomplete" |
| FRM-04 | 3.3.2 A | Moderate | Required field not marked as required in code | axe's only 3.3.2 rule is `form-field-multiple-labels` |
| KBD-01 | 2.1.1 A | Critical | Clickable element that cannot be reached with the keyboard | axe does not test click handlers |
| KBD-02 | 2.1.2 A | Critical | Keyboard trap (found by the **Keyboard test**) | axe cannot press keys |
| KBD-05 | 2.4.7 AA | Serious | No visible focus indicator. A text field whose only sign of focus is the text cursor, and a control inside a frame from another site (which may draw its ring only after a real key press), go to Needs review | axe has no rule for 2.4.7 |
| KBD-06 | 2.4.11 AA | Serious | Focused element hidden under a sticky header, footer or banner (for example a cookie banner) when reached with Tab from the top of the page. A visually hidden (1px) control is not checked | axe has no rule for 2.4.11 (WCAG 2.2) |
| ZM-02 | 1.4.10 AA | Serious | Horizontal scrolling at 320 px width (reflow) | axe has no rule for 1.4.10 |
| LNK-03 | Best practice | Moderate | Vague link text ("click here", "read more") with nothing around it that explains it. A link whose sentence, list item, table cell or card heading (technique H80) gives its purpose passes 2.4.4 and is not reported | axe's `link-name` only checks that a link has a name |
| LNK-05 | Best practice | Minor | Link opens a new window without warning | axe's only 3.2.5 rule is about `<meta http-equiv="refresh">` |

### 4b. Stronger versions of axe-core checks

| Rule | WCAG | Severity | What it adds | axe-core rule |
|---|---|---|---|---|
| CLR-01 | 1.4.3 AA | Serious | Normal text contrast: handles semi-transparent text and backgrounds, and suggests a passing colour | Replaces `color-contrast` |
| CLR-02 | 1.4.3 AA | Serious | Large text contrast (3:1) as its own rule, with a suggested colour | Replaces `color-contrast` (large text) |
| TGT-01 | 2.5.8 AA | Moderate | Target size, applying WCAG's 24 px spacing exception correctly | Replaces `target-size` |
| TGT-02 | 2.5.5 AAA | Minor | Target smaller than 44 x 44 px; no spacing exception. Runs in AAA scans only | axe has no rule for 2.5.5 |
| ZM-03 | 1.4.12 AA | Moderate | Applies the 1.4.12 text spacing to the page and looks for clipped text. Decoration hidden from screen readers and cut-off letter tails are ignored; a row of items cut off sideways (a carousel) goes to Needs review | Runs alongside `avoid-inline-spacing` |
| ARIA-04 | 4.1.2 A | Serious | An element that Tab still reaches inside `aria-hidden="true"`, including cases axe-core skips (such as iframes): screen readers land on something they are told does not exist | Adds to `aria-hidden-focus` |

### 4c. Needs review checks (created by PalTech A11y Inspector)

These guess intent from how the page looks, so a person confirms them. They
are listed on the **Needs review** tab (and in the "Needs review" part of the
HTML report), never count as failures or toward the score, and can be turned
off in Options ("Include findings that need manual review"). FRM-11 and FRM-12
in 4a are of this kind too.

| Rule | WCAG | What it flags |
|---|---|---|
| CLR-03 | 1.4.3 AA | Text over an image, a gradient that passes on some of its colours and fails on others, or media: the real background cannot be measured |
| FRM-05 | 3.3.1 A | A visible error message not tied to its field with aria-describedby or aria-errormessage |
| FRM-06 | 3.3.1 A | A field with a visible error that lacks `aria-invalid="true"` |
| IMG-08 | 1.1.1 A | An inline `<svg>` with no role, no name and no aria-hidden (it may be decorative, but screen readers still expose it) |
| KBD-01 | 2.1.1 A | An element that only has a pointer cursor and cannot be focused (the definite KBD-01 cases are in 4a) |
| KBD-08 | 2.4.3 A | An open dialog that does not contain the focus |
| ARIA-03 | 4.1.2 A | aria-describedby, -controls, -owns, -flowto or -details naming ids that do not exist (often added later on purpose) |
| STR-07 | 1.3.1 A | A data table (at least 2 x 2 cells, with a border or numbers) that has no header cells at all |
| STR-12 | Best practice | Text styled as a heading but marked up as a paragraph, on a page with no h2–h6 at all |
| OTH-02 | 2.2.2 A | A carousel or slider that moves by itself (watched for 2.5 s) with no pause, stop or play control |
| OTH-04 | Best practice | The scan landed on a bot check or access-denied page (for example a Cloudflare check): one note, and every other finding from that page moves to Needs review |

### 4d. WCAG requirements only the advanced rules check

With **axe-core only** ticked, nothing checks these:

- 1.4.10 Reflow (ZM-02)
- 1.4.11 Non-text Contrast (CLR-04, CLR-05)
- 2.1.1 Keyboard, for clickable elements that are not focusable (KBD-01)
- 2.1.2 No Keyboard Trap (KBD-02, via the Keyboard test)
- 2.4.7 Focus Visible (KBD-05)
- 2.4.11 Focus Not Obscured (Minimum) (KBD-06)
- 3.2.2 On Input (FRM-12, Needs review)
- At AAA: 2.4.13 Focus Appearance (CLR-09) and 2.5.5 Target Size (Enhanced) (TGT-02)

## 5. Where you see each kind of rule

| Kind | Panel | Issue details | HTML report |
|---|---|---|---|
| axe-core WCAG rule | **WCAG issues** tab; first number on the **axe-core / advanced** card | WCAG badge; subline ends "axe-core" | Listed with its WCAG criterion |
| axe-core best-practice rule | **Best practices** tab | "Best practice" badge | "Best practice (not a WCAG failure)", after the WCAG problems |
| Advanced rule | **WCAG issues** tab (or Best practices for LNK-03 / LNK-05); second number on the **axe-core / advanced** card | Subline ends "PalTech A11y Inspector rule" | Listed with its WCAG criterion |
| Needs review finding (either engine) | **Needs review** tab, not counted | "Needs review" | "Needs review" section, marked "not counted" |

## 6. Known gaps

- **The Best practices box does not switch off LNK-03 and LNK-05.** They run
  whenever axe-core only is ✗. With the box unticked they are hidden from the
  **All** tab but still listed on the **Best practices** tab. Expect them there
  until this is fixed.

The earlier gap where the advanced rules ignored the WCAG level is fixed: their
findings above the chosen level are now dropped (section 2).
