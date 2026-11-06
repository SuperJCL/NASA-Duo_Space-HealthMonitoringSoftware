import { describe, expect, it } from "vitest";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import {
  NOTE_MAX,
  REASON_MAX,
  consumedEffort,
  initialMissionState,
  missionReducer,
  parseScenario,
  remaining,
  stepCounts,
  stepRecords,
  type MissionAction,
  type MissionState,
} from "./mission-glass";

/** EVA-1: individual step management (state transitions only; UI is covered by the smoke test). */
const { scenario } = loadJezeroMarginScenario();
const geo = loadJezeroGeo();
const s = parseScenario(scenarioJson, scenario, geo.catalog);
const stepsByTask = Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length]));
const costs = Object.fromEntries(scenario.tasks.map((t) => [t.id, t.costs["res-effort"]]));
const ABR = "task-abrasion-proximity";
const CORE = "task-core-for-earth";
const SURVEY = "task-standoff-survey";

const run = (st: MissionState, ...actions: MissionAction[]) => actions.reduce(missionReducer, st);
const started = (draft = [ABR, CORE]) =>
  run(initialMissionState(100), ...draft.map((taskId): MissionAction => ({ type: "toggle-draft", taskId })), { type: "create-plan" }, { type: "start-task" });
const active = (st: MissionState) => st.plan!.items.find((i) => i.status === "active")!;
const item = (st: MissionState, id: string) => st.plan!.items.find((i) => i.taskId === id)!;
const complete = (index?: number): MissionAction => ({ type: "complete-step", stepsByTask, index });
const skip = (reason: string, index?: number): MissionAction => ({ type: "skip-step", stepsByTask, index, reason });
const note = (index: number, text: string): MissionAction => ({ type: "set-step-note", stepsByTask, index, note: text });

describe("EVA-1 step state transitions", () => {
  it("completes the current step, or any single step out of order; the current step is the first unresolved one", () => {
    let st = run(started(), complete());
    expect(stepRecords(active(st), 4).map((r) => r.status)).toEqual(["done", "todo", "todo", "todo"]);
    expect(active(st).step).toBe(1);
    st = run(st, complete(3));
    expect(stepRecords(active(st), 4).map((r) => r.status)).toEqual(["done", "todo", "todo", "done"]);
    expect(active(st).step).toBe(1);
    expect(stepCounts(active(st), 4)).toEqual({ done: 2, skipped: 0, todo: 2, current: 1 });
    expect(st.notice).toBe("Step 4 marked done.");
  });

  it("skipping a step requires a reason, which is recorded", () => {
    const st0 = started();
    expect(run(st0, skip(""))).toBe(st0);
    expect(run(st0, skip("   "))).toBe(st0);
    const st = run(st0, skip("  Target obscured by dust (simulated)  "));
    expect(stepRecords(active(st), 4)[0]).toEqual({ status: "skipped", reason: "Target obscured by dust (simulated)" });
    expect(active(st).step).toBe(1);
    expect(st.log.at(-1)).toBe(`Step 1 skipped (Target obscured by dust (simulated)): ${ABR}`);
    const long = run(st0, skip("x".repeat(500)));
    expect(stepRecords(active(long), 4)[0].reason).toHaveLength(REASON_MAX);
  });

  it("a resolved step, a paused step or an out-of-range step is not changed", () => {
    const st = run(started(), complete());
    expect(run(st, complete(0))).toBe(st);
    expect(run(st, skip("again", 0))).toBe(st);
    expect(run(st, complete(4))).toBe(st);
    expect(run(st, complete(-1))).toBe(st);
    const paused = run(st, { type: "pause-step" });
    expect(active(paused).paused).toBe(true);
    expect(run(paused, complete())).toBe(paused);
    expect(run(paused, skip("reason"))).toBe(paused);
    expect(run(paused, { type: "pause-step" })).toBe(paused);
    const resumed = run(paused, { type: "resume-step" });
    expect(active(resumed).paused).toBe(false);
    expect(stepRecords(active(run(resumed, complete())), 4)[1].status).toBe("done");
  });

  it("notes are the user's own text: trimmed, capped, removable, and they change no state or effort", () => {
    const st = run(started(), complete(), note(0, "  Bright vein, simulated observation  "));
    expect(stepRecords(active(st), 4)[0]).toEqual({ status: "done", note: "Bright vein, simulated observation" });
    expect(consumedEffort(st, costs)).toBe(0);
    expect(run(st, note(0, "Bright vein, simulated observation"))).toBe(st);
    expect(stepRecords(active(run(st, note(2, "y".repeat(999)))), 4)[2].note).toHaveLength(NOTE_MAX);
    const cleared = run(st, note(0, ""));
    expect(stepRecords(active(cleared), 4)[0]).toEqual({ status: "done" });
    expect(cleared.notice).toBe("Note removed from step 1.");
  });

  it("completing every step commits the action's simulated effort, also with skipped steps", () => {
    const st = run(started(), complete(), skip("Not needed (simulated)"), complete(), complete());
    expect(item(st, ABR)).toMatchObject({ status: "done", step: 4 });
    expect(stepCounts(item(st, ABR), 4)).toMatchObject({ done: 3, skipped: 1 });
    expect(consumedEffort(st, costs)).toBe(40);
    expect(remaining(st.plan!.items).map((i) => i.taskId)).toEqual([CORE]);
    expect(st.notice).toBe("Step 4 marked done; action completed (simulated).");
  });

  it("skipping every step skips the action (by you), without committing effort", () => {
    const st = run(started(), skip("a"), skip("b"), skip("c"), skip("d"));
    expect(item(st, ABR)).toMatchObject({ status: "skipped", dropped: { by: "user", reason: "Every step was skipped" } });
    expect(consumedEffort(st, costs)).toBe(0);
  });

  it("Undo reverts the last step change, including a completion and its committed effort", () => {
    let st = run(started(), complete(), complete(), complete(), complete());
    expect(consumedEffort(st, costs)).toBe(40);
    st = run(st, { type: "undo-step" });
    expect(item(st, ABR)).toMatchObject({ status: "active", step: 3 });
    expect(consumedEffort(st, costs)).toBe(0);
    expect(st.notice).toBe("Undone: Step 4 marked done.");
    expect(st.stepUndo).toBeNull();
    // One level only.
    expect(run(st, { type: "undo-step" })).toBe(st);
    // Pause and notes can be undone too.
    const p = run(st, { type: "pause-step" }, { type: "undo-step" });
    expect(active(p).paused).toBeFalsy();
  });

  it("Undo is not offered once the mission moves on (next action, or a constraint change)", () => {
    const done = run(started(), complete(), complete(), complete(), complete());
    expect(run(done, { type: "start-task" }).stepUndo).toBeNull();
    const cut = run(started(), complete(), { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: [ABR], costs, stepsByTask });
    expect(cut.stepUndo).toBeNull();
  });

  it("the HUD cannot change the procedure: records never exceed the planned steps", () => {
    let st = started();
    for (let n = 0; n < 10; n++) st = run(st, complete(n), note(n, "x"));
    const all = st.plan!.items.flatMap((i) => i.steps ?? []);
    expect(all.length).toBeLessThanOrEqual(4);
    expect(s.actions.find((a) => a.taskId === ABR)!.steps).toHaveLength(4);
  });
});

