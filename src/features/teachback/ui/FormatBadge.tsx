import clsx from "clsx";
import { Baby, MessageCircle, ScanSearch, Timer } from "lucide-react";
import { FORMAT_LABELS, type TopicFormat } from "../formats";

const ICONS = { explain: MessageCircle, catch: ScanSearch, kid: Baby, timed: Timer };

/** The way this topic is proved, as a small pill. compact is the map card's short label. */
export function FormatBadge({ format, compact = false, className }: { format: TopicFormat; compact?: boolean; className?: string }) {
  const Icon = ICONS[format];
  const label = FORMAT_LABELS[format];
  return (
    <span
      title={label.name}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-control border border-accent/45 bg-accent/10 leading-none font-medium text-accent-bright",
        compact ? "px-1.5 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className,
      )}
    >
      <Icon aria-hidden="true" size={compact ? 11 : 14} />
      {compact ? (
        <>
          <span aria-hidden="true">{label.short}</span>
          <span className="sr-only">{label.name}</span>
        </>
      ) : (
        label.name
      )}
    </span>
  );
}
