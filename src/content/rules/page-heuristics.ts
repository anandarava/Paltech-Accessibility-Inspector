/**
 * Page heuristics for barriers axe-core does not look for (all Semi: they
 * guess intent from presentation, so a person confirms them).
 *
 * Emits:
 *  - STR-12  text styled as a heading but marked up as <p>/<div> (bold or
 *            large, short, no sentence punctuation), reported only when the
 *            page has no h2–h6 at all: then the visual headings are the only
 *            structure and screen reader users get none of it (2.4.6/1.3.1).
 *  - STR-07  a data table with no header cells: a <table> of at least 2x2
 *            cells, with no <th>, no role on the table, a border or numeric
 *            cells, so it is a grid of data rather than layout (1.3.1).
 *  - FRM-12  a <select> whose change handler navigates or submits, with no
 *            button in its form: choosing an option changes the page as soon
 *            as it changes (3.2.2 On Input).
 *  - OTH-02  a carousel or slider that moves by itself (watched for 2.5 s)
 *            with no pause, stop or play control (2.2.2 Pause, Stop, Hide).
 *            Top frame only; the scan takes 2.5 s longer when the page has a
 *            carousel-like element.
 *
 * Heuristics and their risks
 * --------------------------
 *  - Fake headings: a big bold intro sentence can look like a heading; the
 *    "no h2–h6 on the page" condition keeps this to pages without structure.
 *  - Data tables: layout tables with numbers in them are possible; tables
 *    with role="presentation"/"none" are skipped.
 *  - Change handlers added with addEventListener are invisible; only inline
 *    `onchange` attributes are read.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { isExtensionElement } from "./contrast";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const HEADING = ruleDef("STR-12");
const TABLE = ruleDef("STR-07");
const ON_INPUT = ruleDef("FRM-12");
const MOVING = ruleDef("OTH-02");

const CAROUSEL_SELECTOR =
  "[aria-roledescription='carousel' i], [class*='carousel' i], [class*='slider' i], [class*='slideshow' i], [class*='swiper' i], [class*='slick' i], [class*='marquee' i], [class*='ticker' i]";
const WATCH_MS = 2500;
const WATCH_STEP_MS = 250;
const MAX_CAROUSELS = 20;
const PAUSE_RE = /pause|stop|play|anhalten|pausa/i;

const MAX_FAKE_HEADINGS = 10;
const HEADING_TEXT_MAX = 80;

function text(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Median font size of paragraphs on the page (16 when there are none). */
function bodyFontSize(doc: Document, view: Window): number {
  const sizes = Array.from(doc.querySelectorAll("p"))
    .slice(0, 200)
    .filter((p) => text(p).length > HEADING_TEXT_MAX)
    .map((p) => parseFloat(view.getComputedStyle(p).fontSize))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return sizes.length ? (sizes[Math.floor(sizes.length / 2)] as number) : 16;
}

