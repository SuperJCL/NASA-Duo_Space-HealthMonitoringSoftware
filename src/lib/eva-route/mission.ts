// EVA route mission controller: the closed scouting loop (adapted from MarsScout
// `src/core/mission.js`, 2026-11-14).
//
//   planning ──scout──▶ scouting ──(confirmed | no-benefit | battery | …)──▶ decision
//      │                                                                     │
//      └────────────── approve(option) / cancel() ◀──────────────────────────┘
//
// The simulator side (the hidden truth) is reachable only through the private #sensor, used
// when the rover reaches an observation post. Everything the planner, the options, the UI and
// future agents (tools.ts) see comes from snapshot(), which contains no truth.
//
// `version` increases on every decision-relevant change (map update, phase change, approval,
// cancellation, assumption change). Versions are unique across missions on the page, so a late
// result computed for an earlier mission can never match the current state.

import type { LonLat } from "@/lib/terrain/terrain";
import { EVA_DEFAULTS, type EvaParams } from "./sol-atlas-eva";
import { cellM, distM, lonLatOfM, type PlanningGrid } from "./grid";
import { countStates, withCells, type ObservedMap } from "./knowledge";
import { crewWalkable, roverDrivable } from "./traversal";
import { normaliseAssumptions, type DecisionAssumptions } from "./assumptions";
import { planRoute, type Route } from "./planner";
import { ROVER_DEFAULTS, type RoverSpec, type Sortie } from "./budget";
import { DONE_REASONS, nextScoutStep, type DoneReason } from "./scouting";
import { evaluateOptions, type EvaluatedOptions, type Metrics, type OptionKind, type OptionsInput } from "./options";
import { buildWorld, type RouteTarget } from "./world";
import type { Sensor, Truth } from "./truth";
import type { ResolvedScouting } from "./scenario";

let VERSION_SEQ = 0;
const nextVersion = () => ++VERSION_SEQ;

export type Phase = OptionsInput["phase"];

export type MissionEvent = { type: string; version: number; clockS: number; [k: string]: unknown };

export type Observation = { post: number; rangeM: number; newCells: number; crewBlocked: number; roverBlocked: number; clockS: number };

type RoverTask = { kind: "scout"; route: Route; post: number; progressM: number; dwellLeftS: number } | { kind: "return"; route: Route; progressM: number };

export type MissionRoutes = {
  /** Current safe crew route restricted to surveyed ground (updated while scouting). */
  known: Route | null;
  /** The known route at mission start (for the legend and comparisons). */
  initialKnown: Route | null;
  /** The first unconfirmed shortcut (crosses unobserved ground). */
  initialCandidate: Route | null;
  candidate: Route | null;
  previousCandidate: Route | null;
  approved: { option: OptionKind; targetId: string; route: Route; returnRoute: Route; sortie: Sortie } | null;
};

export type MissionInit = {
  grid: PlanningGrid;
  scenario: ResolvedScouting;
  variantId: string;
  targets: readonly RouteTarget[];
  primaryId: string;
  alternativeId: string;
  traverse: readonly (readonly LonLat[])[];
  roverSpec?: RoverSpec;
  params?: EvaParams;
  assumptions?: Partial<DecisionAssumptions>;
};

export class Mission {
  #sensor: Sensor;
  readonly grid: PlanningGrid;
  readonly scenario: ResolvedScouting;
  readonly variantId: string;
  readonly targets: readonly RouteTarget[];
  readonly roverSpec: RoverSpec;
  readonly cells: { base: number; targets: Record<string, number>; roverStart: number };
  readonly verified: Uint8Array;
  readonly notVerified: Uint8Array;
  params: EvaParams;
  assumptions: DecisionAssumptions;
  map: ObservedMap;
  version: number;
  phase: Phase = "planning";
  primaryId: string;
  alternativeId: string;
  clockS = 0;
  waitS = 0;
  baselineM: number | null = null;
  rover: { cell: number; pos: { x: number; y: number }; batteryWh: number; batteryWh0: number; odometerM: number; task: RoverTask | null; track: { x: number; y: number }[]; lastPost: number };
  observations: Observation[] = [];
  events: MissionEvent[] = [];
  outcome: { kind: OptionKind; targetId: string | null; metrics: Metrics } | null = null;
  scoutReason: DoneReason | null = null;
  routes: MissionRoutes;

