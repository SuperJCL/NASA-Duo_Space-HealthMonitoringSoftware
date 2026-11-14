// Deterministic resource budgets (adapted from MarsScout `src/core/budget.js`, 2026-11-14).
//
// Astronaut: the upstream Sol Atlas EVA model (sol-atlas-eva.ts: Pandolf metabolic rate → O2,
// walking speed vs grade, reserve and suit-time verdict) plus WAITING while the rover scouts.
// Rover: a deliberately simple model. Every rover number is a SIMULATED ASSUMPTION (no real
// vehicle is modelled) and is listed in ROVER_DEFAULTS and in the UI.

import { EVA_DEFAULTS, budget, o2KgPerSec, verdict, type EvaParams } from "./sol-atlas-eva";
import type { PlanningGrid } from "./grid";
import { routeSamples, type Route } from "./planner";

export const CREW_ASSUMPTIONS = Object.freeze({
  // Simulated assumption: while the rover scouts, the astronaut waits suited at the airlock, ready
  // to go, so the suit's O2 and the EVA clock both run. Metabolic rate while waiting: the upstream
  // value for "seated in a suit" (eva.js rideW, 150 W).
  waitW: EVA_DEFAULTS.rideW,
  waitSuited: true,
});

export type RoverSpec = {
  speedMs: number;
  whPerKm: number;
  whPerClimbM: number;
  hotelW: number;
  sensorRangeM: number;
  dwellS: number;
  capacityWh: number;
  reservePct: number;
};

/** All SIMULATED ASSUMPTIONS (illustrative scout rover, not a real vehicle). */
export const ROVER_DEFAULTS: Readonly<RoverSpec> = Object.freeze({
  speedMs: 1.5, // driving speed on surveyed ground (5.4 km/h)
  whPerKm: 110, // traction energy on flat ground
  whPerClimbM: 1.5, // extra energy per metre of climb
  hotelW: 60, // avionics + comms, always on
  sensorRangeM: 250, // mast cameras resolve walkability hazards within this range (no line-of-sight model)
  dwellS: 90, // stop time per observation
  capacityWh: 4000,
  reservePct: 20, // battery that must remain on return to base
});

export type Sortie = {
  distanceM: number;
  walkS: number;
  stopS: number;
  waitS: number;
  totalS: number;
  o2Kg: number;
  waitO2Kg: number;
  remainingKg: number;
  reserveKg: number;
  marginPct: number;
  maxSlopeDeg: number;
  verdict: "go" | "caution" | "nogo";
  issues: string[];
};

/**
 * Round trip: base → target (outbound), one science stop at the target, target → base (back),
 * plus waiting before departure. Returns the upstream verdict ('go' | 'caution' | 'nogo').
 */
export function astronautSortie(g: PlanningGrid, outbound: Route, back: Route, { waitS = 0, params = EVA_DEFAULTS }: { waitS?: number; params?: EvaParams } = {}): Sortie {
  const out = routeSamples(g, outbound.cells);
  const ret = routeSamples(g, back.cells, out[out.length - 1].d).slice(1);
  const b = budget([...out, ...ret], [outbound.lengthM], params);
  const waitO2Kg = o2KgPerSec(CREW_ASSUMPTIONS.waitW) * waitS;
  const o2Kg = b.o2 + waitO2Kg;
  const totalS = b.totalT + waitS;
  const remainingKg = params.o2CapKg - o2Kg;
  const marginPct = (remainingKg / params.o2CapKg) * 100;
  const v = verdict({ remaining: remainingKg, reserveKg: b.reserveKg, marginPct, totalT: totalS, maxSlope: b.maxSlope }, params);
  return Object.freeze({
    distanceM: b.distance,
    walkS: b.walkT,
    stopS: b.stopT,
    waitS,
    totalS,
    o2Kg,
    waitO2Kg,
    remainingKg,
    reserveKg: b.reserveKg,
    marginPct,
    maxSlopeDeg: b.maxSlope,
    verdict: v.lvl,
    issues: v.issues.map((i) => i.msg),
  });
}

/** Energy and time to drive along a route, per the rover spec. */
export function roverLeg(g: PlanningGrid, route: Route, spec: RoverSpec = ROVER_DEFAULTS) {
  let climb = 0;
  for (let k = 1; k < route.cells.length; k++) climb += Math.max(0, g.elev[route.cells[k]] - g.elev[route.cells[k - 1]]);
  const driveS = route.lengthM / spec.speedMs;
  const wh = (route.lengthM / 1000) * spec.whPerKm + climb * spec.whPerClimbM + (spec.hotelW * driveS) / 3600;
  return { distanceM: route.lengthM, driveS, wh, climbM: climb };
}

export const dwellWh = (spec: RoverSpec = ROVER_DEFAULTS) => (spec.hotelW * spec.dwellS) / 3600;
export const reserveWh = (spec: RoverSpec = ROVER_DEFAULTS) => (spec.capacityWh * spec.reservePct) / 100;
