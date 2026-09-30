import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface Props {
  /** Trigger button content. */
  label: ReactNode;
  /** Accessible name of the trigger when the visible label is not enough. */
  ariaLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Which edge of the trigger the panel aligns to. */
  align?: "left" | "right";
  /** Open below the trigger (default) or above it, e.g. for buttons in a bottom bar. */
  side?: "bottom" | "top";
}

/**
 * Disclosure popover: a button with aria-expanded/aria-controls that toggles a
 * panel. Escape or an outside click closes it and focus returns to the trigger.
 */
export function Popover({ label, ariaLabel, children, disabled = false, className = "", align = "right", side = "bottom" }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && rootRef.current && !rootRef.current.contains(next)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    const root = rootRef.current;
    root?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      root?.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-full items-center justify-center gap-1 whitespace-nowrap rounded border border-slate-500 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500"
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          {(side === "top") !== open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className={`absolute ${align === "left" ? "left-0" : "right-0"} ${side === "top" ? "bottom-full mb-1" : "top-full mt-1"} z-20 min-w-48 rounded border border-slate-400 bg-white p-2 shadow-lg`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
