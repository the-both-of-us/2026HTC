import type { Metadata } from "next";
import { ProofScreen } from "@/features/proof";

export const metadata: Metadata = { title: "Evidence" };

// When this screen becomes real, read `params` behind <Suspense>, as src/app/map/[id]/page.tsx does.
export default function Page() {
  return <ProofScreen />;
}
