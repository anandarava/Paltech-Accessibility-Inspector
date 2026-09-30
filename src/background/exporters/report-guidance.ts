/**
 * Plain-language guidance for the HTML report, written for team leads and
 * clients rather than developers: what the problem is, who it affects, why it
 * matters, how to fix it and roughly how much work that is.
 *
 * Keyed by rule id; rules without an entry fall back to their category.
 */
import type { Category, Severity } from "@shared/types";

export type AffectedUsers =
  | "Screen reader users"
  | "Low vision"
  | "Colour blindness"
  | "Keyboard users"
  | "Limited dexterity"
  | "Cognitive and learning"
  | "Deaf and hard of hearing"
  | "Zoom and magnifier users";

export type Effort = "Quick fix" | "Moderate" | "Larger change";

export interface RuleGuidance {
  /** One-line headline in plain words. */
  headline: string;
  /** Why it matters, from the user's point of view. */
  impact: string;
  /** What to change, in one or two plain sentences. */
  fix: string;
  users: AffectedUsers[];
  effort: Effort;
}

const SR: AffectedUsers = "Screen reader users";
const LV: AffectedUsers = "Low vision";
const CB: AffectedUsers = "Colour blindness";
const KB: AffectedUsers = "Keyboard users";
const MO: AffectedUsers = "Limited dexterity";
const CO: AffectedUsers = "Cognitive and learning";
const DE: AffectedUsers = "Deaf and hard of hearing";
const ZO: AffectedUsers = "Zoom and magnifier users";

