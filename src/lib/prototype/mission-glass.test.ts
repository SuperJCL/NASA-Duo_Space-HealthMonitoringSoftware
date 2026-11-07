import { describe, expect, it } from "vitest";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { defaultConstraints } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { loadJezeroGeo } from "@/lib/geo/repository";
import {
  addability,
  consumedEffort,
  engineTies,
  initialMissionState,
  missionReducer,
  parseScenario,
  planFit,
  remaining,
  replanAffected,
  replanChoiceOutcome,
  simulatedTargets,
  taskViews,
  type MissionState,
} from "./mission-glass";

const { scenario, registry } = loadJezeroMarginScenario();
const geo = loadJezeroGeo();
const s = parseScenario(scenarioJson, scenario, geo.catalog);
const asOf = "2025-05-06";
const { snapshot } = selectEvidenceAsOf(scenario, asOf);
const views = (budget: number) => {
  const c = { ...defaultConstraints(snapshot), budgets: { "res-effort": budget }, unavailablePlatforms: s.excludedPlatforms };
  return taskViews({ s, snapshot, provisional: rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, c), reviewed: rankReviewed(scenario, registry, asOf, DEFAULT_WEIGHTS, c), budget, registry });
};
const costs = Object.fromEntries(scenario.tasks.map((t) => [t.id, t.costs["res-effort"]]));
const steps = Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length]));
const DONE = { status: "done" } as const;
const TODO = { status: "todo" } as const;

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
    // SCI-0 A1/A2: the link count says its links are AI-drafted and unreviewed; stability says it covers weights only.
    expect(v[0].rationale).toBe("Linked to 2 of 3 open questions (AI-drafted links, not yet reviewed) · adds close-up rover evidence · 40 pts");
    expect(v[0].conditions[1]).toBe(
      "Weights only: stays #1 in 6 of 6 runs with each scored weight changed by ±20%. Not covered by this check: 47 unreviewed inputs; removing any one of 3 of them alone changes #1.",
    );
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

  it("freezes the draft once a plan exists", () => {
    const st = plan(["task-abrasion-proximity"]);
    expect(missionReducer(st, { type: "toggle-draft", taskId: "task-standoff-survey" })).toBe(st);
    expect(missionReducer(st, { type: "use-suggested", order: ["task-standoff-survey"] })).toBe(st);
    expect(missionReducer(st, { type: "move-draft", taskId: "task-abrasion-proximity", by: 1 })).toBe(st);
  });

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

  const cut = (st: MissionState, budget = 50, ranked = ["task-standoff-survey", "task-abrasion-proximity"]) =>
    missionReducer(st, { type: "constraint-event", budget, label: "Available effort drops to 50 points", rankedTaskIds: ranked, costs, stepsByTask: steps, titles: { "task-core-for-earth": "Core" } });

  it("does not prompt when the plan still fits in the engine's order, but says so", () => {
    const st = cut(plan(["task-standoff-survey"]));
    expect(st.replan).toBeNull();
    expect(st.budget).toBe(50);
    expect(st.notice).toBe("Constraint changed (100 → 50 pts). Your plan still fits: 15 of 50 pts needed.");
  });
});

