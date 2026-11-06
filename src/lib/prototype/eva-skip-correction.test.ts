import { describe, expect, it } from "vitest";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { defaultConstraints } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { loadJezeroGeo } from "@/lib/geo/repository";
import {
  ACCOUNTING_ASSUMPTION,
  consumedEffort,
  executionOutcome,
  executionText,
  initialMissionState,
  missionReducer,
  parseScenario,
  reopenEffects,
  simulatedTargets,
  skipCaution,
  stepRecords,
  taskViews,
  type MissionAction,
  type MissionState,
} from "./mission-glass";
import { targetMarkers } from "./target-markers";

/** EVA-1.2: explicit step skipping, partial outcomes, and completed-action correction. */
const { scenario, registry } = loadJezeroMarginScenario();
const geo = loadJezeroGeo();
const s = parseScenario(scenarioJson, scenario, geo.catalog);
const stepsByTask = Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length]));
const costs = Object.fromEntries(scenario.tasks.map((t) => [t.id, t.costs["res-effort"]]));
const titles = Object.fromEntries(s.actions.map((a) => [a.taskId, a.shortTitle]));
const asOf = "2025-05-06";
const { snapshot } = selectEvidenceAsOf(scenario, asOf);
const ABR = "task-abrasion-proximity";
const CORE = "task-core-for-earth";

const run = (st: MissionState, ...actions: MissionAction[]) => actions.reduce(missionReducer, st);
const started = () =>
  run(initialMissionState(100), { type: "toggle-draft", taskId: ABR }, { type: "toggle-draft", taskId: CORE }, { type: "create-plan" }, { type: "start-task" });
const item = (st: MissionState, id = ABR) => st.plan!.items.find((i) => i.taskId === id)!;
const complete = (index?: number): MissionAction => ({ type: "complete-step", stepsByTask, index });
const skip = (reason: string, index?: number): MissionAction => ({ type: "skip-step", stepsByTask, index, reason });
const engineRanked = (available: number) => {
  const c = { ...defaultConstraints(snapshot), budgets: { "res-effort": available }, unavailablePlatforms: s.excludedPlatforms };
  const provisional = rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, c);
  const views = taskViews({ s, snapshot, provisional, reviewed: rankReviewed(scenario, registry, asOf, DEFAULT_WEIGHTS, c), budget: available });
  return { ids: views.filter((v) => v.rank !== null).map((v) => v.taskId), views };
};

describe("EVA-1.2 skipping a step", () => {
  it("skips the current step with a reason, continues to the next unfinished step, and cautions about later steps", () => {
    const st = run(started(), complete(), skip("Dust on the target (simulated)"));
    expect(stepRecords(item(st), 4).map((r) => r.status)).toEqual(["done", "skipped", "todo", "todo"]);
    expect(item(st).step).toBe(2);
    expect(st.notice).toBe(
      "Step 2 skipped (Dust on the target (simulated)). Later steps 3, 4 may rely on step 2. This scenario has no step-dependency data: check before continuing.",
    );
  });

  it("the caution is neutral and only appears when later steps are unfinished", () => {
    const st = run(started(), complete(), complete(), complete());
    expect(skipCaution(item(st), 4, 3)).toBeNull();
    expect(skipCaution(item(started()), 4, 0)).toBe("Later steps 2, 3, 4 may rely on step 1. This scenario has no step-dependency data: check before continuing.");
  });

  it("an action that ends with skipped steps is 'partial', not reported as complete measurements", () => {
    const st = run(started(), complete(), skip("Not needed (simulated)"), complete(), complete());
    expect(executionOutcome(item(st), 4)).toBe("partial");
    expect(executionText(item(st), 4)).toBe("Ended with 1 of 4 step(s) skipped: those measurements were not made.");
    expect(st.notice).toBe("Step 4 marked done; action ended with 1 skipped step(s): those measurements were not made.");
    // Execution status is separate from the effort accounting assumption: the whole simulated cost is committed.
    expect(consumedEffort(st, costs)).toBe(40);
    const complete4 = run(started(), complete(), complete(), complete(), complete());
    expect(executionOutcome(item(complete4), 4)).toBe("complete");
    // The map shows the difference.
    const { views } = engineRanked(60);
    const m = targetMarkers({ targets: simulatedTargets(s, geo.catalog), viewById: new Map(views.map((v) => [v.taskId, v])), state: st, stepsByTask });
    const b = m.find((x) => x.taskId === ABR)!;
    expect([b.badge, b.status, b.planText]).toEqual([
      "½",
      "done · partial",
      "Ended with 1 of 4 step(s) skipped: those measurements were not made. Its whole simulated cost is committed.",
    ]);
  });

  it("a skip reason can be corrected (non-empty), and undone", () => {
    const st = run(started(), skip("Wrong reason"));
    const fixed = run(st, { type: "set-skip-reason", stepsByTask, index: 0, reason: "  Equipment issue (simulated) " });
    expect(stepRecords(item(fixed), 4)[0]).toEqual({ status: "skipped", reason: "Equipment issue (simulated)" });
    expect(run(fixed, { type: "set-skip-reason", stepsByTask, index: 0, reason: " " })).toBe(fixed);
    expect(run(fixed, { type: "set-skip-reason", stepsByTask, index: 1, reason: "x" })).toBe(fixed); // not skipped
    expect(stepRecords(item(run(fixed, { type: "undo-step" })), 4)[0].reason).toBe("Wrong reason");
  });

  it("a skipped step can be reopened; its reason stays in the history", () => {
    const st = run(started(), skip("Dusty (simulated)"), { type: "reopen-step", stepsByTask, taskId: ABR, index: 0, titles });
    expect(stepRecords(item(st), 4)[0]).toEqual({ status: "todo", history: [{ status: "skipped", reason: "Dusty (simulated)" }] });
    expect(item(st).step).toBe(0);
  });
});

