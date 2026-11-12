# flashcards

Writes 6 to 8 flashcards for one skill on a map, saves them, and shows them one at a time in the skill panel. The UI is in `ui/` and is exported from `@/features/flashcards/client`. Everything else here is server code.

**Status:** built. `FlashcardsTab` is live in the skill panel.

## How cards are made

1. `getOrCreateFlashcards(mapId, nodeId, viewerId)` loads the map with `getSkillMap`, checks the viewer may read it (see below) and finds the node. An unknown map or node is a 404 `FlashcardsError`, before any model call. Only then is the store key built.
2. Saved cards are returned as they are. Otherwise one `chatJSON` call (label `flashcards`, 2000 tokens, 15 seconds a request) writes them from the map title and the node's title, why and checkpoints. The prompt asks for every checkpoint to be tested by at least one card.
3. `validateDeck` checks the reply in code. It trims and collapses whitespace, and drops empty cards, repeated questions (ignoring case, spacing and trailing punctuation, so `C++` and `C#` stay different) and cards over the limits: 200 characters for the front and 500 for the back (the prompt asks for 160 and 400). It keeps at most 10. Fewer than 4 left is a 502 `FlashcardsError`, and nothing is saved.
4. Code sets every `id` (a random UUID), `mapId` and `nodeId`. The model never writes citations: a card carries the node's citation only when `citation.verified` is true, otherwise null.

## Who may read

Only a map's owner may read and make its cards. A map someone else owns gets exactly the same 404 and sentence as a missing map, so nobody can tell it exists. The check runs for every caller before any store key is built, any store read or any model call, and before a request can join a generation already in flight, so a stranger can't wait on the owner's generation and receive its cards.

## The skill text is data

It came from a posting a user pasted in. `buildFlashcardsPrompt` puts it inside `<skill>` tags and removes any copy of those tags from it, including spaced ones like `</ skill >`. It repeats until none are left, so `<</skill>/skill>` cannot rebuild one. The system prompt tells the model to ignore instructions inside.

## Cost

The AI allows about 5 requests a minute, so:

- Opening a skill only does the cheap `GET`. Cards are made when the learner presses **Make flashcards**, never on their own.
- Cards are saved once per map and node, and every later visit reads them.
- Concurrent requests for the same skill share one in-flight promise, so two quick clicks cost one call. This is per server instance.
- One `chatJSON` call can retry and fall through to other providers, so the server stops waiting after 45 seconds and answers with a 503 sentence, inside the route's 60 second limit. A late reply is ignored and nothing is saved.

## API

| Route | Returns |
|---|---|
| `GET /api/flashcards?mapId=&nodeId=` | `{items}` with the saved cards, or `{items: null}`. Never calls the model. |
| `POST /api/flashcards` `{mapId, nodeId}` | `{items}`, made now or already saved |

Both routes pass the viewer from `getUserId()`. Errors are `{error: "a sentence for people"}` with a 400, 404, 500, 502 or 503. Nothing here stores or sends `ownerId`.

For the review feature: `getSavedFlashcards(mapId, nodeId, viewerId)` from `@/features/flashcards` returns `Flashcard[] | null` and never calls the model. It throws a 404 `FlashcardsError` for an unknown map or node, or a private map the viewer does not own.

## Keyboard

Keys work only while the card itself has focus, so they never reach the teach-back text box. There are no page-wide listeners.

| Key | Does |
|---|---|
| Space or Enter | flips the card |
| Left arrow | previous card, question side |
| Right arrow | next card, question side |

If making cards fails, the message appears under **Make flashcards**, which stays focused and is how to try again. If loading fails, **Try again** moves focus to the Flashcards heading before it disappears.

Every action also has a visible button: **Show answer** or **Show question**, **Previous** and **Next**. The card face is a polite live region, and the side is written out ("Question", "Answer"), never shown by colour alone. The fade between faces runs only without reduced motion.

## Storage

- `flashcards/<contentId>/<nodeId>`: `{items: Flashcard[], createdAt}`.

## Source wording and the syllabus

`flashcardsSystemPrompt(sourceKind)` returns `FLASHCARDS_SYSTEM_PROMPT` byte for byte for a job posting. A topic or PDF course must not be called a job, so those say "a learner studying a course" and drop the posting and employer wording; the data block reads `Course:` and `Why it matters:` where a posting reads `Job:` and `Why the job needs it:`. A node built from a syllabus gets its objectives, key terms and scope lines from `skillBlock` (`@/features/skill-map`) inside the `<skill>` block. A node with none of those fields gives the old prompt (`prompt.test.ts` pins the hashes).

## Tests

`npm test -- flashcards` mocks the model. It covers validation, the prompt's tags, saving and reuse, one call for concurrent requests, the 45 second deadline, unknown maps and nodes, who may read a map (including that a stranger can't join the owner's in-flight generation), the HTTP errors and parsing (`http.test.ts`), the client's error sentences (`ui/api.test.ts`) and the deck's key handling.

## Delete my data

`deleteForMaps(mapIds)` removes the saved items for those maps. "Delete my data" calls it with the user's own map ids, before deleting the maps. Ids that aren't UUIDs are ignored, and it can run twice.

## Model

Generation uses the write profile of `@/features/ai` (Claude Haiku, 8k tokens, at most 45 s, inside a 50 s deadline).

**Shared per course.** Items are stored under `contentIdOf(map)` (the catalog course id for a catalog map, the map id for a posting or PDF map) and generated once under `startOnce`. A request that loses the claim waits up to 40 s for the other writer (`waitForOnce`) and gets a 503 sentence if nothing arrives. Stored items carry the content id; every reply sets `mapId` to the learner's own map.
