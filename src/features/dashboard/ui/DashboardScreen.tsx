import { ComingSoon, PageShell } from "@/shared/ui";

export function DashboardScreen() {
  return (
    <PageShell width="wide">
      <ComingSoon
        title="Dashboard"
        owner="Mirza"
        plan={"Your maps, what's proven, what's due, and your streak."}
      />
    </PageShell>
  );
}
