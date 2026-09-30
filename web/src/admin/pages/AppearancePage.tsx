import { useDeferredValue, useMemo, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Avatar } from "@/card/Avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { findEffect, loadDecorations, loadProfileEffects, useCatalog } from "@/lib/catalog";
import { FONTS } from "@/lib/fonts";
import { THEMES } from "@/lib/theme";
import type { AvatarShape, BackgroundFX, CardEffect, DecorationItem, FontId, NameStyle, ProfileEffectItem, Theme } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDraft } from "../draft";
import { ColorInput, Field, MediaInput, PageHeader, Section } from "../kit";

export function AppearancePage() {
  const { draft, setSetting } = useDraft();
  const [decoOpen, setDecoOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  if (!draft) return null;
  const s = draft.settings;

  return (
    <>
      <PageHeader title="Appearance" description="Theme, avatar decoration, profile effect and card style." />
      <div className="grid gap-5">
        <Section title="Theme">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(Object.keys(THEMES) as Theme[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSetting("theme", id);
                  setSetting("accent_color", THEMES[id].accent);
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border p-3 text-xs font-medium transition hover:bg-accent/50",
                  s.theme === id && "border-ring ring-1 ring-ring",
                )}
              >
                <span className="size-8 rounded-full shadow-inner" style={{ background: `radial-gradient(circle at 35% 35%, ${THEMES[id].accent}, ${THEMES[id].glow})` }} />
                {THEMES[id].label}
              </button>
            ))}
          </div>
          <Field label="Accent color" hint="Buttons, glow, progress bars. Picking a theme resets it.">
            {(id) => <ColorInput id={id} value={s.accent_color} onChange={(v) => setSetting("accent_color", v)} />}
          </Field>
        </Section>

        <Section title="Decoration & effect" description="Animated avatar decorations and profile effects. Add more with decoration packs, or paste your own image URL.">
          <div className="grid gap-4 2xl:grid-cols-2">
            <DecorationSummary value={s.avatar_decoration} avatar={draft.avatar_url} shape={s.avatar_shape} onChange={() => setDecoOpen(true)} onClear={() => setSetting("avatar_decoration", "none")} />
            <EffectSummary value={s.profile_effect} onChange={() => setFxOpen(true)} onClear={() => setSetting("profile_effect", "none")} />
          </div>
          <Toggle
            label="Replay effect on hover"
            hint="Off: the effect plays once when the card appears. On: it also replays when someone hovers the card."
            checked={s.effect_on_hover}
            onChange={(v) => setSetting("effect_on_hover", v)}
          />
          <DecorationDialog open={decoOpen} onOpenChange={setDecoOpen} value={s.avatar_decoration} onPick={(v) => setSetting("avatar_decoration", v)} />
          <EffectDialog open={fxOpen} onOpenChange={setFxOpen} value={s.profile_effect} onPick={(v) => setSetting("profile_effect", v)} />
        </Section>

        <Section title="Name" description="Show your name as text, or as a logo image with the same effects.">
          <Toggle
            label="Use a logo image"
            hint="Transparent PNG/WebP works best. Upload it to the media library."
            checked={!!s.name_logo}
            onChange={(v) => setSetting("name_logo", v ? SAMPLE_NAME_LOGO : "")}
          />
          {s.name_logo ? (
            <>
              <Field label="Logo image" hint="Must be an uploaded file or /img path so effects can use it.">
                {(id) => (
                  <div className="grid gap-2">
                    <MediaInput id={id} value={s.name_logo} onChange={(v) => setSetting("name_logo", v)} />
                  </div>
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Colors" hint="Recolor: white, glow or animated gradient. Original: keeps the artwork, adds glow or a shine sweep.">
                  {(id) => (
                    <Choice<"tint" | "original">
                      id={id}
                      value={s.name_logo_mode}
                      onChange={(v) => setSetting("name_logo_mode", v)}
                      options={{ original: "Original colors", tint: "Recolor" }}
                    />
                  )}
                </Field>
                <Field label={`Logo height · ${s.name_logo_height}px`}>
                  {() => <Slider min={32} max={140} step={1} value={[s.name_logo_height]} onValueChange={([v]) => setSetting("name_logo_height", v)} />}
                </Field>
              </div>
            </>
          ) : (
            <Field label="Name font">
              {(id) => <FontSelect id={id} value={s.name_font} onChange={(v) => setSetting("name_font", v)} sample={draft.name} />}
            </Field>
          )}
          <Field label="Effect" hint={s.name_logo && s.name_logo_mode === "original" ? "Animated gradient becomes a light sweep on original colors." : undefined}>
            {(id) => <Choice<NameStyle> id={id} value={s.name_style} onChange={(v) => setSetting("name_style", v)} options={{ plain: "None", glow: "Glow", gradient: "Animated gradient" }} />}
          </Field>
        </Section>

        <Section title="Card">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Card opacity · ${Math.round(s.card_opacity * 100)}%`}>
              {() => <Slider min={20} max={100} step={1} value={[Math.round(s.card_opacity * 100)]} onValueChange={([v]) => setSetting("card_opacity", v / 100)} />}
            </Field>
            <Field label={`Blur · ${s.card_blur}px`} hint="Blurs the card banner image and the glass behind the card.">
              {() => <Slider min={0} max={40} step={1} value={[s.card_blur]} onValueChange={([v]) => setSetting("card_blur", v)} />}
            </Field>
            <Field label={`Avatar zoom · ${s.avatar_zoom}%`}>
              {() => <Slider min={50} max={200} step={1} value={[s.avatar_zoom]} onValueChange={([v]) => setSetting("avatar_zoom", v)} />}
            </Field>
            <Field label="Avatar shape">
              {(id) => (
                <Choice<AvatarShape> id={id} value={s.avatar_shape} onChange={(v) => setSetting("avatar_shape", v)} options={{ circle: "Circle", rounded: "Rounded", square: "Square" }} />
              )}
            </Field>
            <Field label="Card overlay">
              {(id) => (
                <Choice<CardEffect>
                  id={id}
                  value={s.card_effect}
                  onChange={(v) => setSetting("card_effect", v)}
                  options={{ none: "None", glitch: "Glitch lines", scanlines: "CRT scanlines", "gradient-blur": "Vignette" }}
                />
              )}
            </Field>
          </div>
          <Toggle label="3D tilt on hover" hint="Desktop only; disabled for reduced-motion users." checked={s.card_tilt} onChange={(v) => setSetting("card_tilt", v)} />
        </Section>

        <Section title="Page">
          <Field label="Background effect" hint="Pick one. Every effect pauses in background tabs and respects reduced motion.">
            {(id) => (
              <Choice<BackgroundFX>
                id={id}
                value={s.background_fx}
                onChange={(v) => setSetting("background_fx", v)}
                options={{ none: "None", embers: "Embers", lightning: "Lightning", "magic-circle": "Magic circle", all: "All of them" }}
              />
            )}
          </Field>
          <Toggle label="Entry screen" hint="“Click to enter” overlay. Needed to autoplay your soundtrack." checked={s.entry_gate} onChange={(v) => setSetting("entry_gate", v)} />
          {s.entry_gate && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Entry text" hint="Shown exactly as typed. Returning visitors skip it for 1 hour.">
                {(id) => <Input id={id} value={s.gate_text} maxLength={60} onChange={(e) => setSetting("gate_text", e.target.value)} />}
              </Field>
              <Field label="Entry font">
                {(id) => <FontSelect id={id} value={s.gate_font} onChange={(v) => setSetting("gate_font", v)} sample={s.gate_text} />}
              </Field>
            </div>
          )}
          <Toggle label="Show view counter" checked={s.show_view_count} onChange={(v) => setSetting("show_view_count", v)} />
          <Toggle
            label="Show “made with OnPresence”"
            hint="A small link under your card. Keeping it on helps the project grow. Thank you!"
            checked={s.show_credit}
            onChange={(v) => setSetting("show_credit", v)}
          />
        </Section>
      </div>
    </>
  );
}

// Placeholder until an image is uploaded.
const SAMPLE_NAME_LOGO = "/img/brand/wordmark.svg";

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function Choice<T extends string>({ id, value, onChange, options }: { id?: string; value: T; onChange: (v: T) => void; options: Record<T, string> }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(options) as T[]).map((k) => (
          <SelectItem key={k} value={k}>
            {options[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FontSelect({ id, value, onChange, sample }: { id?: string; value: FontId; onChange: (v: FontId) => void; sample: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as FontId)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(FONTS) as FontId[]).map((k) => (
          <SelectItem key={k} value={k}>
            <span style={{ fontFamily: FONTS[k].family }} className="text-base">
              {sample || "Your Name"}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">{FONTS[k].label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Decoration picker
// ---------------------------------------------------------------------------

function DecorationSummary({ value, avatar, shape, onChange, onClear }: { value: string; avatar: string; shape: AvatarShape; onChange: () => void; onClear: () => void }) {
  const catalog = useCatalog(loadDecorations);
  const item = catalog?.find((d) => d.id === value || d.asset === value);
  return (
    <div className="flex items-center gap-4 rounded-xl border p-3">
      <div className="p-2">
        <Avatar src={avatar} decoration={value} shape={shape} alt="You" size={64} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avatar decoration</p>
        <p className="truncate text-sm font-medium">{value === "none" ? "None" : item?.name ?? (value.startsWith("http") ? "Custom URL" : value)}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={onChange}>
            Browse
          </Button>
          {value !== "none" && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DecorationDialog({ open, onOpenChange, value, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; value: string; onPick: (v: string) => void }) {
  const catalog = useCatalog(loadDecorations);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [custom, setCustom] = useState("");
  const dq = useDeferredValue(q.toLowerCase());
  const cats = useMemo(() => groupCategories(catalog ?? []), [catalog]);
  const items = useMemo(
    () => (catalog ?? []).filter((d) => (cat === "all" || d.category === cat) && (!dq || d.name.toLowerCase().includes(dq))).slice(0, 240),
    [catalog, cat, dq],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Avatar decorations</DialogTitle>
          <DialogDescription>{catalog ? `${catalog.length} decorations. Import more under Decoration packs.` : "Loading catalog…"}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search decorations…" className="min-w-48 flex-1" />
          <CategorySelect value={cat} onChange={setCat} cats={cats} />
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 md:grid-cols-6">
          {items.map((d) => (
            <DecoTile key={d.id} d={d} selected={value === d.id || value === d.url} onPick={() => onPick(d.id)} />
          ))}
          {catalog && items.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">No decorations match.</p>}
        </div>
        <div className="flex gap-2 border-t pt-3">
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or paste an https:// image URL (APNG/PNG/GIF)" />
          <Button variant="secondary" disabled={!custom.startsWith("https://")} onClick={() => onPick(custom.trim())}>
            Use URL
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DecoTile({ d, selected, onPick }: { d: DecorationItem; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={d.name}
      className={cn("group relative flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition hover:bg-accent/50", selected && "border-ring ring-1 ring-ring")}
    >
      <div className="relative size-16">
        <div className="absolute inset-[14%] rounded-full bg-muted" />
        <img src={d.url} alt="" loading="lazy" className="absolute inset-0 size-full object-contain" />
      </div>
      <span className="line-clamp-2 text-[11px] leading-tight">{d.name}</span>
      {selected && <Check className="absolute right-1.5 top-1.5 size-4 text-primary" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Profile effect picker
// ---------------------------------------------------------------------------

function EffectSummary({ value, onChange, onClear }: { value: string; onChange: () => void; onClear: () => void }) {
  const catalog = useCatalog(loadProfileEffects);
  const item = catalog ? findEffect(value, catalog) : undefined;
  const thumb = item?.thumbnailPreviewSrc;
  return (
    <div className="flex items-center gap-4 rounded-xl border p-3">
      <div className="grid h-20 w-14 flex-none place-items-center overflow-hidden rounded-lg bg-muted">
        {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <Sparkles className="size-5 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Profile effect</p>
        <p className="truncate text-sm font-medium">{value === "none" ? "None" : item?.title ?? item?.name ?? value}</p>
        <p className="text-xs text-muted-foreground">Plays when the card appears and when hovered.</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={onChange}>
            Browse
          </Button>
          {value !== "none" && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function EffectDialog({ open, onOpenChange, value, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; value: string; onPick: (v: string) => void }) {
  const catalog = useCatalog(loadProfileEffects);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const dq = useDeferredValue(q.toLowerCase());
  const cats = useMemo(() => groupCategories(catalog ?? []), [catalog]);
  const items = useMemo(
    () =>
      (catalog ?? [])
        .filter((e) => e.effects?.length || e.thumbnailPreviewSrc)
        .filter((e) => (cat === "all" || e.category === cat) && (!dq || (e.title ?? e.name).toLowerCase().includes(dq)))
        .slice(0, 240),
    [catalog, cat, dq],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Profile effects</DialogTitle>
          <DialogDescription>{catalog ? `${catalog.length} effects. Import more under Decoration packs.` : "Loading catalog…"}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search effects…" className="min-w-48 flex-1" />
          <CategorySelect value={cat} onChange={setCat} cats={cats} />
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 md:grid-cols-6">
          {items.map((e) => (
            <EffectTile key={e.id} e={e} selected={value === e.id || value === e.sku_id} onPick={() => onPick(e.id)} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EffectTile({ e, selected, onPick }: { e: ProfileEffectItem; selected: boolean; onPick: () => void }) {
  const [hover, setHover] = useState(false);
  const anim = e.effects?.find((l) => l.loop)?.src ?? e.effects?.[0]?.src;
  return (
    <button
      type="button"
      onClick={onPick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={e.title ?? e.name}
      className={cn("relative flex flex-col gap-1 rounded-xl border p-1.5 text-left transition hover:bg-accent/50", selected && "border-ring ring-1 ring-ring")}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
        {(e.staticFrameSrc || e.thumbnailPreviewSrc) && <img src={e.staticFrameSrc || e.thumbnailPreviewSrc} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />}
        {hover && anim && <img src={anim} alt="" className="absolute inset-0 size-full object-cover" />}
      </div>
      <span className="line-clamp-2 px-0.5 text-[11px] leading-tight">{e.title ?? e.name}</span>
      {selected && <Check className="absolute right-2 top-2 size-4 text-primary" />}
    </button>
  );
}

function groupCategories(items: { category?: string; category_name?: string }[]) {
  const m = new Map<string, string>();
  for (const i of items) if (i.category) m.set(i.category, i.category_name || i.category);
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function CategorySelect({ value, onChange, cats }: { value: string; onChange: (v: string) => void; cats: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value="all">All categories</SelectItem>
        {cats.map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

