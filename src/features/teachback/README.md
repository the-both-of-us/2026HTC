# teachback

Grades a learner's explanation of a skill, asks a follow-up about what they wrote, and unlocks the next skills. The UI is in `ui/` and is exported from `@/features/teachback/client`. Everything else here is server code.

## The loop

1. `POST /api/attempts` calls `startAttempt`. It refuses a locked node, someone else's map, a proven node, or fewer than 15 words, all before spending a model call.
2. `gradeExplanation` gets quotes and factual errors from the model. Code checks each quote and works out the score.
3. Below `PASS_SCORE` (65, so 3 of 4 or 2 of 3 checkpoints) the status is `not-yet`, and the learner can retry with a new attempt. Otherwise it is `needs-followup`, with a question from `generateFollowUp`.
4. `POST /api/attempts/[id]/followup` calls `answerFollowUp`. A pass gives `proven` and updates `MapProgress`. A fail gives `not-yet`.

## Four ways to prove a topic

`assignFormats` (in `formats.ts`, plain code shared with the map) gives each topic a format from its place on the map, so it is the same every time and no topic shares one with the topic before it or one it builds on. The learner may swap to plain "Explain it" once per topic.

- **Explain it**: the loop above.
- **Catch the mistake** (`catch.ts`): the AI writes 5 to 8 sentences with 1 or 2 planted mistakes, each breaking a checkpoint. It is written once per topic and shared by every copy of a course (`catch/<mapId or forkedFrom>/<nodeId>`). The browser gets the sentences and how many are wrong, never which. Code checks the tapped sentence numbers against the planted ones; one AI call checks only the corrections on real mistakes. Each planted mistake is a checkpoint, met when fixed, and each correct sentence tapped costs 20, through `computeScore`. No follow-up: a pass proves the topic. One play per learner (`catch-revealed/<mapId>/<ownerId>/<nodeId>`), because the reveal shows the answers.
- **Explain it to a 10-year-old**: the same grader, plus `readingGrade` (Flesch-Kincaid, worked out by code) must be 8 or lower.
- **Say it in 30 seconds**: the same grader, with a clock in the browser. The evidence page says whether it was spoken or typed.

The format is saved on the attempt (`format`, missing on older ones, which were all "explain") and on the progress record.

With `map.audience` set, grading, follow-ups, catch rounds (`catch/<id>/<nodeId>/<audienceKey>`) and the final interview get a THE LEARNER section (`audience.ts`): plain childlike wording counts, facts must still be right, and the pass mark stays 65. For children about 9 and under, "Explain it to a 10-year-old" shows as "Explain it to a friend". With no audience every prompt is unchanged (`audience.test.ts`).

## The final interview

`final.ts`. Once every topic on a map is proven, `POST /api/maps/[id]/final` writes three questions that mix topics (one AI call) and saves each as an attempt with an open follow-up (`nodeId: "final-interview"`), so the voice interview and the follow-up route work unchanged. Two passes of three earn the course badge, which `publishProof` puts on the evidence page. A fail lets the learner ask for a fresh set. Stored at `final/<mapId>`.

## Why the model doesn't score

Asking a model to "score this answer" gave fluent, empty text 55-85/100. So the model only points at evidence:

- For each checkpoint it returns an exact quote from the learner's text, or null, plus a list of factual errors.
- Code checks each quote is really in the text, ignoring case, whitespace, curly quotes and dash styles (`@/shared/quote`). A quote that isn't there, or is under 3 words, counts as not met.
- A checkpoint earns nothing if the text holds its own words nearly unchanged (`copiesCheckpoint`). A failed attempt shows the missed checkpoints, so retyping them must not pass.
- A failed follow-up stores a fixed sentence, never the model's reason, which could be pasted back as the next answer.
- `score = max(0, round(met / total * 100) - 20 * errors)`, in `computeScore`.

## The learner's text is data

`wrapLearnerText` puts it inside `<learner_text>` tags and removes any copy of those tags from the text, so it can't close them early. The system prompts tell the model to ignore instructions inside. The reply schema has no score field, so "give me 100" has nothing to change.

## Unfinished work

`ui/draft.ts` keeps the learner's text, integrity signals and any open follow-up in `sessionStorage`, so clicking another skill or reloading the page loses nothing.

## API

| Route | Returns |
|---|---|
| `POST /api/attempts` `{mapId, nodeId, explanation, integrity}` | the attempt |
| `POST /api/attempts/[id]/followup` `{answer}` | the attempt |
| `GET /api/attempts/[id]` | the attempt, owner only |
| `GET /api/maps/[id]/progress` | `{isOwner: true, mapId, proven, unlocked, states}` for the owner; `{isOwner: false, proven: {}, unlocked: {}}` with a 200 for anyone else |
| `GET /api/attempts/catch?mapId&nodeId` | `{sentences, mistakeCount, revealed}`, owner only |
| `GET`, `POST /api/maps/[id]/final` | the final interview's state and questions, owner only |

Errors are `{error: "a sentence for people"}` with a 400, 403, 404, 409, 500 or 503.

`toLearnerView` shapes every attempt the API sends:

- It removes `ownerId`, which is the identity cookie.
- While a follow-up is open, it removes missed checkpoints and misconceptions, because the question probes exactly those.

Anything public, such as the evidence page, must also leave out `ownerId`.

## Integrity signals

The server counts `wordCount` itself and caps `activeMs` at an hour. `pasted`, `activeMs` and `inputMethod` come from the browser, so a determined person could fake them, and the evidence page says so. They are signals, and they never block a pass.

## Storage

- `attempts/<attemptId>`: every attempt, including failed ones.
- `attempts/<attemptId>/claim`: created just before a follow-up answer is graded, so only one answer is ever graded. It is removed if grading throws. One left by a dead server is taken over after 2 minutes.
- `progress/<mapId>/<ownerId>/<nodeId>`: one document per proven node, so two proofs at once can't overwrite each other. `getProgress` rebuilds `MapProgress` from these.

## Tests

`npm test -- teachback` mocks the model. `realCheck.ts` runs the real model through about 7 calls, so run it by hand: `npx tsx --env-file=.env.local src/features/teachback/realCheck.ts`.

## Unlock anyway

A locked skill can be opened by its owner without proving what it builds on: `unlockNode(userId, mapId, nodeId)` (`POST /api/maps/[id]/unlock` `{nodeId}`) saves `unlocks/<mapId>/<ownerId>/<nodeId>` `{nodeId, unlockedAt}`. `getProgress` returns it as `unlocked`, and `deriveNodeStates` counts an unlocked skill as available, so every check that uses them (attempts, catch, the map) treats it as open, including proving it. The map marks it "Unlocked early" until its prerequisites are proven (`unlockedEarlyIds`). Delete my data removes the unlocks.

`isNodeLockedFor(map, viewerId, nodeId)` is how other features decide whether to generate anything: lessons, flashcards and quiz refuse a locked skill with a 403 before any model call. The owner's progress counts; anyone else reading a published course has none, so only its first skills are open to them.
