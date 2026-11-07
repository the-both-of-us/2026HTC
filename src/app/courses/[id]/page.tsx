import type { Metadata } from "next";
import { Suspense } from "react";
import { CourseScreen, CourseScreenLoading } from "@/features/courses/client";

export const metadata: Metadata = { title: "Course" };

type CoursePageProps = { params: Promise<{ id: string }> };

/** The id is only known at request time, so reading it waits behind Suspense. */
export default function CoursePage({ params }: CoursePageProps) {
  return (
    <Suspense fallback={<CourseScreenLoading />}>
      <CourseFromRoute params={params} />
    </Suspense>
  );
}

async function CourseFromRoute({ params }: CoursePageProps) {
  const { id } = await params;
  return <CourseScreen mapId={id} />;
}
