import { describe, expect, it } from "vitest";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { defaultConstraints } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { initialMissionState, missionReducer, parseScenario, simulatedTargets, taskViews, type MissionState } from "./mission-glass";

const { scenario, registry } = loadJezeroMarginScenario();
const geo = loadJezeroGeo();
const s = parseScenario(scenarioJson, scenario, geo.catalog);
const asOf = "2025-05-06";
const { snapshot } = selectEvidenceAsOf(scenario, asOf);
const views = (budget: number) => {
  const c = { ...defaultConstraints(snapshot), budgets: { "res-effort": budget }, unavailablePlatforms: s.excludedPlatforms };
  return taskViews({ s, snapshot, provisional: rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, c), reviewed: rankReviewed(scenario, registry, asOf, DEFAULT_WEIGHTS, c), budget });
};
const costs = Object.fromEntries(scenario.tasks.map((t) => [t.id, t.costs["res-effort"]]));
const steps = Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length]));

describe("scenario and simulated targets", () => {
  it("uses exactly the three surface tasks of the existing scenario", () => {
    expect(s.actions.map((a) => a.taskId).sort()).toEqual(["task-abrasion-proximity", "task-core-for-earth", "task-standoff-survey"]);
  });

  it("derives simulated targets from the verified Lefroy Bay site, labelled scenario-defined", () => {
    const t = simulatedTargets(s, geo.catalog);
    expect(t).toHaveLength(3);
    expect(t.every((x) => x.basis === "scenario-defined" && x.id.startsWith("sim-"))).toBe(true);
    expect(t.map((x) => x.distanceFromAnchorM)).toEqual([163, 118, 138]);
    // Never written into the verified geographic catalog.
    expect(geo.catalog.records.some((r) => r.id.startsWith("sim-"))).toBe(false);
  });

  it("rejects a scenario that adds a task from an excluded platform", () => {
    const bad = structuredClone(scenarioJson);
    bad.actions[0].taskId = "task-orbital-stereo";
    expect(() => parseScenario(bad, scenario, geo.catalog)).toThrow(/excluded platform/);
  });
});

describe("task views read the existing engine (no new scoring)", () => {
  it("ranks abrasion, coring, survey at 100 simulated points", () => {
    const v = views(100);
    expect(v.map((x) => [x.taskId, x.rank, x.status])).toEqual([
      ["task-abrasion-proximity", 1, "fits"],
      ["task-core-for-earth", 2, "fits"],
      ["task-standoff-survey", 3, "fits"],
    ]);
    expect(v[0].rationale).toBe("Covers 2 of 3 open questions · adds close-up rover evidence · 40 pts");
    expect(v[0].conditions[1]).toBe("Stays #1 in 6 of 6 runs with each weight changed by ±20%.");
    expect(v[0].engineNotes.find((n) => n.criterion === "hypothesis-discrimination")?.evaluated).toBe(false);
  });

  it("drops coring and reorders at 50 points, as the engine does", () => {
    const v = views(50);
    expect(v.map((x) => [x.taskId, x.rank, x.status])).toEqual([
      ["task-standoff-survey", 1, "fits"],
      ["task-abrasion-proximity", 2, "fits"],
      ["task-core-for-earth", null, "over-budget"],
    ]);
    expect(v[2].statusText).toBe("Needs 55 pts, budget is 50");
  });
});

describe("shared mission state (Planning ↔ EVA)", () => {
  const plan = (draft: string[], budget = 100): MissionState => {
    let st = initialMissionState(budget);
    for (const id of draft) st = missionReducer(st, { type: "toggle-draft", taskId: id });
    return missionReducer(st, { type: "create-plan" });
  };

  it("builds, reorders and creates a plan", () => {
    let st = missionReducer(initialMissionState(100), { type: "toggle-draft", taskId: "a" });
    st = missionReducer(st, { type: "toggle-draft", taskId: "b" });
    st = missionReducer(st, { type: "move-draft", taskId: "b", by: -1 });
    expect(st.draft).toEqual(["b", "a"]);
    st = missionReducer(st, { type: "create-plan" });
    expect(st.plan?.items.map((i) => i.status)).toEqual(["planned", "planned"]);
  });

  it("steps through a task in EVA and records it done", () => {
    let st = plan(["task-abrasion-proximity", "task-standoff-survey"]);
    st = missionReducer(st, { type: "start-task" });
    expect(st.plan?.items[0].status).toBe("active");
    for (let n = 0; n < 4; n++) st = missionReducer(st, { type: "complete-step", stepsByTask: steps });
    expect(st.plan?.items[0].status).toBe("done");
    expect(st.plan?.items[1].status).toBe("planned");
  });

  it("prompts a replan when a constraint change makes the plan exceed the remaining effort", () => {
    let st = plan(["task-abrasion-proximity", "task-core-for-earth"]); // 95 of 100
    st = missionReducer(st, { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: ["task-standoff-survey", "task-abrasion-proximity"], costs });
    expect(st.replan?.reason).toBe("The remaining plan needs 95 points, but only 50 simulated points are left.");
    expect(st.replan?.suggested).toEqual(["task-abrasion-proximity"]);
    const kept = missionReducer(st, { type: "keep-plan" });
    expect(kept.replan).toBeNull();
    expect(kept.plan?.items.map((i) => i.taskId)).toEqual(["task-abrasion-proximity", "task-core-for-earth"]);
    const accepted = missionReducer(st, { type: "accept-replan" });
    expect(accepted.plan?.items.map((i) => [i.taskId, i.status])).toEqual([
      ["task-abrasion-proximity", "planned"],
      ["task-core-for-earth", "skipped"],
    ]);
  });

  it("does not prompt when the plan still fits in the engine's order", () => {
    let st = plan(["task-standoff-survey"]);
    st = missionReducer(st, { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: ["task-standoff-survey", "task-abrasion-proximity"], costs });
    expect(st.replan).toBeNull();
    expect(st.budget).toBe(50);
  });
});
