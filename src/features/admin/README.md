# admin

**Owner:** Abdu.

`/admin` shows everyone who has used OryxLearn: signed-in accounts and guests, each with their maps (and courses), programs, what they typed to build them, feed interests, People profile and streak, plus one list of everything typed, newest first. Read-only: it changes nothing.

- **Passcode:** `ADMIN_PASSCODE` in the environment (`.env.local`, Vercel, AWS). It is never in the repo. With none set, the page says admin is off and the API answers 404.
- `POST /api/admin/session {passcode}` checks it in constant time and sets `pf_admin`: `<expiresAt>.<HMAC>` (SESSION_SECRET, purpose "admin", also covering a hash of the passcode, so changing it signs every browser out). httpOnly, SameSite=Strict, 8 hours. `DELETE` locks it again.
- 5 wrong passcodes from one address lock that address out for 10 minutes (per server instance), and each wrong try waits 400 ms.
- The page sets `noindex` and is not in the sidebar.
- **What a name means:** OryxLearn stores no email or name at sign-in (see the Trust page), so a name only shows when the person typed one: a People profile or a published course's author name. Accounts show their sign-in provider and date.
- `overview.ts` reads every map, program, account, profile, course listing, proof key, feed interest and streak. Fine at hackathon scale; it would need an index past a few thousand maps.

Tests: `npm test -- admin`.
