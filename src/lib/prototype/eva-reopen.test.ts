import { describe, expect, it } from "vitest";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import {
  consumedEffort,
  initialMissionState,
  missionReducer,
  parseScenario,
  remaining,
  reopenEffects,
  stepCounts,
  stepRecords,
  type MissionAction,
  type MissionState,
} from "./mission-glass";

/** EVA-1.1: reopening (correcting) completed steps. */
const { scenario } = loadJezeroMarginScenario();
const geo = loadJezeroGeo();
const s = parseScenario(scenarioJson, scenario, geo.catalog);
const stepsByTask = Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length]));
const costs = Object.fromEntries(scenario.tasks.map((t) => [t.id, t.costs["res-effort"]]));
const titles = Object.fromEntries(s.actions.map((a) => [a.taskId, a.shortTitle]));
const ABR = "task-abrasion-proximity";
const CORE = "task-core-for-earth";

const run = (st: MissionState, ...actions: MissionAction[]) => actions.reduce(missionReducer, st);
const started = () =>
  run(initialMissionState(100), { type: "toggle-draft", taskId: ABR }, { type: "toggle-draft", taskId: CORE }, { type: "create-plan" }, { type: "start-task" });
const item = (st: MissionState, id: string) => st.plan!.items.find((i) => i.taskId === id)!;
const statuses = (st: MissionState, id = ABR) => stepRecords(item(st, id), 4).map((r) => r.status);
const complete = (index?: number): MissionAction => ({ type: "complete-step", stepsByTask, index });
const reopen = (index: number, taskId = ABR): MissionAction => ({ type: "reopen-step", stepsByTask, taskId, index, titles });
const remainingNeed = (st: MissionState) => remaining(st.plan!.items).reduce((sum, i) => sum + costs[i.taskId], 0);

