// Planning grid over the verified MAP-3A terrain crop (Trek CTX DTM, 20 m posts; see
// docs/TERRAIN_3D.md). One cell per DTM post. Elevations are the committed DTM values,
// unchanged; slope is DERIVED from them here (central differences on the 20 m posts, rounded
// up to whole degrees). A 20 m DTM smooths out boulders, scarps and anything smaller than a few
// posts, so this slope is a lower bound on what a walker meets: the planner treats it as an
// orbital constraint only, never as a ground observation.
//
// Pure module: no DOM, no three.js, no React. Adapted from MarsScout `src/core/grid.js`
// (2026-11-14), which worked on the Sol Atlas HiRISE tile; MDI uses its own CTX crop instead.

import { gridToLonLat, lonLatToGrid, type LonLat, type TerrainMeta } from "@/lib/terrain/terrain";

export type PlanningGrid = {
  readonly meta: TerrainMeta;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  /** Ground spacing between posts (m): east-west and north-south. */
  readonly cellX: number;
  readonly cellY: number;
  /** Verified DTM heights (m, areoid), row-major north to south; never modified. */
  readonly elev: Float32Array;
  /** Derived orbital slope per post (whole degrees, rounded up). */
  readonly slope: Uint8Array;
};

/** Build the grid from the committed crop metadata and its checksum-verified heights. */
export function buildPlanningGrid(meta: TerrainMeta, heights: Float32Array): PlanningGrid {
  const w = meta.crop.cols;
  const h = meta.crop.rows;
  if (heights.length !== w * h) throw new Error("planning grid: the heights do not match the crop size");
  const cellX = meta.crop.sizeM.eastWest / w;
  const cellY = meta.crop.sizeM.northSouth / h;
  const slope = new Uint8Array(w * h);
  const at = (x: number, y: number) => heights[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Central differences inside the crop, one-sided at its edges.
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(h - 1, y + 1);
      const dzdx = (at(x1, y) - at(x0, y)) / ((x1 - x0) * cellX);
      const dzdy = (at(x, y1) - at(x, y0)) / ((y1 - y0) * cellY);
      slope[y * w + x] = Math.min(90, Math.ceil((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI));
    }
  return Object.freeze({ meta, w, h, n: w * h, cellX, cellY, elev: heights, slope });
}

export const cellXY = (g: PlanningGrid, i: number): [number, number] => [i % g.w, Math.floor(i / g.w)];
export const inside = (g: PlanningGrid, x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h;

/** The post (cell) containing a lon/lat, clamped to the crop. */
export function cellOfLonLat(g: PlanningGrid, p: LonLat): number {
  const { col, row } = lonLatToGrid(g.meta, p);
  const x = Math.min(g.w - 1, Math.max(0, Math.floor(col)));
  const y = Math.min(g.h - 1, Math.max(0, Math.floor(row)));
  return y * g.w + x;
}

/** Lon/lat of a cell's post centre. */
export function lonLatOfCell(g: PlanningGrid, i: number): LonLat {
  const [x, y] = cellXY(g, i);
  return gridToLonLat(g.meta, x + 0.5, y + 0.5);
}

/** Cell centre in metres from the north-west corner of the crop (x east, y south). */
export function cellM(g: PlanningGrid, i: number): { x: number; y: number } {
  const [x, y] = cellXY(g, i);
  return { x: (x + 0.5) * g.cellX, y: (y + 0.5) * g.cellY };
}

/** Lon/lat of a point given in metres from the north-west corner (inverse of cellM). */
export function lonLatOfM(g: PlanningGrid, p: { x: number; y: number }): LonLat {
  return gridToLonLat(g.meta, p.x / g.cellX, p.y / g.cellY);
}

export function distM(g: PlanningGrid, a: number, b: number): number {
  const [ax, ay] = cellXY(g, a);
  const [bx, by] = cellXY(g, b);
  return Math.hypot((ax - bx) * g.cellX, (ay - by) * g.cellY);
}

/** All cells whose centre lies within radiusM of the centre of `center`. */
export function cellsWithin(g: PlanningGrid, center: number, radiusM: number): number[] {
  const [cx, cy] = cellXY(g, center);
  const rx = Math.ceil(radiusM / g.cellX);
  const ry = Math.ceil(radiusM / g.cellY);
  const out: number[] = [];
  for (let y = cy - ry; y <= cy + ry; y++)
    for (let x = cx - rx; x <= cx + rx; x++) {
      if (!inside(g, x, y)) continue;
      if (Math.hypot((x - cx) * g.cellX, (y - cy) * g.cellY) <= radiusM) out.push(y * g.w + x);
    }
  return out;
}

/** Cells whose centre lies within halfWidthM of the segment a→b. */
export function cellsAlongSegment(g: PlanningGrid, a: number, b: number, halfWidthM: number): number[] {
  const A = cellM(g, a);
  const B = cellM(g, b);
  const minX = Math.max(0, Math.floor((Math.min(A.x, B.x) - halfWidthM) / g.cellX));
  const maxX = Math.min(g.w - 1, Math.ceil((Math.max(A.x, B.x) + halfWidthM) / g.cellX));
  const minY = Math.max(0, Math.floor((Math.min(A.y, B.y) - halfWidthM) / g.cellY));
  const maxY = Math.min(g.h - 1, Math.ceil((Math.max(A.y, B.y) + halfWidthM) / g.cellY));
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const L2 = dx * dx + dy * dy || 1;
  const out: number[] = [];
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = (x + 0.5) * g.cellX;
      const py = (y + 0.5) * g.cellY;
      const s = Math.max(0, Math.min(1, ((px - A.x) * dx + (py - A.y) * dy) / L2));
      if (Math.hypot(px - (A.x + s * dx), py - (A.y + s * dy)) <= halfWidthM) out.push(y * g.w + x);
    }
  return out;
}
