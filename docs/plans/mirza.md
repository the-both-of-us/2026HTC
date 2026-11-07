# Mirza's plan

Last updated: Sat Nov 7 2026. The short version is in `TEAM.md` under "Mirza's work, in order". This file has the detail: what each feature does, how the data is stored, which cloud services we use, and what Mirza needs from Abdu.

**Hard rule from `SPEC.md`: no login wall.** Everything works as a guest. Signing in is optional. It adds publishing, liking and the same account on every device.

## Order of work

Each step is done when it works in the running app with no raw errors on screen, and `npm test -- <feature>` passes.

| # | Feature | Done when | Target |
|---|---|---|---|
| 1 | `flashcards` | Cards show for any node, flip with Space or a button, arrow keys move between cards, a citation shows only if `verified`. Cards are saved after the first generation. Cards for the three sample postings are saved in advance. | Sat 6 PM |
| 2 | `quiz` | Multiple choice per node, answer with keys 1-4, an explanation after every answer. Saved and generated in advance the same way as flashcards. | Sat 6 PM |
| 3 | `courses` | Private by default, publish/unpublish, one like per user, "Start this course" copies the map, and the directory is seeded with the three sample courses. See below. | Sat 9 PM |
| 4 | `auth` | Optional sign-in and sign-out with Auth0. Publishing and liking need sign-in. Signing out gives a fresh guest id. See below. | Sat 11:30 PM |
| 5 | `network` | Match people by proven skills. Demo profiles are visibly labelled. | Sun 1 AM |
| 6 | `dashboard` + `review` | Dashboard shows your courses (private/public), proven skills, cards due and streak. Review is an SM-2 queue of due flashcards. | Sun 3 AM |
| 7 | `battle` | Stretch only: scan a QR code, play a live quiz, polling every 1-2 s. | if time |
| 8 | `docs/submission/` | Devpost text, AI disclosure, video script (3 minutes to fit the presentation), MLH categories chosen. | start by Sat 10 PM |

If time runs short, drop in this order: battle, then auth, then review. Courses still demo well with guest identity.

## Rules for every feature

- **AI calls are cached.** The free tier allows about 5 requests a minute per model. Generate once, save to the store, and serve the saved copy after that. Demo postings get theirs generated in advance, like `skill-map/fixtures`.
- **Each feature owns one store prefix** and never reads another feature's keys. Mine: `flashcards/`, `quiz/`, `courses/`, `likes/`, `review/`, `network/`, `battle/`, `accounts/`.
- **Never send `ownerId` or `authorId` to a browser.** They are identity cookie values.
- **Errors are sentences with a retry**, never raw errors.

## Flashcards and quiz

- Store keys: `flashcards/<mapId>/<nodeId>` and `quiz/<mapId>/<nodeId>`, one document per node, holding the list.
- Generated from the node's `title`, `why` and `checkpoints`. Checkpoints are already specific, checkable facts, so they make good cards and questions.
- A card or question can only have a citation copied from its node's verified citation. The model never writes citations.
- API: `GET /api/flashcards?mapId=&nodeId=` and `GET /api/quiz?mapId=&nodeId=` return saved items, or generate and save them first.

## Courses: private and public

Every map a user creates is a **private course**, and only its owner can open it. Publishing adds a listing to the public directory, and unpublishing removes it.

```ts
// Lives in features/courses, not shared/types.ts.
type CourseListing = {
  mapId: string;
  title: string;
  subtitle: string;
  authorId: string;   // server only
  authorName: string;
  skillCount: number;
  likeCount: number;  // a running total; it can be recounted from the like documents
  publishedAt: string;
  forkedFrom?: string;
};
```

| Key | Holds |
|---|---|
| `courses/<mapId>` | The listing. Present means public. |
| `likes/<mapId>/<userId>` | One like. Writing it twice does nothing, so a user can't like twice and two people liking at once can't overwrite each other. |

| Route | Does | Who |
|---|---|---|
| `GET /api/courses?sort=popular\|new&q=` | Directory | Anyone |
| `GET /api/courses/mine` | My courses, private and public | Me |
| `POST /api/courses` `{mapId}` | Publish | Owner, signed in |
| `DELETE /api/courses/[mapId]` | Unpublish | Owner |
| `PUT` / `DELETE /api/courses/[mapId]/like` | Like / unlike | Signed in |
| `POST /api/courses/[mapId]/start` | Copy the map to me, return the new id | Anyone |

