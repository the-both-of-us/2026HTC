import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageShell } from "@/shared/ui";
import { BENCHMARK_LINKS, CLOSE_ENOUGH_POINTS, MODELS, modelById, type ModelId } from "../catalog";
import { bestModels, defaultGap, pickModel, type BenchResults } from "../shape";

const TH = "px-2 py-2 text-left font-medium text-ink-soft";
const TD = "px-2 py-2 align-top tabular-nums";

const shortName = (id: ModelId) => modelById(id).label.replace("Claude ", "");

function day(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const money = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);

/** /settings/models: how each model did per subject, how fast it writes, and what we use it for. */
export function BenchmarksScreen({ results }: { results: BenchResults }) {
  const overall = new Map(results.models.map((m) => [m.id, m]));
  const routing = results.subjects.map((subject) => ({ subject, pick: pickModel(subject.scores), gap: defaultGap(subject.scores) }));
  const ossHolds = routing.filter((r) => r.pick?.model === "gpt-oss-120b");
  const stepUp = routing.filter((r) => r.pick && r.pick.model !== "gpt-oss-120b");
  const oss = overall.get("gpt-oss-120b");
  const opus = overall.get("claude-opus-5-5");
  const sonnet = overall.get("claude-sonnet-5-5");
  const haiku = overall.get("claude-haiku-5-5");

  return (
    <PageShell width="wide">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-3">
          <Link href="/settings" className="text-sm text-ink-soft underline">
            Settings
          </Link>
          <h1 className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">Model comparisons</h1>
          <p className="max-w-3xl text-lg text-ink-soft">
            How the four models we can call did on public exam questions, subject by subject, and how fast
            each writes a lesson. These results decided which models OryxLearn uses.
          </p>
          <p className="text-sm text-ink-soft">
            {results.questionsPerSubject} questions per subject, {results.totalQuestions} in all, run on{" "}
            {day(results.generatedAt)}. Graded by code against the answer key.
          </p>
        </header>

        <Section title="The verdict: two models">
          <div className="flex max-w-3xl flex-col gap-4 rounded-md border border-rule-strong bg-sheet p-5">
            <p className="text-lg">
              OryxLearn uses <strong className="font-semibold">gpt-oss-120b</strong> by default and{" "}
              <strong className="font-semibold">Claude Sonnet</strong> where accuracy is worth the wait. Haiku and Opus
              are not used.
            </p>
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {oss && sonnet && (
                <li>
                  <strong className="font-medium">gpt-oss-120b</strong> scored {oss.overall.accuracy}% and answers in a
                  median {oss.overall.medianSeconds} s. It ties Claude on {ossHolds.map((r) => r.subject.label.toLowerCase()).join(", ")}, so it
                  writes everyday courses, flashcards and quizzes, and checks every answer.
                </li>
              )}
              {sonnet && (
                <li>
                  <strong className="font-medium">Claude Sonnet</strong> scored {sonnet.overall.accuracy}% and was clearly
                  better on {stepUp.map((r) => `${r.subject.label.toLowerCase()} (${r.gap} points)`).join(", ")}. It writes the map and
                  lessons for hard courses, high-stakes courses, and those subjects.
                </li>
              )}
              {haiku && oss && (
                <li>
                  <strong className="font-medium">Haiku</strong> ({haiku.overall.accuracy}%) was barely ahead of gpt-oss-120b
                  and about {Math.round(haiku.overall.medianSeconds / oss.overall.medianSeconds)} times slower, so it adds nothing.
                </li>
              )}
              {opus && sonnet && (
                <li>
                  <strong className="font-medium">Opus</strong> ({opus.overall.accuracy}%) beat Sonnet by about one question in
                  64, at {(opus.overall.medianSeconds / sonnet.overall.medianSeconds).toFixed(1)} times the wait and about{" "}
                  {Math.round(opus.overall.costPer100 / sonnet.overall.costPer100)} times the price, so it isn&apos;t worth it.
                </li>
              )}
            </ul>
          </div>
        </Section>

        <Section title="Accuracy by subject">
          <div className="relative overflow-x-auto rounded-md border border-rule-strong bg-sheet">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <caption className="sr-only">Percent of questions answered correctly, per subject and model</caption>
              <thead>
                <tr className="border-b border-rule">
                  <th className={TH} scope="col">
                    Subject
                  </th>
                  {MODELS.map((model) => (
                    <th key={model.id} className={TH} scope="col">
                      {shortName(model.id)}
                    </th>
                  ))}
                  <th className={TH} scope="col">
                    Use
                  </th>
                </tr>
              </thead>
              <tbody>
                {routing.map(({ subject, pick }) => {
                  const best = bestModels(subject.scores);
                  return (
                    <tr key={subject.id} className="border-b border-rule last:border-0">
                      <th scope="row" className="px-2 py-2 text-left align-top font-medium">
                        {subject.label}
                        <span className="block text-xs font-normal text-ink-soft">
                          {subject.benchmark}, {subject.level.toLowerCase()}, n={subject.n}
                        </span>
                      </th>
                      {MODELS.map((model) => {
                        const s = subject.scores[model.id];
                        const isBest = best.includes(model.id);
                        return (
                          <td key={model.id} className={clsx(TD, isBest && "font-semibold text-proven")}>
                            {s ? `${Math.round(s.accuracy)}%` : "–"}
                            {isBest && <span className="sr-only"> (best)</span>}
                            {isBest && (
                              <span aria-hidden className="ml-1">
                                ★
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className={clsx(TD, "whitespace-nowrap")}>{pick ? shortName(pick.model) : "–"}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-rule-strong">
                  <th scope="row" className="px-2 py-2 text-left font-medium">
                    All subjects
                  </th>
                  {MODELS.map((model) => {
                    const s = overall.get(model.id)?.overall;
                    return (
                      <td key={model.id} className={clsx(TD, "font-medium")}>
                        {s?.n ? `${s.accuracy}%` : "–"}
                      </td>
                    );
                  })}
                  <td className={TD} />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink-soft">
            ★ marks the best score in a row. &ldquo;Use&rdquo; is the cheapest model within {CLOSE_ENOUGH_POINTS} points
            of the best. MMLU-Pro questions have 10 options (10% by guessing); MMLU has 4 (25%).
          </p>
        </Section>

        <Section title="Speed and cost">
          <div className="relative overflow-x-auto rounded-md border border-rule-strong bg-sheet">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">Speed and cost per model</caption>
              <thead>
                <tr className="border-b border-rule">
                  <th className={TH} scope="col">
                    Model
                  </th>
                  <th className={TH} scope="col">
                    Median answer
                  </th>
                  <th className={TH} scope="col">
                    Tokens per answer
                  </th>
                  <th className={TH} scope="col">
                    Per 100 questions
                  </th>
                  <th className={TH} scope="col">
                    Lesson wait
                  </th>
                  <th className={TH} scope="col">
                    Tokens/s
                  </th>
                  <th className={TH} scope="col">
                    Price in / out per M
                  </th>
                </tr>
              </thead>
              <tbody>
                {MODELS.map((model) => {
                  const row = overall.get(model.id);
                  if (!row) return null;
                  return (
                    <tr key={model.id} className="border-b border-rule last:border-0">
                      <th scope="row" className="px-2 py-2 text-left font-medium">
                        {model.label}
                        <span className="block text-xs font-normal text-ink-soft">{model.provider}</span>
                      </th>
                      <td className={TD}>{row.overall.medianSeconds} s</td>
                      <td className={TD}>{row.overall.avgOutputTokens}</td>
                      <td className={TD}>{money(row.overall.costPer100)}</td>
                      <td className={TD}>{row.lessons ? `${row.lessons.medianSeconds} s` : "–"}</td>
                      <td className={TD}>{row.lessons ? row.lessons.tokensPerSecond : "–"}</td>
                      <td className={TD}>
                        ${model.priceIn} / ${model.priceOut}
                        {model.priceNote && <span className="text-ink-soft">*</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink-soft">
            &ldquo;Lesson wait&rdquo; is the time to write a whole 600 to 900 word lesson as JSON (median of{" "}
            {results.lessonTopics.length} topics: {results.lessonTopics.join("; ")}), which is the wait a learner feels.
            Tokens include the model&rsquo;s hidden thinking. *{MODELS.find((m) => m.priceNote)?.priceNote}.
          </p>
        </Section>

        <Section title="How we tested">
          <ul className="flex max-w-3xl list-disc flex-col gap-2 pl-5">
            <li>
              Questions come from two public benchmarks:{" "}
              <a className="underline" href={BENCHMARK_LINKS["MMLU-Pro"].url}>
                MMLU-Pro
              </a>{" "}
              (harder, 10 options;{" "}
              <a className="underline" href={BENCHMARK_LINKS["MMLU-Pro"].paper}>
                paper
              </a>
              ) and{" "}
              <a className="underline" href={BENCHMARK_LINKS.MMLU.url}>
                MMLU
              </a>{" "}
              (4 options;{" "}
              <a className="underline" href={BENCHMARK_LINKS.MMLU.paper}>
                paper
              </a>
              ). Each subject is a fixed sample of {results.questionsPerSubject} from the test split, the same for every
              model. Quantum physics is MMLU-Pro physics questions that mention quantum ideas (photons, spin, energy levels
              and so on).
            </li>
            <li>
              Every model got the same prompt: the question, lettered options, and &ldquo;think briefly, then end with
              Answer: X&rdquo;. Code reads the letter and compares it with the key. No AI judges another AI.
            </li>
            <li>
              Claude models ran at effort &ldquo;{results.effort}&rdquo; with their default thinking; gpt-oss-120b at
              reasoning effort &ldquo;{results.effort}&rdquo;. Each reply could use up to {results.maxTokens.toLocaleString()}{" "}
              tokens. {results.calls.toLocaleString()} calls in all, about ${results.spentUsd.toFixed(2)} at list prices.
            </li>
          </ul>
        </Section>

        <Section title="Caveats">
          <ul className="flex max-w-3xl list-disc flex-col gap-2 pl-5">
            <li>
              {results.questionsPerSubject} questions is a small sample: one question is{" "}
              {Math.round(100 / results.questionsPerSubject)} points, so a gap of a few points within one subject can be
              chance. The overall row ({results.totalQuestions} questions) is steadier.
            </li>
            <li>
              Multiple choice tests what a model knows, not how well it explains. Lessons and grading in the app are judged
              separately (see the{" "}
              <Link className="underline" href="/trust">
                Trust page
              </Link>
              ).
            </li>
            <li>
              These questions are public, so some may have been in a model&rsquo;s training data. Latency depends on the
              provider&rsquo;s load that day.
            </li>
          </ul>
        </Section>
      </div>
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = `${title.toLowerCase().replace(/[^a-z]+/g, "-")}-title`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-2xl font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}
