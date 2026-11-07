import type { ProofSnapshot } from "../types";
import { formatDateTime, metCount } from "./format";
import { ProofQr } from "./ProofQr";

type PrintSummaryProps = { snapshot: ProofSnapshot; hash: string; url: string };

/** The paper version: one page, with the QR code leading back to the full transcripts. */
export function PrintSummary({ snapshot, hash, url }: PrintSummaryProps) {
  return (
    <div className="hidden print:block">
      <header className="flex items-start justify-between gap-6 border-b border-rule pb-3">
        <div>
          <p className="font-semibold">OryxLearn evidence record</p>
          <h1 className="mt-1 text-[22pt] leading-tight font-bold">{snapshot.displayName}</h1>
          <p className="mt-0.5">
            {snapshot.roleTitle}
            {snapshot.roleSubtitle ? `, ${snapshot.roleSubtitle}` : ""}
          </p>
          <p className="mt-2 text-[14pt] font-bold">
            {snapshot.skills.length} of {snapshot.totalSkills} skills proven
          </p>
          <p className="text-ink-soft">Published {formatDateTime(snapshot.publishedAt)}</p>
        </div>
        <div className="shrink-0 text-center">
          <ProofQr url={url} size={96} />
          <p className="mt-1 text-[8pt] text-ink-soft">Scan for the full record</p>
        </div>
      </header>

      <table className="mt-3 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-control-edge">
            <th scope="col" className="py-1 pr-3 font-semibold">
              Skill, with their own words
            </th>
            <th scope="col" className="py-1 pr-3 font-semibold whitespace-nowrap">
              Checkpoints
            </th>
            <th scope="col" className="py-1 text-right font-semibold">
              Score
            </th>
          </tr>
        </thead>
        <tbody>
          {snapshot.skills.map((skill) => {
            const quote = skill.checkpoints.find((result) => result.quote)?.quote;
            return (
              <tr key={skill.nodeId} className="break-inside-avoid border-b border-rule align-top">
                <td className="py-1 pr-3">
                  <span className="font-semibold">{skill.title}</span>
                  {quote && <span className="line-clamp-1 text-[9pt] text-ink-soft">“{quote}”</span>}
                </td>
                <td className="py-1 pr-3 whitespace-nowrap">
                  {metCount(skill)} of {skill.checkpoints.length}, follow-up passed
                </td>
                <td className="py-1 text-right font-bold tabular-nums">{skill.score}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {snapshot.notYetProven.length > 0 && (
        <p className="mt-2 text-[9pt] text-ink-soft">
          <span className="font-semibold">Not yet proven:</span> {snapshot.notYetProven.join(", ")}.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-5 text-[9pt]">
        <div>
          <p className="font-semibold">How this was checked</p>
          <p>
            AI picked an exact quote for each checkpoint. Code confirmed each quote is in their text and computed the
            score. AI wrote and judged one live follow-up question about their own answer.
          </p>
        </div>
        <div>
          <p className="font-semibold">What it does not show</p>
          <p>
            It was not proctored, so it cannot rule out outside help. The name was typed by the person and is not a
            checked identity. This is not an accredited credential.
          </p>
        </div>
      </div>

      <div className="mt-3 border-t border-rule pt-2 text-[8pt] text-ink-soft">
        <p>
          SHA-256 fingerprint, calculated from every word of this record. If the online record ever changes, it will
          stop matching this one:
        </p>
        <p className="mt-0.5 font-mono text-[8pt] break-all text-ink">{hash}</p>
        <p className="mt-0.5 break-all">{url}</p>
      </div>
    </div>
  );
}
