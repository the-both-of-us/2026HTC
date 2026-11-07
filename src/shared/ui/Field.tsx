import clsx from "clsx";
import type { ReactNode, TextareaHTMLAttributes } from "react";

/** Props Field hands to its input, so the label, hint and error are all connected. */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

type FieldProps = {
  /** Used as the input's id, and to link the hint and error to it. */
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/**
 * A label, optional hint, an input and an optional error, linked for screen readers.
 *
 *   <Field id="posting" label="Job posting" error={error}>
 *     {(control) => <Textarea {...control} value={text} onChange={...} />}
 *   </Field>
 */
export function Field({ id, label, hint, error, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-base font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-soft">
          {hint}
        </p>
      )}
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error && (
        <p id={errorId} className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      className={clsx(
        "block w-full resize-y rounded-control border border-control-edge bg-paper/70 px-3.5 py-2.5 text-base leading-7 text-ink transition-control",
        "placeholder:text-ink-soft hover:border-ink-soft focus:border-accent-bright focus:shadow-glow aria-invalid:border-danger read-only:text-ink-soft",
        className,
      )}
    />
  );
}
