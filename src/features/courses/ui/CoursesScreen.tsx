import { ComingSoon, PageShell } from "@/shared/ui";

export function CoursesScreen() {
  return (
    <PageShell width="wide">
      <ComingSoon
        title="Courses"
        owner="Mirza"
        plan={"A public directory: publish a map, browse, like, and start someone else's course."}
      />
    </PageShell>
  );
}