  constructor({ grid, scenario, variantId, targets, primaryId, alternativeId, traverse, roverSpec = ROVER_DEFAULTS, params = EVA_DEFAULTS, assumptions = {} }: MissionInit) {
    const variant = scenario.variants.find((v) => v.id === variantId);
    if (!variant) throw new Error(`unknown scenario variant ${variantId}`);
    if (primaryId === alternativeId) throw new Error("the primary and alternative targets must differ");
    for (const id of [primaryId, alternativeId]) if (!targets.some((t) => t.id === id)) throw new Error(`unknown target ${id}`);
    const w = buildWorld(grid, scenario, variant, targets, traverse);
    this.#sensor = w.sensor;
    this.grid = grid;
    this.scenario = scenario;
    this.variantId = variantId;
    this.targets = targets;
    this.roverSpec = roverSpec;
    this.params = params;
    this.assumptions = normaliseAssumptions(assumptions);
    this.cells = w.cells;
    this.verified = w.verified;
    this.notVerified = w.verified.map((v) => (v ? 0 : 1));
    this.map = w.map;
    this.version = nextVersion();
    this.primaryId = primaryId;
    this.alternativeId = alternativeId;
    const charge = (roverSpec.capacityWh * variant.rover.chargePct) / 100;
    this.rover = { cell: w.cells.roverStart, pos: cellM(grid, w.cells.roverStart), batteryWh: charge, batteryWh0: charge, odometerM: 0, task: null, track: [cellM(grid, w.cells.roverStart)], lastPost: -1 };
    const target = this.cells.targets[primaryId];
    const known = planRoute(grid, this.map, this.cells.base, target, { mode: "crew", params, avoid: this.notVerified });
    const candidate = planRoute(grid, this.map, this.cells.base, target, { mode: "candidate", params });
    this.routes = { known, initialKnown: known, initialCandidate: candidate, candidate, previousCandidate: null, approved: null };
    this.#emit("mission-start", { variant: variantId, primaryId, alternativeId });
  }

