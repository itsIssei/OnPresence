import { useCallback, useRef, useState } from "react";
import { ChevronRight, Eye, Volume1, Volume2, VolumeX } from "lucide-react";
import { fontFamily } from "@/lib/fonts";
import { BadgeGlyph, LinkGlyph } from "@/lib/icons";
import { strings } from "@/lib/i18n";
import type { PresenceResponse, PublicProfile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Activity, customStatus } from "./Activity";
import { Avatar, type Status } from "./Avatar";
import { ProfileEffect } from "./ProfileEffect";
import { Tip } from "./Tip";

export interface CardPresence {
  discord: PresenceResponse["discord"];
  steam: PresenceResponse["steam"];
  lastfm?: PresenceResponse["lastfm"];
  status: Status;
}

export interface CardAudio {
  playing: boolean;
  failed: boolean;
  volume: number;
  toggle: () => void;
  setVolume: (v: number) => void;
}

interface Props {
  profile: PublicProfile;
  presence?: CardPresence | null;
  audio?: CardAudio | null;
  onOpenVault?: () => void;
  /** Links point at /go/{id} for click tracking; the preview uses raw URLs. */
  trackLinks?: boolean;
  className?: string;
}

/** The profile card. Used by the public site and the admin live preview. */
export function ProfileCard({ profile: p, presence, audio, onOpenVault, trackLinks = true, className }: Props) {
  const s = p.settings;
  const t = strings;
  const cardRef = useRef<HTMLDivElement>(null);
  const [replay, setReplay] = useState(0);
  const hoverArmed = useRef(true);

  // Optional: replay the profile effect on hover, at most every 8s.
  const onEnter = useCallback(() => {
    if (!s.effect_on_hover || !hoverArmed.current) return;
    hoverArmed.current = false;
    setReplay((n) => n + 1);
    setTimeout(() => (hoverArmed.current = true), 8000);
  }, [s.effect_on_hover]);

  const onMove = (e: React.PointerEvent) => {
    if (!s.card_tilt || e.pointerType !== "mouse" || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    cardRef.current.style.transform = `perspective(1200px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg)`;
  };
  const onLeave = () => {
    if (cardRef.current) cardRef.current.style.transform = "";
  };

  const status = s.show_presence ? presence?.status ?? null : null;
  const custom = s.show_presence ? customStatus(presence?.discord ?? null) : "";
  const showVault = s.vault_enabled && onOpenVault;

  return (
    <article
        ref={cardRef}
        onPointerEnter={onEnter}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className={cn("profile-card w-full max-w-[420px] overflow-hidden", s.card_effect !== "none" && `card-fx-${s.card_effect}`, className)}
        aria-label={`${p.name}'s profile`}
      >
        {p.card_bg_url && <div className="card-bg-image" style={{ backgroundImage: `url("${encodeURI(p.card_bg_url)}")` }} />}
        <ProfileEffect effect={s.profile_effect} replay={replay} />

        {/* Banner strip */}
        <div
          className="h-28 w-full"
          style={{
            background: p.card_bg_url
              ? "transparent"
              : "linear-gradient(135deg, color-mix(in oklch, var(--brand) 55%, transparent), color-mix(in oklch, var(--brand) 10%, transparent))",
          }}
        />

        {audio && <AudioControl audio={audio} labels={t} />}

        <div className="relative z-10 -mt-16 flex flex-col items-center px-6 pb-6 text-center">
          <Avatar src={p.avatar_url} decoration={s.avatar_decoration} shape={s.avatar_shape} status={status} alt={p.name} size={120} />

          <h1
            className={cn(
              "mt-4 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl",
              s.name_style === "glow" && "name-glow",
              s.name_style === "gradient" && "name-gradient",
            )}
          >
            {s.name_logo ? (
              <NameLogo src={s.name_logo} alt={p.name} mode={s.name_logo_mode} style={s.name_style} height={s.name_logo_height} />
            ) : (
              <span style={{ fontFamily: fontFamily(s.name_font) }}>{p.name}</span>
            )}
          </h1>
          <p className="mt-1 flex flex-wrap items-center justify-center gap-x-2 text-sm text-white/65">
            {p.handle && <span className="font-medium text-white/85">{p.handle}</span>}
            {p.handle && p.title && <span aria-hidden className="size-1 rounded-full bg-white/30" />}
            {p.title && <span className="uppercase tracking-[0.14em] text-[11px] font-semibold">{p.title}</span>}
          </p>
          {custom && <p className="mt-2 max-w-full truncate text-sm text-white/70">{custom}</p>}

          {p.badges.length > 0 && (
            <ul className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="Badges">
              {p.badges.map((b) => (
                <li key={b.id}>
                  <Tip label={b.subtitle}>
                    <span
                      tabIndex={b.subtitle ? 0 : undefined}
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
                      style={{
                        color: b.color || "var(--brand)",
                        borderColor: `color-mix(in oklch, ${b.color || "var(--brand)"} 40%, transparent)`,
                        background: `color-mix(in oklch, ${b.color || "var(--brand)"} 12%, transparent)`,
                      }}
                    >
                      <BadgeGlyph icon={b.icon} className="size-3.5" />
                      {b.title}
                    </span>
                  </Tip>
                </li>
              ))}
            </ul>
          )}

          {p.bio && <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-white/80">{p.bio}</p>}

          {s.show_presence && presence && (
            <div className="mt-5 w-full text-left">
              <Activity discord={presence.discord} steam={presence.steam} lastfm={presence.lastfm ?? null} musicMode={s.music_mode} />
            </div>
          )}

          {p.links.length > 0 && (
            <nav aria-label="Links" className="mt-5 flex flex-wrap justify-center gap-1">
              {p.links.map((l) => (
                <Tip key={l.id} label={l.label}>
                  <a
                    href={trackLinks ? `/go/${l.id}` : l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={l.label}
                    className="grid size-11 place-items-center rounded-xl text-white/70 transition hover:-translate-y-0.5 hover:bg-white/[0.07] hover:text-white"
                  >
                    <LinkGlyph icon={l.icon} platform={l.platform} url={l.url} className="size-[22px]" />
                  </a>
                </Tip>
              ))}
            </nav>
          )}

          {showVault && (
            <button
              type="button"
              onClick={onOpenVault}
              className="group mt-5 flex w-full items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-left transition hover:border-[color-mix(in_oklch,var(--brand)_45%,transparent)] hover:bg-white/[0.07]"
            >
              <span>
                <span className="block text-sm font-semibold text-white">{t.openVault}</span>
                <span className="block text-xs text-white/55">{s.vault_subtitle}</span>
              </span>
              <ChevronRight className="size-5 text-white/50 transition group-hover:translate-x-0.5 group-hover:text-white" />
            </button>
          )}

          {s.show_view_count && p.views > 0 && (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-white/45">
              <Eye className="size-3.5" aria-hidden />
              <span className="tabular-nums">{p.views.toLocaleString()}</span> {p.views === 1 ? "view" : t.views}
            </p>
          )}
        </div>
      </article>
  );
}

/**
 * Name rendered from an image. The image doubles as a CSS mask, so the same
 * name styles work: tint mode recolors it (white, glow, animated gradient);
 * original mode keeps its colors and adds glow or a light sweep.
 * Mask images must be same-origin (/img or /uploads).
 */
function NameLogo({ src, alt, mode, style, height }: { src: string; alt: string; mode: "tint" | "original"; style: string; height: number }) {
  const mask = { "--name-logo": `url("${encodeURI(src)}")` } as React.CSSProperties;
  return (
    <span className={cn("name-logo", style === "glow" && "name-logo-glow")} style={mask}>
      <img src={src} alt={alt} style={{ height }} className={cn("block w-auto max-w-[340px] object-contain", mode === "tint" && "opacity-0")} decoding="async" />
      {mode === "tint" && <span aria-hidden className={cn("name-logo-mask", style === "gradient" ? "name-logo-gradient" : "bg-white")} />}
      {mode === "original" && style === "gradient" && <span aria-hidden className="name-logo-mask name-logo-shine" />}
    </span>
  );
}

/** Mute button plus a volume slider that opens on hover/focus (or while playing on touch). */
function AudioControl({ audio, labels }: { audio: CardAudio; labels: { mute: string; unmute: string } }) {
  const Icon = audio.failed || !audio.playing ? VolumeX : audio.volume < 0.5 ? Volume1 : Volume2;
  const label = audio.failed ? "Audio unavailable" : audio.playing ? labels.mute : labels.unmute;
  return (
    <div
      className={cn(
        "group/vol absolute right-3 top-3 z-30 flex items-center gap-1 rounded-full bg-black/50 p-1 text-white/85 backdrop-blur transition",
        audio.failed && "opacity-60",
      )}
    >
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(audio.volume * 100)}
        onChange={(e) => audio.setVolume(Number(e.target.value) / 100)}
        aria-label="Volume"
        disabled={audio.failed}
        className={cn(
          "h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/25 accent-[var(--brand)] opacity-0 transition-all duration-200",
          "group-hover/vol:ml-2 group-hover/vol:w-20 group-hover/vol:opacity-100 group-focus-within/vol:ml-2 group-focus-within/vol:w-20 group-focus-within/vol:opacity-100",
          audio.playing && "max-sm:ml-2 max-sm:w-20 max-sm:opacity-100",
        )}
      />
      <button
        type="button"
        onClick={audio.toggle}
        aria-label={label}
        title={label}
        className="grid size-8 place-items-center rounded-full transition hover:bg-white/10 hover:text-white"
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
}
