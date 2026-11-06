/**
 * MAP-1: decision state of each scenario-defined target, for the map.
 *
 * Pure (no React, no OpenLayers). Everything here is derived from two
 * existing sources:
 *   - the engine's task views (`taskViews`: provisional rank and budget
 *     feasibility from `rankProvisional`), and
 *   - the shared mission state (draft and plan items).
 * No score, rank or feasibility is computed here. Targets stay
 * scenario-defined positions; they are never verified observations.
 */
import { stepCounts, type MissionState, type PlanItemStatus, type SimulatedTarget, type TaskView } from "./mission-glass";

export type MarkerTone = "candidate" | "added" | PlanItemStatus | "infeasible";

export type TargetMarker = {
  /** Simulated target id (`sim-…`). */
  id: string;
  taskId: string;
  /** "Target B". */
  name: string;
  taskTitle: string;
  /** The engine's provisional rank under the current constraints (null = not ranked). */
  rank: number | null;
  /** The engine's budget feasibility for this task under the current constraints. */
  feasible: boolean;
  tone: MarkerTone;
  /** Short text drawn inside the marker: the rank, "✓" when done, "–" when not ranked. */
  badge: string;
  /** Short state word drawn under the name on the map ("" for an unplanned, feasible candidate). */
  status: string;
  /** "Provisional priority #1." or "Not ranked under the current budget." */
  priorityText: string;
  /** Plan state and feasibility in plain language, e.g. "In progress: step 2 of 4." */
  planText: string;
  /** priorityText + planText: the accessible name of the target. */
  stateText: string;
  cost: number;
  distanceFromAnchorM: number;
};

const STATUS: Record<MarkerTone, string> = {
  candidate: "",
  added: "added",
  planned: "planned",
  active: "in progress",
  done: "done",
  skipped: "skipped",
  infeasible: "not feasible",
};

export function targetMarkers(args: {
  targets: readonly SimulatedTarget[];
  viewById: ReadonlyMap<string, TaskView>;
  state: Pick<MissionState, "draft" | "plan">;
  stepsByTask: Record<string, number>;
}): TargetMarker[] {
  const { targets, viewById, state, stepsByTask } = args;
  const out: TargetMarker[] = [];
  for (const t of targets) {
    const v = viewById.get(t.taskId);
    if (!v) continue;
    const item = state.plan?.items.find((i) => i.taskId === t.taskId);
    const feasible = v.status === "fits";
    const tone: MarkerTone = item ? item.status : state.draft.includes(t.taskId) ? "added" : feasible ? "candidate" : "infeasible";
    const badge = tone === "done" ? "✓" : v.rank ? String(v.rank) : "–";
    const priority = v.rank ? `provisional priority #${v.rank}` : "not ranked under the current budget";
    const n = stepsByTask[t.taskId] ?? 0;
    const c = item ? stepCounts(item, n) : null;
    // EVA-1: steps done or skipped so far, e.g. " (2 of 4 steps done, 1 skipped)".
    const stepsSoFar = c && c.done + c.skipped ? ` (${c.done} of ${n} steps done${c.skipped ? `, ${c.skipped} skipped` : ""})` : "";
    const planText =
      tone === "done"
        ? `Done (simulated)${c?.skipped ? `, ${c.skipped} step(s) skipped` : ""}. Its effort is committed.`
        : tone === "skipped"
          ? item?.dropped?.by === "replan"
            ? `Dropped by replanning${stepsSoFar}.`
            : `Skipped by you${item?.dropped?.reason ? `: ${item.dropped.reason}` : ""}${stepsSoFar}.`
          : tone === "active"
            ? `${item?.paused ? "Paused at" : "In progress:"} step ${(item?.step ?? 0) + 1} of ${n || "?"}${stepsSoFar}.${feasible ? "" : " Not feasible under the current budget."}`
            : tone === "planned"
              ? `In the plan.${feasible ? "" : " Not feasible under the current budget."}`
              : tone === "added"
                ? "Added to your draft plan."
                : tone === "infeasible"
                  ? v.status === "unavailable"
                    ? "Not feasible: its platform is unavailable in this scenario."
                    : `Not feasible: needs ${v.cost} pts, ${v.budget} pts available.`
                  : "Not in the plan.";
    out.push({
      id: t.id,
      taskId: t.taskId,
      name: t.name,
      taskTitle: v.shortTitle,
      rank: v.rank,
      feasible,
      tone,
      badge,
      // A planned or in-progress action that the current budget no longer covers says so on the map.
      status:
        tone === "skipped" && item?.dropped?.by === "replan"
          ? "dropped by replan"
          : tone === "active" && item?.paused
            ? `paused${feasible ? "" : " · not feasible"}`
            : (tone === "planned" || tone === "active") && !feasible
              ? `${STATUS[tone]} · not feasible`
              : STATUS[tone],
      priorityText: `${priority[0].toUpperCase()}${priority.slice(1)}.`,
      planText,
      stateText: `${priority[0].toUpperCase()}${priority.slice(1)}. ${planText}`,
      cost: v.cost,
      distanceFromAnchorM: t.distanceFromAnchorM,
    });
  }
  // Keyboard and list order: provisional rank, unranked last (stable by target name).
  return out.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name));
}
