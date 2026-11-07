import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VoicePreview } from "@/features/voice/client";
import { PageShell } from "@/shared/ui";

export const metadata: Metadata = { title: "Voice preview" };

/** For design review only, in development only. Removed before the final merge. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PageShell width="wide">
      <VoicePreview />
    </PageShell>
  );
}
