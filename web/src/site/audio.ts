import { useCallback, useEffect, useRef, useState } from "react";

const VOL_KEY = "onpresence.volume";
const MUTE_KEY = "onpresence.muted";

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export interface AudioTrack {
  url: string;
  title: string;
  artist?: string;
  cover?: string;
}

/**
 * One shared <audio> element for the page: the profile soundtrack and vault
 * previews. Volume and mute persist per visitor; first-time visitors get
 * defaultVolume. Media Session enables lock-screen / hardware controls.
 */
export function useAudio(defaultTrack: AudioTrack | null, defaultVolume = 0.1) {
  const el = useRef<HTMLAudioElement | null>(null);
  const [picked, setTrack] = useState<AudioTrack | null>(null);
  const track = picked ?? defaultTrack;
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  // Visitor's own choice; null until they move the slider.
  const [userVolume, setUserVolume] = useState<number | null>(() => {
    const v = Number(readStore(VOL_KEY) ?? NaN);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
  });
  const volume = userVolume ?? defaultVolume;

  useEffect(() => {
    const a = new Audio();
    a.loop = true;
    a.preload = "none";
    a.addEventListener("play", () => setPlaying(true));
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("playing", () => setFailed(false));
    a.addEventListener("error", () => {
      setPlaying(false);
      setFailed(true);
    });
    el.current = a;
    return () => {
      a.pause();
      a.removeAttribute("src");
    };
  }, []);

  useEffect(() => {
    if (el.current) el.current.volume = volume;
  }, [volume]);

  const play = useCallback(
    (t?: AudioTrack) => {
      const a = el.current;
      const next = t ?? track;
      if (!a || !next?.url) return;
      const abs = new URL(next.url, location.href).href;
      if (a.src !== abs) {
        setFailed(false);
        a.src = next.url;
        setTrack(next);
      }
      a.volume = volume;
      a.play().catch((e: DOMException) => {
        setPlaying(false);
        // NotAllowedError = autoplay blocked (not a broken file); anything else is.
        if (e?.name !== "NotAllowedError") setFailed(true);
      });
      writeStore(MUTE_KEY, "0");
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: next.title,
          artist: next.artist ?? "",
          artwork: next.cover ? [{ src: new URL(next.cover, location.href).href }] : [],
        });
      }
    },
    [track, volume],
  );

  const pause = useCallback(() => {
    el.current?.pause();
    writeStore(MUTE_KEY, "1");
  }, []);

  const toggle = useCallback(() => (el.current && !el.current.paused ? pause() : play()), [play, pause]);

  const setVolume = useCallback((v: number) => {
    setUserVolume(v);
    writeStore(VOL_KEY, String(v));
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => play());
    navigator.mediaSession.setActionHandler("pause", () => pause());
  }, [play, pause]);

  const mutedByVisitor = readStore(MUTE_KEY) === "1";
  return { track, playing, failed, volume, play, pause, toggle, setVolume, mutedByVisitor };
}

export type AudioController = ReturnType<typeof useAudio>;
