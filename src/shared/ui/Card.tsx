import clsx from "clsx";
import type { HTMLAttributes } from "react";

/** A sheet of paper laid on the page: lighter than the background, with a plain edge. */
export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={clsx(
        "rounded-sheet border border-control-edge bg-sheet p-5 sm:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
