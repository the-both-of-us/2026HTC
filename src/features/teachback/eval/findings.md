**The grader did the job it was built for.** No fluent-but-empty, generic AI or prompt-injection answer passed in 81 runs, and the highest score among them was 25. All 10 informal-but-correct answers passed on all 3 runs, including a voice-style transcript, an English-learner answer with mistakes, curly punctuation, French and Arabic.

The false-pass rate is under the 10% line at 8.3%, but its range reaches 20%, so this sample doesn't prove it is under 10%. All 4 false passes come from two causes, and neither is the model being fooled.

### What to change, most important first

The lead decides these. `grading.ts` was not edited.

**1. Don't send the answer key to the browser.** `sql-parrot` and `feedback-parrot` paste the checkpoints word for word and scored 100 in 6 of 6 runs. Those checkpoints are reachable: `toPublicMap` returns `nodes` with `checkpoints`, and anyone with a map id can read them from `GET /api/maps/[id]`. `generate.test.ts` line 117 asserts this. It also undercuts the follow-up, where `format.ts` notes that the server holds back missed checkpoints while a follow-up is open.
- Change: send a checkpoint count in place of the text in `toPublicMap`, and update that test. The teach-back UI should need only the count, since it uses `node.checkpoints.length`.
- The result screen still shows missed checkpoints after a failed attempt, so a retry can copy them. That is useful teaching, so keep it, but add an integrity signal when a credited quote nearly matches its checkpoint's wording. It should be a signal and not a block, because honest answers can also come close.
- No prompt change is recommended here. A code check is exact and easy to explain.

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
- **Follow-up check.** Re-pasting got through 1 of the 6 follow-ups on pasted answers (`sql-parrot` run 1). This was 12 runs with answers written for the check, and it says nothing about someone who looks up the right answer.
- **One checkpoint looks overstated.** "The read_csv function ... parsing delimiters automatically" isn't quite right, since pandas assumes a comma unless told otherwise. It did not change a verdict here.
