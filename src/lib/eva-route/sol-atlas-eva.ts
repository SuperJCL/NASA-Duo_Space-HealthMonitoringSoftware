// MODIFIED COPY of Sol Atlas `src/terrain/eva.js` (The SOL Explorers, Apache License 2.0,
// https://github.com/saracen66/the-sol-explorers, commit 9e1b2e0dc9ea8835b1edde0d1af73e551a72b231).
// See NOTICE at the repository root.
//
// Changes made for MDI (2026-11-14):
//   - ported to TypeScript (types added; the equations, constants and defaults are unchanged);
//   - `budget()` no longer returns the per-sample timeline or the average power (unused here);
//   - removed the "ride an unpressurised rover" option (`rover`, `roverMs`) from the parameters and
//     from `budget()`: in MDI the crew always walk; `rideW` is kept (used for suited waiting);
//   - omitted the radiation-dose helper and the daylight checks of `verdict()` (not used by MDI).
//
// Upstream description, kept verbatim:
// Marswalk EVA budget: the "Watney math".
//
// Metabolic rate: Pandolf et al. (1977) load-carriage equation
//   M = 1.5 W + 2.0 (W + L)(L / W)^2 + η (W + L)(1.5 V^2 + 0.35 V G)
// scaled for Mars gravity (0.378 g) on the load/locomotion terms, with a
// pressure-suit penalty on locomotion. Walking speed vs grade: Tobler-style.
// O2 use: 1 L O2 ≈ 20.1 kJ of metabolic energy; 1 L O2 = 1.429 g.
// All assumptions are editable in the planner and listed in the README.
//
// In MDI every value below is a MODEL ASSUMPTION from the upstream planner (not a NASA
// measurement and not a mission rule); the UI labels it as such.

export type EvaParams = {
  /** astronaut body mass (kg) */
  crewKg: number;
  /** suit + life-support backpack + tools (kg) */
  suitKg: number;
  /** science kit carried on top (kg) */
  kitKg: number;
  /** Pandolf terrain factor (1.0 road … 1.2 loose regolith … 1.5+ sand) */
  terrain: number;
  /** pressurised-suit locomotion penalty */
  suitPenalty: number;
  /** Mars surface gravity / Earth */
  gRatio: number;
  /** m/s on flat ground */
  vFlat: number;
  /** usable O2 in the suit (kg) */
  o2CapKg: number;
  /** O2 that must remain at the end of the EVA (%) */
  reservePct: number;
  /** deg: hard limit for walking on foot */
  maxSlope: number;
  /** minutes spent at each science stop */
  stopMin: number;
  /** metabolic rate while working at a stop (W) */
  stopW: number;
  /** suit consumables / crew-fatigue rating (h) */
  evaMaxH: number;
  /** metabolic rate seated on a rover in a suit (W): between rest and light work */
  rideW: number;
};

export const EVA_DEFAULTS: Readonly<EvaParams> = Object.freeze({
  crewKg: 75,
  suitKg: 58,
  kitKg: 0,
  terrain: 1.2,
  suitPenalty: 1.35,
  gRatio: 3.71 / 9.81,
  vFlat: 0.9,
  o2CapKg: 0.6,
  reservePct: 25,
  maxSlope: 20,
  stopMin: 20,
  stopW: 190,
  evaMaxH: 8,
  rideW: 150,
});

const DEG = Math.PI / 180;

export function walkSpeed(gradeRad: number, p: EvaParams = EVA_DEFAULTS): number {
  const v = (p.vFlat * Math.exp(-3.5 * Math.abs(Math.tan(gradeRad) + 0.05))) / Math.exp(-3.5 * 0.05);
  return Math.max(0.12, v);
}

export function metabolicW(v: number, gradePct: number, p: EvaParams = EVA_DEFAULTS): number {
  const W = p.crewKg;
  const L = p.suitKg + (p.kitKg || 0);
  const eta = p.terrain;
  const rest = 1.5 * W;
  const load = 2.0 * (W + L) * (L / W) ** 2;
  const up = Math.max(gradePct, 0);
  const brake = Math.max(-gradePct, 0) * 0.3; // simplified downhill braking cost
  const loco = eta * (W + L) * (1.5 * v * v + 0.35 * v * (up + brake));
  return rest + (load + loco) * p.gRatio * p.suitPenalty;
}

