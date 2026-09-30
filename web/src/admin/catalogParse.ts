import type { DecorationItem, ProfileEffectItem } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Reads a decoration pack file (see docs/decoration-packs.md):
 *   {"decorations": [...], "profileEffects": [...]}
 * or a plain array of decorations (entries with "url") or effects (entries
 * with "effects").
 */
export function parsePackFile(data: any): { decorations: DecorationItem[]; profileEffects: ProfileEffectItem[] } {
  if (data && !Array.isArray(data) && (data.decorations || data.profileEffects || data.effects)) {
    return { decorations: list(data.decorations), profileEffects: list(data.profileEffects ?? data.effects) };
  }
  if (Array.isArray(data) && data.length && data[0]) {
    return "effects" in data[0] ? { decorations: [], profileEffects: data } : { decorations: data, profileEffects: [] };
  }
  return { decorations: [], profileEffects: [] };
}

const list = (v: any) => (Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : []);

/** Adds incoming entries to the existing catalog; same id = replaced. */
export function mergeEntries<T extends { id: string }>(incoming: T[], existing: T[]): T[] {
  const ids = new Set(incoming.map((x) => x.id));
  return [...existing.filter((x) => !ids.has(x.id)), ...incoming];
}
