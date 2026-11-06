import { describe, expect, it } from "vitest";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { defaultConstraints } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { MARS_METERS_PER_DEGREE, greatCircleDistanceM } from "@/lib/map/mars-geodesy";
import { consumedEffort, initialMissionState, missionReducer, parseScenario, planFit, simulatedTargets, taskViews, type MissionState } from "./mission-glass";
import { DRAFT_SEQUENCE_LABEL, SEQUENCE_LABEL, missionSequence, replanSequences } from "./mission-sequence";
import { targetMarkers } from "./target-markers";

const { scenario, registry } = loadJezeroMarginScenario();
const geo = loadJezeroGeo();
const s = parseScenario(scenarioJson, scenario, geo.catalog);
const asOf = "2025-05-06";
const { snapshot } = selectEvidenceAsOf(scenario, asOf);
const targets = simulatedTargets(s, geo.catalog);
const costs = Object.fromEntries(scenario.tasks.map((t) => [t.id, t.costs["res-effort"]]));
const stepsByTask = Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length]));
const titles = Object.fromEntries(s.actions.map((a) => [a.taskId, a.shortTitle]));
const engine = (budget: number) => {
  const c = { ...defaultConstraints(snapshot), budgets: { "res-effort": budget }, unavailablePlatforms: s.excludedPlatforms };
  const provisional = rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, c);
  return taskViews({ s, snapshot, provisional, reviewed: rankReviewed(scenario, registry, asOf, DEFAULT_WEIGHTS, c), budget });
};
const ranked = (budget: number) => engine(budget).filter((v) => v.rank !== null).map((v) => v.taskId);

const A = "task-standoff-survey"; // Target A, 15 pts
const B = "task-abrasion-proximity"; // Target B, 40 pts
const C = "task-core-for-earth"; // Target C, 55 pts

/** Feasibility exactly as Mission Glass passes it: draft fit, or the engine views at the effort still available. */
function feasible(st: MissionState): Record<string, boolean> {
  if (!st.plan) return Object.fromEntries(planFit(st.draft, costs, st.budget).items.map((i) => [i.taskId, i.fits]));
  const views = engine(Math.max(0, st.budget - consumedEffort(st, costs)));
  const markers = targetMarkers({ targets, viewById: new Map(views.map((v) => [v.taskId, v])), state: st, stepsByTask });
  return Object.fromEntries(markers.map((m) => [m.taskId, m.feasible]));
}
const seq = (st: MissionState, tg = targets) => missionSequence({ state: st, targets: tg, stepsByTask, feasibleByTask: feasible(st) });
const order = (st: MissionState) => seq(st).nodes.map((n) => [n.order, n.name, n.state]);
const segs = (st: MissionState) => seq(st).segments.map((x) => [x.from.name, x.to.name, x.state, x.infeasible]);
const run = (st: MissionState, ...actions: Parameters<typeof missionReducer>[1][]) => actions.reduce(missionReducer, st);
const steps = (n: number) => Array.from({ length: n }, () => ({ type: "complete-step" as const, stepsByTask }));
const planOf = (ids: string[], budget = 100) => run(initialMissionState(budget), ...ids.map((taskId) => ({ type: "toggle-draft" as const, taskId })), { type: "create-plan" });
const cut = (st: MissionState, budget: number) => {
  const avail = Math.max(0, budget - consumedEffort(st, costs));
  return missionReducer(st, { type: "constraint-event", budget, label: `cut to ${budget}`, rankedTaskIds: ranked(avail), costs, stepsByTask, titles });
};

