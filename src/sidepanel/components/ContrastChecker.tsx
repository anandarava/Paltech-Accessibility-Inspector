import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toHex, type RGB, type RGBA } from "@shared/color";
import { describeColor, evaluateContrast, parseColorInput, suggestFixes, type ContrastEvaluation } from "@shared/contrast-check";
import { sendToBackground, type ManualCheckInput } from "@shared/messages";
import type { ElementColors, Issue, ScanResult } from "@shared/types";
import { useStore } from "@src/sidepanel/store";
import { sendToPage } from "@src/sidepanel/hooks/messaging";
import { COLOR_PICKED_EVENT } from "@src/sidepanel/hooks/useBackgroundEvents";
import { useFocusHeading } from "@src/sidepanel/hooks/useFocusHeading";
import { BackButton } from "./BackButton";
import { Button } from "./Button";

/**
 * Contrast checker: type or pick a text and a background colour and see the
 * WCAG contrast ratio, which thresholds it meets and the nearest passing
 * colours. Opened from a contrast finding ("Check by eye"), it measures that
 * element and records the tester's verdict on the finding.
 *
 * Accuracy:
 *  - Same luminance and ratio maths as the scan (shared/color.ts); pass/fail
 *    uses the unrounded ratio and the shown ratio is truncated, never rounded up.
 *  - Background: Chrome's EyeDropper reads the pixel as drawn on screen, so a
 *    photo, gradient or video frame is measured as it is seen. Several points
 *    can be picked; the lowest ratio counts.
 *  - Text: an eyedropper on thin text lands on anti-aliased edge pixels and
 *    reads too light, so "From element" reads the exact CSS colour instead.
 */

type Source = "typed" | "picked" | "element";
type Requirement = "normal" | "large" | "non-text";

const REQUIRED: Record<Requirement, number> = { normal: 4.5, large: 3, "non-text": 3 };
const REQUIREMENT_LABEL: Record<Requirement, string> = {
  normal: "Normal text (4.5:1)",
  large: "Large text, 24px or 18.66px bold (3:1)",
  "non-text": "Icons, borders, focus rings (3:1)",
};

interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperCtor {
  new (): { open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult> };
}

function eyeDropper(): EyeDropperCtor | null {
  const ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return typeof ctor === "function" ? ctor : null;
}

/** Contrast rules whose findings can be checked by eye. */
export const CHECKABLE_RULES = new Set(["CLR-01", "CLR-02", "CLR-03", "CLR-04", "CLR-05"]);

function requirementFor(issue: Issue | undefined, colors: ElementColors | undefined): Requirement {
  if (!issue) return colors?.large ? "large" : "normal";
  if (issue.ruleId === "CLR-04" || issue.ruleId === "CLR-05") return "non-text";
  const required = typeof issue.data?.required === "number" ? issue.data.required : undefined;
  if (required === 3 || issue.ruleId === "CLR-02") return "large";
  return "normal";
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function ColorField({
  id,
  label,
  value,
  onChange,
  source,
  hint,
  onPickScreen,
  onPickElement,
  pickBusy,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange(text: string, source: Source): void;
  source: Source;
  hint?: string;
  onPickScreen?: () => void;
  onPickElement?: () => void;
  pickBusy?: boolean;
  error?: string;
}) {
  const parsed = parseColorInput(value);
  const hex = parsed ? toHex([parsed[0], parsed[1], parsed[2]]) : "#000000";
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <label htmlFor={id} className="text-xs font-semibold text-slate-800">
        {label}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="inline-block h-8 w-8 shrink-0 rounded border border-slate-500" style={{ backgroundColor: parsed ? `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${parsed[3]})` : "transparent" }} aria-hidden="true" />
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value, "typed")}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder="#1a1a1a or rgb(26, 26, 26)"
          className="min-w-0 flex-1 basis-32 rounded border border-slate-500 px-2 py-1 font-mono text-sm"
        />
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value, "typed")}
          aria-label={`${label}: colour picker`}
          className="h-8 w-9 cursor-pointer rounded border border-slate-500 bg-white p-0.5"
        />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {onPickScreen && (
          <Button size="sm" onClick={onPickScreen} disabled={pickBusy} aria-describedby={describedBy}>
            Pick on page
          </Button>
        )}
        {onPickElement && (
          <Button size="sm" onClick={onPickElement} disabled={pickBusy}>
            From element
          </Button>
        )}
        <span className="self-center text-[11px] text-slate-600">{source === "picked" ? "Picked on screen" : source === "element" ? "Exact CSS colour" : "Typed"}</span>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[11px] leading-snug text-slate-700">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

