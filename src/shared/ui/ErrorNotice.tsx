import clsx from "clsx";
import { CircleAlert } from "lucide-react";
import { Button } from "./Button";

type ErrorNoticeProps = {
  /** A plain sentence: what went wrong, and what the person can do. Never a raw error. */
  message: string;
  /** Leave this out when trying again cannot help. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
};

export function ErrorNotice({
  message,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorNoticeProps) {
  return (
    <div
      role="alert"
      className={clsx(
        "flex flex-col items-start gap-3 rounded-control border border-danger/70 bg-danger-surface p-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="flex items-start gap-2.5 text-base text-ink">
        <CircleAlert aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-danger" />
        {message}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="shrink-0">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
