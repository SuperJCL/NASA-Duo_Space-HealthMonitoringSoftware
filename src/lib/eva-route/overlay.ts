// Render-neutral overlay for the EVA route view: one RGBA tint per DTM post (what is known about
// the ground) plus route polylines and points in lon/lat. Shared by the 3D terrain viewer and the
// 2D plan canvas. Pure (no DOM). The hidden truth is drawn only when the caller passes it
// explicitly for the simulator view ("Show hidden truth"), and is then labelled.

import type { LonLat } from "@/lib/terrain/terrain";
import { lonLatOfCell, lonLatOfM, type PlanningGrid } from "./grid";
import { FIRM, RIPPLES, BOULDERS, SAND, UNKNOWN, type ObservedMap } from "./knowledge";
import { CREW_RULES } from "./traversal";
import type { Route } from "./planner";
import type { Truth } from "./truth";

export type PathTone = "known" | "candidate" | "recommended" | "approved" | "return" | "rover";
export type RouteOverlayPath = { id: string; tone: PathTone; points: LonLat[]; dashed: boolean };
export type RouteOverlayPoint = { id: string; kind: "base" | "rover" | "post"; position: LonLat; label: string };
export type RouteOverlay = {
  cols: number;
  rows: number;
  /** RGBA per post, rows north to south (alpha 0: no tint). */
  rgba: Uint8ClampedArray;
  /** Changes whenever `rgba` changes (map version + truth flag). */
  key: string;
  paths: RouteOverlayPath[];
  points: RouteOverlayPoint[];
};

/** Colours (also used by the legend). */
export const OVERLAY_COLORS = {
  surveyed: [142, 202, 230], // ground surveyed before the EVA (simulated survey)
  observed: [132, 216, 166], // observed by the rover, walkable for the crew
  crewBlocked: [255, 107, 107], // observed, crew may not walk it (ripples, boulders)
  steep: [60, 60, 60], // DTM-derived slope above the crew limit
  hiddenHazard: [214, 120, 255], // simulator view only
} as const;
export const PATH_COLORS: Record<PathTone, string> = {
  known: "#e8edf3",
  candidate: "#f1c878",
  recommended: "#84d8a6",
  approved: "#84d8a6",
  return: "#84d8a6",
  rover: "#ff8a6b",
};

export function cellTints(g: PlanningGrid, map: ObservedMap, verified: Uint8Array, truth: Truth | null = null): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.n * 4);
  const put = (i: number, c: readonly number[], a: number) => {
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = a;
  };
  for (let i = 0; i < g.n; i++) {
    const s = map.cells[i];
    if (g.slope[i] > CREW_RULES.maxSlopeDeg) put(i, OVERLAY_COLORS.steep, 110);
    else if (s === RIPPLES || s === BOULDERS) put(i, OVERLAY_COLORS.crewBlocked, 150);
    else if ((s === FIRM || s === SAND) && verified[i]) put(i, OVERLAY_COLORS.surveyed, 55);
    else if (s === FIRM || s === SAND) put(i, OVERLAY_COLORS.observed, 70);
    if (truth && s === UNKNOWN && truth.surface[i] !== FIRM) put(i, OVERLAY_COLORS.hiddenHazard, 120);
  }
  return out;
}

const lineOf = (g: PlanningGrid, r: Route | null): LonLat[] => (r ? r.cells.map((c) => lonLatOfCell(g, c)) : []);

export type OverlayInput = {
  grid: PlanningGrid;
  map: ObservedMap;
  verified: Uint8Array;
  truth: Truth | null;
  base: { cell: number; label: string };
  rover: { pos: { x: number; y: number }; track: readonly { x: number; y: number }[] };
  routes: { initialKnown: Route | null; candidate: Route | null; approved: { route: Route; returnRoute: Route } | null };
  /** The option to preview (green only if crew-approvable now). */
  preview: Route | null;
  observationPosts: readonly number[];
};

export function buildOverlay(o: OverlayInput): RouteOverlay {
  const { grid: g } = o;
  const paths: RouteOverlayPath[] = [];
  if (o.routes.approved) {
    paths.push({ id: "approved", tone: "approved", points: lineOf(g, o.routes.approved.route), dashed: false });
    paths.push({ id: "approved-return", tone: "return", points: lineOf(g, o.routes.approved.returnRoute), dashed: true });
  } else {
    if (o.routes.initialKnown) paths.push({ id: "known", tone: "known", points: lineOf(g, o.routes.initialKnown), dashed: false });
    // An unconfirmed candidate is always yellow and dashed: never drawn as an approvable route.
    if (o.routes.candidate && o.routes.candidate.unknownCells.length) paths.push({ id: "candidate", tone: "candidate", points: lineOf(g, o.routes.candidate), dashed: true });
    if (o.preview) paths.push({ id: "preview", tone: "recommended", points: lineOf(g, o.preview), dashed: false });
  }
  if (o.rover.track.length > 1) paths.push({ id: "rover-track", tone: "rover", points: o.rover.track.map((p) => lonLatOfM(g, p)), dashed: false });
  const points: RouteOverlayPoint[] = [
    { id: "route-base", kind: "base", position: lonLatOfCell(g, o.base.cell), label: o.base.label },
    { id: "route-rover", kind: "rover", position: lonLatOfM(g, o.rover.pos), label: "Scout rover" },
    ...o.observationPosts.map((c, k) => ({ id: `route-post-${k}`, kind: "post" as const, position: lonLatOfCell(g, c), label: `Observation ${k + 1}` })),
  ];
  return { cols: g.w, rows: g.h, rgba: cellTints(g, o.map, o.verified, o.truth), key: `${o.map.version}:${o.truth ? "truth" : "plan"}`, paths, points };
}