describe("MG-3 replanning: explain impact, compare, confirm or retain", () => {
  const plan = (draft: string[]): MissionState => {
    let st = initialMissionState(100);
    for (const id of draft) st = missionReducer(st, { type: "toggle-draft", taskId: id });
    return missionReducer(st, { type: "create-plan" });
  };
  const cut = (st: MissionState, ranked = ["task-standoff-survey", "task-abrasion-proximity"]) =>
    missionReducer(st, { type: "constraint-event", budget: 50, label: "Available effort drops to 50 points", rankedTaskIds: ranked, costs, stepsByTask: steps, titles: { "task-core-for-earth": "Core" } });
  const run = (st: MissionState, n: number) => {
    for (let k = 0; k < n; k++) st = missionReducer(st, { type: "complete-step", stepsByTask: steps });
    return st;
  };

  it("names each affected action, separating committed from estimated effort", () => {
    const st = cut(plan(["task-abrasion-proximity", "task-core-for-earth"])); // 95 of 100
    const p = st.replan!;
    expect(p.trigger).toEqual({ label: "Available effort drops to 50 points", from: 100, to: 50 });
    expect([p.committed, p.available, p.remainingNeed]).toEqual([0, 50, 95]);
    expect(p.impact.map((i) => [i.taskId, i.verdict])).toEqual([
      ["task-abrasion-proximity", "fits"],
      ["task-core-for-earth", "too-large"],
    ]);
    expect(p.impact[1].explanation).toBe("Needs 55 pts, more than the 50 pts now available.");
    expect(p.current).toEqual({ order: ["task-abrasion-proximity", "task-core-for-earth"], total: 95, overBy: 45 });
    expect(p.suggested).toEqual({ order: ["task-abrasion-proximity"], total: 40, dropped: ["task-core-for-earth"] });
    expect(p.noFeasible).toBe(false);
    expect(p.reason).toBe("The remaining plan needs 95 pts, but only 50 pts are available (Core no longer fits).");
  });

  it("preserves completed actions and the steps of the action in progress; replans only remaining work", () => {
    let st = plan(["task-standoff-survey", "task-abrasion-proximity"]); // 55
    st = missionReducer(st, { type: "start-task" });
    st = run(st, 4); // survey done (15 committed)
    st = missionReducer(st, { type: "start-task" });
    st = run(st, 2); // abrasion 2 of 4
    st = cut(st, ["task-standoff-survey"]); // engine at 35 pts ranks only the (already done) survey
    // 50 − 15 = 35 available; abrasion (40) no longer fits.
    const p = st.replan!;
    expect([p.committed, p.available, p.remainingNeed]).toEqual([15, 35, 40]);
    expect(p.impact[0]).toMatchObject({ verdict: "kept-done", explanation: "Completed: 15 pts already committed. Kept as done." });
    expect(p.impact[1].explanation).toBe("Needs 40 pts, more than the 35 pts now available. In progress, 2 of 4 steps done; those steps are kept.");
    expect(p.noFeasible).toBe(true);
    expect(p.reason).toBe("Only 35 pts are left after 15 pts committed; the remaining plan needs 40 pts.");
    const ended = missionReducer(st, { type: "accept-replan" });
    expect(ended.plan?.items).toEqual([
      { taskId: "task-standoff-survey", status: "done", step: 4, steps: [DONE, DONE, DONE, DONE], paused: false },
      // EVA-1: the replan-dropped action keeps its completed steps and records who dropped it.
      { taskId: "task-abrasion-proximity", status: "skipped", step: 2, steps: [DONE, DONE, TODO, TODO], paused: false, dropped: { by: "replan" } },
    ]);
    expect(ended.notice).toBe("Remaining work ended: no remaining action fits. Completed work is kept.");
  });

  it("keeps an in-progress action and its steps when it still fits", () => {
    let st = plan(["task-abrasion-proximity", "task-core-for-earth"]);
    st = missionReducer(st, { type: "start-task" });
    st = run(st, 1);
    st = cut(st);
    const accepted = missionReducer(st, { type: "accept-replan" });
    expect(accepted.plan?.items).toEqual([
      { taskId: "task-abrasion-proximity", status: "active", step: 1, steps: [DONE, TODO, TODO, TODO] },
      { taskId: "task-core-for-earth", status: "skipped", step: 0, paused: false, dropped: { by: "replan" } },
    ]);
    expect(accepted.notice).toBe("Plan updated: 1 action(s) dropped by replan. Completed steps are kept.");
  });

  it("never discards silently: keep → retained warning; accept → undo restores the previous plan", () => {
    const st = cut(plan(["task-abrasion-proximity", "task-core-for-earth"]));
    const kept = missionReducer(st, { type: "keep-plan" });
    expect(kept.replan).toBeNull();
    expect(kept.retained).toEqual({ overBy: 45, available: 50 });
    expect(kept.plan?.items.map((i) => [i.taskId, i.status])).toEqual([
      ["task-abrasion-proximity", "planned"],
      ["task-core-for-earth", "planned"],
    ]);
    expect(kept.log.at(-1)).toBe("The user kept a plan that exceeds the available effort by 45 pts.");

    const accepted = missionReducer(st, { type: "accept-replan" });
    expect(accepted.previous?.items.map((i) => i.status)).toEqual(["planned", "planned"]);
    const undone = missionReducer(accepted, { type: "undo-replan", costs });
    expect(undone.plan?.items.map((i) => i.status)).toEqual(["planned", "planned"]);
    // Restoring an infeasible plan is itself an explicit retained state.
    expect(undone.retained).toEqual({ overBy: 45, available: 50 });
    expect(undone.previous).toBeNull();
    // Undo is not offered once the mission moves on.
    expect(missionReducer(accepted, { type: "start-task" }).previous).toBeNull();
  });

  it("a later constraint check that fits clears the retained warning", () => {
    let st = missionReducer(cut(plan(["task-abrasion-proximity", "task-core-for-earth"])), { type: "keep-plan" });
    st = missionReducer(st, { type: "constraint-event", budget: 100, label: "restored", rankedTaskIds: ["task-abrasion-proximity", "task-core-for-earth"], costs, stepsByTask: steps });
    expect(st.retained).toBeNull();
    expect(st.replan).toBeNull();
    expect(st.notice).toMatch(/still fits: 95 of 100/);
  });

  it("explains an action that no longer fits only because of the actions before it", () => {
    let st = plan(["task-abrasion-proximity", "task-standoff-survey"]); // 55
    st = missionReducer(st, { type: "constraint-event", budget: 50, label: "cut", rankedTaskIds: ["task-standoff-survey", "task-abrasion-proximity"], costs, stepsByTask: steps });
    expect(st.replan?.impact[1]).toMatchObject({ verdict: "no-longer-fits", explanation: "Needs 15 pts, but only 10 pts would be left after the actions before it." });
    // The engine's order at 50 puts survey first; 15 + 40 > 50, so only survey fits.
    expect(st.replan?.suggested.order).toEqual(["task-standoff-survey"]);
  });
});

