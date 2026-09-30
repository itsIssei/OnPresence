import { useMemo, useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type CollectionName, type CollectionTypes } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ColorInput, DeleteButton, Field, MediaInput } from "./kit";
import { Choice } from "./pages/AppearancePage";

type Item<C extends CollectionName> = CollectionTypes[C];

export type FieldDef<T> = {
  key: keyof T & string;
  label: string;
  hint?: string;
  wide?: boolean;
} & (
  | { type: "text" | "textarea" | "number" | "switch" | "image" | "audio" | "color"; maxLength?: number }
  | { type: "select"; options: Record<string, string> }
  | { type: "custom"; render: (value: T, set: (patch: Partial<T>) => void) => React.ReactNode }
);

interface Props<C extends CollectionName> {
  collection: C;
  noun: string;
  fields: FieldDef<Item<C>>[];
  defaults: Partial<Item<C>>;
  row: (item: Item<C>) => { title: string; subtitle?: string; image?: string; meta?: React.ReactNode; muted?: boolean };
  /** Optional filter applied to the list (e.g. media type). */
  filter?: (item: Item<C>) => boolean;
  /** Import helper rendered at the top of the create dialog. */
  importer?: (apply: (patch: Partial<Item<C>>) => void) => React.ReactNode;
  sortable?: boolean;
  empty?: string;
}

