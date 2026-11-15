import { useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, GripVertical, Loader2, Plus, Search, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge as UIBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type AniListResult, type GameSearchResult } from "@/lib/api";
import { BADGE_ICONS, BadgeGlyph } from "@/lib/icons";
import { statusLabel, type StatusKind } from "@/lib/i18n";
import { caseSectionId, type Case, type CaseItem, type FixedSectionId, ITEM_STATUSES, type Game, type ItemStatus, type Media, Playlist, Referral, SectionId, Track } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDraft } from "../draft";
import { CollectionManager, type FieldDef } from "../Collection";
import { Field, MediaInput, PageHeader, Section } from "../kit";

const SECTION_LABEL: Record<FixedSectionId, string> = { referrals: "Projects & referrals", games: "Games", anime: "Anime", manga: "Manga & manhwa", music: "Music" };
const TABS: { id: FixedSectionId; label: string }[] = [
  { id: "games", label: "Games" },
  { id: "anime", label: "Anime" },
  { id: "manga", label: "Manga" },
  { id: "music", label: "Music" },
  { id: "referrals", label: "Projects & referrals" },
];

export function VaultPage() {
  const { draft, setSetting } = useDraft();
  const s = draft?.settings;
  const shown = (id: SectionId) => !!s?.sections.includes(id);
  const setShown = (id: SectionId, on: boolean) => {
    if (!s) return;
    const order: SectionId[] = [...s.sections, ...TABS.map((t) => t.id).filter((x) => !s.sections.includes(x))];
    setSetting("sections", on ? order.filter((x) => x === id || s.sections.includes(x)) : s.sections.filter((x) => x !== id));
  };

  return (
    <>
      <PageHeader title="Display case" description="Your hobbies and projects. Close the whole case or single categories while you work on them." />
      {s && (
        <label className="mb-4 flex cursor-pointer items-center justify-between gap-4 rounded-2xl border bg-card/60 p-4">
          <span>
            <span className="block font-medium">Display case is {s.vault_enabled ? "open" : "closed"}</span>
            <span className="block text-sm text-muted-foreground">
              {s.vault_enabled ? "Visitors see the “Open display case” button and /vault." : "Hidden from visitors. You can still edit everything here."}
            </span>
          </span>
          <Switch checked={s.vault_enabled} onCheckedChange={(v) => setSetting("vault_enabled", v)} aria-label="Display case open" />
        </label>
      )}
      <Tabs defaultValue="games" className="gap-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
              {t.label}
              {!shown(t.id) && <EyeOff className="size-3.5 text-muted-foreground" aria-label="hidden" />}
            </TabsTrigger>
          ))}
          <TabsTrigger value="cases">Custom cases</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.id} value={t.id} className="grid gap-3">
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-dashed p-3">
              <span>
                <span className="block text-sm font-medium">{shown(t.id) ? `${t.label} visible on the site` : `${t.label} closed`}</span>
                <span className="block text-xs text-muted-foreground">
                  {shown(t.id) ? "Switch off to hide this category while it is unfinished." : "Only you see it here. Switch on when it is ready."}
                </span>
              </span>
              <Switch checked={shown(t.id)} onCheckedChange={(v) => setShown(t.id, v)} aria-label={`Show ${t.label}`} />
            </label>
            {t.id === "games" && <GamesManager />}
            {t.id === "anime" && <MediaManager kind="anime" />}
            {t.id === "manga" && <MediaManager kind="manga" />}
            {t.id === "music" && <MusicManager />}
            {t.id === "referrals" && <ReferralsManager />}
          </TabsContent>
        ))}
        <TabsContent value="cases" className="grid gap-5">
          <CasesTab />
        </TabsContent>
        <TabsContent value="settings">
          <VaultSettings />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------- settings

