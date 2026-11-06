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
/** MG-3: what a constraint change does to each action of the plan. */
export type ImpactVerdict = "kept-done" | "fits" | "no-longer-fits" | "too-large";
export type ReplanProposal = {
  trigger: { label: string; from: number; to: number };
  /** Effort of completed actions: already spent, never replanned. */
  committed: number;
  /** Effort that remains for future work: new budget minus committed. */
  available: number;
  /** Estimated effort of the remaining (planned + in-progress) actions, current order. */
  remainingNeed: number;
  impact: { taskId: string; status: PlanItemStatus; cost: number; verdict: ImpactVerdict; explanation: string }[];
  current: { order: string[]; total: number; overBy: number };
  suggested: { order: string[]; total: number; dropped: string[] };
  /** Remaining work exists, but no remaining action fits the available effort. */
  noFeasible: boolean;
  reason: string;
};

export type MissionState = {
  mode: "planning" | "eva";
  /** Simulated effort budget (the engine's res-effort constraint). */
  budget: number;
  selectedTaskId: string | null;
  draft: string[];
  plan: { items: PlanItem[]; createdWithBudget: number } | null;
  replan: ReplanProposal | null;
  /** Set when the user keeps a plan that exceeds the available effort. */
  retained: { overBy: number; available: number } | null;
  /** The plan before the last accepted replan, for Undo (nothing is discarded silently). */
  previous: { items: PlanItem[] } | null;
  /** A visible, dismissible status message after a constraint change or decision. */
  notice: string | null;
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
  | {
      type: "constraint-event";
      budget: number;
      label: string;
      /** The existing engine's provisional order at the newly available effort. */
      rankedTaskIds: string[];
      costs: Record<string, number>;
      stepsByTask: Record<string, number>;
      titles?: Record<string, string>;
    }
  | { type: "accept-replan" }
  | { type: "keep-plan" }
  | { type: "undo-replan"; costs: Record<string, number> }
  | { type: "dismiss-notice" }
  | { type: "reset-plan" };

export const initialMissionState = (budget: number): MissionState => ({
  mode: "planning",
  budget,
  selectedTaskId: null,
  draft: [],
  plan: null,
  replan: null,
  retained: null,
  previous: null,
  notice: null,
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

const sumCost = (ids: readonly string[], costs: Record<string, number>) => ids.reduce((s, id) => s + (costs[id] ?? 0), 0);

/**
 * MG-3: impact of a constraint change on the plan. Completed actions are
 * kept and their effort is committed; only remaining work is replanned.
 * The suggestion follows the engine's provisional order at the newly
 * available effort. Plain-language explanations name each affected action.
 */
export function buildProposal(args: {
  items: readonly PlanItem[];
  from: number;
  to: number;
  label: string;
  rankedTaskIds: readonly string[];
  costs: Record<string, number>;
  stepsByTask: Record<string, number>;
  titles?: Record<string, string>;
}): ReplanProposal {
  const { items, from, to, label, rankedTaskIds, costs, stepsByTask, titles = {} } = args;
  const name = (id: string) => titles[id] ?? id;
  const committed = items.filter((i) => i.status === "done").reduce((s, i) => s + (costs[i.taskId] ?? 0), 0);
  const available = to - committed;
  const live = remaining([...items]).map((i) => i.taskId);
  const remainingNeed = sumCost(live, costs);
  let room = available;
  const impact = items.map((i) => {
    const cost = costs[i.taskId] ?? 0;
    if (i.status === "done") return { taskId: i.taskId, status: i.status, cost, verdict: "kept-done" as const, explanation: `Completed: ${cost} pts already committed. Kept as done.` };
    if (i.status === "skipped") return { taskId: i.taskId, status: i.status, cost, verdict: "kept-done" as const, explanation: "Skipped earlier. Unchanged." };
    const progress = i.status === "active" ? ` In progress, ${i.step} of ${stepsByTask[i.taskId] ?? "?"} steps done; those steps are kept.` : "";
    if (cost > available) {
      room -= cost;
      return { taskId: i.taskId, status: i.status, cost, verdict: "too-large" as const, explanation: `Needs ${cost} pts, more than the ${available} pts now available.${progress}` };
    }
    if (cost > room) {
      const before = room;
      room -= cost;
      return { taskId: i.taskId, status: i.status, cost, verdict: "no-longer-fits" as const, explanation: `Needs ${cost} pts, but only ${Math.max(0, before)} pts would be left after the actions before it.${progress}` };
    }
    room -= cost;
    return { taskId: i.taskId, status: i.status, cost, verdict: "fits" as const, explanation: `Still fits: ${cost} pts.${progress}` };
  });
  const order = fitInOrder(rankedTaskIds.filter((id) => live.includes(id)), costs, available);
  const dropped = live.filter((id) => !order.includes(id));
  const overBy = Math.max(0, remainingNeed - available);
  const noFeasible = live.length > 0 && order.length === 0;
  const reason = noFeasible
    ? `Only ${available} pts are left after ${committed} pts committed; the remaining plan needs ${remainingNeed} pts.`
    : overBy
      ? `The remaining plan needs ${remainingNeed} pts, but only ${available} pts are available (${dropped.map(name).join(", ")} no longer ${dropped.length === 1 ? "fits" : "fit"}).`
      : "The engine's provisional order for the remaining actions changed.";
  return {
    trigger: { label, from, to },
    committed,
    available,
    remainingNeed,
    impact,
    current: { order: live, total: remainingNeed, overBy },
    suggested: { order, total: sumCost(order, costs), dropped },
    noFeasible,
    reason,
  };
}

export function missionReducer(state: MissionState, action: MissionAction): MissionState {
  switch (action.type) {
    case "select":
      return { ...state, selectedTaskId: action.taskId };
    case "toggle-draft":
      // Once a plan exists the draft is frozen; discard the plan to change it.
      if (state.plan) return state;
      return { ...state, draft: state.draft.includes(action.taskId) ? state.draft.filter((t) => t !== action.taskId) : [...state.draft, action.taskId] };
    case "move-draft": {
      if (state.plan) return state;
      const i = state.draft.indexOf(action.taskId);
      const j = i + action.by;
      if (i < 0 || j < 0 || j >= state.draft.length) return state;
      const draft = [...state.draft];
      [draft[i], draft[j]] = [draft[j], draft[i]];
      return { ...state, draft };
    }
    case "use-suggested":
      if (state.plan) return state;
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
      // Undo of a replan is offered only until the mission moves on.
      return { ...state, previous: null, plan: { ...state.plan, items: state.plan.items.map((i) => (i === next ? { ...i, status: "active" } : i)) }, log: [...state.log, `Started: ${next.taskId}`] };
    }
    case "complete-step": {
      if (!state.plan) return state;
      const items = state.plan.items.map((i) => {
        if (i.status !== "active") return i;
        const step = i.step + 1;
        return step >= (action.stepsByTask[i.taskId] ?? 1) ? { ...i, step, status: "done" as const } : { ...i, step };
      });
      const finished = items.find((i, n) => i.status === "done" && state.plan!.items[n].status === "active");
      return { ...state, previous: null, plan: { ...state.plan, items }, log: finished ? [...state.log, `Completed (simulated): ${finished.taskId}`] : state.log };
    }
    case "skip-task": {
      if (!state.plan) return state;
      const target = state.plan.items.find((i) => i.status === "active") ?? state.plan.items.find((i) => i.status === "planned");
      if (!target) return state;
      return { ...state, previous: null, plan: { ...state.plan, items: state.plan.items.map((i) => (i === target ? { ...i, status: "skipped" } : i)) }, log: [...state.log, `Skipped: ${target.taskId}`] };
    }
    case "constraint-event": {
      const next: MissionState = { ...state, budget: action.budget, log: [...state.log, `Scenario event: ${action.label}`] };
      if (!state.plan) return next;
      const p = buildProposal({
        items: state.plan.items,
        from: state.budget,
        to: action.budget,
        label: action.label,
        rankedTaskIds: action.rankedTaskIds,
        costs: action.costs,
        stepsByTask: action.stepsByTask,
        titles: action.titles,
      });
      const orderChanged = JSON.stringify(p.suggested.order) !== JSON.stringify(p.current.order);
      if (!p.current.overBy && !orderChanged) {
        return {
          ...next,
          replan: null,
          retained: null,
          notice: `Constraint changed (${p.trigger.from} → ${p.trigger.to} pts). Your plan still fits: ${p.remainingNeed} of ${p.available} pts needed.`,
        };
      }
      return { ...next, replan: p, notice: null };
    }
    case "accept-replan": {
      if (!state.plan || !state.replan) return state;
      const p = state.replan;
      const kept = state.plan.items.filter((i) => i.status === "done" || i.status === "skipped");
      const active = state.plan.items.find((i) => i.status === "active");
      const items: PlanItem[] = [
        ...kept,
        ...p.suggested.order.map((taskId) => (active && active.taskId === taskId ? active : { taskId, status: "planned" as const, step: 0 })),
        // Dropped work is kept in the plan as skipped (with any completed steps), not deleted.
        ...remaining(state.plan.items)
          .filter((i) => !p.suggested.order.includes(i.taskId))
          .map((i) => ({ ...i, status: "skipped" as const })),
      ];
      return {
        ...state,
        plan: { ...state.plan, items },
        replan: null,
        retained: null,
        previous: { items: state.plan.items },
        notice: p.noFeasible
          ? "Remaining work ended: no remaining action fits. Completed work is kept."
          : `Plan updated${p.suggested.dropped.length ? `: ${p.suggested.dropped.length} action(s) skipped` : ""}. Completed steps are kept.`,
        log: [...state.log, p.noFeasible ? "The user ended the remaining work." : `The user accepted the suggested plan: ${p.suggested.order.join(" → ")}`],
      };
    }
    case "keep-plan": {
      if (!state.replan) return state;
      const p = state.replan;
      return {
        ...state,
        replan: null,
        retained: p.current.overBy ? { overBy: p.current.overBy, available: p.available } : null,
        notice: null,
        log: [...state.log, p.current.overBy ? `The user kept a plan that exceeds the available effort by ${p.current.overBy} pts.` : "The user kept the current plan."],
      };
    }
    case "undo-replan": {
      if (!state.plan || !state.previous) return state;
      const items = state.previous.items;
      const committed = items.filter((i) => i.status === "done").reduce((s, i) => s + (action.costs[i.taskId] ?? 0), 0);
      const need = sumCost(remaining(items).map((i) => i.taskId), action.costs);
      const available = state.budget - committed;
      return {
        ...state,
        plan: { ...state.plan, items },
        previous: null,
        retained: need > available ? { overBy: need - available, available } : null,
        notice: "Replan undone: the previous plan is restored.",
        log: [...state.log, "The user undid the last replan."],
      };
    }
    case "dismiss-notice":
      return { ...state, notice: null };
    case "reset-plan":
      return { ...state, plan: null, replan: null, retained: null, previous: null, notice: null, mode: "planning", log: [...state.log, "Plan cleared."] };
  }
}

// ── MG-1: plan fit and plain-language feasibility (simulated effort arithmetic only) ──

export type PlanFit = {
  items: { taskId: string; cost: number; cumulative: number; fits: boolean }[];
  total: number;
  left: number;
  overBy: number;
};

/** Running total of simulated effort for an ordered plan. */
export function planFit(order: readonly string[], costs: Record<string, number>, budget: number): PlanFit {
  let cumulative = 0;
  const items = order.map((taskId) => {
    const cost = costs[taskId] ?? Infinity;
    cumulative += cost;
    return { taskId, cost, cumulative, fits: cumulative <= budget };
  });
  return { items, total: cumulative, left: budget - cumulative, overBy: Math.max(0, cumulative - budget) };
}

export type Addability =
  | { state: "in-plan"; text: string }
  | { state: "fits"; text: string }
  | { state: "no-room"; text: string }
  | { state: "infeasible"; text: string };

/**
 * Why an action can or cannot be added, in plain language. "infeasible"
 * comes from the engine (cost above the whole budget, or platform
 * unavailable); "no-room" is plan arithmetic against the actions already added.
 */
export function addability(view: TaskView, draft: readonly string[], costs: Record<string, number>, budget: number): Addability {
  if (draft.includes(view.taskId)) {
    const fit = planFit(draft, costs, budget);
    return { state: "in-plan", text: fit.overBy ? `In your plan, which is now ${fit.overBy} pts over budget.` : `In your plan · ${fit.left} pts left after all added actions.` };
  }
  if (view.status === "unavailable") return { state: "infeasible", text: "Not possible: its platform is unavailable in this scenario." };
  if (view.status === "over-budget") return { state: "infeasible", text: `Not possible: needs ${view.cost} pts, but the whole budget is ${budget} pts.` };
  const left = budget - planFit(draft, costs, budget).total;
  if (view.cost > left)
    return {
      state: "no-room",
      text:
        left < 0
          ? `Doesn't fit your plan: needs ${view.cost} pts, and your plan is already ${-left} pts over budget. Remove an action or raise the budget.`
          : `Doesn't fit your plan: needs ${view.cost} pts, only ${left} pts left. Remove an action or raise the budget.`,
    };
  return { state: "fits", text: `Fits: ${view.cost} pts, leaving ${left - view.cost} pts.` };
}
