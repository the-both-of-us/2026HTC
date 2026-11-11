import type { Metadata } from "next";
import { SettingsScreen } from "@/features/settings";

export const metadata: Metadata = {
  title: "Settings",
  description: "Appearance, accessibility, and friends and privacy.",
};

export default function SettingsPage() {
  return <SettingsScreen />;
}
