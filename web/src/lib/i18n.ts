import type { ItemStatus } from "./types";

/** UI labels shown to visitors. */
export const strings = {
  enter: "click to enter",
  openVault: "Open display case",
  closeVault: "Back to card",
  views: "views",
  mute: "Mute music",
  unmute: "Play music",
  replayEffect: "Replay effect",
  games: "Games",
  anime: "Anime",
  manga: "Manga & Manhwa",
  music: "Music",
  referrals: "Projects & Referrals",
  projects: "Projects",
  invites: "Referrals",
  open: "Open",
  all: "All",
  search: "Search…",
  hours: "h played",
  empty: "Nothing here yet.",
  copyCode: "Copy code",
  copied: "Copied!",
  copyLink: "Copy link",
  linkCopied: "Link copied",
  join: "Join",
  featured: "Featured",
  recent: "Recently added",
  tracks: "tracks",
  listenOn: "Listen on",
  review: "Review",
  noResults: "No results.",
  playing: "Now playing",
  details: "Details",
  // Tier list rows of the games section, best first: [badge_type, label].
  tiers: [["masterpiece", "S"], ["good", "A"], ["okay", "B"], ["trash", "C"]] as ReadonlyArray<readonly [string, string]>,
};

export type StatusKind = "game" | "anime" | "manga" | "case";

const STATUS_LABELS: Record<ItemStatus, string> = {
  owned: "Owned",
  playing: "Playing",
  completed: "Completed",
  dropped: "Dropped",
  wishlist: "Wishlist",
};

/** Status label for a section. The value stays the same; the wording changes. */
export function statusLabel(status: ItemStatus, kind: StatusKind): string {
  if (status === "playing") return kind === "anime" ? "Watching" : kind === "manga" ? "Reading" : kind === "case" ? "In progress" : "Playing";
  if (status === "owned" && kind !== "game") return kind === "case" ? "Owned" : "In collection";
  return STATUS_LABELS[status];
}

export type Strings = typeof strings;
