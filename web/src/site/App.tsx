import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Route, Switch, useLocation } from "wouter";
import { BackgroundFX } from "@/card/BackgroundFX";
import { ProfileCard } from "@/card/ProfileCard";
import { api } from "@/lib/api";
import { fontFamily } from "@/lib/fonts";
import { strings } from "@/lib/i18n";
import { usePresence } from "@/lib/presence";
import { THEMES, themeVars } from "@/lib/theme";
import { useAudio, type AudioTrack } from "./audio";

// Skip the entry screen for visitors who passed it within the last hour.
const GATE_KEY = "onpresence.entered";
const GATE_COOLDOWN_MS = 60 * 60 * 1000;
function recentlyEntered(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(GATE_KEY) ?? 0) < GATE_COOLDOWN_MS;
  } catch {
    return false;
  }
}
function markEntered() {
  try {
    localStorage.setItem(GATE_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

const PROJECT_URL = "https://github.com/itsIssei/OnPresence";

const Vault = lazy(() => import("@/vault/Vault").then((m) => ({ default: m.Vault })));

export function App() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile, staleTime: 60_000 });
  const p = profile.data;
  const s = p?.settings;
  const [location, navigate] = useLocation();
  const inVault = location.startsWith("/vault");

  const vault = useQuery({ queryKey: ["vault"], queryFn: api.vault, enabled: !!s?.vault_enabled, staleTime: 60_000 });

  const [gateOpen, setGateOpen] = useState(() => !recentlyEntered());
  const needsGate = !!s?.entry_gate && gateOpen && !inVault;

  const defaultTrack = useMemo<AudioTrack | null>(
    () => (p?.audio_url && s?.music_mode !== "off" ? { url: p.audio_url, title: p.audio_title || p.name, artist: p.name, cover: p.avatar_url } : null),
    [p, s],
  );
  const audio = useAudio(defaultTrack, (s?.default_volume ?? 10) / 100);
  const presence = usePresence(p?.discord_id ?? "", !!s?.show_presence);

  // Count one view per visit (server dedupes per visitor).
  useEffect(() => {
    if (p && !needsGate) api.view().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!p, needsGate]);

  // Closed display case: /vault falls back to the card.
  useEffect(() => {
    if (s && !s.vault_enabled && inVault) navigate("/", { replace: true });
  }, [s, inVault, navigate]);

  // Keep the document title in sync on client-side navigation.
  useEffect(() => {
    if (!p) return;
    document.title = inVault ? `${s?.vault_title} · ${p.name}` : p.title ? `${p.name} · ${p.title}` : p.name;
  }, [p, s?.vault_title, inVault]);

  if (profile.isError) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-white/70">
        <p>Could not load this profile. Please refresh.</p>
      </main>
    );
  }

  if (!p || !s) return <main className="page-backdrop min-h-dvh" style={themeVars({ theme: "crimson", accent_color: "", card_opacity: 0.75, card_blur: 20, avatar_zoom: 100 })} />;

  const t = strings;
  const vars = themeVars(s);
  const accent = s.accent_color || THEMES[s.theme].accent;
  const bgIsVideo = /\.(mp4|webm)(\?|$)/i.test(p.background_url);

  const enter = () => {
    setGateOpen(false);
    markEntered();
    if (defaultTrack && !audio.mutedByVisitor) audio.play();
  };

  return (
    <div className="page-backdrop relative min-h-dvh overflow-x-clip" style={vars}>
      {p.background_url &&
        (bgIsVideo ? (
          <video className="fixed inset-0 size-full object-cover opacity-40" src={p.background_url} autoPlay muted loop playsInline aria-hidden />
        ) : (
          <div className="fixed inset-0 bg-cover bg-center opacity-40" style={{ backgroundImage: `url("${encodeURI(p.background_url)}")` }} aria-hidden />
        ))}
      <div className="fixed inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" aria-hidden />
      <BackgroundFX fx={s.background_fx} accent={accent} />

      <Switch>
        <Route path="/vault">
          <div className="relative z-10">
            {vault.data ? (
              <Suspense fallback={null}>
              <Vault profile={p} vault={vault.data} audio={defaultTrack || vault.data.playlists.length ? audio : null} onClose={() => navigate("/")} />
              </Suspense>
            ) : (
              <p className="py-24 text-center text-sm text-white/50">…</p>
            )}
          </div>
        </Route>
        <Route>
          <main
            className={`relative z-10 flex min-h-dvh flex-col items-center justify-center px-4 py-10 transition duration-700 ${needsGate ? "scale-[0.98] blur-md" : ""}`}
            aria-hidden={needsGate}
          >
            <ProfileCard
              profile={p}
              presence={presence}
              audio={defaultTrack ? audio : null}
              onOpenVault={() => {
                navigate("/vault");
                window.scrollTo({ top: 0 });
              }}
            />
            {s.show_credit && (
              <a
                href={PROJECT_URL}
                target="_blank"
                rel="noopener"
                className="mt-5 text-[11px] font-medium tracking-wide text-white/35 transition hover:text-white/70"
              >
                made with OnPresence
              </a>
            )}
          </main>
        </Route>
      </Switch>

      {needsGate && (
        <button
          type="button"
          onClick={enter}
          autoFocus
          className="fixed inset-0 z-50 grid cursor-pointer place-items-center bg-black/55 backdrop-blur-sm transition-opacity"
        >
          <span
            className="gate-text px-6 text-center text-2xl font-semibold tracking-[0.12em] text-white sm:text-3xl"
            style={{ fontFamily: fontFamily(s.gate_font) }}
          >
            {s.gate_text || t.enter}
          </span>
        </button>
      )}
    </div>
  );
}
