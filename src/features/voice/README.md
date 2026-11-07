# voice

The spoken follow-up question. OryxLearn asks it out loud, the learner answers out loud, and the words go to the same grader as a typed answer. If anything about voice fails, the interview slides to a text box with their words kept.

## How the audio flows

```
                     our server decides every word
                                  |
 question text -> GET /api/voice/speak -> ElevenLabs -> mp3 stream -> <audio> -> speaker
                                                                         |
                                                              AnalyserNode -> orb

 mic -> MediaRecorder (WebM/Opus, 100 ms chunks) -> WebSocket -> Deepgram Flux
  |                                                                  |
  AnalyserNode -> orb                               TurnInfo messages -> captions -> review -> grader
```

The browser connects to Deepgram directly, so there's no audio server to run. It uses a 30 second token from `POST /api/voice/stt-token`. The real key never leaves our server, and an open socket survives the token expiring.

## Why these providers

- **Deepgram Flux (ears).** It's built for conversation: it reports turns, not just words, and lets a button end a turn on demand. A pause doesn't lose anything.
- **ElevenLabs (voice).** It's the difference between a person and text-to-speech. `eleven_v4_turbo` is tried first, because it's their real-time model.
- **Cerebras (brain).** Unchanged. The same follow-up generation writes the words, so the voice can't wander or give away answers.
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
- **Keyterms are safe to expose.** The socket URL is visible in the browser, so terms come only from the skill title and the learner's own explanation, never from checkpoints.
- **No open mic.** The room is loud, so the mic only opens on a tap or Space. Tapping while the voice talks fades it out and opens the mic.
- **Never an error screen.** Every failure below moves to typing with the words kept, and the question is always on screen as text.

| Failure | Sentence shown |
|---|---|
| Token fails, or no key (503) | Voice answers aren't available right now |
| Socket closes or errors | The connection dropped, your words are still here |
| 8 s of mic level with no words | Voice stopped picking up your words |
| Spoken question fails | The spoken question isn't available right now |
| Mic blocked | Microphone access is off |

## Where things are

| File | What it does |
|---|---|
| `machine.ts` | The states and rules. Pure |
| `transcript.ts` | Joins turns into the answer. Pure |
| `flux.ts`, `captions.ts`, `watchdog.ts` | Protocol, caption timing, the 8 s check. Pure |
| `listener.ts` | One turn: token, mic, socket, Done |
| `session.ts` | Runs the machine through the adapters. No React |
| `adapters/` | The real browser audio, and the preview's pretend audio |
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
    return { passed: result.passed, feedback: result.feedback }; // or return nothing to take over
  }}
  onTypeInstead={(partialText) => showTextForm(partialText)}
/>

const dictation = useDictation({ skillTitle, onText: (text) => append(text) });
// dictation.start(), dictation.stop(), dictation.finalText, dictation.interimText
```

Note that `followUpBody` in teachback takes only `{ answer }`, so the follow-up's `inputMethod` isn't saved yet. The attempt's `integrity.inputMethod` describes the explanation.

## Setup and checking

Copy the keys in `.env.example` into `.env.local`. Without them, the routes answer 503 and the UI moves to typing.

```bash
npm test -- voice      # uses a local fake that follows Flux's documented protocol
npx tsx --env-file=.env.local src/features/voice/dev/realCheck.ts   # real providers, a few cents
```

Then open `/voice-preview?real=1` in `npm run dev`, and go through one interview with a real microphone.

## Removing the preview before the final merge

`/voice-preview` is for review only and is off in production. Before the final merge, delete `src/app/voice-preview/`, `src/app/api/voice/preview-attempt/`, `ui/VoicePreview.tsx`, `adapters/mock.ts`, and the `VoicePreview` export in `client.ts`. Then remove the `meter` option on `initial` in `session.ts` if nothing else uses it.
