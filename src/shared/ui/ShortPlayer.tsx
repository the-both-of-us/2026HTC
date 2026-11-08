"use client";

import clsx from "clsx";
import { Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { usePauseWhenHidden } from "./pauseWhenHidden";

const YOUTUBE = "https://www.youtube-nocookie.com";

/**
 * Browsers only allow sound after the person has clicked or pressed a key on the page. Without
 * that, unmuting a playing video pauses it, so wait for the first interaction instead.
 */
function mayPlaySound(): boolean {
  return (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
}

/**
 * The embed without YouTube's own controls: our buttons drive it through the player API. No
 * loop=1: that needs playlist=<id>, which brings back YouTube's previous and next buttons, so the
 * player restarts the video itself when it ends.
 */
function embedSrc(videoId: string, muted: boolean) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    playsinline: "1",
    rel: "0",
    iv_load_policy: "3",
    disablekb: "1",
    fs: "0",
    enablejsapi: "1",
    origin: window.location.origin,
  });
  return `${YOUTUBE}/embed/${videoId}?${params}`;
}

/** A round button over the video, readable on any frame. Video is always dark, so these are fixed colours. */
const overlayButton =
  "flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white";

function BigPlay() {
  return (
    <span className="relative flex size-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
      <Play aria-hidden="true" size={28} className="ml-1 fill-current" />
    </span>
  );
}

export type ShortPlayerProps = {
  videoId: string;
  title: string;
  /** Load the player and play. False shows the thumbnail with a play button instead. */
  playing: boolean;
  /** The thumbnail's play button was pressed. */
  onStart?: () => void;
  /**
   * Whether sound is on. With sound on, a new Short loads unmuted. If the browser refuses to
   * autoplay with sound, it falls back to playing muted and unmutes once it can.
   */
  sound: boolean;
  onSound: (on: boolean) => void;
  boxRef?: Ref<HTMLDivElement>;
  /** Size the box here (it keeps 9:16 itself), plus any corner radius. */
  className?: string;
  style?: CSSProperties;
};

/**
 * A YouTube Short at 9:16 with our own controls: tap the video to pause or play, and a sound
 * button. A tap layer covers the player, which also keeps YouTube's hover controls away. Used by
 * the feed and by the Shorts on a skill.
 */
