import { ComingSoon, PageShell } from "@/shared/ui";

export function GridScreen() {
  return (
    <PageShell width="wide">
      <ComingSoon
        title="Grid"
        owner="Abdu"
        plan={'Exercises built from live AESO supply and demand data, with numbers computed in code.'}
      />
    </PageShell>
  );
}
