import type { Metadata } from "next";
import { CoursesScreen } from "@/features/courses/client";

export const metadata: Metadata = { title: "Courses" };

export default function Page() {
  return <CoursesScreen />;
}
