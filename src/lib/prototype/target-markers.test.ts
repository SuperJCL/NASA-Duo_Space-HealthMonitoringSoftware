import { describe, expect, it } from "vitest";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { defaultConstraints } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { initialMissionState, missionReducer, parseScenario, simulatedTargets, taskViews, type MissionState } from "./mission-glass";
import { targetMarkers } from "./target-markers";

const { scenario, registry } = loadJezeroMarginScenario();
const geo = loadJezeroGeo();
const s = parseScenario(scenarioJson, scenario, geo.catalog);
const asOf = "2025-05-06";
const { snapshot } = selectEvidenceAsOf(scenario, asOf);
const targets = simulatedTargets(s, geo.catalog);
const costs = Object.fromEntries(scenario.tasks.map((t) => [t.id, t.costs["res-effort"]]));
const stepsByTask = Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length]));
const engine = (budget: number) => {
  const c = { ...defaultConstraints(snapshot), budgets: { "res-effort": budget }, unavailablePlatforms: s.excludedPlatforms };
  const provisional = rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, c);
  return { provisional, views: taskViews({ s, snapshot, provisional, reviewed: rankReviewed(scenario, registry, asOf, DEFAULT_WEIGHTS, c), budget }) };
};
const markers = (budget: number, state: Pick<MissionState, "draft" | "plan">) =>
  targetMarkers({ targets, viewById: new Map(engine(budget).views.map((v) => [v.taskId, v])), state, stepsByTask });
const byTask = (m: ReturnType<typeof markers>) => Object.fromEntries(m.map((x) => [x.taskId, x]));

describe("MAP-1 target markers come from the engine and the shared mission state", () => {
  it("rank and feasibility match the decision service exactly", () => {
    for (const budget of [100, 50, 30, 0]) {
      const { provisional } = engine(budget);
      const m = markers(budget, initialMissionState(budget));
      for (const x of m) {
        const rec = provisional.recommendation;
        expect(x.rank).toBe(rec.ranking.find((r) => r.taskId === x.taskId)?.rank ?? null);
        expect(x.feasible).toBe(!rec.infeasible.some((r) => r.taskId === x.taskId));
      }
    }
  });

  it("orders markers by provisional rank and labels them as provisional", () => {
    const m = markers(100, initialMissionState(100));
    expect(m.map((x) => [x.name, x.badge, x.tone])).toEqual([
      ["Target B", "1", "candidate"],
      ["Target C", "2", "candidate"],
      ["Target A", "3", "candidate"],
    ]);
    expect(m[0].stateText).toBe("Provisional priority #1. Not in the plan.");
    expect(m.every((x) => x.id.startsWith("sim-"))).toBe(true);
  });

  it("updates when the budget changes: coring becomes infeasible and the order changes", () => {
    const m = markers(50, initialMissionState(50));
    expect(m.map((x) => [x.name, x.badge, x.tone, x.status])).toEqual([
      ["Target A", "1", "candidate", ""],
      ["Target B", "2", "candidate", ""],
      ["Target C", "–", "infeasible", "not feasible"],
    ]);
    expect(m[2].stateText).toBe("Not ranked under the current budget. Not feasible: needs 55 pts, 50 pts available.");
  });

  it("shows draft, planned, active, done and skipped states", () => {
    let st = initialMissionState(100);
    st = missionReducer(st, { type: "toggle-draft", taskId: "task-abrasion-proximity" });
    expect(byTask(markers(100, st))["task-abrasion-proximity"]).toMatchObject({ tone: "added", status: "added" });
    st = missionReducer(st, { type: "toggle-draft", taskId: "task-core-for-earth" });
    st = missionReducer(st, { type: "create-plan" });
    expect(byTask(markers(100, st))["task-core-for-earth"]).toMatchObject({ tone: "planned", status: "planned" });
    st = missionReducer(st, { type: "start-task" });
    st = missionReducer(st, { type: "complete-step", stepsByTask });
    expect(byTask(markers(100, st))["task-abrasion-proximity"]).toMatchObject({ tone: "active", status: "in progress", stateText: "Provisional priority #1. In progress: step 2 of 4." });
    for (let n = 0; n < 3; n++) st = missionReducer(st, { type: "complete-step", stepsByTask });
    expect(byTask(markers(60, st))["task-abrasion-proximity"]).toMatchObject({ tone: "done", badge: "✓" });
    expect(byTask(markers(60, st))["task-standoff-survey"].tone).toBe("candidate");
  });

  it("keeps completed state after replanning; dropped work shows as skipped", () => {
    let st = initialMissionState(100);
    for (const id of ["task-abrasion-proximity", "task-core-for-earth"]) st = missionReducer(st, { type: "toggle-draft", taskId: id });
    st = missionReducer(st, { type: "create-plan" });
    st = missionReducer(st, { type: "start-task" });
    for (let n = 0; n < 4; n++) st = missionReducer(st, { type: "complete-step", stepsByTask });
    // Effort cut to 50: 40 committed, 10 available; coring no longer fits.
    st = missionReducer(st, { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: [], costs, stepsByTask });
    expect(byTask(markers(10, st))["task-core-for-earth"]).toMatchObject({ tone: "planned", status: "planned · not feasible" });
    st = missionReducer(st, { type: "accept-replan" });
    const m = byTask(markers(10, st));
    expect(m["task-abrasion-proximity"]).toMatchObject({ tone: "done", badge: "✓" });
    expect(m["task-core-for-earth"]).toMatchObject({ tone: "skipped", status: "skipped", badge: "–" });
  });
});
