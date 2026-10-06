/**
 * Small accessible UI primitives shared by the options page sections.
 * Tailwind v4 utilities only; focus styling comes from src/styles.css (:focus-visible).
 */
import type { ReactNode, ChangeEvent, ButtonHTMLAttributes, JSX } from "react";

export interface StatusMessage {
  kind: "success" | "error" | "info";
  text: string;
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm " +
  "placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

export function Section(props: { id: string; title: string; description?: string; children: ReactNode }): JSX.Element {
  const headingId = `${props.id}-heading`;
  return (
    <section
      id={props.id}
      aria-labelledby={headingId}
      className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id={headingId} className="text-lg font-semibold text-slate-900">
        {props.title}
      </h2>
      {props.description ? <p className="mt-1 text-sm text-slate-600">{props.description}</p> : null}
      <div className="mt-4 space-y-4">{props.children}</div>
    </section>
  );
}

export function Fieldset(props: { legend: string; description?: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <fieldset className={`min-w-0 rounded-md border border-slate-200 p-4 ${props.className ?? ""}`}>
      <legend className="px-1 text-sm font-semibold text-slate-800">{props.legend}</legend>
      {props.description ? <p className="mb-3 text-sm text-slate-600">{props.description}</p> : null}
      <div className="space-y-3">{props.children}</div>
    </fieldset>
  );
}

export function Hint(props: { id: string; children: ReactNode }): JSX.Element {
  return (
    <p id={props.id} className="mt-1 text-xs text-slate-500">
      {props.children}
    </p>
  );
}

export function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "url" | "email" | "password" | "number";
  hint?: ReactNode;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
}): JSX.Element {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={props.id} className="block text-sm font-medium text-slate-800">
        {props.label}
        {props.required ? (
          <span aria-hidden="true" className="text-red-600">
            {" "}
            *
          </span>
        ) : null}
      </label>
      <input
        id={props.id}
        className={`mt-1 ${inputClass}`}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete ?? "off"}
        aria-describedby={hintId}
        aria-required={props.required || undefined}
        aria-invalid={props.invalid || undefined}
        disabled={props.disabled}
        min={props.min}
        max={props.max}
        step={props.step}
        spellCheck={false}
      />
      {hintId ? <Hint id={hintId}>{props.hint}</Hint> : null}
    </div>
  );
}

export function TextArea(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  rows?: number;
  placeholder?: string;
}): JSX.Element {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={props.id} className="block text-sm font-medium text-slate-800">
        {props.label}
      </label>
      <textarea
        id={props.id}
        className={`mt-1 font-mono ${inputClass}`}
        rows={props.rows ?? 4}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        aria-describedby={hintId}
        spellCheck={false}
      />
      {hintId ? <Hint id={hintId}>{props.hint}</Hint> : null}
    </div>
  );
}

export function SelectField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: ReactNode;
  disabled?: boolean;
}): JSX.Element {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={props.id} className="block text-sm font-medium text-slate-800">
        {props.label}
      </label>
      <select
        id={props.id}
        className={`mt-1 ${inputClass}`}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-describedby={hintId}
        disabled={props.disabled}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hintId ? <Hint id={hintId}>{props.hint}</Hint> : null}
    </div>
  );
}

export function Checkbox(props: {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  return (
    <div className="flex items-start gap-2">
      <input
        id={props.id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-700"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        aria-describedby={hintId}
        disabled={props.disabled}
        title={props.title}
      />
      <div className="min-w-0">
        <label htmlFor={props.id} className="text-sm text-slate-800">
          {props.label}
        </label>
        {hintId ? <Hint id={hintId}>{props.hint}</Hint> : null}
      </div>
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger";

const buttonClasses: Record<ButtonVariant, string> = {
  primary: "bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-300",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:text-slate-400",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300",
};

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }): JSX.Element {
  const { variant = "secondary", className, type, ...rest } = props;
  return (
    <button
      type={type ?? "button"}
      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium shadow-sm disabled:cursor-not-allowed ${buttonClasses[variant]} ${className ?? ""}`}
      {...rest}
    />
  );
}

/**
 * Inline live region. Both a polite and an assertive region are always rendered so
 * screen readers pick up changes no matter which kind of message arrives.
 */
export function InlineStatus(props: { status: StatusMessage | null; id?: string }): JSX.Element {
  const s = props.status;
  const isError = s?.kind === "error";
  const color = isError ? "text-red-700" : s?.kind === "success" ? "text-green-700" : "text-slate-700";
  return (
    <div id={props.id} className={`min-h-5 text-sm ${color}`}>
      <p role="status" aria-live="polite" aria-atomic="true">
        {s && !isError ? s.text : ""}
      </p>
      <p role="alert" aria-live="assertive" aria-atomic="true">
        {s && isError ? s.text : ""}
      </p>
    </div>
  );
}

/** Format an ISO date for display without throwing on bad input. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleString();
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
