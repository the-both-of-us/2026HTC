import type { Metadata } from "next";
import { BattleScreen } from "@/features/battle";

export const metadata: Metadata = { title: "Battle" };

// When this screen becomes real, read `params` behind <Suspense>, as src/app/map/[id]/page.tsx does.
export default function Page() {
  return <BattleScreen />;
}
