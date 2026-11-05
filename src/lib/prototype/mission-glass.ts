import { z } from "zod";
import type { Recommendation } from "@/lib/decision/engine";
import type { ProvisionalRanking, ReviewedRanking } from "@/lib/decision/review-modes";
import { RecordId, TaskPlatform, type Scenario } from "@/lib/evidence/schema";
import type { SnapshotEvidence } from "@/lib/evidence/snapshot";
import type { GeoCatalog, LonLat } from "@/lib/geo/schema";
import { MARS_METERS_PER_DEGREE } from "@/lib/map/mars-geodesy";

/**
 * MDI 2.0 "Mission Glass" prototype: shared mission-state contract for the
 * Planning and EVA modes. Pure (no React, no OpenLayers).
 *
 * Integrity boundaries:
 *  - Ranks and feasibility are read from the EXISTING engine output
 *    (rankProvisional / rankReviewed). Nothing here scores tasks. Plan logic
 *    only adds simulated costs and follows the engine order.
 *  - Simulated target positions are scenario-defined offsets from a verified
 *    site. They are kept apart from verified geographic records and are never
 *    written into src/data/geo.
 */

export const MgScenario = z
  .object({
    id: RecordId,
    title: z.string().min(1),
    label: z.string().min(1),
    verifiedAnchorId: RecordId,
    excludedPlatforms: z.array(TaskPlatform),
    actions: z
      .array(z.object({ taskId: RecordId, shortTitle: z.string().min(1), targetId: RecordId, steps: z.array(z.string().min(1)).min(2) }).strict())
      .length(3),
    targets: z.array(z.object({ id: RecordId, name: z.string().min(1), offsetM: z.object({ east: z.number(), north: z.number() }).strict() }).strict()),
    events: z.array(z.object({ id: RecordId, label: z.string().min(1), budget: z.number().nonnegative() }).strict()).min(1),
    warnings: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type MgScenario = z.infer<typeof MgScenario>;

export type SimulatedTarget = {
  id: string;
  name: string;
  taskId: string;
  position: LonLat;
  /** Straight-line distance from the verified anchor site (scenario geometry only). */
  distanceFromAnchorM: number;
  basis: "scenario-defined";
};

export function parseScenario(raw: unknown, scenario: Scenario, geo: GeoCatalog): MgScenario {
  const parsed = MgScenario.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid Mission Glass scenario:\n${z.prettifyError(parsed.error)}`);
  const s = parsed.data;
  const problems: string[] = [];
  const anchor = geo.records.find((r) => r.id === s.verifiedAnchorId);
  if (!anchor || anchor.kind !== "sample-site") problems.push(`anchor ${s.verifiedAnchorId} is not a verified sample site`);
  for (const a of s.actions) {
    const task = scenario.tasks.find((t) => t.id === a.taskId);
    if (!task) problems.push(`unknown task ${a.taskId}`);
    else if (s.excludedPlatforms.includes(task.platform)) problems.push(`${a.taskId} uses an excluded platform`);
    if (!s.targets.some((t) => t.id === a.targetId)) problems.push(`${a.taskId}: unknown target ${a.targetId}`);
  }
  const included = scenario.tasks.filter((t) => !s.excludedPlatforms.includes(t.platform)).map((t) => t.id).sort();
  if (JSON.stringify(included) !== JSON.stringify(s.actions.map((a) => a.taskId).sort())) problems.push("actions must be exactly the tasks on the included platforms");
  if (problems.length) throw new Error(`Mission Glass scenario check failed:\n- ${problems.join("\n- ")}`);
  return s;
}

export function simulatedTargets(s: MgScenario, geo: GeoCatalog): SimulatedTarget[] {
  const anchor = geo.records.find((r) => r.id === s.verifiedAnchorId);
  if (!anchor || anchor.kind !== "sample-site") return [];
  const [lon0, lat0] = anchor.position;
  const kLon = MARS_METERS_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180);
  return s.actions.map((a) => {
    const t = s.targets.find((x) => x.id === a.targetId)!;
    return {
      id: t.id,
      name: t.name,
      taskId: a.taskId,
      position: [lon0 + t.offsetM.east / kLon, lat0 + t.offsetM.north / MARS_METERS_PER_DEGREE],
      distanceFromAnchorM: Math.round(Math.hypot(t.offsetM.east, t.offsetM.north)),
      basis: "scenario-defined",
    };
  });
}

// ── Task views (Level 1 and Level 2), read from engine output ──

export type TaskView = {
  taskId: string;
  shortTitle: string;
  title: string;
  description: string;
  platformText: string;
  instruments: string[];
  rank: number | null;
  /** Level 1: one line, composed from engine-reported facts only. */
  rationale: string;
  status: "fits" | "over-budget" | "unavailable";
  statusText: string;
  cost: number;
  budget: number;
  /** Level 2: conditions that the priority depends on. */
  conditions: string[];
  /** Level 2 and 3: the engine's own explanations, verbatim. */
  engineNotes: { criterion: string; text: string; evaluated: boolean }[];
  pendingRelationships: number;
  targetId: string;
  steps: string[];
  scorePct: number | null;
};

const PLATFORM_TEXT: Record<string, string> = { rover: "Rover", lab: "Earth laboratory (if returned)", orbital: "Orbiter" };
const EVIDENCE_PHRASE: Record<string, string> = {
  rover: "adds close-up rover evidence",
  lab: "adds Earth-lab evidence, if returned",
  orbital: "adds orbital evidence",
};

export function taskViews(args: {
  s: MgScenario;
  snapshot: SnapshotEvidence;
  provisional: ProvisionalRanking;
  reviewed: ReviewedRanking;
  budget: number;
}): TaskView[] {
  const { s, snapshot, provisional, reviewed, budget } = args;
  const rec: Recommendation = provisional.recommendation;
  const openLocal = snapshot.gaps.filter((g) => g.relevance === "local" && g.status.state === "open");
  const views = s.actions.map((a): TaskView => {
    const task = snapshot.tasks.find((t) => t.id === a.taskId)!;
    const cost = task.costs["res-effort"] ?? NaN;
    const ranked = rec.ranking.find((r) => r.taskId === task.id);
    const infeasible = rec.infeasible.find((r) => r.taskId === task.id);
    const evaluation = ranked ?? rec.unranked.find((r) => r.taskId === task.id);
    const covered = task.addresses.filter((l) => openLocal.some((g) => g.id === l.gapId)).length;
    const blocked = reviewed.notAssessed.find((n) => n.taskId === task.id);
    const isTop = ranked?.rank === 1;
    const unavailable = Boolean(infeasible && s.excludedPlatforms.includes(task.platform));
    return {
      taskId: task.id,
      shortTitle: a.shortTitle,
      title: task.title,
      description: task.description,
      platformText: `${PLATFORM_TEXT[task.platform] ?? task.platform} · ${task.instruments.join(", ")}`,
      instruments: task.instruments,
      rank: ranked?.rank ?? null,
      rationale: `Covers ${covered} of ${openLocal.length} open questions · ${EVIDENCE_PHRASE[task.platform] ?? ""} · ${cost} pts`,
      status: unavailable ? "unavailable" : infeasible ? "over-budget" : "fits",
      statusText: infeasible ? `Needs ${cost} pts, budget is ${budget}` : `Fits: ${cost} of ${budget} pts`,
      cost,
      budget,
      conditions: [
        `Only while the simulated budget is at least ${cost} points.`,
        isTop
          ? `Stays #1 in ${rec.stability.topUnchanged} of ${rec.stability.trials} runs with each weight changed by ±${Math.round(rec.stability.perturbation * 100)}%.`
          : "Rank can change if the weights change.",
        `Depends on ${blocked?.blockingReviewIds.length ?? 0} scientific relationship(s) that await expert review.`,
      ],
      engineNotes: (evaluation?.outcomes ?? []).map((o) => ({
        criterion: o.criterionId,
        text: o.status === "evaluated" ? o.explanation : o.reason,
        evaluated: o.status === "evaluated",
      })),
      pendingRelationships: blocked?.blockingReviewIds.length ?? 0,
      targetId: a.targetId,
      steps: a.steps,
      scorePct: ranked ? Math.round(ranked.total * 100) : null,
    };
  });
  return views.sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99));
}

