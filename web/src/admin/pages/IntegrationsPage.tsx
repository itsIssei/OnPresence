import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { usePresence } from "@/lib/presence";
import type { DiscordStatus, MusicMode } from "@/lib/types";
import { useDraft } from "../draft";
import { Field, PageHeader, Section } from "../kit";
import { Choice, Toggle } from "./AppearancePage";

export function IntegrationsPage() {
  const { draft, set, setSetting, errors, steamKey, setSteamKey, lastfmKey, setLastfmKey } = useDraft();
  const live = usePresence(draft?.discord_id ?? "", !!draft);
  if (!draft) return null;
  const s = draft.settings;
  const lanyardOk = !!live.discord;

  return (
    <>
      <PageHeader title="Integrations" description="Live Discord, Spotify, Last.fm and Steam activity on your card." />
      <div className="grid gap-5">
        <Toggle label="Show live activity" hint="Status dot, custom status, music and games." checked={s.show_presence} onChange={(v) => setSetting("show_presence", v)} />

        <Section title="Discord" description="Uses Lanyard. Join discord.gg/lanyard once so it can see your presence.">
          <Field label="Discord user ID" hint="Settings → Advanced → Developer Mode, then right-click yourself → Copy User ID." error={errors.discord_id}>
            {(id) => <Input id={id} value={draft.discord_id} inputMode="numeric" onChange={(e) => set("discord_id", e.target.value.trim())} placeholder="123456789012345678" className="font-mono" />}
          </Field>
          {draft.discord_id && (
            <p className="text-sm">
              Lanyard:{" "}
              {lanyardOk ? (
                <span className="text-emerald-400">connected · {live.discord?.discord_status}</span>
              ) : (
                <span className="text-amber-400">no data yet — make sure you joined the Lanyard server</span>
              )}
            </p>
          )}
          <Field label="Status" hint="Auto uses your real Discord status. Override to always show one status.">
            {(id) => (
              <Choice<DiscordStatus>
                id={id}
                value={draft.discord_status}
                onChange={(v) => set("discord_status", v)}
                options={{ auto: "Auto (live)", online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline" }}
              />
            )}
          </Field>
          <Field label="Music on card" hint="Which listening activity to show from Discord.">
            {(id) => (
              <Choice<MusicMode>
                id={id}
                value={s.music_mode}
                onChange={(v) => setSetting("music_mode", v)}
                options={{
                  auto: "Auto (Spotify, YouTube Music, then Last.fm)",
                  spotify: "Spotify only",
                  ytmusic: "YouTube Music only",
                  lastfm: "Last.fm only",
                  custom: "Only my soundtrack",
                  off: "Off",
                }}
              />
            )}
          </Field>
        </Section>

        <Section title="Steam" description="Shows the game you are playing when Discord does not.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SteamID64 or custom URL name" error={errors.steam_id}>
              {(id) => <Input id={id} value={draft.steam_id} onChange={(e) => set("steam_id", e.target.value.trim())} className="font-mono" />}
            </Field>
            <Field label="Steam level text" hint="Optional, e.g. LVL 85" error={errors.steam_level}>
              {(id) => <Input id={id} value={draft.steam_level} maxLength={30} onChange={(e) => set("steam_level", e.target.value)} />}
            </Field>
          </div>
          <Field
            label="Steam Web API key"
            hint={draft.steam_api_key_set && steamKey === undefined ? "A key is stored. It is never shown again. Type a new one to replace it." : "Optional. Without a key, the public community profile is used."}
            error={errors.steam_api_key}
          >
            {(id) => (
              <div className="flex gap-2">
                <Input
                  id={id}
                  type="password"
                  autoComplete="off"
                  value={steamKey ?? ""}
                  placeholder={draft.steam_api_key_set ? "••••••••••••••••" : "32 hex characters"}
                  onChange={(e) => setSteamKey(e.target.value)}
                  className="font-mono"
                />
                {draft.steam_api_key_set && (
                  <Button type="button" variant="ghost" onClick={() => setSteamKey("")}>
                    Remove key
                  </Button>
                )}
              </div>
            )}
          </Field>
        </Section>

        <Section title="Last.fm" description="Shows the track you are scrobbling right now. Works with any player that scrobbles (Apple Music, Tidal, foobar2000…).">
          <Field label="Last.fm username" error={errors.lastfm_username}>
            {(id) => <Input id={id} value={draft.lastfm_username} onChange={(e) => set("lastfm_username", e.target.value.trim())} />}
          </Field>
          <Field
            label="Last.fm API key"
            hint={
              draft.lastfm_api_key_set && lastfmKey === undefined
                ? "A key is stored. It is never shown again. Type a new one to replace it."
                : "Free at last.fm/api/account/create. Needed for now playing."
            }
            error={errors.lastfm_api_key}
          >
            {(id) => (
              <div className="flex gap-2">
                <Input
                  id={id}
                  type="password"
                  autoComplete="off"
                  value={lastfmKey ?? ""}
                  placeholder={draft.lastfm_api_key_set ? "••••••••••••••••" : "32 hex characters"}
                  onChange={(e) => setLastfmKey(e.target.value)}
                  className="font-mono"
                />
                {draft.lastfm_api_key_set && (
                  <Button type="button" variant="ghost" onClick={() => setLastfmKey("")}>
                    Remove key
                  </Button>
                )}
              </div>
            )}
          </Field>
        </Section>

        <Section title="Other accounts">
          <Field label="AniList username" hint="Used by the anime and manga importer." error={errors.anilist_username}>
            {(id) => <Input id={id} value={draft.anilist_username} onChange={(e) => set("anilist_username", e.target.value)} />}
          </Field>
        </Section>
      </div>
    </>
  );
}
