import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, type LibraryItem } from "@/lib/api";
import { statusLabel, type StatusKind } from "@/lib/i18n";
import { ITEM_STATUSES, type ItemStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDraft } from "../draft";

export type LibrarySource = "steam" | "anime" | "manga";

/** The server adds at most this many entries per import. */
const MAX_PER_IMPORT = 500;

const SOURCES: { id: LibrarySource; label: string }[] = [
  { id: "steam", label: "Steam library" },
  { id: "anime", label: "AniList anime" },
  { id: "manga", label: "AniList manga" },
];

const rowKey = (it: LibraryItem) => (it.steam_appid ? `s${it.steam_appid}` : `a${it.anilist_id}`);
const kindOf = (src: LibrarySource): StatusKind => (src === "steam" ? "game" : src);

/** Button and dialog: preview a Steam library or an AniList list, pick entries, add them. */
export function LibraryImport({ source: initial }: { source: LibrarySource }) {
  const { draft } = useDraft();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<LibrarySource>(initial);
  const [user, setUser] = useState("");
  const [rows, setRows] = useState<LibraryItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  const steamReady = !!draft?.steam_api_key_set && !!draft?.steam_id;
  const steamProblem = !draft?.steam_api_key_set
    ? "Add a Steam Web API key under Integrations first."
    : !draft?.steam_id
      ? "Add your SteamID64 on the Profile page first."
      : "";
  const aniUser = user || draft?.anilist_username || "";

  const reset = (next: LibrarySource) => {
    setSource(next);
    setRows(null);
    setPicked(new Set());
    setResult(null);
    setFilter("");
  };

  const load = useMutation({
    mutationFn: () => (source === "steam" ? api.importSteamLibrary() : api.importAniListList(aniUser.trim(), source)),
    onSuccess: (r) => {
      setRows(r.items);
      setPicked(new Set());
      setResult(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const run = useMutation({
    mutationFn: () => {
      const chosen = (rows ?? []).filter((r) => picked.has(rowKey(r)));
      if (source === "steam") {
        return api.importBulk(
          "games",
          chosen.map((r) => ({ steam_appid: r.steam_appid, title: r.title, cover_image: r.cover_image, hours_played: r.hours_played, status: r.status })),
        );
      }
      return api.importBulk(
        "media",
        chosen.map((r) => ({ anilist_id: r.anilist_id, title: r.title, cover_image: r.cover_image, type: r.type, progress_info: r.progress_info, rating: r.rating, tags: r.tags, status: r.status })),
      );
    },
    onSuccess: (r) => {
      setResult(r);
      // Everything sent now exists, whether it was added or skipped.
      setRows((old) => old?.map((x) => (picked.has(rowKey(x)) ? { ...x, exists: true } : x)) ?? null);
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["admin", source === "steam" ? "games" : "media"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["vault"] });
      toast.success(`${r.added} added, ${r.skipped} skipped`);
    },
    onError: (e) => toast.error(e.message),
  });

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (rows ?? []).filter((r) => !f || r.title.toLowerCase().includes(f));
  }, [rows, filter]);
  const selectable = shown.filter((r) => !r.exists);

  const toggle = (k: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (!on) n.delete(k);
      else if (n.size < MAX_PER_IMPORT) n.add(k);
      return n;
    });
  const setStatus = (k: string, status: ItemStatus) => setRows((old) => old?.map((r) => (rowKey(r) === k ? { ...r, status } : r)) ?? null);
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(rowKey(r)));

  const blocked = source === "steam" && !steamReady;
  const nothing = rows && rows.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset(initial);
      }}
    >
      <div className="flex justify-end">
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm">
            <Download className="size-4" /> Import library
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import library</DialogTitle>
          <DialogDescription>Load a list, choose what to add and set a status for each entry. Nothing is added until you press Import.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Source">
          {SOURCES.map((s) => (
            <Button key={s.id} type="button" size="sm" variant={source === s.id ? "default" : "secondary"} role="tab" aria-selected={source === s.id} onClick={() => reset(s.id)}>
              {s.label}
            </Button>
          ))}
        </div>

        {source === "steam" ? (
          <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 text-sm">
            <p className="text-muted-foreground">Uses the SteamID64 from your profile and the Web API key from Integrations. Your Steam game details must be public.</p>
            {blocked && <p className="font-medium text-destructive">{steamProblem}</p>}
            <div>
              <Button type="button" disabled={blocked || load.isPending} onClick={() => load.mutate()}>
                {load.isPending && <Loader2 className="size-4 animate-spin" />} Load library
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-wrap gap-2 rounded-xl border bg-muted/30 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (aniUser.trim()) load.mutate();
            }}
          >
            <Input className="min-w-48 flex-1" value={aniUser} maxLength={40} onChange={(e) => setUser(e.target.value)} placeholder="AniList user name" aria-label="AniList user name" />
            <Button type="submit" disabled={!aniUser.trim() || load.isPending}>
              {load.isPending && <Loader2 className="size-4 animate-spin" />} Load list
            </Button>
          </form>
        )}

        {nothing && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing found in this list.</p>}

        {rows && rows.length > 0 && (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input className="min-w-40 flex-1" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title…" aria-label="Filter by title" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectable.length === 0}
                onClick={() =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (allPicked) selectable.forEach((r) => n.delete(rowKey(r)));
                    else for (const r of selectable) if (n.size < MAX_PER_IMPORT) n.add(rowKey(r));
                    return n;
                  })
                }
              >
                {allPicked ? "Select none" : "Select all"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {picked.size} selected (max {MAX_PER_IMPORT}) · {rows.filter((r) => r.exists).length} already in your case
              </span>
            </div>
            <ul className="grid max-h-[46dvh] gap-1 overflow-y-auto rounded-xl border p-1.5">
              {shown.map((r) => {
                const k = rowKey(r);
                return (
                  <li key={k} className={cn("flex items-center gap-3 rounded-lg p-1.5", r.exists && "opacity-60")}>
                    <input
                      type="checkbox"
                      className="size-4 flex-none"
                      checked={picked.has(k)}
                      disabled={r.exists}
                      onChange={(e) => toggle(k, e.target.checked)}
                      aria-label={`Select ${r.title}`}
                    />
                    {r.cover_image ? (
                      <img src={r.cover_image} alt="" loading="lazy" referrerPolicy="no-referrer" className={source === "steam" ? "h-10 w-20 flex-none rounded object-cover" : "h-14 w-10 flex-none rounded object-cover"} />
                    ) : (
                      <span className={source === "steam" ? "h-10 w-20 flex-none rounded bg-muted" : "h-14 w-10 flex-none rounded bg-muted"} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {source === "steam" ? `${r.hours_played} h played` : [r.progress_info, r.rating].filter(Boolean).join(" · ") || "No progress"}
                      </span>
                    </span>
                    {r.exists ? (
                      <span className="flex-none rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Already added</span>
                    ) : (
                      <select
                        value={r.status}
                        onChange={(e) => setStatus(k, e.target.value as ItemStatus)}
                        aria-label={`Status of ${r.title}`}
                        className="h-8 flex-none rounded-md border bg-background px-2 text-xs"
                      >
                        {ITEM_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {statusLabel(st, kindOf(source))}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
              {shown.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">No matches.</li>}
            </ul>
          </div>
        )}

        {result && (
          <p className="rounded-xl border bg-muted/30 p-3 text-sm" role="status">
            Added {result.added}, skipped {result.skipped} (already in your case).
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button type="button" disabled={picked.size === 0 || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Importing…" : `Import ${picked.size || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
