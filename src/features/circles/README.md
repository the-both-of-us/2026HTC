# circles

**Owner:** Abdu. See `TEAM.md`.

Study circles: a group learns the same map together. Students and curious people, not job seekers.

- The map's owner presses **Start a study circle** in the map header (`ui/StartCircleButton`). That makes `circles/<code>` and shows a big QR code for `/circle/<code>`.
- Joining (`joinCircle`) gives each person their **own copy** of the map with skill-map's `copySkillMap`, and records `circles/<code>/members/<userId>`. Joining again returns the same copy.
- The circle page (`ui/CircleScreen`) is built for a projector at 1280x720 and up, and for phones. It polls `GET /api/circles/<code>` every 2.5 seconds, never two at once, and the server keeps each read for 1.5 s, so a room of screens costs about one store read.
  - **Shared map:** skill-map's `MapCanvas` with `compact`: title-only cards that fit the whole map, titles at 15px or more on screen, and who proved each one as initials (names in the tooltip).
  - **The race** (`ui/CirclePanels`): everyone by topics proved, with a bar each. **Live activity:** the newest proofs, with one-tap cheers.
  - **Live moments** (`ui/CircleToasts`): a proof that arrives with a poll shows "Sam just proved X" and pulses that card. A cheer on your proof shows "Lee cheered your proof of X". The first load never replays history. Toasts are announced in a polite live region, and motion stops for reduced motion.
  - **Invite** (`ui/Invite`): a big QR code in a dialog, plus "Share invite" (the phone's share sheet, or a copied link, saying which).
- **Cheers:** `cheerProof` stores `circles/<code>/cheers/<itemId>/<userId>`, so a second tap changes nothing. Members only, never on your own proof. A feed item's `itemId` is a hash of the circle, the user and the skill, so it never reveals a user id.
- Progress is read only through teachback's `listProvedNodes`. Explanations are never shown to other members, and the API returns names, skill ids, titles and times, never user ids.
- `deleteCircleData(userId)` runs from "Delete my data": it removes the user's memberships and cheers, and closes the circles they started (with their members and cheers). Members' own copies stay theirs.

Codes are 10 base32 characters (50 random bits), checked against a pattern before they reach a store key.

Tests: `npm test -- circles`.
