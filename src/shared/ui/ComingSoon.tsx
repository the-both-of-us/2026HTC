type ComingSoonProps = {
  title: string;
  owner: string;
  plan: string;
};

/** Placeholder for a skeleton screen. Delete it from a page once the real screen exists. */
export function ComingSoon({ title, owner, plan }: ComingSoonProps) {
  return (
    <div className="flex flex-col gap-3 rounded-sheet border border-rule bg-sheet p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-ink-soft">{plan}</p>
      <p className="text-sm text-ink-soft">Not built yet. Owner: {owner}.</p>
    </div>
  );
}
