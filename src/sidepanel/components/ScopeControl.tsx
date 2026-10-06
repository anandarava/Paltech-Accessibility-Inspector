import { useId } from "react";
import { useStore } from "@src/sidepanel/store";
import { Popover } from "./Popover";
import { RadioRow } from "./RadioRow";
import { MonitorIcon, PartOfPageIcon } from "./icons";
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
      label={<>{scope.kind === "page" ? <MonitorIcon size={14} /> : <PartOfPageIcon size={14} />} {label}</>}
      ariaLabel={`Scan scope: ${label}. Change scope`}
      align="left"
      disabled={tabId === null}
      className="flex-1 basis-[5.5rem]"
      wrap="whitespace-normal"
      panelClassName="w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-300 p-3"
    >
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={scanning}>
        <legend className="mb-1.5 p-0 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">What to scan</legend>
        <RadioRow name={`${id}-scope`} checked={scope.kind === "page"} onChange={() => setScope({ kind: "page" })} title="Full page" hint="Everything currently rendered" />
        <RadioRow name={`${id}-scope`} checked={scope.kind === "selector"} onChange={choosePart} title="Part of page" hint="One region or component" />
      </fieldset>

      {/* Choosing what to scan only matters for "Part of page". */}
      {scope.kind === "selector" && (
        <fieldset className="m-0 min-w-0 border-0 p-0" disabled={scanning}>
          <ScopeSelectorFields state={state} className="mt-2 border-t border-slate-200 pt-3" />
        </fieldset>
      )}
    </Popover>
  );
}