  #emit(type: string, data: Record<string, unknown> = {}) {
    const e: MissionEvent = { type, version: this.version, clockS: Math.round(this.clockS), ...data };
    this.events.push(e);
    return e;
  }

  #bump() {
    this.version = nextVersion();
  }

  /** Everything the planner tools, the UI and future agents may see. No hidden truth. */
  snapshot(): OptionsInput & { mapCounts: ReturnType<typeof countStates>; clockS: number; scoutReason: DoneReason | null; routes: MissionRoutes; roverDetail: { capacityWh: number; odometerM: number; position: LonLat } } {
    return {
      version: this.version,
      phase: this.phase,
      map: this.map,
      mapCounts: countStates(this.map),
      cells: this.cells,
      primaryId: this.primaryId,
      alternativeId: this.alternativeId,
      notVerified: this.notVerified,
      waitS: this.waitS,
      clockS: this.clockS,
      rover: { cell: this.rover.cell, batteryWh: this.rover.batteryWh, busy: !!this.rover.task },
      roverDetail: { capacityWh: this.roverSpec.capacityWh, odometerM: this.rover.odometerM, position: this.roverLonLat() },
      routes: this.routes,
      observations: this.observations.length,
      scoutReason: this.scoutReason,
      roverSpec: this.roverSpec,
      params: this.params,
      assumptions: this.assumptions,
    };
  }

  options(): EvaluatedOptions {
    return evaluateOptions(this.grid, this.snapshot());
  }

  /** The rover's current position (interpolated along its leg). */
  roverLonLat(): LonLat {
    return lonLatOfM(this.grid, this.rover.pos);
  }

  /** Start scouting (only if the deterministic tools say it is feasible). */
  startScouting(): { ok: true } | { ok: false; reason: string } {
    const opt = this.options().options.find((o) => o.id === "scout");
    if (!opt || !opt.feasible) return { ok: false, reason: opt ? opt.violations.join("; ") : "Scouting is not available now" };
    this.phase = "scouting";
    this.baselineM = this.routes.known ? this.routes.known.lengthM : null;
    this.#bump();
    this.#emit("scouting-start", { estimate: opt.metrics });
    this.#planNextLeg();
    return { ok: true };
  }

  #planNextLeg() {
    const step = nextScoutStep(this.grid, this.map, {
      roverCell: this.rover.cell,
      baseCell: this.cells.base,
      targetCell: this.cells.targets[this.primaryId],
      batteryWh: this.rover.batteryWh,
      lastPost: this.rover.lastPost,
      baselineM: this.baselineM,
      spec: this.roverSpec,
      params: this.params,
    });
    if (step.candidate !== this.routes.candidate) {
      this.routes.previousCandidate = this.routes.candidate;
      this.routes.candidate = step.candidate;
    }
    this.routes.known = step.safe;
    if (step.kind === "done") return this.#finishScouting(step.reason);
    this.rover.task = { kind: "scout", route: step.leg, post: step.post, progressM: 0, dwellLeftS: this.roverSpec.dwellS };
    this.#emit("rover-leg", { to: step.post, km: Math.round(step.leg.lengthM) / 1000 });
  }

  #finishScouting(reason: DoneReason) {
    this.scoutReason = reason;
    this.phase = "decision";
    this.#bump();
    this.#emit("scouting-complete", { reason, text: DONE_REASONS[reason] });
    // The rover drives home on drivable ground in the background (the crew clock does not run).
    const home = planRoute(this.grid, this.map, this.rover.cell, this.cells.base, { mode: "rover", params: this.params });
    this.rover.task = home && home.cells.length > 1 ? { kind: "return", route: home, progressM: 0 } : null;
  }

  /** Advance the simulation by dtS seconds. Returns the events emitted. */
  advance(dtS: number): MissionEvent[] {
    const before = this.events.length;
    let left = dtS;
    for (let guard = 0; left > 1e-6 && this.rover.task && guard < 100000; guard++) {
      const used = this.#roverStep(left);
      if (this.phase === "scouting") this.waitS += used;
      this.clockS += used;
      left -= used;
    }
    if (!this.rover.task && this.phase === "scouting") this.#planNextLeg();
    return this.events.slice(before);
  }

  /** Run scouting to its result (the same steps as real time, just without waiting). */
  skipScouting(maxSteps = 5000): MissionEvent[] {
    const before = this.events.length;
    for (let n = 0; n < maxSteps && this.phase === "scouting"; n++) this.advance(600);
    return this.events.slice(before);
  }

  /** Move or dwell for up to dt seconds; returns the time used. */
  #roverStep(dt: number): number {
    const task = this.rover.task!;
    const spec = this.roverSpec;
    const route = task.route;
    const remainingM = route.lengthM - task.progressM;
    if (remainingM > 1e-6) {
      const used = Math.min(dt, remainingM / spec.speedMs);
      const before = this.#pointAt(route, task.progressM);
      task.progressM += used * spec.speedMs;
      const after = this.#pointAt(route, task.progressM);
      const climb = Math.max(0, after.e - before.e);
      const moved = used * spec.speedMs;
      this.rover.batteryWh -= (moved / 1000) * spec.whPerKm + climb * spec.whPerClimbM + (spec.hotelW * used) / 3600;
      this.rover.odometerM += moved;
      this.rover.pos = { x: after.x, y: after.y };
      this.rover.cell = after.cell;
      const last = this.rover.track[this.rover.track.length - 1];
      if (Math.hypot(last.x - after.x, last.y - after.y) > 15) this.rover.track.push({ x: after.x, y: after.y });
      return used;
    }
    if (task.kind === "return") {
      this.rover.cell = route.cells[route.cells.length - 1];
      this.rover.task = null;
      this.#emit("rover-home", { batteryPct: Math.round((this.rover.batteryWh / spec.capacityWh) * 100) });
      return 0;
    }
    // Arrived at the observation post: dwell, then observe.
    if (task.dwellLeftS > 1e-6) {
      const used = Math.min(dt, task.dwellLeftS);
      task.dwellLeftS -= used;
      this.rover.batteryWh -= (spec.hotelW * used) / 3600;
      return used;
    }
    this.#observe(task.post);
    this.rover.lastPost = task.post;
    this.rover.task = null;
    this.#planNextLeg();
    return 0;
  }

  #pointAt(route: Route, d: number) {
    const g = this.grid;
    let acc = 0;
    for (let k = 1; k < route.cells.length; k++) {
      const seg = distM(g, route.cells[k - 1], route.cells[k]);
      if (acc + seg >= d) {
        const f = seg ? (d - acc) / seg : 1;
        const a = cellM(g, route.cells[k - 1]);
        const b = cellM(g, route.cells[k]);
        const ea = g.elev[route.cells[k - 1]];
        const eb = g.elev[route.cells[k]];
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, e: ea + (eb - ea) * f, cell: f < 0.5 ? route.cells[k - 1] : route.cells[k] };
      }
      acc += seg;
    }
    const c = route.cells[route.cells.length - 1];
    return { ...cellM(g, c), e: g.elev[c], cell: c };
  }

  #observe(post: number) {
    const seen = this.#sensor.observe(post, this.roverSpec.sensorRangeM);
    const updates = seen.filter(([i, s, gs]) => this.map.cells[i] !== s || this.map.slope[i] !== gs);
    this.map = withCells(this.map, updates);
    let crewBlocked = 0;
    let roverBlocked = 0;
    for (const [i] of updates) {
      if (!crewWalkable(this.grid, this.map, i)) crewBlocked++;
      if (!roverDrivable(this.grid, this.map, i)) roverBlocked++;
    }
    const obs: Observation = { post, rangeM: this.roverSpec.sensorRangeM, newCells: updates.length, crewBlocked, roverBlocked, clockS: this.clockS };
    this.observations.push(obs);
    this.#bump();
    this.#emit("observation", { ...obs, mapVersion: this.map.version });
  }

  #changeable(): string | null {
    return this.phase === "approved" || this.phase === "cancelled" || this.phase === "scouting" ? "Limits and assumptions can change only while planning or deciding" : null;
  }

  /** Change the EVA time window (upstream eva.js evaMaxH). Allowed before departure; a new state version. */
  setLimits({ evaMaxH }: { evaMaxH: number }): { ok: true } | { ok: false; reason: string } {
    const no = this.#changeable();
    if (no) return { ok: false, reason: no };
    const h = Number(evaMaxH);
    if (!Number.isFinite(h) || h <= 0 || h > 12) return { ok: false, reason: "EVA window must be between 0 and 12 h" };
    this.params = { ...this.params, evaMaxH: h };
    this.#bump();
    this.#emit("limits-changed", { evaMaxH: h });
    return { ok: true };
  }

  /** Change the decision assumptions (assumptions.ts). Allowed before departure; a new state version. */
  setAssumptions(a: Partial<Omit<DecisionAssumptions, "targetValue">> & { targetValue?: Partial<DecisionAssumptions["targetValue"]> }): { ok: true } | { ok: false; reason: string } {
    const no = this.#changeable();
    if (no) return { ok: false, reason: no };
    this.assumptions = normaliseAssumptions({ ...this.assumptions, ...a, targetValue: { ...this.assumptions.targetValue, ...(a.targetValue ?? {}) } });
    this.#bump();
    this.#emit("assumptions-changed", {});
    return { ok: true };
  }

  /**
   * Approve an option. Re-evaluated now: refused unless the option is feasible, which includes a
   * safe outbound AND return route on the current observed map.
   */
  approve(optionId: string): { ok: true } | { ok: false; reason: string } {
    if (this.phase === "scouting") return { ok: false, reason: "Wait for the scouting result first" };
    if (this.phase === "approved" || this.phase === "cancelled") return { ok: false, reason: "The mission is already decided" };
    const opt = this.options().options.find((o) => o.id === optionId);
    if (!opt) return { ok: false, reason: `No option ${optionId}` };
    if (opt.kind === "cancel") return this.cancel();
    if (opt.kind === "scout") return this.startScouting();
    if (!opt.route || !opt.returnRoute || !opt.sortie) return { ok: false, reason: opt.violations.join("; ") || "No safe outbound and return route on the observed map" };
    if (!opt.feasible) return { ok: false, reason: opt.violations.join("; ") };
    this.phase = "approved";
    this.routes.approved = { option: opt.id, targetId: opt.targetId!, route: opt.route, returnRoute: opt.returnRoute, sortie: opt.sortie };
    this.outcome = { kind: opt.kind, targetId: opt.targetId, metrics: opt.metrics };
    this.#bump();
    this.#emit("approved", { option: opt.id, targetId: opt.targetId });
    return { ok: true };
  }

  cancel(): { ok: true } | { ok: false; reason: string } {
    if (this.phase === "approved" || this.phase === "cancelled") return { ok: false, reason: "The mission is already decided" };
    if (this.phase === "scouting") this.#finishScouting("aborted");
    this.phase = "cancelled";
    this.outcome = { kind: "cancel", targetId: null, metrics: {} };
    this.#bump();
    this.#emit("cancelled");
    return { ok: true };
  }

  /** Read-only view of the hidden truth for the simulator panel and for tests, never for the planner or tools. */
  debugTruth(): Truth {
    return this.#sensor.truth;
  }
}