describe("MG-1 plan fit and plain-language feasibility", () => {
  it("keeps a running total and reports what is left or over", () => {
    expect(planFit(["task-abrasion-proximity", "task-core-for-earth"], costs, 100)).toMatchObject({ total: 95, left: 5, overBy: 0 });
    const over = planFit(["task-abrasion-proximity", "task-core-for-earth", "task-standoff-survey"], costs, 100);
    expect(over.overBy).toBe(10);
    expect(over.items.map((i) => i.fits)).toEqual([true, true, false]);
  });

  it("explains fits, no-room, infeasible and in-plan states", () => {
    const v100 = new Map(views(100).map((v) => [v.taskId, v]));
    expect(addability(v100.get("task-abrasion-proximity")!, [], costs, 100)).toEqual({ state: "fits", text: "Fits: 40 pts, leaving 60 pts." });
    expect(addability(v100.get("task-standoff-survey")!, ["task-abrasion-proximity", "task-core-for-earth"], costs, 100)).toEqual({
      state: "no-room",
      text: "Doesn't fit your plan: needs 15 pts, only 5 pts left. Remove an action or raise the budget.",
    });
    expect(addability(v100.get("task-core-for-earth")!, ["task-core-for-earth"], costs, 100).state).toBe("in-plan");
    // Budget lowered below an existing draft: no negative "pts left".
    expect(addability(v100.get("task-standoff-survey")!, ["task-abrasion-proximity", "task-core-for-earth"], costs, 50).text).toBe(
      "Doesn't fit your plan: needs 15 pts, and your plan is already 45 pts over budget. Remove an action or raise the budget.",
    );
    const v50 = new Map(views(50).map((v) => [v.taskId, v]));
    expect(addability(v50.get("task-core-for-earth")!, [], costs, 50)).toEqual({ state: "infeasible", text: "Not possible: needs 55 pts, but the whole budget is 50 pts." });
  });
});

