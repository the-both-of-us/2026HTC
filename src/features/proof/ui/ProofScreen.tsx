import { ArrowLeft, BadgeCheck, Check, CircleDashed, Lock } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { integritySentence } from "@/features/teachback";
import { readUserId } from "@/shared/identity";
import type { CheckpointResult, SourceKind } from "@/shared/types";
import { buttonClasses, ErrorNotice, LogoMark } from "@/shared/ui";
import { SkipLink } from "@/shared/ui/SkipLink";
import { getEvidence, type Evidence, type ProvenSkill } from "../evidence";
import { ShareProof } from "./ShareProof";

const SOURCE_NAME: Record<SourceKind, string> = { posting: "posting", pdf: "PDF" };

const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "America/Edmonton" });

/** The public evidence page. It is what an employer or judge sees after scanning the QR code. */
export async function ProofScreen({ mapId }: { mapId: string }) {
  let evidence: Evidence | null;
  try {
    evidence = await getEvidence(mapId, await readUserId());
  } catch (error) {
    console.error("[proof] could not load evidence", error);
    return (
      <ProofFrame>
        <h1 className="text-3xl font-medium">Evidence page</h1>
        <ErrorNotice message="This page could not be loaded just now. Please refresh in a moment." />
      </ProofFrame>
    );
  }

  if (!evidence) {
    return (
      <ProofFrame>
        <h1 className="text-3xl font-medium">This evidence page is not here</h1>
        <p className="text-lg text-ink-soft">The link may be incomplete, or the map may have been deleted.</p>
        <div>
          <Link href="/" className={buttonClasses("primary")}>
            Build your own skill map
          </Link>
        </div>
      </ProofFrame>
    );
  }

  return (
    <ProofFrame>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-4">
          {evidence.viewerIsOwner && (
            <Link
              href={`/map/${evidence.mapId}`}
              className="flex min-h-11 w-fit items-center gap-2 text-ink-soft transition-control hover:text-ink"
            >
              <ArrowLeft aria-hidden="true" size={17} />
              Back to your map
            </Link>
          )}
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-accent-bright">Evidence page</p>
            <h1 className="text-3xl leading-tight font-medium sm:text-4xl">{evidence.title}</h1>
            {evidence.subtitle && <p className="text-ink-soft">{evidence.subtitle}</p>}
          </div>
          <ProvenCount proven={evidence.proven.length} total={evidence.totalSkills} />
          <p className="max-w-prose leading-7 text-ink-soft">
            An anonymous learner explained each skill below in their own words. Code checked their
            words against fixed checkpoints, then they answered one live question about what they
            wrote. Their exact words are here, so you can judge for yourself.
          </p>
        </div>
        <ShareProof url={await pageUrl(evidence.mapId)} />
      </header>

      {evidence.proven.length === 0 ? (
        <p className="rounded-sheet border border-rule-strong bg-sheet/90 p-5 text-lg">
          Nothing is proven on this map yet.
        </p>
      ) : (
        <section aria-label="Proven skills" className="flex flex-col gap-5">
          {evidence.proven.map((skill) => (
            <SkillEvidence key={skill.id} skill={skill} sourceKind={evidence.sourceKind} />
          ))}
        </section>
      )}

      {evidence.notProven.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="flex items-center gap-2 font-medium text-ink-soft">
            <Lock aria-hidden="true" size={16} />
            Not proven yet
          </h2>
          <ul className="flex flex-wrap gap-2">
            {evidence.notProven.map((title) => (
              <li key={title} className="rounded-full border border-dashed border-locked/70 px-3 py-1 text-sm text-ink-soft">
                {title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </ProofFrame>
  );
}

/**
 * Just the name and the content, with no app navigation: most people here came from a QR
 * code and aren't using the app.
 */
function ProofFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="flex min-h-14 items-center justify-between gap-4 border-b border-rule px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-medium">
          <LogoMark />
          OryxLearn
        </Link>
        <Link href="/" className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink">
          Build your own
        </Link>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}

/** Loading state for the route, shown while the page reads its data. */
export function ProofLoading() {
  return (
    <ProofFrame>
      <p role="status" className="text-lg text-ink-soft">
        Loading this evidence page.
      </p>
    </ProofFrame>
  );
}

function ProvenCount({ proven, total }: { proven: number; total: number }) {
  const percent = total === 0 ? 0 : (proven / total) * 100;

  return (
    <div className="flex items-center gap-3">
      <div aria-hidden="true" className="h-2 w-40 overflow-hidden rounded-full bg-rule-strong">
        <div className="h-full rounded-full bg-proven" style={{ width: `${percent}%` }} />
      </div>
      <p className="font-medium tabular-nums">
        {proven} of {total} skills proven
      </p>
    </div>
  );
}

function SkillEvidence({ skill, sourceKind }: { skill: ProvenSkill; sourceKind: SourceKind }) {
  const { attempt } = skill;

  return (
    <article className="flex flex-col gap-5 rounded-sheet border border-proven/50 bg-sheet/90 p-5">
      <header className="flex items-start gap-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-proven text-on-proven">
          <Check aria-hidden="true" size={21} strokeWidth={3} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-xl leading-snug font-medium">{skill.title}</h2>
          <p className="text-sm text-ink-soft tabular-nums">
            Proven {dateFormat.format(new Date(attempt.createdAt))}. Scored {attempt.grade.score} out of 100.
          </p>
        </div>
      </header>

      <EvidenceBlock title="What they showed">
        <ul className="flex flex-col gap-3">
          {attempt.grade.checkpoints.map((result) => (
            <CheckpointEvidence key={result.checkpoint} result={result} />
          ))}
        </ul>
      </EvidenceBlock>

      {attempt.grade.misconceptions.length > 0 && (
        <EvidenceBlock title="Errors the check found">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {attempt.grade.misconceptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </EvidenceBlock>
      )}

      {attempt.followUp?.answer && (
        <EvidenceBlock title="The live follow-up question, passed">
          <p>{attempt.followUp.question}</p>
          <p className="mt-2 border-l-2 border-control-edge pl-3 text-ink-soft">{attempt.followUp.answer}</p>
        </EvidenceBlock>
      )}

      <details className="rounded-control border border-rule-strong">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium transition-control hover:bg-raised">
          Read their full explanation
        </summary>
        <p className="p-3 pt-1 leading-7 whitespace-pre-wrap">{attempt.explanation}</p>
      </details>

      <EvidenceBlock title="Where this skill came from">
        <SkillSource skill={skill} sourceKind={sourceKind} />
      </EvidenceBlock>

      <p className="text-sm text-ink-soft">
        Reported by the learner&apos;s browser, so read it as context: {lowerFirst(integritySentence(attempt.integrity))}
      </p>
    </article>
  );
}

function EvidenceBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-medium text-ink-soft">{title}</h3>
      {children}
    </section>
  );
}

function CheckpointEvidence({ result }: { result: CheckpointResult }) {
  return (
    <li className="flex gap-2.5">
      {result.met ? (
        <Check aria-hidden="true" size={18} strokeWidth={3} className="mt-1 shrink-0 text-proven" />
      ) : (
        <CircleDashed aria-hidden="true" size={18} className="mt-1 shrink-0 text-amber" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p>
          <span className="sr-only">{result.met ? "Met: " : "Missed: "}</span>
          {result.checkpoint}
        </p>
        {result.quote && (
          <p>
            <span className="sr-only">Their words: </span>
            <mark className="rounded-sm bg-highlight box-decoration-clone px-1 py-0.5 text-ink">
              &ldquo;{result.quote}&rdquo;
            </mark>
          </p>
        )}
      </div>
    </li>
  );
}

function SkillSource({ skill, sourceKind }: { skill: ProvenSkill; sourceKind: SourceKind }) {
  const source = SOURCE_NAME[sourceKind];

  if (skill.citation?.verified) {
    return (
      <figure className="flex flex-col gap-1.5">
        <blockquote className="leading-7">{skill.citation.quote}</blockquote>
        <figcaption className="flex items-center gap-1.5 text-sm font-medium text-accent-bright">
          <BadgeCheck aria-hidden="true" size={15} className="shrink-0" />
          Verified quote from the {source}
          {skill.citation.page ? `, page ${skill.citation.page}` : ""}
        </figcaption>
      </figure>
    );
  }

  if (!skill.fromSource) return <p>A foundation skill. The {source} does not name it directly.</p>;
  return <p>No verified quote from the {source} for this skill.</p>;
}

/** The address of this page as the visitor reached it, for the QR code and link. */
async function pageUrl(mapId: string): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}/proof/${mapId}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