/** J/s ÷ J/L × kg/L */
export const o2KgPerSec = (watts: number) => (watts / 20100) * 1.429e-3;

/** Energy-weighted cost of one step (used by A* so the route minimises O2), in joules. */
export function stepCost(distM: number, dhM: number, p: EvaParams = EVA_DEFAULTS): number {
  const g = Math.atan2(dhM, distM);
  const v = walkSpeed(g, p);
  const t = distM / v;
  return metabolicW(v, (dhM / distM) * 100, p) * t;
}

export type Sample = { d: number; e: number };
export type Budget = {
  distance: number;
  walkT: number;
  stopT: number;
  totalT: number;
  o2: number;
  remaining: number;
  marginPct: number;
  reserveKg: number;
  gain: number;
  loss: number;
  maxSlope: number;
};

/**
 * Budget a walked route.
 * @param samples cumulative distance (m) + elevation (m), dense
 * @param stopAt  cumulative distances where science stops happen
 */
export function budget(samples: readonly Sample[], stopAt: readonly number[], p: EvaParams = EVA_DEFAULTS): Budget {
  let t = 0;
  let o2 = 0;
  let gain = 0;
  let loss = 0;
  let maxSlope = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dd = b.d - a.d;
    if (dd <= 0) continue;
    const dh = b.e - a.e;
    const g = Math.atan2(dh, dd);
    const v = walkSpeed(g, p);
    const dt = dd / v;
    t += dt;
    o2 += o2KgPerSec(metabolicW(v, (dh / dd) * 100, p)) * dt;
    if (dh > 0) gain += dh;
    else loss -= dh;
    maxSlope = Math.max(maxSlope, Math.abs(g) / DEG);
  }
  const walkT = t;
  const stopT = stopAt.length * p.stopMin * 60;
  const stopO2 = stopAt.length * o2KgPerSec(p.stopW) * p.stopMin * 60;
  t += stopT;
  o2 += stopO2;
  const reserveKg = (p.o2CapKg * p.reservePct) / 100;
  const remaining = p.o2CapKg - o2;
  const marginPct = (remaining / p.o2CapKg) * 100;
  return { distance: samples.at(-1)?.d || 0, walkT, stopT, totalT: t, o2, remaining, marginPct, reserveKg, gain, loss, maxSlope };
}

export type Verdict = { lvl: "go" | "caution" | "nogo"; issues: { lvl: "nogo" | "caution"; msg: string }[] };

export function verdict(b: Pick<Budget, "remaining" | "reserveKg" | "marginPct" | "totalT" | "maxSlope">, p: EvaParams = EVA_DEFAULTS): Verdict {
  const issues: Verdict["issues"] = [];
  if (b.remaining < b.reserveKg) issues.push({ lvl: "nogo", msg: `O₂ reserve breached: ${Math.max(0, b.remaining).toFixed(3)} kg left at the airlock, ${b.reserveKg.toFixed(3)} kg required` });
  else if (b.marginPct < p.reservePct + 15) issues.push({ lvl: "caution", msg: `Thin O₂ margin: ${b.marginPct.toFixed(0)} % left at return` });
  if (b.totalT / 3600 > p.evaMaxH) issues.push({ lvl: "nogo", msg: `EVA ${(b.totalT / 3600).toFixed(1)} h exceeds the ${p.evaMaxH} h suit rating` });
  if (b.maxSlope > p.maxSlope) issues.push({ lvl: "nogo", msg: `Route crosses ${b.maxSlope.toFixed(0)}° ground (limit ${p.maxSlope}°)` });
  else if (b.maxSlope > p.maxSlope * 0.75) issues.push({ lvl: "caution", msg: `Steep sections up to ${b.maxSlope.toFixed(0)}°` });
  const lvl = issues.some((i) => i.lvl === "nogo") ? "nogo" : issues.length ? "caution" : "go";
  return { lvl, issues };
}
