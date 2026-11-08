"use client";

import clsx from "clsx";
import { Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type Ref } from "react";

const YOUTUBE = "https://www.youtube-nocookie.com";

/**
 * The embed without YouTube's own controls: our buttons drive it through the player API. No
 * loop=1: that needs playlist=<id>, which brings back YouTube's previous and next buttons, so the
 * player restarts the video itself when it ends.
 */
function embedSrc(videoId: string) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
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
  /** Whether sound is on. The player always starts muted (browsers allow that) and unmutes once ready. */
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
      if (data?.event === "onReady" && soundOn.current) command("unMute");
      const state = typeof data?.info === "number" ? data.info : data?.info?.playerState;
      if (state === 1) setPaused(false);
      if (state === 2) setPaused(true);
      if (state === 0) {
        command("seekTo", [0, true]);
        command("playVideo");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [playing, command]);

  // Turning sound on or off applies at once.
  useEffect(() => {
    soundOn.current = sound;
    if (playing) command(sound ? "unMute" : "mute");
  }, [sound, playing, command]);

  const onLoad = () => {
    setPaused(false);
    // Ask for the player's events; it answers with onReady, then each state change.
    send({ event: "listening", id: videoId, channel: "widget" });
    if (soundOn.current) command("unMute");
  };

  const togglePause = () => {
    command(paused ? "playVideo" : "pauseVideo");
    setPaused(!paused);
  };

  return (
    <div ref={boxRef} className={clsx("relative aspect-[9/16] shrink-0 overflow-hidden bg-black", className)} style={style}>
      {playing ? (
        <>
          <iframe
            ref={player}
            src={embedSrc(videoId)}
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
