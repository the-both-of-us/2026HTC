import type { Metadata } from "next";
import { CircleScreen } from "@/features/circles/client";

export const metadata: Metadata = { title: "Study circle" };

/** A study circle. The page polls its own API, so nothing here reads data at request time. */
export default async function CirclePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <CircleScreen code={code} />;
}
