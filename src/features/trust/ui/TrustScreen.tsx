import { Bot, Code2 } from "lucide-react";
import type { ReactNode } from "react";
import { Card, LearningModeToggle, PageShell } from "@/shared/ui";
import { DeleteMyData } from "./DeleteMyData";

/**
 * From docs/eval-results.md, the grading eval run on Nov 7, 2026. Copied by hand, so if
 * the eval is rerun, update these and the date. Ranges are 95% Wilson intervals.
 */
const EVAL_RUN = "November 7, 2026";
const EVAL_NUMBERS: { figure: string; label: string; range?: string }[] = [
  { figure: "70 of 71", label: "test explanations got the verdict their label expected", range: "92 to 100%" },
  { figure: "0 of 48", label: "explanations that should fail were passed", range: "0 to 7%" },
  { figure: "1 of 23", label: "explanations that should pass were failed", range: "1 to 21%" },
  { figure: "8 of 8", label: "made-up quotes planted in a grade were caught by code, with no AI involved" },
  { figure: "0.53 s", label: "typical time to grade an explanation (0.92 s for the slowest 5%)" },
];

/** What we keep, what the AI decides, what a proof means, and the delete button. */
export function TrustScreen() {
  return (
    <PageShell width="reading">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-3">
          <h1 className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">Trust and your data</h1>
          <p className="text-lg text-ink-soft">
            What OryxLearn keeps, what the AI decides and what plain code checks, what an evidence
            page can and cannot tell an employer, and how to delete everything.
          </p>
        </header>

        <Section title="What we store">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="font-medium">Who you are:</strong> a random guest id in a signed
              cookie. No email, no password, and no name unless you type one to publish.
            </li>
            <li>
              <strong className="font-medium">Your maps:</strong> the posting, PDF text or topic you
              gave, and the skills built from it.
            </li>
            <li>
              <strong className="font-medium">Your attempts:</strong> your explanation, the follow-up
              question and your answer, the score, the words that met each checkpoint, and how you
              wrote it: word count, active typing time, whether anything was pasted, typed or spoken.
            </li>
            <li>
              <strong className="font-medium">What you chose to share:</strong> evidence pages (with
              the name you typed) and courses you published. Anyone with an evidence page&apos;s link
              can read it until you withdraw it.
            </li>
            <li>
              <strong className="font-medium">Study and practice:</strong> flashcards and quiz
              questions made for your maps, which courses you liked or started, and the live grid
              questions you answered correctly.
            </li>
            <li>
              <strong className="font-medium">Only in this browser:</strong> unsent drafts, and the
              Accessible learning mode setting.
            </li>
          </ul>
          <p>
            It is kept in the app&apos;s cloud storage. Postings, explanations and answers are sent
            to an AI model (gpt-oss-120b, on Cerebras first, with other providers as backups) to
            build maps and grade. When you speak instead of typing, the audio goes to a speech-to-text
            service and we keep only the words.
          </p>
        </Section>

        <Section title="What the AI does, and what code checks">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="flex flex-col gap-3 shadow-none">
              <h3 className="flex items-center gap-2 font-medium">
                <Bot aria-hidden="true" size={20} className="text-accent-bright" />
                The AI model
              </h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                <li>Picks the skills in a posting, their order, and 3 or 4 checkpoints for each.</li>
                <li>Says which checkpoints your explanation covers, quoting your words.</li>
                <li>Points out factual errors.</li>
                <li>Writes one follow-up question about what you wrote, and judges your answer.</li>
                <li>Writes flashcards and quiz questions.</li>
              </ul>
            </Card>
            <Card className="flex flex-col gap-3 shadow-none">
              <h3 className="flex items-center gap-2 font-medium">
                <Code2 aria-hidden="true" size={20} className="text-proven" />
                Plain code, no AI
              </h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                <li>Checks each quote from the posting is really there. If not, it says so.</li>
                <li>
                  Checks each quote from your explanation is really in what you wrote. If not, that
                  checkpoint does not count.
                </li>
                <li>Gives no credit for pasting a checkpoint&apos;s own wording back.</li>
                <li>Works out the score: checkpoints met out of 100, minus 20 per factual error. 65 passes.</li>
                <li>Decides what unlocks, and measures how you wrote, in your browser.</li>
                <li>Fingerprints and seals each evidence page, so a reader can check it was not edited.</li>
              </ul>
            </Card>
          </div>
        </Section>

        <Section title="What an evidence page shows, and what it does not">
          <p>
            <strong className="font-medium">It shows</strong> that this person&apos;s own words covered
            each checkpoint, with the quotes checked by code. It shows they answered a live question
            about what they wrote, how they wrote it, and that the record has not changed since it was
            published.
          </p>
          <p>
            <strong className="font-medium">It does not show</strong> that they did it without help.
            A chatbot given the checkpoints can get through: in our saved runs, 15 of 16 chatbot
            answers written with the checkpoints in hand reached the pass mark, and the same chatbot
            passed the follow-up 13 of 13 times. Pasting is shown as a signal, never as an
            accusation, and it does not block a pass.
          </p>
          <p>
            It also does not show who the person is, since the name is whatever they typed, or that
            an expert set the bar: the checkpoints are written by AI from the posting.
          </p>
        </Section>

        <Section title="How well the grading works, measured">
          <dl className="grid gap-3 sm:grid-cols-2">
            {EVAL_NUMBERS.map((item) => (
              <div key={item.label} className="rounded-sheet border border-rule-strong bg-sheet/90 p-4">
                <dt className="text-2xl font-semibold tabular-nums">{item.figure}</dt>
                <dd className="text-ink-soft">
                  {item.label}
                  {item.range && <span className="block text-sm">Likely true rate: {item.range}</span>}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-2 rounded-sheet border border-dashed border-amber/60 bg-amber/5 p-4">
            <h3 className="font-medium">Read these with their limits</h3>
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              <li>
                An AI (Claude) wrote all 71 test explanations and the verdict each should get. No
                teacher or expert has checked them yet.
              </li>
              <li>71 cases is a small test, and it has not been tried with real learners.</li>
              <li>
                The chatbot figures come from saved runs with the older pass mark of 70, read against
                today&apos;s rules, not rerun.
              </li>
              <li>Measured on {EVAL_RUN}. The full report is docs/eval-results.md in our repository.</li>
            </ul>
          </div>
        </Section>

        <Section title="Accessible learning mode">
          <p>
            Turns on Lexend, a typeface designed for easier reading, with larger text, more space
            between lines and letters, and no motion. It also adds &ldquo;Read aloud&rdquo; buttons to
            each skill and each result. Those use your browser&apos;s own voice: nothing is sent to us,
            and they are a reading aid, separate from the spoken follow-up interview. The setting is
            saved in this browser only.
          </p>
          <LearningModeToggle className="self-start border border-rule-strong bg-raised/50 px-3" />
          <p className="text-ink-soft">
            Everything works with a keyboard. On the map, Tab moves between skills, Enter opens one,
            and Escape closes it.
          </p>
        </Section>

        <Section title="Delete my data" id="delete">
          <p>
            Deletes your maps, attempts, scores, proven skills and grid answers from our storage, takes down any
            evidence page or course you published, and starts this browser as a new guest. If someone
            started a copy of a course you published, their copy is theirs and stays.
          </p>
          <p className="text-ink-soft">
            Not covered yet: the flashcards and quiz questions made for your maps, and your course
            likes and starts. None of them hold words you wrote, and they can no longer be linked to
            you once your session is replaced.
          </p>
          <DeleteMyData />
        </Section>
      </div>
    </PageShell>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  const headingId = `${id ?? title.toLowerCase().replace(/[^a-z]+/g, "-")}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className="flex scroll-mt-6 flex-col gap-4">
      <h2 id={headingId} className="text-2xl font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}
