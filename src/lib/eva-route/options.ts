// Deterministic decision options (adapted from MarsScout `src/core/options.js`, 2026-11-14). Every
// number and every feasibility flag shown to the user, or to a future agent through tools.ts,
// comes from here; a chooser can only pick among these options and cannot change them.
//
// Hard safety checks (never traded against value): a departure needs BOTH a safe outbound and a
// safe return crew route on the CURRENT observed map (A*, never a straight line) and an upstream
// EVA verdict that is not 'nogo'. Cancel is always available.
//
// Value (assumptions.ts, simulated demo weights, not science scores): departures get
//   value = targetValue[role] - costPerEvaHour * EVA h - costPerO2Kg * O2 kg,
// and "scout" gets an expected value over "the shortcut turns out walkable" (prior p) and "it
// does not" (then the best fallback after the full wait). The hidden truth is never used.

import { EVA_DEFAULTS, type EvaParams } from "./sol-atlas-eva";
import { planRoute, reversed, type Route } from "./planner";
import { cellsWithin, type PlanningGrid } from "./grid";
import { astronautSortie, ROVER_DEFAULTS, type RoverSpec, type Sortie } from "./budget";
import { DONE_REASONS, estimateScouting, type ScoutEstimate } from "./scouting";
import { DECISION_DEFAULTS, departureValue, type DecisionAssumptions, type TargetRole } from "./assumptions";
import type { ObservedMap } from "./knowledge";

