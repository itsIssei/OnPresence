// Mirrors server/models. Keep in sync with models.go.

export type Theme = "crimson" | "violet" | "emerald" | "ice" | "gold" | "mono";
export type CardEffect = "none" | "glitch" | "scanlines" | "gradient-blur";
export type BackgroundFX = "none" | "embers" | "lightning" | "magic-circle" | "all";
export type AvatarShape = "circle" | "rounded" | "square";
export type NameStyle = "plain" | "glow" | "gradient";
export type MusicMode = "auto" | "spotify" | "ytmusic" | "lastfm" | "custom" | "off";
export type SectionId = "referrals" | "games" | "anime" | "manga" | "music";
export type FontId = "sora" | "inter" | "mono" | "cinzel" | "orbitron" | "gothic" | "pirata" | "creepster";
export type DiscordStatus = "auto" | "online" | "idle" | "dnd" | "offline";

export interface Settings {
  theme: Theme;
  accent_color: string;
  avatar_decoration: string;
  profile_effect: string;
  card_effect: CardEffect;
  background_fx: BackgroundFX;
  card_opacity: number;
  card_blur: number;
  avatar_zoom: number;
  avatar_shape: AvatarShape;
  name_style: NameStyle;
  card_tilt: boolean;
  name_font: FontId;
  gate_font: FontId;
  name_logo: string;
  name_logo_mode: "tint" | "original";
  name_logo_height: number;
  effect_on_hover: boolean;
  entry_gate: boolean;
  gate_text: string;
  music_mode: MusicMode;
  default_volume: number;
  show_presence: boolean;
  show_view_count: boolean;
  show_credit: boolean;
  vault_enabled: boolean;
  vault_title: string;
  vault_subtitle: string;
  vault_badge: string;
  vault_icon: string;
  vault_steam_badge: string;
  collection_score: string;
  sections: SectionId[];
}

export interface Profile {
  name: string;
  handle: string;
  title: string;
  bio: string;
  avatar_url: string;
  background_url: string;
  card_bg_url: string;
  audio_url: string;
  audio_title: string;
  discord_id: string;
  discord_status: DiscordStatus;
  steam_id: string;
  steam_level: string;
  anilist_username: string;
  lastfm_username: string;
  settings: Settings;
  updated_at: string;
}

export interface AdminProfile extends Profile {
  steam_api_key_set: boolean;
  lastfm_api_key_set: boolean;
}

export interface Me {
  username: string;
  totp_enabled: boolean;
  recovery_codes_left: number;
}

export interface Snapshot {
  id: number;
  created_at: string;
  name: string;
}

export interface SocialLink {
  id: number;
  platform: string;
  label: string;
  url: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  clicks: number;
}

export interface Badge {
  id: number;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  category: string;
  sort_order: number;
}

export interface PublicProfile extends Profile {
  links: SocialLink[];
  badges: Badge[];
  views: number;
}

export type GameBadgeType = "trash" | "okay" | "good" | "masterpiece";

export interface Game {
  id: number;
  title: string;
  subtitle: string;
  cover_image: string;
  rating: string;
  badge: string;
  badge_type: GameBadgeType;
  hours_played: number;
  category: string;
  review_note: string;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
}

export type MediaType = "anime" | "manga" | "manhwa";

export interface Media {
  id: number;
  title: string;
  type: MediaType;
  cover_image: string;
  rating: string;
  rank_badge: string;
  category_badge: string;
  progress_info: string;
  review_note: string;
  anilist_id: number;
  tags: string;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
}

export interface Track {
  id?: number;
  track_number: string;
  title: string;
  artist: string;
  duration: string;
  audio_url: string;
}

export interface Playlist {
  id: number;
  title: string;
  subtitle: string;
  type: "playlist" | "solo";
  cover_image: string;
  spotify_url: string;
  yt_music_url: string;
  audio_url: string;
  duration: string;
  artist: string;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
  tracks: Track[];
}

export interface Referral {
  id: number;
  kind: "project" | "referral";
  title: string;
  game_name: string;
  ref_code: string;
  ref_url: string;
  image_url: string;
  description: string;
  reward_text: string;
  badge: string;
  display_style: "banner" | "card";
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Vault {
  stats: { games: number; anime: number; manga: number; playlists: number };
  referrals: Referral[];
  games: Game[];
  anime: Media[];
  manga: Media[];
  playlists: Playlist[];
}

export interface Upload {
  id: number;
  url: string;
  name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  created_at: string;
}

export interface Session {
  id: number;
  created_at: string;
  expires_at: string;
  last_seen: string;
  ip: string;
  user_agent: string;
  current: boolean;
}

// ---- Presence (Lanyard) ---------------------------------------------------

export interface LanyardActivity {
  name: string;
  type: number; // 0 playing, 1 streaming, 2 listening, 3 watching, 4 custom, 5 competing
  state?: string;
  details?: string;
  application_id?: string;
  timestamps?: { start?: number; end?: number };
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string };
  emoji?: { name: string; id?: string; animated?: boolean };
}

export interface LanyardData {
  discord_user?: { id: string; username: string; global_name?: string; avatar?: string };
  discord_status: "online" | "idle" | "dnd" | "offline";
  listening_to_spotify: boolean;
  spotify?: {
    track_id: string;
    song: string;
    artist: string;
    album: string;
    album_art_url: string;
    timestamps: { start: number; end: number };
  } | null;
  activities: LanyardActivity[];
}

export interface SteamPresence {
  steam_id: string;
  personaname: string;
  status: "ingame" | "online" | "away" | "offline";
  status_label: string;
  in_game: boolean;
  game_title?: string;
  game_id?: string;
  game_banner?: string;
  avatar_url?: string;
  profile_url?: string;
}

export interface LastfmTrack {
  title: string;
  artist: string;
  album: string;
  image: string;
  url: string;
  now_playing: boolean;
}

export interface PresenceResponse {
  discord: LanyardData | null;
  discord_override: string;
  steam: SteamPresence | null;
  lastfm: LastfmTrack | null;
}

// ---- Decoration and effect catalogs --------------------------------------

export interface DecorationItem {
  id: string;
  name: string;
  url: string;
  asset?: string;
  category?: string;
  category_name?: string;
  description?: string;
}

export interface ProfileEffectLayer {
  src: string;
  loop: boolean;
  duration: number;
  start: number;
  loopDelay: number;
  zIndex: number;
  randomizedSources?: { src: string }[];
}

export interface ProfileEffectItem {
  id: string;
  sku_id?: string;
  name: string;
  title?: string;
  category?: string;
  category_name?: string;
  description?: string;
  thumbnailPreviewSrc?: string;
  reducedMotionSrc?: string;
  staticFrameSrc?: string;
  effects: ProfileEffectLayer[];
}
