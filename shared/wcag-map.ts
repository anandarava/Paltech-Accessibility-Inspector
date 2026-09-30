/**
 * WCAG 2.2 criterion metadata and axe-core rule -> project rule mapping.
 * Level values follow WCAG 2.2. 4.1.1 Parsing was removed in WCAG 2.2 and is
 * intentionally absent.
 */
import type { WcagLevel, WcagRef, WcagVersion } from "./types";

const U = "https://www.w3.org/WAI/WCAG22/Understanding/";

export const WCAG_CRITERIA: Record<string, { name: string; level: "A" | "AA" | "AAA"; slug: string }> = {
  "1.1.1": { name: "Non-text Content", level: "A", slug: "non-text-content" },
  "1.2.1": { name: "Audio-only and Video-only (Prerecorded)", level: "A", slug: "audio-only-and-video-only-prerecorded" },
  "1.2.2": { name: "Captions (Prerecorded)", level: "A", slug: "captions-prerecorded" },
  "1.2.3": { name: "Audio Description or Media Alternative (Prerecorded)", level: "A", slug: "audio-description-or-media-alternative-prerecorded" },
  "1.2.5": { name: "Audio Description (Prerecorded)", level: "AA", slug: "audio-description-prerecorded" },
  "1.3.1": { name: "Info and Relationships", level: "A", slug: "info-and-relationships" },
  "1.3.2": { name: "Meaningful Sequence", level: "A", slug: "meaningful-sequence" },
  "1.3.3": { name: "Sensory Characteristics", level: "A", slug: "sensory-characteristics" },
  "1.3.4": { name: "Orientation", level: "AA", slug: "orientation" },
  "1.3.5": { name: "Identify Input Purpose", level: "AA", slug: "identify-input-purpose" },
  "1.4.1": { name: "Use of Color", level: "A", slug: "use-of-color" },
  "1.4.2": { name: "Audio Control", level: "A", slug: "audio-control" },
  "1.4.3": { name: "Contrast (Minimum)", level: "AA", slug: "contrast-minimum" },
  "1.4.4": { name: "Resize Text", level: "AA", slug: "resize-text" },
  "1.4.5": { name: "Images of Text", level: "AA", slug: "images-of-text" },
  "1.4.6": { name: "Contrast (Enhanced)", level: "AAA", slug: "contrast-enhanced" },
  "1.4.10": { name: "Reflow", level: "AA", slug: "reflow" },
  "1.4.11": { name: "Non-text Contrast", level: "AA", slug: "non-text-contrast" },
  "1.4.12": { name: "Text Spacing", level: "AA", slug: "text-spacing" },
  "1.4.13": { name: "Content on Hover or Focus", level: "AA", slug: "content-on-hover-or-focus" },
  "2.1.1": { name: "Keyboard", level: "A", slug: "keyboard" },
  "2.1.2": { name: "No Keyboard Trap", level: "A", slug: "no-keyboard-trap" },
  "2.1.4": { name: "Character Key Shortcuts", level: "A", slug: "character-key-shortcuts" },
  "2.2.1": { name: "Timing Adjustable", level: "A", slug: "timing-adjustable" },
  "2.2.2": { name: "Pause, Stop, Hide", level: "A", slug: "pause-stop-hide" },
  "2.3.1": { name: "Three Flashes or Below Threshold", level: "A", slug: "three-flashes-or-below-threshold" },
  "2.4.1": { name: "Bypass Blocks", level: "A", slug: "bypass-blocks" },
  "2.4.2": { name: "Page Titled", level: "A", slug: "page-titled" },
  "2.4.3": { name: "Focus Order", level: "A", slug: "focus-order" },
  "2.4.4": { name: "Link Purpose (In Context)", level: "A", slug: "link-purpose-in-context" },
  "2.4.5": { name: "Multiple Ways", level: "AA", slug: "multiple-ways" },
  "2.4.6": { name: "Headings and Labels", level: "AA", slug: "headings-and-labels" },
  "2.4.7": { name: "Focus Visible", level: "AA", slug: "focus-visible" },
  "2.4.11": { name: "Focus Not Obscured (Minimum)", level: "AA", slug: "focus-not-obscured-minimum" },
  "2.4.12": { name: "Focus Not Obscured (Enhanced)", level: "AAA", slug: "focus-not-obscured-enhanced" },
  "2.4.13": { name: "Focus Appearance", level: "AAA", slug: "focus-appearance" },
  "2.5.1": { name: "Pointer Gestures", level: "A", slug: "pointer-gestures" },
  "2.5.2": { name: "Pointer Cancellation", level: "A", slug: "pointer-cancellation" },
  "2.5.3": { name: "Label in Name", level: "A", slug: "label-in-name" },
  "2.5.4": { name: "Motion Actuation", level: "A", slug: "motion-actuation" },
  "2.5.7": { name: "Dragging Movements", level: "AA", slug: "dragging-movements" },
  "2.5.8": { name: "Target Size (Minimum)", level: "AA", slug: "target-size-minimum" },
  "3.1.1": { name: "Language of Page", level: "A", slug: "language-of-page" },
  "3.1.2": { name: "Language of Parts", level: "AA", slug: "language-of-parts" },
  "3.2.1": { name: "On Focus", level: "A", slug: "on-focus" },
  "3.2.2": { name: "On Input", level: "A", slug: "on-input" },
  "3.2.3": { name: "Consistent Navigation", level: "AA", slug: "consistent-navigation" },
  "3.2.4": { name: "Consistent Identification", level: "AA", slug: "consistent-identification" },
  "3.2.5": { name: "Change on Request", level: "AAA", slug: "change-on-request" },
  "3.2.6": { name: "Consistent Help", level: "A", slug: "consistent-help" },
  "3.3.1": { name: "Error Identification", level: "A", slug: "error-identification" },
  "3.3.2": { name: "Labels or Instructions", level: "A", slug: "labels-or-instructions" },
  "3.3.3": { name: "Error Suggestion", level: "AA", slug: "error-suggestion" },
  "3.3.4": { name: "Error Prevention (Legal, Financial, Data)", level: "AA", slug: "error-prevention-legal-financial-data" },
  "3.3.7": { name: "Redundant Entry", level: "A", slug: "redundant-entry" },
  "3.3.8": { name: "Accessible Authentication (Minimum)", level: "AA", slug: "accessible-authentication-minimum" },
  "4.1.2": { name: "Name, Role, Value", level: "A", slug: "name-role-value" },
  "4.1.3": { name: "Status Messages", level: "AA", slug: "status-messages" },
};

