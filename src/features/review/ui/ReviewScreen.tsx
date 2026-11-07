import { ComingSoon, PageShell } from "@/shared/ui";

export function ReviewScreen() {
  return (
    <PageShell width="wide">
      <ComingSoon
        title="Review"
        owner="Mirza"
        plan={'A spaced repetition queue of due flashcards using SM-2, written new.'}
      />
    </PageShell>
  );
}
