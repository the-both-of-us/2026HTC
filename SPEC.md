# OryxLearn: Build Spec (Hack the Change 2026)

Deadline: Devpost, **Sun Nov 8 2026, 11:30 AM Calgary time, sharp**. Team of 2 (VVarrior1, MirzaHB). Both must be able to explain every part of the code. The team split is in `TEAM.md`.

## Pitch

Paste a real job posting, upload a PDF or name a topic. OryxLearn turns it into an interactive skill map, with teach-back, flashcards and a quiz in every node. You unlock each skill by explaining it in your own words and answering a live follow-up question about what you just wrote. The result is a shareable evidence page an employer can check, showing what you proved and how.

**Prompt 2:** develop in-demand skills and build meaningful networks in a rapidly changing job market.
**Focus areas:** AI-driven skilling and verifiable portfolios (1), matching talent with mentors (2).
**Local hook, verified from StatCan:** Alberta unemployment 7.3% vs Canada 6.7%, Oct 2026.

## The core loop (must never break)

1. **Input:** paste a posting, upload a PDF or name a topic.
2. **Map:** an interactive dependency graph. Nodes stay locked until their prerequisites are proven.
3. **Teach-back:** explain a skill by typing or by voice.
4. **Grade:** fixed checkpoints, with quotes verified in code, and a score computed in code (see below).
5. **Follow-up:** one live question about the learner's own answer. Passing it is required.
6. **Unlock:** the node is proven, and the next nodes open.
7. **Evidence page:** public URL and QR code, showing proven skills, the transcript, integrity signals and sources.

## Grading method (tested on 2026-11-07, do not replace with free-form scoring)

Free-form "score this answer" gave a fluent, empty answer 55-85/100. This method dropped it to 0-25 on Cerebras:

- The model returns, for each checkpoint, an exact quote from the learner's text or null, plus a list of factual errors.
- Code, not the model, verifies each quote appears in the learner's text after normalising case and whitespace. Unverified quotes count as not met.
- Code computes: `score = max(0, round(met / total * 100) - 20 * errors)`.
- Pass requires `score >= 65` and a passed follow-up. That means 3 of 4 checkpoints, or 2 of 3, with no factual errors.

Checkpoints are generated per node when the map is created. That generation is untested, so `npm run eval` must measure it.

## Citations (trust feature, not decoration)

Every node cites where it came from: an exact quote from the posting, or a quote and page number from the PDF. Code verifies that the quote appears in the source text, or on that page. If unverified, the UI says so rather than showing a citation.

## Integrity signals

The teach-back records whether text was pasted, active typing time, and word count. They are shown honestly on the evidence page. They are signals, never accusations, and do not block a pass.

## Demo reality

- Rounds 1-2 are judged **at tables** on a laptop, in front of 3-4 judges. Finals go to all judges.
- A judge picks a skill, explains it, the AI catches a real gap, they scan a QR code and see the evidence page on their own phone.
- Keep cached real responses for the demo postings, so a provider failure cannot end the demo.

## Checkpoints

- **CP1, core loop:** skeleton, landing, posting to map, teach-back with follow-up, unlocks, persistence. Deployed.
- **CP2, study tools and trust:** flashcards and quiz in each node, public courses, evidence page and QR, PDF input with verified citations, accessibility mode, trust and delete-my-data page, zero serious axe violations.
- **CP3, network and data:** QR quiz battle, matching by proven skills with labelled demo profiles, AESO live grid exercises (real data computed in code), StatCan labour numbers.
- **CP4, ship:** eval harness results, tests, README, Devpost draft with AI disclosure, demo script and Q&A prep, video script.

## Hard rules

- **Original work:** a judge okayed using the owner's earlier app OryxLearn for features and ideas. All code and design here is written new. OryxLearn is a read-only reference for behaviour. Never paste code from it. Disclose it on Devpost.
- **No fabricated data:** demo profiles are visibly labelled. Energy and labour numbers come from live sources, or say they are unavailable.
- **No gambling, no payments, no login wall.** Anonymous cookie identity, guest-first.
- **Never break the demo:** errors are human sentences with a retry, never raw `TypeError: fetch failed`.
