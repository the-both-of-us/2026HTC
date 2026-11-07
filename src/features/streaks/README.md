# streaks

**Owner:** Abdu. See `TEAM.md`.

The habit loop around learning: a reason to come back tomorrow, with no dark patterns. Nothing here can take a proof away.

- **Daily streak.** Proving any topic on a day keeps it. Days are Edmonton days (`days.ts`, Alberta is UTC-6 all year from Nov 1, 2026). One freeze a week covers a missed day by itself. The flame and count sit in the sidebar (`SideNav`, listening to the `oryx:streak` event).
- **Combo.** Topics proved within 20 minutes of each other build x2, x3... shown on the unlock moment with a short chime. The chime has a mute toggle, and is off by default with reduced motion, Learning Mode, or on an evidence page.
- **Keep the map lit.** A proved topic dims a step after 3, 7 and 14 days. A 60-second quick check (the follow-up question that proved it, graded again) relights it. Dimming is a nudge only: the evidence page never changes.
- **Topic of the day.** One open topic per map per day, picked by a hash of the day and the map id, worth double sparks.
- **Sparks and a weekly goal.** 1 spark per topic, 2 for the topic of the day, a goal of 10 a week, and a Mon-Sun strip of the days you proved something.
- **Circle race** (`race.ts`, `ui/CircleRace`): on a study circle's page, this week's leaderboard and the first person to prove every topic. It reads only circles' public `CircleView`.

Storage: one document per learner, `streaks/<userId>`. `deleteStreak` runs from "Delete my data".

**Hook point:** `recordProved(userId, { mapId, nodeId, attemptId })` from `@/features/streaks`. Call it once a topic is proved (today: `POST /api/attempts/[id]/followup`). It counts each attempt id once and never throws.

Pure rules live in `rules.ts` and `race.ts`; `streaks.ts` does the store reads. Tests: `npm test -- streaks`.