function fakeHeadings(ctx: RuleContext, doc: Document, view: Window): RuleFinding[] {
  if (doc.querySelector("h2, h3, h4, h5, h6, [role='heading']:not(h1)")) return [];
  const base = bodyFontSize(doc, view);
  const out: RuleFinding[] = [];
  for (const el of Array.from(ctx.root.querySelectorAll("p, div"))) {
    if (out.length >= MAX_FAKE_HEADINGS) break;
    if (isExtensionElement(el, ctx) || !ctx.isVisible(el)) continue;
    if (el.localName === "div" && el.querySelector("p, div, table, ul, ol")) continue; // a container, not a line of text
    if (el.closest("a, button, label, h1, h2, h3, h4, h5, h6, [role='heading'], nav, footer, header, li, td, th")) continue;
    const t = text(el);
    if (t.length < 3 || t.length > HEADING_TEXT_MAX || /[.,;:!?]$/.test(t)) continue;
    // The whole text in one style: the element itself, or a chain of single wrappers
    // (<font><b>…</b></font>) holding all of it; the innermost one carries the style.
    let styled: Element = el;
    while (styled.children.length === 1 && text(styled.children[0] as Element) === t) styled = styled.children[0] as Element;
    const only = styled !== el ? styled : null;
    const cs = view.getComputedStyle(styled);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 600 || /bold/.test(cs.fontWeight);
    if (!(size >= base * 1.3 || (bold && size >= base * 1.1) || (bold && only !== null && /^(b|strong|font)$/.test(only.localName)))) continue;
    out.push({
      element: el,
      type: "Semi",
      severity: HEADING.severity ?? "Moderate",
      description: `"${t}" looks like a heading (${Math.round(size)}px${bold ? ", bold" : ""}) but is a <${el.localName}>, and the page has no h2–h6 headings. Screen reader users who move by heading cannot find this section.`,
      data: { ruleId: HEADING.id, text: t, fontSize: Math.round(size), bold, heuristic: "styled-as-heading" },
      fix: { summary: "Mark section titles up as headings (<h2>, <h3> …) in the order of the page's structure, and style the headings instead.", docsUrl: "https://www.w3.org/WAI/tutorials/page-structure/headings/" },
    });
  }
  return out;
}

function headerlessTables(ctx: RuleContext, view: Window): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const table of Array.from(ctx.root.querySelectorAll("table"))) {
    if (isExtensionElement(table, ctx) || !ctx.isVisible(table)) continue;
    if (table.getAttribute("role") || table.querySelector("th, table")) continue;
    const rows = Array.from(table.rows);
    if (rows.length < 2) continue;
    const cols = Math.max(...rows.map((r) => r.cells.length));
    if (cols < 2) continue;
    const cells = rows.flatMap((r) => Array.from(r.cells));
    const numeric = cells.filter((c) => /^[\d.,%$€£\s-]+$/.test(text(c)) && /\d/.test(text(c))).length;
    const bordered = (table.getAttribute("border") ?? "0") !== "0" || parseFloat(view.getComputedStyle(cells[0] as Element).borderTopWidth) > 0;
    if (numeric < 2 && !(bordered && cells.every((c) => text(c).length < 60))) continue;
    out.push({
      element: table,
      type: "Semi",
      severity: TABLE.severity ?? "Serious",
      description: `This table of ${rows.length} rows and ${cols} columns looks like data${numeric >= 2 ? ` (${numeric} numeric cells)` : ""} but has no header cells, so screen reader users do not hear which row and column each value belongs to.`,
      data: { ruleId: TABLE.id, rows: rows.length, columns: cols, numericCells: numeric, heuristic: "no-th" },
      fix: { summary: 'Mark the header row and/or column with <th scope="col"> / <th scope="row">, and add a <caption>. If the table is only for layout, give it role="presentation".', docsUrl: "https://www.w3.org/WAI/tutorials/tables/" },
    });
  }
  return out;
}

