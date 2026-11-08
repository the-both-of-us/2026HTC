import type { Metadata } from "next";
import { FeedScreen } from "@/features/feed/client";

export const metadata: Metadata = { title: "FYP" };

export default function Page() {
  return <FeedScreen />;
}
