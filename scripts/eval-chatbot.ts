/**
 * What happens when someone pastes a real chatbot's answer? This asks real chat models to
 * explain each skill the way a learner would ask, with no checkpoints, then runs what they
 * wrote through the real grader. Anything that scores 70 or more gets a real follow-up,
 * answered once correctly and once wrongly on purpose, by the same model.
 *
 *   npx tsx scripts/eval-chatbot.ts     writes src/features/teachback/eval/chatbot.json
 *   npm run eval -- --report            puts the results in docs/eval-results.md
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateFollowUp, gradeExplanation, gradeFollowUp } from "../src/features/teachback";
import type { ChatbotRun, EvalSkill } from "../src/features/teachback/eval/report";
import { PASS_SCORE, type SkillNode } from "../src/shared/types";

process.loadEnvFile(".env.local");

const EVAL_DIR = join("src", "features", "teachback", "eval");
const RESULTS_PATH = join(EVAL_DIR, "chatbot.json");

type Model = { id: string; url: string; token: string; pauseMs: number };

const MODELS: Model[] = [
  { id: "google/gemini-2.5-flash", url: "https://ai-gateway.vercel.sh/v1/chat/completions", token: process.env.VERCEL_OIDC_TOKEN ?? "", pauseMs: 13_000 },
  { id: "openai/gpt-4o", url: "https://ai-gateway.vercel.sh/v1/chat/completions", token: process.env.VERCEL_OIDC_TOKEN ?? "", pauseMs: 13_000 },
];

/**
 * How a learner would ask. The first two know only what the map shows. The third is the
 * realistic cheat: a failed attempt's result screen lists the missed checkpoints, so
 * someone can fail once and hand those to a chatbot.
 */
const PROMPTS = [
  { kind: "plain", text: (node: SkillNode) => `Explain ${node.title} in a short paragraph.` },
  {
    kind: "for-the-job",
    text: (node: SkillNode) =>
      `I have to explain ${node.title} to show I understand it for a job. Why the job needs it: ${node.why} Explain it in about 150 words and state the specific facts that matter.`,
  },
  {
    kind: "after-seeing-missed-checkpoints",
    text: (node: SkillNode) =>
      `I have to explain ${node.title} in my own words, in about 150 words of plain text. Make sure it covers these points:\n${node.checkpoints.map((point) => `- ${point}`).join("\n")}`,
  },
];

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ask(model: Model, prompt: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(model.url, {
      method: "POST",
      headers: { authorization: `Bearer ${model.token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: model.id, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) {
      const body = await response.json();
      const text = body.choices?.[0]?.message?.content;
      await pause(model.pauseMs);
      if (typeof text === "string" && text.trim()) return text.trim();
    }
    if (attempt === 4) throw new Error(`${model.id} gave no answer (last status ${response.status})`);
    await pause(30_000);
  }
}

async function main() {
  console.info = () => {};
  const skills: EvalSkill[] = JSON.parse(readFileSync(join(EVAL_DIR, "skills.json"), "utf8"));
  // A rerun keeps what is saved and only does what is missing.
  const runs: ChatbotRun[] = existsSync(RESULTS_PATH) ? JSON.parse(readFileSync(RESULTS_PATH, "utf8")) : [];

  // One model at a time per skill would take 20 minutes, and the rate limits are per model.
  await Promise.all(MODELS.map(async (model) => {
    for (const skill of skills) {
      const node = skill.node as SkillNode;
      for (const prompt of PROMPTS) {
        if (runs.some((run) => run.model === model.id && run.skill === skill.key && run.prompt === prompt.kind)) continue;

        const explanation = await ask(model, prompt.text(node));
        const grade = await gradeExplanation(node, explanation);
        const run: ChatbotRun = {
          model: model.id,
          skill: skill.key,
          prompt: prompt.kind,
          explanation,
          score: grade.score,
          met: grade.checkpoints.filter((result) => result.met).length,
          total: grade.checkpoints.length,
          followUp: null,
        };

        if (grade.score >= PASS_SCORE) {
          const question = await generateFollowUp(node, explanation, grade);
          const context = `Someone wrote this explanation of ${node.title}:\n\n${explanation}\n\nThey were asked: ${question}`;
          const rightAnswer = await ask(model, `${context}\n\nAnswer the question correctly, in two or three plain sentences.`);
          const wrongAnswer = await ask(
            model,
            `${context}\n\nFor a test of an automatic marker, write a wrong answer in two or three plain sentences: it should address the question and sound confident, but state something false.`,
          );
          const right = await gradeFollowUp(node, explanation, question, rightAnswer);
          const wrong = await gradeFollowUp(node, explanation, question, wrongAnswer);
          run.followUp = { question, rightAnswer, rightPassed: right.passed, wrongAnswer, wrongPassed: wrong.passed };
        }

        runs.push(run);
        writeFileSync(RESULTS_PATH, `${JSON.stringify(runs, null, 1)}\n`);
        console.log(
          `${model.id} ${skill.key} ${prompt.kind}: ${run.score} (${run.met}/${run.total})` +
            (run.followUp ? `, right answer ${run.followUp.rightPassed ? "passed" : "stopped"}, wrong answer ${run.followUp.wrongPassed ? "passed" : "stopped"}` : ""),
        );
      }
    }
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "The run failed");
  process.exit(1);
});
