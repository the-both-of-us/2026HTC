# proof

**Owner:** Abdu. See `TEAM.md`.

The public evidence page at `/proof/<mapId>`, what the QR code opens. Anyone with the link can read it, with no sign-in.

- `evidence.ts`: `getEvidence(mapId, viewerId)` gathers the proven skills. A skill counts only if its stored attempt also says `proven`. It leaves out `ownerId`, which is the identity cookie, and the source text.
- `ui/ProofScreen.tsx`: a server component, so the page's data and the transcript are in the first HTML. It has no app navigation, because most visitors arrive from a QR code.
- `ui/ShareProof.tsx`: the client part, the QR code and copy-link button.

**What is shown:** each proven skill's checkpoints and quotes, the follow-up question and answer, the full explanation, the source quote, and the integrity signals, labelled as reported by the browser. Skills not proven yet are listed by title only.

Tests: `npm test -- proof`.