// ── Shared mission state (Planning ↔ EVA) ──

export type PlanItemStatus = "planned" | "active" | "done" | "skipped";
export type PlanItem = { taskId: string; status: PlanItemStatus; step: number };
export type MissionState = {
  mode: "planning" | "eva";
  /** Simulated effort budget (the engine's res-effort constraint). */
  budget: number;
  selectedTaskId: string | null;
  draft: string[];
  plan: { items: PlanItem[]; createdWithBudget: number } | null;
  replan: { reason: string; suggested: string[] } | null;
  log: string[];
};

export type MissionAction =
  | { type: "select"; taskId: string | null }
  | { type: "toggle-draft"; taskId: string }
  | { type: "move-draft"; taskId: string; by: -1 | 1 }
  | { type: "use-suggested"; order: string[] }
  | { type: "set-budget"; budget: number }
  | { type: "create-plan" }
  | { type: "set-mode"; mode: MissionState["mode"] }
  | { type: "start-task" }
  | { type: "complete-step"; stepsByTask: Record<string, number> }
  | { type: "skip-task" }
  | { type: "constraint-event"; budget: number; label: string; rankedTaskIds: string[]; costs: Record<string, number> }
  | { type: "accept-replan" }
  | { type: "keep-plan" }
  | { type: "reset-plan" };

export const initialMissionState = (budget: number): MissionState => ({
  mode: "planning",
  budget,
  selectedTaskId: null,
  draft: [],
  plan: null,
  replan: null,
  log: [],
});

export const remaining = (items: PlanItem[]) => items.filter((i) => i.status === "planned" || i.status === "active");

export function consumedEffort(state: MissionState, costs: Record<string, number>): number {
  return (state.plan?.items ?? []).filter((i) => i.status === "done").reduce((s, i) => s + (costs[i.taskId] ?? 0), 0);
}

