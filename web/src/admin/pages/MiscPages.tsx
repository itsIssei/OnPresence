import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Database, Download, ExternalLink, Eye, FileJson, History, Laptop, LogOut, MousePointerClick, RotateCcw, ShieldCheck, Upload as UploadIcon } from "lucide-react";
import { encode } from "uqr";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge as UIBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { loadDecorations, loadProfileEffects, resetCatalogs, useCatalog } from "@/lib/catalog";
import { LinkGlyph } from "@/lib/icons";
import { usePresence } from "@/lib/presence";
import type { DecorationItem, ProfileEffectItem, Upload } from "@/lib/types";
import { mergeEntries, parsePackFile } from "../catalogParse";
import { useDraft } from "../draft";
import { DeleteButton, Field, MediaThumb, PageHeader, Section, UploadDropzone, useUploads } from "../kit";

// ---------------------------------------------------------------- overview

export function OverviewPage() {
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: api.stats });
  const { draft } = useDraft();
  const presence = usePresence(draft?.discord_id ?? "", !!draft?.discord_id);
  const top = [...(stats.data?.links ?? [])].sort((a, b) => b.clicks - a.clicks).slice(0, 8);

  return (
    <>
      <PageHeader
        title={`Welcome back${draft ? `, ${draft.name}` : ""}`}
        description="How your card is doing."
        actions={
          <Button asChild variant="secondary">
            <a href="/" target="_blank" rel="noopener">
              View site <ExternalLink className="size-4" />
            </a>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<Eye className="size-4" />} label="Profile views" value={stats.data?.views} />
        <Stat icon={<MousePointerClick className="size-4" />} label="Link clicks" value={stats.data?.link_clicks} />
        <Stat
          icon={<span className="size-2.5 rounded-full" style={{ background: presence.discord ? "#23a55a" : "#80848e" }} />}
          label="Discord presence"
          value={presence.discord ? presence.status : draft?.discord_id ? "waiting" : "not set"}
        />
      </div>
      <Section title="Top links" className="mt-5">
        {top.length === 0 && <p className="text-sm text-muted-foreground">No links yet.</p>}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
          {top.map((l) => (
            <li key={l.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/40">
              <LinkGlyph icon={l.icon} platform={l.platform} url={l.url} className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{l.label}</span>
              <span className="tabular-nums text-muted-foreground">{l.clicks}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string | undefined }) {
  return (
    <div className="rounded-2xl border bg-card/60 p-5">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-bold capitalize tabular-nums">{value === undefined ? "–" : typeof value === "number" ? value.toLocaleString() : value}</p>
    </div>
  );
}

// ---------------------------------------------------------------- media library

export function MediaPage() {
  const uploads = useUploads();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: ({ id, force }: { id: number; force: boolean }) => api.deleteUpload(id, force),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "uploads"] });
      toast.success("File deleted");
    },
    onError: (e, vars) => {
      if (e instanceof ApiError && e.status === 409) {
        toast.warning("This file is still used", {
          description: "Deleting it will break the image where it is used.",
          action: { label: "Delete anyway", onClick: () => del.mutate({ id: vars.id, force: true }) },
        });
      } else toast.error(e.message);
    },
  });
  const total = (uploads.data ?? []).reduce((n, u) => n + u.size, 0);

  return (
    <>
      <PageHeader title="Media library" description={`${uploads.data?.length ?? 0} files · ${(total / 1024 / 1024).toFixed(1)} MB`} />
      <UploadDropzone kind="any" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {(uploads.data ?? []).map((u) => (
          <MediaTile key={u.id} u={u} onDelete={() => del.mutate({ id: u.id, force: false })} />
        ))}
      </div>
    </>
  );
}

