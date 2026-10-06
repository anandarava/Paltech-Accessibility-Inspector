import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ExportFormat, SavedScan, SavedScanMeta } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { useStore, type CompareSide } from "@src/sidepanel/store";
import { useFocusHeading } from "@src/sidepanel/hooks/useFocusHeading";
import { Button } from "./Button";
import { ArrowLeftIcon, BookmarkIcon, CompareIcon } from "./icons";
import { EmptyState, SavedScansIllustration } from "./EmptyState";

/** The name a scan is stored under: what the tester typed plus the moment it was saved. */
export function savedScanName(typed: string, now: Date = new Date()): string {
  const when = now.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${typed.trim()} – ${when}`;
}

function counts(meta: SavedScanMeta): string {
  const s = meta.summary;
  return `${s.critical} critical · ${s.serious} serious · ${s.moderate} moderate · ${s.minor} minor · ${s.bestPractice} best practice`;
}

/**
 * Saved scans: named snapshots of results kept across sessions (axe DevTools
 * "Saved tests"). Open one read-only, rename, export, delete, or pick two
 * (or one plus the current scan) to compare.
 */
export function SavedScans({ onBack }: { onBack(): void }) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const result = useStore((s) => s.viewingSaved ? s.liveResult : s.result);
  const openSaved = useStore((s) => s.openSaved);
  const setCompare = useStore((s) => s.setCompare);
  const setView = useStore((s) => s.setView);
  const showToast = useStore((s) => s.showToast);
  const headingRef = useFocusHeading<HTMLHeadingElement>([]);
  const [items, setItems] = useState<SavedScanMeta[] | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const rootRef = useRef<HTMLElement>(null);
  /** CSS selector of the element to focus once the list/rename form has re-rendered; "heading" means the view heading. */
  const pendingFocus = useRef<string | null>(null);

  // Keyboard users must not lose focus when the control they used is removed or replaced.
  useEffect(() => {
    const sel = pendingFocus.current;
    if (!sel) return;
    const el = sel === "heading" ? headingRef.current : rootRef.current?.querySelector<HTMLElement>(sel);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  }, [items, renaming, headingRef]);

  const load = useCallback(async () => {
    const res = await sendToBackground<SavedScanMeta[]>({ type: "SAVED_SCANS_LIST" });
    if (res.ok && Array.isArray(res.data)) setItems(res.data);
    else {
      setItems([]);
      showToast({ kind: "error", message: `Could not load saved scans: ${res.error ?? "unknown error"}` });
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (tabId === null || !result) return;
    if (!name.trim()) {
      setNameError("Enter a name for this scan.");
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    setBusy("save");
    const res = await sendToBackground<SavedScanMeta>({ type: "SAVED_SCAN_SAVE", tabId, name: savedScanName(name) });
    setBusy(null);
    if (!res.ok) {
      showToast({ kind: "error", message: `Could not save the scan: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    showToast({ kind: "success", message: `Saved "${res.data?.name ?? name}".` });
    setName("");
    void load();
  };

  const open = async (meta: SavedScanMeta) => {
    setBusy(`open:${meta.id}`);
    const res = await sendToBackground<SavedScan>({ type: "SAVED_SCAN_GET", id: meta.id });
    setBusy(null);
    if (!res.ok || !res.data) {
      showToast({ kind: "error", message: `Could not open the scan: ${res.error ?? "not found"}` });
      return;
    }
    openSaved(res.data.meta, res.data.result);
  };

  const remove = async (meta: SavedScanMeta) => {
    if (!window.confirm(`Delete the saved scan "${meta.name}"? This cannot be undone.`)) return;
    // The deleted row disappears (and the focused button is disabled meanwhile): hand focus to a neighbouring row, else the heading.
    const list = items ?? [];
    const at = list.findIndex((m) => m.id === meta.id);
    const neighbour = list[at + 1] ?? list[at - 1];
    setBusy(`del:${meta.id}`);
    const res = await sendToBackground({ type: "SAVED_SCAN_DELETE", id: meta.id });
    setBusy(null);
    if (!res.ok) {
      showToast({ kind: "error", message: `Could not delete: ${res.error ?? "unknown error"}` });
      pendingFocus.current = `[data-delete-id="${CSS.escape(meta.id)}"]`;
    } else {
      pendingFocus.current = neighbour ? `[data-open-id="${CSS.escape(neighbour.id)}"]` : "heading";
    }
    setSelected((s) => s.filter((x) => x !== meta.id));
    void load();
  };

  const closeRename = (meta: SavedScanMeta) => {
    pendingFocus.current = `[data-rename-id="${CSS.escape(meta.id)}"]`;
    setRenaming(null);
  };

  const rename = async (e: FormEvent, meta: SavedScanMeta) => {
    e.preventDefault();
    const res = await sendToBackground({ type: "SAVED_SCAN_RENAME", id: meta.id, name: renameValue });
    if (!res.ok) showToast({ kind: "error", message: `Could not rename: ${res.error ?? "unknown error"}` });
    closeRename(meta);
    void load();
  };

  const exportAs = async (meta: SavedScanMeta, format: ExportFormat) => {
    setBusy(`exp:${meta.id}`);
    const res = await sendToBackground<{ filename?: string }>({ type: "SAVED_SCAN_EXPORT", id: meta.id, format });
    setBusy(null);
    if (res.ok) showToast({ kind: "success", message: `Report exported${res.data?.filename ? `: ${res.data.filename}` : "."}` });
    else showToast({ kind: "error", message: `Export failed: ${res.error ?? "unknown error"}`, autoDismiss: false });
  };

  const compare = () => {
    const sides: CompareSide[] = selected.map((sid) => ({ kind: "saved", id: sid }));
    if (sides.length === 1 && result) sides.push({ kind: "current" });
    if (sides.length !== 2) return;
    setCompare({ a: sides[0], b: sides[1] });
    setView("compare");
  };

  const toggle = (sid: string) =>
    setSelected((s) => (s.includes(sid) ? s.filter((x) => x !== sid) : s.length >= 2 ? [s[1], sid] : [...s, sid]));

  const canCompare = selected.length === 2 || (selected.length === 1 && Boolean(result));

  return (
    <section ref={rootRef} aria-labelledby={`${id}-h`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="px-3 pt-3">
        <Button size="sm" onClick={onBack} aria-label="Back to results" className="bg-white">
          <ArrowLeftIcon size={13} />
          Back
        </Button>
      </div>
      <div className="flex items-center gap-2.5 px-3 py-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <BookmarkIcon size={18} />
        </span>
        <h2 id={`${id}-h`} ref={headingRef} tabIndex={-1} className="text-xl font-bold text-slate-900">
          Saved scans
        </h2>
      </div>

      <form onSubmit={(e) => void save(e)} className="mx-3 rounded-xl border border-slate-200 bg-white p-3">
        <label htmlFor={`${id}-name`} className="block text-xs font-bold text-slate-900">
          Save the current scan as
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id={`${id}-name`}
            ref={nameRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            disabled={!result}
            placeholder="e.g. Checkout page"
            aria-invalid={nameError ? "true" : undefined}
            aria-describedby={`${id}-name-hint${nameError ? ` ${id}-name-err` : ""}`}
            className="min-w-0 flex-1 rounded-md border border-slate-500 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-500"
          />
          <Button type="submit" variant="primary" size="md"disabled={!result || tabId === null || busy === "save"}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
        {nameError && (
          <p id={`${id}-name-err`} role="alert" className="mt-1 text-xs text-red-700">
            {nameError}
          </p>
        )}
        <p id={`${id}-name-hint`} className="mt-1.5 text-xs text-slate-700">
          {result ? "The date and time are added when you save." : "Run a scan first to save it."}
        </p>
      </form>

      <div className="mx-3 mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <CompareIcon size={16} />
            </span>
            <p className="text-xs text-slate-800">
              {selected.length === 0
                ? "Tick two scans (or one to compare with the current scan)."
                : `${selected.length} selected${selected.length === 1 && result ? " – compares with the current scan" : ""}.`}
            </p>
          </div>
          <Button size="md" onClick={compare} disabled={!canCompare} className="bg-white">
            Compare
          </Button>
        </div>
        {items === null && <p className="mt-2 text-xs text-slate-700">Loading…</p>}
        {items?.length === 0 && <p className="mt-2 text-xs text-slate-700">No saved scans yet.</p>}
      </div>

      <ul className="px-3 pt-3 pb-3">
        {items?.map((meta) => {
          const checked = selected.includes(meta.id);
          return (
            <li key={meta.id} className={`mb-2 rounded-lg border p-2.5 ${checked ? "border-blue-700 bg-blue-50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  onChange={() => toggle(meta.id)}
                  aria-label={`Select "${meta.name}" for comparison`}
                />
                <div className="min-w-0 flex-1">
                  {renaming === meta.id ? (
                    <form onSubmit={(e) => void rename(e, meta)} className="flex gap-1">
                      <label htmlFor={`${id}-rn-${meta.id}`} className="sr-only">
                        New name
                      </label>
                      <input
                        id={`${id}-rn-${meta.id}`}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && closeRename(meta)}
                        autoFocus
                        className="min-w-0 flex-1 rounded border border-slate-500 px-1 py-0.5 text-sm"
                      />
                      <Button type="submit" size="sm" variant="primary">
                        Rename
                      </Button>
                    </form>
                  ) : (
                    <h3 className="truncate text-sm font-semibold text-slate-900">{meta.name}</h3>
                  )}
                  <p className="truncate text-[11px] text-slate-700" title={meta.url}>
                    {meta.url}
                  </p>
                  <p className="text-[11px] text-slate-700">
                    Score <strong>{meta.score}</strong> · {meta.issueCount} issues · WCAG {meta.wcagVersion} {meta.wcagLevel}
                    {meta.scope?.kind === "selector" ? " · part of page" : ""} · {new Date(meta.timestamp).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-slate-600">{counts(meta)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button size="sm" variant="primary" data-open-id={meta.id} onClick={() => void open(meta)} disabled={busy === `open:${meta.id}`}>
                      Open
                    </Button>
                    <Button
                      size="sm"
                      data-rename-id={meta.id}
                      onClick={() => {
                        setRenaming(meta.id);
                        setRenameValue(meta.name);
                      }}
                    >
                      Rename
                    </Button>
                    {(["html", "json"] as ExportFormat[]).map((f) => (
                      <Button key={f} size="sm" onClick={() => void exportAs(meta, f)} disabled={busy === `exp:${meta.id}`} aria-label={`Export "${meta.name}" as ${f.toUpperCase()}`}>
                        {f.toUpperCase()}
                      </Button>
                    ))}
                    <Button size="sm" variant="danger" data-delete-id={meta.id} onClick={() => void remove(meta)} disabled={busy === `del:${meta.id}`} aria-label={`Delete "${meta.name}"`}>
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {items?.length === 0 && (
        <EmptyState illustration={<SavedScansIllustration />} heading="No saved scans yet">
          Save a scan to view it here and compare with other scans.
        </EmptyState>
      )}
    </section>
  );
}
