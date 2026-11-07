import { ComingSoon, PageShell } from "@/shared/ui";

export function LabourScreen() {
  return (
    <PageShell width="wide">
      <ComingSoon
        title="Labour"
        owner="Abdu"
        plan={'Live labour market numbers from StatCan for the map and the pitch.'}
      />
    </PageShell>
  );
}