describe("EVA-1 with replanning (regression)", () => {
  it("a replan explains and keeps the active action's step records, paused state and notes", () => {
    let st = run(started(), complete(), skip("Not needed (simulated)"), note(0, "Fine laminations"), { type: "pause-step" });
    const before = active(st);
    st = run(st, { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: [SURVEY, ABR], costs, stepsByTask });
    expect(st.replan!.impact[0].explanation).toBe("Still fits: 40 pts. In progress (paused), 1 of 4 steps done, 1 skipped; those steps are kept.");
    st = run(st, { type: "accept-replan" });
    expect(active(st)).toEqual(before);
    expect(item(st, CORE)).toMatchObject({ status: "skipped", dropped: { by: "replan" } });
    // Undo of the replan restores the plan, including the step records.
    const undone = run(st, { type: "undo-replan", costs });
    expect(active(undone)).toEqual(before);
    expect(item(undone, CORE).status).toBe("planned");
  });

  it("a manual skip and a replan drop stay distinguishable in later replans", () => {
    let st = started([ABR, SURVEY, CORE]);
    st = run(st, { type: "skip-task", reason: "Changed priorities (simulated)" }); // abrasion, by the user
    expect(item(st, ABR)).toMatchObject({ status: "skipped", dropped: { by: "user", reason: "Changed priorities (simulated)" } });
    st = run(st, { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: [SURVEY], costs, stepsByTask }, { type: "accept-replan" });
    expect(item(st, CORE).dropped).toEqual({ by: "replan" });
    st = run(st, { type: "constraint-event", budget: 30, label: "cut again", rankedTaskIds: [], costs, stepsByTask });
    const ex = Object.fromEntries((st.replan?.impact ?? []).map((i) => [i.taskId, i.explanation]));
    expect(ex[ABR]).toBe("Skipped earlier by you. Unchanged.");
    expect(ex[CORE]).toBe("Dropped by an earlier replan. Unchanged.");
  });

  it("a step change clears the replan Undo, so Undo never mixes the two", () => {
    let st = run(started(), { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: [ABR], costs, stepsByTask }, { type: "accept-replan" });
    expect(st.previous).not.toBeNull();
    st = run(st, complete());
    expect(st.previous).toBeNull();
    expect(st.stepUndo?.label).toBe("Step 1 marked done");
  });
});
