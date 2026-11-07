import type { Metadata } from "next";
import { BattleScreen } from "@/features/battle";

export const metadata: Metadata = { title: "Battle" };

export default function Page() {
  return <BattleScreen />;
}
