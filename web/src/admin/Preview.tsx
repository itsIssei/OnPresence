import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Monitor, Smartphone } from "lucide-react";
import { BackgroundFX } from "@/card/BackgroundFX";
import { ProfileCard } from "@/card/ProfileCard";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { usePresence } from "@/lib/presence";
import { THEMES, themeVars } from "@/lib/theme";
import type { PublicProfile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDraft } from "./draft";

/** Live preview of the unsaved draft, rendered with the real card component. */
export function Preview({ className }: { className?: string }) {
  const { draft } = useDraft();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const links = useQuery({ queryKey: ["admin", "links"], queryFn: () => api.list("links") });
  const badges = useQuery({ queryKey: ["admin", "badges"], queryFn: () => api.list("badges") });
  const views = useQuery({ queryKey: ["admin", "stats"], queryFn: api.stats });
  const presence = usePresence(draft?.discord_id ?? "", !!draft?.settings.show_presence);

  if (!draft) return null;
  const s = draft.settings;
  const profile: PublicProfile = {
    ...draft,
    links: (links.data ?? []).filter((l) => l.is_active),
    badges: badges.data ?? [],
    views: views.data?.views ?? 0,
  };
  const bgIsVideo = /\.(mp4|webm)(\?|$)/i.test(draft.background_url);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live preview</span>
        <div className="flex items-center gap-1">
          <Button variant={device === "desktop" ? "secondary" : "ghost"} size="icon" className="size-8" onClick={() => setDevice("desktop")} aria-label="Desktop preview">
            <Monitor className="size-4" />
          </Button>
          <Button variant={device === "mobile" ? "secondary" : "ghost"} size="icon" className="size-8" onClick={() => setDevice("mobile")} aria-label="Mobile preview">
            <Smartphone className="size-4" />
          </Button>
          <Button asChild variant="ghost" size="icon" className="size-8">
            <a href="/" target="_blank" rel="noopener" aria-label="Open public page">
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
      </div>
      <div className="flex flex-1 items-start justify-center overflow-auto bg-black/30 p-4">
        <div
          className={cn(
            "page-backdrop relative flex min-h-full w-full items-center justify-center overflow-hidden rounded-xl border px-4 py-8 transition-[max-width]",
            device === "mobile" ? "max-w-[390px]" : "max-w-full",
          )}
          style={themeVars(s)}
        >
          {draft.background_url &&
            (bgIsVideo ? (
              <video className="absolute inset-0 size-full object-cover opacity-40" src={draft.background_url} autoPlay muted loop playsInline />
            ) : (
              <div className="absolute inset-0 bg-cover bg-center opacity-40" style={{ backgroundImage: `url("${encodeURI(draft.background_url)}")` }} />
            ))}
          <BackgroundFX fx={s.background_fx} accent={s.accent_color || THEMES[s.theme].accent} contained />
          <ProfileCard profile={profile} presence={presence} trackLinks={false} onOpenVault={s.vault_enabled ? () => {} : undefined} className="relative" />
        </div>
      </div>
    </div>
  );
}
