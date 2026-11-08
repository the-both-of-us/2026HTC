# AI usage disclosure (for Devpost)

> The rules require disclosing **all** AI usage, and failing to disclose it can mean disqualification. Paste this into the Devpost description, under its own heading. **TODO:** Abdu should confirm the models and voice providers in the second section.

## AI tools used to build OryxLearn

- **Claude Code (Anthropic, Claude Opus)** was used by both team members throughout the hackathon. It helped plan the work, write and refactor code, write tests and documentation, and review code for bugs and security problems. Every change was reviewed, run and tested by the team before merging. Both of us can explain every part of the code.
- **Grading eval labels:** the 71 labelled cases in our grading eval were written by Claude, not by a human expert. We say this on the trust page and in `docs/eval-results.md`, and they still need a human spot check.
- **Prior work:** OryxLearn builds on ideas from an earlier project by a team member. A judge approved reusing its features and ideas. All code and design in this repository were written new during the hackathon.

## AI models used inside the product

| What | Model / service | What the AI decides, and what code checks |
|---|---|---|
| Skill map from a posting, PDF or topic | gpt-oss-120b (Cerebras, Groq, Vercel AI Gateway, Gemini or AWS Bedrock, whichever answers first) | The AI proposes skills, dependencies, checkpoints and quotes. Code validates the graph (no loops, at most 14 nodes) and checks every quote against the source text. |
| Grading an explanation | gpt-oss-120b | The AI returns a quote per checkpoint, or none. Code checks each quote is really in the learner's text and computes the score. |
| Live follow-up question and its grading | gpt-oss-120b | The AI writes one question about the learner's own answer and judges the reply. |
| Flashcards and quiz | **Google Gemini** first, then the same chain | The AI writes cards and questions. Code validates counts and lengths, removes duplicates and "all of the above" options, and shuffles answer positions. Citations come only from verified quotes. |
| Voice (speech to text, spoken questions) | Deepgram Flux *(Abdu: confirm, and add ElevenLabs if it's used)* | Transcription only. The transcript goes to the same grader as typed text. |
| Labour data, matching people, streaks, spaced repetition | **No AI** | Computed by code from Statistics Canada and the learner's verified progress. |
