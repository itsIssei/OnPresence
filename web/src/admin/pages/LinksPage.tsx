import { MousePointerClick } from "lucide-react";
import { Badge as UIBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BADGE_ICONS, BadgeGlyph, BRAND_OPTIONS, LinkGlyph } from "@/lib/icons";
import type { Badge, SocialLink } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CollectionManager, type FieldDef } from "../Collection";
import { Field, PageHeader } from "../kit";

const linkFields: FieldDef<SocialLink>[] = [
  { key: "label", label: "Label", type: "text", maxLength: 60, hint: "Shown as tooltip and for screen readers." },
  {
    key: "url",
    label: "On click",
    type: "custom",
    render: (v, set, errors) => {
      const copy = v.copy_text !== undefined && v.copy_text !== "";
      const mode = copy || v.url === "" ? "copy" : "link";
      return (
        <div className="grid gap-3">
          <Field label="On click">
            {() => (
              <div className="grid grid-cols-2 gap-1 rounded-lg border p-1 text-sm">
                {(
                  [
                    ["link", "Open a link"],
                    ["copy", "Copy text"],
                  ] as const
                ).map(([m, text]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set(m === "link" ? { copy_text: "", url: v.url || "https://" } : { url: "", copy_text: v.copy_text ?? "" })}
                    className={cn("rounded-md px-3 py-1.5 transition", mode === m ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </Field>
          {mode === "link" ? (
            <Field label="URL" hint="https://… or mailto:… Opens in a new tab." error={errors.url}>
              {(id) => <Input id={id} value={v.url ?? ""} onChange={(e) => set({ url: e.target.value })} />}
            </Field>
          ) : (
            <Field label="Text to copy" hint="For example your username. Visitors click the icon to copy it; nothing opens." error={errors.copy_text ?? errors.url}>
              {(id) => <Input id={id} value={v.copy_text ?? ""} maxLength={100} placeholder="@yourname" onChange={(e) => set({ copy_text: e.target.value, url: "" })} />}
            </Field>
          )}
        </div>
      );
    },
  },
  {
    key: "icon",
    label: "Icon",
    type: "custom",
    render: (v, set) => (
      <Field label="Icon" hint="Leave on Auto to detect it from the URL. Pick one yourself for copy-text links.">
        {() => (
          <div className="flex flex-wrap gap-1.5">
            {["", ...BRAND_OPTIONS].map((b) => (
              <button
                key={b || "auto"}
                type="button"
                onClick={() => set({ icon: b, platform: b })}
                title={b || "Auto"}
                className={cn("grid size-10 place-items-center rounded-lg border transition hover:bg-accent", (v.icon ?? "") === b && "border-ring ring-1 ring-ring")}
              >
                {b ? <LinkGlyph icon={b} platform={b} url="" className="size-5" /> : <span className="text-[10px] font-semibold">AUTO</span>}
              </button>
            ))}
          </div>
        )}
      </Field>
    ),
  },
  { key: "is_active", label: "Visible on card", type: "switch" },
];

export function LinksPage() {
  return (
    <>
      <PageHeader title="Links" description="Social icons on your card. Each one opens a link or copies text such as a username. Drag to reorder. Clicks are counted." />
      <CollectionManager
        collection="links"
        noun="Link"
        fields={linkFields}
        defaults={{ label: "", url: "https://", copy_text: "", icon: "", platform: "", is_active: true }}
        row={(l) => ({
          title: l.label,
          subtitle: l.copy_text ? `Copies “${l.copy_text}”` : l.url,
          muted: !l.is_active,
          meta: (
            <>
              <LinkGlyph icon={l.icon} platform={l.platform} url={l.url} className="size-4 text-muted-foreground" />
              <UIBadge variant="secondary" className="gap-1 tabular-nums">
                <MousePointerClick className="size-3" />
                {l.clicks}
              </UIBadge>
            </>
          ),
        })}
      />
    </>
  );
}

const badgeFields: FieldDef<Badge>[] = [
  { key: "title", label: "Label", type: "text", maxLength: 40 },
  { key: "subtitle", label: "Tooltip", type: "text", maxLength: 120, hint: "Shown on hover." },
  { key: "color", label: "Color", type: "color" },
  { key: "category", label: "Category", type: "text", maxLength: 30, hint: "Optional, for your own grouping." },
  {
    key: "icon",
    label: "Icon",
    type: "custom",
    render: (v, set) => (
      <Field label="Icon" hint="Or paste an https:// image URL below.">
        {() => (
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(BADGE_ICONS).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set({ icon: k })}
                  title={k}
                  className={cn("grid size-10 place-items-center rounded-lg border transition hover:bg-accent", v.icon === k && "border-ring ring-1 ring-ring")}
                  style={{ color: v.color || undefined }}
                >
                  <BadgeGlyph icon={k} className="size-5" />
                </button>
              ))}
            </div>
            <input
              value={v.icon?.startsWith("http") || v.icon?.startsWith("/") ? v.icon : ""}
              onChange={(e) => set({ icon: e.target.value })}
              placeholder="https://… (optional image icon)"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
            />
          </div>
        )}
      </Field>
    ),
  },
];

export function BadgesPage() {
  return (
    <>
      <PageHeader title="Badges" description="Pill badges under your name, with tooltips. Drag to reorder." />
      <CollectionManager
        collection="badges"
        noun="Badge"
        fields={badgeFields}
        defaults={{ title: "", subtitle: "", icon: "sparkles", color: "#e11d48", category: "" }}
        row={(b) => ({
          title: b.title,
          subtitle: b.subtitle,
          meta: (
            <span className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase" style={{ color: b.color, borderColor: b.color }}>
              <BadgeGlyph icon={b.icon} className="size-3.5" />
              {b.title}
            </span>
          ),
        })}
      />
    </>
  );
}
