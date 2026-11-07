import type { Metadata } from "next";
import { CoursesScreen } from "@/features/courses";

export const metadata: Metadata = { title: "Course" };

// When this screen becomes real, read `params` behind <Suspense>, as src/app/map/[id]/page.tsx does.
export default function Page() {
  return <CoursesScreen />;
}
