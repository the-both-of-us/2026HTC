import { CircleSlash, FileQuestion } from "lucide-react";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { getProof } from "../publish";
import type { ProofRecord } from "../types";
import { formatDateTime } from "./format";
import { ProofDocument } from "./ProofDocument";
import { ProofFrame } from "./ProofFrame";

/** The public page. Anyone with the link can read it, with no account. */
export async function ProofScreen({ id }: { id: string }) {
  let record: ProofRecord | null;
  try {
    record = await getProof(id);
  } catch (error) {
    console.error("[proof] could not read a record", error);
    return (
      <ProofFrame>
        <Notice icon={<FileQuestion size={28} aria-hidden="true" />} title="This record could not be loaded right now">
          Nothing is wrong with the record itself. Please reload the page in a moment.
        </Notice>
      </ProofFrame>
    );
  }

  if (!record) {
    return (
      <ProofFrame>
        <Notice icon={<FileQuestion size={28} aria-hidden="true" />} title="We could not find this evidence record">
          Check that the link is complete, or ask the person who shared it for a new one.
        </Notice>
      </ProofFrame>
    );
  }

  if (record.state === "revoked") {
    return (
      <ProofFrame>
        <Notice icon={<CircleSlash size={28} aria-hidden="true" />} title="This record was withdrawn">
          Its owner took it down on {formatDateTime(record.revokedAt)}, and what it contained has been deleted. Any copy
          you hold is no longer backed by this page.
        </Notice>
      </ProofFrame>
    );
  }

  return (
    <ProofFrame>
      <ProofDocument snapshot={record.snapshot} hash={record.hash} url={await pageUrl(id)} />
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

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-10">
      <span className="text-ink-soft">{icon}</span>
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="max-w-prose text-lg text-ink-soft">{children}</p>
    </div>
  );
}
