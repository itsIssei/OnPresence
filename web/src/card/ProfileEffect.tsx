import { useEffect, useMemo, useState } from "react";
import { findEffect, loadProfileEffects, useCatalog } from "@/lib/catalog";
import type { ProfileEffectItem, ProfileEffectLayer } from "@/lib/types";

interface Props {
  /** Saved profile_effect value: catalog id/sku or "none". */
  effect: string;
  /** Increment to replay the effect (e.g. on card hover). */
  replay?: number;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Profile effect overlay for the card (animated image layers). */
export function ProfileEffect({ effect, replay = 0 }: Props) {
  if (!effect || effect === "none") return null;
  return <CatalogEffect effect={effect} replay={replay} />;
}

function CatalogEffect({ effect, replay }: { effect: string; replay: number }) {
  const catalog = useCatalog(loadProfileEffects);
  const item = useMemo(() => (catalog ? findEffect(effect, catalog) : undefined), [catalog, effect]);
  if (!item) return null;

  if (reducedMotion() || !item.effects?.length) {
    const still = item.reducedMotionSrc || item.staticFrameSrc || item.thumbnailPreviewSrc;
    return still ? <img src={still} alt="" className="effect-layer opacity-90" /> : null;
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[inherit]" aria-hidden>
      {[...item.effects]
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((layer, i) => (
          <EffectLayer key={`${item.id}-${i}-${replay}`} layer={layer} item={item} />
        ))}
    </div>
  );
}

// Image bytes are fetched once per URL; every replay gets a fresh object URL,
// which restarts the animation without downloading the file again. Only
// same-origin files are fetched; other hosts are shown directly.
const blobCache = new Map<string, Promise<Blob | null>>();
function getBlob(src: string): Promise<Blob | null> {
  if (!src.startsWith("/")) return Promise.resolve(null);
  let p = blobCache.get(src);
  if (!p) {
    p = fetch(src)
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);
    blobCache.set(src, p);
  }
  return p;
}

function pickSource(layer: ProfileEffectLayer): string {
  const r = layer.randomizedSources;
  return r && r.length ? r[Math.floor(Math.random() * r.length)].src : layer.src;
}

function EffectLayer({ layer, item }: { layer: ProfileEffectLayer; item: ProfileEffectItem }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let alive = true;
    let current = "";
    const timers: ReturnType<typeof setTimeout>[] = [];
    // duration 0 on a looping layer: the file loops by itself, keep it shown.
    const persistent = layer.loop && layer.duration === 0;
    const duration = layer.duration || 3000;

    const show = async () => {
      const url = pickSource(layer);
      const blob = await getBlob(url);
      if (!alive) return;
      if (current.startsWith("blob:")) URL.revokeObjectURL(current);
      current = blob ? URL.createObjectURL(blob) : `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
      setSrc(current);
      if (persistent) return;
      timers.push(
        setTimeout(() => {
          if (!alive) return;
          if (layer.loop) {
            setSrc("");
            timers.push(setTimeout(show, Math.max(0, layer.loopDelay)));
          } else {
            setSrc("");
          }
        }, duration),
      );
    };
    timers.push(setTimeout(show, Math.max(0, layer.start)));

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      if (current.startsWith("blob:")) URL.revokeObjectURL(current);
    };
  }, [layer]);

  if (!src) return null;
  return <img src={src} alt={item.title ?? item.name} className="effect-layer" style={{ zIndex: layer.zIndex }} />;
}
