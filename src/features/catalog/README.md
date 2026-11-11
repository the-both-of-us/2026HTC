# catalog

The shared registry of canonical topic courses and programs (wave 2): every topic course and program is generated once and reused by everyone who asks for the same subject at the same audience. It holds identity, names and the resolver; it does no generation.

- Types and store keys: `types.ts` (top comment). Keys are built only through `catalogKeys`.
- Identity: `audKey(audience)` ("general" when empty), `titleKey(title)`, `aliasHash(text)`. Raw request text is never stored.
- Resolver: `resolveCourse`, `resolveCourses` (batch), `resolveProgram`, `resolveAuto`: alias, exact name, then at most one `check` call (`catalog-resolve`) over at most 12 candidates; code checks the pick.
- `claimCourse` / `claimProgram` write the doc, then claim the alias, then the name. A lost alias claim returns the winner (our doc is deleted); a lost name claim points our alias at the name's winner, so two phrasings of one title merge. `claimProgram` also writes `catalog/program-seeds/<id>` (title, summary, audience, depth) for the planner.
- `readCatalogProgram(id)`: ready (the final frame), planning (from `partial/catalog/programs/<id>`, courses with their `courseId` once registered) or stalled (claimed, no live writer).
- `readCatalogSyllabus(courseId)`: final, planning (from `partial/catalog/syllabi/<courseId>`) or idle.
- Canonical docs hold no owner id, no source text and no learner data. Postings and PDFs never enter the catalog.

Tests: `catalog.test.ts` (no call on an exact hit, the 12-candidate cap, a bad pick counts as new, audiences never mix, concurrent claims give one id, no learner words in any canonical key or doc). The cross-feature psychology case is in `features/programs/catalog-flow.test.ts`.
