import { z } from "zod";
import type { Recommendation } from "@/lib/decision/engine";
import { linkedQuestionsText, stabilityScopeText } from "@/lib/decision/explain";
import type { ProvisionalRanking, ReviewedRanking } from "@/lib/decision/review-modes";
import { relationshipIds, type ReviewRegistry } from "@/lib/evidence/review-registry";
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
  /** SCI-0 A1: review status and author of each task–gap link (else the reviewed ranking's awaiting list is used). */
  registry?: ReviewRegistry;
}): TaskView[] {
  const { s, snapshot, provisional, reviewed, budget, registry } = args;
  const entryById = new Map((registry?.entries ?? []).map((e) => [e.id, e]));
  const awaiting = new Set(reviewed.awaitingReview);
  const rec: Recommendation = provisional.recommendation;
  const openLocal = snapshot.gaps.filter((g) => g.relevance === "local" && g.status.state === "open");
  const views = s.actions.map((a): TaskView => {
    const task = snapshot.tasks.find((t) => t.id === a.taskId)!;
    const cost = task.costs["res-effort"] ?? NaN;
    const ranked = rec.ranking.find((r) => r.taskId === task.id);
    const infeasible = rec.infeasible.find((r) => r.taskId === task.id);
    const evaluation = ranked ?? rec.unranked.find((r) => r.taskId === task.id);
    const linkIds = task.addresses.filter((l) => openLocal.some((g) => g.id === l.gapId)).map((l) => relationshipIds.taskGap(task.id, l.gapId));
    const covered = linkIds.length;
    const unreviewedLinks = linkIds.filter((id) => (registry ? entryById.get(id)?.status !== "approved" : awaiting.has(id)));
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
      // SCI-0 A1: say that the linked-question count rests on links that may not be reviewed yet.
      rationale: `${linkedQuestionsText({
        linked: covered,
        open: openLocal.length,
        unreviewed: unreviewedLinks.length,
        aiDrafted: Boolean(registry) && unreviewedLinks.every((id) => entryById.get(id)?.draftedBy === "ai-agent"),
      })} · ${EVIDENCE_PHRASE[task.platform] ?? ""} · ${cost} pts`,
      status: unavailable ? "unavailable" : infeasible ? "over-budget" : "fits",
      statusText: infeasible ? `Needs ${cost} pts, budget is ${budget}` : `Fits: ${cost} of ${budget} pts`,
      cost,
      budget,
      conditions: [
        `Only while the simulated budget is at least ${cost} points.`,
        // SCI-0 A2: the stability check varies weights only; state the unreviewed-input sensitivity next to it.
        isTop
          ? stabilityScopeText({ stability: rec.stability, unreviewedInputs: provisional.unreviewedInputs.length, pivotalInputs: provisional.pivotalInputs.length })
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
/** EVA-1: the state of one step. The step list itself (the procedure) comes from the scenario and is never edited in the HUD. */
export type StepStatus = "todo" | "done" | "skipped";
export type StepRecord = {
  status: StepStatus;
  reason?: string;
  note?: string;
  /** EVA-1.2: earlier states of a step that was reopened (oldest first), so completed work and skip reasons are not lost. */
  history?: { status: "done" | "skipped"; reason?: string }[];
};

/**
 * EVA-1.2: how an ended action was executed. This is separate from effort
 * accounting: "partial" means some planned measurements were not made, even
 * though the action counts as ended.
 */
export type ExecutionOutcome = "complete" | "partial";
export function executionOutcome(item: PlanItem, count: number): ExecutionOutcome | null {
  if (item.status !== "done") return null;
  return stepCounts(item, count).skipped ? "partial" : "complete";
}
export function executionText(item: PlanItem, count: number): string {
  const c = stepCounts(item, count);
  return executionOutcome(item, count) === "partial"
    ? `Ended with ${c.skipped} of ${count} step(s) skipped: those measurements were not made.`
    : `Completed: all ${count} steps done.`;
}
/** EVA-1.2: the effort accounting assumption, stated wherever committed effort is explained. */
export const ACCOUNTING_ASSUMPTION =
  "Simulated effort accounting: an action's whole estimated cost is committed when it ends, also if some steps were skipped. Per-step costs are not modelled.";

/**
 * EVA-1.2: a neutral caution when a step is skipped while later steps are
 * unfinished. The scenario has no step-dependency data, so no rule is
 * invented: later steps only "may" rely on it.
 */
export function skipCaution(item: PlanItem, count: number, index: number): string | null {
  const later = stepRecords(item, count)
    .map((r, n) => ({ r, n }))
    .filter(({ r, n }) => n > index && r.status === "todo")
    .map(({ n }) => n + 1);
  if (!later.length) return null;
  return `Later step${later.length > 1 ? "s" : ""} ${later.join(", ")} may rely on step ${index + 1}. This scenario has no step-dependency data: check before continuing.`;
}
export type PlanItem = {
  taskId: string;
  status: PlanItemStatus;
  /** Index of the current step: the first step not yet done or skipped (the step count once all are resolved). */
  step: number;
  /** EVA-1: per-step records, by index; a missing entry is "todo". */
  steps?: StepRecord[];
  /** EVA-1: the current step of the active action is paused. */
  paused?: boolean;
  /** EVA-1: who skipped a skipped action: the user (with a reason), or a replan that dropped it. */
  dropped?: { by: "user" | "replan"; reason?: string };
};

export const NOTE_MAX = 280;
export const REASON_MAX = 160;

/** Full step records for an item (missing entries are "todo"). */
export function stepRecords(item: PlanItem, count: number): StepRecord[] {
  return Array.from({ length: count }, (_, n) => item.steps?.[n] ?? { status: "todo" as const });
}

export function stepCounts(item: PlanItem, count: number): { done: number; skipped: number; todo: number; current: number | null } {
  const r = stepRecords(item, count);
  const first = r.findIndex((x) => x.status === "todo");
  return {
    done: r.filter((x) => x.status === "done").length,
    skipped: r.filter((x) => x.status === "skipped").length,
    todo: r.filter((x) => x.status === "todo").length,
    current: first === -1 ? null : first,
  };
}

/** Replace one step record and normalise the item: current step, and completion once every step is resolved. */
function withStep(item: PlanItem, count: number, index: number, record: StepRecord): PlanItem {
  const steps = stepRecords(item, count).map((x, n) => (n === index ? record : x));
  const first = steps.findIndex((x) => x.status === "todo");
  if (first !== -1) return { ...item, steps, step: first };
  // All steps resolved: done if any step was completed (its simulated effort is then committed);
  // skipped by the user if every step was skipped (nothing is committed).
  const anyDone = steps.some((x) => x.status === "done");
  return anyDone
    ? { ...item, steps, step: count, status: "done", paused: false }
    : { ...item, steps, step: count, status: "skipped", paused: false, dropped: { by: "user", reason: "Every step was skipped" } };
}
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
  /** EVA-1: the plan before the last step-state change, for Undo. Cleared when the mission moves to another action or a replan. */
  stepUndo: { items: PlanItem[]; label: string } | null;
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
  /** Complete the current step, or a given step of the active action (EVA-1). */
  | { type: "complete-step"; stepsByTask: Record<string, number>; index?: number }
  /** EVA-1: skip one step of the active action; a non-empty reason is required. */
  | { type: "skip-step"; stepsByTask: Record<string, number>; index?: number; reason: string }
  | { type: "pause-step" }
  | { type: "resume-step" }
  /** EVA-1: the user's own simulated observation note on a step (empty clears it). */
  | { type: "set-step-note"; stepsByTask: Record<string, number>; index: number; note: string }
  | { type: "undo-step" }
  /** EVA-1.1: return a done or skipped step to "not done" (of the active action, or of a completed one). */
  | { type: "reopen-step"; stepsByTask: Record<string, number>; taskId: string; index: number; titles?: Record<string, string> }
  /** EVA-1.2: correct the reason of a skipped step of the action in progress. */
  | { type: "set-skip-reason"; stepsByTask: Record<string, number>; index: number; reason: string }
  /**
   * EVA-1.2: re-check feasibility after remaining work changed (a reopened
   * action). Like a constraint event at the same budget, but it keeps Undo
   * and only asks for a decision if the remaining plan no longer fits or the
   * engine's order changed.
   */
  | { type: "recheck"; label: string; rankedTaskIds: string[]; costs: Record<string, number>; stepsByTask: Record<string, number>; titles?: Record<string, string> }
  | { type: "skip-task"; reason?: string }
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
  stepUndo: null,
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
 * EVA-1.1: what reopening a step would change, in plain language, for the
 * confirmation. Reopening applies to a done or skipped step of the action in
 * progress, or of a completed action. Reopening a completed action returns it
 * to "in progress" and releases its committed effort (it is committed again,
 * once, when the action is completed again); an action in progress at that
 * moment is set aside (back in the plan with its steps kept).
 */
export function reopenEffects(args: {
  state: Pick<MissionState, "plan" | "budget">;
  taskId: string;
  index: number;
  costs: Record<string, number>;
  stepsByTask: Record<string, number>;
  titles?: Record<string, string>;
}): { ok: boolean; why?: string; execution: string[]; accounting: string[]; feasibility: string | null; lines: string[]; affectsPlan: boolean } {
  const { state, taskId, index, costs, stepsByTask, titles = {} } = args;
  const none = (why: string) => ({ ok: false, why, execution: [], accounting: [], feasibility: null, lines: [], affectsPlan: false });
  const name = (id: string) => titles[id] ?? id;
  const items = state.plan?.items ?? [];
  const item = items.find((i) => i.taskId === taskId);
  const count = stepsByTask[taskId] ?? 0;
  if (!item || index < 0 || index >= count) return none("No such step.");
  if (item.status !== "active" && item.status !== "done") return none("Only steps of the action in progress or of a completed action can be reopened.");
  const rec = stepRecords(item, count)[index];
  if (rec.status === "todo") return none("This step is not done yet.");
  // Execution: what happens to the step and the action.
  const execution = [
    `Step ${index + 1} becomes not done again. Its earlier state (${rec.status}${rec.reason ? `: ${rec.reason}` : ""}) is kept in the step's history${rec.note ? ", and your note is kept" : ""}.`,
  ];
  const after = stepRecords(item, count).map((x, n) => (n === index ? { status: "todo" as const } : x));
  const newCurrent = after.findIndex((x) => x.status === "todo");
  const accounting: string[] = [];
  let feasibility: string | null = null;
  let affectsPlan = false;
  if (item.status === "active") {
    if (newCurrent !== item.step) execution.push(`The current step becomes step ${newCurrent + 1}.`);
    accounting.push("No change: this action is still in progress, so nothing was committed for it yet.");
  } else {
    affectsPlan = true;
    execution.push(`${name(taskId)} has ended (${executionText(item, count).replace(/\.$/, "")}); reopening returns it to in progress at step ${newCurrent + 1}.`);
    const other = items.find((i) => i.status === "active");
    if (other) execution.push(`${name(other.taskId)} (in progress) is set aside: it goes back into the plan with its steps kept and continues after ${name(taskId)}.`);
    if (items.some((i) => i.status === "done" && i.taskId !== taskId)) execution.push("Other completed actions stay completed.");
    if (items.some((i) => i.dropped?.by === "replan")) execution.push("Earlier replanning decisions are not changed: dropped actions stay dropped.");
    const cost = costs[taskId] ?? 0;
    const committed = items.filter((i) => i.status === "done").reduce((sum, i) => sum + (costs[i.taskId] ?? 0), 0);
    const need = remaining(items).reduce((sum, i) => sum + (costs[i.taskId] ?? 0), 0);
    accounting.push(
      `Its ${cost} pts are released: committed effort goes from ${committed} to ${committed - cost} pts, and the remaining plan's estimate from ${need} to ${need + cost} pts.`,
      "They are committed again, once, when the action ends again. Nothing is counted twice and no per-step amount is refunded.",
      ACCOUNTING_ASSUMPTION,
    );
    const available = state.budget - (committed - cost);
    feasibility =
      need + cost <= available
        ? `After reopening, the remaining plan needs ${need + cost} of ${available} pts available: it fits. The engine's order is re-checked when you confirm.`
        : `After reopening, the remaining plan needs ${need + cost} pts but only ${available} are available. You will be asked to replan when you confirm.`;
  }
  return { ok: true, execution, accounting, feasibility, lines: [...execution, ...accounting, ...(feasibility ? [feasibility] : [])], affectsPlan };
}

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
    if (i.status === "skipped")
      return {
        taskId: i.taskId,
        status: i.status,
        cost,
        verdict: "kept-done" as const,
        explanation: i.dropped?.by === "replan" ? "Dropped by an earlier replan. Unchanged." : "Skipped earlier by you. Unchanged.",
      };
    const n = stepsByTask[i.taskId] ?? 0;
    const c = stepCounts(i, n);
    const progress =
      i.status === "active"
        ? ` In progress${i.paused ? " (paused)" : ""}, ${c.done} of ${n || "?"} steps done${c.skipped ? `, ${c.skipped} skipped` : ""}; those steps are kept.`
        : "";
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

/**
 * The plan items after accepting a replan proposal: completed and skipped
 * items are kept as they are (history); the suggested order follows for the
 * remaining work (an action in progress keeps its steps); remaining work that
 * no longer fits is kept as "dropped by replan", not deleted. Used by the
 * reducer and by the MAP-2 sequence preview, so both always agree.
 */
export function itemsAfterReplan(items: readonly PlanItem[], p: Pick<ReplanProposal, "suggested">): PlanItem[] {
  const kept = items.filter((i) => i.status === "done" || i.status === "skipped");
  const active = items.find((i) => i.status === "active");
  return [
    ...kept,
    ...p.suggested.order.map((taskId) => (active && active.taskId === taskId ? active : { taskId, status: "planned" as const, step: 0 })),
    // Dropped work is kept in the plan as skipped (with any completed steps), not deleted.
    ...remaining([...items])
      .filter((i) => !p.suggested.order.includes(i.taskId))
      .map((i) => ({ ...i, status: "skipped" as const, paused: false, dropped: { by: "replan" as const } })),
  ];
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
      // Undo of a replan (or of a step change) is offered only until the mission moves on.
      return {
        ...state,
        previous: null,
        stepUndo: null,
        plan: { ...state.plan, items: state.plan.items.map((i) => (i === next ? { ...i, status: "active" } : i)) },
        log: [...state.log, `Started: ${next.taskId}`],
      };
    }
    case "complete-step":
    case "skip-step":
    case "set-step-note": {
      if (!state.plan) return state;
      const active = state.plan.items.find((i) => i.status === "active");
      if (!active) return state;
      const count = action.stepsByTask[active.taskId] ?? 0;
      const index = action.type === "set-step-note" ? action.index : (action.index ?? active.step);
      if (!Number.isInteger(index) || index < 0 || index >= count) return state;
      const rec = stepRecords(active, count)[index];
      let next: StepRecord;
      let label: string;
      if (action.type === "set-step-note") {
        const note = action.note.trim().slice(0, NOTE_MAX);
        if ((rec.note ?? "") === note) return state;
        next = note ? { ...rec, note } : { status: rec.status, ...(rec.reason ? { reason: rec.reason } : {}) };
        label = note ? `Note saved on step ${index + 1}` : `Note removed from step ${index + 1}`;
      } else {
        // A paused step must be resumed first; a resolved step is not changed again (use Undo).
        if (active.paused || rec.status !== "todo") return state;
        if (action.type === "skip-step") {
          const reason = action.reason.trim().slice(0, REASON_MAX);
          if (!reason) return state;
          next = { ...rec, status: "skipped", reason };
          label = `Step ${index + 1} skipped (${reason})`;
        } else {
          next = { ...rec, status: "done" };
          label = `Step ${index + 1} marked done`;
        }
      }
      const updated = withStep(active, count, index, next);
      const skippedSteps = stepCounts(updated, count).skipped;
      const finished =
        updated.status === "active"
          ? ""
          : updated.status === "done"
            ? skippedSteps
              ? `; action ended with ${skippedSteps} skipped step(s): those measurements were not made`
              : "; action completed (simulated)"
            : "; action skipped: every step was skipped";
      // EVA-1.2: a neutral caution when later steps are still to do (no invented dependency rule).
      const caution = action.type === "skip-step" && updated.status === "active" ? skipCaution(active, count, index) : null;
      return {
        ...state,
        previous: null,
        stepUndo: { items: state.plan.items, label },
        notice: `${label}${finished}.${caution ? ` ${caution}` : ""}`,
        plan: { ...state.plan, items: state.plan.items.map((i) => (i === active ? updated : i)) },
        log: [...state.log, `${label}: ${active.taskId}${finished}`],
      };
    }
    case "pause-step":
    case "resume-step": {
      if (!state.plan) return state;
      const active = state.plan.items.find((i) => i.status === "active");
      const pause = action.type === "pause-step";
      if (!active || Boolean(active.paused) === pause) return state;
      const label = `${pause ? "Paused" : "Resumed"} at step ${active.step + 1}`;
      return {
        ...state,
        previous: null,
        stepUndo: { items: state.plan.items, label },
        notice: `${label}.`,
        plan: { ...state.plan, items: state.plan.items.map((i) => (i === active ? { ...i, paused: pause } : i)) },
        log: [...state.log, `${label}: ${active.taskId}`],
      };
    }
    case "reopen-step": {
      if (!state.plan) return state;
      const item = state.plan.items.find((i) => i.taskId === action.taskId);
      const count = action.stepsByTask[action.taskId] ?? 0;
      if (!item || (item.status !== "active" && item.status !== "done") || action.index < 0 || action.index >= count) return state;
      const records = stepRecords(item, count);
      const rec = records[action.index];
      if (rec.status === "todo") return state;
      const reopened: StepRecord = {
        status: "todo",
        ...(rec.note ? { note: rec.note } : {}),
        history: [...(rec.history ?? []), { status: rec.status, ...(rec.reason ? { reason: rec.reason } : {}) }],
      };
      const steps = records.map((x, n) => (n === action.index ? reopened : x));
      const step = steps.findIndex((x) => x.status === "todo");
      const wasDone = item.status === "done";
      const other = wasDone ? state.plan.items.find((i) => i.status === "active") : undefined;
      const items = state.plan.items.map((i) =>
        i === item
          ? { ...item, steps, step, status: "active" as const, ...(wasDone ? { paused: false } : {}) }
          : i === other
            ? { ...i, status: "planned" as const, paused: false }
            : i,
      );
      const name = action.titles?.[item.taskId] ?? item.taskId;
      const laterDone = steps.slice(action.index + 1).filter((x) => x.status === "done").length;
      const label = `Step ${action.index + 1} reopened${wasDone ? `; ${name} is in progress again and its effort is no longer committed` : ""}`;
      // EVA-1.3: say exactly what changed (reopening inside the action in progress is immediate and undoable).
      const detail = `${step === action.index ? ` It is the current step again.` : ` The current step is step ${step + 1}.`}${laterDone ? " Later done steps stay done." : ""} Its earlier state is kept in its history.`;
      return {
        ...state,
        previous: null,
        stepUndo: { items: state.plan.items, label },
        notice: `${label}.${detail}`,
        plan: { ...state.plan, items },
        log: [...state.log, `${label}: ${item.taskId}${other ? `; set aside: ${other.taskId}` : ""}`],
      };
    }
    case "set-skip-reason": {
      if (!state.plan) return state;
      const active = state.plan.items.find((i) => i.status === "active");
      if (!active) return state;
      const count = action.stepsByTask[active.taskId] ?? 0;
      if (action.index < 0 || action.index >= count) return state;
      const rec = stepRecords(active, count)[action.index];
      const reason = action.reason.trim().slice(0, REASON_MAX);
      if (rec.status !== "skipped" || !reason || reason === rec.reason) return state;
      const steps = stepRecords(active, count).map((x, n) => (n === action.index ? { ...x, reason } : x));
      const label = `Skip reason of step ${action.index + 1} corrected`;
      return {
        ...state,
        stepUndo: { items: state.plan.items, label },
        notice: `${label}.`,
        plan: { ...state.plan, items: state.plan.items.map((i) => (i === active ? { ...active, steps } : i)) },
        log: [...state.log, `${label} (${reason}): ${active.taskId}`],
      };
    }
    case "recheck": {
      if (!state.plan) return state;
      const p = buildProposal({
        items: state.plan.items,
        from: state.budget,
        to: state.budget,
        label: action.label,
        rankedTaskIds: action.rankedTaskIds,
        costs: action.costs,
        stepsByTask: action.stepsByTask,
        titles: action.titles,
      });
      const orderChanged = JSON.stringify(p.suggested.order) !== JSON.stringify(p.current.order);
      if (!p.current.overBy && !orderChanged) {
        const ok = `Feasibility re-checked: the remaining plan needs ${p.remainingNeed} of ${p.available} pts available and still fits.`;
        return { ...state, notice: state.notice ? `${state.notice} ${ok}` : ok, log: [...state.log, ok] };
      }
      return { ...state, replan: p, log: [...state.log, `Feasibility re-check after: ${action.label}`] };
    }
    case "undo-step": {
      if (!state.plan || !state.stepUndo) return state;
      return {
        ...state,
        plan: { ...state.plan, items: state.stepUndo.items },
        stepUndo: null,
        notice: `Undone: ${state.stepUndo.label}.`,
        log: [...state.log, `Undid: ${state.stepUndo.label}`],
      };
    }
    case "skip-task": {
      if (!state.plan) return state;
      const target = state.plan.items.find((i) => i.status === "active") ?? state.plan.items.find((i) => i.status === "planned");
      if (!target) return state;
      const reason = action.reason?.trim().slice(0, REASON_MAX) || undefined;
      return {
        ...state,
        previous: null,
        stepUndo: null,
        plan: { ...state.plan, items: state.plan.items.map((i) => (i === target ? { ...i, status: "skipped", paused: false, dropped: { by: "user", ...(reason ? { reason } : {}) } } : i)) },
        log: [...state.log, `Skipped by the user: ${target.taskId}${reason ? ` (${reason})` : ""}`],
      };
    }
    case "constraint-event": {
      const next: MissionState = { ...state, budget: action.budget, stepUndo: null, log: [...state.log, `Scenario event: ${action.label}`] };
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
      const items = itemsAfterReplan(state.plan.items, p);
      return {
        ...state,
        plan: { ...state.plan, items },
        replan: null,
        retained: null,
        stepUndo: null,
        previous: { items: state.plan.items },
        notice: p.noFeasible
          ? "Remaining work ended: no remaining action fits. Completed work is kept."
          : `Plan updated${p.suggested.dropped.length ? `: ${p.suggested.dropped.length} action(s) dropped by replan` : ""}. Completed steps are kept.`,
        log: [...state.log, p.noFeasible ? "The user ended the remaining work." : `The user accepted the suggested plan: ${p.suggested.order.join(" → ")}`],
      };
    }
    case "keep-plan": {
      if (!state.replan) return state;
      const p = state.replan;
      return {
        ...state,
        replan: null,
        stepUndo: null,
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
        stepUndo: null,
        retained: need > available ? { overBy: need - available, available } : null,
        notice: "Replan undone: the previous plan is restored.",
        log: [...state.log, "The user undid the last replan."],
      };
    }
    case "dismiss-notice":
      return { ...state, notice: null };
    case "reset-plan":
      return { ...state, plan: null, replan: null, retained: null, previous: null, stepUndo: null, notice: null, mode: "planning", log: [...state.log, "Plan cleared."] };
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
