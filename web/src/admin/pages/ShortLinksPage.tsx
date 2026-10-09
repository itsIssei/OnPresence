import { Copy, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import { Badge as UIBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ShortLink } from "@/lib/types";
import { CollectionManager, type FieldDef } from "../Collection";
import { PageHeader } from "../kit";

const host = typeof location === "undefined" ? "" : location.host;

const fields: FieldDef<ShortLink>[] = [
  { key: "slug", label: "Short name", type: "text", maxLength: 32, hint: `${host}/name. Letters, digits, - and _. Leave empty for a random one.` },
  { key: "url", label: "Goes to", type: "text", hint: "https://…" },
  { key: "note", label: "Note", type: "text", maxLength: 120, wide: true, hint: "Only you see this." },
  { key: "is_active", label: "Active", type: "switch", hint: "Switched off, the address shows your card instead." },
];

export function ShortLinksPage() {
  return (
    <>
      <PageHeader title="Short links" description={`Short addresses on your own domain, like ${host}/yt. Visits are counted.`} />
      <CollectionManager
        collection="shortlinks"
        noun="Short link"
        fields={fields}
        defaults={{ slug: "", url: "https://", note: "", is_active: true }}
        row={(l) => ({
          title: `${host}/${l.slug}`,
          subtitle: l.note ? `${l.url} · ${l.note}` : l.url,
          muted: !l.is_active,
          meta: (
            <>
              <UIBadge variant="secondary" className="gap-1 tabular-nums">
                <MousePointerClick className="size-3" />
                {l.clicks}
              </UIBadge>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Copy short link"
                onClick={() => navigator.clipboard.writeText(`${location.origin}/${l.slug}`).then(() => toast.success("Short link copied"))}
              >
                <Copy className="size-3.5" />
              </Button>
            </>
          ),
        })}
      />
    </>
  );
}
