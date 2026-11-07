import clsx from "clsx";
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
        "flex flex-col items-start gap-3 rounded-control border-2 border-danger bg-danger-surface p-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-base text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="shrink-0">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
