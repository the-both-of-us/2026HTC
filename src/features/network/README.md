# network

**Owner:** Mirza. See `TEAM.md`.

Match people by proven skills: "Priya proved what you're learning, ask her." Joining is opt-in: a person makes a profile at `/people`, and it shows everyone the skills they have proved. Leaving deletes it.

The UI is exported from `@/features/network/client`: `NetworkScreen` (`/people`). Everything else is server code from `@/features/network`.

**Status:** built.

## Storage

| Key | Holds |
|---|---|
| `network/profiles/<userId>` | `ProfileRecord`: `userId` (server only), `publicId` (random, the only id a browser sees), `displayName`, `city`, `lookingFor`, `contactUrl`, `joinedAt`, `updatedAt`, `isDemo`, and for demo profiles only `demo` (their made-up skills). |

Skills are **never stored or typed**. They are worked out on each request from the person's own maps (`listMapsByOwner`) and progress (`getProgress`, then `deriveNodeStates`):

- **Proven:** titles of proven nodes, deduplicated ignoring case and punctuation, each with its map's title.
- **Evidence link:** `/proof/<id>` when the owner's own evidence page for that map (`getOwnProofForMap`) is live and shows that skill. A skill proved after the page was published gets no link, because the page doesn't show it. A revoked page, or a record that isn't the owner's, gets none.
- **Learning:** titles of available or locked nodes, minus anything already proved on any map in a close wording.

Everyone's skills are worked out afresh on every listing, so a skill proved a moment ago shows and a revoked evidence page loses its link at once. Nothing is cached between requests. Each person costs one listing of their own index keys plus a read of each of their maps, never a read of everyone's maps (see skill-map's owner index).

## API

| Route | Does | Who |
|---|---|---|
| `GET /api/network` | `NetworkView`: `{me, mentors, peers, everyone, viewerHasMaps, signedIn, signInRequired, displayName}` | Anyone |
| `PUT /api/network` `{displayName, city?, lookingFor?, contactUrl?}` | `{me}`: join, or update your profile | Signed in, once Auth0 is set up |
| `DELETE /api/network` | `{ok: true}`: leave, which deletes your profile | Anyone. Leaving twice is fine. |
| `GET /api/network/practise?skill=<title>` | 303 to that skill on the viewer's own map (`/map/<id>?skill=<nodeId>`), or to `/courses?q=<title>` if none of their maps has it | Anyone. Only the viewer's own maps are read, so a map id only reaches its owner, in a redirect. |

Errors are `{error: "a sentence for people"}` with a 400, 401 or 500. Raw errors only go to the server log, prefixed `[network]`.

Every profile leaves the server through `toPublicProfile` (field by field) or `toMyProfile`. No response carries a user id, an owner id or a map id: `src/app/api/network/routes.test.ts` checks every body.

## Rules

- The user id always comes from `getUserId()`, never from the request.
- **Name:** control characters removed, whitespace collapsed, 1 to 40 characters with a letter or digit. "OryxLearn team" is refused in any spelling. Pre-filled with the signed-in name.
- **City:** optional, up to 40. **Looking for:** optional, one line, up to 120.
- **Contact link:** optional, up to 200, and only a whole `https:` URL with no name or password in it. `javascript:`, `data:` and `http:` are refused. It shows as "Contact on linkedin.com" with `target="_blank" rel="noopener noreferrer nofollow"`.
- `rules.ts` holds these checks as plain functions, so the form checks the same rules before sending.
- **Sign-in:** with Auth0 set up, joining or editing needs a signed-in session for that same user id (401: "Sign in to join the network, so people know it's really you."). Without Auth0 (tests, offline development), guests may join. Leaving never needs a sign-in.

## Matching

Only when the viewer has a profile or at least one map. Titles are normalised (lower case, punctuation to spaces, spaces collapsed; `+` and `#` become words so C++ and C# differ). Two titles match when equal, or when their word sets overlap by a Jaccard similarity of 0.6 or more, after dropping filler words ("and", "the", "of"...) and plural endings. So "SQL joins" matches "SQL joins and unions", and "SQL queries" matches "SQL query writing".

For every other profile:

- `mentorFor`: their proven skills the viewer is still learning (3 points each)
- `sharedLearning`: skills both are learning (2 points)
- `sharedProven`: skills both proved (1 point)

Sections, each person once, in the first that fits: **Could mentor you** (mentorFor > 0), **Learning what you're learning** (sharedLearning > 0), then **Everyone (else) in the network**, which also carries matches (so someone who only proved the same skill as you shows "Also proved X, like you." at the top of it). Best score first, real people before demo profiles on a tie. Each match carries `reasons` in words, such as "Proved SQL joins, which you're learning."

## Demo profiles

Six made-up people (`demo.ts`) whose skills are titles from the three sample maps, so a first visitor sees matching work. Each card says "Demo profile", the page says "Demo profiles are made up so you can see how matching works. They are not real people.", and they never have a contact link.

- Seeded on `GET` with `claimDoc`, so two servers seeding at once still store one of each. Concurrent calls on one server share a run, and the check is skipped for 5 minutes after it passes. If seeding fails, real profiles still list.
- Their user ids (`demo-network-priya`...) are deliberately not UUIDs: identity only accepts a UUID cookie, so nobody can act as one, and `deleteUserData` refuses them.
- Changing the list: bump `DEMO_VERSION`, and each stored demo is rewritten once, keeping its public id.

## Delete my data

`deleteUserData(userId): Promise<{ profiles: number }>` removes the person's profile. Only UUID ids are accepted, only that one key changes, and it can run twice. There is nothing else to remove: skills are never stored here.

## Files

- `network.ts`: the view, join and leave. `matching.ts`: title matching and scoring, as plain functions. `skills.ts`: skills from maps and progress. `demo.ts`: the demo profiles.
- `profiles.ts`: store reads and writes. `rules.ts`: field checks. `session.ts`: the sign-in seam. `http.ts`: request parsing and error responses. `deleteData.ts`: "Delete my data".
- `ui/api.ts`: fetch helpers that turn every failure into a sentence. `ui/view.ts`: labels, as plain functions. `ui/NetworkScreen.tsx`: the page.

## Tests

`npm test -- network` runs the feature's tests and the route test. The AI is mocked and never reached.

## Clickable skills

Every skill on someone's card is a button: it filters the page to the people who proved it (`skillsMatch`, so close wordings count), with a bar that says how many, a "Practise <skill>" link and "Show everyone". Cards that could mentor you also list up to 3 "Practise on your map" links for the skills they proved that you're learning. Practise links go through `GET /api/network/practise` (`practise.ts`), which prefers a skill you can start now, then a locked one, then one you proved, newest map first.
