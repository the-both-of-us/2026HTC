/**
 * Stand-ins for Deepgram and ElevenLabs that follow their documented protocols, so the
 * real adapters can be tested with no keys. Used by listener.test.ts and the browser
 * test. A real check is still needed once keys exist: see realCheck.ts.
 *
 * Node has a WebSocket client but no server, and adding a package isn't worth it for
 * a fake, so this speaks the small part of RFC 6455 it needs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

export type FakeFluxBehaviour = {
  /** Words to reveal, one per few audio chunks. */
  script?: string;
  /** End a turn by itself after this many words, as a pause would. */
  splitAfterWords?: number;
  /** Accept audio but never produce words. */
  silent?: boolean;
  /** Drop the connection after this many audio frames. */
  dropAfterFrames?: number;
  /** Ignore ForceEndTurn, to test the 1.5 s cap. */
  ignoreForceEndTurn?: boolean;
  /** Close at the handshake. */
  refuse?: boolean;
  framesPerWord?: number;
};

export type FakeFluxLog = {
  url: string;
  protocols: string;
  textFrames: string[];
  audioFrames: number;
  firstAudioByte: number | null;
};

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

type Frame = { opcode: number; payload: Buffer };

function readFrames(buffer: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length < cursor + 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const maskBytes = masked ? 4 : 0;
    if (buffer.length < cursor + maskBytes + length) break;
    const payload = Buffer.from(buffer.subarray(cursor + maskBytes, cursor + maskBytes + length));
    if (masked) {
      const mask = buffer.subarray(cursor, cursor + 4);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    frames.push({ opcode, payload });
    offset = cursor + maskBytes + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

export type FakeProviders = {
  url: string;
  port: number;
  flux: FakeFluxBehaviour;
  logs: FakeFluxLog[];
  speakRequests: { url: string; body: string }[];
  /** Status for the next speak calls, for testing failures. 200 serves audio. */
  speakStatus: number;
  grantStatus: number;
  close(): Promise<void>;
};

/** Starts one local server that answers as Deepgram (grant and socket) and ElevenLabs. */
export async function startFakeProviders(options: {
  port?: number;
  flux?: FakeFluxBehaviour;
  audioPath?: string;
}): Promise<FakeProviders> {
  const audio = options.audioPath ? readFileSync(options.audioPath) : Buffer.alloc(0);
  const fake: FakeProviders = {
    url: "",
    port: 0,
    flux: options.flux ?? {},
    logs: [],
    speakRequests: [],
    speakStatus: 200,
    grantStatus: 200,
    close: async () => {},
  };

  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const url = request.url ?? "";
      if (request.method === "POST" && url === "/__set") {
        // Lets a browser test change how the fake behaves without restarting anything.
        const change = JSON.parse(body) as { flux?: FakeFluxBehaviour; speakStatus?: number; grantStatus?: number };
        fake.flux = { ...fake.flux, ...change.flux };
        fake.speakStatus = change.speakStatus ?? fake.speakStatus;
        fake.grantStatus = change.grantStatus ?? fake.grantStatus;
        response.end(JSON.stringify({ logs: fake.logs.length }));
      } else if (request.method === "GET" && url === "/__logs") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ flux: fake.logs, speak: fake.speakRequests }));
      } else if (request.method === "POST" && url === "/v1/auth/grant") {
        if (fake.grantStatus !== 200) {
          response.writeHead(fake.grantStatus);
          response.end("{}");
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ access_token: "fake-jwt-token", expires_in: 30 }));
      } else if (request.method === "POST" && url.startsWith("/v1/text-to-")) {
        fake.speakRequests.push({ url, body });
        if (fake.speakStatus !== 200) {
          response.writeHead(fake.speakStatus);
          response.end("{}");
          return;
        }
        response.writeHead(200, { "Content-Type": "audio/mpeg" });
        // Sent in pieces, faster than real time, as a real stream would be.
        let offset = 0;
        const pump = () => {
          if (offset >= audio.length) return void response.end();
          response.write(audio.subarray(offset, offset + 8192));
          offset += 8192;
          setTimeout(pump, 20);
        };
        pump();
      } else {
        response.writeHead(404);
        response.end();
      }
    });
  });

  const sockets = new Set<Duplex>();
  server.on("upgrade", (request, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    handleFluxUpgrade(request, socket, fake);
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  fake.port = (server.address() as AddressInfo).port;
  fake.url = `http://127.0.0.1:${fake.port}`;
  fake.close = () =>
    new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
  return fake;
}

function handleFluxUpgrade(request: IncomingMessage, socket: Duplex, fake: FakeProviders): void {
  const behaviour = fake.flux;
  const protocols = String(request.headers["sec-websocket-protocol"] ?? "");
  const authorised = protocols.split(",").map((part) => part.trim())[0] === "bearer" && protocols.includes("fake-jwt-token");
  if (behaviour.refuse || !authorised || !request.url?.startsWith("/v2/listen")) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }

  const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}${WS_GUID}`).digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: bearer\r\n\r\n`,
  );

  const log: FakeFluxLog = { url: request.url, protocols, textFrames: [], audioFrames: 0, firstAudioByte: null };
  fake.logs.push(log);

  const words = (behaviour.script ?? "").split(/\s+/).filter(Boolean);
  const framesPerWord = behaviour.framesPerWord ?? 3;
  let sequence = 0;
  let turn = 0;
  let turnWords: string[] = [];
  let nextWord = 0;

  const send = (message: object) => {
    if (!socket.destroyed) socket.write(encodeTextFrame(JSON.stringify({ request_id: "fake", sequence_id: sequence++, ...message })));
  };
  const turnInfo = (event: string, extra: object = {}) =>
    send({
      type: "TurnInfo",
      event,
      turn_index: turn,
      audio_window_start: 0,
      audio_window_end: 0,
      transcript: turnWords.join(" "),
      words: [],
      end_of_turn_confidence: 0.1,
      ...extra,
    });
  const endTurn = (trigger: string) => {
    turnInfo("EndOfTurn", { trigger });
    turn += 1;
    turnWords = [];
  };

  send({ type: "Connected" });

  let pending: Buffer = Buffer.alloc(0);
  socket.on("data", (data: Buffer) => {
    const { frames, rest } = readFrames(Buffer.concat([pending, data]));
    pending = rest;
    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x1) {
        const text = frame.payload.toString();
        log.textFrames.push(text);
        const type = (JSON.parse(text) as { type: string }).type;
        if (type === "ForceEndTurn" && !behaviour.ignoreForceEndTurn) {
          if (turnWords.length > 0) endTurn("manual");
          else send({ type: "Warning", code: "FORCE_END_TURN_NO_ACTIVE_TURN", description: "No active turn" });
        } else if (type === "CloseStream") {
          // Flux closes without a close frame, per its docs.
          socket.destroy();
        }
        continue;
      }
      if (frame.opcode === 0x2) {
        log.audioFrames += 1;
        if (log.firstAudioByte === null && frame.payload.length > 0) log.firstAudioByte = frame.payload[0];
        if (behaviour.dropAfterFrames && log.audioFrames >= behaviour.dropAfterFrames) {
          socket.destroy();
          return;
        }
        if (behaviour.silent || nextWord >= words.length) continue;
        if (log.audioFrames % framesPerWord === 0) {
          if (turnWords.length === 0) turnInfo("StartOfTurn");
          turnWords.push(words[nextWord]);
          nextWord += 1;
          turnInfo("Update");
          if (behaviour.splitAfterWords && turnWords.length >= behaviour.splitAfterWords) endTurn("model");
        }
      }
    }
  });
}

/** Run as a script for browser testing: npx tsx src/features/voice/dev/fakeProviders.ts 4801 audio.mp3 */
if (process.argv[1]?.endsWith("fakeProviders.ts")) {
  const port = Number(process.argv[2] ?? 4801);
  const audioPath = process.argv[3];
  const flux: FakeFluxBehaviour = {
    script:
      "A transformer heats up because of copper losses in the windings and core losses in the steel, and the insulation sets the limit.",
    splitAfterWords: 9,
    framesPerWord: 3,
  };
  void startFakeProviders({ port, audioPath, flux }).then((fake) => {
    console.log(`fake providers on ${fake.url}`);
  });
}
