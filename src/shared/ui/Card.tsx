import clsx from "clsx";
import type { HTMLAttributes } from "react";

/** A raised sheet on the paper: a lighter blank with a plain 1px rule and square corners. */
export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={clsx("rounded-sheet border border-rule-strong bg-sheet p-5 sm:p-6", className)}
    >
      {children}
    </div>
  );
}
