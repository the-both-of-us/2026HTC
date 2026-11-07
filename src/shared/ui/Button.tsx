import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "secondary" | "subtle" | "quiet";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-forest text-on-dark border-forest hover:bg-forest-deep hover:border-forest-deep",
  secondary: "bg-transparent text-ink border-ink hover:bg-sheet",
  subtle:
    "bg-sheet text-ink border-control-edge hover:border-ink aria-pressed:bg-highlight aria-pressed:border-ink",
  quiet:
    "bg-transparent text-ink border-transparent underline underline-offset-4 decoration-1 hover:decoration-2",
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
    "inline-flex items-center justify-center gap-2.5 rounded-control border-2 font-semibold",
    "cursor-pointer transition-control",
    "aria-disabled:cursor-not-allowed disabled:cursor-not-allowed disabled:opacity-60",
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
