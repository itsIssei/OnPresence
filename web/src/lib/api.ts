import type {
  AdminProfile,
  Badge,
  Me,
  Game,
  Media,
  Playlist,
  PresenceResponse,
  PublicProfile,
  Referral,
  Session,
  Snapshot,
  SocialLink,
  Upload,
  Vault,
} from "./types";

export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;
  /** Login answered "password ok, now send the 2FA code". */
  totpRequired: boolean;
  constructor(status: number, message: string, fields?: Record<string, string>, totpRequired = false) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.totpRequired = totpRequired;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? safeJSON(text) : null;
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; fields?: Record<string, string>; totp_required?: boolean };
    throw new ApiError(res.status, d.error ?? res.statusText, d.fields, !!d.totp_required);
  }
  return data as T;
}

function safeJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const get = <T,>(p: string) => request<T>("GET", p);

export type CollectionName = "links" | "badges" | "games" | "media" | "playlists" | "referrals";

export interface CollectionTypes {
  links: SocialLink;
  badges: Badge;
  games: Game;
  media: Media;
  playlists: Playlist;
  referrals: Referral;
}

export const api = {
  // public
  profile: () => get<PublicProfile>("/api/v1/profile"),
  vault: () => get<Vault>("/api/v1/vault"),
  presence: () => get<PresenceResponse>("/api/v1/presence"),
  view: () => request<{ views: number }>("POST", "/api/v1/view"),

  // first-run setup
  setupStatus: () => get<{ needed: boolean }>("/api/v1/setup"),
  setup: (setup_code: string, username: string, password: string) =>
    request<{ username: string }>("POST", "/api/v1/setup", { setup_code, username, password }),

  // auth
  login: (username: string, password: string, code?: string) =>
    request<{ username: string }>("POST", "/api/v1/auth/login", { username, password, code }),
  logout: () => request("POST", "/api/v1/auth/logout"),
  me: () => get<Me>("/api/v1/auth/me"),
  totpSetup: () => request<{ secret: string; uri: string }>("POST", "/api/v1/auth/totp/setup"),
  totpEnable: (code: string) => request<{ recovery_codes: string[] }>("POST", "/api/v1/auth/totp/enable", { code }),
  totpDisable: (password: string) => request("POST", "/api/v1/auth/totp/disable", { password }),
  changePassword: (old_password: string, new_password: string) =>
    request("POST", "/api/v1/auth/password", { old_password, new_password }),
  sessions: () => get<Session[]>("/api/v1/auth/sessions"),
  revokeSession: (id: number) => request("DELETE", `/api/v1/auth/sessions/${id}`),

  // admin
  adminProfile: () => get<AdminProfile>("/api/v1/admin/profile"),
  saveProfile: (p: AdminProfile & { steam_api_key?: string; lastfm_api_key?: string }) => request<AdminProfile>("PUT", "/api/v1/admin/profile", p),
  snapshots: () => get<Snapshot[]>("/api/v1/admin/snapshots"),
  restoreSnapshot: (id: number) => request<AdminProfile>("POST", `/api/v1/admin/snapshots/${id}/restore`),
  restoreContent: (data: unknown) => request("POST", "/api/v1/admin/restore", data),
  about: () => get<{ version: string }>("/api/v1/admin/about"),
  stats: () => get<{ views: number; link_clicks: number; links: SocialLink[] }>("/api/v1/admin/stats"),

  list: <C extends CollectionName>(c: C) => get<CollectionTypes[C][]>(`/api/v1/admin/${c}`),
  save: <C extends CollectionName>(c: C, item: Partial<CollectionTypes[C]> & { id?: number }) =>
    item.id
      ? request<CollectionTypes[C]>("PUT", `/api/v1/admin/${c}/${item.id}`, item)
      : request<CollectionTypes[C]>("POST", `/api/v1/admin/${c}`, item),
  remove: (c: CollectionName, id: number) => request("DELETE", `/api/v1/admin/${c}/${id}`),
  reorder: (c: CollectionName, ids: number[]) => request("PUT", `/api/v1/admin/${c}/order`, { ids }),

  uploads: () => get<Upload[]>("/api/v1/admin/uploads"),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Upload>("POST", "/api/v1/admin/uploads", fd);
  },
  deleteUpload: (id: number, force = false) => request("DELETE", `/api/v1/admin/uploads/${id}${force ? "?force=1" : ""}`),

  importAniList: (q: string, type: "ANIME" | "MANGA") =>
    get<AniListResult[]>(`/api/v1/admin/import/anilist?q=${encodeURIComponent(q)}&type=${type}`),
  importGames: (q: string) => get<GameSearchResult[]>(`/api/v1/admin/import/games?q=${encodeURIComponent(q)}`),
  importMusic: (url: string) => get<MusicMeta>(`/api/v1/admin/import/music?url=${encodeURIComponent(url)}`),

  syncCatalog: (payload: { decorations?: unknown[]; profileEffects?: unknown[] }) =>
    request<{ decorations: number; profileEffects: number }>("POST", "/api/v1/admin/catalog", payload),
  resetCatalog: () => request("DELETE", "/api/v1/admin/catalog"),
  backups: () => get<{ name: string; size: number; time: string }[]>("/api/v1/admin/backups"),
  createBackup: () => request<{ name: string }>("POST", "/api/v1/admin/backups"),
};

export interface AniListResult {
  id: number;
  title: { romaji: string; english: string; native: string };
  type: string;
  format: string;
  episodes: number;
  chapters: number;
  meanScore: number;
  coverImage: { large: string };
  description: string;
  genres: string[];
}

export interface GameSearchResult {
  id: number;
  title: string;
  cover_image: string;
  images: { label: string; url: string }[];
  genres: string[] | null;
  source: string;
}

export interface MusicMeta {
  title: string;
  artist: string;
  cover_image: string;
  type: "playlist" | "solo";
  duration: string;
  spotify_url: string;
  yt_music_url: string;
}
