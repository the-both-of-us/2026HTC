import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "secondary" | "subtle" | "quiet";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-dark border-accent hover:bg-accent-bright hover:border-accent-bright hover:shadow-glow",
  secondary: "bg-transparent text-ink border-control-edge hover:border-ink hover:bg-raised",
  subtle:
    "bg-raised/70 text-ink border-rule-strong hover:border-control-edge hover:bg-raised aria-pressed:bg-accent/15 aria-pressed:border-accent/60",
  quiet:
    "bg-transparent text-ink-soft border-transparent hover:text-ink hover:bg-raised",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3 text-sm",
  md: "min-h-11 px-4 text-base",
  lg: "min-h-13 px-6 text-lg",
};

/** The button's look as a class string, so a <Link> can look like a button too. */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
) {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-control border font-medium",
    "cursor-pointer transition-control",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-70 disabled:cursor-not-allowed disabled:opacity-60",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and ignores clicks, but keeps keyboard focus on the button. */
  pending?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  type = "button",
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      // While pending a submit button becomes a plain button, so it cannot submit twice.
      type={pending ? "button" : type}
      aria-disabled={pending || undefined}
      onClick={pending ? undefined : onClick}
      className={clsx(buttonClasses(variant, size), className)}
    >
      {pending && <Spinner size={18} />}
      {children}
    </button>
  );
}
