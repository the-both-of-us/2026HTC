# proof

**Owner:** Abdu. See `TEAM.md`.

The public evidence page at `/proof/[id]`: what the person wrote, the verified quotes, the live follow-up, the score, integrity signals and sources. Anyone with the link can read it, with no account.

- `snapshot.ts`: builds the frozen document from server data. A skill only counts if its attempt holds up: same owner, same map and node, a passed follow-up, a passing score, and quotes that are in the text.
- `hash.ts`: the canonical text form of a snapshot, its SHA-256 fingerprint, and `checkSnapshot`, which re-checks the fingerprint, every quote and every score with no AI.
- `publish.ts`: `publishProof`, `revokeProof`, `getProof`, `getOwnProofForMap`. Only the owner may publish or withdraw. Re-publishing keeps the same id, so printed QR codes keep working. Withdrawing deletes the snapshot and keeps only the date.
- `ui/ProofScreen`: the server-rendered page. `ui/PrintSummary` replaces it on paper with one page.
- `client.ts`: `ShareProofButton`, with props `{ mapId, provenCount }`.

**Routes:** `GET` and `POST /api/proof` (owner), `DELETE /api/proof/[id]` (owner), `GET /api/proof/[id]/verify` (public).

**Never put in a snapshot:** the owner id, which is their identity cookie; the map id; the source text.

**What the fingerprint can't do:** it shows the record matches what was published, and a printed copy lets a reader catch a later change. It does not stop someone with write access to our store from replacing both record and fingerprint before a reader has a copy.
