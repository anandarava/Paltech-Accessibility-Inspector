/**
 * TGT-01: pointer target smaller than 24x24 CSS px without sufficient
 * spacing (WCAG 2.5.8 Target Size (Minimum), AA).
 *
 * Only interactive targets are considered: `a[href]`, `button`, `input`
 * (not hidden), and elements with role button / link / checkbox / radio /
 * tab / menuitem / switch. The threshold is `thresholds.minSize` (default 24).
 *
 * Exceptions implemented from the success criterion:
 *  - Spacing: the target passes when a circle of diameter `minSize` centred
 *    on it does not intersect (a) the bounding box of any other target, nor
 *    (b) the `minSize` circle centred on any other undersized target (centre
 *    distance >= minSize).
 *  - Inline: a target whose computed display is inline and that sits in a
 *    sentence (its parent has non-whitespace text nodes besides the link)
 *    is exempt, since its size is constrained by the line height.
 *  - User agent control: native-appearance checkbox/radio inputs are drawn
 *    by the browser at their default size and are exempt.
 *  - The "essential" and "equivalent target elsewhere" exceptions cannot be
 *    detected and may cause false positives (icon buttons that duplicate a
 *    larger control, map pins, etc.).
 *
 * Other risks: nested targets (a button inside a link) count the outer
 * element only; targets with several line boxes use the largest box; the
 * measured box is the border box, so generous padding counts, but a larger
 * invisible hit area created with ::before/::after does not.
 */
import rulesJson from "@shared/a11y-rules.json";
import type { RuleDefinition, RulesFile } from "@shared/types";
import { isExtensionElement } from "./contrast";
import { queryAllIncludingRoot } from "@src/content/dom-utils";
import type { CustomRule, RuleContext, RuleFinding } from "./types";

const RULES: RuleDefinition[] = (rulesJson as unknown as RulesFile).rules;

function ruleDef(id: string): RuleDefinition {
  const d = RULES.find((r) => r.id === id);
  if (!d) throw new Error(`a11y-rules.json has no rule ${id}`);
  return d;
}

const PRIMARY = ruleDef("TGT-01");
const DEFAULT_MIN_SIZE = 24;
const CHUNK = 200;
const MAX_TARGETS = 3000;

const TARGET_SELECTOR =
  "a[href], button, input:not([type='hidden']), [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='tab'], [role='menuitem'], [role='switch']";

interface Target {
  element: Element;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
  /** width or height below minSize */
  undersized: boolean;
}

/** Largest client rect (an inline link may wrap over several line boxes). */
function largestRect(el: Element): DOMRect | null {
  let best: DOMRect | null = null;
  const rects = el.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!r) continue;
    if (!best || r.width * r.height > best.width * best.height) best = r;
  }
  if (!best) {
    const r = el.getBoundingClientRect();
    best = r.width > 0 && r.height > 0 ? r : null;
  }
  return best;
}

/** Inline target that is part of a sentence: parent has other non-empty text. */
function isInlineInSentence(el: Element, cs: CSSStyleDeclaration): boolean {
  if (!cs.display.startsWith("inline") || cs.display === "inline-block" || cs.display === "inline-flex" || cs.display === "inline-grid") return false;
  const parent = el.parentElement;
  if (!parent) return false;
  for (const node of Array.from(parent.childNodes)) {
    if (node === el) continue;
    if (node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent ?? "")) return true;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as Element;
      if (!e.matches(TARGET_SELECTOR) && /\S/.test(e.textContent ?? "")) return true;
    }
  }
  return false;
}

