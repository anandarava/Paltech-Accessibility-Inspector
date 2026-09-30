/**
 * Colour swatch with its value as text (the colour itself is decorative and
 * the hex/rgb string carries the meaning).
 */
export function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-4 w-4 shrink-0 rounded border border-slate-500"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="sr-only">{label}: </span>
      <code className="font-mono text-xs text-slate-900">{color}</code>
    </span>
  );
}
