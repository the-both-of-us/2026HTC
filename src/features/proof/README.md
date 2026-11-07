# proof

**Owner:** Abdu. See `TEAM.md`.

The public evidence page at `/proof/[id]`: what the person wrote, the verified quotes, the live follow-up, the score, integrity signals and sources. Anyone with the link can read it, with no account.

- `snapshot.ts`: builds the frozen document from server data. A skill only counts if its attempt holds up: same owner, same map and node, a passed follow-up, a passing score, and quotes that are in the text.
- `hash.ts`: the canonical text form of a snapshot, its SHA-256 fingerprint, and `checkSnapshot`, which re-checks the fingerprint, every quote and every score with no AI.
- `publish.ts`: `publishProof`, `revokeProof`, `getProof`, `getOwnProofForMap`. Only the owner may publish or withdraw. Re-publishing keeps the same id, so printed QR codes keep working. Withdrawing removes the public copy and keeps only the date. The attempts behind it stay on the learner's map.
- `ui/ProofScreen`: the server-rendered page. Its owner also gets a link back to the map, and nobody else does, because maps are private. `ui/PrintSummary` replaces it on paper with one page.
- `client.ts`: `ShareProofButton`, with props `{ mapId, provenCount }`. It is the way in, from the map header and the result screen, so nothing is public until the person publishes it under a name they chose.

**Routes:** `GET` and `POST /api/proof` (owner), `DELETE /api/proof/[id]` (owner), `GET /api/proof/[id]/verify` (public).

**Never put in a snapshot:** the owner id, which is their identity cookie; the map id; the source text.

**What the fingerprint can't do:** on its own it only compares a record with itself, so someone with write access to the store could replace both. A printed copy lets a reader catch a later change. The seal (`sealFor`, an HMAC of the fingerprint keyed by `PROOF_SEAL_SECRET`) means an edit to the store breaks the check unless the editor also has that server key. Someone with the key, and the owner re-publishing, can still replace a record: there is no history.
