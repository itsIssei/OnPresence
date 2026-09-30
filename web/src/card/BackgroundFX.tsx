import { useEffect, useRef } from "react";
import type { BackgroundFX as FX } from "@/lib/types";

interface Props {
  fx: FX;
  accent: string;
  /** Fixed full-page canvas (site) or absolute inside a parent (admin preview). */
  contained?: boolean;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Ambient background: rising embers, lightning arcs and a slow magic circle.
 * Performance budget: DPR capped at 1.5, ~30 fps on small screens, pauses when
 * the tab is hidden, and a static frame under prefers-reduced-motion.
 */
export function BackgroundFX({ fx, accent, contained }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const embers = fx === "embers" || fx === "all";
  const lightning = fx === "lightning" || fx === "all";
  const circle = fx === "magic-circle" || fx === "all";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (!embers && !lightning)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = reducedMotion();
    const small = window.innerWidth < 640;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;

    const resize = () => {
      const rect = contained ? canvas.parentElement!.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(contained ? canvas.parentElement! : document.documentElement);

    // Pre-rendered glow sprite: much cheaper than shadowBlur per particle.
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 32;
    const sctx = sprite.getContext("2d")!;
    const grad = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.25, accent);
    grad.addColorStop(1, "transparent");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 32, 32);

    type Ember = { x: number; y: number; r: number; vy: number; vx: number; a: number };
    const newEmber = (anywhere: boolean): Ember => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + Math.random() * 40,
      r: Math.random() * 3 + 2,
      vy: Math.random() * 0.8 + 0.3,
      vx: (Math.random() - 0.5) * 0.5,
      a: Math.random() * 0.6 + 0.3,
    });
    const count = embers ? (reduce ? 12 : small ? 22 : 40) : 0;
    const particles: Ember[] = Array.from({ length: count }, () => newEmber(true));

    type Seg = [number, number, number, number];
    type Bolt = { segs: Seg[]; life: number; max: number; width: number };
    const bolts: Bolt[] = [];
    const makeBolt = (): Bolt => {
      const segs: Seg[] = [];
      const path = (x1: number, y1: number, x2: number, y2: number, n: number) => {
        let cx = x1;
        let cy = y1;
        for (let i = 0; i < n; i++) {
          const nx = cx + (x2 - x1) / n + (Math.random() - 0.5) * 55;
          const ny = cy + (y2 - y1) / n + (Math.random() - 0.5) * 25;
          segs.push([cx, cy, nx, ny]);
          cx = nx;
          cy = ny;
        }
      };
      const x1 = Math.random() * w;
      const y1 = Math.random() * h * 0.35;
      path(x1, y1, x1 + (Math.random() - 0.5) * 360, y1 + Math.random() * 380 + 140, 8);
      if (Math.random() > 0.4) {
        const [, , bx, by] = segs[4];
        path(bx, by, bx + (Math.random() - 0.5) * 180, by + Math.random() * 140 + 40, 4);
      }
      return { segs, life: 18, max: 18, width: Math.random() * 2.5 + 2.5 };
    };
    const strokeBolt = (b: Bolt) => {
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of b.segs) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    };

    let raf = 0;
    let last = 0;
    const frameMs = small ? 1000 / 30 : 0;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < frameMs) return;
      last = t;
      ctx.clearRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        if (!reduce) {
          p.y -= p.vy;
          p.x += p.vx + Math.sin(p.y * 0.01) * 0.3;
          p.a -= 0.0015;
          if (p.y < -20 || p.a <= 0) Object.assign(p, newEmber(false));
        }
        ctx.globalAlpha = Math.max(0, p.a);
        const s = p.r * 4;
        ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalCompositeOperation = "source-over";

      if (lightning && !reduce) {
        if (Math.random() < 0.02 && bolts.length < 2) bolts.push(makeBolt());
        for (let i = bolts.length - 1; i >= 0; i--) {
          const b = bolts[i];
          const k = b.life / b.max;
          ctx.lineCap = "round";
          ctx.strokeStyle = accent;
          ctx.globalAlpha = k * 0.35;
          ctx.lineWidth = b.width * 4;
          strokeBolt(b);
          ctx.globalAlpha = k * 0.8;
          ctx.lineWidth = b.width * 1.6;
          strokeBolt(b);
          ctx.strokeStyle = "#ffffff";
          ctx.globalAlpha = k;
          ctx.lineWidth = Math.max(1.2, b.width * 0.45);
          strokeBolt(b);
          if (--b.life <= 0) bolts.splice(i, 1);
        }
      }
      ctx.globalAlpha = 1;
      if (reduce) cancelAnimationFrame(raf); // one static frame
    };

    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [embers, lightning, accent, contained]);

  if (fx === "none") return null;
  const pos = contained ? "absolute" : "fixed";
  return (
    <div aria-hidden className={`pointer-events-none ${pos} inset-0 overflow-hidden`}>
      {circle && (
        <div className="fx-magic-circle magic-circle absolute left-1/2 top-1/2 aspect-square w-[min(120vmin,1100px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.18]" />
      )}
      {(embers || lightning) && <canvas ref={canvasRef} className="absolute inset-0 size-full" />}
    </div>
  );
}
