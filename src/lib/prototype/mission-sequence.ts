/**
 * MAP-2: the conceptual mission sequence, for the 2D map, the 3D terrain,
 * the sequence list and the replanning preview.
 *
 * Pure (no React, OpenLayers or three.js). Everything is derived from the
 * shared mission state (draft order, plan items and their states) and the
 * scenario-defined target positions:
 *   - connections follow PLAN ORDER only. They are not routes, paths, travel
 *     distances or travel times, and nothing here scores or ranks anything;
 *   - sequence numbers are plan positions, never the engine's rank;
 *   - a target without a scenario position is never given an inferred one:
 *     the connection to it is reported as a gap and not drawn;
 *   - straight-line separations use the Mars 2000 sphere (lon/lat only), so
 *     no view (and no vertical exaggeration) can change them.
 */
import { greatCircleDistanceM, type LonLat } from "@/lib/map/mars-geodesy";
import { itemsAfterReplan, stepCounts, type MissionState, type PlanItem, type ReplanProposal, type SimulatedTarget } from "./mission-glass";

export const SEQUENCE_LABEL = "Conceptual mission sequence — not a navigable route";
export const DRAFT_SEQUENCE_LABEL = "Draft order preview — not a navigable route";
export const SEPARATION_NOTE = "Straight-line separation on the Mars sphere, not a travel distance.";

export type SequencePhase = "none" | "draft" | "confirmed";
/** The state of a target in the sequence. Skipped and dropped targets keep their number but leave the line. */
export type SequenceNodeState = "draft" | "planned" | "active" | "done" | "done-partial" | "skipped-user" | "dropped-replan";
export type SequenceNode = {
  taskId: string;
  targetId: string | null;
  /** Target name ("Target B"), or the task id when no target is defined. */
  name: string;
  /** 1-based position in the plan (or in the draft, for a preview). */
  order: number;
  position: LonLat | null;
  state: SequenceNodeState;
  /** On the sequence line: draft, planned, active and completed actions. */
  onLine: boolean;
  /** The EVA's current action: the one in progress, else the next planned one. */
  current: boolean;
  /** Engine feasibility under the current constraints (planned / active / draft only; always true otherwise). */
  feasible: boolean;
  /** Plain-language state, e.g. "Completed with 1 skipped step". */
  stateText: string;
};
/** A connection's state comes from where it leads: completed, the current action, or work still to do. */
export type SequenceSegmentState = "draft" | "history" | "current" | "remaining";
export type SequenceEnd = { taskId: string; targetId: string; name: string; order: number; position: LonLat };
export type SequenceSegment = {
  /** Stable id from the two tasks, e.g. "seq:task-a>task-b". */
  id: string;
  from: SequenceEnd;
  to: SequenceEnd;
  state: SequenceSegmentState;
  /** It leads to an action that does not fit the current constraints (e.g. a plan kept although infeasible). */
  infeasible: boolean;
  /** Great-circle separation on the Mars 2000 sphere, metres. Not a travel distance. */
  straightLineM: number;
};
export type SequenceGap = { fromOrder: number; toOrder: number; reason: string };
export type MissionSequence = {
  phase: SequencePhase;
  /** On-screen label for the lines (null when nothing is drawn). */
  label: string | null;
  nodes: SequenceNode[];
  segments: SequenceSegment[];
  /** Consecutive actions on the line that cannot be connected (missing scenario position). Never bridged or inferred. */
  gaps: SequenceGap[];
  currentTaskId: string | null;
};

const NONE: MissionSequence = { phase: "none", label: null, nodes: [], segments: [], gaps: [], currentTaskId: null };

function nodeState(item: PlanItem, stepCount: number): SequenceNodeState {
  if (item.status === "done") return stepCounts(item, stepCount).skipped ? "done-partial" : "done";
  if (item.status === "skipped") return item.dropped?.by === "replan" ? "dropped-replan" : "skipped-user";
  return item.status;
}

function stateText(state: SequenceNodeState, item: PlanItem | null, stepCount: number, feasible: boolean): string {
  const c = item ? stepCounts(item, stepCount) : null;
  const nf = feasible ? "" : " · not feasible under the current constraints";
  switch (state) {
    case "draft":
      return `In your draft${feasible ? "" : " · over budget at this point"}`;
    case "planned":
      return `Planned${nf}`;
    case "active":
      return `In progress${item?.paused ? " (paused)" : ""}: step ${(item?.step ?? 0) + 1} of ${stepCount || "?"}${nf}`;
    case "done":
      return "Completed";
    case "done-partial":
      return `Completed with ${c?.skipped ?? 0} skipped step${c?.skipped === 1 ? "" : "s"}`;
    case "skipped-user":
      return `Skipped by you${item?.dropped?.reason ? `: ${item.dropped.reason}` : ""}`;
    case "dropped-replan":
      return "Dropped by replanning";
  }
}

