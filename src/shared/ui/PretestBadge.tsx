import clsx from "clsx";
import { Check } from "lucide-react";
import { PRETEST_PROOF_LABEL } from "@/shared/types";

/**
 * The mark for a topic proved by a pre-test question. It is not an explanation, so it is worded as
 * what it is, "Known (pre-test)", with the full label in the tooltip and for screen readers.
 * Dashed, like the other "not the full thing" marks.
 */
export function PretestBadge({ className, prefix }: { className?: string; prefix?: string }) {
  return (
    <span
      title={PRETEST_PROOF_LABEL}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-control border border-dashed border-ink-soft px-1.5 py-0.5 text-xs leading-none font-medium text-ink",
        className,
      )}
    >
      <Check aria-hidden="true" size={11} />
      {prefix}
      <span aria-hidden="true">Known (pre-test)</span>
      <span className="sr-only">{PRETEST_PROOF_LABEL}</span>
    </span>
  );
}
