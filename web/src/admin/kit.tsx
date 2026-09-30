import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileAudio, FileVideo, ImageIcon, Loader2, Trash2, Upload as UploadIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import type { Upload } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, description, children, className }: { title?: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card/60 p-5", className)}>
      {title && (
        <header className="mb-4">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </header>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ColorInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Pick color"
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#e11d48"}
        onChange={(e) => onChange(e.target.value)}
        className="size-9 flex-none cursor-pointer rounded-md border bg-transparent p-0.5"
      />
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="#e11d48" className="font-mono" maxLength={7} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media library picker
// ---------------------------------------------------------------------------

type Kind = "image" | "audio" | "video" | "any";

const accepts: Record<Kind, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif",
  audio: "audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav",
  video: "video/mp4,video/webm",
  any: "image/*,audio/*,video/mp4,video/webm",
};

function matchesKind(u: Upload, kind: Kind) {
  if (kind === "any") return true;
  return u.mime.startsWith(kind + "/") || (kind === "image" && /\.(png|jpe?g|webp|gif)$/i.test(u.url));
}

export function useUploads() {
  return useQuery({ queryKey: ["admin", "uploads"], queryFn: api.uploads });
}

export function useUploadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (f: File) => api.upload(f),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "uploads"] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Upload failed"),
  });
}

/** URL field with a button that opens the media library (upload or pick). */
export function MediaInput({
  id,
  value,
  onChange,
  kind = "image",
  placeholder = "https://… or pick from library",
  allowVideo = false,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  kind?: Kind;
  placeholder?: string;
  allowVideo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isVideo = /\.(mp4|webm)(\?|$)/i.test(value);
  return (
    <div className="flex items-center gap-2">
      <div className="grid size-9 flex-none place-items-center overflow-hidden rounded-md border bg-muted">
        {value && kind === "image" && !isVideo ? (
          <img src={value} alt="" className="size-full object-cover" />
        ) : kind === "audio" ? (
          <FileAudio className="size-4 text-muted-foreground" />
        ) : isVideo ? (
          <FileVideo className="size-4 text-muted-foreground" />
        ) : (
          <ImageIcon className="size-4 text-muted-foreground" />
        )}
      </div>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0" />
      {value && (
        <Button type="button" variant="ghost" size="icon" onClick={() => onChange("")} aria-label="Clear">
          <X className="size-4" />
        </Button>
      )}
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Library
      </Button>
      <MediaLibraryDialog
        open={open}
        onOpenChange={setOpen}
        kind={allowVideo ? "any" : kind}
        onPick={(u) => {
          onChange(u.url);
          setOpen(false);
        }}
      />
    </div>
  );
}

export function MediaLibraryDialog({
  open,
  onOpenChange,
  kind,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: Kind;
  onPick: (u: Upload) => void;
}) {
  const uploads = useUploads();
  const items = (uploads.data ?? []).filter((u) => matchesKind(u, kind));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Media library</DialogTitle>
          <DialogDescription>Upload a file or pick one you already uploaded.</DialogDescription>
        </DialogHeader>
        <UploadDropzone kind={kind} onUploaded={onPick} />
        <div className="grid max-h-[50dvh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
          {items.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => onPick(u)}
              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted text-left transition hover:ring-2 hover:ring-ring"
              title={u.name}
            >
              <MediaThumb u={u} />
            </button>
          ))}
          {uploads.isSuccess && items.length === 0 && <p className="col-span-full py-6 text-center text-sm text-muted-foreground">No files yet.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MediaThumb({ u }: { u: Upload }) {
  if (u.mime.startsWith("image/")) return <img src={u.url} alt={u.name} loading="lazy" className="size-full object-cover" />;
  const Icon = u.mime.startsWith("video/") ? FileVideo : FileAudio;
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-muted-foreground">
      <Icon className="size-6" />
      <span className="w-full truncate text-center text-[10px]">{u.name}</span>
    </div>
  );
}

export function UploadDropzone({ kind, onUploaded }: { kind: Kind; onUploaded?: (u: Upload) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const m = useUploadMutation();
  const handle = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      const u = await m.mutateAsync(f).catch(() => null);
      if (u) {
        toast.success(`Uploaded ${u.name}`);
        onUploaded?.(u);
      }
    }
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground transition",
        over && "border-ring bg-accent/40",
      )}
    >
      {m.isPending ? <Loader2 className="size-5 animate-spin" /> : <UploadIcon className="size-5" />}
      <p>Drop files here, or</p>
      <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={m.isPending}>
        Choose files
      </Button>
      <p className="text-xs">PNG, JPG, WebP, GIF, MP3, OGG, WAV, MP4, WebM · max 25 MB · JPG/PNG are resized to 2048px and stripped of EXIF</p>
      <input ref={input} type="file" accept={accepts[kind]} multiple hidden onChange={(e) => handle(e.target.files)} />
    </div>
  );
}

export function DeleteButton({ onConfirm, label = "Delete" }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      type="button"
      variant={armed ? "destructive" : "ghost"}
      size={armed ? "sm" : "icon"}
      onClick={() => {
        if (armed) onConfirm();
        else {
          setArmed(true);
          setTimeout(() => setArmed(false), 3000);
        }
      }}
      aria-label={label}
    >
      {armed ? "Confirm" : <Trash2 className="size-4" />}
    </Button>
  );
}
