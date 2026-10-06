import { useEffect, useId } from "react";
import type { ColorBlindnessMode, OverlayMode } from "@shared/types";
import { useStore } from "@src/sidepanel/store";
import { sendToPage } from "@src/sidepanel/hooks/messaging";
import { Popover } from "./Popover";
import { EyeIcon } from "./icons";

const MODES: Array<{ value: OverlayMode; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "Hide the overlay" },
  { value: "issues", label: "Issues", hint: "Numbered outlines per issue" },
  { value: "taborder", label: "Tab order", hint: "Numbered focus path" },
  { value: "headings", label: "Headings", hint: "H1–H6 labels, skipped levels marked" },
  { value: "landmarks", label: "Landmarks", hint: "Dashed boxes around regions" },
  { value: "names", label: "Accessible names", hint: "Hover tooltip with role, name and state" },
];

const CB_MODES: Array<{ value: ColorBlindnessMode; label: string }> = [
  { value: "none", label: "None" },
  { value: "protanopia", label: "Protanopia (red-blind)" },
  { value: "deuteranopia", label: "Deuteranopia (green-blind)" },
  { value: "tritanopia", label: "Tritanopia (blue-blind)" },
  { value: "achromatopsia", label: "Achromatopsia (grayscale)" },
];

/** The mode the content script reports in a TOGGLE_OVERLAY response, if it is a known one. */
function reportedMode(data: unknown): OverlayMode | undefined {
  const mode = typeof data === "object" && data !== null ? (data as { mode?: unknown }).mode : undefined;
  return MODES.some((m) => m.value === mode) ? (mode as OverlayMode) : undefined;
}

export function OverlayMenu() {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const overlayMode = useStore((s) => s.overlayMode);
  const colorBlindness = useStore((s) => s.colorBlindness);
  const setOverlayMode = useStore((s) => s.setOverlayMode);
  const setColorBlindness = useStore((s) => s.setColorBlindness);
  const showToast = useStore((s) => s.showToast);

  // Mirror the content script's post-scan rule (handleScanStart in
  // content-script.iife.ts): once a scan finishes on the top frame the page
  // shows the "issues" overlay, whatever mode was on before. Without this the
  // menu could keep an older choice (e.g. "Tab order") the page no longer
  // draws. A live scan is recognised by `scanning` dropping from true to false
  // together with a new result; a tab-switch restore (GET_LAST_RESULT) never
  // sets `scanning`, so the page's overlay is not claimed to be visible when we
  // cannot know that it is.
  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        if (!prev.scanning || state.scanning) return;
        if (!state.result || state.result === prev.result) return;
        if (state.overlayMode !== "issues") state.setOverlayMode("issues");
      }),
    [],
  );

  const changeMode = async (mode: OverlayMode) => {
    if (tabId === null) return;
    const previous = useStore.getState().overlayMode;
    setOverlayMode(mode);
    const res = await sendToPage<{ mode?: OverlayMode }>(tabId, {
      type: "TOGGLE_OVERLAY",
      tabId,
      visible: mode !== "off",
      mode,
    });
    // The panel may have moved to another tab, or the user may have picked
    // another mode, while the page was answering; leave that state alone.
    const now = useStore.getState();
    if (now.tabId !== tabId || now.overlayMode !== mode) return;
    if (!res.ok) {
      setOverlayMode(previous);
      showToast({ kind: "error", message: `Could not change overlay: ${res.error ?? "no response from page"}` });
      return;
    }
    // The page reports the mode it actually ended up in; that is the truth.
    const reported = reportedMode(res.data);
    if (reported && reported !== mode) setOverlayMode(reported);
  };

  const changeCb = async (mode: ColorBlindnessMode) => {
    if (tabId === null) return;
    setColorBlindness(mode);
    const res = await sendToPage(tabId, { type: "SET_COLOR_BLINDNESS", tabId, mode });
    if (!res.ok) showToast({ kind: "error", message: `Could not apply simulation: ${res.error ?? "no response from page"}` });
  };

  const current = MODES.find((m) => m.value === overlayMode)?.label ?? "Off";

  return (
    <Popover
      label={<><EyeIcon /> Overlay: {current}</>}
      ariaLabel={`Overlay: ${current}, open overlay menu`}
      disabled={tabId === null}
      className="flex-1 basis-[5.5rem]"
      wrap="whitespace-normal"
    >
      <fieldset>
        <legend className="mb-1 text-xs font-semibold text-slate-800">Overlay mode</legend>
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2 py-0.5 text-sm text-slate-800">
            <input
              type="radio"
              name={`${id}-mode`}
              value={m.value}
              checked={overlayMode === m.value}
              onChange={() => void changeMode(m.value)}
              // A radio that is already checked never fires onChange. If the
              // page's overlay drifted from what the panel shows (e.g. it was
              // shown by the page after a scan, or kept from before a tab
              // switch), re-selecting the current mode must still reach the
              // page so that "Off" always hides the overlay. onClick runs
              // before onChange and only handles the already-checked case, so
              // a normal selection is not sent twice.
              onClick={() => {
                if (overlayMode === m.value) void changeMode(m.value);
              }}
              className="mt-1"
            />
            <span>
              {m.label}
              <span className="block text-[11px] text-slate-600">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-2 border-t border-slate-300 pt-2">
        <label htmlFor={`${id}-cb`} className="block text-xs font-semibold text-slate-800">
          Colour-blindness simulation
        </label>
        <select
          id={`${id}-cb`}
          value={colorBlindness}
          onChange={(e) => void changeCb(e.target.value as ColorBlindnessMode)}
          className="mt-0.5 w-full rounded border border-slate-500 bg-white px-1 py-1 text-sm text-slate-900"
        >
          {CB_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </Popover>
  );
}
