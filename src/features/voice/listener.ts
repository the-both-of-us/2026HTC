/**
 * One take of listening: gets a token, opens the mic and the socket, streams audio,
 * reports words, and ends cleanly. Used by the interview and by dictation.
 *
 * A take can start "gated": the mic and socket open, but Flux receives silence in place of
 * the mic, until ungate(). The interview opens everything while the question plays, so
 * nothing has to connect when it ends, and the question's own voice is never transcribed.
 *
 * Flux has three things to get right when ending a turn, all from its docs:
 *  - ForceEndTurn only covers audio already decoded, so we wait a moment first or
 *    the learner's last word gets cut off.
 *  - With no active turn it sends a Warning, not an EndOfTurn, so that also counts.
 *  - CloseStream sends no EndOfTurn and may drop the connection without a close frame.
 */
import { SILENT_METER, MicError, type AudioMeter, type ListenDeps, type MicHandle, type SocketLike, type SttGrant } from "./adapters/types";
import { CLOSE_STREAM, FORCE_END_TURN, NO_ACTIVE_TURN, parseFluxMessage } from "./flux";
import type { FallbackReason } from "./machine";
import type { TurnUpdate } from "./transcript";
import { NEW_WATCHDOG, tickWatchdog } from "./watchdog";

/** Keeps sending after Done, so Flux can decode the last word. */
export const TAIL_MS = 300;
/** How long Done waits for EndOfTurn before using what it has. */
export const END_OF_TURN_CAP_MS = 1_500;
const CLOSE_WAIT_MS = 400;
const CONNECT_TIMEOUT_MS = 5_000;
const WATCH_INTERVAL_MS = 250;
/** Grants last 30 s, and only need to be alive when the socket opens. */
const GRANT_FRESH_MS = 20_000;
const SOCKET_OPEN = 1;

type PendingGrant = { value: Promise<SttGrant>; at: number; failed: boolean };

export type ListenerHandlers = {
  onTurn(update: TurnUpdate): void;
  onFailed(reason: FallbackReason): void;
  /** The microphone is on. Until then the browser may be waiting for the learner to allow it. */
  onMicLive?(): void;
};

type Stage = "idle" | "opening" | "streaming" | "finishing" | "closed";

export class Listener {
  private stage: Stage = "idle";
  private socket: SocketLike | null = null;
  private mic: MicHandle | null = null;
  private queue: ArrayBuffer[] = [];
  private gated = false;
  private grant: PendingGrant | null = null;
  /**
   * Which take is current. A tap can stop one take and start another while the old one is
   * still waiting on a permission prompt or a timer. When that wait ends, the old take sees
   * the number has moved on, cleans up only what is its own, and leaves the new take alone.
   */
  private run = 0;
  private watch: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private endOfTurn: (() => void) | null = null;
  private socketClosed: (() => void) | null = null;
  private opened: (() => void) | null = null;
  private transcriptChanged = false;
  private lastText = "";

  constructor(
    private readonly deps: ListenDeps,
    private readonly handlers: ListenerHandlers,
  ) {}

  get meter(): AudioMeter {
    return this.mic?.meter ?? SILENT_METER;
  }

  /** Fetches a token ahead of time, so the mic opens without a wait. Failures wait for start(). */
  prepare(): void {
    if (this.grant && !this.grant.failed && this.isFresh(this.grant)) return;
    this.grant = this.fetchGrant();
  }

  /** True while a take is opening or running. */
  get active(): boolean {
    return this.stage === "opening" || this.stage === "streaming" || this.stage === "finishing";
  }

  async start(options: { gated?: boolean } = {}): Promise<void> {
    if (this.active) return;
    const run = ++this.run;
    this.stage = "opening";
    this.gated = options.gated ?? false;
    this.queue = [];
    this.lastText = "";
    this.transcriptChanged = false;

    // Voice is already known to be off, so don't ask for a microphone it can't use.
    if (this.grant?.failed && this.isFresh(this.grant)) {
      this.grant = null;
      this.fail("token");
      return;
    }

    // The mic starts at once and the audio waits in a queue, so the first words aren't lost.
    const micReady = this.deps.openMic((chunk) => {
      if (run === this.run) this.sendAudio(chunk);
    });
    micReady.catch(() => {});

    this.prepare();
    let pending = this.grant!;
    this.grant = null;

    let mic: MicHandle;
    try {
      mic = await micReady;
    } catch (error) {
      if (run === this.run) this.fail(error instanceof MicError ? error.reason : "unsupported");
      return;
    }
    if (run !== this.run) {
      mic.release();
      return;
    }
    this.mic = mic;
    this.handlers.onMicLive?.();
    if (!this.gated) this.startWatch();

    // The learner may have sat on the permission prompt until this token was nearly dead.
    if (!this.isFresh(pending)) pending = this.fetchGrant();

    let grant: SttGrant;
    try {
      grant = await pending.value;
    } catch {
      if (run === this.run) this.fail("token");
      return;
    }
    if (run !== this.run) return;
    this.openSocket(grant);
  }

  /** Lets the mic's audio through. Safe to call before the mic or socket is open. */
  ungate(): void {
    if (!this.gated) return;
    this.gated = false;
    if (this.mic && this.active) this.startWatch();
  }

  /**
   * Closes after Flux already ended the turn by itself: no tail and no ForceEndTurn,
   * because there is no turn left to end. The words are already final.
   */
  close(): void {
    if (!this.active) return;
    if (this.socketIsOpen()) this.socket!.send(CLOSE_STREAM);
    this.teardown();
  }

