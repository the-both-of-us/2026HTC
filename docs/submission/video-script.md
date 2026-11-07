# Demo video and presentation script (3 minutes)

The judged presentation is **3 minutes, then 2 minutes of Q&A**, and it is cut off at time. The Devpost video can be 2-5 minutes; use the same script. Timings are cumulative. Practise with a timer. **TODO:** rehearse once on the live site and adjust anything that changed.

**Before you start:**
- Open the live site in one tab, already on the landing page.
- Have the sample "Data Analyst, Grid Operations" posting ready.
- Have a second, already-proven map open in another tab, so you never wait on AI.
- Have a phone ready to scan the QR code.

| Time | Who | On screen | Say |
|---|---|---|---|
| 0:00-0:20 | Mirza | Landing page | "Alberta's unemployment rate is 7.3%. People changing careers hear 'upskill', but not *which* skills a real job needs, or how to prove they have them. OryxLearn turns a real job posting into a path you can learn, and proof an employer can check." |
| 0:20-0:45 | Abdu | Paste the posting, then show the skill map | "We paste a real Calgary posting. In seconds it becomes a skill map: foundations first, and every skill cites the exact line of the posting it came from. Code checks every quote, so the AI can't invent a requirement." |
| 0:45-1:25 | Abdu | Open a skill, explain it, then show the follow-up | "To unlock a skill, you teach it back in your own words, typed or spoken. The AI isn't allowed to just give a score. It must quote *your* words for each checkpoint, code verifies the quotes, and then it asks one live follow-up about what you wrote. *(Ideally a judge types the answer here.)*" |
| 1:25-1:50 | Mirza | Flashcards, then quiz, then Review | "Every skill has flashcards and a quiz, made by Gemini and saved, so nobody waits twice. Spaced repetition brings cards back on the day you're about to forget them." |
| 1:50-2:15 | Abdu | Evidence page; a judge scans the QR | "When you prove skills, you get a public evidence page: what you wrote, the verified quotes, the follow-up and integrity signals. Scan the QR on your phone. Anyone can re-check it without trusting our AI." |
| 2:15-2:45 | Mirza | Courses, then Start; People; Study circle QR | "It's also about people. Publish your map as a course, and anyone can start their own copy. On People, we match you with mentors who have *proved* the skills you're learning, using verified progress, not self-reported skills. And study circles let a class learn one map together, live." |
| 2:45-3:00 | Mirza | Trust page or dashboard | "No login wall, delete your data any time, and live AESO and StatCan data, with nothing made up. OryxLearn: learn what a real job needs, and prove it." |

## Q&A prep (both of us must be able to explain every part)

- **"Can't someone just paste ChatGPT's answer?"** Integrity signals show pasting and typing time, and the live follow-up asks about the specific words they wrote. We're honest that this doesn't stop a determined cheater, and the trust page says so. It's evidence, not a guarantee.
- **"How do you know the grading is accurate?"** A 71-case eval: 98.6% agreement and 0 false passes. The limits: the labels were AI-written and the sample is small.
- **"Why not just use an LLM score?"** Free-form scores gave empty, fluent answers 55-85. Code-verified quotes dropped them to 0-25.
- **"What does it cost to run?"** About $0.0007 per grade (measured). Generated study tools are saved once per skill, and free tiers cover a demo.
- **"Privacy?"** Guests by default and maps private until published. Strangers get "not found" for private content. Delete-my-data removes everything.
- **"Scalability?"** Feature-based architecture, a stateless server, and S3 storage on AWS. The next steps are a real database for likes and matching, and caching.
- **Know your own features:** Mirza covers flashcards, quiz, courses, auth, network, dashboard and review. Abdu covers skill map, teach-back, grading, voice, evidence pages, grid, labour, circles and trust. Walk each other through them on Sunday morning.
