import type { CSSProperties } from "react";
import type { Settings, Theme } from "./types";

export const THEMES: Record<Theme, { label: string; accent: string; bg: string; glow: string }> = {
  crimson: { label: "Crimson", accent: "#e11d48", bg: "#0b0709", glow: "#7f1d1d" },
  violet: { label: "Violet", accent: "#8b5cf6", bg: "#09070e", glow: "#4c1d95" },
  emerald: { label: "Emerald", accent: "#10b981", bg: "#060a09", glow: "#064e3b" },
  ice: { label: "Ice", accent: "#38bdf8", bg: "#060a0e", glow: "#0c4a6e" },
  gold: { label: "Gold", accent: "#f59e0b", bg: "#0b0906", glow: "#78350f" },
  mono: { label: "Mono", accent: "#e5e7eb", bg: "#08080a", glow: "#27272a" },
};

/** CSS variables for a settings object. Applied on the page root and the card. */
export function themeVars(s: Pick<Settings, "theme" | "accent_color" | "card_opacity" | "card_blur" | "avatar_zoom">): CSSProperties {
  const t = THEMES[s.theme] ?? THEMES.crimson;
  const accent = /^#[0-9a-f]{6}$/i.test(s.accent_color) ? s.accent_color : t.accent;
  return {
    "--brand": accent,
    "--page-bg": t.bg,
    "--page-glow": t.glow,
    "--card-opacity": String(s.card_opacity),
    "--card-blur": `${s.card_blur}px`,
    "--avatar-zoom": String(s.avatar_zoom / 100),
  } as CSSProperties;
}

/** Readable text color on top of an arbitrary hex background. */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#0a0a0a" : "#ffffff";
}