export function ShortPlayer({ videoId, title, playing, onStart, sound, onSound, boxRef, className, style }: ShortPlayerProps) {
  const player = useRef<HTMLIFrameElement>(null);
  const [paused, setPaused] = useState(false);
  const soundOn = useRef(sound);
  // The sound setting when this Short started playing decides how its player loads. Toggling
  // later talks to the running player instead of reloading it.
  const [startSound, setStartSound] = useState(sound);
  const [wasPlaying, setWasPlaying] = useState(playing);
  if (playing !== wasPlaying) {
    setWasPlaying(playing);
    if (playing) setStartSound(sound);
  }
  /** Unmute nudges for this Short, capped so a strict browser never sees a mute/unmute loop. */
  const nudges = useRef(0);
  const started = useRef(false);

  const send = useCallback((message: object) => {
    player.current?.contentWindow?.postMessage(JSON.stringify(message), YOUTUBE);
  }, []);
  const command = useCallback((func: string, args: unknown[] = []) => send({ event: "command", func, args }), [send]);

  // The player says when it is ready and when it pauses, plays or ends.
  useEffect(() => {
    if (!playing) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== YOUTUBE || event.source !== player.current?.contentWindow) return;
      let data: { event?: string; info?: { playerState?: number } | number } | null = null;
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.event === "onReady" && soundOn.current && mayPlaySound()) command("unMute");
      const info = typeof data?.info === "object" ? (data.info as { muted?: boolean }) : null;
      // The player reports its mute state. Keep it in line with the setting, a few tries at most.
      if (typeof info?.muted === "boolean" && info.muted === soundOn.current && nudges.current < 4 && (!soundOn.current || mayPlaySound())) {
        nudges.current += 1;
        command(soundOn.current ? "unMute" : "mute");
      }
      const state = typeof data?.info === "number" ? data.info : data?.info?.playerState;
      if (state === 1) {
        started.current = true;
        setPaused(false);
      }
      if (state === 2) setPaused(true);
      if (state === 0) {
        command("seekTo", [0, true]);
        command("playVideo");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [playing, command]);

  // Turning sound on or off applies at once, and earns a fresh set of nudges.
  useEffect(() => {
    soundOn.current = sound;
    nudges.current = 0;
    if (playing) command(sound ? "unMute" : "mute");
  }, [sound, playing, command]);

  // Sound is on but the page has had no click or key press yet (say, after a reload): the Short
  // plays muted, and the first interaction anywhere turns the sound on.
  useEffect(() => {
    if (!playing || !sound || mayPlaySound()) return;
    const unmute = () => command("unMute");
    window.addEventListener("pointerdown", unmute, { once: true });
    window.addEventListener("keydown", unmute, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unmute);
      window.removeEventListener("keydown", unmute);
    };
  }, [playing, sound, command]);

  // A browser that refuses to autoplay with sound leaves the player stopped. Then play muted,
  // and the nudges above unmute it as soon as the browser allows.
  useEffect(() => {
    if (!playing || !startSound) return;
    started.current = false;
    const timer = window.setTimeout(() => {
      if (started.current) return;
      command("mute");
      command("playVideo");
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [playing, startSound, videoId, command]);

  const onLoad = () => {
    setPaused(false);
    userPaused.current = false;
    // Ask for the player's events; it answers with onReady, then each state change.
    send({ event: "listening", id: videoId, channel: "widget" });
    nudges.current = 0;
    if (soundOn.current) command("unMute");
  };

  // Paused by a tap, as opposed to paused because the page or tab went out of view.
  const userPaused = useRef(false);
  usePauseWhenHidden(player, playing, userPaused);

  const togglePause = () => {
    command(paused ? "playVideo" : "pauseVideo");
    userPaused.current = !paused;
    setPaused(!paused);
  };

  return (
    <div ref={boxRef} className={clsx("relative aspect-[9/16] shrink-0 overflow-hidden bg-black", className)} style={style}>
      {playing ? (
        <>
          <iframe
            ref={player}
            src={embedSrc(videoId, !startSound || !mayPlaySound())}
            title={`YouTube video: ${title}`}
            onLoad={onLoad}
            allow="autoplay; encrypted-media; picture-in-picture"
            className="absolute inset-0 size-full"
          />
          <button
            type="button"
            onClick={togglePause}
            aria-label={paused ? `Play "${title}"` : `Pause "${title}"`}
            className={clsx(
              "absolute inset-0 flex cursor-pointer items-center justify-center focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-white",
              paused && "bg-black/20",
            )}
          >
            {paused && <BigPlay />}
          </button>
          <button
            type="button"
            onClick={() => onSound(!sound)}
            aria-label={sound ? "Sound on. Turn it off" : "Sound off. Turn it on"}
            aria-pressed={sound}
            className={clsx(overlayButton, "absolute top-3 right-3")}
          >
            {sound ? <Volume2 aria-hidden="true" size={20} /> : <VolumeX aria-hidden="true" size={20} />}
          </button>
        </>
      ) : (
        <button type="button" onClick={onStart} aria-label={`Play "${title}"`} className="absolute inset-0 flex cursor-pointer items-center justify-center">
          <ShortThumbnail videoId={videoId} className="opacity-85" />
          <BigPlay />
        </button>
      )}
    </div>
  );
}

/**
 * A Short's thumbnail filling a 9:16 box. YouTube's 4:3 thumbnail holds the portrait frame in its
 * middle, so covering the box shows just that frame.
 */
export function ShortThumbnail({ videoId, className }: { videoId: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" loading="lazy" className={clsx("absolute inset-0 size-full object-cover", className)} />
  );
}