describe("EVA-1.2 completed-action correction", () => {
  it("explains execution and accounting separately for a partial action, and keeps history", () => {
    const st = run(started(), complete(), skip("Not needed (simulated)"), complete(), complete());
    const fx = reopenEffects({ state: st, taskId: ABR, index: 3, costs, stepsByTask, titles });
    expect(fx.execution[1]).toBe("Abrade and analyse a rock has ended (Ended with 1 of 4 step(s) skipped: those measurements were not made); reopening returns it to in progress at step 4.");
    expect(fx.accounting).toContain(ACCOUNTING_ASSUMPTION);
    const reopened = run(st, { type: "reopen-step", stepsByTask, taskId: ABR, index: 3, titles });
    expect(stepRecords(item(reopened), 4)).toEqual([
      { status: "done" },
      { status: "skipped", reason: "Not needed (simulated)" },
      { status: "done" },
      { status: "todo", history: [{ status: "done" }] },
    ]);
    expect(consumedEffort(reopened, costs)).toBe(0);
  });

  it("re-checks feasibility after reopening: still fits → a notice, Undo kept", () => {
    let st = run(started(), complete(), complete(), complete(), complete(), { type: "reopen-step", stepsByTask, taskId: ABR, index: 3, titles });
    st = run(st, { type: "recheck", label: "Reopened", rankedTaskIds: engineRanked(100 - consumedEffort(st, costs)).ids, costs, stepsByTask, titles });
    expect(st.replan).toBeNull();
    expect(st.notice).toMatch(/Feasibility re-checked: the remaining plan needs 95 of 100 pts available and still fits\.$/);
    expect(st.stepUndo).not.toBeNull();
  });

  it("re-checks feasibility after reopening: a plan that no longer fits asks for a replanning decision", () => {
    // Effort cut to 50 after abrasion ended; the user keeps coring anyway, then reopens abrasion.
    let st = run(started(), complete(), complete(), complete(), complete());
    st = run(st, { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: [], costs, stepsByTask }, { type: "keep-plan" });
    st = run(st, { type: "reopen-step", stepsByTask, taskId: ABR, index: 3, titles });
    st = run(st, { type: "recheck", label: "Reopened", rankedTaskIds: engineRanked(50 - consumedEffort(st, costs)).ids, costs, stepsByTask, titles });
    expect(st.replan?.trigger).toEqual({ label: "Reopened", from: 50, to: 50 });
    expect(st.replan?.remainingNeed).toBe(95);
    expect(st.replan?.available).toBe(50);
  });
});
