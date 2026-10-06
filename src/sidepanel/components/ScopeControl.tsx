import { useId } from "react";
import { useStore } from "@src/sidepanel/store";
import { Popover } from "./Popover";
import { ScopeIcon } from "./icons";
import { ScopeSelectorFields, useScopeSelector } from "./ScopeSelector";

interface Props {
  /** DevTools only: resolves a selector for the element selected in the Elements panel ($0). */
  getInspectedSelector?(): Promise<string | null>;
}

/**
 * "Full page" / "Part of page" scope, like axe DevTools: type a CSS selector,
 * pick an element on the page, or (in DevTools) use the element selected in
 * the Elements panel. Picking starts the scan straight away.
 */
export function ScopeControl({ getInspectedSelector }: Props) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const scanning = useStore((s) => s.scanning);
  const state = useScopeSelector(getInspectedSelector);
  const { scope, setScope, choosePart } = state;

  const label = scope.kind === "page" ? "Full page" : "Part of page";

  return (
    <Popover
      label={<><ScopeIcon /> {label}</>}
      ariaLabel={`Scan scope: ${label}. Change scope`}
      align="left"
      disabled={tabId === null}
      className="flex-1 basis-[5.5rem]"
      wrap="whitespace-normal"
    >
      <fieldset className="w-72" disabled={scanning}>
        <legend className="mb-1 text-xs font-semibold text-slate-800">What to scan</legend>
        <label className="flex items-center gap-2 py-0.5 text-sm text-slate-800">
          <input type="radio" name={`${id}-scope`} checked={scope.kind === "page"} onChange={() => setScope({ kind: "page" })} />
          Full page
        </label>
        <label className="flex items-center gap-2 py-0.5 text-sm text-slate-800">
          <input type="radio" name={`${id}-scope`} checked={scope.kind === "selector"} onChange={choosePart} />
          Part of page
        </label>

        {/* Choosing what to scan only matters for "Part of page". */}
        {scope.kind === "selector" && <ScopeSelectorFields id={id} state={state} className="mt-2 border-t border-slate-200 pt-2" />}
      </fieldset>
    </Popover>
  );
}
