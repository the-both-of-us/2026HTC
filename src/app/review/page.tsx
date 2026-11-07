import type { Metadata } from "next";
import { ReviewScreen } from "@/features/review/client";

export const metadata: Metadata = { title: "Review" };

export default function Page() {
  return <ReviewScreen />;
}
