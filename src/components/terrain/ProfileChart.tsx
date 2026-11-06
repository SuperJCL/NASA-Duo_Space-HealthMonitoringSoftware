"use client";

import type { Profile } from "@/lib/terrain/terrain";

/** Elevation in metres for display, with a true minus sign. */
export const fmt = (v: number) => `${Math.round(v).toLocaleString("en-US").replace("-", "−")} m`;
const fmtSigned = (v: number) => `${Math.round(v) > 0 ? "+" : ""}${fmt(v)}`;
// Profile chart geometry (SVG viewBox units; uniform scale).
const CH = { w: 320, h: 120, l: 46, r: 8, t: 8, b: 18 };

/** SVG elevation profile (true DTM metres; the chart's vertical axis is stretched to fit and says by how much). */
export function ProfileChart({
  profile,
  fromName,
  toName,
  hover,
  onHover,
  testId = "terrain-profile",
}: {
  profile: Profile;
  fromName: string;
  toName: string;
  hover: number | null;
  onHover: (i: number | null) => void;
  /** Prefix of the test ids (MAP-2 reuses the chart for a selected sequence connection). */
  testId?: string;
}) {
  const pw = CH.w - CH.l - CH.r;
  const ph = CH.h - CH.t - CH.b;
  // At least a 10 m tall chart, so differences under the DTM's ~5 m agreement never fill the chart.
  const MIN_SPAN_M = 10;
  const range = profile.maxM - profile.minM;
  const pad = Math.max(range * 0.08, (MIN_SPAN_M - range) / 2);
  const lo = profile.minM - pad;
  const hi = profile.maxM + pad;
  const x = (d: number) => CH.l + (d / Math.max(profile.lengthM, 1)) * pw;
  const y = (h: number) => CH.t + ((hi - h) / (hi - lo)) * ph;
  const pts = profile.samples.map((p) => `${x(p.distanceM).toFixed(1)},${y(p.elevationM).toFixed(1)}`).join(" ");
  // How much taller the chart draws heights than the same distance along the line.
  const stretch = (profile.lengthM / pw) / ((hi - lo) / ph);
  const n = profile.samples.length;
  const hv = hover !== null ? profile.samples[hover] : undefined;
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * CH.w;
    const t = Math.min(1, Math.max(0, (vx - CH.l) / pw));
    onHover(Math.round(t * (n - 1)));
  };
  const net = profile.netChangeM;
  return (
    <div className="mt-1.5" data-testid={`${testId}-chart`}>
      <svg
        viewBox={`0 0 ${CH.w} ${CH.h}`}
        className="block w-full touch-none rounded bg-[rgba(0,0,0,0.25)] outline-offset-2"
        role="img"
        tabIndex={0}
        aria-label={`Elevation profile from ${fromName} to ${toName}: ${Math.round(profile.lengthM)} m long, from ${fmt(profile.startM)} to ${fmt(profile.endM)}. Use the left and right arrow keys to read elevations along the line.`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
        onBlur={() => onHover(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
          e.preventDefault();
          const stepN = Math.max(1, Math.round(n / 20));
          const cur = hover ?? (e.key === "ArrowLeft" ? n : -1);
          onHover(e.key === "Home" ? 0 : e.key === "End" ? n - 1 : Math.min(n - 1, Math.max(0, cur + (e.key === "ArrowRight" ? stepN : -stepN))));
        }}
        data-testid={`${testId}-svg`}
      >
        <line x1={CH.l} x2={CH.w - CH.r} y1={y(profile.maxM)} y2={y(profile.maxM)} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 3" />
        <line x1={CH.l} x2={CH.w - CH.r} y1={y(profile.minM)} y2={y(profile.minM)} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 3" />
        <polygon points={`${CH.l},${CH.h - CH.b} ${pts} ${CH.w - CH.r},${CH.h - CH.b}`} fill="rgba(255,209,102,0.16)" />
        <polyline points={pts} fill="none" stroke="#ffd166" strokeWidth={1.6} strokeLinejoin="round" />
        <text x={CH.l - 4} y={y(profile.maxM) + 3} textAnchor="end" fontSize={9} fill="currentColor">
          {fmt(profile.maxM)}
        </text>
        <text x={CH.l - 4} y={y(profile.minM) + 3} textAnchor="end" fontSize={9} fill="currentColor">
          {fmt(profile.minM)}
        </text>
        <text x={CH.l} y={CH.h - 5} fontSize={9} fill="currentColor">
          {"0 m"}
        </text>
        <text x={CH.w - CH.r} y={CH.h - 5} textAnchor="end" fontSize={9} fill="currentColor">
          {fmt(profile.lengthM)}
        </text>
        {hv ? (
          <g>
            <line x1={x(hv.distanceM)} x2={x(hv.distanceM)} y1={CH.t} y2={CH.h - CH.b} stroke="#fff" strokeWidth={0.8} />
            <circle cx={x(hv.distanceM)} cy={y(hv.elevationM)} r={3} fill="#fff" />
          </g>
        ) : null}
      </svg>
      <div className="mt-0.5 flex justify-between gap-2 text-[11px]">
        <span className="truncate">{`◀ ${fromName}`}</span>
        <span className="truncate text-right">{`${toName} ▶`}</span>
      </div>
      <p className="mt-1 min-h-4 text-[var(--mg-text)]" aria-live="polite" data-testid={`${testId}-readout`}>
        {hv ? `At ${fmt(hv.distanceM)} along the line: ${fmt(hv.elevationM)} (DTM)` : "Point at the chart or use ←/→: a white dot marks the spot on the terrain."}
      </p>
      <p className="mt-1" data-testid={`${testId}-stats`}>
        {`${fmt(profile.lengthM)} straight line · start ${fmt(profile.startM)} · end ${fmt(profile.endM)} · net ${fmtSigned(net)}${Math.abs(net) < 5 ? " (under 5 m: not meaningful)" : ""} · range ${fmt(profile.minM)} to ${fmt(profile.maxM)} (${Math.round(range)} m${range < 5 ? "; under 5 m: not meaningful" : ""})`}
      </p>
      <p className="mt-0.5 text-[var(--mg-faint)]" data-testid={`${testId}-scale`}>
        {`Chart heights drawn about ${Math.round(stretch)}× taller than distance: slopes look steeper than they are. Numbers are true DTM metres.`}
      </p>
    </div>
  );
}
