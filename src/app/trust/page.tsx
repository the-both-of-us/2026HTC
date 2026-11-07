import type { Metadata } from "next";
import { TrustScreen } from "@/features/trust";

export const metadata: Metadata = {
  title: "Trust and your data",
  description: "What OryxLearn stores, what the AI decides and what code checks, what a proof shows, and how to delete your data.",
};

export default function TrustPage() {
  return <TrustScreen />;
}
