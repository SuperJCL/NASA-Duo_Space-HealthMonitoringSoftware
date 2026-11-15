// Scouting logic (adapted from MarsScout `src/core/scouting.js`, 2026-11-14), shared by the live
// rover loop (mission.ts, with the simulated sensor) and by the up-front estimate (with a
// hypothetical "everything unobserved turns out firm"). Reads the observed map only.
//
// One step: plan the crew candidate (shortest crew route that may cross unobserved ground) from
// base to target; drive the rover over ground it may drive (rover rules) to the last observed
// cell before the first unobserved one (the "frontier post"); observe there; repeat. Stop when
// nothing unobserved could still shorten the crew's safe route by enough to matter, or when the
// rover's battery could no longer bring it home with its reserve.

import { EVA_DEFAULTS, type EvaParams } from "./sol-atlas-eva";
import { cellsWithin, type PlanningGrid } from "./grid";
import { FIRM, UNKNOWN, withCells, type CellUpdate, type ObservedMap } from "./knowledge";
import { planRoute, type Route } from "./planner";
import { ROVER_DEFAULTS, dwellWh, reserveWh, roverLeg, type RoverSpec } from "./budget";

export const SCOUT_LIMITS = Object.freeze({
  /** Keep scouting only while a candidate is at least 5 % shorter than the crew's safe route. */
  benefitRatio: 0.95,
  maxPosts: 40,
});

export const DONE_REASONS = Object.freeze({
  confirmed: "A crew route clearly shorter than the known route is now observed and walkable",
  "no-benefit": "No unconfirmed crew route left that is clearly shorter than the known route",
  "no-candidate": "No crew route to the target, even across unobserved ground",
  unreachable: "Rover cannot reach the next observation post over ground it may drive",
  battery: "Rover battery would fall below its reserve before getting home",
  "no-progress": "Observation did not advance the frontier",
  "max-posts": "Observation limit reached",
  aborted: "Scouting stopped by the operator",
} as const);
export type DoneReason = keyof typeof DONE_REASONS;

export type ScoutState = {
  roverCell: number;
  baseCell: number;
  targetCell: number;
  batteryWh: number;
  lastPost?: number;
  baselineM?: number | null;
  spec?: RoverSpec;
  params?: EvaParams;
};

export type ScoutStep =
  | { kind: "drive"; leg: Route; legCost: ReturnType<typeof roverLeg>; post: number; candidate: Route; safe: Route | null }
  | { kind: "done"; reason: DoneReason; candidate: Route | null; safe: Route | null };

/** Last observed cell before the first unobserved cell of a candidate route. */
export function frontierPost(route: Route | null): number {
  if (!route || route.firstUnknown <= 0) return -1;
  return route.cells[route.firstUnknown - 1];
}

/** Decide the rover's next scouting move from what is known now. */
export function nextScoutStep(g: PlanningGrid, map: ObservedMap, s: ScoutState): ScoutStep {
  const { roverCell, baseCell, targetCell, batteryWh, spec = ROVER_DEFAULTS, params = EVA_DEFAULTS } = s;
  const safe = planRoute(g, map, baseCell, targetCell, { mode: "crew", params });
  const candidate = planRoute(g, map, baseCell, targetCell, { mode: "candidate", params });
  const done = (reason: DoneReason): ScoutStep => ({ kind: "done", reason, candidate, safe });
  if (!candidate) return done("no-candidate");
  const worthMore = !safe || candidate.lengthM < safe.lengthM * SCOUT_LIMITS.benefitRatio;
  if (!candidate.unknownCells.length || !worthMore) {
    const improved = !!safe && (!s.baselineM || safe.lengthM < s.baselineM * SCOUT_LIMITS.benefitRatio);
    return done(improved ? "confirmed" : "no-benefit");
  }
  const post = frontierPost(candidate);
  if (post < 0) return done("unreachable");
  if (post === roverCell && s.lastPost === post) return done("no-progress");
  const leg = planRoute(g, map, roverCell, post, { mode: "rover", params });
  const home = planRoute(g, map, post, baseCell, { mode: "rover", params });
  if (!leg || !home) return done("unreachable");
  const legCost = roverLeg(g, leg, spec);
  const needWh = legCost.wh + dwellWh(spec) + roverLeg(g, home, spec).wh + reserveWh(spec);
  if (needWh > batteryWh) return done("battery");
  return { kind: "drive", leg, legCost, post, candidate, safe };
}

/** Cells revealed by an observation at `post`, under the hypothesis that unobserved ground is firm. */
export function hypotheticalReveal(g: PlanningGrid, map: ObservedMap, post: number, spec: RoverSpec = ROVER_DEFAULTS): CellUpdate[] {
  return cellsWithin(g, post, spec.sensorRangeM)
    .filter((i) => map.cells[i] === UNKNOWN)
    .map((i) => [i, FIRM] as const);
}

export type ScoutEstimate = {
  reason: DoneReason;
  posts: number;
  waitS: number;
  distanceM: number;
  wh: number;
  batteryAfterWh: number;
  shortcut: Route | null;
};

/**
 * Estimate a scouting run before it starts, assuming every unobserved cell turns out firm (best
 * case). A prediction from the observed map only; the real run can end differently.
 */
export function estimateScouting(g: PlanningGrid, map: ObservedMap, s0: ScoutState): ScoutEstimate {
  const spec = s0.spec ?? ROVER_DEFAULTS;
  let s = s0;
  if (s.baselineM === undefined) {
    const known = planRoute(g, map, s.baseCell, s.targetCell, { mode: "crew", params: s.params });
    s = { ...s, baselineM: known ? known.lengthM : null };
  }
  let m = map;
  let roverCell = s.roverCell;
  let batteryWh = s.batteryWh;
  let lastPost = -1;
  let waitS = 0;
  let distanceM = 0;
  let wh = 0;
  let posts = 0;
  let step: ScoutStep;
  for (;;) {
    step = nextScoutStep(g, m, { ...s, roverCell, batteryWh, lastPost });
    if (step.kind === "done") break;
    if (posts >= SCOUT_LIMITS.maxPosts) {
      step = { kind: "done", reason: "max-posts", candidate: step.candidate, safe: step.safe };
      break;
    }
    const stepWh = step.legCost.wh + dwellWh(spec);
    waitS += step.legCost.driveS + spec.dwellS;
    distanceM += step.leg.lengthM;
    wh += stepWh;
    batteryWh -= stepWh;
    roverCell = step.post;
    lastPost = step.post;
    posts++;
    m = withCells(m, hypotheticalReveal(g, m, step.post, spec));
  }
  const home = planRoute(g, m, roverCell, s.baseCell, { mode: "rover", params: s.params });
  const homeCost = home ? roverLeg(g, home, spec) : null;
  return {
    reason: step.reason,
    posts,
    waitS,
    distanceM: distanceM + (home ? home.lengthM : 0),
    wh: wh + (homeCost ? homeCost.wh : 0),
    batteryAfterWh: batteryWh - (homeCost ? homeCost.wh : 0),
    shortcut: step.reason === "confirmed" ? step.safe : null,
  };
}
