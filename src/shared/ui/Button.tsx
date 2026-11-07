import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "secondary" | "subtle" | "quiet";
type ButtonSize = "sm" | "md" | "lg";

// Seal: buttons press in like a die. Primary is solid ink on a hard 2px shadow; secondary is
// an ink outline that fills on hover; quiet is an underlined word.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-dark shadow-press hover:bg-accent-bright active:translate-y-0.5 active:shadow-none",
  secondary:
    "bg-transparent text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)] hover:bg-ink hover:text-on-ink active:translate-y-px",
  subtle:
    "bg-sheet text-ink shadow-[inset_0_0_0_1.5px_var(--color-rule-strong)] hover:shadow-[inset_0_0_0_1.5px_var(--color-ink)] aria-pressed:bg-ink aria-pressed:text-on-ink",
  quiet:
    "bg-transparent text-ink underline decoration-[1.5px] underline-offset-4 hover:decoration-[3px]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3 text-sm",
  md: "min-h-[2.875rem] px-5 text-base",
  lg: "min-h-13 px-6 text-[1.0625rem]",
};

/** The button's look as a class string, so a <Link> can look like a button too. */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
) {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-control text-center leading-tight font-semibold font-stretch-[108%]",
    "cursor-pointer transition-control",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-70 disabled:cursor-not-allowed disabled:opacity-60",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    // A quiet button is a word, so it keeps only a sliver of padding.
    variant === "quiet" && "px-0.5!",
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