  /** Done: ends the turn. Resolves when the words are final and everything is closed. */
  async finish(): Promise<void> {
    const run = this.run;
    // Done tapped before the socket opened: wait for it, because the words are in the queue.
    // It has a limit, because a browser's permission prompt can wait forever.
    if (this.stage === "opening") {
      await Promise.race([new Promise<void>((resolve) => (this.opened = resolve)), delay(CONNECT_TIMEOUT_MS)]);
      if (run !== this.run) return;
      this.opened = null;
    }
    if (this.stage === "closed" || this.stage === "idle" || this.stage === "finishing") return;
    const wasStreaming = this.stage === "streaming";
    this.stage = "finishing";
    this.stopWatch();

    if (wasStreaming) {
      this.mic?.flush();
      await delay(TAIL_MS);
      if (run !== this.run) return;
      if (this.socketIsOpen()) {
        this.mic?.flush();
        const ended = new Promise<void>((resolve) => (this.endOfTurn = resolve));
        this.socket!.send(FORCE_END_TURN);
        await Promise.race([ended, delay(END_OF_TURN_CAP_MS)]);
        if (run !== this.run) return;
        this.endOfTurn = null;
      }
    }

    this.releaseMic();
    if (this.socketIsOpen()) {
      const closed = new Promise<void>((resolve) => (this.socketClosed = resolve));
      this.socket!.send(CLOSE_STREAM);
      await Promise.race([closed, delay(CLOSE_WAIT_MS)]);
      if (run !== this.run) return;
    }
    this.teardown();
  }

  /** Stops at once and keeps nothing running. Safe to call at any time. */
  abort(): void {
    if (this.stage === "idle" || this.stage === "closed") return;
    this.teardown();
  }

  private openSocket(grant: SttGrant): void {
    let socket: SocketLike;
    try {
      // The browser can't set an Authorization header on a WebSocket, so the token goes here.
      socket = this.deps.createSocket(grant.wsUrl, ["bearer", grant.token]);
    } catch {
      this.fail("socket");
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => this.fail("socket"), CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      this.clearConnectTimer();
      if (this.stage !== "opening") return;
      this.stage = "streaming";
      for (const chunk of this.queue) socket.send(chunk);
      this.queue = [];
      this.opened?.();
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") this.onMessage(event.data);
    };
    socket.onclose = () => this.onSocketGone();
    socket.onerror = () => this.onSocketGone();
  }

  private onMessage(raw: string): void {
    const message = parseFluxMessage(raw);
    if (message.type === "TurnInfo") {
      if (message.transcript.trim() && message.transcript !== this.lastText) {
        this.lastText = message.transcript;
        this.transcriptChanged = true;
      }
      this.handlers.onTurn(message);
      if (message.event === "EndOfTurn") this.endOfTurn?.();
    } else if (message.type === "Warning" && message.code === NO_ACTIVE_TURN) {
      this.endOfTurn?.();
    } else if (message.type === "Error") {
      this.fail("socket");
    }
  }

  private onSocketGone(): void {
    this.socketClosed?.();
    this.endOfTurn?.();
    // While finishing, a closed socket is expected. Before that it means the service dropped us.
    if (this.stage === "opening" || this.stage === "streaming") this.fail("socket");
  }

  private sendAudio(mic: ArrayBuffer): void {
    // Silence of the same length keeps Flux's clock running, and the socket alive.
    const chunk = this.gated ? new ArrayBuffer(mic.byteLength) : mic;
    if (this.stage === "streaming" || this.stage === "finishing") {
      if (this.socketIsOpen()) this.socket!.send(chunk);
    } else if (this.stage === "opening") {
      this.queue.push(chunk);
    }
  }

  private startWatch(): void {
    this.stopWatch();
    const frame = { level: 0, bands: new Float32Array(16) };
    let watchdog = NEW_WATCHDOG;
    this.watch = setInterval(() => {
      this.meter.read(frame);
      const result = tickWatchdog(watchdog, {
        elapsedMs: WATCH_INTERVAL_MS,
        level: frame.level,
        transcriptChanged: this.transcriptChanged,
      });
      watchdog = result.watchdog;
      this.transcriptChanged = false;
      if (result.expired) this.fail("no-transcript");
    }, WATCH_INTERVAL_MS);
  }

  private fail(reason: FallbackReason): void {
    if (this.stage === "closed" || this.stage === "idle") return;
    this.teardown();
    this.handlers.onFailed(reason);
  }

  private fetchGrant(): PendingGrant {
    const grant: PendingGrant = { value: this.deps.fetchGrant(), at: Date.now(), failed: false };
    grant.value.catch(() => {
      grant.failed = true;
    });
    return grant;
  }

  private isFresh(grant: PendingGrant): boolean {
    return Date.now() - grant.at < GRANT_FRESH_MS;
  }

  private socketIsOpen(): boolean {
    return this.socket?.readyState === SOCKET_OPEN;
  }

  private stopWatch(): void {
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private releaseMic(): void {
    this.mic?.release();
    this.mic = null;
  }

  private teardown(): void {
    this.run += 1;
    this.stage = "closed";
    this.stopWatch();
    this.clearConnectTimer();
    this.releaseMic();
    this.queue = [];
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
    const waiting = [this.endOfTurn, this.socketClosed, this.opened];
    this.endOfTurn = this.socketClosed = this.opened = null;
    for (const resolve of waiting) resolve?.();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