export function ContrastChecker({ onBack }: { onBack(): void }) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const result = useStore((s) => s.result);
  const issueId = useStore((s) => s.checkerIssueId);
  const setResult = useStore((s) => s.setResult);
  const setColorPicking = useStore((s) => s.setColorPicking);
  const showToast = useStore((s) => s.showToast);
  const readOnly = useStore((s) => s.viewingSaved !== null);
  const headingRef = useFocusHeading<HTMLHeadingElement>([issueId]);
  const issue = issueId ? result?.issues.find((i) => i.id === issueId) : undefined;

  const [fgText, setFgText] = useState("");
  const [bgText, setBgText] = useState("");
  const [fgSource, setFgSource] = useState<Source>("typed");
  const [bgSource, setBgSource] = useState<Source>("typed");
  /** Further background points picked on the page (a photo or gradient): the lowest ratio counts. */
  const [extraBg, setExtraBg] = useState<string[]>([]);
  const [requirement, setRequirement] = useState<Requirement>("normal");
  const [colors, setColors] = useState<ElementColors | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const pickTarget = useRef<"fg" | "bg" | null>(null);
  const prepared = useRef(false);

  // Get the page ready (nothing of ours drawn on it, the element in view and, for a focus ring,
  // focused) and prefill from the finding: the exact CSS text colour, and the scan's background.
  useEffect(() => {
    if (tabId === null || readOnly) return;
    let cancelled = false;
    const focus = issue?.ruleId === "CLR-05";
    void sendToBackground<{ colors?: ElementColors; found?: boolean }>({ type: "COLOR_PREPARE", tabId, issueId: issue?.id, focus }).then((res) => {
      if (cancelled) return;
      prepared.current = res.ok;
      const c = res.ok ? res.data?.colors : undefined;
      setColors(c);
      if (issue) {
        const scanFg = asString(issue.data?.foreground);
        const scanBg = asString(issue.data?.background);
        // A focus ring's colour is the indicator, not the text: keep the scan's value for it.
        const fg = issue.ruleId === "CLR-05" || issue.ruleId === "CLR-04" ? scanFg : (c?.foreground ?? scanFg);
        if (fg) {
          setFgText(fg);
          setFgSource(c && fg === c.foreground ? "element" : "typed");
        }
        const bg = c?.backgroundSure && issue.ruleId !== "CLR-05" && issue.ruleId !== "CLR-04" ? c.background : scanBg;
        if (bg) {
          setBgText(bg);
          setBgSource("typed");
        }
        setRequirement(requirementFor(issue, c));
      }
    });
    return () => {
      cancelled = true;
    };
    // Prepare once per finding; the issue object changes identity when its status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, issue?.id, readOnly]);

  // Leaving the checker puts the page back (scroll, focus, overlay, focus emulation).
  const tabRef = useRef(tabId);
  tabRef.current = tabId;
  useEffect(
    () => () => {
      const t = tabRef.current;
      if (t !== null) void sendToBackground({ type: "COLOR_RESTORE", tabId: t });
    },
    [],
  );

  // An element chosen with the picker: its exact text colour (and the background when it is certain).
  useEffect(() => {
    const onPicked = async (e: Event) => {
      const selector = (e as CustomEvent<string | null>).detail;
      const target = pickTarget.current;
      pickTarget.current = null;
      setBusy(null);
      if (!selector || tabId === null || !target) return;
      const res = await sendToPage<ElementColors>(tabId, { type: "CS_ELEMENT_COLORS", tabId, selector });
      if (!res.ok || !res.data) {
        showToast({ kind: "error", message: res.error ?? "Could not read the element's colours." });
        return;
      }
      const c = res.data;
      setColors(c);
      if (target === "fg") {
        setFgText(c.foreground);
        setFgSource("element");
        if (!issue) setRequirement(c.large ? "large" : "normal");
      } else {
        setBgText(c.background);
        setBgSource("element");
        if (!c.backgroundSure) {
          showToast({ kind: "info", message: "An image, gradient or another box may be behind this element. Use Pick on page to read the background as it is drawn." });
        }
      }
    };
    window.addEventListener(COLOR_PICKED_EVENT, onPicked);
    return () => window.removeEventListener(COLOR_PICKED_EVENT, onPicked);
  }, [tabId, issue, showToast]);

  const fg = parseColorInput(fgText);
  const bgList = useMemo(() => [bgText, ...extraBg].map(parseColorInput), [bgText, extraBg]);
  const bg = bgList[0] ?? null;
  const required = REQUIRED[requirement];

  // Every background point measured; the lowest ratio is the one that counts.
  const evaluations: ContrastEvaluation[] = useMemo(
    () => (fg ? bgList.filter((b): b is RGBA => b !== null).map((b) => evaluateContrast(fg, b)) : []),
    [fg, bgList],
  );
  const worst = evaluations.reduce<ContrastEvaluation | null>((w, e) => (!w || e.exact < w.exact ? e : w), null);
  const passes = worst ? worst.exact >= required : undefined;
  const fixes = worst ? suggestFixes(worst, required) : null;

  const pickScreen = useCallback(
    async (target: "fg" | "bg" | "extra") => {
      const Ctor = eyeDropper();
      if (!Ctor) {
        showToast({ kind: "error", message: "This browser has no eyedropper. Type the colour, or use From element.", autoDismiss: false });
        return;
      }
      setBusy("eyedropper");
      try {
        // Opened straight from the click (the browser requires a user gesture).
        const picked = await new Ctor().open();
        const hex = picked.sRGBHex.toLowerCase();
        if (target === "fg") {
          setFgText(hex);
          setFgSource("picked");
        } else if (target === "bg") {
          setBgText(hex);
          setBgSource("picked");
        } else {
          setExtraBg((list) => [...list, hex]);
        }
      } catch {
        // Escape or a click outside: nothing picked.
      } finally {
        setBusy(null);
      }
    },
    [showToast],
  );

  const pickElement = useCallback(
    async (target: "fg" | "bg") => {
      if (tabId === null) return;
      pickTarget.current = target;
      setColorPicking(true);
      setBusy("element");
      const res = await sendToPage(tabId, { type: "PICKER_START", tabId });
      if (!res.ok) {
        pickTarget.current = null;
        setColorPicking(false);
        setBusy(null);
        showToast({ kind: "error", message: `Could not start the element picker: ${res.error ?? "no response from page"}` });
        return;
      }
      showToast({ kind: "info", message: "Click the text on the page. Press Esc to cancel." });
    },
    [tabId, setColorPicking, showToast],
  );

  const swap = () => {
    setFgText(bgText);
    setBgText(fgText);
    setFgSource(bgSource);
    setBgSource(fgSource);
    setExtraBg([]);
  };

  const record = async (verdict: "pass" | "fail") => {
    if (tabId === null || !issue || !worst || !fg) return;
    const check: ManualCheckInput = {
      verdict,
      foreground: toHex(worst.foreground),
      background: toHex(worst.background),
      ratio: worst.ratio,
      required,
      foregroundSource: fgSource,
      backgroundSource: bgSource,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    setBusy("verdict");
    const res = await sendToBackground<ScanResult>({ type: "MANUAL_CHECK_SET", tabId, issueId: issue.id, check });
    setBusy(null);
    if (!res.ok || !res.data) {
      showToast({ kind: "error", message: `Could not save the check: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    setResult(res.data);
    showToast({
      kind: "success",
      message: verdict === "pass" ? "Checked: passes. The finding is marked as a false positive for this site." : "Checked: fails. The failure is confirmed and counts in the score.",
    });
    onBack();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ kind: "success", message: `Copied ${text}` });
    } catch {
      showToast({ kind: "error", message: "Could not access the clipboard." });
    }
  };

  const fgError = fgText.trim() && !fg ? "Not a colour. Use a hex value (#1a1a1a), rgb(), hsl() or a colour name." : undefined;
  const bgError = bgText.trim() && !bg ? "Not a colour. Use a hex value (#ffffff), rgb(), hsl() or a colour name." : undefined;
  const noEyedropper = !eyeDropper();
  const relevant = worst?.criteria.filter((c) => (requirement === "non-text" ? c.id === "non-text" : true)) ?? [];

  return (
    <section aria-labelledby={`${id}-heading`} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <BackButton onClick={onBack} ariaLabel={issue ? "Back to the issue" : "Back"} />
      </div>
      <div className="flex flex-col gap-3 p-3">
        <header>
          <h2 id={`${id}-heading`} ref={headingRef} tabIndex={-1} className="text-[17px] font-semibold text-slate-900">
            {issue ? "Check contrast by eye" : "Contrast checker"}
          </h2>
          {issue ? (
            <p className="mt-1 text-sm text-slate-800">
              {issue.ruleId}: {issue.title}. The scan measured {asString(issue.data?.foreground) ?? "?"} on {asString(issue.data?.background) ?? "?"}
              {typeof issue.data?.ratio === "number" ? ` (${issue.data.ratio}:1)` : ""}. Pick the colours as they look on the page, then record the result.
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-800">Type colours, or pick them on the page. The result uses the same WCAG formula as the scan.</p>
          )}
          {issue?.ruleId === "CLR-05" && (
            <p className="mt-1 text-xs text-slate-700">The element is focused on the page. Pick the focus ring as the first colour and the colour next to it as the background.</p>
          )}
          {noEyedropper && (
            <p className="mt-1 text-xs text-amber-900">This browser has no eyedropper: type the colours or use From element.</p>
          )}
        </header>

        <ColorField
          id={`${id}-fg`}
          label={issue?.ruleId === "CLR-05" ? "Focus indicator colour" : issue?.ruleId === "CLR-04" ? "Border colour" : "Text colour"}
          value={fgText}
          onChange={(t, s) => {
            setFgText(t);
            setFgSource(s);
          }}
          source={fgSource}
          error={fgError}
          hint={issue?.ruleId === "CLR-05" || issue?.ruleId === "CLR-04" ? undefined : "From element reads the exact CSS colour. Picking text pixels can land on blurred letter edges and read too light."}
          onPickScreen={noEyedropper ? undefined : () => void pickScreen("fg")}
          onPickElement={readOnly ? undefined : () => void pickElement("fg")}
          pickBusy={busy !== null}
        />

        <div className="flex justify-center">
          <Button size="sm" variant="ghost" onClick={swap}>
            ⇅ Swap colours
          </Button>
        </div>

        <ColorField
          id={`${id}-bg`}
          label="Background colour"
          value={bgText}
          onChange={(t, s) => {
            setBgText(t);
            setBgSource(s);
          }}
          source={bgSource}
          error={bgError}
          hint="Pick on page reads the colour as it is drawn, including photos, gradients and video. Pick right next to the text."
          onPickScreen={noEyedropper ? undefined : () => void pickScreen("bg")}
          onPickElement={readOnly ? undefined : () => void pickElement("bg")}
          pickBusy={busy !== null}
        />

        {/* Extra background points: a photo or gradient is measured at its worst point. */}
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-xs text-slate-800">
            Text over a photo or gradient? Pick a few more points behind it; the lowest ratio counts.
          </p>
          {extraBg.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Extra background points">
              {extraBg.map((c, i) => (
                <li key={`${c}-${i}`} className="inline-flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5">
                  <span className="inline-block h-3.5 w-3.5 rounded border border-slate-500" style={{ backgroundColor: c }} aria-hidden="true" />
                  <code className="font-mono text-[11px]">{c}</code>
                  <button type="button" className="text-xs text-slate-700 hover:text-red-800" aria-label={`Remove background point ${c}`} onClick={() => setExtraBg((l) => l.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!noEyedropper && (
            <Button size="sm" className="mt-1.5" onClick={() => void pickScreen("extra")} disabled={busy !== null || !bg}>
              + Pick another background point
            </Button>
          )}
        </div>

        <fieldset className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <legend className="px-1 text-xs font-semibold text-slate-800">Judge against</legend>
          {(Object.keys(REQUIRED) as Requirement[]).map((r) => (
            <label key={r} className="flex items-center gap-2 py-0.5 text-sm text-slate-800">
              <input type="radio" name={`${id}-req`} checked={requirement === r} onChange={() => setRequirement(r)} />
              {REQUIREMENT_LABEL[r]}
            </label>
          ))}
          {colors && (
            <p className="mt-1 text-[11px] text-slate-700">
              The element's text is {Math.round(colors.fontSize * 100) / 100}px, weight {colors.fontWeight}: {colors.large ? "large" : "normal"} text under WCAG.
            </p>
          )}
        </fieldset>

        {/* Result */}
        <section aria-labelledby={`${id}-result`} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <h3 id={`${id}-result`} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
            Result
          </h3>
          <div aria-live="polite" aria-atomic="true">
            {worst ? (
              <>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                  {worst.ratio}:1{" "}
                  <span className={`ml-1 rounded px-1.5 py-0.5 align-middle text-sm font-semibold ${passes ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
                    {passes ? "Passes" : "Fails"} {required}:1
                  </span>
                </p>
                {evaluations.length > 1 && (
                  <p className="text-xs text-slate-700">
                    Lowest of {evaluations.length} background points ({toHex(worst.background)}); highest {Math.max(...evaluations.map((e) => e.ratio))}:1.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-700">Enter or pick both colours to see the ratio.</p>
            )}
          </div>
          {worst && (
            <>
              <ul className="mt-2 grid gap-1 text-sm">
                {relevant.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1">
                    <span className="text-slate-800">
                      {c.label} <span className="text-xs text-slate-600">({c.required}:1, WCAG {c.criterion})</span>
                    </span>
                    <span className={`font-semibold ${c.pass ? "text-emerald-800" : "text-red-800"}`}>{c.pass ? "✓ Pass" : "✗ Fail"}</span>
                  </li>
                ))}
              </ul>
              {worst.notes.map((n) => (
                <p key={n} className="mt-1 text-xs text-amber-900">
                  {n}
                </p>
              ))}
              {/* Preview: the colours as text and as a ring. */}
              <div className="mt-2 rounded border border-slate-300 p-2" style={{ backgroundColor: toHex(worst.background) }} aria-hidden="true">
                <p style={{ color: toHex(worst.foreground), fontSize: 14 }}>Normal text sample, 14px</p>
                <p style={{ color: toHex(worst.foreground), fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>Large text</p>
                <span className="mt-1 inline-block rounded px-2 py-0.5 text-xs" style={{ outline: `2px solid ${toHex(worst.foreground)}`, outlineOffset: 2, color: toHex(worst.foreground) }}>
                  Focus ring
                </span>
              </div>
            </>
          )}
        </section>

        {fixes && worst && (
          <section aria-labelledby={`${id}-fix`} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <h3 id={`${id}-fix`} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-900">
              Nearest passing colours
            </h3>
            {(
              [
                ["Text colour", fixes.text, (c: RGB) => { setFgText(toHex(c)); setFgSource("typed"); }, evaluateContrast([...fixes.text, 1], [...worst.background, 1]).ratio],
                ["Background", fixes.background, (c: RGB) => { setBgText(toHex(c)); setBgSource("typed"); setExtraBg([]); }, evaluateContrast([...worst.foreground, 1], [...fixes.background, 1]).ratio],
              ] as Array<[string, RGB, (c: RGB) => void, number]>
            ).map(([label, c, use, ratio]) => (
              <div key={label} className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                <span className="inline-block h-4 w-4 rounded border border-slate-500" style={{ backgroundColor: toHex(c) }} aria-hidden="true" />
                <span className="text-slate-900">
                  {label}: <code className="font-mono">{toHex(c)}</code> ({ratio}:1)
                </span>
                <Button size="sm" onClick={() => use(c)}>
                  Try it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void copy(toHex(c))}>
                  Copy
                </Button>
              </div>
            ))}
          </section>
        )}

        {issue && !readOnly && worst && fg && (
          <section aria-labelledby={`${id}-verdict`} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
            <h3 id={`${id}-verdict`} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-blue-900">
              Record the result on this finding
            </h3>
            <p className="mt-1 text-sm text-slate-900">
              {describeColor(fg)} on {toHex(worst.background)} is {worst.ratio}:1, so it {passes ? "passes" : "fails"} {required}:1.
            </p>
            <label htmlFor={`${id}-note`} className="mt-2 block text-xs font-semibold text-slate-800">
              Note (optional)
            </label>
            <input
              id={`${id}-note`}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Where you picked, what you saw"
              className="mt-0.5 w-full rounded border border-slate-500 px-2 py-1 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {/* Only the verdict the measurement supports can be recorded. */}
              {passes ? (
                <Button variant="primary" size="sm" onClick={() => void record("pass")} disabled={busy !== null}>
                  {busy === "verdict" ? "Saving…" : "Passes: mark as false positive"}
                </Button>
              ) : (
                <Button variant="danger" size="sm" onClick={() => void record("fail")} disabled={busy !== null}>
                  {busy === "verdict" ? "Saving…" : "Fails: confirm the failure"}
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-700">The result is kept for this site and applied again when you rescan. It appears in exported reports.</p>
          </section>
        )}
      </div>
    </section>
  );
}
