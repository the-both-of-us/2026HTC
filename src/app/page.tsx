import { Suspense } from "react";
import { LiveLabourCard } from "@/features/labour";
import { PostingForm } from "@/features/landing";
import { PageShell } from "@/shared/ui";

export default function Home() {
  return (
    <PageShell width="reading">
      <div className="flex flex-col gap-5">
        <h1 className="text-3xl font-bold sm:text-4xl">Build your learning path.</h1>
        <p className="text-lg text-ink-soft">
          Paste a job posting and get an interactive skill map. Explain each skill in your own
          words, answer a follow-up, and share the proof.
        </p>
        <PostingForm />
        <Suspense fallback={null}>
          <LiveLabourCard />
        </Suspense>
      </div>
    </PageShell>
  );
}
