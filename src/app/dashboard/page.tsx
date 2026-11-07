import type { Metadata } from "next";
import { DashboardScreen } from "@/features/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return <DashboardScreen />;
}
