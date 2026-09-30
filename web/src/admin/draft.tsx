import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { AdminProfile, Settings } from "@/lib/types";

interface DraftCtx {
  draft: AdminProfile | null;
  dirty: boolean;
  saving: boolean;
  errors: Record<string, string>;
  set: <K extends keyof AdminProfile>(key: K, value: AdminProfile[K]) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Pending API key changes: undefined = unchanged, "" = clear. */
  steamKey: string | undefined;
  setSteamKey: (v: string | undefined) => void;
  lastfmKey: string | undefined;
  setLastfmKey: (v: string | undefined) => void;
  save: () => Promise<void>;
  discard: () => void;
}

const Ctx = createContext<DraftCtx | null>(null);

/**
 * Holds the editable profile draft shared by the Profile, Appearance and
 * Integrations pages and the live preview. One save model: edit freely,
 * then Save or Discard from the sticky bar.
 */
export function DraftProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "profile"], queryFn: api.adminProfile });
  // Local edits on top of the saved profile; null = no edits.
  const [edits, setEdits] = useState<AdminProfile | null>(null);
  const draft = edits ?? q.data ?? null;
  const [steamKey, setSteamKey] = useState<string | undefined>(undefined);
  const [lastfmKey, setLastfmKey] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dirty = useMemo(
    () => (!!edits && !!q.data && JSON.stringify(edits) !== JSON.stringify(q.data)) || steamKey !== undefined || lastfmKey !== undefined,
    [edits, q.data, steamKey, lastfmKey],
  );

  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  const m = useMutation({
    mutationFn: (p: AdminProfile) =>
      api.saveProfile({
        ...p,
        ...(steamKey !== undefined && { steam_api_key: steamKey }),
        ...(lastfmKey !== undefined && { lastfm_api_key: lastfmKey }),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(["admin", "profile"], saved);
      qc.invalidateQueries({ queryKey: ["profile"] });
      setEdits(null);
      setSteamKey(undefined);
      setLastfmKey(undefined);
      setErrors({});
      qc.invalidateQueries({ queryKey: ["admin", "snapshots"] });
      toast.success("Profile saved");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) {
        setErrors(e.fields);
        toast.error("Fix the highlighted fields", { description: Object.values(e.fields)[0] });
      } else {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    },
  });

  const set = useCallback(<K extends keyof AdminProfile>(key: K, value: AdminProfile[K]) => {
    setEdits((d) => {
      const base = d ?? qc.getQueryData<AdminProfile>(["admin", "profile"]);
      return base ? { ...base, [key]: value } : null;
    });
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key as string];
      return next;
    });
  }, [qc]);

  const setSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setEdits((d) => {
      const base = d ?? qc.getQueryData<AdminProfile>(["admin", "profile"]);
      return base ? { ...base, settings: { ...base.settings, [key]: value } } : null;
    });
  }, [qc]);

  const value: DraftCtx = {
    draft,
    dirty,
    saving: m.isPending,
    errors,
    set,
    setSetting,
    steamKey,
    setSteamKey,
    lastfmKey,
    setLastfmKey,
    save: async () => {
      if (draft) await m.mutateAsync(draft).catch(() => {});
    },
    discard: () => {
      setEdits(null);
      setSteamKey(undefined);
      setLastfmKey(undefined);
      setErrors({});
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDraft() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDraft outside DraftProvider");
  return c;
}
