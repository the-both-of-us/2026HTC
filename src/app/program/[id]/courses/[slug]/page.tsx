import type { Metadata } from "next";
import { Suspense } from "react";
import { SyllabusScreen } from "@/features/programs/client";
import { PageShell, Spinner } from "@/shared/ui";

export const metadata: Metadata = { title: "Syllabus" };

type SyllabusPageProps = { params: Promise<{ id: string; slug: string }> };

/** The syllabus loads in the browser from its route, which checks that the program is the viewer's. */
export default function SyllabusPage({ params }: SyllabusPageProps) {
  return (
    <Suspense
      fallback={
        <PageShell width="reading">
          <p role="status" className="flex items-center gap-2.5 text-ink-soft">
            <Spinner size={16} />
            Loading the syllabus.
          </p>
        </PageShell>
      }
    >
      <SyllabusFromRoute params={params} />
    </Suspense>
  );
}

async function SyllabusFromRoute({ params }: SyllabusPageProps) {
  const { id, slug } = await params;
  return <SyllabusScreen programId={id} slug={slug} />;
}
