import type { Metadata } from "next";
import { GridScreen } from "@/features/grid";

export const metadata: Metadata = {
  title: "Read the Grid",
  description: "Learn to read Alberta's power grid from AESO's live supply and demand report.",
};

export default function Page() {
  return <GridScreen />;
}