export function CollectionManager<C extends CollectionName>({ collection, noun, fields, defaults, row, filter, importer, sortable = true, empty }: Props<C>) {
  const qc = useQueryClient();
  const key = ["admin", collection];
  const q = useQuery({ queryKey: key, queryFn: () => api.list(collection) });
  const [editing, setEditing] = useState<Partial<Item<C>> | null>(null);
  const [editKey, setEditKey] = useState(0);
  const openEditor = (item: Partial<Item<C>>) => {
    setEditKey((k) => k + 1);
    setEditing(item);
  };
  const [search, setSearch] = useState("");

  const all = q.data ?? [];
  const list = useMemo(() => {
    const base = filter ? all.filter(filter) : all;
    const s = search.trim().toLowerCase();
    // Display in sort order so drag-and-drop matches what is saved.
    const sorted = [...base].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    return s ? sorted.filter((i) => row(i).title.toLowerCase().includes(s)) : sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filter, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["profile"] });
    qc.invalidateQueries({ queryKey: ["vault"] });
  };

  const del = useMutation({
    mutationFn: (id: number) => api.remove(collection, id),
    onSuccess: () => {
      invalidate();
      toast.success(`${noun} deleted`);
    },
    onError: (e) => toast.error(e.message),
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.reorder(collection, ids),
    onMutate: (ids) => {
      const prev = qc.getQueryData<Item<C>[]>(key);
      qc.setQueryData<Item<C>[]>(key, (old) => old?.map((i) => ({ ...i, sort_order: ids.indexOf(i.id) === -1 ? i.sort_order : ids.indexOf(i.id) })));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(key, ctx?.prev);
      toast.error(e.message);
    },
    onSettled: invalidate,
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = list.map((i) => i.id);
    const next = arrayMove(ids, ids.indexOf(Number(e.active.id)), ids.indexOf(Number(e.over.id)));
    reorder.mutate(next);
  };

  const canDrag = sortable && !search;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${noun.toLowerCase()}s…`} className="pl-9" />
        </div>
        <Button onClick={() => openEditor({ ...defaults, sort_order: list.length } as Partial<Item<C>>)}>
          <Plus className="size-4" /> Add {noun.toLowerCase()}
        </Button>
      </div>

      {q.isLoading && <div className="h-24 animate-pulse rounded-xl bg-muted/50" />}
      {q.isSuccess && list.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{search ? "No matches." : empty ?? `No ${noun.toLowerCase()}s yet.`}</div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={list.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="grid gap-2">
            {list.map((item) => (
              <Row key={item.id} id={item.id} draggable={canDrag} view={row(item)} onEdit={() => openEditor(item)} onDelete={() => del.mutate(item.id)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <EditDialog
        key={editKey}
        collection={collection}
        noun={noun}
        fields={fields}
        value={editing}
        importer={importer}
        onClose={() => setEditing(null)}
        onSaved={() => {
          invalidate();
          setEditing(null);
        }}
      />
    </div>
  );
}

function Row({ id, draggable, view, onEdit, onDelete }: { id: number; draggable: boolean; view: ReturnType<Props<CollectionName>["row"]>; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !draggable });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-3 rounded-xl border bg-card/70 p-2.5", isDragging && "z-10 opacity-80 shadow-2xl", view.muted && "opacity-60")}
    >
      {draggable && (
        <button type="button" className="cursor-grab touch-none text-muted-foreground hover:text-foreground" aria-label="Drag to reorder" {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
      )}
      {view.image !== undefined && (
        <div className="size-11 flex-none overflow-hidden rounded-lg bg-muted">{view.image && <img src={view.image} alt="" className="size-full object-cover" loading="lazy" />}</div>
      )}
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium">{view.title}</p>
        {view.subtitle && <p className="truncate text-xs text-muted-foreground">{view.subtitle}</p>}
      </button>
      {view.meta && <div className="hidden items-center gap-1.5 sm:flex">{view.meta}</div>}
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit">
        <Pencil className="size-4" />
      </Button>
      <DeleteButton onConfirm={onDelete} />
    </li>
  );
}

function EditDialog<C extends CollectionName>({
  collection,
  noun,
  fields,
  value,
  importer,
  onClose,
  onSaved,
}: {
  collection: C;
  noun: string;
  fields: FieldDef<Item<C>>[];
  value: Partial<Item<C>> | null;
  importer?: Props<C>["importer"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Item<C>>>(() => value ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => api.save(collection, form as Item<C>),
    onSuccess: () => {
      toast.success(`${noun} saved`);
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      toast.error(e.message);
    },
  });

  const set = (patch: Partial<Item<C>>) => setForm((f) => ({ ...f, ...patch }));
  const isNew = !value?.id;

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Add" : "Edit"} {noun.toLowerCase()}
          </DialogTitle>
          <DialogDescription>{importer ? "Pull details from a service, then adjust. Changes are saved when you press Save." : "Changes are saved when you press Save."}</DialogDescription>
        </DialogHeader>
        {importer?.(set)}
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {fields.map((f) => (
            <FieldInput key={f.key} def={f} form={form as Item<C>} set={set} error={errors[f.key]} />
          ))}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldInput<T>({ def, form, set, error }: { def: FieldDef<T>; form: T; set: (p: Partial<T>) => void; error?: string }) {
  const v = form[def.key] as unknown;
  const wide = def.wide || def.type === "textarea" || def.type === "image" || def.type === "audio" || def.type === "custom";
  const cls = wide ? "sm:col-span-2" : undefined;
  const put = (x: unknown) => set({ [def.key]: x } as Partial<T>);

  if (def.type === "switch") {
    return (
      <label className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3", cls)}>
        <span>
          <span className="block text-sm font-medium">{def.label}</span>
          {def.hint && <span className="block text-xs text-muted-foreground">{def.hint}</span>}
        </span>
        <Switch checked={!!v} onCheckedChange={put} />
      </label>
    );
  }
  if (def.type === "custom") return <div className={cls}>{def.render(form, set)}</div>;

  return (
    <Field label={def.label} hint={def.hint} error={error} className={cls}>
      {(id) => {
        switch (def.type) {
          case "textarea":
            return <Textarea id={id} rows={4} value={(v as string) ?? ""} maxLength={def.maxLength} onChange={(e) => put(e.target.value)} />;
          case "number":
            return <Input id={id} type="number" min={0} value={(v as number) ?? 0} onChange={(e) => put(Number(e.target.value) || 0)} />;
          case "image":
            return <MediaInput id={id} value={(v as string) ?? ""} onChange={put} />;
          case "audio":
            return <MediaInput id={id} kind="audio" value={(v as string) ?? ""} onChange={put} />;
          case "color":
            return <ColorInput id={id} value={(v as string) ?? ""} onChange={put} />;
          case "select":
            return <Choice id={id} value={(v as string) ?? Object.keys(def.options)[0]} onChange={put} options={def.options} />;
          default:
            return <Input id={id} value={(v as string) ?? ""} maxLength={"maxLength" in def ? def.maxLength : undefined} onChange={(e) => put(e.target.value)} />;
        }
      }}
    </Field>
  );
}
