import type { Metadata } from "next";
import { NetworkScreen } from "@/features/network/client";

export const metadata: Metadata = { title: "Network" };

export default function Page() {
  return <NetworkScreen />;
}
