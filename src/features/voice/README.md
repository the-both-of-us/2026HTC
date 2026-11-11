# voice

The spoken follow-up question. OryxLearn asks it out loud, the learner answers out loud, and the words go to the same grader as a typed answer. If anything about voice fails, the interview slides to a text box with their words kept.

## One tap

1. **Answer aloud.** The only tap. The browser asks for the mic now, if it hasn't before. The token, mic and socket open while the question plays. The question's audio was requested when it appeared on screen, so it starts at once.
2. **The question plays.** The mic is open but sends silence to Flux, so the question's own voice is never transcribed. A tap or Space skips it.
3. **Listening.** It starts 150 ms after the question's sound stops, so the last echo dies away first. Echo cancellation is also on. Captions show live.
4. **The answer ends by itself.** That happens at Flux's EndOfTurn. The mic stays open 2.5 s more: if they keep talking, it goes back to listening and keeps both parts. Done or Space ends it early.
5. **Here's what I heard.** The text shows at once and sends itself after 3 s. Send now, Edit (counts as typed), and Re-record (starts over) are there. Any key, or Edit, stops the countdown. The text shown is the text sent.

**Measured on 2026-11-07** with real Deepgram, a recorded answer played in as the mic, on `/voice-preview?real=1`: from the Answer aloud click to the question playing, 50 ms in the app (0.44 s including the test's automated click). From the last spoken word to the answer on screen, 1.1 to 1.4 s over 3 runs. A 2.2 s thinking pause in the middle was not cut off: Flux ended the turn, the learner kept talking, and both parts were sent. Not yet tried: a real microphone in a loud room, and echo from laptop speakers.

## How the audio flows

```
                     our server decides every word
                                  |
 question text -> GET /api/voice/speak -> Deepgram Flux voice (Hannah) -> mp3 stream -> <audio> -> speaker
                                                                         |
                                                              AnalyserNode -> orb

 mic -> AudioWorklet (16 kHz linear16, 80 ms chunks) -> WebSocket -> Deepgram Flux
  |                                                                  |
  AnalyserNode -> orb                               TurnInfo messages -> captions -> review -> grader
```

The browser connects to Deepgram directly, so there's no audio server to run. It uses a 30 second token from `POST /api/voice/stt-token`. The real key never leaves our server, and an open socket survives the token expiring.

A token is only minted for someone with something to say right now: an existing cookie, plus either an attempt of theirs that is waiting on a follow-up, or a skill on their own map for dictation. A Deepgram token can also spend on Deepgram's other speech APIs and can't be narrowed, so **put the key in a dedicated Deepgram project holding only the demo credit**. That is what actually caps the cost if a learner pulls their own token out of the browser.

## Why these providers

- **Deepgram Flux (ears).** It's built for conversation: it reports turns, not just words, and lets a button end a turn on demand. A pause doesn't lose anything.
- **linear16, not WebM.** We replayed the same Chrome-captured clips through real Flux both ways. Accuracy was the same (0 to 3% word error), and linear16 ended turns about 0.15 s sooner. It also lets the socket run on silence while the question plays, which WebM can't.
- **End of turn.** `eot_threshold=0.7` and `eot_timeout_ms=3000` (`flux.ts`). Thresholds up to 0.9 still ended the turn 0.7 to 1.5 s into a 2 to 2.6 s pause after a whole clause, so raising it only made every answer slower. The 2.5 s hold in `session.ts` covers pauses instead.
- **Deepgram Flux TTS (voice).** The interviewer speaks with `flux-hannah-en` on `POST /v2/speak`, the same account and key as the ears. The owner picked Hannah from eight voices on 2026-11-07; measured first audio was 0.33–0.52 s. Set `DEEPGRAM_VOICE` to change it.
- **ElevenLabs (optional backup voice).** It's the difference between a person and text-to-speech. `eleven_v4_turbo` is tried first, because it's their real-time model.
- **Claude Haiku (brain).** Unchanged. The same follow-up generation writes the words, so the voice can't wander or give away answers.
- **Gemini (backup voice).** Optional. Used only if ElevenLabs fails and `GEMINI_API_KEY` is set.

## What each message means

We send audio as binary frames, plus two control messages:

| We send | Meaning |
|---|---|
| `ForceEndTurn` | The learner tapped Done. End this turn with the words so far. |
| `CloseStream` | Finish up and close. It doesn't end a turn, so it always comes second. |

| Flux sends | Meaning | What we do |
|---|---|---|
| `Connected` | The socket is ready. | Nothing |
| `TurnInfo` `StartOfTurn`, `Update` | Words so far in this turn. Each one has the whole turn. | Replace that turn's text, muted |
| `TurnInfo` `EndOfTurn` | This turn's words are final. | Show solid. A pause can cause this, so more turns can follow |
| `Warning` `FORCE_END_TURN_NO_ACTIVE_TURN` | Done arrived with no turn running. | Treat as finished |
| `Error` | The stream is broken. | Move to typing |

**Done, step by step:** keep sending for 300 ms, because `ForceEndTurn` only covers audio already decoded and the last word would get cut off. Send `ForceEndTurn`. Wait for `EndOfTurn`, up to 1.5 s. Send `CloseStream`. If `EndOfTurn` never came, the latest `Update` is the final text, as Flux's docs say.

## The rules that matter

- **The server decides every word.** `/speak` takes an attempt id, not text, and only speaks the stored question or feedback of an attempt the user owns. It won't read feedback while a follow-up is open.
- **The text shown is the text sent.** The grader checks exact quotes, so `fullText` in `transcript.ts` is the one source for both. Editing it marks the answer as `typed`.
- **Keyterms are safe to expose.** The socket URL is visible in the browser, so terms come only from what the learner can already see: the skill title, their own explanation, the map's title and topic titles, then a short public list of common tech and science terms (`buildKeyterms` in `flux.ts`). Never checkpoints. The list is deduplicated and kept under Deepgram's 500-token keyterm limit.
- **The mic is on from the tap until the answer is heard.** It opens at Answer aloud, but sends silence while the question plays and for 150 ms after. Then it listens until Flux ends the turn and 2.5 s pass without more words. After that it closes. With no words for 20 s, it closes and asks them to try again. It never opens before the tap.
- **A double-click is one tap.** A second tap on the main button within 350 ms is ignored, so it can't skip the question or end a turn that has just started.
- **One take at a time.** A tap can stop a take while another step is still waiting, like a permission prompt or the end of a turn. Each take has a number in `listener.ts`, so when that wait ends, the old take cleans up its own mic and leaves the new one alone.
- **Never an error screen.** Every failure below moves to typing with the words kept, and the question is always on screen as text.

| Failure | Sentence shown |
|---|---|
| Token fails, or no key (503) | Voice answers aren't available right now. If the token was already known to have failed, the browser never asks for the mic |
| Socket closes or errors | The connection dropped, your words are still here |
| 8 s of talking with no words | Voice stopped picking up your words |
| Spoken question fails | It listens anyway, and says to read the question on screen |
| Mic blocked | Microphone access is off |

**The 8 s check in a loud room.** The first second of listening measures the room. After that, only a level 3 times the room's (about 10 dB) counts as talking, a gap of 1.5 s starts the count over, and any new word does too. Those numbers are reasoned, not measured in a real room.

**A hung answer.** If `onAnswer` hasn't replied after 65 s, the review screen comes back with the words kept. The follow-up route can run for 60 s while the grader retries, and giving up sooner could report a failure on an answer that is still passing.

## Where things are

| File | What it does |
|---|---|
| `machine.ts` | The states and rules. Pure |
| `transcript.ts` | Joins turns into the answer. Pure |
| `flux.ts`, `captions.ts`, `watchdog.ts` | Protocol, caption timing, the 8 s check. Pure |
| `listener.ts` | One turn: token, mic, socket, Done |
| `session.ts` | Runs the machine through the adapters. No React |
| `dictation.ts` | One recording at a time for `useDictation`. No React |
| `adapters/` | The real browser audio (`pcmWorklet.ts` makes linear16), and the preview's pretend audio |
| `server/` | Token minting, providers and failover, rate limits |
| `ui/` | `VoiceInterview`, `Orb`, `useVoiceInterview`, `useDictation` |
| `dev/` | A fake Deepgram and ElevenLabs for tests, and `realCheck.ts` for real keys |

## Using it

```tsx
import { VoiceInterview, useDictation } from "@/features/voice/client";

<VoiceInterview
  attemptId={attempt.id}
  question={attempt.followUp.question}
  onAnswer={async (text, inputMethod) => {
    const result = await sendAnswer(text, inputMethod); // throw if it fails, and they can retry
    return { passed: result.passed, feedback: result.feedback };
  }}
  onContinue={() => goToMap()} // required when a verdict can come back. Without one, return nothing and take over.
  onTypeInstead={(partialText) => showTextForm(partialText)}
/>

const dictation = useDictation({ mapId, nodeId, onText: (text) => append(text) });
// dictation.start(), dictation.stop(), dictation.finalText, dictation.interimText
```

Teachback saves the follow-up's `inputMethod` (and `startedAfterMs`) on `followUp`. The attempt's `integrity.inputMethod` describes the explanation.

## Setup and checking

Copy the keys in `.env.example` into `.env.local`. Without them, the routes answer 503 and the UI moves to typing.

```bash
npm test -- voice      # uses a local fake that follows Flux's documented protocol
npx tsx --env-file=.env.local src/features/voice/dev/realCheck.ts   # real providers, a few cents
```

Then open `/voice-preview?real=1` in `npm run dev`, and go through one interview with a real microphone.

## Removing the preview before the final merge

`/voice-preview` is for review only and is off in production. Before the final merge, delete `src/app/voice-preview/`, `src/app/api/voice/preview-attempt/`, `ui/VoicePreview.tsx`, `adapters/mock.ts`, and the `VoicePreview` export in `client.ts`. Then remove the `meter` option on `initial` in `session.ts` if nothing else uses it.
