import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getProof, loadProofPage, ProofScreen } from "@/features/proof";

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

/**
 * src/proxy.ts answers a missing or withdrawn record with a real 404 before this runs. The page
 * still checks, in case the record went between the two reads; that late notFound() can only
 * show the message, because the status was sent with the shell (node_modules/next/dist/docs/
 * 01-app/02-guides/streaming.md, "The HTTP contract"). `instant = false`: the page may block.
 */
export const instant = false;

export default async function ProofPage({ params }: ProofPageProps) {
  await connection();
  const { id } = await params;
  const data = await loadProofPage(id);
  if (data.kind === "gone") notFound();
  return <ProofScreen id={id} data={data} />;
}
