import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Clock, Copy, ExternalLink, Pause, Play, Search, Star } from "lucide-react";
import { siSpotify, siYoutubemusic } from "simple-icons";
import { BadgeGlyph, BrandIcon } from "@/lib/icons";
import { statusLabel, strings, type StatusKind, type Strings } from "@/lib/i18n";
import { caseSectionId, ITEM_STATUSES, type Case, type CaseItem, type FixedSectionId, type Game, type ItemStatus, type Media, type Playlist, PublicProfile, Referral, SectionId, Vault as VaultData } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AudioController } from "@/site/audio";
import { Modal, ModalDescription as DialogDescription, ModalTitle as DialogTitle } from "./Modal";

interface Props {
  profile: PublicProfile;
  vault: VaultData;
  audio: AudioController | null;
  onClose: () => void;
}

type Detail = { kind: "case"; item: CaseItem; aspect: Case["aspect"] } | { kind: "game"; item: Game } | { kind: "media"; item: Media } | { kind: "playlist"; item: Playlist } | { kind: "entry"; item: Referral };

export function Vault({ profile, vault, audio, onClose }: Props) {
  const s = profile.settings;
  const t = strings;
  const [filter, setFilter] = useState<SectionId | "all">("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Partial<Record<SectionId, ItemStatus>>>({});
  const [detail, setDetail] = useState<Detail | null>(null);

  const q = query.trim().toLowerCase();
  const match = (...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q));

  const caseById = useMemo(() => new Map(vault.cases.map((c) => [c.id, c])), [vault]);
  const caseOf = (id: SectionId) => {
    const n = caseSectionId(id);
    return n === null ? undefined : caseById.get(n);
  };

  const data = useMemo(
    () => ({
      cases: new Map(vault.cases.map((c) => [c.id, c.items.filter((i) => match(i.title, i.subtitle, i.tags, i.note))])),
      referrals: vault.referrals.filter((r) => match(r.title, r.game_name, r.description)),
      games: vault.games.filter((g) => match(g.title, g.subtitle, g.category, g.review_note)),
      anime: vault.anime.filter((m) => match(m.title, m.tags, m.category_badge)),
      manga: vault.manga.filter((m) => match(m.title, m.tags, m.category_badge)),
      music: vault.playlists.filter((p) => match(p.title, p.artist, p.subtitle, ...p.tracks.map((x) => x.title))),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault, q],
  );

  const total = (id: SectionId) => {
    if (caseSectionId(id) !== null) return caseOf(id)?.items.length ?? 0;
    const f = id as FixedSectionId;
    return f === "music" ? vault.playlists.length : vault[f].length;
  };
  const found = (id: SectionId) => {
    const c = caseOf(id);
    return c ? data.cases.get(c.id)?.length ?? 0 : data[id as FixedSectionId].length;
  };
  // A "case:<id>" entry without a case (deleted, old snapshot) is skipped.
  const sections = s.sections.filter((id) => total(id) > 0);
  const visible = sections.filter((id) => filter === "all" || filter === id);
  const fixedLabels: Record<FixedSectionId, string> = { referrals: t.referrals, games: t.games, anime: t.anime, manga: t.manga, music: t.music };
  const label = (id: SectionId) => caseOf(id)?.name ?? fixedLabels[id as FixedSectionId];
  const empty = visible.every((id) => found(id) === 0);

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
              {id === "all" ? t.all : label(id)}
              {id !== "all" && <span className="ml-1.5 opacity-60">{total(id)}</span>}
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
          const c = caseOf(id);
          const items = c ? data.cases.get(c.id) ?? [] : data[id as FixedSectionId];
          if (!items.length) return null;
          const fixed = id as FixedSectionId;
          const kind: StatusKind | null = c ? "case" : fixed === "games" ? "game" : fixed === "anime" || fixed === "manga" ? fixed : null;
          const all: { status: ItemStatus }[] = c ? c.items : fixed === "games" || fixed === "anime" || fixed === "manga" ? vault[fixed] : [];
          const present = ITEM_STATUSES.filter((st) => all.some((x) => x.status === st));
          const active = statusFilter[id] && present.includes(statusFilter[id]) ? statusFilter[id] : undefined;
          const byStatus = <T extends { status: ItemStatus }>(list: T[]) => (active ? list.filter((x) => x.status === active) : list);
          return (
            <div key={id}>
              <h3 className="mb-4 flex items-center gap-2 font-display text-base font-bold uppercase tracking-[0.12em] text-white/90">
                {c && c.icon ? <BadgeGlyph icon={c.icon} className="size-4 text-brand" /> : <span className="size-2 rounded-full bg-brand shadow-[0_0_10px_var(--brand)]" />}
                {label(id)}
              </h3>
              {kind && present.length > 1 && (
                <div className="-mt-1 mb-4 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]" role="group" aria-label={label(id)}>
                  {([undefined, ...present] as const).map((st) => (
                    <button
                      key={st ?? "all"}
                      type="button"
                      onClick={() => setStatusFilter((prev) => ({ ...prev, [id]: st }))}
                      aria-pressed={active === st}
                      className={cn(
                        "flex-none rounded-full px-3 py-1 text-[11px] font-semibold transition",
                        active === st ? "bg-white/15 text-white" : "bg-white/5 text-white/55 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      {st ? statusLabel(st, kind) : t.all}
                    </button>
                  ))}
                </div>
              )}
              {c && <CaseGrid c={c} items={byStatus(data.cases.get(c.id) ?? [])} t={t} onOpen={(item) => setDetail({ kind: "case", item, aspect: c.aspect })} />}
              {id === "referrals" && <Referrals items={data.referrals} t={t} onOpen={(item) => setDetail({ kind: "entry", item })} />}
              {id === "games" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {byStatus(data.games).map((g) => (
                    <GameCard key={g.id} g={g} t={t} onOpen={() => setDetail({ kind: "game", item: g })} />
                  ))}
                </div>
              )}
              {(id === "anime" || id === "manga") && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {byStatus(data[id]).map((m) => (
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
        <StatusStrip status={g.status} kind="game" />
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
        <StatusStrip status={m.status} kind={mediaKind(m)} />
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

function Referrals({ items, t, onOpen }: { items: Referral[]; t: Strings; onOpen: (r: Referral) => void }) {
  const projects = items.filter((r) => r.kind === "project");
  const referrals = items.filter((r) => r.kind !== "project");
  const both = projects.length > 0 && referrals.length > 0;
  const group = (title: string, list: Referral[]) =>
    list.length > 0 && (
      <div className="grid gap-3">
        {both && <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">{title}</h4>}
        {/* 6 columns on desktop: small and medium = 2 (a third), large = 6 (full row). */}
        <div className="grid grid-flow-row-dense grid-cols-2 items-start gap-3 lg:grid-cols-6">
          {list.map((r) => (
            <EntryCard key={r.id} r={r} t={t} onOpen={() => onOpen(r)} />
          ))}
        </div>
      </div>
    );
  return (
    <div className="grid gap-6">
      {group(t.projects, projects)}
      {group(t.invites, referrals)}
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

const ENTRY_SPAN = { small: "col-span-1 lg:col-span-2", medium: "col-span-2 sm:col-span-1 lg:col-span-2", large: "col-span-2 lg:col-span-6" } as const;

/**
 * A project or referral tile. It shows only the essentials (image, tag,
 * category, title, one highlight line); everything else is in the details
 * popup, which opens on click.
 */
function EntryCard({ r, t, onOpen }: { r: Referral; t: Strings; onOpen: () => void }) {
  const size = r.size in ENTRY_SPAN ? r.size : "medium";
  const referral = r.kind !== "project";
  const badge = r.badge && (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        referral ? "bg-emerald-500/90 text-black" : "bg-brand text-white shadow-[0_0_16px_-2px_var(--brand)]",
      )}
    >
      {r.badge}
    </span>
  );
  const base =
    "group overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] text-left transition hover:-translate-y-0.5 hover:border-[color-mix(in_oklch,var(--brand)_45%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--brand)]";

  if (size === "small") {
    return (
      <button type="button" onClick={onOpen} className={cn(base, ENTRY_SPAN.small, "flex items-center gap-3 p-2.5")} aria-label={`${r.title}: ${t.details}`}>
        <div className="size-12 flex-none overflow-hidden rounded-xl bg-black/40">
          <Cover src={r.image_url} alt="" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{r.title}</p>
          <p className="truncate text-[11px] uppercase tracking-[0.1em] text-white/45">{r.badge || r.game_name}</p>
        </div>
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} className={cn(base, ENTRY_SPAN[size], "flex flex-col")} aria-label={`${r.title}: ${t.details}`}>
      <div className={cn("relative w-full overflow-hidden bg-black/40", r.display_style === "banner" ? "aspect-[6/1]" : size === "large" ? "aspect-[4/1]" : "aspect-video")}>
        <Cover src={r.image_url} alt={r.title} />
        {badge && <span className="absolute left-2 top-2">{badge}</span>}
      </div>
      <div className="flex w-full items-center gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          {r.game_name && <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{r.game_name}</p>}
          <p className="truncate font-semibold text-white">{r.title}</p>
          {r.reward_text && <p className={cn("truncate text-xs font-medium", referral ? "text-emerald-400" : "text-[color-mix(in_oklch,var(--brand)_70%,white)]")}>{r.reward_text}</p>}
        </div>
        <span className="flex flex-none items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-white/70 transition group-hover:border-white/25 group-hover:text-white">
          {t.details}
          <ChevronRight className="size-3.5" />
        </span>
      </div>
    </button>
  );
}

/** Everything about a project or referral: description, link, code to copy. */
function EntryDetail({ r, t }: { r: Referral; t: Strings }) {
  const [copied, setCopied] = useState(false);
  const referral = r.kind !== "project";
  const internal = r.ref_url.startsWith("/");
  const copy = () => {
    navigator.clipboard?.writeText(r.ref_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <>
      {r.image_url && (
        <div className={cn("relative bg-black/40", r.display_style === "banner" ? "aspect-[6/1]" : "aspect-video")}>
          <Cover src={r.image_url} alt={r.title} />
        </div>
      )}
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {r.game_name && <Chip>{r.game_name}</Chip>}
          {r.badge && <Chip>{r.badge}</Chip>}
        </div>
        <DialogTitle className="font-display text-xl">{r.title}</DialogTitle>
        {r.reward_text ? (
          <DialogDescription className={cn("text-sm font-medium", referral ? "text-emerald-400" : "text-[color-mix(in_oklch,var(--brand)_70%,white)]")}>{r.reward_text}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{r.game_name || r.title}</DialogDescription>
        )}
        {r.description && <p className="whitespace-pre-line text-sm leading-relaxed text-white/80">{r.description}</p>}
        {(r.ref_code || r.ref_url) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {r.ref_code && (
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white transition hover:bg-white/10"
                aria-label={t.copyCode}
              >
                {r.ref_code}
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5 opacity-60" />}
              </button>
            )}
            {r.ref_url && (
              <a
                href={r.ref_url}
                target={internal ? undefined : "_blank"}
                rel={internal ? undefined : "noopener noreferrer"}
                className={cn(
                  "ml-auto flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition hover:brightness-110",
                  referral ? "bg-emerald-500 text-black" : "bg-brand text-white",
                )}
              >
                {referral ? t.join : t.open}
                <span className="font-mono text-xs font-normal opacity-80">{linkLabel(r.ref_url)}</span>
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function DetailView({ d, t, audio }: { d: Detail; t: Strings; audio: AudioController | null }) {
  if (d.kind === "entry") return <EntryDetail r={d.item} t={t} />;
  if (d.kind === "case") return <CaseItemDetail item={d.item} aspect={d.aspect} t={t} />;
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
            {g.status !== "owned" && <Chip>{statusLabel(g.status, "game")}</Chip>}
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
            {m.status !== "owned" && <Chip>{statusLabel(m.status, mediaKind(m))}</Chip>}
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

// ---------------------------------------------------------------------------
// Custom cases

const ASPECT_CLASS = { "2:3": "aspect-[2/3]", "1:1": "aspect-square", "16:9": "aspect-video" } as const;
/** Thumbnail width in the list layout; the height follows the aspect. */
const THUMB_CLASS = { "2:3": "w-16", "1:1": "w-20", "16:9": "w-32" } as const;

// 2 columns on phones, 6 on tablets, 12 on desktops. Small, medium and large
// tiles take 1/2/3 steps of the row. The list layout ignores the size.
const CASE_GRID = {
  poster: {
    grid: "grid grid-flow-row-dense grid-cols-2 gap-4 sm:grid-cols-6 lg:grid-cols-12",
    span: { small: "col-span-1 lg:col-span-2", medium: "col-span-1 sm:col-span-2 lg:col-span-3", large: "col-span-2 sm:col-span-3 lg:col-span-4" },
  },
  wide: {
    grid: "grid grid-flow-row-dense grid-cols-2 gap-4 sm:grid-cols-6 lg:grid-cols-12",
    span: { small: "col-span-2 sm:col-span-2 lg:col-span-3", medium: "col-span-2 sm:col-span-3 lg:col-span-4", large: "col-span-2 sm:col-span-6 lg:col-span-6" },
  },
  list: { grid: "grid gap-2", span: { small: "", medium: "", large: "" } },
} as const;

function CaseGrid({ c, items, t, onOpen }: { c: Case; items: CaseItem[]; t: Strings; onOpen: (i: CaseItem) => void }) {
  const g = CASE_GRID[c.layout] ?? CASE_GRID.poster;
  return (
    <div className={g.grid}>
      {items.map((i) => (
        <CaseItemCard key={i.id} item={i} layout={c.layout} aspect={c.aspect} className={g.span[i.size] ?? g.span.medium} t={t} onOpen={() => onOpen(i)} />
      ))}
    </div>
  );
}

/** One tile of a custom case. The case's layout and aspect decide the shape. */
function CaseItemCard({ item, layout, aspect, className, t, onOpen }: { item: CaseItem; layout: Case["layout"]; aspect: Case["aspect"]; className?: string; t: Strings; onOpen: () => void }) {
  const ratio = ASPECT_CLASS[aspect] ?? ASPECT_CLASS["2:3"];
  const featured = item.is_featured && (
    <span className="absolute left-2 top-2 rounded-md bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">{t.featured}</span>
  );
  const rating = item.rating && (
    <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
      <Star className="size-3 fill-current text-amber-400" />
      {item.rating}
    </span>
  );

  if (layout === "list") {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${item.title}: ${t.details}`}
        className="group flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-2.5 text-left transition hover:border-white/15"
      >
        <div className={cn("relative flex-none overflow-hidden rounded-lg bg-black/40", ratio, THUMB_CLASS[aspect] ?? THUMB_CLASS["2:3"])}>
          <Cover src={item.image} alt={item.title} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{item.title}</p>
          {item.subtitle && <p className="truncate text-xs text-white/55">{item.subtitle}</p>}
          {item.tags && <p className="mt-0.5 truncate text-[11px] text-white/40">{item.tags}</p>}
        </div>
        <div className="flex flex-none flex-col items-end gap-1 text-xs">
          {item.rating && (
            <span className="flex items-center gap-1 font-semibold text-white">
              <Star className="size-3 fill-current text-amber-400" />
              {item.rating}
            </span>
          )}
          {item.is_featured && <span className="rounded-md bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">{t.featured}</span>}
          {item.status !== "owned" && <StatusLabel status={item.status} />}
        </div>
      </button>
    );
  }

  if (layout === "wide") {
    return (
      <button type="button" onClick={onOpen} aria-label={`${item.title}: ${t.details}`} className={cn("group overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] text-left transition hover:-translate-y-0.5 hover:border-white/15", className)}>
        <div className={cn("relative overflow-hidden bg-black/40", ratio)}>
          <Cover src={item.image} alt={item.title} />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
          {featured}
          {rating}
          <StatusStrip status={item.status} kind="case" />
        </div>
        <div className="p-3.5">
          <p className="truncate font-semibold text-white">{item.title}</p>
          {(item.subtitle || item.tags) && <p className="mt-0.5 truncate text-xs text-white/55">{[item.subtitle, item.tags].filter(Boolean).join(" · ")}</p>}
        </div>
      </button>
    );
  }

  return (
    <button type="button" onClick={onOpen} aria-label={`${item.title}: ${t.details}`} className={cn("group text-left", className)}>
      <div className={cn("relative overflow-hidden rounded-xl border border-white/[0.07] bg-black/40 transition group-hover:-translate-y-0.5 group-hover:border-white/15", ratio)}>
        <Cover src={item.image} alt={item.title} />
        {featured}
        {rating}
        <StatusStrip status={item.status} kind="case" />
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-white">{item.title}</p>
      {item.subtitle && <p className="mt-0.5 truncate text-xs text-white/50">{item.subtitle}</p>}
    </button>
  );
}

/** Everything about a case item. The note is plain text. */
function CaseItemDetail({ item, aspect, t }: { item: CaseItem; aspect: Case["aspect"]; t: Strings }) {
  const tags = item.tags.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <>
      {item.image && (
        <div className={cn("relative mx-auto max-h-[60dvh] bg-black/40", aspect === "16:9" ? "w-full" : aspect === "1:1" ? "aspect-square max-w-sm" : "max-w-xs", ASPECT_CLASS[aspect] ?? "")}>
          <Cover src={item.image} alt={item.title} />
        </div>
      )}
      <div className="space-y-3 p-5">
        <DialogTitle className="font-display text-xl">{item.title}</DialogTitle>
        {item.subtitle ? <DialogDescription className="text-white/60">{item.subtitle}</DialogDescription> : <DialogDescription className="sr-only">{item.title}</DialogDescription>}
        <div className="flex flex-wrap gap-2 text-xs">
          {item.rating && <Chip>★ {item.rating}</Chip>}
          {item.status !== "owned" && <Chip>{statusLabel(item.status, "case")}</Chip>}
          {tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
        {item.note && <p className="whitespace-pre-line text-sm leading-relaxed text-white/80">{item.note}</p>}
        {item.link && (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
          >
            {t.open}
            <span className="font-mono text-xs font-normal opacity-80">{linkLabel(item.link)}</span>
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
    </>
  );
}

function StatusLabel({ status }: { status: ItemStatus }) {
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white", STATUS_TONE[status])}>{statusLabel(status, "case")}</span>;
}

const STATUS_TONE: Record<ItemStatus, string> = {
  owned: "bg-black/65 text-white/75",
  playing: "bg-sky-500/80",
  completed: "bg-emerald-600/80",
  dropped: "bg-black/65 text-white/75",
  wishlist: "bg-violet-500/80",
};

function mediaKind(m: Media): StatusKind {
  return m.type === "anime" ? "anime" : "manga";
}

/** Small corner label. Hidden for the default "owned" status. */
function StatusStrip({ status, kind }: { status: ItemStatus; kind: StatusKind }) {
  if (status === "owned") return null;
  return (
    <span
      className={cn(
        "absolute bottom-2 right-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur",
        status === "wishlist" ? "bg-violet-500/80" : status === "playing" ? "bg-sky-500/80" : status === "completed" ? "bg-emerald-600/80" : "bg-black/65 text-white/75",
      )}
    >
      {statusLabel(status, kind)}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-medium text-white/75">{children}</span>;
}
