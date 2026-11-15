// Builds a scenario variant (adapted from MarsScout `src/core/world.js`, 2026-11-14): the
// planner's initial observed map (from the surveyed start areas) and, separately, the
// simulator's hidden truth wrapped in a Sensor. Only the Sensor reaches the truth.

import type { LonLat } from "@/lib/terrain/terrain";
import { cellOfLonLat, cellsAlongSegment, cellsWithin, distM, type PlanningGrid } from "./grid";
import { FIRM, makeMap, type ObservedMap } from "./knowledge";
import { makeTruth, Sensor } from "./truth";
import type { ResolvedArea, ResolvedScouting, ResolvedVariant } from "./scenario";

/** Gaps between traverse vertices longer than this are not bridged (never interpolated). */
const MAX_TRAVERSE_SEGMENT_M = 400;
/** A target or start point off surveyed ground is moved to the nearest surveyed cell within this distance. */
const SNAP_M = 200;

export type RouteTarget = { id: string; name: string; position: LonLat };

/** Surveyed start areas → mask. `traverse`: Perseverance's historical traverse lines (lon/lat). */
export function verifiedMask(g: PlanningGrid, areas: readonly ResolvedArea[], traverse: readonly (readonly LonLat[])[]): Uint8Array {
  const mask = new Uint8Array(g.n);
  const [w, s, e, n] = g.meta.crop.bboxDeg;
  const inCrop = ([lon, lat]: LonLat) => lon >= w && lon <= e && lat >= s && lat <= n;
  for (const a of areas) {
    let cells: number[] = [];
    if (a.kind === "disk") cells = cellsWithin(g, cellOfLonLat(g, a.centre), a.radiusM);
    else if (a.kind === "band") cells = cellsAlongSegment(g, cellOfLonLat(g, a.from), cellOfLonLat(g, a.to), a.widthM / 2);
    else
      for (const line of traverse)
        for (let k = 1; k < line.length; k++) {
          if (!inCrop(line[k - 1]) || !inCrop(line[k])) continue;
          const p = cellOfLonLat(g, line[k - 1]);
          const q = cellOfLonLat(g, line[k]);
          if (distM(g, p, q) > MAX_TRAVERSE_SEGMENT_M) continue;
          cells.push(...cellsAlongSegment(g, p, q, a.halfWidthM));
        }
    for (const i of cells) mask[i] = 1;
  }
  return mask;
}

function nearestVerified(g: PlanningGrid, mask: Uint8Array, cell: number, maxM = SNAP_M): number {
  if (mask[cell]) return cell;
  let best = -1;
  let bd = Infinity;
  for (const i of cellsWithin(g, cell, maxM))
    if (mask[i] && distM(g, i, cell) < bd) {
      bd = distM(g, i, cell);
      best = i;
    }
  return best;
}

export type World = {
  map: ObservedMap;
  sensor: Sensor;
  verified: Uint8Array;
  cells: { base: number; targets: Record<string, number>; roverStart: number };
};

/** `sensor` must only be handed to the simulator side (mission.ts rover loop), never to the planner. */
export function buildWorld(g: PlanningGrid, scenario: ResolvedScouting, variant: ResolvedVariant, targets: readonly RouteTarget[], traverse: readonly (readonly LonLat[])[]): World {
  const verified = verifiedMask(g, scenario.knownAreas, traverse);
  const cells = new Uint8Array(g.n);
  for (let i = 0; i < g.n; i++) if (verified[i]) cells[i] = FIRM;
  const map = makeMap(g.n, cells, undefined, 1);
  const truth = makeTruth(g, variant.hazards, verified);
  const snap = (p: LonLat, what: string) => {
    const c = nearestVerified(g, verified, cellOfLonLat(g, p));
    if (c < 0) throw new Error(`EVA scouting scenario ${scenario.id}/${variant.id}: ${what} is not on or near surveyed ground`);
    return c;
  };
  return {
    map,
    sensor: new Sensor(g, truth),
    verified,
    cells: {
      base: snap(scenario.base.position, "the base"),
      targets: Object.fromEntries(targets.map((t) => [t.id, snap(t.position, t.name)])),
      roverStart: snap(variant.rover.start, "the rover start"),
    },
  };
}
