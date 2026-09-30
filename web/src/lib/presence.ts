import { useEffect, useState } from "react";
import { api } from "./api";
import type { LanyardData, PresenceResponse } from "./types";

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Live presence. Discord comes from the Lanyard WebSocket (instant updates);
 * Steam and the manual status override come from our cached API, polled.
 * Pass enabled=false to stop all network activity (e.g. admin preview).
 */
export function usePresence(discordId: string, enabled: boolean) {
  const [server, setServer] = useState<PresenceResponse | null>(null);
  const [live, setLive] = useState<LanyardData | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      api
        .presence()
        .then((p) => alive && setServer(p))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !SNOWFLAKE.test(discordId)) return;
    let ws: WebSocket | null = null;
    let beat: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let closed = false;

    const connect = () => {
      ws = new WebSocket("wss://api.lanyard.rest/socket");
      ws.onmessage = (ev) => {
        let msg: { op: number; t?: string; d?: unknown };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.op === 1) {
          const interval = (msg.d as { heartbeat_interval: number }).heartbeat_interval;
          ws?.send(JSON.stringify({ op: 2, d: { subscribe_to_id: discordId } }));
          beat = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ op: 3 })), interval);
        } else if (msg.op === 0 && (msg.t === "INIT_STATE" || msg.t === "PRESENCE_UPDATE")) {
          attempts = 0;
          setLive(msg.d as LanyardData);
        }
      };
      ws.onclose = () => {
        clearInterval(beat);
        if (closed) return;
        attempts++;
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts));
      };
    };
    connect();
    return () => {
      closed = true;
      clearInterval(beat);
      clearTimeout(retry);
      ws?.close();
    };
  }, [discordId, enabled]);

  const discord = live ?? server?.discord ?? null;
  const override = server?.discord_override || "";
  return {
    discord,
    status: (override || discord?.discord_status || "offline") as "online" | "idle" | "dnd" | "offline",
    steam: server?.steam ?? null,
    lastfm: server?.lastfm ?? null,
  };
}

/**
 * Activity image keys from Lanyard. "mp:external/<sig>/https/host/path" keys
 * wrap an ordinary public URL; Spotify keys point at Spotify's CDN. App assets
 * hosted by Discord are not loaded; the row shows an icon instead.
 */
export function activityImage(key: string | undefined, appId: string | undefined): string {
  if (!key) return "";
  if (key.startsWith("mp:external/")) return unwrapExternal(key);
  if (key.startsWith("spotify:")) return `https://i.scdn.co/image/${key.slice(8)}`;
  void appId;
  return "";
}

function unwrapExternal(key: string): string {
  const parts = key.replace(/^mp:external\//, "").split("/");
  if (parts.length >= 3 && (parts[1] === "https" || parts[1] === "http")) {
    return `https://${parts.slice(2).join("/")}`;
  }
  return "";
}
