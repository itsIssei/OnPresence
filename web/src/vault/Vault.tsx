import { useMemo, useState } from "react";
import { ArrowLeft, Check, Clock, Copy, ExternalLink, Pause, Play, Search, Star } from "lucide-react";
import { siSpotify, siYoutubemusic } from "simple-icons";
import { BrandIcon } from "@/lib/icons";
import { strings, type Strings } from "@/lib/i18n";
import type { Game, Media, Playlist, PublicProfile, Referral, SectionId, Vault as VaultData } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AudioController } from "@/site/audio";
import { Modal, ModalDescription as DialogDescription, ModalTitle as DialogTitle } from "./Modal";

interface Props {
  profile: PublicProfile;
  vault: VaultData;
  audio: AudioController | null;
  onClose: () => void;
}

type Detail = { kind: "game"; item: Game } | { kind: "media"; item: Media } | { kind: "playlist"; item: Playlist };

export function Vault({ profile, vault, audio, onClose }: Props) {
  const s = profile.settings;
  const t = strings;
  const [filter, setFilter] = useState<SectionId | "all">("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);

  const q = query.trim().toLowerCase();
  const match = (...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q));

  const data = useMemo(
    () => ({
      referrals: vault.referrals.filter((r) => match(r.title, r.game_name, r.description)),
      games: vault.games.filter((g) => match(g.title, g.subtitle, g.category, g.review_note)),
      anime: vault.anime.filter((m) => match(m.title, m.tags, m.category_badge)),
      manga: vault.manga.filter((m) => match(m.title, m.tags, m.category_badge)),
      music: vault.playlists.filter((p) => match(p.title, p.artist, p.subtitle, ...p.tracks.map((x) => x.title))),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault, q],
  );

  const sections = s.sections.filter((id) => (id === "music" ? vault.playlists.length : vault[id].length) > 0);
  const visible = sections.filter((id) => filter === "all" || filter === id);
  const labels: Record<SectionId, string> = { referrals: t.referrals, games: t.games, anime: t.anime, manga: t.manga, music: t.music };
  const empty = visible.every((id) => data[id].length === 0);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6" aria-label={s.vault_title}>
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-white/5 bg-[color-mix(in_oklch,var(--page-bg)_80%,transparent)] px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 flex-none place-items-center rounded-xl bg-white/5 text-white/80 transition hover:bg-white/10 hover:text-white"
            aria-label={t.closeVault}
          >
            <ArrowLeft className="size-5" />
          </button>
          {s.vault_icon && <img src={s.vault_icon} alt="" className="size-10 flex-none rounded-xl object-cover" />}
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-lg font-bold text-white sm:text-xl">{s.vault_title}</h2>
            <p className="truncate text-xs text-white/55 sm:text-sm">{s.vault_subtitle}</p>
          </div>
          <label className="relative hidden w-64 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:border-[var(--brand)] focus:outline-none"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {(["all", ...sections] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={cn(
                "flex-none rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
                filter === id ? "bg-brand text-white shadow-[0_0_20px_-4px_var(--brand)]" : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white",
              )}
            >
              {id === "all" ? t.all : labels[id]}
              {id !== "all" && <span className="ml-1.5 opacity-60">{id === "music" ? vault.playlists.length : vault[id].length}</span>}
            </button>
          ))}
        </div>
        <label className="relative mt-3 block sm:hidden">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:border-[var(--brand)] focus:outline-none"
          />
        </label>
      </div>

      {empty && <p className="py-16 text-center text-sm text-white/50">{q ? t.noResults : t.empty}</p>}

      <div className="flex flex-col gap-12">
        {visible.map((id) => {
          const items = data[id];
          if (!items.length) return null;
          return (
            <div key={id}>
              <h3 className="mb-4 flex items-center gap-2 font-display text-base font-bold uppercase tracking-[0.12em] text-white/90">
                <span className="size-2 rounded-full bg-brand shadow-[0_0_10px_var(--brand)]" />
                {labels[id]}
              </h3>
              {id === "referrals" && <Referrals items={data.referrals} t={t} />}
              {id === "games" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.games.map((g) => (
                    <GameCard key={g.id} g={g} t={t} onOpen={() => setDetail({ kind: "game", item: g })} />
                  ))}
                </div>
              )}
              {(id === "anime" || id === "manga") && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {data[id].map((m) => (
                    <MediaCard key={m.id} m={m} t={t} onOpen={() => setDetail({ kind: "media", item: m })} />
                  ))}
                </div>
              )}
              {id === "music" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.music.map((p) => (
                    <PlaylistCard key={p.id} p={p} t={t} audio={audio} onOpen={() => setDetail({ kind: "playlist", item: p })} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)}>
          {detail && <DetailView d={detail} t={t} audio={audio} />}
      </Modal>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Cover({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return src && failed !== src ? (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(src)}
      className={cn("size-full object-cover transition duration-500 group-hover:scale-[1.04]", className)}
    />
  ) : (
    <div className="grid size-full place-items-center bg-gradient-to-br from-[color-mix(in_oklch,var(--brand)_35%,transparent)] to-transparent font-display text-2xl font-bold text-white/70">
      {alt.slice(0, 1)}
    </div>
  );
}

const BADGE_TYPE_LABEL: Record<string, string> = { masterpiece: "Masterpiece", good: "Good", okay: "Okay", trash: "Trash" };

function GameCard({ g, t, onOpen }: { g: Game; t: Strings; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] text-left transition hover:-translate-y-0.5 hover:border-white/15">
      <div className="relative aspect-[460/215] overflow-hidden bg-black/40">
        <Cover src={g.cover_image} alt={g.title} />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
        {g.is_featured && (
          <span className="absolute left-2 top-2 rounded-md bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">{t.featured}</span>
        )}
        <img src={`/img/badges/${g.badge_type}.svg`} alt={BADGE_TYPE_LABEL[g.badge_type]} title={BADGE_TYPE_LABEL[g.badge_type]} className="absolute right-2 top-2 size-9 drop-shadow-lg" />
        {g.rating && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white backdrop-blur">
            <Star className="size-3 fill-current text-amber-400" />
            {g.rating}
          </span>
        )}
      </div>
      <div className="p-3.5">
        <p className="truncate font-semibold text-white">{g.title}</p>
        <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-white/55">
          {g.category && <span>{g.category}</span>}
          {g.hours_played > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {g.hours_played}
              {t.hours}
            </span>
          )}
        </p>
      </div>
    </button>
  );
}

