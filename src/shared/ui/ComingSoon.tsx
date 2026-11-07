import { Hourglass } from "lucide-react";

type ComingSoonProps = {
  title: string;
  /** Still accepted so existing screens compile. It is never shown to visitors. */
  owner?: string;
  plan: string;
};

/** Placeholder for a skeleton screen. Delete it from a page once the real screen exists. */
export function ComingSoon({ title, plan }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-sheet border border-rule-strong bg-sheet/90 px-6 py-14 text-center shadow-panel">
      <span className="flex size-12 items-center justify-center rounded-control border border-accent/40 bg-accent/10 text-accent-bright">
        <Hourglass aria-hidden="true" size={22} />
      </span>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="max-w-prose text-ink-soft">{plan}</p>
    </div>
  );
}
