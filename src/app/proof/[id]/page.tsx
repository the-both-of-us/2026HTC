import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProofLoading, ProofScreen } from "@/features/proof";

export const metadata: Metadata = {
  title: "Evidence",
  description: "Skills proven on OryxLearn, with the learner's own words and how they were checked.",
  robots: { index: false },
};

type ProofPageProps = { params: Promise<{ id: string }> };

/** The id and cookie are only known at request time, so reading them waits behind Suspense. */
export default function ProofPage({ params }: ProofPageProps) {
  return (
    <Suspense fallback={<ProofLoading />}>
      <ProofFromRoute params={params} />
    </Suspense>
  );
}

async function ProofFromRoute({ params }: ProofPageProps) {
  // This page is live data, so it must never be prerendered. Without this, the storage
  // client's use of the clock is an error under Cache Components.
  await connection();
  const { id } = await params;
  return <ProofScreen mapId={id} />;
}
