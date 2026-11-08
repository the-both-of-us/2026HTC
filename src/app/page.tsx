import { Suspense } from "react";
import { LandingFigures, LandingFiguresSource, PostingForm } from "@/features/landing";
import { HowItWorksButton } from "@/features/landing/client";
import { PageShell } from "@/shared/ui";

export default function Home() {
  return (
    <PageShell
      width="full"
      footer={
        <Suspense fallback={null}>
          <LandingFiguresSource />
        </Suspense>
      }
    >
      <PostingForm
        figures={
          <Suspense fallback={null}>
            <LandingFigures />
          </Suspense>
        }
      >
        <h1 className="text-[clamp(2.5rem,11.4vw,4rem)] leading-[1.02] font-bold lg:text-[clamp(2.875rem,5.1vw,4.625rem)]">
          Learn it, then prove it.
        </h1>
        <p className="max-w-[54ch] text-[1.0625rem] leading-[1.45] text-ink-soft lg:text-lg">
          Name a topic, upload your notes or paste a job posting. OryxLearn maps it into small topics: read a short
          lesson, explain it in your own words, and learn it with friends in a study circle.
        </p>
        <HowItWorksButton className="self-start" />
      </PostingForm>
    </PageShell>
  );
}
