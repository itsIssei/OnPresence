import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Badge as UIBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { BLOCK_DENSITIES, caseSectionId, type BlockDensity, type BlockLayout, type BlockType, type FixedSectionId, MAX_BLOCK_BODY, MAX_BLOCKS, MAX_RECENT, sectionLayouts, type SectionId, type VaultBlock } from "@/lib/types";
import { Field } from "../kit";
import { hasSection, newBlock, useBlocks } from "../blocks";
import { Choice } from "./AppearancePage";

const SECTION_LABEL: Record<FixedSectionId, string> = { referrals: "Projects & referrals", games: "Games", anime: "Anime", manga: "Manga & manhwa", music: "Music" };
const TYPE_LABEL: Record<BlockType, string> = { section: "Section", text: "Text", stats: "Stats", featured: "Featured", recent: "Recent" };
const DEFAULT_TITLE: Partial<Record<BlockType, string>> = { stats: "(none)", featured: "Featured", recent: "Recently added" };
const LAYOUT_LABEL: Record<string, string> = { auto: "The case's own layout", grid: "Grid", wide: "Wide cards", list: "List" };
const DENSITY_LABEL: Record<BlockDensity, string> = { compact: "Compact (more per row)", normal: "Normal", large: "Large (fewer per row)" };

/**
 * The page layout of the vault: a list of blocks, top to bottom. The sticky
 * top bar (title, search, section chips) is not a block.
 */
export function BlockEditor() {
  const { blocks, setBlocks } = useBlocks();
  const casesQuery = useQuery({ queryKey: ["admin", "cases"], queryFn: () => api.list("cases") });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const cases = casesQuery.data ?? [];
  const caseName = new Map(cases.map((c) => [`case:${c.id}`, c.name]));
  const sectionName = (id: SectionId) => SECTION_LABEL[id as FixedSectionId] ?? caseName.get(id) ?? (caseSectionId(id) !== null && casesQuery.isSuccess ? "Missing case" : id);

  const unused: SectionId[] = [
    ...(Object.keys(SECTION_LABEL) as SectionId[]),
    ...cases.map((c) => `case:${c.id}` as SectionId),
  ].filter((id) => !hasSection(blocks, id));
  const full = blocks.length >= MAX_BLOCKS;

  const ids = blocks.map((_, i) => String(i));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length) return;
    setBlocks(arrayMove(blocks, from, to));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(Number(e.active.id), Number(e.over.id));
  };
  const patch = (i: number, p: Partial<VaultBlock>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...p } : b)));

  return (
    <div className="grid gap-4">
      {blocks.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">The page is empty. Add a block below.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="grid gap-3">
            {blocks.map((b, i) => (
              <BlockRow
                key={i}
                id={String(i)}
                block={b}
                name={b.type === "section" ? sectionName(b.section as SectionId) : TYPE_LABEL[b.type]}
                first={i === 0}
                last={i === blocks.length - 1}
                onUp={() => move(i, i - 1)}
                onDown={() => move(i, i + 1)}
                onRemove={() => setBlocks(blocks.filter((_, j) => j !== i))}
                onChange={(p) => patch(i, p)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="grid gap-2 rounded-xl border border-dashed p-3">
        <p className="text-sm font-medium">Add a block{full && ` (limit of ${MAX_BLOCKS} reached)`}</p>
        <div className="flex flex-wrap gap-2">
          {(["text", "stats", "featured", "recent"] as const).map((type) => (
            <Button key={type} type="button" size="sm" variant="secondary" disabled={full} onClick={() => setBlocks([...blocks, newBlock(type)])}>
              <Plus className="size-4" /> {TYPE_LABEL[type]}
            </Button>
          ))}
        </div>
        {unused.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Sections:</span>
            {unused.map((id) => (
              <Button key={id} type="button" size="sm" variant="outline" disabled={full} onClick={() => setBlocks([...blocks, newBlock("section", id)])}>
                <Plus className="size-4" /> {sectionName(id)}
              </Button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">A section that has no block is hidden from visitors. Save, then open /vault to see the result.</p>
      </div>
    </div>
  );
}

function BlockRow({
  id,
  block: b,
  name,
  first,
  last,
  onUp,
  onDown,
  onRemove,
  onChange,
}: {
  id: string;
  block: VaultBlock;
  name: string;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  onChange: (p: Partial<VaultBlock>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const section = b.section ?? "";
  const layouts = b.type === "section" ? sectionLayouts(section) : [];
  const layoutOptions = Object.fromEntries(layouts.map((l) => [l || "auto", LAYOUT_LABEL[l || "auto"]]));
  const title = (
    <Field label="Title" hint={b.type === "section" ? "Leave empty for the default name." : b.type === "text" ? undefined : `Leave empty for ${DEFAULT_TITLE[b.type] === "(none)" ? "no heading" : `“${DEFAULT_TITLE[b.type]}”`}.`}>
      {(fid) => <Input id={fid} value={b.title ?? ""} maxLength={120} onChange={(e) => onChange({ title: e.target.value })} />}
    </Field>
  );
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="grid gap-3 rounded-xl border bg-card/70 p-3">
      <div className="flex items-center gap-2">
        <button type="button" className="cursor-grab touch-none text-muted-foreground" aria-label={`Drag ${name}`} {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        {b.type === "section" && caseSectionId(section) !== null && <UIBadge variant="outline">Custom</UIBadge>}
        <UIBadge variant="secondary">{TYPE_LABEL[b.type]}</UIBadge>
        <Button type="button" variant="ghost" size="icon" disabled={first} onClick={onUp} aria-label={`Move ${name} up`}>
          <ArrowUp className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" disabled={last} onClick={onDown} aria-label={`Move ${name} down`}>
          <ArrowDown className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${name}`}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {b.type === "section" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {title}
          {layouts.length > 1 && (
            <Field label="Layout">
              {(fid) => <Choice<string> id={fid} value={b.layout || "auto"} options={layoutOptions} onChange={(v) => onChange({ layout: (v === "auto" ? "" : v) as BlockLayout })} />}
            </Field>
          )}
          {section !== "referrals" && (
            <Field label="Density" hint="How many cards fit in a row.">
              {(fid) => (
                <Choice
                  id={fid}
                  value={b.density ?? "normal"}
                  options={Object.fromEntries(BLOCK_DENSITIES.map((d) => [d, DENSITY_LABEL[d]])) as Record<BlockDensity, string>}
                  onChange={(v) => onChange({ density: v })}
                />
              )}
            </Field>
          )}
        </div>
      )}
      {b.type === "text" && (
        <div className="grid gap-3">
          {title}
          <Field label="Text" hint={`Plain text, line breaks are kept. ${(b.body ?? "").length}/${MAX_BLOCK_BODY}`}>
            {(fid) => <Textarea id={fid} rows={4} value={b.body ?? ""} maxLength={MAX_BLOCK_BODY} onChange={(e) => onChange({ body: e.target.value })} />}
          </Field>
        </div>
      )}
      {(b.type === "stats" || b.type === "featured") && title}
      {b.type === "recent" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {title}
          <Field label="Items" hint={`1 to ${MAX_RECENT}. The newest items of every section.`}>
            {(fid) => <Input id={fid} type="number" min={1} max={MAX_RECENT} value={b.count ?? 8} onChange={(e) => onChange({ count: Math.min(MAX_RECENT, Math.max(1, Number(e.target.value) || 1)) })} />}
          </Field>
        </div>
      )}
    </li>
  );
}
