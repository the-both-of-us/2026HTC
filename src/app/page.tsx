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
          Prove the skills a job asks for.
        </h1>
        <p className="max-w-[54ch] text-[1.0625rem] leading-[1.45] text-ink-soft lg:text-lg">
          Paste a posting and OryxLearn lays out what it needs. Explain each skill in your own words, answer one live
          question, and share a record an employer can check.
        </p>
        <HowItWorksButton className="self-start" />
      </PostingForm>
    </PageShell>
  );
}
