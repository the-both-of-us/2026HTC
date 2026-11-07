# quiz

**Owner:** Mirza. See `TEAM.md`.

A multiple-choice quiz for each skill on a map, so a learner can check what they know before they teach it back. Every answer is explained. The UI is `QuizTab`, exported from `@/features/quiz/client` and shown in the skill panel. Everything else here is server code.

**Status:** built. `QuizScreen` is still a placeholder.

## How a quiz is made

1. `getOrCreateQuiz(mapId, nodeId, viewerId, options?)` loads the map with `getSkillMap`, checks the node is on it and that the viewer may read the map (see below). Only then does it build the store key, so raw input never reaches the store.
2. A saved quiz is returned as it is. Otherwise one `chatJSON` call (label `quiz`) asks for 5 questions about the node's title, why and checkpoints.
3. `validateQuiz` checks the reply in code: it trims text, drops empty, overlong and duplicate questions, needs 4 distinct options (ignoring case), strips any "A." or "2)" label the model added, and rejects true catch-alls such as "All of the above" or "None of these" (an answer like "All of them" is kept). A question whose prompt or explanation points at an option by position ("option B", "the first one") is dropped, since the options are shuffled. It keeps 3 to 6 questions; fewer than 3 throws a `QuizError` (502) and nothing is saved.
4. The model puts the right option first. Code shuffles the options and sets `answerIndex`, so answers are not stuck in one position. Ids, `mapId`, `nodeId` and the citation are set by code too.

The citation is the node's own, and only when `verified` is true. The model never writes one.

## Who may read

A map's owner may always read and make its quiz. Anyone else may only once the map is published as a course (`isPublished` from `@/features/courses`). A private map someone else owns gets exactly the same 404 and sentence as a missing map, so nobody can tell it exists. The check runs for every caller before any store key is built, any store read or any model call, and before a request can join a generation already in flight, so a stranger can't wait on the owner's generation and receive its questions.

## The posting is data

The map title and node text came from a posting someone pasted. `buildQuizPrompt` puts them inside `<skill>` tags, removes any copy of those tags from the text, and the system prompt tells the model to ignore instructions inside.

## Cost

The AI allows about 5 requests a minute, so:

- Opening a skill only reads the store (`GET`). The quiz is made when the learner presses **Make a quiz**.
- Each quiz is saved once per node and reused by everyone who may read that map.
- Concurrent requests for the same node share one model call, through an in-memory map of pending promises.

## API

| Route | Returns |
|---|---|
| `GET /api/quiz?mapId=&nodeId=` | `{items}`: the saved questions, or `null`. Never calls the model. |
| `POST /api/quiz` `{mapId, nodeId}` | `{items}`: the saved questions, or new ones. |

Both routes pass the viewer from `getUserId()`. Errors are `{error: "a sentence for people"}` with a 400, 404, 500, 502 or 503. A private map that isn't yours is the same 404 as a missing one.

The response includes `answerIndex`, since this is self-study. **Battle must strip `answerIndex` (and the explanation) before sending questions to players.**

## Keyboard

Keys are handled only on the quiz's own region, never on the page, so typing in the teach-back box above is never taken. Keys pressed in a text field are ignored.

| Key | Does |
|---|---|
| `1` to `4` | Chooses that option, before answering |
| `Enter` | Next question, after answering. Answering moves focus to **Next question**, so Enter or Space there moves on |
| `Tab` | Moves between the options and buttons, which all work by mouse or touch too |

When a button press removes the focused control (making a quiz, an error, trying again), focus moves to whatever replaced it: the loading line, **Make a quiz**, the error's retry button, or the first question. Right and wrong are shown with words and an icon, not colour alone. The explanation is in an `aria-live` region.

## Storage

- `quiz/<mapId>/<nodeId>`: `{items: QuizQuestion[], createdAt}`.

## Files

- `quiz.ts`: `getSavedQuiz`, `getOrCreateQuiz`.
- `validate.ts`: the reply schema, checks and shuffle. `prompt.ts`: the prompts. `http.ts`: request parsing and error responses (tested in `http.test.ts`).
- `ui/quizState.ts`: progress, scoring, key handling and where focus goes, as plain functions. `ui/api.ts`: fetch helpers.

## Tests

`npm test -- quiz` mocks the model. `quiz.test.ts` covers saving and reuse, one call for concurrent requests, the deadline, unknown maps and nodes, and who may read a private or published map (including that a stranger can't join the owner's in-flight generation).

## Delete my data

`deleteForMaps(mapIds)` removes the saved items for those maps. "Delete my data" calls it with the user's own map ids, before deleting the maps. Ids that aren't UUIDs are ignored, and it can run twice.
