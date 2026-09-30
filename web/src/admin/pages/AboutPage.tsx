import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Heart } from "lucide-react";
import { siGithub } from "simple-icons";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { BrandIcon } from "@/lib/icons";
import { PageHeader, Section } from "../kit";

const REPO = "https://github.com/itsIssei/OnPresence";
const AUTHOR = { name: "itsIssei", url: "https://github.com/itsIssei" };

// Open source projects OnPresence is built on.
const CREDITS: { name: string; url: string; what: string }[] = [
  { name: "Lanyard", url: "https://github.com/Phineas/lanyard", what: "Live Discord presence" },
  { name: "shadcn/ui", url: "https://ui.shadcn.com", what: "Dashboard components" },
  { name: "Radix UI", url: "https://www.radix-ui.com", what: "Accessible primitives" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com", what: "Styling" },
  { name: "Preact", url: "https://preactjs.com", what: "Small public page runtime" },
  { name: "Lucide", url: "https://lucide.dev", what: "Icons" },
  { name: "Simple Icons", url: "https://simpleicons.org", what: "Brand icons" },
  { name: "Fontsource", url: "https://fontsource.org", what: "Self-hosted fonts" },
  { name: "modernc.org/sqlite", url: "https://gitlab.com/cznic/sqlite", what: "Pure Go SQLite" },
  { name: "uqr", url: "https://github.com/unjs/uqr", what: "QR codes for 2FA" },
];

export function AboutPage() {
  const about = useQuery({ queryKey: ["admin", "about"], queryFn: api.about });
  return (
    <>
      <PageHeader title="About" description="OnPresence: your online presence and showcase, self-hosted." />
      <div className="grid gap-5">
        <Section>
          <div className="flex flex-wrap items-center gap-4">
            <img src="/img/brand/icon.svg" alt="" className="size-14" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-bold">OnPresence</p>
              <p className="text-sm text-muted-foreground">
                Version <span className="font-mono">{about.data?.version ?? "…"}</span> · MIT license
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <a href={REPO} target="_blank" rel="noopener">
                  <BrandIcon icon={siGithub} className="size-4" /> Source code
                </a>
              </Button>
              <Button asChild variant="secondary">
                <a href={`${REPO}/releases`} target="_blank" rel="noopener">
                  Releases <ExternalLink className="size-4" />
                </a>
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Made by">
          <a href={AUTHOR.url} target="_blank" rel="noopener" className="flex items-center gap-3 rounded-xl border p-3 transition hover:bg-accent/40">
            <BrandIcon icon={siGithub} className="size-5" />
            <span className="flex-1 font-medium">{AUTHOR.name}</span>
            <ExternalLink className="size-4 text-muted-foreground" />
          </a>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Heart className="size-4 text-rose-400" /> Enjoying it? Star the repository or keep “made with OnPresence” on in Appearance.
          </p>
        </Section>

        <Section title="Built with" description="Thanks to these open source projects.">
          <ul className="grid gap-1 sm:grid-cols-2">
            {CREDITS.map((c) => (
              <li key={c.name}>
                <a href={c.url} target="_blank" rel="noopener" className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/40">
                  <span className="font-medium">{c.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{c.what}</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Discord, Spotify, Steam, Last.fm and AniList are trademarks of their owners. OnPresence is not affiliated with them.
          </p>
        </Section>
      </div>
    </>
  );
}
