**The grader stops answers that state no facts. It does not stop a chatbot that states them, and neither does the follow-up.** Passing here shows the text states the facts and a follow-up was answered correctly. It does not show a person understood anything on their own.

### What changed since the last run

This run (Nov 7, about 20:50 UTC) used the grader on `main` after three changes: the pass mark moved from 70 to 65, quotes go through `isUsableQuote` (at least 3 words, found in the text by `@/shared/quote`), and `copiesCheckpoint` gives no credit for a checkpoint whose own words appear nearly unchanged in the answer. The labels are the ones frozen in `4f4f4e2`.

- **All 4 earlier false passes now fail, and no new one appeared: 0 of 48.** The two answer-key pastes (`sql-parrot`, `feedback-parrot`) went from 100 to 0, which is what the copy check is for. The two "every checkpoint plus a false claim" cases (`grid-all-plus-error`, `transactions-all-plus-error`) went from 80 to 55 and 47. That was also the copy check, not the false claim: those answers were written close to the checkpoints' wording, so one checkpoint each stopped counting. **A flagged false claim can still pass if everything else is met** (100 minus 20 is 80), so that decision below still stands.
- **The copy check costs honest answers too.** It removed credit from 4 of the 23 should-pass cases: `writing-strong` fell from 100 to 50 and is now the one false fail, `grid-strong` and `grid-ai-specific` from 100 to 75, and `abtest-strong` from 100 to 67. These answers were written by the AI builder after reading the checkpoints, so they repeat the wording more than a real learner would. Still, a learner who learned from the same words could lose credit the same way.
- **`abtest-strong` passes only because the mark is now 65.** It met 2 of 3 checkpoints (67). At 70 it would be a second false fail.
- **The 65 mark could add false passes.** A 3-checkpoint skill with 2 met now scores 67 and passes, while the labels call 2 of 3 a fail (the label rule asks for 70% of checkpoints). `stats-partly` scored exactly 67 in the earlier runs. In this run the copy check took it down to 33, so it does not show up as a false pass, but that is luck of wording, not the mark.

### Real chatbot answers (saved runs, not rerun)

The chatbot runs below were made before these changes, with the pass mark at 70, and they were not rerun because that costs gateway credit. Read against today's grader:

- **Given the checkpoints, as a failed attempt's result screen shows them:** 13 of 16 reached 70 then, and 15 of 16 reach 65. Replaying today's copy check on those saved answers, with no model call, removes one checkpoint's credit in 2 of 16 answers. One of those still scores 75, and the other was already a fail. So the copy check does not stop a chatbot that paraphrases. **The fail-once-then-ask-a-chatbot route is still open.**
- **Asked only what the map shows:** 0 of 32 reached 70, and 3 of 32 reach 65 (all three at 67). Those 3 never got a follow-up, because the run only asked one at 70 or more.
- **The live follow-up:** the same model's correct answer passed 13 of 13 then. Answers written to be wrong but confident passed 0 of 13.

### What to change, most important first

The lead decides these.

**1. Decide what a failed attempt shows.** Browsers no longer get checkpoints from `GET /api/maps/[id]` (only `checkpointCount`). The result screen still lists missed checkpoints after a failed attempt, and that is the route the chatbot runs used. It is useful teaching, so this is a real trade-off. Options: name only the topic of a missed checkpoint, or record an integrity signal when a credited quote nearly matches its checkpoint.

**2. Decide whether `copiesCheckpoint` should block or only flag.** It closed the answer-key paste completely in this eval (all 24 pasted checkpoints rejected across 6 runs), but it also cost 4 honest answers points and caused the one false fail. Turning it into a signal on the evidence page would keep the honest answers' scores and still show the reader that the wording matched.

**3. Decide whether a flagged false claim can still pass.** The model flagged the false claims in `grid-all-plus-error` and `transactions-all-plus-error` in every run. The formula still allows a pass with one such claim when everything else is met. Change: in `attempts.ts`, go to `not-yet` when `grade.misconceptions.length > 0`, and update `SPEC.md`. The follow-up stopped these learners in 6 of 6 earlier runs, because it aims at misconceptions first.

**4. 3-checkpoint skills and the 65 mark.** On 3 checkpoints, one miss now passes (67). On 4, one miss passes (75). That evens the two out, but it also means 2 of 3 is enough, which this eval's labels call a fail.

**5. Follow-up questions can give away the correction.** In at least 3 of the 6 follow-ups on false claims, the question tells the learner the claim is wrong (for example, "if it is not stored in the transmission lines"). `QUESTION_SYSTEM` could add: "Do not say or imply that their claim is false."

### Limits of these numbers

- **Same author for answers and labels.** The AI builder wrote the answers after reading the checkpoints, so correct answers track them closely, which is exactly what the copy check punishes. Nothing here has been tried on real learners.
- **The skills under test are frozen.** `skills.json` holds the checkpoints from the sample maps as they were when the labels were written. The sample maps on `main` have since been regenerated with a stricter prompt, so the live demo's checkpoints differ from these.
- **The follow-up spot check and the chatbot runs are older.** Both used the grader from before these changes, and neither was rerun.
- **The planted-quote test lost one case.** "Three real words cut off mid-word" was dropped, because `main`'s quote check matches inside words: a quote such as "very single da" counts if those letters are in the text. It still has to be at least 3 words and copied exactly, so it can't invent evidence, but it is looser than the whole-word rule it replaced.
- **Small sample.** 71 cases, 3 runs each. The false-pass range still reaches 7%, and the false-fail range reaches 21%.
