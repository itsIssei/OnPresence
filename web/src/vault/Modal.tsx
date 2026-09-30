import { createContext, useContext, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal built on the native <dialog> element: focus trap, Esc to close and
 * top-layer rendering come from the browser. Used on the public page, where
 * Radix Dialog does not work under Preact.
 */
export function Modal({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Click on the backdrop (the dialog element itself, outside the panel) closes.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={cn(
        "vault-modal m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0e0b12]/95 p-0 text-white shadow-2xl backdrop-blur-xl",
        className,
      )}
    >
      {open && (
        <TitleId.Provider value={titleId}>
          <div className="relative">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-black/50 text-white/80 transition hover:bg-black/70 hover:text-white"
            >
              <X className="size-4" />
            </button>
            {children}
          </div>
        </TitleId.Provider>
      )}
    </dialog>
  );
}

const TitleId = createContext("");

export function ModalTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <h3 id={useContext(TitleId)} className={cn("pr-8 font-display font-bold text-white", className)}>
      {children}
    </h3>
  );
}

export function ModalDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-sm", className)}>{children}</p>;
}
