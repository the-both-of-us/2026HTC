import { CircleCheck, CircleMinus, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { PASS_SCORE, STRONG_SCORE } from "@/shared/types";
import type { ProofSnapshot } from "../types";
import { DocumentActions } from "./DocumentActions";
import { GridEvidence } from "./GridEvidence";
import { formatDateTime, plural, roleLead } from "./format";
import { PrintSummary } from "./PrintSummary";
import { ProofQr } from "./ProofQr";
import { SkillEvidence } from "./SkillEvidence";
import { VerifyPanel } from "./VerifyPanel";

type ProofDocumentProps = { snapshot: ProofSnapshot; hash: string; url: string };

/** The whole evidence record, as a reader sees it. Everything comes from the frozen snapshot. */
export function ProofDocument({ snapshot, hash, url }: ProofDocumentProps) {
  return (
    <>
      <PrintSummary snapshot={snapshot} hash={hash} url={url} />

      <div className="flex flex-col gap-10 print:hidden">
        <Summary snapshot={snapshot} url={url} />

        <section aria-labelledby="skills-heading" className="flex flex-col gap-5">
          <div>
            <h2 id="skills-heading" className="text-2xl font-medium">
              The evidence
            </h2>
            <p className="mt-1 text-ink-soft">
              Each skill says how it was proved. For an explanation, {snapshot.displayName} then answered a question
              about it, and highlights mark the exact words that met a checkpoint. For a caught mistake, the AI wrote
              the explanation and they found and fixed what it got wrong.
            </p>
          </div>
          {snapshot.skills.map((skill) => (
            <SkillEvidence key={skill.nodeId} skill={skill} />
          ))}
        </section>

        {snapshot.grid && <GridEvidence solves={snapshot.grid} displayName={snapshot.displayName} />}
        <ProvesAndDoesNot />
        <HowChecked />
        <Fingerprint proofId={snapshot.proofId} hash={hash} />
      </div>
    </>
  );
}

function Summary({ snapshot, url }: { snapshot: ProofSnapshot; url: string }) {
  const proven = snapshot.skills.length;

  return (
    <section aria-labelledby="person-name" className="flex flex-col gap-6">
      <div>
        <h1 id="person-name" className="text-4xl font-medium tracking-tight break-words sm:text-5xl">
          {snapshot.displayName}
        </h1>
        <p className="mt-3 text-lg text-ink-soft">
          {roleLead(snapshot.sourceKind)} <span className="font-semibold text-ink">{snapshot.roleTitle}</span>
          {snapshot.roleSubtitle ? `, ${snapshot.roleSubtitle}` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-6 rounded-sheet border border-control-edge bg-sheet p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-5xl font-medium text-proven tabular-nums">{proven}</span>
            <span className="text-2xl font-semibold">of {plural(snapshot.totalSkills, "skill")} proven</span>
          </p>
          <div aria-hidden="true" className="mt-4 flex gap-1">
            {Array.from({ length: snapshot.totalSkills }, (_, index) => (
              <span key={index} className={`h-2 flex-1 rounded-full ${index < proven ? "bg-proven" : "bg-rule"}`} />
            ))}
          </div>

          <ul className="mt-5 flex flex-col gap-1.5">
            {snapshot.skills.map((skill) => (
              <li key={skill.nodeId}>
                <a
                  href={`#skill-${skill.nodeId}`}
                  className="flex min-h-8 items-start gap-2 underline-offset-4 hover:underline"
                >
                  <CircleCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-proven" />
                  <span className="min-w-0 flex-1">{skill.title}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{skill.score}</span>
                </a>
              </li>
            ))}
          </ul>

          {snapshot.finalInterview && (
            <p className="mt-5 flex items-start gap-3 rounded-control border border-amber/50 bg-amber/10 p-3">
              <Trophy size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-amber" />
              <span>
                <span className="font-semibold">Course badge.</span> Passed the final interview: three questions mixing
                these skills, written by the AI after every skill was proven. {snapshot.finalInterview.passedCount} of 3
                passed{snapshot.finalInterview.spokenCount > 0 ? `, ${snapshot.finalInterview.spokenCount} answered aloud` : ""}.
              </span>
            </p>
          )}

          {snapshot.notYetProven.length > 0 && (
            <p className="mt-4 text-sm text-ink-soft">
              <span className="font-semibold">Not yet proven:</span> {snapshot.notYetProven.join(", ")}.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4 border-t border-rule pt-5 sm:flex-col sm:gap-2 sm:border-t-0 sm:pt-0 sm:text-center">
          <ProofQr url={url} size={112} />
          <p className="max-w-40 text-sm text-ink-soft">Scan to open this record on your phone</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">
          Published {formatDateTime(snapshot.publishedAt)}. Record {snapshot.proofId}.
        </p>
        <DocumentActions url={url} />
      </div>
    </section>
  );
}

function ProvesAndDoesNot() {
  return (
    <section aria-labelledby="proves-heading">
      <h2 id="proves-heading" className="text-2xl font-medium">
        What this proves, and what it does not
      </h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="font-medium">It shows</h3>
          <ul className="mt-2 flex flex-col gap-2">
            <ClaimLine met>These explanations state the listed facts. Code confirmed each quote is in the text.</ClaimLine>
            <ClaimLine met>
              The writer then answered a question built from that explanation, and the AI judged the answer to show
              understanding.
            </ClaimLine>
            <ClaimLine met>Whether each skill came from the source they supplied, with the quote when code could confirm it.</ClaimLine>
          </ul>
        </div>
        <div>
          <h3 className="font-medium">It does not show</h3>
          <ul className="mt-2 flex flex-col gap-2">
            <ClaimLine>Who wrote it. The name was typed by the person, and accounts here are anonymous.</ClaimLine>
            <ClaimLine>
              That the source is real. The person supplied the posting, PDF or topic, and nobody else was involved in this
              record.
            </ClaimLine>
            <ClaimLine>That no one helped. Nothing was proctored, so outside help or another AI cannot be ruled out.</ClaimLine>
            <ClaimLine>How they perform on the job, or how many tries they took. Only the passing attempt appears.</ClaimLine>
            <ClaimLine>Any accreditation. It is evidence to read and ask about in an interview, not a certificate.</ClaimLine>
          </ul>
        </div>
      </div>
      <p className="mt-5 text-sm text-ink-soft">
        How an explanation was written (typed or spoken, pasted or not, active time) is reported by the person&apos;s
        browser. These signals give context. They do not affect the score, and they are not a judgement.
      </p>
    </section>
  );
}

function ClaimLine({ met = false, children }: { met?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      {met ? (
        <CircleCheck size={18} aria-hidden="true" className="mt-1 shrink-0 text-proven" />
      ) : (
        <CircleMinus size={18} aria-hidden="true" className="mt-1 shrink-0 text-ink-soft" />
      )}
      <span>{children}</span>
    </li>
  );
}

const CHECK_STEPS: { by: "AI" | "Code"; title: string; detail: string }[] = [
  {
    by: "AI",
    title: "Checkpoints are set first",
    detail: "Specific facts a real explanation must state, written when the skill map was built, before any answer.",
  },
  {
    by: "AI",
    title: "It looks for exact quotes",
    detail: "For each checkpoint, it returns the person's exact words, or nothing. It gives no score.",
  },
  {
    by: "Code",
    title: "Every quote is verified",
    detail: "Code confirms the quote really is in their text. A quote that is not there counts as not met.",
  },
  {
    by: "Code",
    title: "The score is computed",
    detail: `Checkpoints met as a percentage, minus 20 for each factual error the AI listed. A pass needs ${PASS_SCORE}; from ${STRONG_SCORE} no follow-up is needed.`,
  },
  {
    by: "AI",
    title: "One live follow-up",
    detail: "A new question about what they just wrote, answered on the spot. The AI judges this answer, and passing it is required.",
  },
];

function HowChecked() {
  return (
    <section aria-labelledby="checked-heading">
      <h2 id="checked-heading" className="text-2xl font-medium">
        How this was checked
      </h2>
      <p className="mt-1 text-ink-soft">The AI finds the words. Code decides what they are worth.</p>
      <ol className="mt-4 flex flex-col gap-4">
        {CHECK_STEPS.map((step) => (
          <li key={step.title} className="flex items-start gap-3">
            <span
              className={`mt-0.5 inline-flex w-12 shrink-0 justify-center rounded-control border py-0.5 text-sm font-medium ${
                step.by === "Code" ? "border-proven text-proven" : "border-control-edge text-ink-soft"
              }`}
            >
              {step.by}
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{step.title}</p>
              <p className="text-ink-soft">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Fingerprint({ proofId, hash }: { proofId: string; hash: string }) {
  return (
    <section aria-labelledby="fingerprint-heading" className="rounded-sheet border border-control-edge bg-sheet p-5 sm:p-6">
      <h2 id="fingerprint-heading" className="text-2xl font-medium">
        Has this been changed?
      </h2>
      <p className="mt-2">
        This fingerprint is calculated from every word of this record, so changing even one letter would produce a
        completely different one.
      </p>
      <p className="mt-3 rounded-control border border-rule bg-paper p-3 font-mono text-sm break-all">{hash}</p>
      <p className="mt-2 mb-4 text-sm text-ink-soft">
        SHA-256. Print or save it now: if the record online changes later, it will stop matching your saved copy.
      </p>
      <VerifyPanel proofId={proofId} fingerprint={hash} />
    </section>
  );
}
