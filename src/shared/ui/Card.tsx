import clsx from "clsx";
import type { HTMLAttributes } from "react";

/** A raised surface on the page: lighter than the background, with a quiet edge. */
export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={clsx(
        "rounded-sheet border border-rule-strong bg-sheet/90 p-5 shadow-panel sm:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
