// Decision assumptions for "is scouting worth it?" (adapted from MarsScout
// `src/core/assumptions.js`, 2026-11-14). ALL VALUES ARE CONFIGURABLE SIMULATION ASSUMPTIONS:
// they are not NASA measurements, not mission rules, not validated, and NOT science scores.
// They never come from, and never feed, the MDI decision engine (src/lib/decision/): the value of
// reaching a target is attached to its ROLE in this route plan (the primary target the user chose,
// or the alternative), not to any target's science.
//
// Transparent scoring, in demo "points":
//   value(departure)   = targetValue[role] - costPerEvaHour * EVA hours - costPerO2Kg * O2 kg
//   value(cancel)      = 0
//   expected(scout)    = p * value(shortcut after the wait)
//                      + (1 - p) * best(value(fallback after the wait), 0)
//                      - costPerRoverKWh * rover kWh
// where p = shortcutWalkableProb, and the fallback (shortcut blocked) is the best of the known
// route to the same target, the alternative target, or cancelling, each AFTER the full wait.
// Safety is never traded in this sum: an option is offered only if its worst case passes the hard
// checks (safe outbound + return route on the observed map, O2 reserve, suit time).

import type { Sortie } from "./budget";

export type TargetRole = "primary" | "alternative";

export type DecisionAssumptions = {
  /** Prior that the unobserved part of a shortcut turns out crew-walkable (never from the hidden truth). */
  shortcutWalkableProb: number;
  /** Demo value of reaching the target in each role (points). */
  targetValue: Readonly<Record<TargetRole, number>>;
  costPerEvaHour: number;
  costPerO2Kg: number;
  costPerRoverKWh: number;
};

export const DECISION_DEFAULTS: Readonly<DecisionAssumptions> = Object.freeze({
  shortcutWalkableProb: 0.6,
  targetValue: Object.freeze({ primary: 10, alternative: 6 }),
  costPerEvaHour: 0.5,
  costPerO2Kg: 16.7, // ≈ 1 point per 10 % of the 0.6 kg usable suit O2
  costPerRoverKWh: 0.1,
});

type Partial2 = Partial<Omit<DecisionAssumptions, "targetValue">> & { targetValue?: Partial<Record<TargetRole, number>> };

export function normaliseAssumptions(a: Partial2 = {}): DecisionAssumptions {
  const d = DECISION_DEFAULTS;
  const num = (v: unknown, dflt: number, lo: number, hi: number) => (v !== undefined && v !== null && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dflt);
  return Object.freeze({
    shortcutWalkableProb: num(a.shortcutWalkableProb, d.shortcutWalkableProb, 0, 1),
    targetValue: Object.freeze({ primary: num(a.targetValue?.primary, d.targetValue.primary, 0, 100), alternative: num(a.targetValue?.alternative, d.targetValue.alternative, 0, 100) }),
    costPerEvaHour: num(a.costPerEvaHour, d.costPerEvaHour, 0, 100),
    costPerO2Kg: num(a.costPerO2Kg, d.costPerO2Kg, 0, 1000),
    costPerRoverKWh: num(a.costPerRoverKWh, d.costPerRoverKWh, 0, 100),
  });
}

export const departureValue = (a: DecisionAssumptions, role: TargetRole, sortie: Sortie) => a.targetValue[role] - a.costPerEvaHour * (sortie.totalS / 3600) - a.costPerO2Kg * sortie.o2Kg;
