import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, Check, ChevronRight, Clock, Copy, ExternalLink, Link as LinkIcon, Pause, Play, Search, Star } from "lucide-react";
import { siSpotify, siYoutubemusic } from "simple-icons";
import { BadgeGlyph, BrandIcon } from "@/lib/icons";
import { statusLabel, strings, type StatusKind, type Strings } from "@/lib/i18n";
import { caseSectionId, DEFAULT_RECENT, ITEM_STATUSES, MAX_RECENT, type Case, type CaseItem, type FixedSectionId, type Game, type ItemStatus, type Media, type Playlist, PublicProfile, Referral, SectionId, type VaultBlock, Vault as VaultData, type BlockDensity } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AudioController } from "@/site/audio";
import { Modal, ModalDescription as DialogDescription, ModalTitle as DialogTitle } from "./Modal";

interface Props {
  profile: PublicProfile;
  vault: VaultData;
  audio: AudioController | null;
  /** The /vault/:section?/:id? part of the address. */
  route: { section?: string; id?: string; extra: boolean };
  onClose: () => void;
}

type Detail = { kind: "case"; item: CaseItem; aspect: Case["aspect"]; caseId: number } | { kind: "game"; item: Game } | { kind: "media"; item: Media } | { kind: "playlist"; item: Playlist } | { kind: "entry"; item: Referral };

/** A tile of the featured and recent rows: any item of any section. */
interface Entry {
  key: string;
  title: string;
  sub: string;
  image: string;
  rating: string;
  created: string;
  featured: boolean;
  detail: Detail;
}

