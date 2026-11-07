import type { Metadata } from "next";
import { Suspense } from "react";
import { getProof, ProofLoading, ProofScreen } from "@/features/proof";

type ProofPageProps = { params: Promise<{ id: string }> };

/** Public, but not for search engines: the page is shared by link. */
export async function generateMetadata({ params }: ProofPageProps): Promise<Metadata> {
  const { id } = await params;
  const robots = { index: false, follow: false };

  const record = await getProof(id).catch(() => null);
  if (record?.state !== "live") return { title: "Evidence record", robots };

  const { displayName, roleTitle, skills, totalSkills } = record.snapshot;
  return {
    title: `${displayName}: evidence for ${roleTitle}`,
    description: `${skills.length} of ${totalSkills} skills proven. Read what they wrote and how it was checked.`,
    robots,
  };
}

/** The id and the record are only known at request time, so they wait behind Suspense. */
export default function ProofPage({ params }: ProofPageProps) {
  return (
    <Suspense fallback={<ProofLoading />}>
      <ProofFromRoute params={params} />
    </Suspense>
  );
}

async function ProofFromRoute({ params }: ProofPageProps) {
  const { id } = await params;
  return <ProofScreen id={id} />;
}