function VaultSettings() {
  const { draft, setSetting } = useDraft();
  const casesQuery = useQuery({ queryKey: ["admin", "cases"], queryFn: () => api.list("cases") });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  if (!draft) return null;
  const s = draft.settings;
  const cases = casesQuery.data ?? [];
  const caseName = new Map(cases.map((c) => [`case:${c.id}`, c.name]));
  // Until the case list has loaded, keep every case entry as it is.
  const known = (id: SectionId) => id in SECTION_LABEL || caseName.has(id) || (!casesQuery.isSuccess && caseSectionId(id) !== null);
  const label = (id: SectionId) => SECTION_LABEL[id as FixedSectionId] ?? caseName.get(id) ?? id;
  // Listed sections first, then the hidden ones. A case that no longer exists is left out.
  const listed = s.sections.filter(known);
  const all: SectionId[] = [
    ...listed,
    ...(Object.keys(SECTION_LABEL) as SectionId[]).filter((x) => !listed.includes(x)),
    ...cases.map((c) => `case:${c.id}` as SectionId).filter((x) => !listed.includes(x)),
  ];

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(all, all.indexOf(e.active.id as SectionId), all.indexOf(e.over.id as SectionId));
    setSetting("sections", next.filter((x) => listed.includes(x)));
  };

  return (
    <div className="grid gap-5">
      <Section title="Header">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">{(id) => <Input id={id} value={s.vault_title} maxLength={120} onChange={(e) => setSetting("vault_title", e.target.value)} />}</Field>
          <Field label="Subtitle">{(id) => <Input id={id} value={s.vault_subtitle} maxLength={120} onChange={(e) => setSetting("vault_subtitle", e.target.value)} />}</Field>
        </div>
        <Field label="Icon">
          {(id) => (
            <div className="grid gap-2">
              <MediaInput id={id} value={s.vault_icon} onChange={(v) => setSetting("vault_icon", v)} />
              <div className="flex flex-wrap gap-2">
                {["/img/brand/vault.svg", "/img/brand/icon.svg"].map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setSetting("vault_icon", src)}
                    className={cn("grid size-12 place-items-center rounded-xl border bg-muted/40 p-1.5 transition hover:ring-2 hover:ring-ring", s.vault_icon === src && "ring-2 ring-ring")}
                    aria-label={`Use ${src.split("/").pop()}`}
                  >
                    <img src={src} alt="" className="size-full" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Field>
      </Section>
      <Section title="Sections" description="Drag to change order. Switch off to hide a section.">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={all} strategy={verticalListSortingStrategy}>
            <ul className="grid gap-2">
              {all.map((id) => (
                <SectionRow
                  key={id}
                  id={id}
                  label={label(id)}
                  on={listed.includes(id)}
                  toggle={(on) => setSetting("sections", on ? all.filter((x) => x === id || listed.includes(x)) : listed.filter((x) => x !== id))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </Section>
    </div>
  );
}

function SectionRow({ id, label, on, toggle }: { id: SectionId; label: string; on: boolean; toggle: (on: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="flex items-center gap-3 rounded-xl border bg-card/70 p-3">
      <button type="button" className="cursor-grab touch-none text-muted-foreground" aria-label="Drag" {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <span className="flex-1 truncate text-sm font-medium">{label}</span>
      {caseSectionId(id) !== null && <UIBadge variant="outline">Custom</UIBadge>}
      <Switch checked={on} onCheckedChange={toggle} aria-label={`Show ${label}`} />
    </li>
  );
}

// ---------------------------------------------------------------- importers

function ImportSearch<T>({ placeholder, search, render }: { placeholder: string; search: (q: string) => Promise<T[]>; render: (r: T) => React.ReactNode }) {
  const [q, setQ] = useState("");
  const m = useMutation({ mutationFn: search, onError: (e) => toast.error(e.message) });
  return (
    <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) m.mutate(q.trim());
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
        <Button type="submit" variant="secondary" disabled={m.isPending}>
          {m.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Search
        </Button>
      </form>
      {m.data && (
        <div className="grid max-h-64 gap-1.5 overflow-y-auto">
          {m.data.length === 0 && <p className="p-2 text-sm text-muted-foreground">No results.</p>}
          {m.data.map(render)}
        </div>
      )}
    </div>
  );
}

function ResultButton({ image, title, subtitle, onClick, portrait }: { image: string; title: string; subtitle?: string; onClick: () => void; portrait?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-lg p-1.5 text-left transition hover:bg-accent">
      <img src={image} alt="" className={portrait ? "h-14 w-10 flex-none rounded object-cover" : "h-10 w-20 flex-none rounded object-cover"} loading="lazy" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      <Plus className="ml-auto size-4 flex-none text-muted-foreground" />
    </button>
  );
}

const statusOptions = (kind: StatusKind) => Object.fromEntries(ITEM_STATUSES.map((st: ItemStatus) => [st, statusLabel(st, kind)]));

// ---------------------------------------------------------------- games

const gameFields: FieldDef<Game>[] = [
  { key: "title", label: "Title", type: "text", maxLength: 120 },
  { key: "subtitle", label: "Subtitle", type: "text", maxLength: 120 },
  { key: "cover_image", label: "Cover (landscape)", type: "image" },
  { key: "rating", label: "Rating", type: "rating" },
  { key: "badge_type", label: "Verdict", type: "select", options: { masterpiece: "Masterpiece", good: "Good", okay: "Okay", trash: "Trash" } },
  { key: "status", label: "Status", type: "select", options: statusOptions("game") },
  { key: "category", label: "Genre", type: "text", maxLength: 40 },
  { key: "hours_played", label: "Hours played", type: "number" },
  { key: "badge", label: "Extra tag", type: "text", maxLength: 40, hint: "e.g. 100% achievements" },
  { key: "is_featured", label: "Featured", type: "switch" },
  { key: "review_note", label: "Review", type: "textarea", maxLength: 2000 },
];

function GamesManager() {
  return (
    <CollectionManager
      collection="games"
      noun="Game"
      fields={gameFields}
      defaults={{ title: "", badge_type: "good", status: "owned", hours_played: 0, is_featured: false }}
      importer={(apply) => (
        <ImportSearch<GameSearchResult>
          placeholder="Search Steam, or paste a Steam store / SteamDB link or app id"
          search={api.importGames}
          render={(r) => <SteamResult key={r.id} r={r} apply={apply} />}
        />
      )}
      row={(g) => ({
        title: g.title,
        subtitle: [g.category, g.hours_played ? `${g.hours_played}h` : ""].filter(Boolean).join(" · "),
        image: g.cover_image,
        meta: (
          <>
            {g.is_featured && <Star className="size-4 fill-amber-400 text-amber-400" />}
            <img src={`/img/badges/${g.badge_type}.svg`} alt={g.badge_type} className="size-6" />
          </>
        ),
      })}
    />
  );
}

function SteamResult({ r, apply }: { r: GameSearchResult; apply: (p: Partial<Game>) => void }) {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  // Name searches return no details; looking the app up by id does.
  const [details, setDetails] = useState<GameSearchResult | null>(r.genres?.length ? r : null);
  const [busy, setBusy] = useState(false);
  const d = details ?? r;
  const genre = (d.genres ?? []).slice(0, 2).join(" / ");
  const facts = [genre, d.developer, d.year, d.metacritic ? `Metacritic ${d.metacritic}` : ""].filter(Boolean).join(" · ");

  const useAll = async () => {
    let full = details;
    if (!full) {
      setBusy(true);
      try {
        full = (await api.importGames(String(r.id)))[0] ?? null;
        setDetails(full);
      } catch {
        full = null;
      } finally {
        setBusy(false);
      }
    }
    const src = full ?? r;
    const g = (src.genres ?? []).slice(0, 2).join(" / ");
    apply({
      title: src.title,
      cover_image: src.cover_image || r.cover_image,
      ...(g ? { category: g.toUpperCase() } : {}),
      ...(src.developer || src.year ? { subtitle: [src.developer, src.year].filter(Boolean).join(" · ") } : {}),
    });
    toast.success(full ? "Title, cover, genre, developer and year filled in" : "Title and cover filled in (Steam details unavailable)");
  };

  return (
    <div className="grid gap-2 rounded-lg border p-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{r.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            App {r.id}
            {facts && ` · ${facts}`}
          </p>
          {d.description && <p className="line-clamp-2 text-xs text-muted-foreground/80">{d.description}</p>}
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={useAll}>
          {busy ? "Loading…" : "Use all"}
        </Button>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {(r.images ?? []).filter((i) => !broken.has(i.url)).map((img) => (
          <button
            key={img.url}
            type="button"
            title={`Use ${img.label} as cover`}
            onClick={() => {
              apply({ cover_image: img.url });
              toast.success(`${img.label} image set as cover`);
            }}
            className="group flex-none overflow-hidden rounded-md border text-left transition hover:ring-2 hover:ring-ring"
          >
            <img
              src={img.url}
              alt=""
              loading="lazy"
              onError={() => setBroken((b) => new Set(b).add(img.url))}
              className="h-16 w-36 object-cover"
            />
            <span className="block px-1.5 py-0.5 text-[10px] text-muted-foreground">{img.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- anime / manga

const mediaFields = (kind: "anime" | "manga"): FieldDef<Media>[] => [
  { key: "title", label: "Title", type: "text", maxLength: 160 },
  kind === "anime"
    ? { key: "type", label: "Type", type: "select", options: { anime: "Anime" } }
    : { key: "type", label: "Type", type: "select", options: { manga: "Manga", manhwa: "Manhwa" } },
  { key: "cover_image", label: "Cover (portrait)", type: "image" },
  { key: "rating", label: "Rating", type: "rating" },
  { key: "status", label: "Status", type: "select", options: statusOptions(kind) },
  { key: "progress_info", label: "Progress", type: "text", maxLength: 120, hint: kind === "anime" ? "e.g. Seasons 1–4 done" : "e.g. Chapter 271" },
  { key: "rank_badge", label: "Rank tag", type: "text", maxLength: 40 },
  { key: "category_badge", label: "Category tag", type: "text", maxLength: 60 },
  { key: "tags", label: "Genres", type: "text", maxLength: 300, hint: "Comma separated" },
  { key: "anilist_id", label: "AniList ID", type: "number" },
  { key: "is_featured", label: "Featured", type: "switch" },
  { key: "review_note", label: "Review", type: "textarea", maxLength: 2000 },
];

function MediaManager({ kind }: { kind: "anime" | "manga" }) {
  return (
    <CollectionManager
      key={kind}
      collection="media"
      noun={kind === "anime" ? "Anime" : "Manga"}
      fields={mediaFields(kind)}
      filter={(m) => (kind === "anime" ? m.type === "anime" : m.type !== "anime")}
      defaults={{ title: "", type: kind, status: "owned", is_featured: false, anilist_id: 0 }}
      importer={(apply) => (
        <ImportSearch<AniListResult>
          placeholder="Search AniList…"
          search={(q) => api.importAniList(q, kind === "anime" ? "ANIME" : "MANGA")}
          render={(r) => {
            const title = r.title.english || r.title.romaji;
            return (
              <ResultButton
                key={r.id}
                portrait
                image={r.coverImage.large}
                title={title}
                subtitle={[r.format, r.episodes ? `${r.episodes} ep` : r.chapters ? `${r.chapters} ch` : "", r.meanScore ? `${r.meanScore}%` : ""].filter(Boolean).join(" · ")}
                onClick={() =>
                  apply({
                    title,
                    cover_image: r.coverImage.large,
                    anilist_id: r.id,
                    tags: r.genres.slice(0, 5).join(", "),
                    rating: r.meanScore ? `${Math.round(r.meanScore / 5) / 2}/10` : "",
                    type: kind === "anime" ? "anime" : r.format === "MANGA" || !r.format ? "manga" : "manhwa",
                  })
                }
              />
            );
          }}
        />
      )}
      row={(m) => ({
        title: m.title,
        subtitle: [m.type, m.progress_info, m.rating].filter(Boolean).join(" · "),
        image: m.cover_image,
        meta: m.is_featured ? <Star className="size-4 fill-amber-400 text-amber-400" /> : null,
      })}
    />
  );
}

// ---------------------------------------------------------------- music

function TracksEditor({ tracks, onChange }: { tracks: Track[]; onChange: (t: Track[]) => void }) {
  const update = (i: number, patch: Partial<Track>) => onChange(tracks.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <Field label={`Tracks (${tracks.length})`} hint="Optional track list shown in the playlist details.">
      {() => (
        <div className="grid gap-2">
          {tracks.map((t, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_1fr_80px_auto]">
              <Input value={t.title} placeholder="Title" onChange={(e) => update(i, { title: e.target.value })} />
              <Input value={t.artist} placeholder="Artist" onChange={(e) => update(i, { artist: e.target.value })} />
              <Input value={t.duration} placeholder="3:45" onChange={(e) => update(i, { duration: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" onClick={() => onChange(tracks.filter((_, j) => j !== i))} aria-label="Remove track">
                <Trash2 className="size-4" />
              </Button>
              <div className="sm:col-span-4">
                <MediaInput kind="audio" value={t.audio_url} onChange={(v) => update(i, { audio_url: v })} placeholder="Audio file (optional preview)" />
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...tracks, { track_number: String(tracks.length + 1), title: "", artist: "", duration: "", audio_url: "" }])}>
            <Plus className="size-4" /> Add track
          </Button>
        </div>
      )}
    </Field>
  );
}

const playlistFields: FieldDef<Playlist>[] = [
  { key: "title", label: "Title", type: "text", maxLength: 160 },
  { key: "type", label: "Type", type: "select", options: { playlist: "Playlist / album", solo: "Single track" } },
  { key: "artist", label: "Artist", type: "text", maxLength: 120 },
  { key: "subtitle", label: "Description", type: "text", maxLength: 200 },
  { key: "cover_image", label: "Cover", type: "image" },
  { key: "spotify_url", label: "Spotify link", type: "text" },
  { key: "yt_music_url", label: "YouTube Music link", type: "text" },
  { key: "duration", label: "Duration", type: "text", maxLength: 20, hint: "Single tracks" },
  { key: "audio_url", label: "Preview audio", type: "audio" },
  { key: "is_featured", label: "Featured", type: "switch" },
  { key: "tracks", label: "Tracks", type: "custom", render: (v, set) => <TracksEditor tracks={v.tracks ?? []} onChange={(tracks) => set({ tracks })} /> },
];

function MusicImport({ apply }: { apply: (p: Partial<Playlist>) => void }) {
  const [url, setUrl] = useState("");
  const m = useMutation({
    mutationFn: api.importMusic,
    onSuccess: (r) => {
      apply({ title: r.title, artist: r.artist, cover_image: r.cover_image, type: r.type, spotify_url: r.spotify_url, yt_music_url: r.yt_music_url, duration: r.duration });
      toast.success("Imported");
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <form
      className="flex gap-2 rounded-xl border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) m.mutate(url.trim());
      }}
    >
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a Spotify or YouTube Music link…" />
      <Button type="submit" variant="secondary" disabled={m.isPending}>
        {m.isPending ? <Loader2 className="size-4 animate-spin" /> : "Import"}
      </Button>
    </form>
  );
}

function MusicManager() {
  return (
    <CollectionManager
      collection="playlists"
      noun="Playlist"
      fields={playlistFields}
      defaults={{ title: "", type: "playlist", tracks: [], is_featured: false }}
      importer={(apply) => <MusicImport apply={apply} />}
      row={(p) => ({
        title: p.title,
        subtitle: [p.artist, p.type === "solo" ? "Single" : `${p.tracks.length} tracks`].filter(Boolean).join(" · "),
        image: p.cover_image,
        meta: p.is_featured ? <Star className="size-4 fill-amber-400 text-amber-400" /> : null,
      })}
    />
  );
}

// ---------------------------------------------------------------- referrals

const referralFields: FieldDef<Referral>[] = [
  { key: "kind", label: "Type", type: "select", options: { project: "My project / tool", referral: "Referral / invite" } },
  { key: "title", label: "Title", type: "text", maxLength: 120 },
  { key: "game_name", label: "Category", type: "text", maxLength: 80, hint: "e.g. Web tool, Chat bot, Game" },
  { key: "badge", label: "Status tag", type: "text", maxLength: 40, hint: "e.g. LIVE, BETA, SOON, FACTION" },
  { key: "ref_url", label: "Link", type: "text", hint: "https://… or a path on this site, e.g. /tools" },
  { key: "ref_code", label: "Referral code", type: "text", maxLength: 80, hint: "Referrals only. Visitors can copy it." },
  { key: "image_url", label: "Banner / logo", type: "image" },
  { key: "size", label: "Tile size", type: "select", options: { small: "Small (icon + title)", medium: "Medium (card)", large: "Large (full row)" } },
  { key: "display_style", label: "Image shape", type: "select", options: { card: "Card (16:9 image)", banner: "Wide banner (6:1)" } },
  { key: "reward_text", label: "Highlight line", type: "text", maxLength: 300, wide: true, hint: "The one line shown on the tile, e.g. the referral reward or a feature." },
  { key: "description", label: "Description", type: "textarea", maxLength: 1000, hint: "Shown in the details popup, together with the link and code." },
  { key: "is_active", label: "Visible", type: "switch" },
];

function ReferralsManager() {
  return (
    <CollectionManager
      collection="referrals"
      noun="Entry"
      fields={referralFields}
      defaults={{ kind: "project", title: "", display_style: "card", size: "medium", is_active: true, ref_url: "/" }}
      row={(r) => ({
        title: r.title,
        subtitle: [r.game_name, r.ref_url, r.ref_code].filter(Boolean).join(" · "),
        image: r.image_url,
        muted: !r.is_active,
        meta: (
          <>
            <UIBadge variant={r.kind === "project" ? "default" : "secondary"}>{r.kind === "project" ? "Project" : "Referral"}</UIBadge>
            {r.badge && <UIBadge variant="outline">{r.badge}</UIBadge>}
          </>
        ),
      })}
    />
  );
}

// ---------------------------------------------------------------- custom cases

const caseFields: FieldDef<Case>[] = [
  { key: "name", label: "Name", type: "text", maxLength: 60, hint: "e.g. Films, Books, Figures" },
  { key: "layout", label: "Layout", type: "select", options: { poster: "Poster grid", wide: "Wide cards", list: "List" } },
  { key: "aspect", label: "Image shape", type: "select", options: { "2:3": "Portrait (2:3)", "1:1": "Square (1:1)", "16:9": "Landscape (16:9)" } },
  {
    key: "icon",
    label: "Icon",
    type: "custom",
    render: (v, set) => (
      <Field label="Icon" hint="Shown next to the name. Or paste an https:// image URL.">
        {() => (
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(BADGE_ICONS).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set({ icon: k })}
                  title={k}
                  className={cn("grid size-10 place-items-center rounded-lg border transition hover:bg-accent", v.icon === k && "border-ring ring-1 ring-ring")}
                >
                  <BadgeGlyph icon={k} className="size-5" />
                </button>
              ))}
            </div>
            <Input
              value={v.icon?.startsWith("https://") || v.icon?.startsWith("/") ? v.icon : ""}
              onChange={(e) => set({ icon: e.target.value })}
              placeholder="https://… (optional image icon)"
            />
          </div>
        )}
      </Field>
    ),
  },
];

const caseItemFields: FieldDef<CaseItem>[] = [
  { key: "title", label: "Title", type: "text", maxLength: 160 },
  { key: "subtitle", label: "Subtitle", type: "text", maxLength: 160, hint: "e.g. director, author, year" },
  { key: "image", label: "Image", type: "image" },
  { key: "rating", label: "Rating", type: "rating" },
  { key: "status", label: "Status", type: "select", options: statusOptions("case") },
  { key: "size", label: "Tile size", type: "select", options: { small: "Small", medium: "Medium", large: "Large" }, hint: "Not used by the list layout." },
  { key: "tags", label: "Tags", type: "text", maxLength: 300, hint: "Comma separated" },
  { key: "link", label: "Link", type: "text", hint: "https://… shown in the details popup" },
  { key: "is_featured", label: "Featured", type: "switch" },
  { key: "note", label: "Note", type: "textarea", maxLength: 2000, hint: "Plain text, shown in the details popup." },
];

function CasesTab() {
  const qc = useQueryClient();
  const { draft } = useDraft();
  const q = useQuery({ queryKey: ["admin", "cases"], queryFn: () => api.list("cases") });
  const [picked, setPicked] = useState<number | null>(null);
  const cases = q.data ?? [];
  const current = cases.find((c) => c.id === picked) ?? cases[0];
  // Deleting a case also removes it from the profile's sections, and items change the counts.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "cases"] });
    qc.invalidateQueries({ queryKey: ["admin", "caseitems"] });
    qc.invalidateQueries({ queryKey: ["admin", "profile"] });
  };
  const visible = (c: Case) => !!draft?.settings.sections.includes(`case:${c.id}`);

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Your own categories (films, books, figures…). A new case stays hidden until you switch it on under Settings → Sections, where you can also move it between the other sections.
      </p>
      <Section title="Cases">
        <CollectionManager
          collection="cases"
          noun="Case"
          fields={caseFields}
          defaults={{ name: "", icon: "", layout: "poster", aspect: "2:3" }}
          onChange={refresh}
          empty="No custom cases yet. Add one, for example “Films”."
          row={(c) => ({
            title: c.name,
            subtitle: [c.layout, c.aspect, `${c.items?.length ?? 0} items`].join(" · "),
            muted: !visible(c),
            meta: (
              <>
                {c.icon && <BadgeGlyph icon={c.icon} className="size-4" />}
                {!visible(c) && <UIBadge variant="outline">Hidden</UIBadge>}
              </>
            ),
          })}
        />
      </Section>
      {current && (
        <Section title="Items" description="Pick a case, then add its items. Drag to reorder.">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Case">
            {cases.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setPicked(c.id)}
                aria-pressed={current.id === c.id}
                className={cn("rounded-full border px-3.5 py-1.5 text-sm transition", current.id === c.id ? "border-ring bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50")}
              >
                {c.name}
              </button>
            ))}
          </div>
          <CollectionManager
            key={current.id}
            collection="caseitems"
            noun="Item"
            fields={caseItemFields}
            filter={(i) => i.case_id === current.id}
            defaults={{ case_id: current.id, title: "", status: "owned", size: "medium", is_featured: false }}
            onChange={refresh}
            empty={`No items in ${current.name} yet.`}
            row={(i) => ({
              title: i.title,
              subtitle: [i.subtitle, i.rating].filter(Boolean).join(" · "),
              image: i.image,
              meta: i.is_featured ? <Star className="size-4 fill-amber-400 text-amber-400" /> : null,
            })}
          />
        </Section>
      )}
    </>
  );
}