/** Success criteria added in WCAG 2.1 (everything else listed above dates from 2.0 unless in WCAG22_CRITERIA). */
const WCAG21_CRITERIA = new Set([
  "1.3.4", "1.3.5", "1.3.6", "1.4.10", "1.4.11", "1.4.12", "1.4.13", "2.1.4", "2.2.6", "2.3.3",
  "2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.5", "2.5.6", "4.1.3",
]);
/** Success criteria added in WCAG 2.2. */
const WCAG22_CRITERIA = new Set(["2.4.11", "2.4.12", "2.4.13", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8", "3.3.9"]);

/** WCAG version that introduced a success criterion; "2.0" for unknown or empty (best-practice) criteria. */
export function criterionVersion(criterion: string): WcagVersion {
  if (WCAG22_CRITERIA.has(criterion)) return "2.2";
  if (WCAG21_CRITERIA.has(criterion)) return "2.1";
  return "2.0";
}

const VERSION_RANK: Record<WcagVersion, number> = { "2.0": 0, "2.1": 1, "2.2": 2 };

/** True when the criterion is part of the given WCAG version. Best-practice (empty) criteria always are. */
export function criterionInVersion(criterion: string, version: WcagVersion): boolean {
  if (!criterion) return true;
  return VERSION_RANK[criterionVersion(criterion)] <= VERSION_RANK[version];
}

/** axe-core tags for a WCAG version and conformance level. */
export function axeTagsFor(version: WcagVersion, level: WcagLevel): string[] {
  const levels: WcagLevel[] = level === "A" ? ["A"] : level === "AA" ? ["A", "AA"] : ["A", "AA", "AAA"];
  const tags: string[] = [];
  for (const l of levels) {
    const suffix = l.toLowerCase();
    tags.push(`wcag2${suffix}`);
    // axe has no wcag21aaa / wcag22a / wcag22aaa rules today; unknown tags are harmless.
    if (VERSION_RANK[version] >= 1 && l !== "AAA") tags.push(`wcag21${suffix}`);
    if (VERSION_RANK[version] >= 2 && l === "AA") tags.push("wcag22aa");
  }
  return tags;
}

export function wcagRef(criterion: string): WcagRef {
  const c = WCAG_CRITERIA[criterion];
  if (!c) return { criterion: "", name: "Best practice", level: "BP" };
  return { criterion, name: c.name, level: c.level };
}

export function wcagDocsUrl(criterion: string): string | undefined {
  const c = WCAG_CRITERIA[criterion];
  return c ? `${U}${c.slug}.html` : undefined;
}

/** Map axe "wcagXXX" tags (e.g. "wcag143") to a criterion string ("1.4.3"). */
export function criterionFromAxeTag(tag: string): string | undefined {
  const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  if (!m) return undefined;
  const c = `${m[1]}.${m[2]}.${m[3]}`;
  return WCAG_CRITERIA[c] ? c : undefined;
}

/**
 * axe rule id -> project rule id. Rules not listed here keep the axe id and are
 * categorized by their axe tags (cat.*). Best-practice-only axe rules are
 * mapped to BP-prefixed ids and never count toward the conformance label.
 */
export const AXE_TO_RULE: Record<string, string> = {
  "image-alt": "IMG-01",
  "input-image-alt": "IMG-06",
  "area-alt": "IMG-06",
  "svg-img-alt": "IMG-05",
  "role-img-alt": "IMG-05",
  "object-alt": "IMG-06",
  "video-caption": "MED-01",
  "no-autoplay-audio": "MED-02",
  "color-contrast": "CLR-01",
  "color-contrast-enhanced": "CLR-08",
  "link-in-text-block": "CLR-06",
  "label": "FRM-01",
  "select-name": "FRM-01",
  "aria-input-field-name": "FRM-01",
  "aria-toggle-field-name": "FRM-01",
  "form-field-multiple-labels": "FRM-10",
  "autocomplete-valid": "FRM-07",
  "label-content-name-mismatch": "FRM-08",
  "tabindex": "KBD-03",
  "focus-order-semantics": "KBD-04",
  "bypass": "KBD-07",
  "skip-link": "KBD-07",
  "scrollable-region-focusable": "KBD-01",
  "document-title": "STR-01",
  "html-has-lang": "STR-02",
  "html-lang-valid": "STR-02",
  "html-xml-lang-mismatch": "STR-02",
  "valid-lang": "STR-11",
  "page-has-heading-one": "STR-03",
  "heading-order": "STR-04",
  "empty-heading": "STR-12",
  "landmark-one-main": "STR-05",
  "landmark-no-duplicate-main": "STR-05",
  "landmark-no-duplicate-banner": "STR-06",
  "landmark-no-duplicate-contentinfo": "STR-06",
  "landmark-banner-is-top-level": "STR-06",
  "landmark-contentinfo-is-top-level": "STR-06",
  "landmark-main-is-top-level": "STR-06",
  "landmark-complementary-is-top-level": "STR-06",
  "landmark-unique": "STR-06",
  "region": "STR-06",
  "td-headers-attr": "STR-07",
  "th-has-data-cells": "STR-07",
  "table-duplicate-name": "STR-07",
  "scope-attr-valid": "STR-07",
  "table-fake-caption": "STR-07",
  "duplicate-id-aria": "STR-08",
  "frame-title": "STR-09",
  "frame-title-unique": "STR-09",
  "frame-tested": "STR-13",
  "list": "STR-14",
  "listitem": "STR-14",
  "definition-list": "STR-14",
  "dlitem": "STR-14",
  "aria-roles": "ARIA-01",
  "aria-allowed-role": "ARIA-01",
  "aria-required-attr": "ARIA-02",
  "aria-valid-attr": "ARIA-02",
  "aria-valid-attr-value": "ARIA-03",
  "aria-allowed-attr": "ARIA-02",
  "aria-prohibited-attr": "ARIA-02",
  "aria-conditional-attr": "ARIA-02",
  "aria-deprecated-role": "ARIA-01",
  "aria-hidden-focus": "ARIA-04",
  "aria-hidden-body": "ARIA-04",
  "aria-required-children": "ARIA-05",
  "aria-required-parent": "ARIA-05",
  "presentation-role-conflict": "ARIA-01",
  "aria-command-name": "LNK-02",
  "aria-dialog-name": "ARIA-07",
  "aria-meter-name": "ARIA-07",
  "aria-progressbar-name": "ARIA-07",
  "aria-tooltip-name": "ARIA-07",
  "aria-treeitem-name": "ARIA-07",
  "aria-text": "ARIA-01",
  "link-name": "LNK-01",
  "button-name": "LNK-02",
  "input-button-name": "LNK-02",
  "identical-links-same-purpose": "LNK-04",
  "target-size": "TGT-01",
  "meta-viewport": "ZM-01",
  "meta-viewport-large": "ZM-01",
  "meta-refresh": "OTH-01",
  "meta-refresh-no-exceptions": "OTH-01",
  "blink": "OTH-02",
  "marquee": "OTH-02",
  "server-side-image-map": "IMG-06",
  "nested-interactive": "KBD-10",
  "accesskeys": "KBD-11",
  "avoid-inline-spacing": "ZM-03",
  "css-orientation-lock": "OTH-03",
  "audio-caption": "MED-01",
  "p-as-heading": "STR-12",
  "image-redundant-alt": "IMG-04",
  "label-title-only": "FRM-02",
  "summary-name": "LNK-02",
  "aria-braille-equivalent": "ARIA-02",
};

/**
 * axe rule id -> project rule id of the custom rule that supersedes it.
 *
 * axe's `color-contrast` reports every text node it fails under one id, so
 * mapping it to CLR-01 (above) is only correct for normal-size text over a
 * solid background. `src/content/rules/contrast.ts` measures the same text
 * and splits it into CLR-01 (normal text), CLR-02 (large text, 3:1) and
 * CLR-03 (over an image/gradient, needs review). When both run, large text
 * and image-backed text are reported twice under different ids (the
 * fingerprints differ, so `dedupeIssues()` cannot collapse them), the score
 * is penalised twice and the axe title/criterion text is wrong for CLR-02.
 *
 * The scanner must therefore pass `rules: { [axeId]: { enabled: false } }`
 * to axe for every entry here whose custom rule (`ruleIdsOf(rule)`) is
 * enabled for the scan, and fall back to the axe rule (via AXE_TO_RULE) only
 * when the custom rule is disabled. The mapping in AXE_TO_RULE is kept so
 * CI parity (`ci/a11y-rules-to-axe.ts`) and that fallback still resolve the
 * project id.
 */
export const AXE_RULES_SUPERSEDED_BY_CUSTOM: Record<string, string> = {
  "color-contrast": "CLR-01",
};

/** Ids of rules that are best-practice only (never a WCAG failure). */
export const BEST_PRACTICE_RULES = new Set([
  "STR-03",
  "STR-04",
  "STR-05",
  "STR-06",
  "STR-12",
  "STR-13",
  "KBD-03",
  "KBD-04",
  "KBD-11",
  "FRM-10",
  "IMG-04",
  "LNK-03",
  "LNK-04",
  "LNK-05",
  "CLR-08",
]);
