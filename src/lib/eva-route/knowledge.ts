// The planner's knowledge: what has actually been observed on the ground (adapted from
// MarsScout `src/core/knowledge.js`, 2026-11-14).
//
// UNKNOWN is NOT safe. Elevation (and the derived orbital slope) is known everywhere from the
// CTX DTM, but the ground surface (firm, loose sand, sand ripples, boulders) is known only where
// the scenario says it was surveyed or where the simulated scout rover observed it. Whether a
// cell is usable is decided separately for the rover and for the crew (traversal.ts).
// The hidden simulated truth lives in truth.ts and is never passed to the planner.

export const UNKNOWN = 0;
export const FIRM = 1;
export const SAND = 2;
export const RIPPLES = 3;
export const BOULDERS = 4;
export type Surface = typeof UNKNOWN | typeof FIRM | typeof SAND | typeof RIPPLES | typeof BOULDERS;

export const SURFACE_NAMES: Readonly<Record<Surface, string>> = Object.freeze({
  [UNKNOWN]: "unobserved",
  [FIRM]: "firm ground",
  [SAND]: "loose sand",
  [RIPPLES]: "sand ripples",
  [BOULDERS]: "boulder field",
});
export const SURFACE_BY_NAME = Object.freeze({ firm: FIRM, sand: SAND, ripples: RIPPLES, boulders: BOULDERS } as const);
export type SurfaceName = keyof typeof SURFACE_BY_NAME;

/** Ground slope not measured by the rover (the orbital slope applies). */
export const NOT_MEASURED = 255;

/**
 * An observed map is an immutable snapshot: every change makes a new map with version + 1.
 * cells: surface class per cell; slope: rover-measured ground slope (deg) or NOT_MEASURED.
 */
export type ObservedMap = { readonly cells: Uint8Array; readonly slope: Uint8Array; readonly version: number };

export function makeMap(n: number, cells = new Uint8Array(n), slope = new Uint8Array(n).fill(NOT_MEASURED), version = 0): ObservedMap {
  return Object.freeze({ cells, slope, version });
}

/** One observed cell: [cell, surface class, slope (deg) or NOT_MEASURED]. */
export type CellUpdate = readonly [number, number, number?];

export function withCells(map: ObservedMap, updates: readonly CellUpdate[]): ObservedMap {
  const cells = new Uint8Array(map.cells);
  const slope = new Uint8Array(map.slope);
  for (const [i, s, g = NOT_MEASURED] of updates) {
    cells[i] = s;
    if (g !== NOT_MEASURED) slope[i] = g;
  }
  return makeMap(cells.length, cells, slope, map.version + 1);
}

export function countStates(map: ObservedMap) {
  const c = [0, 0, 0, 0, 0];
  for (const s of map.cells) c[s]++;
  return { unknown: c[UNKNOWN], firm: c[FIRM], sand: c[SAND], ripples: c[RIPPLES], boulders: c[BOULDERS] };
}
