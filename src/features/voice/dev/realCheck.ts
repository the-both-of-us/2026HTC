/**
 * Tries the real providers once keys exist. Spends about 5 cents at most: one short
 * sentence per voice route tried, and a few seconds of Flux. Prints no keys or tokens.
 *
 *   npx tsx --env-file=.env.local src/features/voice/dev/realCheck.ts
 *
 * Needs ffmpeg and macOS `say` to make the test recording.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFluxUrl, CLOSE_STREAM, extractKeyterms, FORCE_END_TURN, parseFluxMessage } from "../flux";
import { elevenLabsProvider, geminiProvider, type TtsProvider } from "../server/tts";
import { applyTurn, EMPTY_TRANSCRIPT, fullText } from "../transcript";

const SENTENCE = "The transformer's insulation sets the limit, because copper losses heat the windings.";
const out = mkdtempSync(join(tmpdir(), "voice-check-"));
const results: string[] = [];

async function checkVoice(label: string, provider: TtsProvider) {
  const started = performance.now();
  try {
    const audio = await provider.speak(SENTENCE, AbortSignal.timeout(20_000));
    const reader = audio.body.getReader();
    const chunks: Uint8Array[] = [];
    let firstByteMs = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstByteMs) firstByteMs = performance.now() - started;
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    const path = join(out, `${label}.${audio.contentType.includes("wav") ? "wav" : "mp3"}`);
    writeFileSync(path, bytes);
    results.push(`PASS ${label}: first audio in ${Math.round(firstByteMs)} ms, ${bytes.length} bytes, listen: ${path}`);
  } catch (error) {
    results.push(`FAIL ${label}: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

async function checkFlux(apiKey: string, base: string) {
  const grantResponse = await fetch(`${base}/v1/auth/grant`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 30 }),
  });
  if (!grantResponse.ok) {
    results.push(`FAIL Deepgram grant: HTTP ${grantResponse.status}. The key needs Member role or higher.`);
    return;
  }
  const { access_token: token } = (await grantResponse.json()) as { access_token: string };
  results.push("PASS Deepgram grant: token minted");

  const aiff = join(out, "speech.aiff");
  const webm = join(out, "speech.webm");
  execFileSync("say", ["-o", aiff, SENTENCE]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", webm]);
  const audio = readFileSync(webm);

  const url = buildFluxUrl(base.replace(/^http/, "ws"), extractKeyterms("Transformer insulation", SENTENCE));
  const socket = new WebSocket(url, ["bearer", token]);
  let transcript = EMPTY_TRANSCRIPT;
  const seen = new Set<string>();

  await new Promise<void>((resolve) => {
    const giveUp = setTimeout(() => {
      results.push("FAIL Flux: no EndOfTurn within 30 s");
      socket.close();
      resolve();
    }, 30_000);
    socket.binaryType = "arraybuffer";
    socket.onerror = () => {
      clearTimeout(giveUp);
      results.push("FAIL Flux: the socket was refused. Check the bearer subprotocol and the token.");
      resolve();
    };
    socket.onopen = async () => {
      results.push("PASS Flux: socket opened with the bearer subprotocol");
      // Real time, in the same 100 ms pieces the browser sends.
      const chunk = Math.ceil(audio.length / 40);
      for (let i = 0; i < audio.length; i += chunk) {
        if (socket.readyState !== 1) return;
        socket.send(audio.subarray(i, i + chunk));
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 300));
      socket.send(FORCE_END_TURN);
    };
    socket.onmessage = (event) => {
      const message = parseFluxMessage(String(event.data));
      seen.add(message.type === "TurnInfo" ? message.event : message.type);
      if (message.type === "TurnInfo") {
        transcript = applyTurn(transcript, message);
        if (message.event === "EndOfTurn") {
          socket.send(CLOSE_STREAM);
          clearTimeout(giveUp);
          results.push(`PASS Flux transcript: "${fullText(transcript)}"`);
          results.push(`     Messages seen: ${[...seen].join(", ")}`);
          setTimeout(resolve, 300);
        }
      }
      if (message.type === "Error") results.push(`FAIL Flux error: ${message.code}`);
    };
  });
  socket.close();
}

async function main() {
  const {
    DEEPGRAM_API_KEY,
    DEEPGRAM_API_BASE,
    ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID,
    ELEVENLABS_API_BASE,
    GEMINI_API_KEY,
  } = process.env;

  if (ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID) {
    for (const model of ["eleven_v4_turbo", "eleven_multilingual_v2"]) {
      await checkVoice(
        `elevenlabs-${model}`,
        elevenLabsProvider({ apiKey: ELEVENLABS_API_KEY, voiceId: ELEVENLABS_VOICE_ID, model, baseUrl: ELEVENLABS_API_BASE }),
      );
    }
    await checkVoice(
      "elevenlabs-auto",
      elevenLabsProvider({ apiKey: ELEVENLABS_API_KEY, voiceId: ELEVENLABS_VOICE_ID, baseUrl: ELEVENLABS_API_BASE }),
    );
  } else {
    results.push("SKIP ElevenLabs: ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID is not set");
  }

  if (GEMINI_API_KEY) await checkVoice("gemini", geminiProvider({ apiKey: GEMINI_API_KEY }));
  else results.push("SKIP Gemini: GEMINI_API_KEY is not set (optional)");

  if (DEEPGRAM_API_KEY) await checkFlux(DEEPGRAM_API_KEY, DEEPGRAM_API_BASE || "https://api.deepgram.com");
  else results.push("SKIP Deepgram: DEEPGRAM_API_KEY is not set");

  console.log(results.join("\n"));
}

void main();
