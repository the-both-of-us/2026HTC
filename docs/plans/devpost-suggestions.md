# Devpost suggestions (from Abdu, Sat Nov 7)

Compared Mirza's `docs/submission/*` with origin/main (a6dd4f7). Nothing in his folder was edited. Take what helps.

## What the draft is missing or gets wrong

1. **Framing is job-seeker only.** Title tagline, Inspiration (7.3% unemployment), step 1 and the video's first 20 s all say "job posting -> employer proof". Main now reframes landing for students and curious people (8f2eba3). A posting is one entry point, next to a topic, a PDF or a broad goal.
2. **Programs are missing.** A broad goal ("web development", a job) becomes a program of 4 to 8 courses, each map built when opened. Topic and PDF input exist, but "program" is nowhere.
3. **Proving is described as one thing.** It is now: a **Read** tab (3-5 min lesson per topic) before Flashcards and Quiz; proving formats (**Catch the AI's mistake**, **explain it to a 10-year-old**, **say it in 30 seconds**); a **final interview** per course that earns a **badge**; hands-free voice (tap once, it listens and sends).
4. **Social is thin.** Study circles are listed, but not the live feed, weekly race and first-to-finish. Streaks are absent: daily flame (Edmonton days, one freeze a week), combo, fading map (relight with a 60 s quick check), topic of the day, sparks.
5. **Eval numbers are incomplete.** Draft says "98.6% agreement, 0 false passes". Add the split: **70 of 71 agree, 0 of 48 false pass, 1 of 23 false fail**. Also missing: the measured grading-time chip, and that the evidence page now says how each skill was proved (typed or spoken, which format, topic vs source).
6. **Smaller points.**
   - Evidence page and the new **Seal** theme (ink map, seal on proven skills) are not mentioned.
   - The `/trust` page is mentioned, but not delete-my-data's reach (circles, people profile, review data, streaks).
   - Voice: "confirm ElevenLabs too?" The only voice code on main is Deepgram (Flux STT and Flux TTS "Hannah"), so drop ElevenLabs unless Mirza knows otherwise.
   - People matching and Review are marked "(confirm)". Both are on main, but check them in the running app.
   - Video script: 2:15-2:45 has Mirza cover Courses/People/circles, but Abdu built circles. Q&A prep says "98.6%" with no false-fail figure.
   - "1,000+ automated tests": re-run `npm test` and use the real number.

## Suggested replacement paragraphs

**Tagline:** Learn anything with other people, and prove you really understand it by teaching it back.

**Inspiration:** Most of us finish a course and still cannot tell whether we understood it. Certificates show we sat through it. Students cramming, career changers, and people who are just curious all face the same gap: nobody checks that the idea is in your head, and learning alone is slow. So we built a place where you learn a topic, explain it in your own words, and find out honestly whether it landed. A job posting is one way in: Alberta's unemployment rate is 7.3% against 6.7% for Canada (Statistics Canada, October 2026), and people changing careers need to know which skills a real job asks for. It is not the only way.

**What it does, item 1 (replace):** **Start from anything.** Name a topic, upload a PDF, paste a job posting, or state a broad goal such as "web development". A goal becomes a *program*: 4 to 8 courses, each built when you open it. Each course is a map of 10 to 14 topics, foundations first. Topics from a posting or PDF cite exact quotes that code checks against the source; topic maps say plainly that they have no citations.

**Item 2 (replace):** **Learn, then prove.** Every topic has a 3 to 5 minute lesson (Read), flashcards and a quiz. To unlock the next topic you prove this one, in the format you like: explain it in your own words, **catch the AI's mistake**, **explain it to a 10-year-old**, or **say it in 30 seconds**. You can type or talk hands-free. Finish a course with a short final interview and earn its badge.

**Item 6 (replace):** **Learn together.** Start a **study circle**, share the QR code, and watch a live feed of who just proved what. A weekly race shows who is ahead and who proves every topic first. A daily streak (with one free freeze a week), a combo for proving topics close together, and a **topic of the day** make coming back easy without punishing a missed day. Proven topics slowly fade on the map, and a 60-second quick check relights them. Nothing here can take a proof away. You can also publish a course, and others can start their own copy.

**Accomplishments / Challenges (replace the eval line):** On our 71-case eval the grader agreed with the labels on **70**. It passed **0 of 48** answers that should fail, and failed **1 of 23** that should pass. We also show the measured grading time in the app. The labels were written by AI, not a human expert, and the trust page says so.

**Evidence line:** The evidence page shows how each skill was proved (typed or spoken, which format, from a topic or a source), the verified quotes, the follow-up, and the course badge. Anyone can re-check it without trusting our AI.

**Video script, opening (0:00-0:20):** "Ever finished a course and not been sure you understood it? OryxLearn lets you learn anything, with other people, and then prove it by teaching it back. Start from a topic, a PDF or a job posting, and get a path of courses."