describe("EVA-1.1 reopening completed steps", () => {
  it("complete step 2, then reopen step 2: it is not done again and becomes the current step", () => {
    let st = run(started(), complete(), complete()); // steps 1 and 2 done
    expect(statuses(st)).toEqual(["done", "done", "todo", "todo"]);
    st = run(st, reopen(1));
    expect(statuses(st)).toEqual(["done", "todo", "todo", "todo"]);
    expect(item(st, ABR)).toMatchObject({ status: "active", step: 1 });
    expect(stepCounts(item(st, ABR), 4)).toEqual({ done: 1, skipped: 0, todo: 3, current: 1 });
    expect(st.notice).toBe("Step 2 reopened.");
  });

  it("complete steps 2 and 3, then reopen step 2: step 3 stays done; work returns to step 2", () => {
    let st = run(started(), complete(), complete(), complete()); // 1, 2, 3 done
    st = run(st, reopen(1));
    expect(statuses(st)).toEqual(["done", "todo", "done", "todo"]);
    expect(item(st, ABR).step).toBe(1);
    // Continue the simulated work on step 2; step 4 is then the only one left.
    st = run(st, complete());
    expect(statuses(st)).toEqual(["done", "done", "done", "todo"]);
    expect(item(st, ABR).step).toBe(3);
  });

  it("reopen the final step after the action completed: effort is released, then committed once on re-completion", () => {
    let st = run(started(), complete(), complete(), complete(), complete());
    expect(item(st, ABR).status).toBe("done");
    expect(consumedEffort(st, costs)).toBe(40);
    expect(remainingNeed(st)).toBe(55);
    st = run(st, reopen(3));
    expect(item(st, ABR)).toMatchObject({ status: "active", step: 3 });
    expect(consumedEffort(st, costs)).toBe(0);
    expect(remainingNeed(st)).toBe(95);
    st = run(st, complete());
    expect(item(st, ABR).status).toBe("done");
    expect(consumedEffort(st, costs)).toBe(40); // not 80: no double charge
    expect(remainingNeed(st)).toBe(55);
  });

  it("keeps the note; a reopened skipped step keeps its reason as history", () => {
    let st = run(started(), complete(), { type: "set-step-note", stepsByTask, index: 0, note: "Fine laminations" });
    st = run(st, { type: "skip-step", stepsByTask, reason: "Dusty (simulated)" }, reopen(0), reopen(1));
    expect(stepRecords(item(st, ABR), 4).slice(0, 2)).toEqual([
      { status: "todo", note: "Fine laminations", history: [{ status: "done" }] },
      { status: "todo", history: [{ status: "skipped", reason: "Dusty (simulated)" }] },
    ]);
  });

  it("explains, before confirmation, what reopening a completed action changes", () => {
    const st = run(started(), complete(), complete(), complete(), complete(), { type: "start-task" }, complete());
    const fx = reopenEffects({ state: st, taskId: ABR, index: 3, costs, stepsByTask, titles });
    expect(fx.ok).toBe(true);
    expect(fx.affectsPlan).toBe(true);
    // EVA-1.2: execution and effort accounting are explained separately, then feasibility.
    expect(fx.execution).toEqual([
      "Step 4 becomes not done again. Its earlier state (done) is kept in the step's history.",
      "Abrade and analyse a rock has ended (Completed: all 4 steps done); reopening returns it to in progress at step 4.",
      "Collect a core sample (in progress) is set aside: it goes back into the plan with its steps kept and continues after Abrade and analyse a rock.",
    ]);
    expect(fx.accounting).toEqual([
      "Its 40 pts are released: committed effort goes from 40 to 0 pts, and the remaining plan's estimate from 55 to 95 pts.",
      "They are committed again, once, when the action ends again. Nothing is counted twice and no per-step amount is refunded.",
      "Simulated effort accounting: an action's whole estimated cost is committed when it ends, also if some steps were skipped. Per-step costs are not modelled.",
    ]);
    expect(fx.feasibility).toBe("After reopening, the remaining plan needs 95 of 100 pts available: it fits. The engine's order is re-checked when you confirm.");
    // Reopening within the action in progress does not affect the plan or the effort.
    const inProgress = reopenEffects({ state: run(started(), complete(), complete()), taskId: ABR, index: 0, costs, stepsByTask, titles });
    expect(inProgress).toMatchObject({
      ok: true,
      execution: ["Step 1 becomes not done again. Its earlier state (done) is kept in the step's history.", "The current step becomes step 1."],
      accounting: ["No change: this action is still in progress, so nothing was committed for it yet."],
      feasibility: null,
      affectsPlan: false,
    });
    expect(reopenEffects({ state: started(), taskId: ABR, index: 0, costs, stepsByTask }).ok).toBe(false);
  });

  it("an action in progress is set aside (steps kept) and continues after the reopened one", () => {
    let st = run(started(), complete(), complete(), complete(), complete(), { type: "start-task" }, complete()); // coring at step 2
    st = run(st, reopen(3));
    expect(item(st, ABR).status).toBe("active");
    expect(item(st, CORE)).toMatchObject({ status: "planned", step: 1 });
    expect(stepRecords(item(st, CORE), 4)[0].status).toBe("done");
    st = run(st, complete()); // abrasion done again
    st = run(st, { type: "start-task" });
    expect(item(st, CORE)).toMatchObject({ status: "active", step: 1 }); // continues where it was
    expect(consumedEffort(st, costs)).toBe(40);
  });

  it("todo steps, planned actions and skipped actions are not reopened", () => {
    const st = run(started(), complete());
    expect(run(st, reopen(2))).toBe(st); // a todo step
    expect(run(st, reopen(0, CORE))).toBe(st); // a planned action
    const skipped = run(st, { type: "skip-task", reason: "x" });
    expect(run(skipped, reopen(0))).toBe(skipped);
  });

  it("works with Undo and replanning: Undo reverts a reopen; a reopen after a replan keeps the replan's decisions", () => {
    let st = run(started(), complete(), complete(), complete(), complete());
    const reopened = run(st, reopen(3));
    expect(run(reopened, { type: "undo-step" }).plan).toEqual(st.plan);
    // Replan after completing abrasion: coring is dropped (10 pts left).
    st = run(st, { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: [], costs, stepsByTask }, { type: "accept-replan" });
    expect(item(st, CORE).dropped).toEqual({ by: "replan" });
    expect(st.previous).not.toBeNull();
    const fx = reopenEffects({ state: st, taskId: ABR, index: 3, costs, stepsByTask, titles });
    expect(fx.execution.at(-1)).toBe("Earlier replanning decisions are not changed: dropped actions stay dropped.");
    st = run(st, reopen(3));
    expect(item(st, ABR).status).toBe("active");
    expect(item(st, CORE)).toMatchObject({ status: "skipped", dropped: { by: "replan" } });
    expect(st.previous).toBeNull(); // the replan Undo is not offered any more
    expect(consumedEffort(st, costs)).toBe(0);
  });
});