describe("MAP-2 draft versus confirmed sequence", () => {
  it("draws nothing before anything is planned", () => {
    const sq = seq(initialMissionState(100));
    expect(sq).toMatchObject({ phase: "none", label: null, segments: [], nodes: [] });
  });

  it("previews the draft in draft order, with plan-order numbers rather than the engine's rank", () => {
    // Engine rank at 100 pts: B #1, C #2, A #3. The user drafts A then B.
    const st = run(initialMissionState(100), { type: "toggle-draft", taskId: A }, { type: "toggle-draft", taskId: B });
    const sq = seq(st);
    expect(sq.phase).toBe("draft");
    expect(sq.label).toBe(DRAFT_SEQUENCE_LABEL);
    expect(order(st)).toEqual([
      [1, "Target A", "draft"],
      [2, "Target B", "draft"],
    ]);
    expect(engine(100).find((v) => v.taskId === A)?.rank).toBe(3); // A is rank 3 but sequence position 1
    expect(segs(st)).toEqual([["Target A", "Target B", "draft", false]]);
  });

  it("reordering the draft reorders the preview; an over-budget tail is marked", () => {
    let st = run(initialMissionState(100), ...[A, B, C].map((taskId) => ({ type: "toggle-draft" as const, taskId })));
    expect(segs(st)).toEqual([
      ["Target A", "Target B", "draft", false],
      ["Target B", "Target C", "draft", true], // 15 + 40 + 55 = 110 > 100: C does not fit at its place
    ]);
    st = missionReducer(st, { type: "move-draft", taskId: C, by: -1 });
    expect(order(st).map((x) => x[1])).toEqual(["Target A", "Target C", "Target B"]);
    expect(segs(st)).toEqual([
      ["Target A", "Target C", "draft", false],
      ["Target C", "Target B", "draft", true],
    ]);
  });

  it("a created plan becomes the confirmed sequence; discarding it removes the confirmed connections", () => {
    let st = planOf([B, C]);
    const sq = seq(st);
    expect(sq.phase).toBe("confirmed");
    expect(sq.label).toBe(SEQUENCE_LABEL);
    expect(sq.currentTaskId).toBe(B);
    expect(order(st)).toEqual([
      [1, "Target B", "planned"],
      [2, "Target C", "planned"],
    ]);
    expect(segs(st)).toEqual([["Target B", "Target C", "remaining", false]]);
    st = missionReducer(st, { type: "reset-plan" });
    // The draft is kept by "Discard plan", so only its preview remains: no confirmed connection.
    expect(seq(st).phase).toBe("draft");
    expect(seq(st).segments.every((x) => x.state === "draft")).toBe(true);
    st = run(st, { type: "toggle-draft", taskId: B }, { type: "toggle-draft", taskId: C });
    expect(seq(st)).toMatchObject({ phase: "none", segments: [] });
  });
});

describe("MAP-2 EVA progress on the sequence", () => {
  it("history, current and remaining connections follow the shared plan state", () => {
    let st = planOf([B, C, A], 120); // 40 + 55 + 15 = 110 of 120 pts
    st = run(st, { type: "start-task" }, ...steps(stepsByTask[B]));
    let sq = seq(st);
    expect(sq.currentTaskId).toBe(C);
    expect(order(st)).toEqual([
      [1, "Target B", "done"],
      [2, "Target C", "planned"],
      [3, "Target A", "planned"],
    ]);
    expect(segs(st)).toEqual([
      ["Target B", "Target C", "current", false],
      ["Target C", "Target A", "remaining", false],
    ]);
    // Target C: skip one step, complete the rest → completed with skipped steps.
    st = run(st, { type: "start-task" }, { type: "skip-step", stepsByTask, reason: "dust" }, ...steps(stepsByTask[C] - 1));
    sq = seq(st);
    expect(sq.nodes[1]).toMatchObject({ state: "done-partial", stateText: "Completed with 1 skipped step", onLine: true });
    expect(segs(st)).toEqual([
      ["Target B", "Target C", "history", false],
      ["Target C", "Target A", "current", false],
    ]);
  });

  it("an action skipped by the user keeps its number but leaves the line", () => {
    let st = planOf([B, C, A]);
    st = run(st, { type: "start-task" }, ...steps(stepsByTask[B]), { type: "skip-task", reason: "time" });
    const sq = seq(st);
    expect(sq.nodes[1]).toMatchObject({ order: 2, name: "Target C", state: "skipped-user", onLine: false, stateText: "Skipped by you: time" });
    expect(segs(st)).toEqual([["Target B", "Target A", "current", false]]);
  });

  it("reopening a completed action keeps the plan order and connections; only states change", () => {
    let st = planOf([B, C, A]);
    st = run(st, { type: "start-task" }, ...steps(stepsByTask[B]), { type: "start-task" }, ...steps(stepsByTask[C]));
    const before = seq(st);
    st = missionReducer(st, { type: "reopen-step", stepsByTask, taskId: B, index: 1, titles });
    const after = seq(st);
    expect(after.nodes.map((n) => [n.order, n.taskId])).toEqual(before.nodes.map((n) => [n.order, n.taskId]));
    expect(after.segments.map((x) => x.id)).toEqual(before.segments.map((x) => x.id));
    expect(after.currentTaskId).toBe(B);
    expect(order(st)).toEqual([
      [1, "Target B", "active"],
      [2, "Target C", "done"],
      [3, "Target A", "planned"],
    ]);
    // The connection into the completed Target C stays "history"; the one into A is still to do.
    expect(segs(st)).toEqual([
      ["Target B", "Target C", "history", false],
      ["Target C", "Target A", "remaining", false],
    ]);
  });
});

