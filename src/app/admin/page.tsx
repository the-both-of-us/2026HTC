import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { ADMIN_COOKIE, isAdminConfigured, isAdminToken, loadAdminOverview } from "@/features/admin";
import { AdminLogin, AdminScreen } from "@/features/admin/client";
import { ErrorNotice, PageShell, Spinner } from "@/shared/ui";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/** Passcode first; the data is only read once the signed admin cookie checks out. */
export default function AdminPage() {
  return (
    <PageShell>
      <Suspense fallback={<Spinner label="Loading" />}>
        <AdminGate />
      </Suspense>
    </PageShell>
  );
}

async function AdminGate() {
  await connection();
  if (!isAdminConfigured()) {
    return <p className="text-ink-soft">Admin is not set up on this server.</p>;
  }
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!isAdminToken(token)) return <AdminLogin />;
  const overview = await loadAdminOverview().catch((error: unknown) => {
    console.error("[admin] overview failed:", error);
    return null;
  });
  if (!overview) return <ErrorNotice message="The store could not be read just now. Refresh to try again." />;
  return <AdminScreen overview={overview} />;
}
