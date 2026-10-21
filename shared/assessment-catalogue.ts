/**
 * The manual assessment catalogue: every requirement once, then Quick Assess (10 of them) and the
 * Full Assessment (23 tests covering every WCAG 2.2 A and AA success criterion that needs a
 * person). A requirement used by both keeps one id, so results move from Quick Assess to Full.
 */
import type { Requirement } from "./assessment";

export interface AssessmentTest {
  id: string;
  name: string;
  /** What the test is about, for its Getting started page. */
  description: string;
  requirements: Requirement[];
}

type Def = Omit<Requirement, "id" | "test">;
const sc = (criterion: string, name: string, level: "A" | "AA") => ({ criterion, name, level });

/** Every requirement, by id. `test` is filled in from the test that lists it first. */
const R: Record<string, Def> = {
  // ---- Keyboard ---------------------------------------------------------------------------
  "keyboard-navigation": {
    name: "Keyboard navigation",
    wcag: sc("2.1.1", "Keyboard", "A"),
    kind: "manual",
    description: "Every interactive control can be reached and used with the keyboard alone.",
    steps: [
      "Turn on the visual helper, go to the page and press Tab from the top. Each control that gets focus is numbered.",
      "Move through every control with Tab and Shift+Tab; use the arrow keys inside menus, tabs and radio groups.",
      "Open anything that reveals more content (menus, accordions, dialogs), move through it, close it and carry on.",
      "If focus gets stuck in a control, note it, move on with the mouse and continue.",
      "Pass if every control can be reached and used. Otherwise Fail, and add each control that cannot.",
    ],
    helper: "focus",
    helperNote: "Recording the focus path: go to the page and press Tab.",
    fix: "Use native links, buttons and form controls, or give custom controls tabindex=\"0\" and Enter / Space handling.",
  },
  "no-keyboard-traps": {
    name: "No keyboard traps",
    wcag: sc("2.1.2", "No Keyboard Trap", "A"),
    kind: "manual",
    description: "Keyboard focus can always move away from any part of the page with the keyboard (Tab, Shift+Tab, Escape or a stated key).",
    steps: [
      "Turn on the visual helper and Tab through the whole page, including embedded content (videos, maps, editors, iframes).",
      "At each control, check that Tab and Shift+Tab move focus on. If other keys are needed, the page must say which.",
      "Pass if focus never gets stuck. Otherwise Fail, and add the control where it does.",
    ],
    helper: "focus",
    helperNote: "Recording the focus path: go to the page and press Tab.",
    fix: "Let Tab leave every widget; if a widget keeps focus on purpose (a modal), Escape must close it and return focus.",
  },
  "on-focus": {
    name: "On focus",
    wcag: sc("3.2.1", "On Focus", "A"),
    kind: "manual",
    description: "Moving focus to a control does not by itself change the context (open a new page or window, submit a form, move focus elsewhere).",
    steps: [
      "Tab to every control without pressing Enter or Space.",
      "Check that nothing unexpected happens when a control just receives focus: no new page, window or dialog, no submit, no focus jump.",
      "Pass if focusing never changes the context. Otherwise Fail, and add each control that does.",
    ],
    helper: "focus",
    helperNote: "Recording the focus path: go to the page and press Tab.",
    fix: "Only change context on an explicit action (a click or Enter on a button), never on focus.",
  },
  "on-input": {
    name: "On input",
    wcag: sc("3.2.2", "On Input", "A"),
    kind: "manual",
    description: "Changing a setting (choosing an option, ticking a box, typing) does not change the context unless the user was told beforehand.",
    steps: [
      "Change the value of every form control: select options, tick boxes, choose radio buttons, type in fields.",
      "Check that no new page or window opens, no form is submitted and focus does not jump as a result.",
      "If a change does that, check that text before the control says it will.",
      "Pass if no unannounced change happens. Otherwise Fail, and add each control.",
    ],
    fix: "Add a submit button for the change, or tell the user before the control what will happen.",
  },
  "no-keystroke-timing": {
    name: "No keystroke timing",
    wcag: sc("2.1.1", "Keyboard", "A"),
    kind: "manual",
    description: "Nothing requires pressing keys at a particular speed or holding them down; any path a mouse can follow can be done with keys.",
    steps: [
      "Use every function of the page with the keyboard: drawing, sliders, games, drag and drop, carousels.",
      "Check that none of them needs fast, timed or held key presses.",
      "Pass if every function works without keystroke timing. Otherwise Fail, and add each one.",
    ],
    fix: "Provide a keyboard alternative that does not depend on timing (step buttons, a text field for the value).",
  },
  "character-key-shortcuts": {
    name: "Character key shortcuts",
    wcag: sc("2.1.4", "Character Key Shortcuts", "A"),
    kind: "manual",
    description: "Shortcuts that use only a letter, number or symbol key can be turned off or remapped, or work only when their control has focus.",
    steps: [
      "Find out whether the page has single-key shortcuts (its help, documentation or by trying keys like ?, j, k, s).",
      "For each one, check it can be turned off or changed, or only works while the related control has focus.",
      "Pass if the page has no such shortcuts, or each can be turned off, remapped or is limited to focus. Otherwise Fail.",
    ],
    fix: "Add a setting to turn single-key shortcuts off or remap them, or require a modifier key (Ctrl, Alt).",
  },

  // ---- Focus ------------------------------------------------------------------------------
  "focus-indicator": {
    name: "Visible focus",
    wcag: sc("2.4.7", "Focus Visible", "AA"),
    kind: "manual",
    description: "The control with keyboard focus always shows a visible indicator.",
    steps: [
      "Turn on the visual helper, go to the page and Tab through every control.",
      "At each stop, check you can see which control has focus (an outline, underline, colour or shape change).",
      "Pass if focus is always visible. Otherwise Fail, and add each control where it is not.",
    ],
    helper: "focus",
    helperNote: "Recording the focus path: go to the page and press Tab.",
    fix: "Do not remove the outline without a replacement; style :focus-visible with a clear outline of at least 2px.",
  },
  "focus-order": {
    name: "Focus order",
    wcag: sc("2.4.3", "Focus Order", "A"),
    kind: "manual",
    description: "Focus moves through the page in an order that keeps its meaning and makes sense to use.",
    steps: [
      "Turn on the visual helper, go to the page and press Tab from the top; the numbers show the order focus took.",
      "Check the order follows the reading order and the logical sequence of the task (a form from top to bottom).",
      "Open dialogs and menus: focus moves into them and returns to the control that opened them.",
      "Pass if the order makes sense everywhere. Otherwise Fail, and add each place where it does not.",
    ],
    helper: "focus",
    helperNote: "Recording the focus path: go to the page and press Tab.",
    fix: "Match the DOM order to the visual order; avoid positive tabindex; move focus into dialogs and back.",
  },
  "focus-not-obscured": {
    name: "Focus not hidden",
    wcag: sc("2.4.11", "Focus Not Obscured (Minimum)", "AA"),
    kind: "manual",
    description: "A focused control is never entirely hidden by content the page itself places on top (sticky headers, footers, cookie banners, chat buttons).",
    steps: [
      "Tab through the page, especially near sticky headers and footers and with any banner or chat button showing.",
      "Check each focused control is at least partly visible.",
      "Pass if focus is never entirely covered. Otherwise Fail, and add each control and what covers it.",
    ],
    helper: "focus",
    helperNote: "Recording the focus path: go to the page and press Tab.",
    fix: "Add scroll-padding for sticky areas, or let banners be dismissed without moving focus.",
  },
  "modal-dialogs": {
    name: "Modal dialogs",
    wcag: sc("2.4.3", "Focus Order", "A"),
    kind: "manual",
    description: "When a modal dialog opens, focus moves into it, stays in it while it is open, and returns to the control that opened it when it closes.",
    steps: [
      "Open each dialog with the keyboard.",
      "Check focus moves into the dialog, Tab cycles within it, and Escape (or the close button) closes it.",
      "Check focus returns to the control that opened it.",
      "Pass if every dialog behaves so, or there are none. Otherwise Fail, and add each dialog.",
    ],
    fix: "Use <dialog> with showModal(), or move focus in on open, contain it, and restore it on close.",
  },
  "revealing-content": {
    name: "Revealed content",
    wcag: sc("2.4.3", "Focus Order", "A"),
    kind: "manual",
    description: "Content revealed by a control (menus, accordions, tabs, disclosures) comes next in the focus order, right after that control.",
    steps: [
      "With the keyboard, open every control that reveals content.",
      "Press Tab: focus should move into the revealed content, not to the end of the page or elsewhere.",
      "Pass if revealed content always comes next. Otherwise Fail, and add each control.",
    ],
    fix: "Insert revealed content right after its control in the DOM, or move focus into it.",
  },
  "hover-focus-content": {
    name: "Content on hover or focus",
    wcag: sc("1.4.13", "Content on Hover or Focus", "AA"),
    kind: "manual",
    description: "Pop-ups that appear on hover or focus (tooltips, sub-menus) can be dismissed without moving the pointer or focus, can be hovered, and stay until dismissed.",
    steps: [
      "Hover and focus everything that shows extra content (tooltips, sub-menus, previews).",
      "Check Escape closes it without moving the pointer or focus.",
      "Check you can move the pointer onto the new content without it disappearing, and that it stays until you move away or dismiss it.",
      "Pass if every pop-up meets all three. Otherwise Fail, and add each one.",
    ],
    fix: "Close pop-ups with Escape, keep them open while hovered, and do not hide them on a timer.",
  },

  // ---- Landmarks --------------------------------------------------------------------------
  "main-landmark": {
    name: "Main landmark",
    wcag: sc("2.4.1", "Bypass Blocks", "A"),
    kind: "manual",
    description: "The page's primary content is in exactly one main landmark.",
    steps: ["Turn on the visual helper: the page's landmarks are labelled.", "Check there is one main landmark and it holds the page's primary content.", "Pass if so. Otherwise Fail."],
    helper: "landmarks",
    helperNote: "Landmarks are labelled on the page.",
    fix: "Wrap the primary content in a single <main> element.",
  },
  "content-in-landmarks": {
    name: "Content in landmarks",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "manual",
    description: "All visible content is inside a landmark (banner, navigation, main, complementary, contentinfo, search, form, region).",
    steps: ["Turn on the visual helper.", "Look for visible content outside every labelled landmark.", "Pass if all content is inside landmarks. Otherwise Fail, and add what is not."],
    helper: "landmarks",
    helperNote: "Landmarks are labelled on the page.",
    fix: "Wrap content in <header>, <nav>, <main>, <aside> or <footer> as fits.",
  },
  "landmark-roles": {
    name: "Landmark roles and labels",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "manual",
    description: "Each landmark's role matches its content, and landmarks of the same role have different labels.",
    steps: [
      "Turn on the visual helper.",
      "Check each landmark's role fits its content (navigation holds links, complementary holds supporting content).",
      "Where there are two or more of one role (two navigations), check each has a label that tells them apart.",
      "Pass if so. Otherwise Fail.",
    ],
    helper: "landmarks",
    helperNote: "Landmarks are labelled on the page.",
    fix: "Use the right element for each region and give repeated landmarks an aria-label (\"Main\", \"Footer links\").",
  },

  // ---- Headings ---------------------------------------------------------------------------
  "missing-headings": {
    name: "Missing headings",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "manual",
    description: "Text that looks like a heading is coded as a heading.",
    steps: [
      "Turn on the visual helper: every coded heading on the page is labelled with its level.",
      "Look for text that looks like a heading (larger, bold, starts a section) but has no label.",
      "Pass if every visual heading is coded as one. Otherwise Fail, and add each one that is not.",
    ],
    helper: "headings",
    helperNote: "Coded headings are labelled on the page.",
    fix: "Mark up visual headings with <h1>–<h6> (or role=\"heading\" with aria-level).",
  },
  "heading-level": {
    name: "Heading level",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "assisted",
    description: "A heading's level matches its place in the structure of the page.",
    steps: [
      "Read the headings below in order: their levels should form an outline of the page.",
      "A section's heading is one level below the heading of the section it belongs to.",
      "Mark each heading Pass or Fail.",
    ],
    helper: "headings",
    helperNote: "Coded headings are labelled on the page.",
    instances: "headings",
    detailLabel: "Level",
    fix: "Change the heading's level so that it matches its place in the page's outline.",
  },
  "descriptive-headings": {
    name: "Descriptive headings",
    wcag: sc("2.4.6", "Headings and Labels", "AA"),
    kind: "assisted",
    description: "Each heading describes the content of its section, and coded headings are real headings (not text styled big).",
    steps: ["For each heading below, check it tells you what its section is about.", "Check it actually heads a section of content.", "Mark each heading Pass or Fail."],
    helper: "headings",
    helperNote: "Coded headings are labelled on the page.",
    instances: "headings",
    detailLabel: "Level",
    fix: "Reword vague headings; remove heading markup from text that does not start a section.",
  },

  // ---- Repetitive content -----------------------------------------------------------------
  "bypass-blocks": {
    name: "Bypass blocks",
    wcag: sc("2.4.1", "Bypass Blocks", "A"),
    kind: "manual",
    description: "There is a way to skip blocks repeated on every page (header, navigation), such as a skip link, landmarks or headings.",
    steps: [
      "Go to the page and press Tab once: a \"Skip to main content\" link should appear and work.",
      "Turn on the visual helper: the page's landmarks (header, navigation, main) are labelled.",
      "Pass if there is a skip link that works, or the main content is in a main landmark. Otherwise Fail.",
    ],
    helper: "landmarks",
    helperNote: "Landmarks are labelled on the page.",
    fix: "Add a \"Skip to main content\" link as the first focusable element, and wrap the main content in <main>.",
  },
  "consistent-navigation": {
    name: "Consistent navigation",
    wcag: sc("3.2.3", "Consistent Navigation", "AA"),
    kind: "manual",
    description: "Navigation repeated on several pages appears in the same relative order each time.",
    steps: ["Open two or three other pages of the site.", "Compare the menus, header and footer links: they should be in the same order.", "Pass if the order is the same (items may be added). Otherwise Fail."],
    fix: "Render repeated navigation from one shared component.",
  },
  "consistent-identification": {
    name: "Consistent identification",
    wcag: sc("3.2.4", "Consistent Identification", "AA"),
    kind: "manual",
    description: "Components that do the same thing on different pages are named and labelled the same way (one search, one cart, the same icons).",
    steps: ["Open two or three other pages.", "Compare controls with the same function (search, log in, cart, print): same names, labels and icons.", "Pass if they match. Otherwise Fail."],
    fix: "Use the same label, accessible name and icon for a function everywhere.",
  },
  "consistent-help": {
    name: "Consistent help",
    wcag: sc("3.2.6", "Consistent Help", "A"),
    kind: "manual",
    description: "Help offered on several pages (contact details, a help link, a chat) is in the same place relative to other content.",
    steps: ["Find the help options on this page (contact, help link, chat).", "Open other pages that offer them and compare where they are.", "Pass if they are in the same relative place, or the site offers no help. Otherwise Fail."],
    fix: "Place help links and contact details in a shared header or footer.",
  },

  // ---- Links ------------------------------------------------------------------------------
  "link-purpose": {
    name: "Link purpose",
    wcag: sc("2.4.4", "Link Purpose (In Context)", "A"),
    kind: "assisted",
    description: "Each link's purpose is clear from its text, or from its text together with the sentence, list item or table cell around it.",
    steps: [
      "For each link below, read its name: does it say where the link goes or what it does?",
      "If the name alone is unclear (\"Click here\", \"Learn more\"), check the sentence, list item or table cell around it.",
      "Mark each link Pass or Fail. Use the visual helper to find a link on the page.",
    ],
    helper: "instances",
    helperNote: "The links are outlined on the page.",
    instances: "links",
    detailLabel: "Goes to",
    fix: "Make the link text say where it goes, or add the missing context to its accessible name (aria-label, visually hidden text).",
  },
  "link-function": {
    name: "Link or button",
    wcag: sc("4.1.2", "Name, Role, Value", "A"),
    kind: "assisted",
    description: "Elements coded as links take you somewhere; elements that perform an action (open a dialog, submit, toggle) are buttons.",
    steps: ["For each link below, find out what it does (use Show).", "Pass it if it navigates to a page or a place in the page; Fail it if it performs an action instead."],
    helper: "instances",
    helperNote: "The links are outlined on the page.",
    instances: "links",
    detailLabel: "Goes to",
    fix: "Use <button> for actions and <a href> for navigation.",
  },
  "link-label-in-name": {
    name: "Link name includes visible text",
    wcag: sc("2.5.3", "Label in Name", "A"),
    kind: "assisted",
    description: "A link's accessible name contains the words shown on it, so speech-input users can say what they see.",
    steps: ["For each link below, compare its name with the text you see on it (use Show).", "Pass it if the name contains the visible words (ideally starting with them); otherwise Fail."],
    helper: "instances",
    helperNote: "The links are outlined on the page.",
    instances: "links",
    detailLabel: "Goes to",
    fix: "Start aria-label with the visible text, or drop aria-label and use the visible text as the name.",
  },

  // ---- Native widgets ---------------------------------------------------------------------
  instructions: {
    name: "Instructions",
    wcag: sc("3.3.2", "Labels or Instructions", "A"),
    kind: "assisted",
    description: "Form fields have a visible label, and the instructions the user needs (required, format) are shown.",
    steps: [
      "For each field below, check it has a visible label next to it (a placeholder alone is not enough).",
      "Check the instructions the user needs are visible: which fields are required, the expected format (dates, passwords).",
      "Mark each field Pass or Fail.",
    ],
    helper: "instances",
    helperNote: "The form fields are outlined on the page.",
    instances: "fields",
    detailLabel: "Field",
    fix: "Add a visible <label> to each field and show required and format instructions before the user fills it in.",
  },
  "descriptive-labels": {
    name: "Descriptive labels",
    wcag: sc("2.4.6", "Headings and Labels", "AA"),
    kind: "assisted",
    description: "Each form field's label describes what to enter.",
    steps: ["For each field below, read its label: does it say what to enter?", "Mark each field Pass or Fail."],
    helper: "instances",
    helperNote: "The form fields are outlined on the page.",
    instances: "fields",
    detailLabel: "Field",
    fix: "Rewrite vague labels (\"Field 1\", \"Info\") to name the data asked for.",
  },
  "input-purpose": {
    name: "Input purpose",
    wcag: sc("1.3.5", "Identify Input Purpose", "AA"),
    kind: "assisted",
    description: "Fields that ask for the user's own details (name, email, phone, address, card) carry the matching autocomplete value.",
    steps: [
      "For each field below that asks about the user (not about someone else), check it has the right autocomplete value (name, email, tel, street-address, postal-code, cc-number …).",
      "Pass fields that are not about the user, or have the right value; Fail the others.",
    ],
    helper: "instances",
    helperNote: "The form fields are outlined on the page.",
    instances: "fields",
    detailLabel: "Field",
    fix: "Add autocomplete=\"given-name\", \"email\", \"tel\" … to fields about the user.",
  },
  "grouped-controls": {
    name: "Grouped controls",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "manual",
    description: "Related controls (radio buttons, a set of checkboxes, the parts of a date) are grouped, and the group has a name.",
    steps: ["Find groups of related controls on the page.", "Check each group is a <fieldset> with a <legend>, or role=\"group\" / \"radiogroup\" with a name.", "Pass if every group is so, or there are none. Otherwise Fail."],
    fix: "Wrap related controls in <fieldset> with a <legend> that asks the question.",
  },
  "native-name-role-value": {
    name: "Native controls",
    wcag: sc("4.1.2", "Name, Role, Value", "A"),
    kind: "assisted",
    description: "Buttons and form controls have a name that says what they do, and are used as the browser intends (no role overrides that break them).",
    steps: ["For each control below, check its name says what it does.", "Check its type matches its function (a button that looks like a link is still a button).", "Mark each control Pass or Fail."],
    helper: "instances",
    helperNote: "The controls are outlined on the page.",
    instances: "controls",
    detailLabel: "Type",
    fix: "Give each control a clear accessible name and use the native element that matches its function.",
  },

  // ---- Custom widgets ---------------------------------------------------------------------
  "custom-role": {
    name: "Widget role",
    wcag: sc("4.1.2", "Name, Role, Value", "A"),
    kind: "manual",
    description: "Custom widgets (menus, tabs, accordions, comboboxes, sliders) expose the role that matches how they work.",
    steps: ["Find the custom widgets on the page (built from divs and spans rather than native controls).", "With the browser's accessibility tree (DevTools > Accessibility), check each has a fitting role.", "Pass if every custom widget has the right role, or there are none. Otherwise Fail."],
    fix: "Use native elements where possible; otherwise add the ARIA role of the pattern (tablist/tab, menu/menuitem …).",
  },
  "custom-name": {
    name: "Widget name",
    wcag: sc("4.1.2", "Name, Role, Value", "A"),
    kind: "assisted",
    description: "Every control, including custom ones and icon-only buttons, has an accessible name.",
    steps: ["For each control below, check its name is present and says what it does.", "Mark each control Pass or Fail."],
    helper: "instances",
    helperNote: "The controls are outlined on the page.",
    instances: "controls",
    detailLabel: "Type",
    fix: "Add visible text, aria-label or aria-labelledby to unnamed controls.",
  },
  "custom-state": {
    name: "Widget state",
    wcag: sc("4.1.2", "Name, Role, Value", "A"),
    kind: "manual",
    description: "Custom widgets expose their state and value (expanded, selected, checked, pressed, the current value) and update it as it changes.",
    steps: ["Operate each custom widget.", "In the accessibility tree, check its state (aria-expanded, aria-selected, aria-checked, aria-pressed, aria-valuenow) changes with it.", "Pass if states are exposed and current, or there are none. Otherwise Fail."],
    fix: "Set and update the matching aria-* state on every change.",
  },
  "custom-keyboard": {
    name: "Widget keyboard",
    wcag: sc("2.1.1", "Keyboard", "A"),
    kind: "manual",
    description: "Custom widgets respond to the keys their pattern expects (arrows in tabs and menus, Enter and Space on buttons, Escape to close).",
    steps: ["Use each custom widget with the keyboard only.", "Check it works with the keys you would expect for its kind.", "Pass if every widget works, or there are none. Otherwise Fail, and add each one that does not."],
    fix: "Follow the ARIA Authoring Practices keyboard pattern for each widget.",
  },
  "custom-instructions": {
    name: "Widget instructions",
    wcag: sc("3.3.2", "Labels or Instructions", "A"),
    kind: "manual",
    description: "Custom inputs (date pickers, sliders, rich editors) have a visible label and any instructions needed to use them.",
    steps: ["Find custom inputs on the page.", "Check each has a visible label and, where needed, how to use it.", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Add a visible label and short instructions next to custom inputs.",
  },
  "custom-label-in-name": {
    name: "Widget name includes visible text",
    wcag: sc("2.5.3", "Label in Name", "A"),
    kind: "assisted",
    description: "A control's accessible name contains the words shown on it, so speech-input users can say what they see.",
    steps: ["For each control below, compare its name with the text shown on it (use Show).", "Pass it if the name contains the visible words; otherwise Fail."],
    helper: "instances",
    helperNote: "The controls are outlined on the page.",
    instances: "controls",
    detailLabel: "Type",
    fix: "Start aria-label with the visible text, or remove aria-label so the visible text is the name.",
  },

  // ---- Timed events -----------------------------------------------------------------------
  "timing-adjustable": {
    name: "Time limits",
    wcag: sc("2.2.1", "Timing Adjustable", "A"),
    kind: "manual",
    description: "Every time limit (a session timeout, a timed form, auto-advancing content) can be turned off, adjusted or extended, with a warning before it runs out.",
    steps: ["Find out whether the page has time limits (session timeouts, countdowns, timed quizzes).", "Check each can be turned off or adjusted, or you are warned and can extend it with a simple action.", "Pass if so, or there are none (or the limit is essential, like an auction). Otherwise Fail."],
    fix: "Warn at least 20 seconds before a timeout and offer \"Extend session\".",
  },
  "pause-moving-content": {
    name: "Moving content",
    wcag: sc("2.2.2", "Pause, Stop, Hide", "A"),
    kind: "manual",
    description: "Content that moves, scrolls or blinks for more than five seconds alongside other content (carousels, tickers, animations) can be paused, stopped or hidden.",
    steps: ["Find content that moves, scrolls or blinks on its own.", "Check it stops within 5 seconds, or has a pause, stop or hide control that works with the keyboard.", "Pass if so, or there is none. Otherwise Fail."],
    fix: "Add a pause button to carousels and animations, and respect prefers-reduced-motion.",
  },
  "auto-updating": {
    name: "Auto-updating content",
    wcag: sc("2.2.2", "Pause, Stop, Hide", "A"),
    kind: "manual",
    description: "Content that updates on its own (live scores, news feeds, stock tickers) can be paused or its update frequency controlled.",
    steps: ["Find content that updates on its own.", "Check it can be paused, stopped or hidden, or its frequency set.", "Pass if so, or there is none. Otherwise Fail."],
    fix: "Provide a pause control, or update only when the user asks.",
  },
  flashing: {
    name: "Flashing",
    wcag: sc("2.3.1", "Three Flashes or Below Threshold", "A"),
    kind: "manual",
    description: "Nothing on the page flashes more than three times in any one second.",
    steps: ["Watch the page, its animations and videos for flashing content.", "Pass if nothing flashes more than three times a second. Otherwise Fail, and add what does."],
    fix: "Slow down or remove flashing; check videos with a photosensitive epilepsy analysis tool.",
  },

  // ---- Errors / status --------------------------------------------------------------------
  "error-identification": {
    name: "Error identification",
    wcag: sc("3.3.1", "Error Identification", "A"),
    kind: "manual",
    description: "When an input error is detected, the field in error is identified and the error is described in text.",
    steps: ["Submit each form with fields empty or filled in wrongly.", "Check each error is shown in text (not only by colour or an icon) and says which field it concerns.", "Pass if so, or there are no forms. Otherwise Fail, and add each error that is not."],
    fix: "Show a text message next to the field, link it with aria-describedby and set aria-invalid.",
  },
  "error-suggestion": {
    name: "Error suggestion",
    wcag: sc("3.3.3", "Error Suggestion", "AA"),
    kind: "manual",
    description: "When the page knows how to fix an input error, it says so (\"Enter a date like 31/12/2026\").",
    steps: ["Trigger the form's errors.", "Check each message says how to correct the input where that is known.", "Pass if so, or there are no forms. Otherwise Fail."],
    fix: "Write error messages that state the expected format or value.",
  },
  "error-prevention": {
    name: "Error prevention",
    wcag: sc("3.3.4", "Error Prevention (Legal, Financial, Data)", "AA"),
    kind: "manual",
    description: "Submissions with legal or financial effect, or that change stored data, can be reversed, are checked, or can be reviewed and confirmed first.",
    steps: ["Find forms that commit to something (a purchase, a booking, a legal agreement, deleting data).", "Check the user can review and correct before submitting, or cancel afterwards, or input is checked for errors.", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Add a review step with a confirm button, or an undo period.",
  },
  "status-messages": {
    name: "Status messages",
    wcag: sc("4.1.3", "Status Messages", "AA"),
    kind: "manual",
    description: "Messages that appear without moving focus (\"Added to cart\", \"3 results\", \"Saved\") are announced by screen readers.",
    steps: ["Trigger the page's status messages (add to cart, search, save, form errors that appear without focus moving).", "With a screen reader, or in the accessibility tree, check each is in a live region (role=status, alert, log, or aria-live).", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Put status text in an element with role=\"status\" (or role=\"alert\" for errors) that exists before the text appears.",
  },

  // ---- Page navigation --------------------------------------------------------------------
  "page-title": {
    name: "Page title",
    wcag: sc("2.4.2", "Page Titled", "A"),
    kind: "manual",
    description: "The page has a title that describes its topic or purpose.",
    steps: ["Read the page's title (the browser tab).", "Check it describes this page (not only the site name) and changes with the page or view.", "Pass if so. Otherwise Fail."],
    fix: "Set <title> to \"Page – Site\", and update it on single-page-app route changes.",
  },
  "multiple-ways": {
    name: "Multiple ways",
    wcag: sc("2.4.5", "Multiple Ways", "AA"),
    kind: "manual",
    description: "There is more than one way to find this page within the site (navigation, search, a site map, links).",
    steps: ["Check how a user could reach this page: menus, search, a site map, an index, related links.", "Pass if there are two or more ways (or the page is a step in a process). Otherwise Fail."],
    fix: "Add site search or a site map alongside the navigation.",
  },
  "frame-titles": {
    name: "Frame titles",
    wcag: sc("4.1.2", "Name, Role, Value", "A"),
    kind: "manual",
    description: "Every iframe has a title that describes its content.",
    steps: ["Find the page's iframes (videos, maps, embeds, forms).", "Check each has a title attribute that describes it (\"Map of our office\").", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Add title=\"…\" to each <iframe>.",
  },

  // ---- Images -----------------------------------------------------------------------------
  "image-function": {
    name: "Image function",
    wcag: sc("1.1.1", "Non-text Content", "A"),
    kind: "assisted",
    description: "Images that carry meaning have a text alternative that says what they convey; decorative images are hidden from assistive technology.",
    steps: [
      "For each image below, look at it on the page and decide whether it carries meaning or is decoration.",
      "Meaningful: its text alternative must convey the same information or function (a linked logo says where it goes).",
      "Decorative: it must have an empty alt (alt=\"\") or be hidden from assistive technology.",
      "Mark each image Pass or Fail.",
    ],
    helper: "instances",
    helperNote: "The images are outlined on the page.",
    instances: "images",
    detailLabel: "Text alternative",
    fix: "Give meaningful images an alt that conveys their purpose; give decorative images alt=\"\".",
  },
  "images-of-text": {
    name: "Images of text",
    wcag: sc("1.4.5", "Images of Text", "AA"),
    kind: "manual",
    description: "Text is real text, not an image of text, except logos or where a particular look is essential.",
    steps: ["Look for images that contain text (banners, buttons, headings, quotes).", "Pass if there are none apart from logos and essential cases. Otherwise Fail, and add each one."],
    fix: "Replace images of text with styled HTML text.",
  },
  captcha: {
    name: "CAPTCHA",
    wcag: sc("1.1.1", "Non-text Content", "A"),
    kind: "manual",
    description: "A CAPTCHA has a text alternative saying what it is for, and another form (audio, a logic question) is offered.",
    steps: ["Find any CAPTCHA on the page.", "Check its purpose is described in text and an alternative in another sense is available.", "Pass if so, or there is none. Otherwise Fail."],
    fix: "Offer an audio or non-visual alternative, or use a CAPTCHA-free method.",
  },
  "css-images": {
    name: "Meaningful background images",
    wcag: sc("1.1.1", "Non-text Content", "A"),
    kind: "manual",
    description: "Images added with CSS (backgrounds, icon fonts) that carry meaning have a text alternative.",
    steps: ["Look for icons and pictures that convey information but are not <img> elements (CSS backgrounds, icon fonts).", "Check each meaningful one has text available to assistive technology (visible text, aria-label, or hidden text).", "Pass if so. Otherwise Fail, and add each one."],
    fix: "Add visually hidden text or an aria-label for meaningful CSS images and icon fonts.",
  },

  // ---- Language ---------------------------------------------------------------------------
  "page-language": {
    name: "Page language",
    wcag: sc("3.1.1", "Language of Page", "A"),
    kind: "manual",
    description: "The page's main language is set in code and correct.",
    steps: ["Check the <html> element has a lang attribute (DevTools > Elements).", "Check its value matches the page's main language (en, fr, de …).", "Pass if so. Otherwise Fail."],
    fix: "Set <html lang=\"…\"> to the page's main language.",
  },
  "language-of-parts": {
    name: "Language of parts",
    wcag: sc("3.1.2", "Language of Parts", "AA"),
    kind: "manual",
    description: "Passages in another language (quotes, a language switcher's names) are marked with their language.",
    steps: ["Look for words or passages in a language other than the page's (language menus, quotes, product names are exempt).", "Check each has a lang attribute with its language.", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Add lang=\"…\" to elements in another language (for example the language names in a switcher).",
  },

  // ---- Sensory ----------------------------------------------------------------------------
  "use-of-color": {
    name: "Use of colour",
    wcag: sc("1.4.1", "Use of Color", "A"),
    kind: "manual",
    description: "Colour is never the only way to convey information (links in text, required fields, errors, chart series, statuses).",
    steps: [
      "Look for information shown by colour: links inside text, errors, required fields, statuses, charts.",
      "Check each also has another cue: an underline, text, an icon, a pattern. The panel's colour-blindness simulation helps.",
      "Pass if so. Otherwise Fail, and add each place where colour alone is used.",
    ],
    fix: "Underline links in text and add text or icons to colour-coded states.",
  },
  "sensory-characteristics": {
    name: "Sensory characteristics",
    wcag: sc("1.3.3", "Sensory Characteristics", "A"),
    kind: "manual",
    description: "Instructions do not rely only on shape, size, position, colour or sound (\"click the round button on the right\").",
    steps: ["Read the page's instructions.", "Check none refers only to shape, size, position, colour or sound.", "Pass if so. Otherwise Fail, and add each instruction."],
    fix: "Name the control in the instruction (\"select Continue below\").",
  },
  "audio-control": {
    name: "Audio control",
    wcag: sc("1.4.2", "Audio Control", "A"),
    kind: "manual",
    description: "Audio that plays automatically for more than 3 seconds can be paused, stopped or its volume set separately.",
    steps: ["Load the page with sound on.", "If audio starts by itself for more than 3 seconds, check it can be paused or muted from the page.", "Pass if so, or nothing plays. Otherwise Fail."],
    fix: "Do not autoplay audio, or provide a pause / mute control at the start of the page.",
  },

  // ---- Adaptable content ------------------------------------------------------------------
  reflow: {
    name: "Reflow",
    wcag: sc("1.4.10", "Reflow", "AA"),
    kind: "manual",
    description: "At 400% zoom (a 320 px wide window) the content can be read and used without scrolling in two directions.",
    steps: [
      "Set the browser window to about 1280 px wide and zoom to 400% (Ctrl and +), or narrow the window to 320 px.",
      "Scroll down the page: nothing should need scrolling sideways (except maps, tables and the like), and nothing should be cut off or overlap.",
      "Use the main features (menus, forms, dialogs) at this size.",
      "Pass if everything can be read and used. Otherwise Fail, and add each place that breaks.",
    ],
    fix: "Use responsive layouts (flexible widths, wrapping, media queries) so content fits one column at 320 px.",
  },
  "resize-text": {
    name: "Resize text",
    wcag: sc("1.4.4", "Resize Text", "AA"),
    kind: "manual",
    description: "Text can be zoomed to 200% without content or functions being lost.",
    steps: ["Zoom the browser to 200% (Ctrl and +).", "Check all text grows, nothing is cut off or overlaps, and everything still works.", "Pass if so. Otherwise Fail, and add each problem."],
    fix: "Size text and containers in relative units (rem, %), and avoid fixed heights on text boxes.",
  },
  "text-spacing": {
    name: "Text spacing",
    wcag: sc("1.4.12", "Text Spacing", "AA"),
    kind: "manual",
    description: "Increasing line, paragraph, letter and word spacing does not cut off or overlap content.",
    steps: [
      "Apply larger text spacing (a text-spacing bookmarklet or user style: line-height 1.5, paragraph spacing 2em, letter-spacing 0.12em, word-spacing 0.16em).",
      "Check no text is cut off, hidden or overlapping.",
      "Pass if so. Otherwise Fail. (PalTech's automated ZM-03 check finds many of these.)",
    ],
    fix: "Avoid fixed heights and overflow: hidden on text containers.",
  },
  orientation: {
    name: "Orientation",
    wcag: sc("1.3.4", "Orientation", "AA"),
    kind: "manual",
    description: "The page works in both portrait and landscape, unless one orientation is essential.",
    steps: ["Open the page on a phone or tablet, or in DevTools device mode, and rotate it.", "Check the content works in both orientations and is not locked to one.", "Pass if so. Otherwise Fail."],
    fix: "Remove orientation locks and design for both orientations.",
  },

  // ---- Audio / video ----------------------------------------------------------------------
  "audio-only": {
    name: "Audio-only content",
    wcag: sc("1.2.1", "Audio-only and Video-only (Prerecorded)", "A"),
    kind: "manual",
    description: "Prerecorded audio (podcasts, recordings) has a text transcript.",
    steps: ["Find prerecorded audio on the page.", "Check each has a transcript with the same information.", "Pass if so, or there is none. Otherwise Fail."],
    fix: "Publish a transcript next to the audio player.",
  },
  "video-only": {
    name: "Video-only content",
    wcag: sc("1.2.1", "Audio-only and Video-only (Prerecorded)", "A"),
    kind: "manual",
    description: "Prerecorded video without sound has a text description or an audio track that conveys the same information.",
    steps: ["Find silent prerecorded videos (animations, demos).", "Check each has a text description or an audio track describing it.", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Add a text description of what the video shows.",
  },

  // ---- Multimedia -------------------------------------------------------------------------
  "captions-prerecorded": {
    name: "Captions",
    wcag: sc("1.2.2", "Captions (Prerecorded)", "A"),
    kind: "manual",
    description: "Prerecorded video with sound has accurate, synchronised captions.",
    steps: ["Play each video with sound.", "Turn captions on and check they cover the speech and important sounds, in time.", "Pass if so, or there are no videos with sound. Otherwise Fail."],
    fix: "Add a caption track (WebVTT) checked for accuracy.",
  },
  "audio-description-alternative": {
    name: "Audio description or alternative",
    wcag: sc("1.2.3", "Audio Description or Media Alternative (Prerecorded)", "A"),
    kind: "manual",
    description: "Visual information in prerecorded video that the soundtrack does not explain is available as audio description or a full text alternative.",
    steps: ["Watch each video and note what is shown but not said.", "Check that information is in an audio description or a text alternative.", "Pass if so, or there are no such videos. Otherwise Fail."],
    fix: "Provide an audio-described version or a descriptive transcript.",
  },
  "audio-description": {
    name: "Audio description",
    wcag: sc("1.2.5", "Audio Description (Prerecorded)", "AA"),
    kind: "manual",
    description: "Prerecorded video has audio description of visual information the soundtrack does not explain.",
    steps: ["Watch each video for information shown but not spoken.", "Check an audio-described version or track is available.", "Pass if so, or nothing visual goes unspoken. Otherwise Fail."],
    fix: "Add an audio description track or a described version of the video.",
  },
  "media-player": {
    name: "Media player controls",
    wcag: sc("2.1.1", "Keyboard", "A"),
    kind: "manual",
    description: "Media players can be operated with the keyboard and their controls have names.",
    steps: ["Tab to each audio or video player.", "Check play, pause, volume, captions and full screen work with the keyboard and are announced with names.", "Pass if so, or there are no players. Otherwise Fail."],
    fix: "Use the native controls attribute or an accessible player.",
  },

  // ---- Live multimedia --------------------------------------------------------------------
  "live-captions": {
    name: "Live captions",
    wcag: sc("1.2.4", "Captions (Live)", "AA"),
    kind: "manual",
    description: "Live audio in synchronised media (streams, webinars) has live captions.",
    steps: ["Find live streams or broadcasts on the page.", "Check live captions are offered.", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Use real-time captioning (CART or a captioning service) for live streams.",
  },

  // ---- Sequence ---------------------------------------------------------------------------
  "reading-order": {
    name: "Reading order",
    wcag: sc("1.3.2", "Meaningful Sequence", "A"),
    kind: "manual",
    description: "The order in the code (what a screen reader reads) matches the order that makes sense visually.",
    steps: ["Turn off CSS (or use the reading-order view of a screen reader) and read the page.", "Check the content reads in a meaningful order: columns, cards and labels next to their fields.", "Pass if so. Otherwise Fail, and add each place where the order changes the meaning."],
    fix: "Order the DOM as the content should be read; do not reorder with CSS order or absolute positioning.",
  },
  "layout-tables": {
    name: "Layout tables",
    wcag: sc("1.3.2", "Meaningful Sequence", "A"),
    kind: "manual",
    description: "Tables used for layout read in a meaningful order and are not marked up as data tables.",
    steps: ["Look for tables used only to position content.", "Check they read in order row by row and carry role=\"presentation\" (no th, caption or summary).", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Replace layout tables with CSS layout, or add role=\"presentation\".",
  },

  // ---- Semantics --------------------------------------------------------------------------
  lists: {
    name: "Lists",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "manual",
    description: "Content that looks like a list is coded as a list (ul, ol, dl).",
    steps: ["Look for content shown as a list: bullets, numbers, sets of links, steps.", "Check each is a <ul>, <ol> or <dl> (or role=\"list\").", "Pass if so. Otherwise Fail, and add each one."],
    fix: "Mark up lists with <ul>/<ol>/<li>.",
  },
  "data-tables": {
    name: "Data tables",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "manual",
    description: "Tables of data are coded as tables with header cells for their rows or columns.",
    steps: ["Find tables of data (and grids that look like tables).", "Check each is a <table> (or role=\"table\"/\"grid\") and its headers are <th> with scope where needed.", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Use <table>, <th scope=\"col\">/<th scope=\"row\">, and a <caption>.",
  },
  "table-headers": {
    name: "Table header associations",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "manual",
    description: "In complex data tables, each data cell is associated with all its headers.",
    steps: ["Find tables with more than one level of headers or merged cells.", "Check each cell's headers are associated (headers/id, or scope on every header).", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Use headers=\"…\" on cells and id on header cells, or simplify the table.",
  },
  emphasis: {
    name: "Emphasis and quotes",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "manual",
    description: "Text whose formatting carries meaning (emphasis, quotes, code, deletions) uses the matching element, not only styling.",
    steps: ["Look for text whose style carries meaning: important warnings, quotations, struck-through prices.", "Check each uses strong/em, blockquote/q, del/ins or similar, or the meaning is also in words.", "Pass if so. Otherwise Fail."],
    fix: "Use semantic elements, or add the meaning in text (\"Was £20, now £15\").",
  },
  "hidden-interactive": {
    name: "Hidden content",
    wcag: sc("4.1.2", "Name, Role, Value", "A"),
    kind: "manual",
    description: "Content hidden from view is also hidden from assistive technology, and focusable elements are never hidden from it (aria-hidden on a focusable element).",
    steps: ["Tab through the page: focus should never land on something invisible.", "In the accessibility tree, check closed menus, dialogs and off-screen slides are hidden, and nothing focusable is inside aria-hidden.", "Pass if so. Otherwise Fail."],
    fix: "Hide closed content with display: none, hidden or inert; never put focusable elements inside aria-hidden.",
  },
  "label-relationships": {
    name: "Labels tied to fields",
    wcag: sc("1.3.1", "Info and Relationships", "A"),
    kind: "assisted",
    description: "Each form field is programmatically tied to its visible label (label for=, wrapping label, or aria-labelledby).",
    steps: ["For each field below, check its name matches the label you see next to it (the Name column shows the programmatic name).", "Mark each field Pass or Fail."],
    helper: "instances",
    helperNote: "The form fields are outlined on the page.",
    instances: "fields",
    detailLabel: "Field",
    fix: "Use <label for=\"id\"> or wrap the field in its <label>.",
  },

  // ---- Pointer / motion -------------------------------------------------------------------
  "pointer-gestures": {
    name: "Pointer gestures",
    wcag: sc("2.5.1", "Pointer Gestures", "A"),
    kind: "manual",
    description: "Anything done with a multi-point or path gesture (pinch, swipe, drawing a path) can also be done with a single tap or click.",
    steps: ["Find functions that use gestures: swiping carousels, pinch-zoom maps, sliders that need a path.", "Check each can also be done with single taps or clicks (buttons, + and −).", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Add buttons (next / previous, zoom in / out) for gesture-only functions.",
  },
  "pointer-cancellation": {
    name: "Pointer cancellation",
    wcag: sc("2.5.2", "Pointer Cancellation", "A"),
    kind: "manual",
    description: "Actions happen on release (click), not on press, so a mistaken press can be cancelled by moving away.",
    steps: ["Press (do not release) on buttons and links, then move the pointer away and release.", "Check nothing happens.", "Pass if actions run only on release (or can be undone). Otherwise Fail, and add each control."],
    fix: "Use click events, not mousedown or touchstart, for actions.",
  },
  "motion-actuation": {
    name: "Motion actuation",
    wcag: sc("2.5.4", "Motion Actuation", "A"),
    kind: "manual",
    description: "Functions triggered by moving the device (shake to undo, tilt) also have a normal control, and motion can be turned off.",
    steps: ["Find out whether the page reacts to device motion.", "Check each such function has a button too, and motion response can be disabled.", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Provide an on-screen control and a setting to disable motion input.",
  },
  dragging: {
    name: "Dragging movements",
    wcag: sc("2.5.7", "Dragging Movements", "AA"),
    kind: "manual",
    description: "Anything done by dragging (sliders, reordering lists, drag and drop) can also be done with single taps or clicks.",
    steps: ["Find functions that use dragging.", "Check each has a single-pointer alternative (click to move, up/down buttons, a text field).", "Pass if so, or there are none. Otherwise Fail."],
    fix: "Add move up / down buttons or click-to-place for draggable items.",
  },
  "target-size": {
    name: "Target size",
    wcag: sc("2.5.8", "Target Size (Minimum)", "AA"),
    kind: "assisted",
    description: "Pointer targets are at least 24 by 24 CSS pixels, or have enough space around them (inline links in text are exempt).",
    steps: ["For each control below, check it is at least 24×24 px, or a 24 px circle centred on it does not overlap another target.", "Mark each control Pass or Fail. (PalTech's automated TGT-01 measures this.)"],
    helper: "instances",
    helperNote: "The controls are outlined on the page.",
    instances: "controls",
    detailLabel: "Type",
    fix: "Enlarge small targets (padding) or space them apart.",
  },

  // ---- Contrast ---------------------------------------------------------------------------
  "text-contrast": {
    name: "Text contrast",
    wcag: sc("1.4.3", "Contrast (Minimum)", "AA"),
    kind: "manual",
    description: "Text has at least 4.5:1 contrast with its background (3:1 for large text: 24 px, or 18.66 px bold).",
    steps: [
      "Look for text that may be faint: placeholders, disabled-looking text, text over images or gradients, text in hover and focus states.",
      "Measure doubtful cases with the Contrast checker in the side panel (eyedropper on the page).",
      "Pass if all text meets the ratio. Otherwise Fail, and add each one. (PalTech's automated CLR-01 / CLR-02 find most.)",
    ],
    fix: "Darken the text or lighten the background until the ratio is met.",
  },
  "ui-component-contrast": {
    name: "UI component contrast",
    wcag: sc("1.4.11", "Non-text Contrast", "AA"),
    kind: "assisted",
    description: "The boundaries and states of controls (borders, checkbox outlines, focus rings) have at least 3:1 contrast against what is next to them.",
    steps: [
      "For each control below, find the part that shows it is a control: its border, its outline, its icon.",
      "Check that part has at least 3:1 contrast against the colour next to it. The Contrast checker in the side panel measures it, with an eyedropper.",
      "Check its states too: hover, focus, selected, checked.",
      "Mark each control Pass or Fail.",
    ],
    helper: "instances",
    helperNote: "The controls are outlined on the page.",
    instances: "controls",
    detailLabel: "Type",
    fix: "Darken the control's border or icon (or lighten the background) to at least 3:1; do the same for its states.",
  },
  "graphics-contrast": {
    name: "Graphics contrast",
    wcag: sc("1.4.11", "Non-text Contrast", "AA"),
    kind: "manual",
    description: "Parts of graphics needed to understand them (chart lines and bars, icons without text, infographic elements) have at least 3:1 contrast.",
    steps: ["Find charts, diagrams and meaningful icons.", "Measure the parts needed to understand them with the Contrast checker.", "Pass if each is at least 3:1 against its neighbours, or there are none. Otherwise Fail."],
    fix: "Darken chart colours and icons, or add outlines and patterns.",
  },

  // ---- Cognitive --------------------------------------------------------------------------
  "redundant-entry": {
    name: "Redundant entry",
    wcag: sc("3.3.7", "Redundant Entry", "A"),
    kind: "manual",
    description: "Information already entered in the same process is filled in again or offered for selection, rather than asked for again.",
    steps: ["Go through multi-step processes (checkout, sign-up, applications).", "Check information you already gave (addresses, names) is not asked for again without being offered.", "Pass if so, or there are no such processes. Otherwise Fail."],
    fix: "Pre-fill repeated fields or offer \"Same as delivery address\".",
  },
  "accessible-authentication": {
    name: "Accessible sign-in",
    wcag: sc("3.3.8", "Accessible Authentication (Minimum)", "AA"),
    kind: "manual",
    description: "Signing in does not require remembering, transcribing or solving something (a puzzle), unless there is an alternative or help (password managers and paste allowed).",
    steps: ["Go through the sign-in or verification steps.", "Check password fields allow paste and password managers, and there is no cognitive test without an alternative.", "Pass if so, or there is no sign-in. Otherwise Fail."],
    fix: "Allow paste and autocomplete in sign-in fields; offer email links or passkeys instead of puzzles.",
  },
};

function build(test: string, ids: string[]): Requirement[] {
  return ids.map((id) => {
    const def = R[id];
    if (!def) throw new Error(`Unknown requirement "${id}"`);
    return { id, test, ...def };
  });
}

export const FULL_TESTS: AssessmentTest[] = [
  { id: "keyboard", name: "Keyboard", description: "Every interactive control must be reachable and usable with the keyboard, without traps, timing or surprises.", requirements: build("Keyboard", ["keyboard-navigation", "no-keyboard-traps", "on-focus", "on-input", "no-keystroke-timing", "character-key-shortcuts"]) },
  { id: "focus", name: "Focus", description: "Keyboard users must always see where focus is, and it must move in a sensible order, into dialogs and revealed content and back.", requirements: build("Focus", ["focus-indicator", "focus-order", "focus-not-obscured", "modal-dialogs", "revealing-content", "hover-focus-content"]) },
  { id: "landmarks", name: "Landmarks", description: "Landmarks let screen-reader users jump between the main regions of the page.", requirements: build("Landmarks", ["main-landmark", "content-in-landmarks", "landmark-roles"]) },
  { id: "headings", name: "Headings", description: "Headings let people scan the page and jump to the section they need.", requirements: build("Headings", ["missing-headings", "heading-level", "descriptive-headings"]) },
  { id: "repetitive-content", name: "Repetitive content", description: "Repeated blocks can be skipped, and navigation, names and help stay the same across pages.", requirements: build("Repetitive content", ["bypass-blocks", "consistent-navigation", "consistent-identification", "consistent-help"]) },
  { id: "links", name: "Links", description: "Links must say where they go, behave as links, and be named as they look.", requirements: build("Links", ["link-purpose", "link-function", "link-label-in-name"]) },
  { id: "native-widgets", name: "Native widgets", description: "Form fields and buttons need clear labels, instructions, grouping and the right names.", requirements: build("Native widgets", ["instructions", "descriptive-labels", "input-purpose", "grouped-controls", "native-name-role-value"]) },
  { id: "custom-widgets", name: "Custom widgets", description: "Widgets built from scratch must expose the right role, name, state and keyboard behaviour.", requirements: build("Custom widgets", ["custom-role", "custom-name", "custom-state", "custom-keyboard", "custom-instructions", "custom-label-in-name"]) },
  { id: "timed-events", name: "Timed events", description: "People must have enough time, and moving, updating or flashing content must not get in the way or cause harm.", requirements: build("Timed events", ["timing-adjustable", "pause-moving-content", "auto-updating", "flashing"]) },
  { id: "errors-status", name: "Errors / status", description: "Errors must be identified and explained, important submissions checked, and status messages announced.", requirements: build("Errors / status", ["error-identification", "error-suggestion", "error-prevention", "status-messages"]) },
  { id: "page-navigation", name: "Page navigation", description: "Pages and frames need descriptive titles, and pages more than one way to be found.", requirements: build("Page navigation", ["page-title", "multiple-ways", "frame-titles"]) },
  { id: "images", name: "Images", description: "Images need text alternatives that match their purpose; text should be real text.", requirements: build("Images", ["image-function", "images-of-text", "captcha", "css-images"]) },
  { id: "language", name: "Language", description: "The page's language, and any passage in another language, must be set so it is pronounced correctly.", requirements: build("Language", ["page-language", "language-of-parts"]) },
  { id: "sensory", name: "Sensory", description: "Information must not depend on colour, shape, position or sound alone, and audio must not play uncontrolled.", requirements: build("Sensory", ["use-of-color", "sensory-characteristics", "audio-control"]) },
  { id: "adaptable-content", name: "Adaptable content", description: "Content must survive zoom, narrow screens, larger text spacing and either orientation.", requirements: build("Adaptable content", ["reflow", "resize-text", "text-spacing", "orientation"]) },
  { id: "audio-video", name: "Audio / video", description: "Prerecorded audio-only and video-only content needs a text alternative.", requirements: build("Audio / video", ["audio-only", "video-only"]) },
  { id: "multimedia", name: "Multimedia", description: "Prerecorded video with sound needs captions, audio description and an accessible player.", requirements: build("Multimedia", ["captions-prerecorded", "audio-description-alternative", "audio-description", "media-player"]) },
  { id: "live-multimedia", name: "Live multimedia", description: "Live audio and video need live captions.", requirements: build("Live multimedia", ["live-captions"]) },
  { id: "sequence", name: "Sequence", description: "The reading order in the code must match the meaningful visual order.", requirements: build("Sequence", ["reading-order", "layout-tables"]) },
  { id: "semantics", name: "Semantics", description: "Structure shown visually (lists, tables, emphasis, labels) must be in the code too, and hidden content really hidden.", requirements: build("Semantics", ["lists", "data-tables", "table-headers", "emphasis", "hidden-interactive", "label-relationships"]) },
  { id: "pointer-motion", name: "Pointer / motion", description: "Everything must work with simple pointer actions of a usable size, without gestures, dragging or device motion.", requirements: build("Pointer / motion", ["pointer-gestures", "pointer-cancellation", "motion-actuation", "dragging", "target-size"]) },
  { id: "contrast", name: "Contrast", description: "Text, controls and meaningful graphics need enough contrast to be seen.", requirements: build("Contrast", ["text-contrast", "ui-component-contrast", "graphics-contrast"]) },
  { id: "cognitive", name: "Cognitive", description: "Processes must not make people re-enter information or solve puzzles to sign in.", requirements: build("Cognitive", ["redundant-entry", "accessible-authentication"]) },
];

export const FULL_REQUIREMENTS: Requirement[] = FULL_TESTS.flatMap((t) => t.requirements);

/** Quick Assess: 10 key requirements, the same objects (and ids) as in the Full Assessment. */
const QUICK_IDS = ["keyboard-navigation", "link-purpose", "image-function", "focus-order", "ui-component-contrast", "missing-headings", "heading-level", "bypass-blocks", "instructions", "reflow"];
export const QUICK_REQUIREMENTS: Requirement[] = QUICK_IDS.map((id) => FULL_REQUIREMENTS.find((r) => r.id === id)!);

/** The test a Full Assessment requirement belongs to, and its number ("1.3"). */
export function locate(id: string): { test: AssessmentTest; testIndex: number; reqIndex: number; number: string } | undefined {
  for (let t = 0; t < FULL_TESTS.length; t++) {
    const r = FULL_TESTS[t].requirements.findIndex((x) => x.id === id);
    if (r >= 0) return { test: FULL_TESTS[t], testIndex: t, reqIndex: r, number: `${t + 1}.${r + 1}` };
  }
  return undefined;
}