function MediaTile({ u, onDelete }: { u: Upload; onDelete: () => void }) {
  return (
    <div className="group overflow-hidden rounded-xl border bg-card/60">
      <div className="aspect-square bg-muted">
        <MediaThumb u={u} />
      </div>
      <div className="flex items-center gap-1 p-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={u.name}>
            {u.name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {(u.size / 1024).toFixed(0)} KB{u.width ? ` · ${u.width}×${u.height}` : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Copy URL"
          onClick={() => navigator.clipboard.writeText(location.origin + u.url).then(() => toast.success("URL copied"))}
        >
          <Copy className="size-3.5" />
        </Button>
        <DeleteButton onConfirm={onDelete} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- decoration packs

export function CatalogPage() {
  const decos = useCatalog(loadDecorations);
  const effects = useCatalog(loadProfileEffects);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const done = (msg: string) => {
    resetCatalogs();
    toast.success(msg);
    setTimeout(() => location.reload(), 800);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      let dec: DecorationItem[] = [];
      let eff: ProfileEffectItem[] = [];
      for (const f of Array.from(files)) {
        const parsed = parsePackFile(JSON.parse(await f.text()));
        dec = dec.concat(parsed.decorations);
        eff = eff.concat(parsed.profileEffects);
      }
      if (!dec.length && !eff.length) throw new Error("No decorations or effects found in these files.");
      const res = await api.syncCatalog({
        decorations: dec.length ? mergeEntries(dec, decos ?? []) : undefined,
        profileEffects: eff.length ? mergeEntries(eff, effects ?? []) : undefined,
      });
      done(`Pack imported: ${res.decorations} decorations, ${res.profileEffects} effects available`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await api.resetCatalog();
      done("Imported packs removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Decoration packs" description="Avatar decorations and profile effects available in the Appearance pickers." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat icon={<FileJson className="size-4" />} label="Avatar decorations" value={decos?.length} />
        <Stat icon={<FileJson className="size-4" />} label="Profile effects" value={effects?.length} />
      </div>
      <Section title="Import a pack" className="mt-5" description="A pack is a JSON file that lists decorations and effects by image URL. Importing adds to what you have; entries with the same id are replaced.">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-sm hover:bg-accent/40">
          <UploadIcon className="size-4" />
          {busy ? "Working…" : "Choose pack file(s)"}
          <input type="file" accept="application/json,.json" multiple hidden disabled={busy} onChange={(e) => onFiles(e.target.files)} />
        </label>
        <p className="text-xs text-muted-foreground">
          Only import packs you have the right to use. The file format is described in <code className="rounded bg-muted px-1">docs/decoration-packs.md</code>.
        </p>
        <Button variant="ghost" className="justify-self-start" disabled={busy} onClick={() => setConfirmReset(true)}>
          Remove imported packs
        </Button>
      </Section>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove imported packs?</AlertDialogTitle>
            <AlertDialogDescription>Only the built-in OnPresence originals stay. A decoration or effect you picked from a pack stops showing.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------- security & data

export function SecurityPage() {
  const qc = useQueryClient();
  const [oldPw, setOld] = useState("");
  const [newPw, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const sessions = useQuery({ queryKey: ["admin", "sessions"], queryFn: api.sessions });
  const backups = useQuery({ queryKey: ["admin", "backups"], queryFn: api.backups });

  const change = useMutation({
    mutationFn: () => api.changePassword(oldPw, newPw),
    onSuccess: () => {
      toast.success("Password changed. Other sessions were signed out.");
      setOld("");
      setNew("");
      setConfirm("");
      qc.invalidateQueries({ queryKey: ["admin", "sessions"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: api.revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "sessions"] }),
  });
  const backup = useMutation({
    mutationFn: api.createBackup,
    onSuccess: (b) => {
      toast.success(`Backup ${b.name} created`);
      qc.invalidateQueries({ queryKey: ["admin", "backups"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const mismatch = confirm.length > 0 && confirm !== newPw;
  return (
    <>
      <PageHeader title="Security & data" />
      <div className="grid gap-5">
        <Section title="Change password" description="At least 10 characters. Signs out every other session.">
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate();
            }}
          >
            <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOld(e.target.value)} />}</Field>
            <Field label="New password">{(id) => <Input id={id} type="password" autoComplete="new-password" minLength={10} value={newPw} onChange={(e) => setNew(e.target.value)} />}</Field>
            <Field label="Repeat new password" error={mismatch ? "Passwords do not match" : undefined}>
              {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={!oldPw || newPw.length < 10 || mismatch || change.isPending}>
                Change password
              </Button>
            </div>
          </form>
        </Section>

        <TwoFactorSection />

        <Section title="Active sessions">
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {(sessions.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border p-3 text-sm">
                <Laptop className="size-4 flex-none text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{s.user_agent || "Unknown device"}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.ip || "?"} · last seen {new Date(s.last_seen).toLocaleString()}
                  </p>
                </div>
                {s.current ? (
                  <UIBadge>This device</UIBadge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                    <LogOut className="size-4" /> Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <HistorySection />

        <Section title="Backups" description="A database snapshot is taken daily. Uploaded files live in data/uploads, so back that folder up too.">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => backup.mutate()} disabled={backup.isPending}>
              <Database className="size-4" /> Back up now
            </Button>
            <Button asChild variant="secondary">
              <a href="/api/v1/admin/export" download>
                <FileJson className="size-4" /> Export content (JSON)
              </a>
            </Button>
            <RestoreButton />
          </div>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {(backups.data ?? []).map((b) => (
              <li key={b.name} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/40">
                <Database className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate font-mono text-xs">{b.name}</span>
                <span className="text-xs text-muted-foreground">{(b.size / 1024).toFixed(0)} KB</span>
                <Button asChild variant="ghost" size="icon" className="size-8">
                  <a href={`/api/v1/admin/backups/${b.name}`} download aria-label={`Download ${b.name}`}>
                    <Download className="size-4" />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- two-factor

function TwoFactorSection() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [pending, setPending] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");

  const begin = useMutation({ mutationFn: api.totpSetup, onSuccess: setPending, onError: (e) => toast.error(e.message) });
  const enable = useMutation({
    mutationFn: () => api.totpEnable(code),
    onSuccess: (r) => {
      setPending(null);
      setCode("");
      setRecovery(r.recovery_codes);
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Two-factor authentication is on");
    },
    onError: (e) => toast.error(e.message),
  });
  const disable = useMutation({
    mutationFn: () => api.totpDisable(password),
    onSuccess: () => {
      setPassword("");
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Two-factor authentication is off");
    },
    onError: (e) => toast.error(e.message),
  });

  const on = !!me.data?.totp_enabled;
  return (
    <Section
      title="Two-factor authentication"
      description="Ask for a code from an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password…) when signing in."
    >
      {recovery && (
        <div className="grid gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">Save your recovery codes</p>
          <p className="text-xs text-muted-foreground">Each code works once if you lose your phone. They are not shown again.</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(recovery.join("\n")).then(() => toast.success("Copied"))}>
              <Copy className="size-4" /> Copy
            </Button>
            <Button size="sm" onClick={() => setRecovery(null)}>
              I saved them
            </Button>
          </div>
        </div>
      )}

      {on && !recovery && (
        <div className="grid gap-3">
          <p className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-emerald-400" /> On · {me.data?.recovery_codes_left ?? 0} recovery codes left
          </p>
          <form
            className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              disable.mutate();
            }}
          >
            <Field label="Password to turn it off">
              {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Button type="submit" variant="destructive" disabled={!password || disable.isPending}>
              Turn off
            </Button>
          </form>
        </div>
      )}

      {!on && !pending && (
        <Button className="justify-self-start" onClick={() => begin.mutate()} disabled={begin.isPending}>
          <ShieldCheck className="size-4" /> Set up two-factor
        </Button>
      )}

      {!on && pending && (
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <QRCode value={pending.uri} className="size-44 rounded-xl bg-white p-2" />
          <form
            className="grid content-start gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              enable.mutate();
            }}
          >
            <p className="text-sm">1. Scan the QR code with your authenticator app.</p>
            <p className="text-xs text-muted-foreground">
              No camera? Enter this key: <code className="break-all rounded bg-muted px-1 font-mono">{pending.secret}</code>
            </p>
            <Field label="2. Enter the 6-digit code">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="max-w-40 font-mono tracking-[0.3em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              )}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={code.length !== 6 || enable.isPending}>
                Turn on
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </Section>
  );
}

/** QR code drawn as SVG rects (no innerHTML). */
function QRCode({ value, className }: { value: string; className?: string }) {
  const qr = useMemo(() => encode(value, { ecc: "M", border: 0 }), [value]);
  const cells: React.ReactNode[] = [];
  qr.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} />);
    }),
  );
  return (
    <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} className={className} role="img" aria-label="QR code for your authenticator app" shapeRendering="crispEdges">
      <g fill="#000">{cells}</g>
    </svg>
  );
}

// ---------------------------------------------------------------- profile history

function HistorySection() {
  const qc = useQueryClient();
  const snaps = useQuery({ queryKey: ["admin", "snapshots"], queryFn: api.snapshots });
  const restore = useMutation({
    mutationFn: api.restoreSnapshot,
    onSuccess: (p) => {
      qc.setQueryData(["admin", "profile"], p);
      qc.invalidateQueries({ queryKey: ["admin", "snapshots"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Profile restored. The version you replaced is in the history too.");
    },
    onError: (e) => toast.error(e.message),
  });
  const list = snaps.data ?? [];
  return (
    <Section title="Profile history" description="A copy of your profile and appearance is kept before every save (last 30). Links and the display case are not included.">
      {list.length === 0 && <p className="text-sm text-muted-foreground">No earlier versions yet.</p>}
      <ul className="grid max-h-72 grid-cols-[minmax(0,1fr)] gap-1 overflow-y-auto">
        {list.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/40">
            <History className="size-4 flex-none text-muted-foreground" />
            <span className="flex-1 truncate">{new Date(s.created_at).toLocaleString()}</span>
            <span className="max-w-32 truncate text-xs text-muted-foreground">{s.name}</span>
            <Button variant="ghost" size="sm" disabled={restore.isPending} onClick={() => restore.mutate(s.id)}>
              <RotateCcw className="size-4" /> Restore
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------- JSON restore

function RestoreButton() {
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; data: unknown } | null>(null);
  const restore = useMutation({
    mutationFn: (data: unknown) => api.restoreContent(data),
    onSuccess: () => {
      setFile(null);
      qc.invalidateQueries();
      toast.success("Content restored. A database backup was taken first.");
    },
    onError: (e) => {
      const first = e instanceof ApiError && e.fields ? Object.entries(e.fields)[0] : null;
      toast.error(e.message, { description: first ? `${first[0]}: ${first[1]}` : undefined });
    },
  });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      setFile({ name: f.name, data: JSON.parse(await f.text()) });
    } catch {
      toast.error("That file is not valid JSON");
    }
  };
  return (
    <>
      <Button asChild variant="secondary">
        <label className="cursor-pointer">
          <UploadIcon className="size-4" /> Restore from JSON
          <input type="file" accept="application/json,.json" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </Button>
      <AlertDialog open={!!file} onOpenChange={(o) => !o && setFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace all content?</AlertDialogTitle>
            <AlertDialogDescription>
              Your profile, links, badges and display case will be replaced with <strong>{file?.name}</strong>. API keys, uploads and your
              account stay. A database backup is taken first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => file && restore.mutate(file.data)} disabled={restore.isPending}>
              Replace content
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
