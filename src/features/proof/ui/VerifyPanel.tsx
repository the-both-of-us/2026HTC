"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, ErrorNotice } from "@/shared/ui";
import { sha256InBrowser, verifyProof, type VerifyReply } from "./api";

type CheckedRecord = {
  reply: Extract<VerifyReply, { state: "live" }>;
  /** Null when this browser cannot hash (plain http). */
  browserHash: string | null;
  checkedAt: string;
};

type VerifyPanelProps = { proofId: string; fingerprint: string };

/** Runs the check live, on the server and again in the reader's own browser. */
export function VerifyPanel({ proofId, fingerprint }: VerifyPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<CheckedRecord | null>(null);
  const [revoked, setRevoked] = useState(false);

  async function runCheck() {
    setPending(true);
    setError(null);
    try {
      const reply = await verifyProof(proofId);
      if (reply.state === "revoked") {
        setRevoked(true);
        setChecked(null);
        return;
      }
      setChecked({
        reply,
        browserHash: reply.canonical ? await sha256InBrowser(reply.canonical) : null,
        checkedAt: new Date().toLocaleTimeString("en-CA", { timeStyle: "short" }),
      });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The check could not run. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 print:hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="primary" pending={pending} onClick={runCheck}>
          {checked ? "Check again" : "Check this record now"}
        </Button>
        <a
          href={`/api/proof/${proofId}/verify`}
          className="text-sm text-ink-soft underline decoration-1 underline-offset-4 hover:decoration-2"
        >
          See the raw check
        </a>
      </div>

      <div aria-live="polite" className="flex flex-col gap-4">
        {error && <ErrorNotice message={error} onRetry={runCheck} />}
        {revoked && <p>The owner has withdrawn this record. Reload the page to see the notice.</p>}
        {checked && <CheckResults checked={checked} fingerprint={fingerprint} />}
      </div>
    </div>
  );
}

function CheckResults({ checked, fingerprint }: { checked: CheckedRecord; fingerprint: string }) {
  const { reply, browserHash, checkedAt } = checked;
  const hashOk = reply.hashMatches && reply.recomputedHash === fingerprint && (browserHash ?? fingerprint) === fingerprint;
  const quotesOk = reply.quotes.verified === reply.quotes.total;
  const scoresOk = reply.scores.matching === reply.scores.total;

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2.5">
        <ResultLine ok={hashOk}>
          {hashOk
            ? browserHash
              ? "This record matches the fingerprint shown here. It was recalculated on our server, then again in your browser."
              : "This record matches the fingerprint shown here. It was recalculated on our server."
            : "This record does not match its fingerprint. It has changed since it was published."}
        </ResultLine>
        {reply.sealMatches !== null && (
          <ResultLine ok={reply.sealMatches}>
            {reply.sealMatches
              ? "The server's seal matches. It needs a key kept outside the data store, so editing the store alone would break it."
              : "The server's seal does not match. This record was changed outside OryxLearn's publishing step."}
          </ResultLine>
        )}
        <ResultLine ok={quotesOk}>
          {reply.quotes.verified} of {reply.quotes.total} quotes found word for word in what this person wrote.
        </ResultLine>
        <ResultLine ok={scoresOk}>
          {reply.scores.matching} of {reply.scores.total} scores recalculated from the checkpoints and matched.
        </ResultLine>
      </ul>
      <p className="text-sm text-ink-soft">
        Checked at {checkedAt}, by code, with no AI involved. To be sure nothing changed since you first saw this record,
        compare the fingerprint with your saved copy. The owner can update their page, which makes a new fingerprint and
        keeps no history.
      </p>
      {browserHash && reply.canonical && <OneCharacterDemo canonical={reply.canonical} fingerprint={fingerprint} />}
    </div>
  );
}

function ResultLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      {ok ? (
        <Check size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-proven" />
      ) : (
        <TriangleAlert size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
      )}
      <span>{children}</span>
    </li>
  );
}

/** Shows, in the reader's browser, what one altered number would do to the fingerprint. */
function OneCharacterDemo({ canonical, fingerprint }: { canonical: string; fingerprint: string }) {
  const [altered, setAltered] = useState<{ from: number; to: number; hash: string | null } | null>(null);

  async function run() {
    const match = /"score":(\d+)/.exec(canonical);
    if (!match) return;
    const from = Number(match[1]);
    const to = from === 100 ? 99 : from + 1;
    const hash = await sha256InBrowser(canonical.replace(match[0], `"score":${to}`));
    setAltered({ from, to, hash });
  }

  if (!altered) {
    return (
      <div>
        <Button variant="subtle" size="sm" onClick={run}>
          See what changing one score would do
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-control border border-rule p-4">
      <p>
        If someone changed one score from {altered.from} to {altered.to}, the fingerprint would become:
      </p>
      <p className="mt-2 font-mono text-sm break-all text-danger">{altered.hash}</p>
      <p className="mt-2 text-sm text-ink-soft">
        {altered.hash === fingerprint ? "" : "It no longer matches the one above. "}
        This ran only in your browser, and the record itself was not touched.
      </p>
    </div>
  );
}
