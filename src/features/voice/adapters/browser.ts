/** The real adapters: the browser's audio and our two API routes. */
import { playChime, resumeAudio } from "./audioEngine";
import { openBrowserMic } from "./mic";
import { createSpeechPlayer } from "./speechPlayer";
import type { FetchGrant, ListenDeps, SocketLike, SttGrant, VoiceAdapters } from "./types";

/** Asks our server for a token. Any failure just means voice is off for now. */
export function grantFetcher(body: { attemptId: string } | { mapId: string; nodeId: string }): FetchGrant {
  return async () => {
    const response = await fetch("/api/voice/stt-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`token ${response.status}`);
    const grant = (await response.json()) as Partial<SttGrant>;
    if (!grant.token || !grant.wsUrl) throw new Error("token missing");
    return { token: grant.token, wsUrl: grant.wsUrl };
  };
}

export function browserListenDeps(fetchGrant: FetchGrant): ListenDeps {
  return {
    fetchGrant,
    openMic: openBrowserMic,
    createSocket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
  };
}

export function createBrowserAdapters(attemptId: string): VoiceAdapters {
  return {
    speech: createSpeechPlayer(
      (kind) => `/api/voice/speak?attemptId=${encodeURIComponent(attemptId)}&say=${kind}`,
    ),
    listen: browserListenDeps(grantFetcher({ attemptId })),
    chime: playChime,
    unlockAudio: resumeAudio,
  };
}
