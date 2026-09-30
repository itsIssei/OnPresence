import { useEffect, useState } from "react";
import type { DecorationItem, ProfileEffectItem } from "./types";

let decorationsP: Promise<DecorationItem[]> | null = null;
let effectsP: Promise<ProfileEffectItem[]> | null = null;

async function fetchJSON<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function loadDecorations(): Promise<DecorationItem[]> {
  decorationsP ??= fetchJSON<DecorationItem>("/data/decorations.json");
  return decorationsP;
}

export function loadProfileEffects(): Promise<ProfileEffectItem[]> {
  effectsP ??= fetchJSON<ProfileEffectItem>("/data/effects.json");
  return effectsP;
}

/** Drop cached catalogs (after the admin imports a pack). */
export function resetCatalogs() {
  decorationsP = null;
  effectsP = null;
}

/** Resolves a saved decoration value (id, path or URL) to an image URL. */
export function resolveDecorationSync(value: string, catalog: DecorationItem[]): string {
  if (!value || value === "none") return "";
  if (value.startsWith("https://") || value.startsWith("/")) return value;
  const hit = catalog.find((d) => d.id === value || d.asset === value);
  return hit?.url ?? "";
}

export function findEffect(value: string, catalog: ProfileEffectItem[]): ProfileEffectItem | undefined {
  if (!value || value === "none") return undefined;
  const v = value.toLowerCase();
  return catalog.find(
    (e) => e.id === value || e.sku_id === value || e.name?.toLowerCase() === v || e.title?.toLowerCase() === v,
  );
}

export function useDecorationUrl(value: string): string {
  const direct = !value || value === "none" || value.startsWith("https://") || value.startsWith("/");
  const [resolved, setResolved] = useState<{ value: string; url: string } | null>(null);
  useEffect(() => {
    if (direct) return;
    let alive = true;
    loadDecorations().then((c) => alive && setResolved({ value, url: resolveDecorationSync(value, c) }));
    return () => {
      alive = false;
    };
  }, [value, direct]);
  if (direct) return resolveDecorationSync(value, []);
  return resolved?.value === value ? resolved.url : "";
}

export function useCatalog<T>(loader: () => Promise<T[]>): T[] | null {
  const [items, setItems] = useState<T[] | null>(null);
  useEffect(() => {
    let alive = true;
    loader().then((c) => alive && setItems(c));
    return () => {
      alive = false;
    };
  }, [loader]);
  return items;
}
