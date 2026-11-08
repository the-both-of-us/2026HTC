import type { Metadata } from "next";
import { Suspense } from "react";
import { InviteScreen } from "@/features/network/client";
import { PageShell, Spinner } from "@/shared/ui";

export const metadata: Metadata = { title: "Friend invite" };

type InvitePageProps = { params: Promise<{ code: string }> };

/** The code is only known at request time, so reading it waits behind Suspense, as on the circle page. */
export default function InvitePage({ params }: InvitePageProps) {
  return (
    <Suspense
      fallback={
        <PageShell width="reading">
          <p role="status" className="flex items-center gap-3 text-ink-soft">
            <Spinner size={18} /> Loading the invite.
          </p>
        </PageShell>
      }
    >
      <InviteFromRoute params={params} />
    </Suspense>
  );
}

async function InviteFromRoute({ params }: InvitePageProps) {
  const { code } = await params;
  return <InviteScreen code={code} />;
}