/**
 * The sequence for the current mission state: the confirmed plan if one
 * exists, otherwise a preview of the draft order, otherwise nothing.
 *
 * `feasibleByTask`: the engine's feasibility in the current decision context
 * (for a draft, whether the action still fits at its place in the draft).
 */
export function missionSequence(args: {
  state: Pick<MissionState, "draft" | "plan">;
  targets: readonly SimulatedTarget[];
  stepsByTask: Record<string, number>;
  feasibleByTask: Record<string, boolean>;
}): MissionSequence {
  const { state, targets, stepsByTask, feasibleByTask } = args;
  const targetOf = new Map(targets.map((t) => [t.taskId, t]));
  const phase: SequencePhase = state.plan ? "confirmed" : state.draft.length ? "draft" : "none";
  if (phase === "none") return NONE;
  const items: { taskId: string; item: PlanItem | null }[] = state.plan
    ? state.plan.items.map((i) => ({ taskId: i.taskId, item: i }))
    : state.draft.map((taskId) => ({ taskId, item: null }));
  const active = state.plan?.items.find((i) => i.status === "active");
  const currentTaskId = state.plan ? (active ?? state.plan.items.find((i) => i.status === "planned"))?.taskId ?? null : null;

  const nodes: SequenceNode[] = items.map(({ taskId, item }, n) => {
    const t = targetOf.get(taskId);
    const steps = stepsByTask[taskId] ?? 0;
    const st: SequenceNodeState = item ? nodeState(item, steps) : "draft";
    const needsFit = st === "draft" || st === "planned" || st === "active";
    const feasible = needsFit ? (feasibleByTask[taskId] ?? true) : true;
    return {
      taskId,
      targetId: t?.id ?? null,
      name: t?.name ?? taskId,
      order: n + 1,
      position: t ? t.position : null,
      state: st,
      onLine: st !== "skipped-user" && st !== "dropped-replan",
      current: taskId === currentTaskId,
      feasible,
      stateText: stateText(st, item, steps, feasible),
    };
  });

  const line = nodes.filter((x) => x.onLine);
  const segments: SequenceSegment[] = [];
  const gaps: SequenceGap[] = [];
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    if (!a.position || !b.position || !a.targetId || !b.targetId) {
      const missing = [a, b].filter((x) => !x.position).map((x) => `${x.order} (${x.name})`);
      gaps.push({ fromOrder: a.order, toOrder: b.order, reason: `No connection drawn: no scenario position for ${missing.join(" and ")}. Positions are never inferred.` });
      continue;
    }
    const state: SequenceSegmentState =
      phase === "draft" ? "draft" : b.state === "done" || b.state === "done-partial" ? "history" : b.current ? "current" : "remaining";
    segments.push({
      id: `seq:${a.taskId}>${b.taskId}`,
      from: { taskId: a.taskId, targetId: a.targetId, name: a.name, order: a.order, position: a.position },
      to: { taskId: b.taskId, targetId: b.targetId, name: b.name, order: b.order, position: b.position },
      state,
      infeasible: !b.feasible,
      straightLineM: greatCircleDistanceM(a.position, b.position),
    });
  }
  return { phase, label: phase === "draft" ? DRAFT_SEQUENCE_LABEL : SEQUENCE_LABEL, nodes, segments, gaps, currentTaskId };
}

/**
 * MAP-2 replanning preview: the two options of a replan proposal as
 * sequences, before the user decides. "suggested" is exactly what accepting
 * would produce (the reducer uses the same `itemsAfterReplan`); "current" is
 * the plan kept as it is, with the actions that no longer fit marked.
 */
export function replanSequences(args: {
  items: readonly PlanItem[];
  proposal: ReplanProposal;
  targets: readonly SimulatedTarget[];
  stepsByTask: Record<string, number>;
}): { suggested: MissionSequence; current: MissionSequence } {
  const { items, proposal, targets, stepsByTask } = args;
  const fitsNow = Object.fromEntries(proposal.impact.map((i) => [i.taskId, i.verdict === "fits" || i.verdict === "kept-done"]));
  const plan = (its: PlanItem[]) => ({ draft: [], plan: { items: its, createdWithBudget: 0 } });
  return {
    suggested: missionSequence({
      state: plan(itemsAfterReplan(items, proposal)),
      targets,
      stepsByTask,
      // The suggestion only keeps actions that fit, in the engine's order.
      feasibleByTask: Object.fromEntries(proposal.suggested.order.map((id) => [id, true])),
    }),
    current: missionSequence({ state: plan([...items]), targets, stepsByTask, feasibleByTask: fitsNow }),
  };
}

/** One-line description of a connection, for the sequence list and the segment summary. */
export function segmentText(s: SequenceSegment): string {
  return `Plan order ${s.from.order} → ${s.to.order}: ${s.from.name} then ${s.to.name}. ${Math.round(s.straightLineM).toLocaleString("en-US")} m straight-line separation, not a travel distance.`;
}
