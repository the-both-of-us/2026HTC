import { Sparkles } from "lucide-react";
import { PostingForm } from "@/features/landing";
import { PageShell } from "@/shared/ui";

export default function Home() {
  return (
    <PageShell width="wide">
      <div className="mx-auto w-full max-w-5xl">
        <PostingForm>
          <p className="inline-flex items-center gap-1.5 self-start rounded-full border border-accent/45 bg-accent/10 px-2.5 py-1 text-sm text-accent-bright">
            <Sparkles aria-hidden="true" size={14} />
            AI-built skill maps
          </p>
          <h1 className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">
            Turn any job posting into a skill map
          </h1>
          <p className="max-w-2xl text-lg text-ink-soft">
            Paste a posting and OryxLearn lays out the skills it asks for. Explain each one in your
            own words, answer a follow-up, and share the proof.
          </p>
        </PostingForm>
      </div>
    </PageShell>
  );
}
