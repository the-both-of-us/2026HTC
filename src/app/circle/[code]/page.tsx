import type { Metadata } from "next";
import { Suspense } from "react";
import { CircleScreen } from "@/features/circles/client";
import { PageShell, Spinner } from "@/shared/ui";

export const metadata: Metadata = { title: "Study circle" };

type CirclePageProps = { params: Promise<{ code: string }> };

/** The code is only known at request time, so reading it waits behind Suspense. The screen polls its own API. */
export default function CirclePage({ params }: CirclePageProps) {
  return (
    <Suspense
      fallback={
        <PageShell width="reading">
          <p role="status" className="flex items-center gap-3 text-ink-soft">
            <Spinner size={18} /> Loading the circle.
          </p>
        </PageShell>
      }
    >
      <CircleFromRoute params={params} />
    </Suspense>
  );
}

async function CircleFromRoute({ params }: CirclePageProps) {
  const { code } = await params;
  return <CircleScreen code={code} />;
}
