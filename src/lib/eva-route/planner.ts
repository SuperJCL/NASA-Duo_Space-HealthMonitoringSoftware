// Deterministic route tools (adapted from MarsScout `src/core/planner.js`, 2026-11-14). Inputs:
// the planning grid (real CTX elevations, derived slope) and the OBSERVED map only. This module
// never sees the hidden simulated truth (truth.ts).
//
// Route modes:
//   crew       only observed cells the CREW rules allow (traversal.ts). The only routes a crew may
//              be sent on.
//   candidate  crew rules on observed cells, unobserved cells allowed. Used only to find an
//              unconfirmed shortcut worth scouting; never approvable while it has unobserved cells.
//   rover      only observed cells the ROVER rules allow. Used for the scout rover's own driving.

import { EVA_DEFAULTS, type EvaParams, type Sample } from "./sol-atlas-eva";
import { findPath } from "./pathfind";
import { distM, type PlanningGrid } from "./grid";
import { UNKNOWN, type ObservedMap } from "./knowledge";
import { crewCandidate, crewParams, crewWalkable, roverDrivable, roverParams } from "./traversal";

export type RouteMode = "crew" | "candidate" | "rover";

const MODES: Record<RouteMode, { ok: (g: PlanningGrid, m: ObservedMap, i: number) => boolean; params: (p: EvaParams) => EvaParams }> = {
  crew: { ok: crewWalkable, params: crewParams },
  candidate: { ok: crewCandidate, params: crewParams },
  rover: { ok: roverDrivable, params: roverParams },
};

export type Route = {
  readonly mode: RouteMode;
  readonly cells: readonly number[];
  readonly lengthM: number;
  /** Length over cells nobody has observed (only candidate routes have any). */
  readonly unknownLengthM: number;
  readonly unknownCells: readonly number[];
  /** Index (in `cells`) of the first unobserved cell, or -1. */
  readonly firstUnknown: number;
  readonly mapVersion: number;
};

export function passableFn(g: PlanningGrid, map: ObservedMap, mode: RouteMode, avoid: Uint8Array | null = null) {
  const m = MODES[mode];
  return (i: number) => m.ok(g, map, i) && !(avoid && avoid[i]);
}

/** Route summary: length, and the cells it relies on that nobody has observed yet. */
export function describeRoute(g: PlanningGrid, map: ObservedMap, cells: readonly number[], mode: RouteMode): Route {
  let lengthM = 0;
  let unknownLengthM = 0;
  let firstUnknown = -1;
  const unknownCells: number[] = [];
  for (let k = 0; k < cells.length; k++) {
    if (k) {
      const d = distM(g, cells[k - 1], cells[k]);
      lengthM += d;
      if (map.cells[cells[k]] === UNKNOWN) unknownLengthM += d;
    }
    if (map.cells[cells[k]] === UNKNOWN) {
      unknownCells.push(cells[k]);
      if (firstUnknown < 0) firstUnknown = k;
    }
  }
  return Object.freeze({ mode, cells, lengthM, unknownLengthM, unknownCells, firstUnknown, mapVersion: map.version });
}

export function planRoute(g: PlanningGrid, map: ObservedMap, from: number, to: number, { mode = "crew", avoid = null, params = EVA_DEFAULTS }: { mode?: RouteMode; avoid?: Uint8Array | null; params?: EvaParams } = {}): Route | null {
  const cells = findPath(g, from, to, passableFn(g, map, mode, avoid), MODES[mode].params(params));
  return cells ? describeRoute(g, map, cells, mode) : null;
}

/** Dense {d, e} samples (cumulative metres, elevation) for the upstream EVA budget. */
export function routeSamples(g: PlanningGrid, cells: readonly number[], d0 = 0): Sample[] {
  const out: Sample[] = [];
  let d = d0;
  for (let k = 0; k < cells.length; k++) {
    if (k) d += distM(g, cells[k - 1], cells[k]);
    out.push({ d, e: g.elev[cells[k]] });
  }
  return out;
}

/** True when every cell of the route is observed and crew-walkable on this map. */
export function isCrewConfirmed(g: PlanningGrid, map: ObservedMap, route: Route | null): boolean {
  return !!route && route.cells.every((i) => crewWalkable(g, map, i));
}

/** Reverse a route (same ground, opposite direction). */
export function reversed(g: PlanningGrid, map: ObservedMap, route: Route | null): Route | null {
  return route ? describeRoute(g, map, [...route.cells].reverse(), route.mode) : null;
}
