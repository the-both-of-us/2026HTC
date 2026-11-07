# circles

**Owner:** Abdu. See `TEAM.md`.

Study circles: a group learns the same map together. Students and curious people, not job seekers.

- The map's owner presses **Start a study circle** in the map header (`ui/StartCircleButton`). That makes `circles/<code>` and shows a big QR code for `/circle/<code>`.
- Joining (`joinCircle`) gives each person their **own copy** of the map with skill-map's `copySkillMap`, and records `circles/<code>/members/<userId>`. Joining again returns the same copy.
- The circle page (`ui/CircleScreen`) polls `GET /api/circles/<code>` every 3 seconds: the shared map with initials on each proved skill, members with "x of N proved", and the newest proofs first.
- Progress is read only through teachback's `listProvedNodes`. Explanations are never shown to other members, and the API returns names, skill ids, titles and times, never user ids.
- `deleteCircleData(userId)` runs from "Delete my data": it removes the user's memberships and closes the circles they started. Members' own copies stay theirs.

Codes are 10 base32 characters (50 random bits), checked against a pattern before they reach a store key.

Tests: `npm test -- circles`.
