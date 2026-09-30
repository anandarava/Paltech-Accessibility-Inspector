import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/* All colour pairs are >= 4.5:1 against their background. */
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-400 disabled:text-white",
  secondary: "bg-white text-slate-800 border border-slate-500 hover:bg-slate-100 disabled:text-slate-500 disabled:border-slate-300",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-400",
  ghost: "bg-transparent text-blue-800 hover:bg-blue-50 disabled:text-slate-500",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function Button({ variant = "secondary", size = "md", className = "", type = "button", children, ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1 rounded font-medium whitespace-nowrap disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