function navigatingSelects(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const select of Array.from(ctx.root.querySelectorAll("select[onchange]"))) {
    if (isExtensionElement(select, ctx) || !ctx.isVisible(select)) continue;
    const handler = select.getAttribute("onchange") ?? "";
    if (!/location|href|submit\s*\(|window\.open|navigate/i.test(handler)) continue;
    const form = (select as HTMLSelectElement).form;
    if (form?.querySelector("button, input[type='submit'], input[type='button'], input[type='image']")) continue;
    out.push({
      element: select,
      type: "Semi",
      severity: ON_INPUT.severity ?? "Serious",
      description: "Choosing an option in this drop-down changes the page at once (its onchange handler navigates or submits) and there is no button to confirm. Keyboard users who arrow through the options are taken away on the first change.",
      data: { ruleId: ON_INPUT.id, onchange: handler.slice(0, 120) },
      fix: { summary: "Add a Go/Submit button and act only when it is pressed, or tell users beforehand that choosing an option opens a new page.", docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/on-input.html" },
    });
  }
  return out;
}

/** What a moving carousel changes: transforms, scroll positions, which slide is current or shown. */
function carouselState(el: Element, view: Window): string {
  const parts: string[] = [view.getComputedStyle(el).transform, String(el.scrollLeft), String(el.scrollTop)];
  for (const child of Array.from(el.querySelectorAll("*")).slice(0, 60)) {
    const cs = view.getComputedStyle(child);
    parts.push(cs.transform, cs.opacity, cs.left, String(child.scrollLeft), child.className && typeof child.className === "string" ? child.className : "", child.getAttribute("aria-hidden") ?? "");
  }
  return parts.join("|");
}

/** A pause / stop / play control in the carousel or in a small wrapper around it. */
function hasPauseControl(el: Element): boolean {
  const parent = el.parentElement;
  const scope = parent && parent.getElementsByTagName("*").length <= el.getElementsByTagName("*").length + 30 ? parent : el;
  for (const c of Array.from(scope.querySelectorAll("button, [role='button'], a, input[type='checkbox']"))) {
    const label = `${c.textContent ?? ""} ${c.getAttribute("aria-label") ?? ""} ${c.getAttribute("title") ?? ""} ${typeof c.className === "string" ? c.className : ""}`;
    if (PAUSE_RE.test(label)) return true;
  }
  return false;
}

async function movingCarousels(ctx: RuleContext, view: Window): Promise<RuleFinding[]> {
  if (view !== view.top) return [];
  const candidates: Element[] = [];
  for (const el of Array.from(ctx.root.querySelectorAll(CAROUSEL_SELECTOR))) {
    if (candidates.length >= MAX_CAROUSELS) break;
    if (isExtensionElement(el, ctx) || !ctx.isVisible(el) || candidates.some((c) => c.contains(el))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 30 || el.children.length === 0) continue;
    candidates.push(el);
  }
  if (candidates.length === 0) return [];
  const before = candidates.map((c) => carouselState(c, view));
  // Compare every half second, not only at the end: a two-slide carousel can be back on
  // its first slide when the watch ends.
  const moved = candidates.map(() => false);
  for (let waited = 0; waited < WATCH_MS; waited += WATCH_STEP_MS) {
    await new Promise((resolve) => setTimeout(resolve, WATCH_STEP_MS));
    candidates.forEach((c, i) => {
      if (!moved[i] && c.isConnected && carouselState(c, view) !== before[i]) moved[i] = true;
    });
  }
  const out: RuleFinding[] = [];
  candidates.forEach((c, i) => {
    if (!moved[i] || hasPauseControl(c)) return;
    out.push({
      element: c,
      type: "Semi",
      severity: MOVING.severity ?? "Serious",
      description: "This carousel or slider changed by itself while the page was watched for 2.5 seconds, and no pause, stop or play control was found next to it. Moving content that starts on its own and lasts more than 5 seconds needs a way to pause it.",
      data: { ruleId: MOVING.id, watchedMs: WATCH_MS, heuristic: "auto-moving" },
      fix: { summary: "Add a visible pause/play button (and stop on hover and keyboard focus), or do not advance the slides automatically.", docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html" },
    });
  });
  return out;
}

export const rule: CustomRule = {
  id: HEADING.id,
  emits: [TABLE.id, ON_INPUT.id, MOVING.id],
  title: "Headings, data tables and change-on-input heuristics",
  category: HEADING.category,
  wcag: HEADING.wcag,
  type: "Semi",
  severity: HEADING.severity ?? "Moderate",
  defaultFix: { summary: "Mark headings and table headers up as such, and do not change the page when a form value changes.", docsUrl: "https://www.w3.org/WAI/tutorials/" },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
    const view = doc.defaultView ?? window;
    const findings: RuleFinding[] = [];
    for (const part of [() => fakeHeadings(ctx, doc, view), () => headerlessTables(ctx, view), () => navigatingSelects(ctx), () => movingCarousels(ctx, view)]) {
      try {
        findings.push(...(await part()));
      } catch {
        // one heuristic failing must not stop the others
      }
      await ctx.yieldToMain();
    }
    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