/** Engine order first, then drop tasks that do not fit the remaining simulated effort. */
export function fitInOrder(order: string[], costs: Record<string, number>, available: number): string[] {
  const out: string[] = [];
  let left = available;
  for (const id of order) {
    if ((costs[id] ?? Infinity) <= left) {
      out.push(id);
      left -= costs[id];
    }
  }
  return out;
}

export function missionReducer(state: MissionState, action: MissionAction): MissionState {
  switch (action.type) {
    case "select":
      return { ...state, selectedTaskId: action.taskId };
    case "toggle-draft":
      return { ...state, draft: state.draft.includes(action.taskId) ? state.draft.filter((t) => t !== action.taskId) : [...state.draft, action.taskId] };
    case "move-draft": {
      const i = state.draft.indexOf(action.taskId);
      const j = i + action.by;
      if (i < 0 || j < 0 || j >= state.draft.length) return state;
      const draft = [...state.draft];
      [draft[i], draft[j]] = [draft[j], draft[i]];
      return { ...state, draft };
    }
    case "use-suggested":
      return { ...state, draft: action.order };
    case "set-budget":
      return { ...state, budget: action.budget };
    case "create-plan":
      if (!state.draft.length) return state;
      return {
        ...state,
        plan: { items: state.draft.map((taskId) => ({ taskId, status: "planned", step: 0 })), createdWithBudget: state.budget },
        replan: null,
        log: [...state.log, `Plan created with ${state.draft.length} task(s) at ${state.budget} simulated points.`],
      };
    case "set-mode":
      return { ...state, mode: action.mode };
    case "start-task": {
      if (!state.plan) return state;
      const next = state.plan.items.find((i) => i.status === "planned");
      if (!next || state.plan.items.some((i) => i.status === "active")) return state;
      return { ...state, plan: { ...state.plan, items: state.plan.items.map((i) => (i === next ? { ...i, status: "active" } : i)) }, log: [...state.log, `Started: ${next.taskId}`] };
    }
    case "complete-step": {
      if (!state.plan) return state;
      const items = state.plan.items.map((i) => {
        if (i.status !== "active") return i;
        const step = i.step + 1;
        return step >= (action.stepsByTask[i.taskId] ?? 1) ? { ...i, step, status: "done" as const } : { ...i, step };
      });
      const finished = items.find((i, n) => i.status === "done" && state.plan!.items[n].status === "active");
      return { ...state, plan: { ...state.plan, items }, log: finished ? [...state.log, `Completed (simulated): ${finished.taskId}`] : state.log };
    }
    case "skip-task": {
      if (!state.plan) return state;
      const target = state.plan.items.find((i) => i.status === "active") ?? state.plan.items.find((i) => i.status === "planned");
      if (!target) return state;
      return { ...state, plan: { ...state.plan, items: state.plan.items.map((i) => (i === target ? { ...i, status: "skipped" } : i)) }, log: [...state.log, `Skipped: ${target.taskId}`] };
    }
    case "constraint-event": {
      const next = { ...state, budget: action.budget, log: [...state.log, `Scenario event: ${action.label}`] };
      if (!state.plan) return next;
      const done = state.plan.items.filter((i) => i.status === "done").reduce((s, i) => s + (action.costs[i.taskId] ?? 0), 0);
      const left = action.budget - done;
      const current = remaining(state.plan.items).map((i) => i.taskId);
      const suggested = fitInOrder(
        action.rankedTaskIds.filter((id) => current.includes(id)),
        action.costs,
        left,
      );
      const currentCost = current.reduce((s, id) => s + (action.costs[id] ?? 0), 0);
      const dropped = current.filter((id) => !suggested.includes(id));
      const orderChanged = JSON.stringify(suggested) !== JSON.stringify(current.filter((id) => suggested.includes(id)));
      if (currentCost <= left && !dropped.length && !orderChanged) return next;
      const reason =
        currentCost > left
          ? `The remaining plan needs ${currentCost} points, but only ${left} simulated points are left.`
          : "The engine's provisional order for the remaining tasks changed.";
      return { ...next, replan: { reason, suggested } };
    }
    case "accept-replan": {
      if (!state.plan || !state.replan) return state;
      const keep = state.plan.items.filter((i) => i.status === "done" || i.status === "skipped");
      const active = state.plan.items.find((i) => i.status === "active");
      const items: PlanItem[] = [
        ...keep,
        ...state.replan.suggested.map((taskId) => (active && active.taskId === taskId ? active : { taskId, status: "planned" as const, step: 0 })),
      ];
      const dropped = remaining(state.plan.items).filter((i) => !state.replan!.suggested.includes(i.taskId));
      return {
        ...state,
        plan: { ...state.plan, items: [...items, ...dropped.map((i) => ({ ...i, status: "skipped" as const }))] },
        replan: null,
        log: [...state.log, `Replanned by the user: ${state.replan.suggested.join(" → ") || "no tasks fit"}`],
      };
    }
    case "keep-plan":
      return { ...state, replan: null, log: [...state.log, "The user kept the current plan."] };
    case "reset-plan":
      return { ...state, plan: null, replan: null, mode: "planning", log: [...state.log, "Plan cleared."] };
  }
}
