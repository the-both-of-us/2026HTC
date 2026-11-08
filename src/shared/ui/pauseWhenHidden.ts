"use client";

import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from "react";

const YOUTUBE = "https://www.youtube-nocookie.com";

/**
 * False inside a tab panel that is mounted but hidden (StudyTabs keeps every panel mounted).
 * Anything that plays sound pauses while it is false.
 */
export const PanelVisibleContext = createContext(true);

/**
 * Pause a YouTube embed (it needs enablejsapi=1) whenever it can't be seen: its tab panel is
 * hidden, the browser tab is in the background, or Next keeps its route hidden after you navigate
 * away (cacheComponents keeps visited routes in the DOM, so the iframe would keep playing).
 * Pass `userPaused` (true while the person paused it) to play again once it is visible.
 */
export function usePauseWhenHidden(frame: RefObject<HTMLIFrameElement | null>, playing: boolean, userPaused?: RefObject<boolean>) {
  const panelVisible = useContext(PanelVisibleContext);
  const wasHidden = useRef(false);

  useLayoutEffect(() => {
    if (!playing || !panelVisible) return;
    const send = (func: string) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), YOUTUBE);
    if (wasHidden.current && (userPaused ? !userPaused.current : false)) send("playVideo");
    wasHidden.current = false;
    const onVisibility = () => {
      if (document.hidden) send("pauseVideo");
      else if (userPaused ? !userPaused.current : false) send("playVideo");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      send("pauseVideo");
      wasHidden.current = true;
    };
  }, [playing, panelVisible, frame, userPaused]);
}
