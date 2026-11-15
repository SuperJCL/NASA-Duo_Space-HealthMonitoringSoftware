"use client";

import { useEffect, useRef } from "react";
import { lonLatToUv, type LonLat, type TerrainMeta } from "@/lib/terrain/terrain";
import { PATH_COLORS, type RouteOverlay } from "@/lib/eva-route/overlay";

type Target = { id: string; name: string; position: LonLat; role: "primary" | "alternative" | null };

/**
 * 2D plan of the EVA route view (also the fallback when WebGL is unavailable): the CTX
 * orthoimage of the crop, the per-post knowledge tint, routes and points. North up; the crop is
 * drawn in its own grid (posts), so it is slightly stretched east-west (about 5 %).
 */
export function RoutePlanCanvas({ meta, overlay, targets }: { meta: TerrainMeta; overlay: RouteOverlay | null; targets: readonly Target[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const tintRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const size = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b111c";
      ctx.fillRect(0, 0, size, size);
      if (imgRef.current?.complete && imgRef.current.naturalWidth) ctx.drawImage(imgRef.current, 0, 0, size, size);
      // Labels with a dark halo, readable over the tint and the imagery.
      const label = (t: string, x: number, y: number, color: string) => {
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(11,17,28,0.9)";
        ctx.strokeText(t, x, y);
        ctx.fillStyle = color;
        ctx.fillText(t, x, y);
      };
      const px = (p: LonLat): [number, number] => {
        const [u, v] = lonLatToUv(meta, p);
        return [u * size, v * size];
      };
      if (overlay) {
        if (tintRef.current?.key !== overlay.key) {
          const t = document.createElement("canvas");
          t.width = overlay.cols;
          t.height = overlay.rows;
          t.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(overlay.rgba), overlay.cols, overlay.rows), 0, 0);
          tintRef.current = { key: overlay.key, canvas: t };
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tintRef.current.canvas, 0, 0, size, size);
        for (const p of overlay.paths) {
          if (p.points.length < 2) continue;
          ctx.strokeStyle = PATH_COLORS[p.tone];
          ctx.lineWidth = p.tone === "approved" || p.tone === "recommended" ? 3.5 : p.tone === "rover" ? 2 : 2.5;
          ctx.setLineDash(p.dashed ? [7, 6] : []);
          ctx.beginPath();
          p.points.forEach((q, k) => (k ? ctx.lineTo(...px(q)) : ctx.moveTo(...px(q))));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const p of overlay.points) {
          const [x, y] = px(p.position);
          ctx.fillStyle = p.kind === "base" ? "#ffffff" : p.kind === "rover" ? "#ff8a6b" : "#f1c878";
          ctx.beginPath();
          if (p.kind === "rover") ctx.rect(x - 6, y - 6, 12, 12);
          else ctx.arc(x, y, p.kind === "base" ? 7 : 3.5, 0, Math.PI * 2);
          ctx.fill();
          if (p.kind !== "post") label(p.kind === "base" ? "Habitat (sim)" : "Rover (sim)", x + 9, y - 8, ctx.fillStyle as string);
        }
      }
      for (const t of targets) {
        const [x, y] = px(t.position);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = t.role === "primary" ? "#ffffff" : "#ff8a6b";
        ctx.fillRect(-5, -5, 10, 10);
        ctx.restore();
        if (t.role) label(`${t.name} (${t.role})`, x + 9, y + 4, t.role === "primary" ? "#ffffff" : "#ff8a6b");
      }
    };
    if (!imgRef.current) {
      const img = new Image();
      img.onload = draw;
      img.src = meta.imagery.file;
      imgRef.current = img;
    }
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [meta, overlay, targets]);

  return <canvas ref={ref} className="aspect-square w-full max-w-[min(100%,78dvh)] rounded-xl border border-[var(--mg-line)]" role="img" aria-label="2D plan of the simulated EVA route over the CTX orthoimage of the Lefroy Bay crop" data-testid="route-plan-canvas" />;
}