// Grid columns per density. The "normal" column is the original fixed layout.
const GRID_COLS = {
  games: { compact: "grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", normal: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", large: "grid-cols-1 lg:grid-cols-2" },
  media: {
    compact: "grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7",
    normal: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
    large: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
  },
  music: { compact: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4", normal: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", large: "grid-cols-1 lg:grid-cols-2" },
} as const;

const SIZE_STEPS = ["small", "medium", "large"] as const;
const CASE_LAYOUT = { grid: "poster", wide: "wide", list: "list" } as const;

const FIXED_SECTIONS: FixedSectionId[] = ["referrals", "games", "anime", "manga", "music"];

/** "games" or "case-3" (the address form) to a section id; null when it is neither. */
function parseSlug(raw?: string): SectionId | null {
  if (!raw) return null;
  if ((FIXED_SECTIONS as string[]).includes(raw)) return raw as FixedSectionId;
  const m = /^case-([1-9]\d*)$/.exec(raw);
  return m ? (`case:${m[1]}` as SectionId) : null;
}

/** The address of a section, an item of it, and an optional status filter. */
function vaultPath(section?: SectionId, itemId?: number, status?: ItemStatus): string {
  if (!section) return "/vault";
  return `/vault/${section.replace(":", "-")}${itemId ? `/${itemId}` : ""}${status ? `?status=${status}` : ""}`;
}

/** The section and id an item is addressed by. */
function refOf(d: Detail): { section: SectionId; id: number } {
  switch (d.kind) {
    case "case":
      return { section: `case:${d.caseId}`, id: d.item.id };
    case "game":
      return { section: "games", id: d.item.id };
    case "media":
      return { section: d.item.type === "anime" ? "anime" : "manga", id: d.item.id };
    case "playlist":
      return { section: "music", id: d.item.id };
    default:
      return { section: "referrals", id: d.item.id };
  }
}

/** The item at /vault/<section>/<id>, or null. */
function findDetail(v: VaultData, section: SectionId, id: number): Detail | null {
  const caseId = caseSectionId(section);
  if (caseId !== null) {
    const c = v.cases.find((x) => x.id === caseId);
    const item = c?.items.find((i) => i.id === id);
    return c && item ? { kind: "case", item, aspect: c.aspect, caseId: c.id } : null;
  }
  switch (section as FixedSectionId) {
    case "referrals": {
      const item = v.referrals.find((x) => x.id === id);
      return item ? { kind: "entry", item } : null;
    }
    case "games": {
      const item = v.games.find((x) => x.id === id);
      return item ? { kind: "game", item } : null;
    }
    case "anime":
    case "manga": {
      const item = v[section as "anime" | "manga"].find((x) => x.id === id);
      return item ? { kind: "media", item } : null;
    }
    case "music": {
      const item = v.playlists.find((x) => x.id === id);
      return item ? { kind: "playlist", item } : null;
    }
    default:
      return null;
  }
}

export function Vault({ profile, vault, audio, route, onClose }: Props) {
  const s = profile.settings;
  const t = strings;
  const [, navigate] = useLocation();
  const search = useSearch();
  const [query, setQuery] = useState("");

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

  // Every visible item of every section, for the featured and recent rows.
  const entries = useMemo(() => {
    const media = (m: Media): Entry => ({ key: `m${m.id}`, title: m.title, sub: m.progress_info, image: m.cover_image, rating: m.rating, created: m.created_at, featured: m.is_featured, detail: { kind: "media", item: m } });
    return [
      ...vault.games.map((g): Entry => ({ key: `g${g.id}`, title: g.title, sub: g.subtitle || g.category, image: g.cover_image, rating: g.rating, created: g.created_at, featured: g.is_featured, detail: { kind: "game", item: g } })),
      ...vault.anime.map(media),
      ...vault.manga.map(media),
      ...vault.playlists.map((p): Entry => ({ key: `p${p.id}`, title: p.title, sub: p.artist || p.subtitle, image: p.cover_image, rating: "", created: p.created_at, featured: p.is_featured, detail: { kind: "playlist", item: p } })),
      ...vault.referrals.map((r): Entry => ({ key: `r${r.id}`, title: r.title, sub: r.game_name, image: r.image_url, rating: "", created: r.created_at, featured: false, detail: { kind: "entry", item: r } })),
      ...vault.cases.flatMap((c) => c.items.map((i): Entry => ({ key: `c${i.id}`, title: i.title, sub: i.subtitle, image: i.image, rating: i.rating, created: i.created_at, featured: i.is_featured, detail: { kind: "case", item: i, aspect: c.aspect, caseId: c.id } }))),
    ];
  }, [vault]);

  const total = (id: SectionId) => {
    if (caseSectionId(id) !== null) return caseOf(id)?.items.length ?? 0;
    const f = id as FixedSectionId;
    return f === "music" ? vault.playlists.length : vault[f].length;
  };
  // A section block for a case that is gone (deleted, old snapshot) or without items is skipped.
  const blocks = s.vault_blocks ?? [];
  const sectionBlocks = blocks.filter((b) => b.type === "section" && b.section && total(b.section) > 0);
  const sections = sectionBlocks.map((b) => b.section as SectionId);
  const fixedLabels: Record<FixedSectionId, string> = { referrals: t.referrals, games: t.games, anime: t.anime, manga: t.manga, music: t.music };

  // The address decides the open item and the status filter. A bad address
  // goes back to /vault without a history entry.
  const sectionId = parseSlug(route.section);
  const idNum = route.id && /^[1-9]\d*$/.test(route.id) ? Number(route.id) : null;
  const detail = !route.extra && sectionId && idNum ? findDetail(vault, sectionId, idNum) : null;
  const addressed = sectionId && sections.includes(sectionId) ? sectionId : null;
  const bad = route.extra || (route.section !== undefined && (!sectionId || (!route.id && !addressed))) || (route.id !== undefined && !detail);
  useEffect(() => {
    if (bad) navigate("/vault", { replace: true });
  }, [bad, navigate]);
  const statusParam = new URLSearchParams(search).get("status");
  const urlStatus = ITEM_STATUSES.find((x) => x === statusParam);

  // The section chip. It starts on the section of the address.
  const [filter, setFilter] = useState<SectionId | "all">(() => (!bad && addressed ? addressed : "all"));
  const pickSection = (id: SectionId | "all") => {
    setFilter(id);
    navigate(id === "all" ? "/vault" : vaultPath(id), { replace: true });
  };
  const setStatus = (id: SectionId, st?: ItemStatus) => navigate(vaultPath(id, undefined, st), { replace: true });
  // Opening adds a history entry, so back closes the popup. Closing adds one too, so forward and back both work.
  const openDetail = (d: Detail) => {
    const r = refOf(d);
    navigate(vaultPath(r.section, r.id, r.section === addressed ? urlStatus : undefined));
  };
  const closeDetail = () => {
    // The popup also reports a close when the address moved first (back button): do nothing then.
    const m = /^\/vault\/([^/]+)\/[^/]+/.exec(location.pathname);
    if (m) navigate(`/vault/${m[1]}${location.search}`);
  };
  const label = (id: SectionId) => sectionBlocks.find((b) => b.section === id)?.title || caseOf(id)?.name || fixedLabels[id as FixedSectionId];

  const heading = (text: string, icon?: string) => (
    <h3 className="mb-4 flex items-center gap-2 font-display text-base font-bold uppercase tracking-[0.12em] text-white/90">
      {icon ? <BadgeGlyph icon={icon} className="size-4 text-brand" /> : <span className="size-2 rounded-full bg-brand shadow-[0_0_10px_var(--brand)]" />}
      <span className="min-w-0 break-words">{text}</span>
    </h3>
  );

  const renderSection = (b: VaultBlock) => {
    const id = b.section as SectionId;
    if (filter !== "all" && filter !== id) return null;
    const c = caseOf(id);
    const items = c ? data.cases.get(c.id) ?? [] : data[id as FixedSectionId];
    if (!items.length) return null;
    const fixed = id as FixedSectionId;
    const density = b.density ?? "normal";
    const list = b.layout === "list";
    const kind: StatusKind | null = c ? "case" : fixed === "games" ? "game" : fixed === "anime" || fixed === "manga" ? fixed : null;
    const all: { status: ItemStatus }[] = c ? c.items : fixed === "games" || fixed === "anime" || fixed === "manga" ? vault[fixed] : [];
    const present = ITEM_STATUSES.filter((st) => all.some((x) => x.status === st));
    const active = addressed === id && urlStatus && present.includes(urlStatus) ? urlStatus : undefined;
    const byStatus = <T extends { status: ItemStatus }>(l: T[]) => (active ? l.filter((x) => x.status === active) : l);
    const caseView = c && b.layout ? { ...c, layout: CASE_LAYOUT[b.layout as keyof typeof CASE_LAYOUT] ?? c.layout } : c;
    return (
      <div key={id}>
        {heading(label(id), c?.icon)}
        {kind && present.length > 1 && (
          <div className="-mt-1 mb-4 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]" role="group" aria-label={label(id)}>
            {([undefined, ...present] as const).map((st) => (
              <button
                key={st ?? "all"}
                type="button"
                onClick={() => setStatus(id, st)}
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
        {caseView && <CaseGrid c={caseView} density={density} items={byStatus(data.cases.get(caseView.id) ?? [])} t={t} onOpen={(item) => openDetail({ kind: "case", item, aspect: caseView.aspect, caseId: caseView.id })} />}
        {id === "referrals" && <Referrals items={data.referrals} t={t} onOpen={(item) => openDetail({ kind: "entry", item })} />}
        {id === "games" && b.layout === "tier" && <TierList games={byStatus(data.games)} t={t} onOpen={(g) => openDetail({ kind: "game", item: g })} />}
        {id === "games" && b.layout !== "tier" && (
          <div className={cn("grid", list ? "grid-cols-1 gap-2" : cn("gap-4", GRID_COLS.games[density]))}>
            {byStatus(data.games).map((g) =>
              list ? (
                <ListRow key={g.id} image={g.cover_image} title={g.title} sub={[g.category, g.hours_played ? `${g.hours_played}${t.hours}` : ""].filter(Boolean).join(" · ")} rating={g.rating} status={g.status} kind="game" thumb="aspect-[460/215] w-28" onOpen={() => openDetail({ kind: "game", item: g })} />
              ) : (
                <GameCard key={g.id} g={g} t={t} onOpen={() => openDetail({ kind: "game", item: g })} />
              ),
            )}
          </div>
        )}
        {(id === "anime" || id === "manga") && (
          <div className={cn("grid", list ? "grid-cols-1 gap-2" : cn("gap-4", GRID_COLS.media[density]))}>
            {byStatus(data[id]).map((m) =>
              list ? (
                <ListRow key={m.id} image={m.cover_image} title={m.title} sub={m.progress_info || m.tags} rating={m.rating} status={m.status} kind={mediaKind(m)} thumb="aspect-[2/3] w-14" onOpen={() => openDetail({ kind: "media", item: m })} />
              ) : (
                <MediaCard key={m.id} m={m} t={t} onOpen={() => openDetail({ kind: "media", item: m })} />
              ),
            )}
          </div>
        )}
        {id === "music" && (
          <div className={cn("grid gap-4", list ? "grid-cols-1" : GRID_COLS.music[density])}>
            {data.music.map((p) => (
              <PlaylistCard key={p.id} p={p} t={t} audio={audio} onOpen={() => openDetail({ kind: "playlist", item: p })} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderBlock = (b: VaultBlock, i: number) => {
    if (b.type === "section") return b.section && sections.includes(b.section) ? renderSection(b) : null;
    // Only sections are shown while a section chip is selected.
    if (filter !== "all") return null;
    if (b.type === "text") {
      if (q || (!b.title && !b.body)) return null;
      return (
        <div key={i}>
          {b.title && heading(b.title)}
          {b.body && <p className="whitespace-pre-line break-words text-sm leading-relaxed text-white/75">{b.body}</p>}
        </div>
      );
    }
    if (b.type === "stats") {
      if (q) return null;
      const st = vault.stats;
      return (
        <div key={i}>
          {b.title && heading(b.title)}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([[t.games, st.games], [t.anime, st.anime], [t.manga, st.manga], [t.music, st.playlists]] as const).map(([name, n]) => (
              <div key={name} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
                <p className="font-display text-2xl font-bold tabular-nums text-white">{n}</p>
                <p className="mt-0.5 truncate text-xs uppercase tracking-wider text-white/50">{name}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }
    // featured / recent
    const pool = entries.filter((e) => match(e.title, e.sub));
    const row =
      b.type === "featured"
        ? pool.filter((e) => e.featured).slice(0, MAX_RECENT)
        : [...pool].sort((a, z) => (a.created < z.created ? 1 : a.created > z.created ? -1 : 0)).slice(0, b.count || DEFAULT_RECENT);
    if (!row.length) return null;
    return (
      <div key={i}>
        {heading(b.title || (b.type === "featured" ? t.featured : t.recent))}
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 [scrollbar-width:none]">
          {row.map((e) => (
            <button key={e.key} type="button" onClick={() => openDetail(e.detail)} className="group w-32 flex-none text-left sm:w-36" aria-label={`${e.title}: ${t.details}`}>
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-white/[0.07] bg-black/40 transition group-hover:-translate-y-0.5 group-hover:border-white/15">
                <Cover src={e.image} alt={e.title} />
                {e.rating && (
                  <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                    <Star className="size-3 fill-current text-amber-400" />
                    {e.rating}
                  </span>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-white">{e.title}</p>
              {e.sub && <p className="mt-0.5 truncate text-xs text-white/50">{e.sub}</p>}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const rendered = blocks.map(renderBlock);
  const empty = rendered.every((n) => n === null);

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
              onClick={() => pickSection(id)}
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

      <div className="flex flex-col gap-12">{rendered}</div>

      <Modal open={!!detail} onClose={closeDetail} actions={detail && <CopyLink path={vaultPath(refOf(detail).section, refOf(detail).id)} t={t} />}>
          {detail && <DetailView d={detail} t={t} audio={audio} />}
      </Modal>
    </section>
  );
}

// ---------------------------------------------------------------------------

/** Copies the address of the open item. Hidden where the clipboard API is missing. */
function CopyLink({ path, t }: { path: string; t: Strings }) {
  const [copied, setCopied] = useState(false);
  if (!navigator.clipboard) return null;
  const copy = () => {
    navigator.clipboard.writeText(location.origin + path).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  const label = copied ? t.linkCopied : t.copyLink;
  return (
    <button type="button" onClick={copy} aria-label={label} title={label} className="grid size-8 place-items-center rounded-full bg-black/50 text-white/80 transition hover:bg-black/70 hover:text-white">
      {copied ? <Check className="size-4 text-emerald-400" /> : <LinkIcon className="size-4" />}
    </button>
  );
}

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

/** Games grouped by badge_type into S, A, B and C rows. Empty rows are left out. */
function TierList({ games, t, onOpen }: { games: Game[]; t: Strings; onOpen: (g: Game) => void }) {
  return (
    <div className="grid gap-2">
      {t.tiers.map(([badge, letter]) => {
        const row = games.filter((g) => g.badge_type === badge).sort((a, z) => a.sort_order - z.sort_order);
        if (!row.length) return null;
        return (
          <div key={badge} className="flex overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03]">
            <div className={cn("grid w-11 flex-none place-items-center font-display text-xl font-extrabold text-white sm:w-16 sm:text-3xl", TIER_TONE[badge])} aria-label={BADGE_TYPE_LABEL[badge]}>
              {letter}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap gap-2 p-2">
              {row.map((g) => (
                <button key={g.id} type="button" onClick={() => onOpen(g)} aria-label={`${g.title}: ${t.details}`} title={g.title} className="group w-[7.25rem] text-left sm:w-36">
                  <div className="relative aspect-[460/215] overflow-hidden rounded-lg bg-black/40">
                    <Cover src={g.cover_image} alt={g.title} />
                    <StatusStrip status={g.status} kind="game" />
                  </div>
                  <p className="mt-1 truncate text-[11px] font-semibold text-white/85">{g.title}</p>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TIER_TONE: Record<string, string> = { masterpiece: "bg-rose-500/80", good: "bg-amber-500/80", okay: "bg-emerald-600/80", trash: "bg-slate-500/70" };

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

/** One line per item: the "list" layout of games and anime/manga. */
function ListRow({ image, title, sub, rating, status, kind, thumb, onOpen }: { image: string; title: string; sub: string; rating: string; status: ItemStatus; kind: StatusKind; thumb: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={title} className="group flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-2.5 text-left transition hover:border-white/15">
      <div className={cn("relative flex-none overflow-hidden rounded-lg bg-black/40", thumb)}>
        <Cover src={image} alt={title} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{title}</p>
        {sub && <p className="truncate text-xs text-white/55">{sub}</p>}
      </div>
      <div className="flex flex-none flex-col items-end gap-1 text-xs">
        {rating && (
          <span className="flex items-center gap-1 font-semibold text-white">
            <Star className="size-3 fill-current text-amber-400" />
            {rating}
          </span>
        )}
        {status !== "owned" && <StatusLabel status={status} kind={kind} />}
      </div>
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

/** Density moves every tile one step down (compact) or up (large) the size scale. */
function stepSize(size: string, density: BlockDensity): (typeof SIZE_STEPS)[number] {
  const i = SIZE_STEPS.indexOf(size as (typeof SIZE_STEPS)[number]);
  const shift = density === "compact" ? -1 : density === "large" ? 1 : 0;
  return SIZE_STEPS[Math.min(2, Math.max(0, (i < 0 ? 1 : i) + shift))];
}

function CaseGrid({ c, density, items, t, onOpen }: { c: Case; density: BlockDensity; items: CaseItem[]; t: Strings; onOpen: (i: CaseItem) => void }) {
  const g = CASE_GRID[c.layout] ?? CASE_GRID.poster;
  return (
    <div className={g.grid}>
      {items.map((i) => (
        <CaseItemCard key={i.id} item={i} layout={c.layout} aspect={c.aspect} className={g.span[stepSize(i.size, density)]} t={t} onOpen={() => onOpen(i)} />
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
          {item.status !== "owned" && <StatusLabel status={item.status} kind="case" />}
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

function StatusLabel({ status, kind }: { status: ItemStatus; kind: StatusKind }) {
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white", STATUS_TONE[status])}>{statusLabel(status, kind)}</span>;
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
