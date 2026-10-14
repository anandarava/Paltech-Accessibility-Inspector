# Detection Enhancement Plan

**Source:** Scan comparison report, 14 Oct 2026. Tools compared: PalTech, ARC Toolkit, IBM Equal Access, axe DevTools, Accessibility Insights, WAVE and Siteimprove.
**Goal:** Find more real accessibility issues than the other extensions, and be able to prove it.

---

## Key finding

The rule catalogue in [shared/a11y-rules.json](shared/a11y-rules.json) already covers ARIA, form labels and images through axe-core rules. Most gaps in the report do **not** come from missing rules. They come from:

1. **The scan drops results that axe-core can't decide.** [src/content/scanner.ts:118](src/content/scanner.ts#L118) requests `resultTypes: ["violations"]` only.
2. **axe-core passes patterns that other tools flag.** Examples: `alt=""` together with a `title`, fields named only by `aria-label`, stricter ARIA checks.
3. **There is a single engine.** IBM and ARC run their own rule sets and catch problems axe-core does not.

---

## Priority 1: close the gaps in the report

### 1. Add a "Needs review" category
**Status: done** on branch `detection-enhancements`. New tab, HTML report section, and an on/off setting (on by default). Not counted in the score.

- **Gap:** ARC reports 52 contrast cases over background images and IBM reports 33 potential violations. PalTech shows no comparable queue.
- **Cause:** [scanner.ts:118](src/content/scanner.ts#L118) only requests violations, so axe-core's "incomplete" results are thrown away.
- **Change:**
  - Add `"incomplete"` to `resultTypes`. The normalizer already turns these into "Semi" issues ([normalizer.ts:378](src/content/normalizer.ts#L378)).
  - Show them in a separate **Needs review** tab or filter, so they don't inflate the confirmed count or the score.
  - Leave them out of scoring ([shared/scoring.ts](shared/scoring.ts)), and label them separately in HTML/JSON exports.
- **Effort:** Small.

### 2. New rule: empty alt with a title or name (IMG-09)
**Status: done** on branch `detection-enhancements`. Flags `title` only. An `aria-label` or `aria-labelledby` names the image reliably, so it is not reported.

- **Gap:** ARC (10 errors), IBM (10 violations) and WAVE (10 alerts) flagged images with `alt=""` plus a `title`. PalTech flagged none.
- **Cause:** axe-core treats `alt=""` as decorative and passes the image. No current IMG rule checks this conflict.
- **Change:** Add a rule to [src/content/rules/alt-quality.ts](src/content/rules/alt-quality.ts). Flag an `<img>` that has `alt=""` and also a non-empty `title`, `aria-label` or `aria-labelledby`. The fix guidance is to pick one intent: decorative (remove the title) or meaningful (write proper alt text).
- **WCAG:** 1.1.1 Non-text Content.
- **Effort:** Small.

### 3. Visible-label check for form fields (FRM-11)
- **Gap:** WAVE reports 2 missing form labels and IBM reports 3 potential visible-label issues.
- **Cause:** FRM-01 uses axe-core's `label` rule, which passes a field named only by `aria-label` or by a visually hidden label.
- **Change:** Add a "Semi" rule to [src/content/rules/forms.ts](src/content/rules/forms.ts). Flag a field that has an accessible name but no label text visible near it.
- **WCAG:** 3.3.2 Labels or Instructions.
- **Effort:** Medium (deciding what counts as "visible near the field" needs care).

### 4. ARIA checks stricter than axe-core
- **Gap:** ARC reports 2 ARIA errors, IBM 1 invalid ARIA attribute, and Siteimprove flags ARIA issues. PalTech reported none.
- **Candidate checks:**
  - `aria-controls`, `aria-describedby` or `aria-labelledby` pointing to an id that doesn't exist on the page right now
  - `aria-expanded` or `aria-haspopup` on an element without a compatible role
  - explicit roles that conflict with the element's built-in meaning
- **Before building:** compare element by element against the IBM and ARC exports on the same page, to confirm each one is a real miss.
- **Effort:** Medium.

---

## Priority 2: pull ahead of the other tools

### 5. Run IBM's Equal Access engine alongside axe-core
- **Why:** Running both engines finds everything either one finds. No single competing extension does that today.
- **How:**
  - IBM's checker engine (`accessibility-checker-engine`, Apache-2.0) runs in the browser.
  - Map IBM rule IDs to project rule IDs in `a11y-rules.json`.
  - Remove duplicates by matching elements, the same way `SUPERSEDED_BY_CUSTOM` does in [scanner.ts](src/content/scanner.ts).
  - Send IBM's "potential" results to the Needs review category (item 1).
- **Risks:** Bundle size and scan time both go up. Keep it switchable in Options.
- **Effort:** Large.

### 6. Prove accuracy, not only counts
More findings don't mean a better tool, because false positives count against you.
- Run the scanner against the **W3C ACT Rules test cases**. axe-core and IBM both publish results for these, which gives real precision and recall numbers to compare against.
- Add the ministryoftesting page to [fixtures/](fixtures/) as a saved snapshot with hand-verified expected issues, and run it in CI so every rule change gets checked against it.
- **Effort:** Medium.

### 7. Scan more page states
- The report notes that viewport and page state differed between tools (the PalTech scan ran at 909 × 721).
- Add options to:
  - scan at several viewport widths (320, 768 and 1280px)
  - scan with menus, accordions and dialogs opened
- Check that elements inside shadow DOM are covered by both the custom rules and axe-core.
- **Effort:** Medium to large.

### 8. Finish AAA mode
- Siteimprove reported 68 enhanced target-size findings (WCAG 2.5.5, AAA).
- CLR-08 already covers AAA contrast. Add a 44 × 44 px target-size rule that runs only when the WCAG level is set to AAA.
- **Effort:** Small (reuses [target-size.ts](src/content/rules/target-size.ts)).

---

## Priority 3: make comparisons fair

### 9. Fair timing comparisons
- PalTech's 371 ms has nothing comparable from the other tools.
- Build a Playwright script that scans the same pages with each tool in the same browser session and records time and issue counts.
- **Effort:** Medium.

---

## Suggested order

| Step | Item | Gap it closes | Effort |
|---|---|---|---|
| 1 | Needs review category | ARC/IBM potential issues | Small |
| 2 | IMG-09 empty alt + title | 10 images (ARC/IBM/WAVE) | Small |
| 3 | FRM-11 visible label | WAVE/IBM form labels | Medium |
| 4 | Stricter ARIA checks | ARC/IBM/Siteimprove ARIA | Medium |
| 5 | AAA target size | Siteimprove AAA findings | Small |
| 6 | ACT test suite + fixture | Accuracy proof | Medium |
| 7 | IBM engine | Overall detection breadth | Large |
| 8 | Viewport and page-state scans | Page-state differences | Medium–Large |
| 9 | Timing comparison script | Speed claim | Medium |

## Review notes

- Decisions needed before work starts:
  - Should Needs review results count toward the score at all?
  - Is a larger bundle acceptable for the IBM engine?
- Before treating any report gap as a confirmed miss, re-scan the same page, at the same viewport and on the same day, with PalTech and the tool that reported it.