describe("replan change summary (reads the existing engine; no new scoring)", () => {
  /** The engine at a simulated effort, exactly as Mission Glass calls it: order and exact totals from one result. */
  const engine = (budget: number) => {
    const c = { ...defaultConstraints(snapshot), budgets: { "res-effort": budget }, unavailablePlatforms: s.excludedPlatforms };
    const rec = rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, c).recommendation;
    return { rankedTaskIds: rec.ranking.map((r) => r.taskId), scores: Object.fromEntries(rec.ranking.map((r) => [r.taskId, r.total])) };
  };
  const planned = (draft: string[], budget = 100): MissionState => {
    let st = initialMissionState(budget);
    for (const id of draft) st = missionReducer(st, { type: "toggle-draft", taskId: id });
    st = missionReducer(st, { type: "create-plan" });
    return missionReducer(st, { type: "set-mode", mode: "eva" });
  };
  const event = (st: MissionState, budget: number) =>
    missionReducer(st, { type: "constraint-event", budget, label: `Effort ${budget}`, ...engine(budget - consumedEffort(st, costs)), costs, stepsByTask: steps });
  const SURVEY = "task-standoff-survey";
  const ABRADE = "task-abrasion-proximity";
  const CORE = "task-core-for-earth";

  it("100 → 50 pts with the suggested plan: coring is over budget; survey and abrasion tie (engine values)", () => {
    // The suggested order at 100 pts fills abrasion (40) and coring (55); survey (15) no longer fits.
    const st = event(planned([ABRADE, CORE]), 50);
    const p = st.replan!;
    expect([p.trigger.from, p.trigger.to, p.committed, p.available]).toEqual([100, 50, 0, 50]);
    expect(replanAffected(p)).toEqual({ affected: [{ taskId: CORE, cost: 55, verdict: "too-large" }], stillFits: [{ taskId: ABRADE, cost: 40 }] });
    // The tie is the engine's own: identical totals at 50 pts, survey first by lower simulated cost.
    const e = engine(50);
    expect(e.scores[SURVEY]).toBe(e.scores[ABRADE]);
    expect(e.scores[SURVEY]).toBe(0.6285714285714286);
    expect(p.ties).toEqual([{ taskIds: [SURVEY, ABRADE], scorePct: 63, orderedBy: "cost" }]);
    // Coring is not ranked by the engine at 50 pts (over budget).
    expect(e.rankedTaskIds).not.toContain(CORE);
    // Option previews: nothing is applied yet.
    expect(replanChoiceOutcome(p, "suggested")).toEqual({ kept: [ABRADE], removed: [CORE], total: 40, left: 10, orderChanged: false });
    expect(replanChoiceOutcome(p, "current")).toEqual({ kept: [ABRADE, CORE], removed: [], total: 95, left: -45, orderChanged: false });
    expect(st.plan!.items.map((i) => [i.taskId, i.status])).toEqual([
      [ABRADE, "planned"],
      [CORE, "planned"],
    ]);
  });

  it("the preview matches what confirming applies, and Undo restores the plan", () => {
    const st = event(planned([ABRADE, CORE]), 50);
    const o = replanChoiceOutcome(st.replan!, "suggested");
    const after = missionReducer(st, { type: "accept-replan" });
    expect(remaining(after.plan!.items).map((i) => i.taskId)).toEqual(o.kept);
    expect(after.plan!.items.filter((i) => i.dropped?.by === "replan").map((i) => i.taskId)).toEqual(o.removed);
    const undone = missionReducer(after, { type: "undo-replan", costs });
    expect(undone.plan!.items).toEqual(st.plan!.items);
  });

  it("when both tied actions are in the plan, the tie-break decides which one is dropped", () => {
    const p = event(planned([SURVEY, ABRADE]), 50).replan!;
    expect(p.ties[0].taskIds).toEqual([SURVEY, ABRADE]);
    expect(replanChoiceOutcome(p, "suggested")).toEqual({ kept: [SURVEY], removed: [ABRADE], total: 15, left: 35, orderChanged: false });
  });

  it("reports a new order when the engine's order differs from the plan's", () => {
    // Plan in the user's order (survey first) at 100 pts; a re-check at 100 pts follows the engine (abrasion first).
    const p = event(planned([SURVEY, ABRADE]), 100).replan!;
    expect([p.trigger.from, p.trigger.to]).toEqual([100, 100]);
    expect(p.ties).toEqual([]);
    expect(replanChoiceOutcome(p, "suggested")).toEqual({ kept: [ABRADE, SURVEY], removed: [], total: 55, left: 45, orderChanged: true });
    expect(replanChoiceOutcome(p, "current").orderChanged).toBe(false);
  });

  it("finds ties only by exact equality and states the tie-break used", () => {
    expect(engineTies(["a", "b", "c"], { a: 0.5, b: 0.5, c: 0.4 }, { a: 10, b: 20, c: 5 })).toEqual([{ taskIds: ["a", "b"], scorePct: 50, orderedBy: "cost" }]);
    expect(engineTies(["a", "b"], { a: 0.5, b: 0.5 }, { a: 10, b: 10 })[0].orderedBy).toBe("cost-then-id");
    expect(engineTies(["a", "b"], { a: 0.5, b: 0.5 + 1e-15 }, { a: 10, b: 20 })).toEqual([]);
    expect(engineTies(["a", "b"], undefined, {})).toEqual([]);
  });
});
