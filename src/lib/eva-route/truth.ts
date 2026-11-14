// SIMULATOR ONLY. The hidden "true" ground conditions of a scenario variant (adapted from
// MarsScout `src/core/truth.js`, 2026-11-14).
//
// The surface patches placed here are SIMULATED (scenario-defined, e.g. a sand-ripple field);
// they are not mapped Mars features. Elsewhere the simulated ground is firm and its slope is the
// DTM-derived slope. Only the rover sensor (`Sensor.observe`) reads this module, and it returns
// just the cells inside its limited range. The planner modules (planner, options, scouting,
// tools) must never import this file; eva-route.test.ts checks that.

import { cellOfLonLat, cellsAlongSegment, cellsWithin, type PlanningGrid } from "./grid";
import { FIRM, SURFACE_BY_NAME, type CellUpdate } from "./knowledge";
import type { ResolvedHazard } from "./scenario";

export type Truth = { readonly surface: Uint8Array; readonly slope: Uint8Array; readonly hazards: readonly ResolvedHazard[] };

/**
 * @param verified mask of the surveyed start areas: surveyed ground is firm in the truth too, so a
 *        patch drawn across it is cut back to its edge.
 */
export function makeTruth(g: PlanningGrid, hazards: readonly ResolvedHazard[], verified: Uint8Array | null = null): Truth {
  const surface = new Uint8Array(g.n).fill(FIRM);
  const slope = new Uint8Array(g.slope); // ground slope = DTM-derived slope unless a patch says otherwise
  for (const s of hazards) {
    const cells = s.kind === "band" ? cellsAlongSegment(g, cellOfLonLat(g, s.from), cellOfLonLat(g, s.to), s.widthM / 2) : cellsWithin(g, cellOfLonLat(g, s.centre), s.radiusM);
    const cls = SURFACE_BY_NAME[s.surface];
    for (const i of cells) {
      if (verified && verified[i]) continue;
      surface[i] = cls;
      if (s.slopeDeg !== undefined) slope[i] = Math.max(slope[i], s.slopeDeg);
    }
  }
  return Object.freeze({ surface, slope, hazards });
}

/** The rover's sensor: the only way information about the hidden truth reaches the planner. */
export class Sensor {
  constructor(
    private readonly g: PlanningGrid,
    readonly truth: Truth,
  ) {}

  /** Simulated observation within rangeM of `center` (no line-of-sight model). */
  observe(center: number, rangeM: number): CellUpdate[] {
    return cellsWithin(this.g, center, rangeM).map((i) => [i, this.truth.surface[i], this.truth.slope[i]] as const);
  }
}
