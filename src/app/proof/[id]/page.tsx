import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getProof, ProofLoading, ProofScreen } from "@/features/proof";

type ProofPageProps = { params: Promise<{ id: string }> };

/** Public, but not for search engines: the page is shared by link. */
export async function generateMetadata({ params }: ProofPageProps): Promise<Metadata> {
  // This page is live data, so it must never be prerendered. Without this, the storage
  // client's use of the clock is an error under Cache Components.
  await connection();
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
  await connection();
  const { id } = await params;
  return <ProofScreen id={id} />;
}
