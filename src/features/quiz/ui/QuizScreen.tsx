import { ComingSoon, PageShell } from "@/shared/ui";

export function QuizScreen() {
  return (
    <PageShell width="wide">
      <ComingSoon
        title="Quiz"
        owner="Mirza"
        plan={'Generate a multiple-choice quiz per node, keys 1-4 to answer, and explain every answer.'}
      />
    </PageShell>
  );
}