describe("MAP-2 replanning: preview, accept, keep, undo, no feasible alternative", () => {
  const started = () => run(planOf([B, C, A]), { type: "start-task" }, ...steps(stepsByTask[B]));

  it("the suggested preview is exactly what accepting produces; dropped work leaves the line", () => {
    let st = cut(started(), 70); // 40 committed, 30 available: C (55) no longer fits, A (15) does
    expect(st.replan).not.toBeNull();
    const preview = replanSequences({ items: st.plan!.items, proposal: st.replan!, targets, stepsByTask });
    expect(preview.suggested.segments.map((x) => [x.from.name, x.to.name, x.state])).toEqual([["Target B", "Target A", "current"]]);
    // "Keep current" uses the dialog's own running fit: C (55) is too large for 30 pts, and A
    // would have nothing left after C, exactly as the impact list says ("No longer fits").
    expect(preview.current.segments.map((x) => [x.from.name, x.to.name, x.infeasible])).toEqual([
      ["Target B", "Target C", true],
      ["Target C", "Target A", true],
    ]);
    expect(st.replan!.impact.map((i) => i.verdict)).toEqual(["kept-done", "too-large", "no-longer-fits"]);
    st = missionReducer(st, { type: "accept-replan" });
    const accepted = seq(st);
    expect(accepted.segments.map((x) => [x.id, x.state])).toEqual(preview.suggested.segments.map((x) => [x.id, x.state]));
    expect(accepted.nodes.map((n) => [n.order, n.name, n.state])).toEqual([
      [1, "Target B", "done"],
      [2, "Target A", "planned"],
      [3, "Target C", "dropped-replan"],
    ]);
    expect(accepted.nodes[2]).toMatchObject({ onLine: false, stateText: "Dropped by replanning" });
  });

  it("keeping an infeasible plan keeps its sequence and marks the connection that no longer fits", () => {
    const before = seq(started());
    const st = missionReducer(cut(started(), 70), { type: "keep-plan" });
    const kept = seq(st);
    expect(st.retained).not.toBeNull();
    expect(kept.segments.map((x) => x.id)).toEqual(before.segments.map((x) => x.id));
    expect(kept.segments.map((x) => [x.to.name, x.infeasible])).toEqual([
      ["Target C", true],
      ["Target A", false],
    ]);
    expect(kept.nodes[1].stateText).toBe("Planned · not feasible under the current constraints");
  });

  it("undo restores the previous sequence", () => {
    const before = seq(missionReducer(cut(started(), 70), { type: "keep-plan" }));
    let st = missionReducer(cut(started(), 70), { type: "accept-replan" });
    st = missionReducer(st, { type: "undo-replan", costs });
    const restored = seq(st);
    expect(restored.segments.map((x) => [x.id, x.state])).toEqual(before.segments.map((x) => [x.id, x.state]));
    expect(restored.nodes.map((n) => [n.order, n.taskId, n.state])).toEqual(before.nodes.map((n) => [n.order, n.taskId, n.state]));
  });

  it("with no feasible alternative nothing new is drawn: no remaining connection is fabricated", () => {
    let st = cut(started(), 45); // 5 pts available: neither C (55) nor A (15) fits
    expect(st.replan?.noFeasible).toBe(true);
    const preview = replanSequences({ items: st.plan!.items, proposal: st.replan!, targets, stepsByTask });
    expect(preview.suggested.segments).toEqual([]);
    expect(preview.suggested.nodes.filter((n) => n.onLine).map((n) => n.name)).toEqual(["Target B"]);
    st = missionReducer(st, { type: "accept-replan" });
    expect(seq(st).segments).toEqual([]);
    expect(seq(st).nodes.map((n) => n.state)).toEqual(["done", "dropped-replan", "dropped-replan"]);
  });
});

describe("MAP-2 geometry: positions are never inferred; separations use the Mars sphere", () => {
  it("a target without a scenario position is a reported gap, never bridged", () => {
    const withoutC = targets.filter((t) => t.taskId !== C);
    const sq = seq(planOf([B, C, A]), withoutC);
    expect(sq.nodes[1]).toMatchObject({ name: C, position: null, targetId: null });
    expect(sq.segments).toEqual([]); // not B → A: that would misstate the plan order
    expect(sq.gaps.map((g) => [g.fromOrder, g.toOrder])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(sq.gaps[0].reason).toMatch(/no scenario position for 2 \(task-core-for-earth\)\. Positions are never inferred\./);
  });

  it("straight-line separations are great-circle distances on the Mars 2000 sphere", () => {
    // 1° of latitude is exactly one degree of the sphere's great circle.
    expect(greatCircleDistanceM([77.3, 18.4], [77.3, 19.4])).toBeCloseTo(MARS_METERS_PER_DEGREE, 6);
    expect(greatCircleDistanceM([77.3, 18.4], [77.3, 18.4])).toBe(0);
    // The scenario places targets by metre offsets from Lefroy Bay; the great-circle
    // separations agree with those offsets to well under a metre.
    const off = Object.fromEntries(s.targets.map((t) => [t.name, t.offsetM]));
    for (const x of seq(planOf([A, B, C], 200)).segments) {
      const a = off[x.from.name];
      const b = off[x.to.name];
      expect(Math.abs(x.straightLineM - Math.hypot(b.east - a.east, b.north - a.north))).toBeLessThan(0.5);
    }
  });
});
