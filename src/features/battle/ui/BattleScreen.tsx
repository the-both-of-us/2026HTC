import { ComingSoon, PageShell } from "@/shared/ui";

export function BattleScreen() {
  return (
    <PageShell width="wide">
      <ComingSoon
        title="Battle"
        owner="Mirza"
        plan={'Scan a QR code and play a live quiz battle against someone at the table.'}
      />
    </PageShell>
  );
}
