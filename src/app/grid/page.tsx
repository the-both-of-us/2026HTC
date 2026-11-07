import type { Metadata } from "next";
import { GridScreen } from "@/features/grid";

export const metadata: Metadata = { title: "Grid" };

export default function Page() {
  return <GridScreen />;
}