- **Starting a course copies the map** under a new id with `forkedFrom`. Teachback stays unchanged (it refuses someone else's map), and the learner's map doesn't change when the author edits theirs.
- **Pages:**
  - `/courses`: search and sort.
  - `/courses/[id]`: preview the skill list, then Start or Like.
  - `/dashboard`: "My courses" with a Private/Public toggle.
  - `PublishCourseButton` in the map header becomes that same toggle.
- **Seed:** the three sample postings, published under the labelled author "OryxLearn team". Never placeholder titles.

## Auth: optional login with Auth0

Auth0 rather than Cognito, because Auth0 is an MLH prize category and the effort is the same.

**The guest id becomes the permanent user id.** The first time someone signs in, we save `accounts/<auth0 sub>` holding the guest id from their cookie. Signing in on another device puts that same id back in the cookie. No data moves, and every feature keeps calling `getUserId()`.

- **Routes:**
  - `/api/auth/login` sends the user to Auth0.
  - `/api/auth/callback` checks the token, sets the session and links the account.
  - `/api/auth/logout` clears the session.
- **Signing out also gives a fresh guest id.** Judges share one laptop at the table, so the next person must not see the last person's private courses.
- **Signed cookie:** the `pf_uid` cookie gets an HMAC signature once ids can belong to accounts, so a pasted id is rejected.
- **UI:** a "Sign in" button, or a name plus "Sign out", in `SideNav`.
- **Delete my data** also deletes `accounts/<sub>`. The trust page says so (this matters for the accessibility and privacy sidepot).
- **Known gap:** guest progress already on a second device stays under that device's old guest id.
- **Check first:** the Auth0 Next.js SDK hooks in through middleware, and Next 16 changed middleware. Read `node_modules/next/dist/docs/` and confirm the SDK works. If it doesn't, write the three routes by hand against Auth0's standard sign-in flow (OpenID Connect).

## Cloud and sponsor choices

| Need | Choice | Why |
|---|---|---|
| Hosting | AWS container (Next.js `output: "standalone"`) | Routes need up to 120 s for AI calls. Credits: `#request-aws-credits` on Discord. |
| Storage | AWS S3, behind `@/shared/store` | Same four functions as today. Only one file changes. |
| Login | **Auth0** | MLH category. |
| AI | Groq / Cerebras, plus **Gemini**, with Bedrock as the last fallback | Gemini is an MLH category. Use it as the main model for flashcards and quiz so it is real use, not decoration. |
| Domain | **GoDaddy Registry** | MLH category. A nicer URL on the evidence QR code. |
| Grid data (Abdu, optional) | **Tiger Data** | MLH category. AESO data is a time series. |
| Not used | Solana, n8n, Arduino, Vultr | No payments allowed. The others don't fit. |

Worth considering later: **Adzuna** for "browse live Calgary jobs" on the landing page (local impact), and **Badgr** to turn proven skills into real Open Badges on the evidence page.

## Asks for Abdu

These are in Abdu's paths, so Mirza doesn't edit them.

- [x] Move `Flashcard`, `QuizQuestion`, `ReviewCard`, `PublicCourse`, `PeerProfile` and `BattleRoom` out of `shared/types.ts` into their features. `PublicCourse.likedBy` is replaced by the like documents above.
- [x] Map reads check visibility: only the owner can read a map unless `courses/<mapId>` exists. Today anyone with the link can read it.
- [x] Add `skill-map` exports `copySkillMap(mapId, newOwnerId)` and `listMapsByOwner(ownerId)`.
- [ ] `shared/identity.ts`: sign the cookie, add `getSession()` returning `{ userId, signedIn, displayName }`, and add a way to set the user id after sign-in.
- [ ] Give Mirza ownership of `src/features/auth/` and `src/app/api/auth/` in `TEAM.md` and `CODEOWNERS`.
- [ ] Add a Gemini route in `features/ai/routes.ts`, and a way for a caller to name a preferred route.
- [ ] Move `parseBody` and `errorResponse` from teachback into `src/shared/http.ts`, since every route needs them.
- [ ] Add `import "server-only"` to server feature `index.ts` files.
- [ ] AWS move: S3 store driver, Bedrock route, container deploy. Update `.env.example` and the Vercel notes in `TEAM.md`.
- [ ] Register the GoDaddy domain and point it at the deployment.
