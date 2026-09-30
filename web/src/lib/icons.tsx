import {
  Award,
  BadgeCheck,
  Brain,
  Bug,
  Code,
  Crown,
  Flame,
  Gamepad2,
  Gem,
  Globe,
  Headphones,
  Heart,
  Library,
  Link as LinkIcon,
  Mail,
  Medal,
  Moon,
  Music,
  PawPrint,
  Rocket,
  Shield,
  ShieldCheck,
  Skull,
  Sparkles,
  Star,
  Sword,
  Trophy,
  Tv,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  siAnilist,
  siBluesky,
  siDiscord,
  siGithub,
  siInstagram,
  siKick,
  siKofi,
  siLastdotfm,
  siLetterboxd,
  siMyanimelist,
  siPatreon,
  siReddit,
  siSoundcloud,
  siSpotify,
  siSteam,
  siTelegram,
  siTiktok,
  siTwitch,
  siX,
  siYoutube,
  siYoutubemusic,
  type SimpleIcon,
} from "simple-icons";
import { cn } from "./utils";

// ---- Brand icons for social links -----------------------------------------

const BRANDS: Record<string, SimpleIcon> = {
  anilist: siAnilist,
  bluesky: siBluesky,
  discord: siDiscord,
  github: siGithub,
  instagram: siInstagram,
  kick: siKick,
  kofi: siKofi,
  lastfm: siLastdotfm,
  letterboxd: siLetterboxd,
  myanimelist: siMyanimelist,
  patreon: siPatreon,
  reddit: siReddit,
  soundcloud: siSoundcloud,
  spotify: siSpotify,
  steam: siSteam,
  telegram: siTelegram,
  tiktok: siTiktok,
  twitch: siTwitch,
  x: siX,
  twitter: siX,
  youtube: siYoutube,
  ytmusic: siYoutubemusic,
};

export const BRAND_OPTIONS = Object.keys(BRANDS).filter((k) => k !== "twitter");

/** Legacy link icon names from the old admin (Material Symbols) mapped to brands. */
const LEGACY_LINK_ICONS: Record<string, string> = {
  sports_esports: "steam",
  video_library: "anilist",
};

/** Picks a brand from the icon field, the platform field, or the URL host. */
export function brandFor(icon: string, platform: string, url: string): SimpleIcon | undefined {
  for (const key of [icon, LEGACY_LINK_ICONS[icon], platform].filter(Boolean) as string[]) {
    const b = BRANDS[key.toLowerCase()];
    if (b) return b;
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const guess: Record<string, string> = {
      "discord.com": "discord", "discord.gg": "discord", "github.com": "github", "x.com": "x", "twitter.com": "x",
      "youtube.com": "youtube", "music.youtube.com": "ytmusic", "open.spotify.com": "spotify", "spotify.com": "spotify",
      "steamcommunity.com": "steam", "twitch.tv": "twitch", "instagram.com": "instagram", "tiktok.com": "tiktok",
      "anilist.co": "anilist", "myanimelist.net": "myanimelist", "reddit.com": "reddit", "t.me": "telegram",
      "bsky.app": "bluesky", "ko-fi.com": "kofi", "patreon.com": "patreon", "last.fm": "lastfm", "kick.com": "kick",
      "soundcloud.com": "soundcloud", "letterboxd.com": "letterboxd",
    };
    const k = guess[host];
    return k ? BRANDS[k] : undefined;
  } catch {
    return undefined;
  }
}

export function BrandIcon({ icon, className, title }: { icon: SimpleIcon; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5 fill-current", className)} role="img" aria-label={title ?? icon.title}>
      <path d={icon.path} />
    </svg>
  );
}

export function LinkGlyph({ icon, platform, url, className }: { icon: string; platform: string; url: string; className?: string }) {
  const brand = brandFor(icon, platform, url);
  if (brand) return <BrandIcon icon={brand} className={className} />;
  const Fallback = url.startsWith("mailto:") ? Mail : url ? Globe : LinkIcon;
  return <Fallback className={cn("size-5", className)} aria-hidden />;
}

// ---- Badge icons ----------------------------------------------------------

export const BADGE_ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  shield: Shield,
  "shield-check": ShieldCheck,
  zap: Zap,
  medal: Medal,
  gem: Gem,
  gamepad: Gamepad2,
  library: Library,
  star: Star,
  heart: Heart,
  skull: Skull,
  code: Code,
  music: Music,
  verified: BadgeCheck,
  award: Award,
  crown: Crown,
  rocket: Rocket,
  paw: PawPrint,
  bug: Bug,
  trophy: Trophy,
  sparkles: Sparkles,
  brain: Brain,
  headphones: Headphones,
  moon: Moon,
  sword: Sword,
  tv: Tv,
};

/** Material Symbols names saved by the old admin panel. */
const MATERIAL_TO_BADGE: Record<string, string> = {
  local_fire_department: "flame",
  whatshot: "flame",
  shield: "shield",
  local_police: "shield-check",
  bolt: "zap",
  military_tech: "medal",
  diamond: "gem",
  sports_esports: "gamepad",
  video_library: "library",
  star: "star",
  favorite: "heart",
  skull: "skull",
  code: "code",
  music_note: "music",
  verified: "verified",
  workspace_premium: "award",
  crown: "crown",
  rocket_launch: "rocket",
  pets: "paw",
  bug_report: "bug",
  emoji_events: "trophy",
  auto_awesome: "sparkles",
  psychology: "brain",
  headphones: "headphones",
  dark_mode: "moon",
};

export function BadgeGlyph({ icon, className }: { icon: string; className?: string }) {
  if (icon.startsWith("/") || icon.startsWith("https://")) {
    return <img src={icon} alt="" className={cn("size-4 object-contain", className)} loading="lazy" />;
  }
  const Icon = BADGE_ICONS[icon] ?? BADGE_ICONS[MATERIAL_TO_BADGE[icon] ?? ""] ?? Sparkles;
  return <Icon className={cn("size-4", className)} aria-hidden />;
}
