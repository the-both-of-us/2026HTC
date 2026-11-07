**The grader stops answers that state no facts. It does not stop a chatbot that states them, and neither does the follow-up.** Passing here shows the text states the facts and a follow-up was answered correctly. It does not show a person understood anything on their own.

We ran real chatbot output through the real grader and the real follow-up, with `openai/gpt-4o` and `google/gemini-2.5-flash`, across all 8 skills (`scripts/eval-chatbot.ts`, each answer graded once):

- **Asked only what the map shows:** 0 of 32 reached 70, and the highest score was 67. Checkpoints are specific enough that a general answer misses them, now that browsers no longer receive them.
- **Given the checkpoints:** 13 of 16 reached 70. A failed attempt's result screen shows the missed checkpoints, so someone can fail once and hand those to a chatbot.
- **Then the live follow-up:** the same model's correct answer passed 13 of 13, so 13 of those 16 would be marked proven with no person understanding anything. The follow-up raises the effort, since it means going back to the chatbot with a new question. It doesn't block the route.
- **What the follow-up does catch:** answers to the actual question, written to be wrong but confident, passed 0 of 13.

This is why the evidence page says it can't rule out outside help, and why it's something to ask about in an interview.

**What the other numbers rest on.** The labelled set still agrees 67 of 71 times, and these counts recompute from `results.json`, but they flatter the grader in three ways:

- **"No generic AI answer passed" is narrower than it sounds.** All 8 `ai-generic` cases were written by hand and state no facts. The 2 `ai-specific` cases state the facts, are labelled pass, and scored 100 in 6 of 6 runs.
- **Many fail cases are easy.** 36 of the 48 fail cases never scored above 25. The fluent-empty and prompt-injection results (highest score 25 in those groups) do show the method working, but they say little about harder cheating.
- **"11 of 12 follow-ups stopped" used fixed answers written before each question existed**, so they repeat earlier text and don't respond to it. The 13 of 13 above is the fairer number for a learner with a chatbot.

All 10 informal-but-correct answers passed on all 3 runs, including a voice-style transcript, an English-learner answer with mistakes, curly punctuation, French and Arabic.

The false-pass rate is 8.3%, but its range reaches 20%, so this sample doesn't prove it is under 10%. All 4 false passes come from two causes, and neither is the model being fooled.

### What to change, most important first

The lead decides these. The only change to `grading.ts` so far is the three-word quote rule.

**1. Decide what a failed attempt shows.** Browsers no longer get the checkpoints from `GET /api/maps/[id]`: `toPublicMap` sends only `checkpointCount`. In this eval, `sql-parrot` and `feedback-parrot` pasted checkpoints word for word and scored 100 in 6 of 6 runs, and that route is closed until a learner fails once.
- The result screen still lists missed checkpoints after a failed attempt, which is the route the chatbot runs above used. That is useful teaching, so this is a real trade-off.
- Options: name only the topic of a missed checkpoint, or add an integrity signal when a credited quote nearly matches its checkpoint's wording. A signal shouldn't block, because honest answers can also come close.

**2. Decide whether a flagged false claim can still pass.** `grid-all-plus-error` and `transactions-all-plus-error` state every checkpoint and add a serious false claim (for example, that ROLLBACK works days after COMMIT). The model flagged the claim in 6 of 6 runs, so it did its job. The formula then gave 100 minus 20, which is 80 and a pass.
- Change: in `attempts.ts` line 60, go to `not-yet` when `grade.misconceptions.length > 0`, and update `SPEC.md`.
- Replaying the saved runs with that rule takes false passes from 4 to 2 of 48, and false fails stay at 0 of 23. No pass-labelled run had a flagged error (0 of 69). Those answers were written to be clean, so real learners may trigger false flags more often.
- Reason to leave it alone: this eval labels these as fails by a rule stricter than `SPEC.md`, and the follow-up stopped these learners in 6 of 6 runs, because it aims at misconceptions first.

**3. Stop the model's edited quote costing a learner a pass.** In `abtest-strong` run 1 the model cut a sentence short and added its own full stop, so the code rejected a true quote. The score fell from 100 to 67, the only false-fail run of 69. It is 1 of 337 quotes, and it was caught as designed, but the learner pays for the model's edit.
- Prompt change: add to the first bullet of `GRADER_SYSTEM`: "Do not add or change punctuation at the start or end of the quote. Stop where the learner's words stop, even in the middle of a sentence."
- Code change: strip punctuation from both ends of the quote in `quoteIsInText`. Removing the full stop makes this exact quote match, which was checked against the saved run. A fabricated quote still fails.
- Optional: use the same curly-quote handling as `normalizeForMatch` in skill-map. This did not fail in this run, where the model copied curly punctuation correctly.

**4. Decide on 3-checkpoint skills.** One miss on 3 checkpoints gives 67, a fail. One miss on 4 gives 75, a pass. So 3-checkpoint skills need a perfect answer, which is why one rejected quote flipped `abtest-strong`. 30 of the 40 nodes in the saved sample maps have 3. Asking the generator for exactly 4 would even this out.

**5. Follow-up questions can give away the correction.** In at least 3 of the 6 follow-ups on false claims, the question tells the learner the claim is wrong (for example, "if it is not stored in the transmission lines"). That goes against the "never reveal" rule in `QUESTION_SYSTEM`, which could use a line such as: "Do not say or imply that their claim is false."

### Limits of these numbers

- **Same author for answers and labels.** The AI builder wrote the answers after reading the checkpoints, so correct answers track them closely. Real learners will be messier, and 0 false fails is probably optimistic. Nothing here has been tried on real learners.
- **The two rules behind the false passes.** With labels matching the formula in `SPEC.md`, the two false-claim cases would count as passes, leaving 2 of 46. Leaving out the answer-key pastes as well gives 0 of 44. The headline keeps all 4, because the labels were frozen first.
- **Generated checkpoints are lightly tested.** Only 2 generated skills were scored, and they had no false passes other than the deliberate paste. The generator ran twice, because a bug in my title filter picked the wrong node the first time. That rejected node, "Probability basics", had vague checkpoints such as "Probability quantifies the likelihood of an event occurring", and it was never scored. Vague checkpoints like those remain a risk.
- **Follow-up check.** Re-pasting got through 1 of the 6 follow-ups on pasted answers (`sql-parrot` run 1). This was 12 runs with answers written for the check. See the chatbot runs above for someone who looks up the right answer.
- **Chatbot runs are small.** 48 answers from 2 models, graded once each, by prompts we wrote. Other prompts or models could do better or worse.
- **The grader changed slightly after the labelled runs.** Quotes must now be at least three whole words, and the prompt says so. The shortest quote credited in `results.json` is 6 words, so the check itself would not change those runs. They have not been rerun with the new prompt. The chatbot runs did use it.
- **One checkpoint looks overstated.** "The read_csv function ... parsing delimiters automatically" isn't quite right, since pandas assumes a comma unless told otherwise. It did not change a verdict here.