const RULES: Record<string, RuleGuidance> = {
  "IMG-01": {
    headline: "Images have no text description",
    impact: "Screen readers announce nothing useful (or the file name), so blind users miss the information the image carries.",
    fix: "Add an alt attribute describing the image's purpose, or alt=\"\" if the image is purely decorative.",
    users: [SR],
    effort: "Quick fix",
  },
  "IMG-02": {
    headline: "Image descriptions are file names",
    impact: "Screen reader users hear something like \"IMG underscore 2031 dot jpg\" instead of what the image shows.",
    fix: "Replace the file name with a short description of the image, or use alt=\"\" if it is decorative.",
    users: [SR],
    effort: "Quick fix",
  },
  "IMG-03": {
    headline: "Image descriptions are too generic",
    impact: "Words like \"image\" or \"photo\" tell screen reader users that an image exists, but not what it shows.",
    fix: "Describe what the image shows or does, e.g. \"Team photo at the 2026 conference\".",
    users: [SR],
    effort: "Quick fix",
  },
  "IMG-04": {
    headline: "Image descriptions start with \"image of\"",
    impact: "Screen readers already say \"image\", so users hear it twice. A small annoyance rather than a barrier.",
    fix: "Remove \"image of\" / \"picture of\" from the start of the alt text.",
    users: [SR],
    effort: "Quick fix",
  },
  "IMG-05": {
    headline: "Icons and graphics have no text description",
    impact: "Screen reader users cannot tell what the graphic means.",
    fix: "Give the SVG a <title> or an aria-label that says what it represents.",
    users: [SR],
    effort: "Quick fix",
  },
  "IMG-06": {
    headline: "Image buttons or image-map areas have no text",
    impact: "These act as controls, so without a text alternative screen reader users cannot tell what they do.",
    fix: "Add alt text that describes the action, e.g. alt=\"Search\".",
    users: [SR],
    effort: "Quick fix",
  },
  "CLR-01": {
    headline: "Text is hard to read because of low contrast",
    impact: "People with low vision, colour blindness or a screen in bright light may not be able to read this text.",
    fix: "Darken the text or lighten the background until the contrast reaches 4.5:1. The suggested colour for each element is shown below.",
    users: [LV, CB],
    effort: "Quick fix",
  },
  "CLR-02": {
    headline: "Large text is hard to read because of low contrast",
    impact: "Even large headings can be unreadable for people with low vision or colour blindness when the contrast is this low.",
    fix: "Darken the text or lighten the background until the contrast reaches 3:1. The suggested colour for each element is shown below.",
    users: [LV, CB],
    effort: "Quick fix",
  },
  "CLR-04": {
    headline: "Buttons, fields or icons are hard to see",
    impact: "People with low vision may not see where a field or control is, so they cannot find or use it.",
    fix: "Use a darker border or icon colour (at least 3:1 against the background). The suggested colour is shown below.",
    users: [LV, CB],
    effort: "Quick fix",
  },
  "CLR-05": {
    headline: "The keyboard focus highlight is hard to see",
    impact: "Keyboard users lose track of where they are on the page when the focus outline blends into the background.",
    fix: "Use a focus outline colour with at least 3:1 contrast against its surroundings.",
    users: [KB, LV],
    effort: "Quick fix",
  },
  "CLR-08": {
    headline: "Text does not meet the enhanced (AAA) contrast level",
    impact: "Most users can read it, but people with moderate low vision would benefit from stronger contrast.",
    fix: "Optional: raise the contrast to 7:1 for body text.",
    users: [LV],
    effort: "Quick fix",
  },
  "FRM-01": {
    headline: "Form fields have no label",
    impact: "Screen reader users hear \"edit text\" with no idea what to type, so they may be unable to complete the form.",
    fix: "Give every field a visible <label> connected to it (for/id), or an aria-label.",
    users: [SR, CO],
    effort: "Quick fix",
  },
  "FRM-02": {
    headline: "Form fields rely on placeholder text as the label",
    impact: "The placeholder disappears as soon as users type, so people with memory or attention difficulties lose the instruction.",
    fix: "Add a visible label that stays on screen; keep the placeholder only for examples.",
    users: [SR, CO, LV],
    effort: "Quick fix",
  },
  "FRM-03": {
    headline: "Groups of options have no group label",
    impact: "Screen reader users hear \"Yes\" / \"No\" without the question they belong to.",
    fix: "Wrap the options in a <fieldset> with a <legend> that states the question.",
    users: [SR],
    effort: "Moderate",
  },
  "FRM-04": {
    headline: "Required fields are not announced as required",
    impact: "Screen reader users only find out a field was required after the form fails.",
    fix: "Add the required (or aria-required=\"true\") attribute to required fields.",
    users: [SR],
    effort: "Quick fix",
  },
  "FRM-07": {
    headline: "Personal-data fields do not support autofill",
    impact: "People with motor or memory difficulties have to type their details by hand instead of using autofill.",
    fix: "Add the correct autocomplete value (e.g. autocomplete=\"email\") to name, email, address and phone fields.",
    users: [MO, CO],
    effort: "Quick fix",
  },
  "FRM-08": {
    headline: "Voice commands do not match the visible label",
    impact: "Voice-control users say the visible text (\"Click Send\") but the control has a different hidden name, so nothing happens.",
    fix: "Make the accessible name start with the visible label text.",
    users: [MO, SR],
    effort: "Quick fix",
  },
  "FRM-10": {
    headline: "Form fields have more than one label",
    impact: "Screen readers may announce the wrong label or a confusing combination.",
    fix: "Keep one <label> per field.",
    users: [SR],
    effort: "Quick fix",
  },
  "KBD-01": {
    headline: "Some clickable items cannot be reached with the keyboard",
    impact: "People who cannot use a mouse are completely blocked from these controls.",
    fix: "Use a real <button> or <a href>, or add tabindex=\"0\" and Enter/Space key handling.",
    users: [KB, SR, MO],
    effort: "Moderate",
  },
  "KBD-02": {
    headline: "Keyboard users get trapped",
    impact: "Once focus enters this area, keyboard users cannot leave it. They are stuck and must reload the page.",
    fix: "Make sure Tab and Shift+Tab (and Escape for dialogs) always move focus out of the component.",
    users: [KB, SR, MO],
    effort: "Larger change",
  },
  "KBD-03": {
    headline: "Custom tab order (positive tabindex)",
    impact: "Focus jumps around the page in an unexpected order, which disorients keyboard and screen reader users.",
    fix: "Remove positive tabindex values and order the HTML to match the visual order.",
    users: [KB, SR],
    effort: "Moderate",
  },
  "KBD-05": {
    headline: "No visible keyboard focus",
    impact: "Keyboard users cannot see which element they are on, like using a mouse with an invisible pointer.",
    fix: "Add a clear focus style (e.g. a 2px outline) and never remove the outline without a replacement.",
    users: [KB, LV],
    effort: "Quick fix",
  },
  "KBD-06": {
    headline: "Focused items are hidden behind sticky headers or footers",
    impact: "Keyboard users tab to an item they cannot see because a sticky bar covers it.",
    fix: "Add scroll-padding to the page (e.g. scroll-padding-top equal to the header height).",
    users: [KB, LV],
    effort: "Quick fix",
  },
  "KBD-07": {
    headline: "No way to skip repeated content",
    impact: "Keyboard users have to tab through the whole menu on every page before reaching the content.",
    fix: "Add a \"Skip to main content\" link and use landmarks (header, nav, main).",
    users: [KB, SR],
    effort: "Moderate",
  },
  "KBD-10": {
    headline: "Controls are nested inside other controls",
    impact: "Screen readers may skip the inner control or announce it incorrectly, and keyboard behaviour becomes unpredictable.",
    fix: "Do not put links or buttons inside other links or buttons; place them side by side.",
    users: [SR, KB],
    effort: "Moderate",
  },
  "KBD-11": {
    headline: "Keyboard shortcuts clash",
    impact: "Two elements share the same accesskey, so the shortcut does not work reliably.",
    fix: "Give every accesskey a unique value, or remove them.",
    users: [KB],
    effort: "Quick fix",
  },
  "STR-01": {
    headline: "The page has no title",
    impact: "Screen reader users and anyone with many tabs open cannot tell which page this is.",
    fix: "Add a descriptive <title>, e.g. \"Checkout – Example Shop\".",
    users: [SR, CO],
    effort: "Quick fix",
  },
  "STR-02": {
    headline: "The page language is not set",
    impact: "Screen readers may read the page with the wrong pronunciation, making it hard to understand.",
    fix: "Add a valid lang attribute to the <html> element, e.g. lang=\"en\".",
    users: [SR],
    effort: "Quick fix",
  },
  "STR-03": {
    headline: "The page has no main heading",
    impact: "Screen reader users often jump to the main heading first; without it they must search for where the content starts.",
    fix: "Add one <h1> that describes the page's content.",
    users: [SR],
    effort: "Quick fix",
  },
  "STR-04": {
    headline: "Heading levels are skipped",
    impact: "Screen reader users use headings like a table of contents; skipped levels suggest missing sections.",
    fix: "Use heading levels in order (h1, then h2, then h3) and style them with CSS instead.",
    users: [SR],
    effort: "Quick fix",
  },
  "STR-05": {
    headline: "The main content area is not marked",
    impact: "Screen reader users cannot jump straight to the main content.",
    fix: "Wrap the main content in a single <main> element.",
    users: [SR, KB],
    effort: "Quick fix",
  },
  "STR-06": {
    headline: "Some content sits outside the page regions",
    impact: "Screen reader users who navigate by region (header, navigation, main, footer) can miss this content.",
    fix: "Place all content inside landmark regions such as <header>, <nav>, <main> and <footer>.",
    users: [SR],
    effort: "Moderate",
  },
  "STR-07": {
    headline: "Data tables are missing header information",
    impact: "Screen reader users hear a stream of numbers without knowing which row or column each belongs to.",
    fix: "Use <th> for header cells with scope=\"col\" or scope=\"row\".",
    users: [SR],
    effort: "Moderate",
  },
  "STR-08": {
    headline: "Duplicate IDs break labels and relationships",
    impact: "Labels and descriptions may point to the wrong element, so screen readers announce the wrong information.",
    fix: "Make every id on the page unique.",
    users: [SR],
    effort: "Quick fix",
  },
  "STR-09": {
    headline: "Embedded frames have no title",
    impact: "Screen reader users hear \"frame\" with no idea what it contains (a video, a map, an advert).",
    fix: "Add a title attribute to every <iframe> describing its content.",
    users: [SR],
    effort: "Quick fix",
  },
  "STR-11": {
    headline: "Some language codes are invalid",
    impact: "Screen readers may pronounce text in the wrong language.",
    fix: "Use valid language codes (e.g. lang=\"fr\").",
    users: [SR],
    effort: "Quick fix",
  },
  "STR-12": {
    headline: "Empty or fake headings",
    impact: "Screen reader users land on headings with nothing in them, or miss text that only looks like a heading.",
    fix: "Remove empty headings, and use real heading tags for text styled as headings.",
    users: [SR],
    effort: "Quick fix",
  },
  "STR-14": {
    headline: "Lists are not coded as lists",
    impact: "Screen readers cannot announce \"list, 5 items\", so users lose the structure.",
    fix: "Put <li> items directly inside <ul> or <ol>.",
    users: [SR],
    effort: "Quick fix",
  },
  "LNK-01": {
    headline: "Links have no text",
    impact: "Screen reader users hear only \"link\" and cannot tell where it goes.",
    fix: "Add link text, or an aria-label for icon links (e.g. aria-label=\"Twitter\").",
    users: [SR],
    effort: "Quick fix",
  },
  "LNK-02": {
    headline: "Buttons have no text",
    impact: "Screen reader users hear only \"button\" and cannot tell what it does.",
    fix: "Add button text, or an aria-label for icon buttons (e.g. aria-label=\"Close\").",
    users: [SR],
    effort: "Quick fix",
  },
  "LNK-03": {
    headline: "Link text is vague (\"click here\", \"read more\")",
    impact: "Screen reader users often list all links on a page; ten \"read more\" links are impossible to tell apart.",
    fix: "Make the link text describe the destination, e.g. \"Read more about pricing\".",
    users: [SR, CO],
    effort: "Quick fix",
  },
  "LNK-04": {
    headline: "Links with the same text go to different places",
    impact: "Users expect identical links to go to the same place and get confused when they do not.",
    fix: "Give each link text that describes its own destination.",
    users: [SR, CO],
    effort: "Quick fix",
  },
  "LNK-05": {
    headline: "Links open a new window without warning",
    impact: "Screen reader and cognitive-disability users may not notice the new window and lose the Back button.",
    fix: "Add \"(opens in a new tab)\" to the link text or an icon with that label.",
    users: [SR, CO],
    effort: "Quick fix",
  },
  "TGT-01": {
    headline: "Click and tap targets are too small",
    impact: "People with tremors, limited dexterity or on touch screens often hit the wrong item.",
    fix: "Make targets at least 24 × 24 px, or leave enough space around them.",
    users: [MO],
    effort: "Quick fix",
  },
  "ZM-01": {
    headline: "Zooming is disabled",
    impact: "People with low vision cannot pinch-zoom on mobile to read the content.",
    fix: "Remove user-scalable=no and maximum-scale from the viewport meta tag.",
    users: [LV, ZO],
    effort: "Quick fix",
  },
  "ZM-02": {
    headline: "Content does not fit on small screens or at high zoom",
    impact: "People who zoom to 400% must scroll sideways on every line, which makes reading very hard.",
    fix: "Use a responsive layout so content reflows into one column at 320 px width.",
    users: [LV, ZO],
    effort: "Larger change",
  },
  "ZM-03": {
    headline: "Text gets cut off when spacing is increased",
    impact: "People with dyslexia or low vision who increase letter or line spacing lose part of the text.",
    fix: "Avoid fixed heights and overflow: hidden on text containers so boxes can grow.",
    users: [CO, LV],
    effort: "Moderate",
  },
  "OTH-01": {
    headline: "The page refreshes or redirects on a timer",
    impact: "Users who read or type slowly lose their place or their input.",
    fix: "Remove the timed refresh, or let users turn it off or extend it.",
    users: [CO, SR, MO],
    effort: "Moderate",
  },
  "OTH-02": {
    headline: "Content moves or blinks and cannot be paused",
    impact: "Moving content distracts people with attention difficulties and can be unreadable for others.",
    fix: "Remove <marquee>/<blink>, or add a pause button.",
    users: [CO, LV],
    effort: "Quick fix",
  },
  "OTH-03": {
    headline: "The page only works in one screen orientation",
    impact: "People with a device mounted in a fixed orientation (e.g. on a wheelchair) cannot use the page.",
    fix: "Remove the orientation lock so the page works in portrait and landscape.",
    users: [MO, LV],
    effort: "Moderate",
  },
  "MED-01": {
    headline: "Videos have no captions",
    impact: "Deaf and hard-of-hearing users miss everything that is said.",
    fix: "Add a captions track (<track kind=\"captions\">) to every video with speech.",
    users: [DE],
    effort: "Larger change",
  },
  "MED-02": {
    headline: "Audio plays automatically",
    impact: "The sound drowns out screen readers, and users may not find how to stop it.",
    fix: "Do not autoplay audio, or provide a clear pause/mute control at the top of the page.",
    users: [SR, CO],
    effort: "Quick fix",
  },
};

