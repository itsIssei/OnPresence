import type { FontId } from "./types";

/** Display fonts for the name and entry screen (self-hosted via @fontsource). */
export const FONTS: Record<FontId, { label: string; family: string; upper?: boolean }> = {
  sora: { label: "Sora (modern)", family: '"Sora Variable", sans-serif' },
  inter: { label: "Inter (clean)", family: '"Inter Variable", sans-serif' },
  mono: { label: "JetBrains Mono (code)", family: '"JetBrains Mono Variable", monospace' },
  cinzel: { label: "Cinzel (royal, all caps)", family: '"Cinzel Variable", serif' },
  orbitron: { label: "Orbitron (sci-fi)", family: '"Orbitron Variable", sans-serif' },
  gothic: { label: "Grenze Gotisch (blackletter)", family: '"Grenze Gotisch Variable", serif' },
  pirata: { label: "Pirata One (gothic)", family: '"Pirata One", serif' },
  creepster: { label: "Creepster (horror)", family: '"Creepster", cursive' },
};

export const fontFamily = (id: FontId | undefined) => (FONTS[id ?? "sora"] ?? FONTS.sora).family;
