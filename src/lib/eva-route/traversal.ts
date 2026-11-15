// Who may use which observed cell (adapted from MarsScout `src/core/traversal.js`, 2026-11-14).
// The rover's observation (surface class + measured slope) is a fact about the simulated ground;
// whether the CREW may walk there is decided by the crew rules below, never by "the rover got
// through".

import { EVA_DEFAULTS, type EvaParams } from "./sol-atlas-eva";
import type { PlanningGrid } from "./grid";
import { BOULDERS, FIRM, NOT_MEASURED, RIPPLES, SAND, UNKNOWN, type ObservedMap } from "./knowledge";

export const CREW_RULES = Object.freeze({
  /** Slope limit from the upstream Sol Atlas EVA model (eva.js maxSlope, 20°): a model assumption. */
  maxSlopeDeg: EVA_DEFAULTS.maxSlope,
  /** Simulated assumption: suited crew walk firm ground and loose sand, not sand ripples or boulder fields. */
  walkable: Object.freeze([FIRM, SAND] as number[]),
});

export const ROVER_RULES = Object.freeze({
  /** Simulated assumptions for an illustrative scout rover (not a real vehicle). */
  maxSlopeDeg: 25,
  drivable: Object.freeze([FIRM, SAND, RIPPLES] as number[]),
});

export const BLOCKING_FOR_CREW: readonly number[] = Object.freeze([RIPPLES, BOULDERS]);

/** Ground slope used for a rule: the larger of the orbital (DTM-derived) slope and the rover-measured slope. */
export const slopeAt = (g: PlanningGrid, map: ObservedMap, i: number) => (map.slope[i] === NOT_MEASURED ? g.slope[i] : Math.max(g.slope[i], map.slope[i]));

export const crewWalkable = (g: PlanningGrid, map: ObservedMap, i: number) => CREW_RULES.walkable.includes(map.cells[i]) && slopeAt(g, map, i) <= CREW_RULES.maxSlopeDeg;
export const roverDrivable = (g: PlanningGrid, map: ObservedMap, i: number) => ROVER_RULES.drivable.includes(map.cells[i]) && slopeAt(g, map, i) <= ROVER_RULES.maxSlopeDeg;
/** Unobserved cells are allowed only for candidate routes (never for an approvable crew route). */
export const crewCandidate = (g: PlanningGrid, map: ObservedMap, i: number) => (map.cells[i] === UNKNOWN ? g.slope[i] <= CREW_RULES.maxSlopeDeg : crewWalkable(g, map, i));

export const crewParams = (params: EvaParams = EVA_DEFAULTS): EvaParams => ({ ...params, maxSlope: CREW_RULES.maxSlopeDeg });
export const roverParams = (params: EvaParams = EVA_DEFAULTS): EvaParams => ({ ...params, maxSlope: ROVER_RULES.maxSlopeDeg });
