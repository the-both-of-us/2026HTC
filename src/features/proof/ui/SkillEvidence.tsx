import { Circle, CircleCheck, Clock, ClipboardCheck, ClipboardPaste, Keyboard, Mic, WholeWord } from "lucide-react";
import type { ReactNode } from "react";
import { PASS_SCORE } from "@/shared/types";
import type { ProofSkill } from "../types";
import { formatDateTime, highlightSegments, integrityLines, plural, scoreLine, sourceName } from "./format";

/** One proven skill: what they wrote, what was found in it, and how it was tested. */
export function SkillEvidence({ skill }: { skill: ProofSkill }) {
  return (
    <article
      id={`skill-${skill.nodeId}`}
      aria-labelledby={`skill-${skill.nodeId}-title`}
      className="scroll-mt-4 overflow-hidden rounded-sheet border border-control-edge bg-sheet"
    >
      <header className="flex items-start justify-between gap-4 border-b border-rule p-5 sm:p-6">
        <div className="min-w-0">
          <h3 id={`skill-${skill.nodeId}-title`} className="text-2xl font-bold">
            {skill.title}
          </h3>
          <p className="mt-1 text-ink-soft">{skill.why}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl font-bold text-proven tabular-nums">
            {skill.score}
            <span className="sr-only"> out of 100</span>
          </p>
          <p aria-hidden="true" className="text-sm text-ink-soft">
            of 100
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-7 p-5 sm:p-6">
        <Section title="What they wrote">
          <Transcript skill={skill} />
        </Section>

        <Section title="Checkpoints">
          <p className="mb-3 text-sm text-ink-soft">{scoreLine(skill)} A pass needs {PASS_SCORE}, plus the follow-up.</p>
          <Checkpoints skill={skill} />
          {skill.factualErrors.length > 0 && (
            <div className="mt-4">
              <p className="font-semibold">{skill.factualErrors.length === 1 ? "Factual error found" : "Factual errors found"}</p>
              <ul className="mt-1 list-disc pl-5 text-ink-soft">
                {skill.factualErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          {skill.rejectedQuotes > 0 && (
            <p className="mt-3 text-sm text-ink-soft">
              The AI offered {plural(skill.rejectedQuotes, "quote")} that did not appear in this text, so code rejected{" "}
              {skill.rejectedQuotes === 1 ? "it" : "them"}.
            </p>
          )}
        </Section>

        <Section title="Live follow-up question">
          <p className="text-sm text-ink-soft">Written after they submitted, from their own words. It had to be passed.</p>
          <p className="mt-3 font-semibold">{skill.followUp.question}</p>
          <p className="mt-3 border-l-2 border-control-edge pl-3.5 whitespace-pre-wrap">{skill.followUp.answer}</p>
          {skill.followUp.feedback && (
            <p className="mt-3 flex items-start gap-2 text-sm text-ink-soft">
              <CircleCheck size={18} aria-hidden="true" className="mt-px shrink-0 text-proven" />
              <span>
                <span className="font-semibold text-ink">Passed.</span> {skill.followUp.feedback}
              </span>
            </p>
          )}
        </Section>

        <Section title="How the explanation was written">
          <Signals skill={skill} />
          <p className="mt-2 text-sm text-ink-soft">{formatDateTime(skill.attemptedAt)}</p>
        </Section>

        <Section title="Why this skill is on the list">
          <SourceNote skill={skill} />
        </Section>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-base font-bold">{title}</h4>
      {children}
    </section>
  );
}

function Transcript({ skill }: { skill: ProofSkill }) {
  const segments = highlightSegments(
    skill.explanation,
    skill.checkpoints.map((result) => result.quote),
  );

  return (
    <p className="whitespace-pre-wrap">
      {segments.map((segment, index) => (
        <span key={index}>
          {segment.marked ? (
            <mark className="rounded-[3px] bg-highlight px-0.5 text-ink">{segment.text}</mark>
          ) : (
            segment.text
          )}
          {segment.endsCheckpoints.map((number) => (
            <sup key={number} className="ml-0.5 text-[0.7em] font-bold text-proven">
              <span className="sr-only">checkpoint </span>
              {number}
            </sup>
          ))}
        </span>
      ))}
    </p>
  );
}

function Checkpoints({ skill }: { skill: ProofSkill }) {
  return (
    <ol className="flex flex-col gap-3.5">
      {skill.checkpoints.map((result, index) => (
        <li key={index} className="flex items-start gap-2.5">
          {result.met ? (
            <CircleCheck size={20} aria-label="Met" className="mt-0.5 shrink-0 text-proven" />
          ) : (
            <Circle size={20} aria-label="Not met" className="mt-0.5 shrink-0 text-locked" />
          )}
          <div className="min-w-0">
            <p className={result.met ? undefined : "text-ink-soft"}>
              <span className="font-semibold">{index + 1}.</span> {result.checkpoint}
            </p>
            {result.quote ? (
              <p className="mt-1 text-sm">
                <mark className="rounded-[3px] bg-highlight px-1 py-px text-ink [box-decoration-break:clone]">“{result.quote}”</mark>
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-ink-soft">Not stated in this answer.</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Signals({ skill }: { skill: ProofSkill }) {
  const lines = integrityLines(skill.integrity);
  const voice = skill.integrity.inputMethod === "voice";
  const pasted = skill.integrity.pasted;

  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      <Signal icon={voice ? <Mic size={16} /> : <Keyboard size={16} />}>{lines.method}</Signal>
      <Signal icon={pasted ? <ClipboardPaste size={16} /> : <ClipboardCheck size={16} />}>{lines.paste}</Signal>
      <Signal icon={<Clock size={16} />}>{lines.active}</Signal>
      <Signal icon={<WholeWord size={16} />}>{lines.words}</Signal>
    </ul>
  );
}

function Signal({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-ink-soft">
        {icon}
      </span>
      {children}
    </li>
  );
}

function SourceNote({ skill }: { skill: ProofSkill }) {
  const { source } = skill;

  if (source.status === "foundation") {
    return <p className="text-ink-soft">The source does not name this directly. It is a foundation for something it does ask for.</p>;
  }
  if (source.status === "unverified") {
    return <p className="text-ink-soft">The source quote for this skill could not be confirmed, so it is not shown.</p>;
  }
  return (
    <figure>
      <blockquote className="border-l-2 border-proven pl-3.5">“{source.quote}”</blockquote>
      <figcaption className="mt-1.5 text-sm text-ink-soft">{sourceName(source)}. Code confirmed these words appear in it.</figcaption>
    </figure>
  );
}
