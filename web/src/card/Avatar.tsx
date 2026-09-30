import { useDecorationUrl } from "@/lib/catalog";
import type { AvatarShape } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_COLOR = {
  online: "#23a55a",
  idle: "#f0b232",
  dnd: "#f23f43",
  offline: "#80848e",
} as const;

export type Status = keyof typeof STATUS_COLOR;

const STATUS_LABEL: Record<Status, string> = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline" };

interface Props {
  src: string;
  decoration: string;
  shape: AvatarShape;
  status?: Status | null;
  size?: number;
  alt: string;
}

/** Avatar with a decoration overlay and presence dot. */
export function Avatar({ src, decoration, shape, status, size = 112, alt }: Props) {
  const decoUrl = useDecorationUrl(decoration);
  const radius = shape === "circle" ? "rounded-full" : shape === "rounded" ? "rounded-[28%]" : "rounded-xl";
  const dot = Math.round(size * 0.24);

  return (
    <div className="avatar-wrap" style={{ width: size, height: size }}>
      <div className={cn("size-full overflow-hidden bg-black/40 ring-4 ring-black/40", radius)}>
        {src ? (
          <img src={src} alt={alt} className="avatar-img" decoding="async" />
        ) : (
          <div className="grid size-full place-items-center bg-brand-soft font-display text-3xl font-bold">{alt.slice(0, 1)}</div>
        )}
      </div>
      {decoUrl && <img src={decoUrl} alt="" aria-hidden className="avatar-decoration" decoding="async" />}
      {status && (
        <span
          role="img"
          aria-label={STATUS_LABEL[status]}
          title={STATUS_LABEL[status]}
          className="absolute z-[3] rounded-full border-[5px] border-[#0c0a10]"
          style={{
            width: dot,
            height: dot,
            right: shape === "circle" ? size * 0.02 : -dot * 0.2,
            bottom: shape === "circle" ? size * 0.02 : -dot * 0.2,
            background: STATUS_COLOR[status],
          }}
        />
      )}
    </div>
  );
}
