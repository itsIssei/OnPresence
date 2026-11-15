import { useDraft } from "./draft";
import { DEFAULT_RECENT, sectionLayouts, type BlockType, type SectionId, type VaultBlock } from "@/lib/types";

/** A new block with the same defaults the server applies. */
export function newBlock(type: BlockType, section?: SectionId): VaultBlock {
  switch (type) {
    case "section":
      return { type, section, layout: sectionLayouts(section ?? "")[0], density: "normal" };
    case "recent":
      return { type, count: DEFAULT_RECENT };
    case "text":
      return { type, title: "", body: "" };
    default:
      return { type };
  }
}

export const hasSection = (blocks: VaultBlock[], id: SectionId) => blocks.some((b) => b.type === "section" && b.section === id);

/** The vault blocks of the draft, and a setter that keeps `sections` in sync. */
export function useBlocks() {
  const { draft, setSetting } = useDraft();
  const blocks = draft?.settings.vault_blocks ?? [];
  const setBlocks = (next: VaultBlock[]) => {
    setSetting("vault_blocks", next);
    setSetting("sections", next.flatMap((b) => (b.type === "section" && b.section ? [b.section] : [])));
  };
  /** Show or hide a section: add its block at the end, or remove it. */
  const setShown = (id: SectionId, on: boolean) => {
    if (on === hasSection(blocks, id)) return;
    setBlocks(on ? [...blocks, newBlock("section", id)] : blocks.filter((b) => !(b.type === "section" && b.section === id)));
  };
  return { draft, blocks, setBlocks, setShown, shown: (id: SectionId) => hasSection(blocks, id) };
}
