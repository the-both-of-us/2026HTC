import type { Metadata } from "next";
import { SettingsScreen } from "@/features/settings";

export const metadata: Metadata = {
  title: "Settings",
  description: "Appearance, accessibility, and which AI models write and check your courses.",
};

export default function SettingsPage() {
  return <SettingsScreen />;
}
