// MODIFIED COPY of Sol Atlas `src/terrain/pathfinding.js` (The SOL Explorers, Apache License 2.0,
// https://github.com/saracen66/the-sol-explorers, commit 9e1b2e0dc9ea8835b1edde0d1af73e551a72b231),
// by way of MarsScout `src/core/pathfind.js`. See NOTICE at the repository root.
//
// Changes (MarsScout, 2026-11-14):
//   - cells are tested with a caller-supplied `passable(i)` and impassable cells are HARD no-go
//     (upstream allowed steep cells "as a last resort" with a cost penalty);
//   - steps steeper than params.maxSlope between neighbouring cells are hard no-go;
//   - diagonal steps may not cut between two impassable orthogonal neighbours;
//   - works on a grid of cell indices and returns cell indices.
// Changes (MDI, 2026-11-14): ported to TypeScript; runs on the CTX planning grid (grid.ts).
// Kept from upstream: the binary heap, the 8-neighbour A*, the energy cost (eva.js stepCost, so
// routes minimise metabolic energy, i.e. O2) and the flat-ground heuristic.

import { EVA_DEFAULTS, stepCost, type EvaParams } from "./sol-atlas-eva";
import type { PlanningGrid } from "./grid";

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const { k, v } = this;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const { k, v } = this;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * @param start    start cell index (need not be passable itself)
 * @param goal     goal cell index (must be passable)
 * @returns cell indices from start to goal, or null when no route exists
 */
export function findPath(g: PlanningGrid, start: number, goal: number, passable: (i: number) => boolean, params: EvaParams = EVA_DEFAULTS): number[] | null {
  if (start === goal) return [start];
  if (!passable(goal)) return null;
  const { w, h, elev, cellX, cellY } = g;
  const N = w * h;
  const cost = new Float64Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const bx = goal % w;
  const by = Math.floor(goal / w);
  const maxTan = Math.tan((params.maxSlope * Math.PI) / 180);
  const flatJPerM = stepCost(1, 0, params) * 0.98;
  const heur = (i: number) => Math.hypot(((i % w) - bx) * cellX, (Math.floor(i / w) - by) * cellY) * flatJPerM;
  const heap = new Heap();
  cost[start] = 0;
  heap.push(heur(start), start);
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (closed[ni] || !passable(ni)) continue;
      if (dx && dy && !passable(cy * w + nx) && !passable(ny * w + cx)) continue;
      const dist = Math.hypot(dx * cellX, dy * cellY);
      const dh = elev[ni] - elev[cur];
      if (Math.abs(dh) / dist > maxTan) continue;
      const c = cost[cur] + stepCost(dist, dh, params);
      if (c < cost[ni]) {
        cost[ni] = c;
        from[ni] = cur;
        heap.push(c + heur(ni), ni);
      }
    }
  }
  if (from[goal] === -1) return null;
  const path: number[] = [];
  for (let i = goal; i !== -1; i = from[i]) path.push(i);
  return path.reverse();
}
