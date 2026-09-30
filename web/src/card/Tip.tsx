import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * CSS-only tooltip. The public page runs on Preact, where Radix tooltips
 * break, and this is lighter anyway. Shows on hover and keyboard focus.
 */
export function Tip({ label, children, className }: { label: string; children: React.ReactElement; className?: string }) {
  const id = useId();
  if (!label) return children;
  return (
    <span className={cn("group/tip relative inline-flex", className)} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[220px] -translate-x-1/2 translate-y-1 rounded-lg bg-black/90 px-2.5 py-1.5 text-center text-xs font-medium normal-case tracking-normal text-white opacity-0 shadow-xl transition duration-150 group-focus-within/tip:translate-y-0 group-focus-within/tip:opacity-100 group-hover/tip:translate-y-0 group-hover/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
