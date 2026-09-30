import { useEffect, useState } from "react";
import { Gamepad2, Music2 } from "lucide-react";
import { siLastdotfm, siSpotify, siSteam, siYoutubemusic } from "simple-icons";
import { BrandIcon } from "@/lib/icons";
import { activityImage } from "@/lib/presence";
import type { LanyardActivity, LanyardData, LastfmTrack, MusicMode, SteamPresence } from "@/lib/types";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

interface Props {
  discord: LanyardData | null;
  steam: SteamPresence | null;
  lastfm: LastfmTrack | null;
  musicMode: MusicMode;
}

/** Live activity rows: music, game, Steam. Renders nothing when idle. */
export function Activity({ discord, steam, lastfm, musicMode }: Props) {
  const acts = discord?.activities ?? [];
  const ytm = acts.find((a) => a.type === 2 && /youtube music/i.test(a.name));
  const game = acts.find((a) => a.type === 0);

  const rows: React.ReactNode[] = [];
  if (musicMode !== "off" && musicMode !== "custom") {
    if ((musicMode === "auto" || musicMode === "spotify") && discord?.spotify) {
      rows.push(<SpotifyRow key="sp" sp={discord.spotify} />);
    } else if ((musicMode === "auto" || musicMode === "ytmusic") && ytm) {
      rows.push(<ListeningRow key="ytm" act={ytm} />);
    } else if ((musicMode === "auto" || musicMode === "lastfm") && lastfm?.now_playing) {
      rows.push(<LastfmRow key="lfm" track={lastfm} />);
    }
  }
  if (game) rows.push(<GameRow key="game" act={game} />);
  else if (steam?.in_game && steam.game_title) rows.push(<SteamRow key="steam" steam={steam} />);

  if (!rows.length) return null;
  return <div className="flex flex-col gap-2">{rows}</div>;
}

export function customStatus(discord: LanyardData | null): string {
  const c = discord?.activities?.find((a) => a.type === 4);
  if (!c) return "";
  return [c.emoji && !c.emoji.id ? c.emoji.name : "", c.state].filter(Boolean).join(" ");
}

function Row({ art, fallback, label, icon, title, sub, children }: {
  art?: string;
  fallback: React.ReactNode;
  label: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-2.5 pr-3.5">
      <div className="relative size-14 flex-none overflow-hidden rounded-xl bg-white/5">
        {art ? <img src={art} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center text-white/50">{fallback}</div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">
          {icon}
          {label}
        </div>
        <p className="truncate text-sm font-semibold text-white">{title}</p>
        <p className="truncate text-xs text-white/60">{sub}</p>
        {children}
      </div>
    </div>
  );
}

function Progress({ start, end }: { start: number; end: number }) {
  const now = useNow(true);
  const total = end - start;
  const pos = Math.min(total, now - start);
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[10px] tabular-nums text-white/50">
      <span>{fmt(pos)}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-brand transition-[width] duration-1000 ease-linear" style={{ width: `${(pos / total) * 100}%` }} />
      </div>
      <span>{fmt(total)}</span>
    </div>
  );
}

function SpotifyRow({ sp }: { sp: NonNullable<LanyardData["spotify"]> }) {
  return (
    <a href={`https://open.spotify.com/track/${sp.track_id}`} target="_blank" rel="noopener noreferrer" className="block transition hover:brightness-110">
      <Row
        art={sp.album_art_url}
        fallback={<Music2 />}
        label="Listening on Spotify"
        icon={<BrandIcon icon={siSpotify} className="size-3 text-[#1ed760]" />}
        title={sp.song}
        sub={`by ${sp.artist.replaceAll(";", ",")}`}
      >
        {sp.timestamps?.end ? <Progress start={sp.timestamps.start} end={sp.timestamps.end} /> : null}
      </Row>
    </a>
  );
}

function ListeningRow({ act }: { act: LanyardActivity }) {
  return (
    <Row
      art={activityImage(act.assets?.large_image, act.application_id)}
      fallback={<Music2 />}
      label={`Listening on ${act.name}`}
      icon={<BrandIcon icon={siYoutubemusic} className="size-3 text-[#ff0033]" />}
      title={act.details ?? act.name}
      sub={act.state ?? ""}
    >
      {act.timestamps?.start && act.timestamps?.end ? <Progress start={act.timestamps.start} end={act.timestamps.end} /> : null}
    </Row>
  );
}

function LastfmRow({ track }: { track: LastfmTrack }) {
  const row = (
    <Row
      art={track.image}
      fallback={<Music2 />}
      label="Scrobbling on Last.fm"
      icon={<BrandIcon icon={siLastdotfm} className="size-3 text-[#d51007]" />}
      title={track.title}
      sub={[track.artist && `by ${track.artist}`, track.album].filter(Boolean).join(" · ")}
    />
  );
  return track.url ? (
    <a href={track.url} target="_blank" rel="noopener noreferrer" className="block transition hover:brightness-110">
      {row}
    </a>
  ) : (
    row
  );
}

function GameRow({ act }: { act: LanyardActivity }) {
  const now = useNow(!!act.timestamps?.start);
  const elapsed = act.timestamps?.start ? `${fmt(now - act.timestamps.start)} elapsed` : "";
  return (
    <Row
      art={activityImage(act.assets?.large_image, act.application_id)}
      fallback={<Gamepad2 />}
      label="Playing"
      icon={<Gamepad2 className="size-3" />}
      title={act.name}
      sub={[act.details, act.state, elapsed].filter(Boolean).join(" · ")}
    />
  );
}

function SteamRow({ steam }: { steam: SteamPresence }) {
  return (
    <Row
      art={steam.game_banner}
      fallback={<Gamepad2 />}
      label="Playing on Steam"
      icon={<BrandIcon icon={siSteam} className="size-3" />}
      title={steam.game_title ?? ""}
      sub={steam.personaname}
    />
  );
}