const ARIA_DEFAULT: RuleGuidance = {
  headline: "Assistive technology gets wrong information (ARIA)",
  impact: "Screen readers announce the wrong role, state or name, so users may not understand or be able to use the control.",
  fix: "Correct the ARIA attributes (or use the native HTML element instead) as described for each element below.",
  users: [SR],
  effort: "Moderate",
};

const CATEGORY_DEFAULT: Record<Category, Omit<RuleGuidance, "headline">> = {
  "Images and Media": { impact: "Users who cannot see or hear the media miss its information.", fix: "Provide a text or caption alternative.", users: [SR, DE], effort: "Quick fix" },
  "Color and Contrast": { impact: "People with low vision or colour blindness may not be able to see this content.", fix: "Increase the contrast.", users: [LV, CB], effort: "Quick fix" },
  Forms: { impact: "Some users may be unable to understand or complete the form.", fix: "Label fields and instructions clearly in code and on screen.", users: [SR, CO], effort: "Quick fix" },
  "Keyboard and Focus": { impact: "People who cannot use a mouse may be unable to use this part of the page.", fix: "Make everything reachable and visible with the keyboard.", users: [KB, MO], effort: "Moderate" },
  "Page Structure and Semantics": { impact: "Screen reader users lose the page's structure and navigation shortcuts.", fix: "Use the correct HTML elements for the structure.", users: [SR], effort: "Quick fix" },
  ARIA: ARIA_DEFAULT,
  "Links, Buttons, and Targets": { impact: "Some users cannot tell what a control does or cannot hit it reliably.", fix: "Give controls clear names and a comfortable size.", users: [SR, MO], effort: "Quick fix" },
  "Responsiveness and Zoom": { impact: "People who zoom or change text settings lose content.", fix: "Let the layout adapt to zoom and text spacing.", users: [LV, ZO], effort: "Moderate" },
  "Best Practice": { impact: "Not a WCAG failure, but it makes the page harder to use for some people.", fix: "Follow the recommendation for each element below.", users: [SR], effort: "Quick fix" },
  Other: { impact: "Some users may be unable to use this content.", fix: "Follow the recommendation for each element below.", users: [CO], effort: "Moderate" },
};

export function guidanceFor(ruleId: string, category: Category, title: string): RuleGuidance {
  const exact = RULES[ruleId];
  if (exact) return exact;
  if (ruleId.startsWith("ARIA-")) return { ...ARIA_DEFAULT, headline: title };
  const byCategory = CATEGORY_DEFAULT[category] ?? CATEGORY_DEFAULT.Other;
  return { headline: title, ...byCategory };
}

/** What each severity means for a real user, in one short phrase. */
export const SEVERITY_MEANING: Record<Severity, string> = {
  Critical: "Blocks some users completely",
  Serious: "Makes tasks very difficult",
  Moderate: "Causes frustration or confusion",
  Minor: "Small annoyance",
};
