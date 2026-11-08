import { ArrowLeft, CircleSlash, FileQuestion } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { readUserId } from "@/shared/identity";
import { loadProofPage, type ProofPageData } from "../page";
import { toPublicSnapshot } from "../redact";
import { formatDateTime } from "./format";
import { ProofDocument } from "./ProofDocument";
import { ProofFrame } from "./ProofFrame";

/**
 * The public page. Anyone with the link can read it, with no account. The route loads `data`
 * first (so a missing record is a real 404); without it, the screen loads the record itself.
 */
export async function ProofScreen({ id, data }: { id: string; data?: ProofPageData }) {
  const page = data ?? (await loadProofPage(id));
  if (page.kind === "unreadable") {
    return (
      <ProofFrame>
        <Notice icon={<FileQuestion size={28} aria-hidden="true" />} title="This record could not be loaded right now">
          Nothing is wrong with the record itself. Please reload the page in a moment.
        </Notice>
      </ProofFrame>
    );
  }

  if (page.kind === "gone") return <ProofNotFound />;

  const { record } = page;
  const backLink = (await readUserId()) === record.ownerId && <BackToMap mapId={record.mapId} />;

  if (record.state === "revoked") {
    return (
      <ProofFrame>
        {backLink}
        <Notice icon={<CircleSlash size={28} aria-hidden="true" />} title="This record was withdrawn">
          Its owner took it down on {formatDateTime(record.revokedAt)}, and the public copy has been removed. Any copy
          you hold is no longer backed by this page.
        </Notice>
      </ProofFrame>
    );
  }

  return (
    <ProofFrame>
      {backLink}
      <ProofDocument snapshot={toPublicSnapshot(record.snapshot)} hash={record.hash} url={await pageUrl(id)} />
    </ProofFrame>
  );
}

/**
 * No such record, or one its owner withdrew. src/proxy.ts sends those to /proof/gone, whose 404
 * shows this through the app's not-found page, with the more general title.
 */
export function ProofNotFound({ title = "We could not find this evidence record" }: { title?: string }) {
  return (
    <ProofFrame>
      <Notice icon={<FileQuestion size={28} aria-hidden="true" />} title={title}>
        Check that the link is complete. An evidence record also disappears when its owner withdraws it, so ask the
        person who shared it for a new link.
      </Notice>
    </ProofFrame>
  );
}

/** The address the reader used, so the QR code works on whichever domain they are on. */
async function pageUrl(id: string): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}/proof/${id}`;
}

/** Only the person who published the page gets this, so a visitor is never sent to a private map. */
function BackToMap({ mapId }: { mapId: string }) {
  return (
    <Link
      href={`/map/${mapId}`}
      className="mb-4 flex min-h-11 w-fit items-center gap-2 text-ink-soft transition-control hover:text-ink print:hidden"
    >
      <ArrowLeft aria-hidden="true" size={17} />
      Back to your map
    </Link>
  );
}

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-10">
      <span className="text-ink-soft">{icon}</span>
      <h1 className="text-3xl font-medium">{title}</h1>
      <p className="max-w-prose text-lg text-ink-soft">{children}</p>
    </div>
  );
}
