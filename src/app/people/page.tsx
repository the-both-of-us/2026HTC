import type { Metadata } from "next";
import { NetworkScreen } from "@/features/network";

export const metadata: Metadata = { title: "People" };

export default function Page() {
  return <NetworkScreen />;
}