export const rule: CustomRule = {
  id: PRIMARY.id,
  title: PRIMARY.check,
  category: PRIMARY.category,
  wcag: PRIMARY.wcag,
  type: PRIMARY.type,
  severity: PRIMARY.severity ?? "Moderate",
  defaultFix: {
    summary: "Make the target at least 24x24 CSS px (add padding or min-width/min-height), or leave enough spacing so 24px circles centred on neighbouring targets do not overlap.",
    docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html",
  },
  async run(ctx: RuleContext): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    const minSizeRaw = ctx.thresholds?.minSize;
    const minSize = Number.isFinite(minSizeRaw) && (minSizeRaw as number) > 0 ? (minSizeRaw as number) : DEFAULT_MIN_SIZE;
    const doc = ctx.root.ownerDocument ?? (ctx.root as Document);
    const view = doc.defaultView ?? window;

    let candidates: Element[] = [];
    try {
      candidates = Array.from(queryAllIncludingRoot(ctx.root, TARGET_SELECTOR)).slice(0, MAX_TARGETS);
    } catch {
      return findings;
    }

    // Pass 1: measure every target (needed for the spacing exception).
    const targets: Target[] = [];
    const small: Array<{ target: Target; cs: CSSStyleDeclaration }> = [];
    for (let i = 0; i < candidates.length; i++) {
      if (i > 0 && i % CHUNK === 0) {
        await ctx.yieldToMain();
        ctx.progress?.(Math.round((i / candidates.length) * 70));
      }
      const el = candidates[i];
      if (!el) continue;
      try {
        if (isExtensionElement(el, ctx) || !ctx.isVisible(el)) continue;
        if (el.matches(":disabled, [aria-disabled='true']")) continue;
        if (el.getAttribute("aria-hidden") === "true") continue;
        // Nested targets: the outer one is the target.
        const outer = el.parentElement?.closest(TARGET_SELECTOR);
        if (outer && outer !== el) continue;
        const rect = largestRect(el);
        if (!rect) continue;
        const undersized = rect.width + 0.5 < minSize || rect.height + 0.5 < minSize;
        const target: Target = {
          element: el,
          width: rect.width,
          height: rect.height,
          left: rect.left,
          top: rect.top,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          undersized,
        };
        targets.push(target);
        if (undersized) {
          const cs = view.getComputedStyle(el);
          // User-agent drawn checkbox/radio at default size.
          if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
            const appearance = (cs as unknown as { appearance?: string }).appearance ?? "";
            if (appearance !== "none") continue;
          }
          small.push({ target, cs });
        }
      } catch {
        // next
      }
    }

    // Pass 2: apply exceptions to the small ones.
    for (let i = 0; i < small.length; i++) {
      if (i > 0 && i % CHUNK === 0) {
        await ctx.yieldToMain();
        ctx.progress?.(70 + Math.round((i / small.length) * 30));
      }
      const entry = small[i];
      if (!entry) continue;
      const { target, cs } = entry;
      try {
        if (isInlineInSentence(target.element, cs)) continue;

        // Spacing exception: a circle of diameter minSize centred on the target must
        // not intersect (a) any other target's bounding box, nor (b) the minSize
        // circle centred on any other undersized target.
        const radius = minSize / 2;
        let nearest: Target | null = null;
        let nearestDist = Infinity;
        for (const other of targets) {
          if (other === target) continue;
          if (other.element.contains(target.element) || target.element.contains(other.element)) continue;
          // (a) distance from this centre to the nearest point of the other target's rect.
          const px = Math.min(Math.max(target.cx, other.left), other.right);
          const py = Math.min(Math.max(target.cy, other.top), other.bottom);
          const edgeDist = Math.hypot(px - target.cx, py - target.cy);
          const centreDist = Math.hypot(other.cx - target.cx, other.cy - target.cy);
          // (b) two undersized targets: their circles overlap when centres are closer than minSize.
          const intersects = edgeDist < radius || (other.undersized && centreDist < minSize);
          if (intersects && centreDist < nearestDist) {
            nearestDist = centreDist;
            nearest = other;
          }
        }
        if (!nearest) continue; // sufficient spacing

        const w = Math.round(target.width * 10) / 10;
        const h = Math.round(target.height * 10) / 10;
        findings.push({
          element: target.element,
          type: PRIMARY.type,
          severity: PRIMARY.severity ?? "Moderate",
          description: `This ${target.element.tagName.toLowerCase()} target is ${w}x${h}px (minimum ${minSize}x${minSize}px) and a ${minSize}px circle centred on it intersects the nearest other target (centre ${Math.round(nearestDist)}px away), so the spacing exception does not apply.`,
          data: {
            ruleId: PRIMARY.id,
            width: w,
            height: h,
            minSize,
            nearestTargetDistance: Math.round(nearestDist),
            nearestTarget: `<${nearest.element.tagName.toLowerCase()}${nearest.element.id ? `#${nearest.element.id}` : ""}>`,
          },
          fix: {
            summary: `Increase the target to at least ${minSize}x${minSize}px (for example min-width/min-height with padding), or add spacing so that a ${minSize}px circle centred on it does not overlap neighbouring targets (centres at least ${minSize}px apart and no other target within ${minSize / 2}px of its centre).`,
            suggestedValue: `min-width: ${minSize}px; min-height: ${minSize}px;`,
            docsUrl: "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html",
          },
        });
      } catch {
        // next
      }
    }
    ctx.progress?.(100);
    return findings;
  },
};

export default rule;