export const OPTION_KINDS = ["scout", "continue", "detour", "known", "switch", "cancel"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

/** A scouted route counts only if at least 5 % shorter than the known route. */
const SHORTER_RATIO = 0.95;
/** Share of a route near the first proposed shortcut for it to count as "the shortcut". */
const SAME_ROUTE_SHARE = 0.6;
const NEAR_M = 50;

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r0 = (x: number) => Math.round(x);

export type Metrics = Record<string, number | string | null>;

function sortieMetrics(s: Sortie): Metrics {
  return {
    walk_km: r2(s.distanceM / 1000),
    eva_h: r2(s.totalS / 3600),
    wait_min: r0(s.waitS / 60),
    o2_used_kg: r3(s.o2Kg),
    o2_left_kg: r3(s.remainingKg),
    o2_margin_pct: r0(s.marginPct),
    verdict: s.verdict,
  };
}

/** What options need from the mission state. No hidden truth. */
export type OptionsInput = {
  version: number;
  phase: "planning" | "scouting" | "decision" | "approved" | "cancelled";
  map: ObservedMap;
  cells: { base: number; targets: Record<string, number> };
  primaryId: string;
  alternativeId: string;
  notVerified: Uint8Array;
  waitS: number;
  rover: { cell: number; batteryWh: number; busy: boolean };
  routes: { initialCandidate: Route | null };
  observations: number;
  params?: EvaParams;
  roverSpec?: RoverSpec;
  assumptions?: DecisionAssumptions;
};

type Departure = { route: Route | null; returnRoute: Route | null; sortie: Sortie | null; violations: string[]; feasible: boolean };

/** Evaluate a departure to `targetCell` along `outbound` (or plan it), with a safe return route. */
export function departure(
  g: PlanningGrid,
  map: ObservedMap,
  { baseCell, targetCell, outbound, waitS, params, avoid = null, returnRoute }: { baseCell: number; targetCell: number; outbound?: Route | null; waitS: number; params: EvaParams; avoid?: Uint8Array | null; returnRoute?: Route | null },
): Departure {
  const out = outbound ?? planRoute(g, map, baseCell, targetCell, { mode: "crew", avoid, params });
  const back = returnRoute ?? planRoute(g, map, targetCell, baseCell, { mode: "crew", avoid, params });
  const violations: string[] = [];
  if (!out) violations.push("No safe outbound crew route on the observed map");
  if (!back) violations.push("No safe return crew route on the observed map: departure cannot be approved");
  let sortie: Sortie | null = null;
  if (out && back) {
    sortie = astronautSortie(g, out, back, { waitS, params });
    if (sortie.verdict === "nogo") violations.push(...sortie.issues);
  }
  return { route: out, returnRoute: back, sortie, violations, feasible: violations.length === 0 };
}

/** Fraction of `route`'s cells within NEAR_M of some cell of `ref`. */
function shareNear(g: PlanningGrid, route: Route | null, ref: Route | null): number {
  if (!route || !ref) return 0;
  const near = new Uint8Array(g.n);
  for (const c of ref.cells) for (const i of cellsWithin(g, c, NEAR_M)) near[i] = 1;
  return route.cells.filter((i) => near[i]).length / route.cells.length;
}

const valueOf = (a: DecisionAssumptions, role: TargetRole, d: Departure) => (d.feasible && d.sortie ? departureValue(a, role, d.sortie) : null);

export type RouteOption = {
  id: OptionKind;
  kind: OptionKind;
  targetId: string | null;
  role: TargetRole | null;
  label: string;
  feasible: boolean;
  violations: string[];
  metrics: Metrics;
  value: number | null;
  route?: Route | null;
  returnRoute?: Route | null;
  sortie?: Sortie | null;
  /** Scout only: the best-case estimate and its unconfirmed shortcut (never drawn as approvable). */
  estimate?: Omit<ScoutEstimate, "shortcut"> & { shortcutLengthM: number | null };
  preview?: Route | null;
  fallback?: { id: "known" | "switch" | "cancel"; targetId: string | null };
};

export type EvaluatedOptions = { stateVersion: number; options: RouteOption[]; recommendedByValue: OptionKind | null };

export function evaluateOptions(g: PlanningGrid, snap: OptionsInput): EvaluatedOptions {
  const params = snap.params ?? EVA_DEFAULTS;
  const spec = snap.roverSpec ?? ROVER_DEFAULTS;
  const a = snap.assumptions ?? DECISION_DEFAULTS;
  const { map, cells, waitS } = snap;
  const base = cells.base;
  const target = cells.targets[snap.primaryId];
  const alt = cells.targets[snap.alternativeId];
  const options: RouteOption[] = [];
  const decided = snap.phase === "approved" || snap.phase === "cancelled";
  const knownTo = (cell: number, wait: number) => departure(g, map, { baseCell: base, targetCell: cell, waitS: wait, params, avoid: snap.notVerified });
  const anyTo = (cell: number, wait: number) => departure(g, map, { baseCell: base, targetCell: cell, waitS: wait, params });

  if (snap.phase === "planning") {
    const violations: string[] = [];
    const est = estimateScouting(g, map, { roverCell: snap.rover.cell, baseCell: base, targetCell: target, batteryWh: snap.rover.batteryWh, spec, params });
    const W = waitS + est.waitS;
    const metrics: Metrics = {
      est_wait_min: r0(est.waitS / 60),
      est_rover_km: r2(est.distanceM / 1000),
      est_rover_kwh: r2(est.wh / 1000),
      est_rover_battery_after_pct: r0((est.batteryAfterWh / spec.capacityWh) * 100),
      est_posts: est.posts,
      p_walkable: a.shortcutWalkableProb,
    };
    if (snap.rover.busy) violations.push("Rover is busy");
    if (est.reason !== "confirmed") violations.push(`Scouting cannot confirm a shortcut even in the best case: ${DONE_REASONS[est.reason].toLowerCase()}`);
    let value: number | null = null;
    let fallback: RouteOption["fallback"];
    if (est.shortcut) {
      // Success branch: the shortcut is walkable; walk it both ways after the wait.
      const ifClear = departure(g, map, { baseCell: base, targetCell: target, outbound: est.shortcut, returnRoute: reversed(g, map, est.shortcut), waitS: W, params });
      // Failure branch: best of the known route, the alternative target, or cancel, all after the full wait.
      const fallbacks = [
        { id: "known" as const, targetId: snap.primaryId, role: "primary" as const, d: knownTo(target, W) },
        { id: "switch" as const, targetId: snap.alternativeId, role: "alternative" as const, d: knownTo(alt, W) },
      ].map((f) => ({ ...f, value: valueOf(a, f.role, f.d) }));
      const best = fallbacks.filter((f) => f.value !== null).sort((x, y) => (y.value ?? 0) - (x.value ?? 0))[0];
      const vClear = ifClear.feasible && ifClear.sortie ? departureValue(a, "primary", ifClear.sortie) : 0;
      const vBlocked = best && (best.value ?? 0) > 0 ? (best.value ?? 0) : 0;
      const roverCost = a.costPerRoverKWh * (est.wh / 1000);
      value = a.shortcutWalkableProb * vClear + (1 - a.shortcutWalkableProb) * vBlocked - roverCost;
      fallback = best && (best.value ?? 0) > 0 ? { id: best.id, targetId: best.targetId } : { id: "cancel", targetId: null };
      const fb = best && (best.value ?? 0) > 0 ? best.d.sortie : null;
      Object.assign(metrics, {
        value_if_clear: r2(vClear),
        if_clear_eva_h: ifClear.sortie ? r2(ifClear.sortie.totalS / 3600) : null,
        if_clear_o2_used_kg: ifClear.sortie ? r3(ifClear.sortie.o2Kg) : null,
        value_if_blocked: r2(vBlocked),
        if_blocked_fallback: fallback.id,
        if_blocked_eva_h: fb ? r2(fb.totalS / 3600) : 0,
        if_blocked_o2_used_kg: fb ? r3(fb.o2Kg) : 0,
        rover_cost_points: r2(roverCost),
        value: r2(value),
      });
    }
    const { shortcut, ...estRest } = est;
    options.push({
      id: "scout",
      kind: "scout",
      targetId: snap.primaryId,
      role: "primary",
      label: "Scout the shortcut first, then decide",
      feasible: violations.length === 0 && !decided,
      violations,
      metrics,
      value,
      estimate: { ...estRest, shortcutLengthM: shortcut ? shortcut.lengthM : null },
      preview: shortcut,
      fallback,
    });
  }

  if (snap.phase !== "scouting") {
    const known = knownTo(target, waitS);
    const best = planRoute(g, map, base, target, { mode: "crew", params });
    const knownLen = known.route ? known.route.lengthM : Infinity;
    const shorter = !!best && best.lengthM < knownLen * SHORTER_RATIO;
    const sameAsShortcut = shareNear(g, best, snap.routes.initialCandidate) >= SAME_ROUTE_SHARE;
    const notYet = (msg: string): Departure => ({ feasible: false, violations: [msg], sortie: null, route: null, returnRoute: null });
    const cont = shorter && sameAsShortcut ? anyTo(target, waitS) : notYet("Shortcut not confirmed: it still crosses unobserved or crew-blocked ground");
    const det = shorter && !sameAsShortcut ? anyTo(target, waitS) : notYet(snap.observations ? "No scouted detour shorter than the known route" : "No obstacle observed: nothing to detour around yet");
    const sw = anyTo(alt, waitS);
    options.push(option("continue", snap.primaryId, "primary", "Continue on the scouted shortcut", cont, decided, a));
    options.push(option("detour", snap.primaryId, "primary", "Detour around the obstacle on scouted ground", det, decided, a));
    options.push(option("known", snap.primaryId, "primary", "Take the known route (surveyed before scouting)", known, decided, a));
    options.push(option("switch", snap.alternativeId, "alternative", "Switch to the alternative target", sw, decided, a));
  }
  options.push({ id: "cancel", kind: "cancel", targetId: null, role: null, label: "Cancel the EVA", feasible: !decided, violations: [], metrics: { value: 0 }, value: 0 });

  const ranked = options.filter((o) => o.feasible && o.value !== null).sort((x, y) => (y.value ?? 0) - (x.value ?? 0) || OPTION_KINDS.indexOf(y.id) - OPTION_KINDS.indexOf(x.id));
  return { stateVersion: snap.version, options, recommendedByValue: ranked[0]?.id ?? null };
}

function option(kind: OptionKind, targetId: string, role: TargetRole, label: string, d: Departure, decided: boolean, a: DecisionAssumptions): RouteOption {
  const value = valueOf(a, role, d);
  return {
    id: kind,
    kind,
    targetId,
    role,
    label,
    feasible: d.feasible && !decided,
    violations: d.violations,
    metrics: d.sortie ? { ...sortieMetrics(d.sortie), ...(value !== null ? { value: r2(value) } : {}) } : {},
    value,
    route: d.route,
    returnRoute: d.returnRoute,
    sortie: d.sortie,
  };
}