function MediaCard({ m, t, onOpen }: { m: Media; t: Strings; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group text-left">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-white/[0.07] bg-black/40 transition group-hover:-translate-y-0.5 group-hover:border-white/15">
        <Cover src={m.cover_image} alt={m.title} />
        {m.is_featured && <span className="absolute left-2 top-2 rounded-md bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">{t.featured}</span>}
        {m.rating && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
            <Star className="size-3 fill-current text-amber-400" />
            {m.rating}
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-white">{m.title}</p>
      {m.progress_info && <p className="mt-0.5 truncate text-xs text-white/50">{m.progress_info}</p>}
    </button>
  );
}

function PlaylistCard({ p, t, audio, onOpen }: { p: Playlist; t: Strings; audio: AudioController | null; onOpen: () => void }) {
  const url = p.audio_url || p.tracks.find((x) => x.audio_url)?.audio_url || "";
  const isPlaying = !!audio && audio.playing && audio.track?.url === url;
  return (
    <div className="group flex gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 transition hover:border-white/15">
      <button type="button" onClick={onOpen} className="relative size-24 flex-none overflow-hidden rounded-xl bg-black/40">
        <Cover src={p.cover_image} alt={p.title} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <button type="button" onClick={onOpen} className="text-left">
          <p className="truncate font-semibold text-white">{p.title}</p>
          <p className="truncate text-xs text-white/55">{p.artist || p.subtitle}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-white/40">
            {p.type === "solo" ? p.duration : `${p.tracks.length} ${t.tracks}`}
          </p>
        </button>
        <div className="mt-auto flex items-center gap-1.5 pt-2">
          {url && audio && (
            <button
              type="button"
              onClick={() => (isPlaying ? audio.pause() : audio.play({ url, title: p.title, artist: p.artist, cover: p.cover_image }))}
              className="grid size-8 place-items-center rounded-full bg-brand text-white transition hover:brightness-110"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 translate-x-px fill-current" />}
            </button>
          )}
          <MusicLinks p={p} />
        </div>
      </div>
    </div>
  );
}

function MusicLinks({ p }: { p: Playlist }) {
  return (
    <>
      {p.spotify_url && p.spotify_url !== "https://open.spotify.com" && (
        <a href={p.spotify_url} target="_blank" rel="noopener noreferrer" aria-label="Spotify" className="grid size-8 place-items-center rounded-full bg-white/5 text-[#1ed760] transition hover:bg-white/10">
          <BrandIcon icon={siSpotify} className="size-4" />
        </a>
      )}
      {p.yt_music_url && p.yt_music_url !== "https://music.youtube.com" && (
        <a href={p.yt_music_url} target="_blank" rel="noopener noreferrer" aria-label="YouTube Music" className="grid size-8 place-items-center rounded-full bg-white/5 text-[#ff0033] transition hover:bg-white/10">
          <BrandIcon icon={siYoutubemusic} className="size-4" />
        </a>
      )}
    </>
  );
}

function Referrals({ items, t }: { items: Referral[]; t: Strings }) {
  const projects = items.filter((r) => r.kind === "project");
  const referrals = items.filter((r) => r.kind !== "project");
  const both = projects.length > 0 && referrals.length > 0;
  return (
    <div className="grid gap-6">
      {projects.length > 0 && (
        <div className="grid gap-3">
          {both && <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">{t.projects}</h4>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((r) => (
              <ProjectCard key={r.id} r={r} t={t} />
            ))}
          </div>
        </div>
      )}
      {referrals.length > 0 && (
        <div className="grid gap-3">
          {both && <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">{t.invites}</h4>}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {referrals.map((r) => (
              <ReferralCard key={r.id} r={r} t={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Pretty label for a link: "example.com/tools" for same-site paths, host+path otherwise. */
function linkLabel(url: string): string {
  try {
    const u = new URL(url, location.origin);
    return (u.host + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

function ProjectCard({ r, t }: { r: Referral; t: Strings }) {
  const internal = r.ref_url.startsWith("/");
  const body = (
    <>
      <div className={cn("relative overflow-hidden bg-black/40", r.display_style === "banner" ? "aspect-[6/1]" : "aspect-video")}>
        <Cover src={r.image_url} alt={r.title} />
        {r.badge && (
          <span className="absolute left-2 top-2 rounded-md bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-[0_0_16px_-2px_var(--brand)]">
            {r.badge}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {r.game_name && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{r.game_name}</p>}
        <p className="font-semibold text-white">{r.title}</p>
        {r.description && <p className="line-clamp-3 text-sm text-white/60">{r.description}</p>}
        {r.reward_text && <p className="text-xs font-medium text-[color-mix(in_oklch,var(--brand)_70%,white)]">{r.reward_text}</p>}
        {r.ref_url && (
          <span className="mt-auto flex items-center gap-1.5 pt-2 font-mono text-xs text-white/55 transition group-hover:text-white">
            {linkLabel(r.ref_url)}
            <ExternalLink className="size-3.5" />
          </span>
        )}
      </div>
    </>
  );
  const cls = "group flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] text-left transition hover:-translate-y-0.5 hover:border-[color-mix(in_oklch,var(--brand)_45%,transparent)]";
  return r.ref_url ? (
    <a href={r.ref_url} target={internal ? undefined : "_blank"} rel={internal ? undefined : "noopener noreferrer"} className={cls} aria-label={`${t.open} ${r.title}`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function ReferralCard({ r, t }: { r: Referral; t: Strings }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(r.ref_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03]">
      {r.image_url && (
        <div className={cn("relative overflow-hidden bg-black/40", r.display_style === "banner" ? "aspect-[6/1]" : "aspect-video")}>
          <Cover src={r.image_url} alt={r.game_name || r.title} />
          {r.badge && <span className="absolute left-2 top-2 rounded-md bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold uppercase text-black">{r.badge}</span>}
        </div>
      )}
      <div className="flex flex-col gap-2 p-4">
        <p className="font-semibold text-white">{r.title}</p>
        {r.description && <p className="text-sm text-white/60">{r.description}</p>}
        {r.reward_text && <p className="text-xs font-medium text-emerald-400">{r.reward_text}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {r.ref_code && (
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-white transition hover:bg-white/10"
              aria-label={t.copyCode}
            >
              {r.ref_code}
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5 opacity-60" />}
            </button>
          )}
          {r.ref_url && (
            <a
              href={r.ref_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-black transition hover:brightness-110"
            >
              {t.join}
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailView({ d, t, audio }: { d: Detail; t: Strings; audio: AudioController | null }) {
  if (d.kind === "game") {
    const g = d.item;
    return (
      <>
        <div className="relative aspect-[460/215] bg-black/40">
          <Cover src={g.cover_image} alt={g.title} />
        </div>
        <div className="space-y-3 p-5">
          <DialogTitle className="font-display text-xl">{g.title}</DialogTitle>
          <DialogDescription className="text-white/60">{[g.subtitle, g.category].filter(Boolean).join(" · ")}</DialogDescription>
          <div className="flex flex-wrap gap-2 text-xs">
            {g.rating && <Chip>★ {g.rating}</Chip>}
            {g.badge && <Chip>{g.badge}</Chip>}
            {g.hours_played > 0 && <Chip>{g.hours_played} {t.hours}</Chip>}
            <Chip>{BADGE_TYPE_LABEL[g.badge_type]}</Chip>
          </div>
          {g.review_note && <p className="whitespace-pre-line text-sm leading-relaxed text-white/80">{g.review_note}</p>}
        </div>
      </>
    );
  }
  if (d.kind === "media") {
    const m = d.item;
    return (
      <div className="flex gap-4 p-5">
        <div className="w-28 flex-none overflow-hidden rounded-xl">
          <div className="aspect-[2/3]">
            <Cover src={m.cover_image} alt={m.title} />
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <DialogTitle className="font-display text-lg leading-snug">{m.title}</DialogTitle>
          <DialogDescription className="text-white/60">{[m.type, m.progress_info].filter(Boolean).join(" · ")}</DialogDescription>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {m.rating && <Chip>★ {m.rating}</Chip>}
            {m.rank_badge && <Chip>{m.rank_badge}</Chip>}
            {m.category_badge && <Chip>{m.category_badge}</Chip>}
          </div>
          {m.tags && <p className="text-xs text-white/45">{m.tags}</p>}
          {m.review_note && <p className="whitespace-pre-line pt-1 text-sm leading-relaxed text-white/80">{m.review_note}</p>}
          {m.anilist_id > 0 && (
            <a
              href={`https://anilist.co/${m.type === "anime" ? "anime" : "manga"}/${m.anilist_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
            >
              AniList <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    );
  }
  const p = d.item;
  return (
    <div className="p-5">
      <div className="flex gap-4">
        <div className="size-28 flex-none overflow-hidden rounded-xl">
          <Cover src={p.cover_image} alt={p.title} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <DialogTitle className="font-display text-lg leading-snug">{p.title}</DialogTitle>
          <DialogDescription className="text-white/60">{p.artist || p.subtitle}</DialogDescription>
          <div className="flex gap-1.5 pt-1">
            <MusicLinks p={p} />
          </div>
        </div>
      </div>
      {p.tracks.length > 0 && (
        <ol className="mt-4 divide-y divide-white/5 rounded-xl border border-white/5">
          {p.tracks.map((tr, i) => {
            const active = !!audio && audio.playing && audio.track?.url === tr.audio_url;
            return (
              <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-5 text-right text-xs tabular-nums text-white/40">{tr.track_number || i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate", active ? "text-brand" : "text-white")}>{tr.title}</p>
                  <p className="truncate text-xs text-white/50">{tr.artist}</p>
                </div>
                <span className="text-xs tabular-nums text-white/40">{tr.duration}</span>
                {tr.audio_url && audio && (
                  <button
                    type="button"
                    onClick={() => (active ? audio.pause() : audio.play({ url: tr.audio_url, title: tr.title, artist: tr.artist, cover: p.cover_image }))}
                    className="grid size-7 place-items-center rounded-full bg-white/5 hover:bg-white/10"
                    aria-label={active ? "Pause" : "Play"}
                  >
                    {active ? <Pause className="size-3 fill-current" /> : <Play className="size-3 fill-current" />}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-medium text-white/75">{children}</span>;
}
