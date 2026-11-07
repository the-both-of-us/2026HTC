import { ComingSoon, PageShell } from "@/shared/ui";

export function FlashcardsScreen() {
  return (
    <PageShell width="wide">
      <ComingSoon
        title="Flashcards"
        owner="Mirza"
        plan={'Generate flashcards per skill node, flip with Space, and hand them to spaced review.'}
      />
    </PageShell>
  );
}
