/**
 * Scientific integrity tests (M3 acceptance criteria §6).
 * Synthetic fixture only; real-data guards live in lib/evidence/jezero-data.test.ts.
 */
import { describe, expect, it } from "vitest";
import { checkScenarioIntegrity } from "@/lib/evidence/integrity";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { approved, pending, syntheticScenario, syntheticSources } from "@/lib/test-fixtures/synthetic-scenario";
import { DEFAULT_WEIGHTS, type Weights } from "./criteria";
import { recommend, type Recommendation } from "./engine";

const recAt = (date: string, scenario = syntheticScenario(), constraints?: Parameters<typeof recommend>[2]) =>
  recommend(selectEvidenceAsOf(scenario, date).snapshot, DEFAULT_WEIGHTS, constraints);
const outcome = (rec: Recommendation, taskId: string, criterionId: string) =>
  [...rec.ranking, ...rec.unranked].find((r) => r.taskId === taskId)?.outcomes.find((o) => o.criterionId === criterionId);
const withoutCount = (rec: Recommendation) => ({ ...rec, limitations: rec.limitations.slice(1) });

describe("1. Future evidence cannot change earlier recommendations", () => {
  it("rewriting, extending and adding post-snapshot records leaves the recommendation identical", () => {
    const baseline = recAt("2020-01-01");

    const t = syntheticScenario();
    t.observations[2].statement = "changed";
    t.observations[2].addressesGapIds = ["gap-context"]; // would close a gap if it leaked
    t.observations.push({ ...t.observations[2], id: "obs-future-extra", addressesGapIds: ["gap-origin"] });
    t.interpretations.push({ ...t.interpretations[1], id: "interp-future", availableFrom: "2024-03-01", citations: [{ sourceId: "src-2024", quote: "q" }] });
    t.gaps[3].discriminatesInterpretationIds = ["interp-1", "interp-2"];
    // A future approved assessment and a future-cited link must not leak either.
    t.discriminationAssessments.push({
      id: "da-future",
      taskId: "task-orbital-repeat",
      hypothesisIds: ["interp-1", "interp-2"],
      outcomes: [{ ifObserved: "x", favors: ["interp-1"], weakens: [] }],
      rationale: "x",
      citations: [{ sourceId: "src-2024", quote: "q" }],
      availableFrom: "2024-03-01",
      review: approved,
    });
    t.tasks[1].addresses.push({
      gapId: "gap-origin",
      rationale: "future link",
      citations: [{ sourceId: "src-2024", quote: "q" }],
      availableFrom: "2024-03-01",
      review: approved,
    });
    expect(checkScenarioIntegrity(t, syntheticSources)).toEqual([]);

    expect(withoutCount(recAt("2020-01-01", t))).toEqual(withoutCount(baseline));
  });

  it("uses public availability, never the observation date, for visibility", () => {
    const t = syntheticScenario();
    t.observations[2].observedOn = "2011-01-01"; // observed early, published 2024
    const { snapshot } = selectEvidenceAsOf(t, "2020-01-01");
    expect(snapshot.observations.map((o) => o.id)).not.toContain("obs-rover-later");
  });
});

describe("2. Regional geological context is not misrepresented as a local observation", () => {
  it("rejects regional context used as local support, to address a local gap, or as a hypothesis", () => {
    const t = syntheticScenario();
    t.interpretations[0].supportingObservationIds.push("obs-regional");
    t.observations[1].addressesGapIds = ["gap-origin"];
    t.gaps[0].discriminatesInterpretationIds.push("interp-regional");
    t.discriminationAssessments[0].hypothesisIds.push("interp-regional");
    expect(checkScenarioIntegrity(t, syntheticSources)).toEqual(
      expect.arrayContaining([
        'interpretation interp-1: regional-context observation "obs-regional" cannot be local support (use contextRecordIds)',
        'observation obs-regional: regional-context record cannot address local gap "gap-origin"',
        'gap gap-origin: regional-context interpretation "interp-regional" cannot be a competing hypothesis',
        'assessment da-rover: "interp-regional" is regional context, not a local hypothesis',
      ]),
    );
  });

  it("does not count regional gaps toward coverage, and ranks context below orbital evidence", () => {
    const rec = recAt("2020-01-01");
    expect(outcome(rec, "task-rover-insitu", "gap-coverage")).toMatchObject({ value: 1 }); // 2 of 2 local, regional ignored
    // Hypothesis 2 has only regional context; Hypothesis 1 has local orbital support → best = orbital.
    expect(outcome(rec, "task-orbital-repeat", "evidence-quality")).toMatchObject({ value: 0 });
  });
});

describe("3. Unsupported hypothesis relationships cannot generate discrimination scores", () => {
  it("pending and rejected assessments are not scored", () => {
    expect(outcome(recAt("2020-01-01"), "task-rover-insitu", "hypothesis-discrimination")).toMatchObject({
      status: "not-evaluated",
    });
    const t = syntheticScenario();
    t.discriminationAssessments[0].review = { ...approved, status: "rejected" };
    expect(outcome(recAt("2020-01-01", t), "task-rover-insitu", "hypothesis-discrimination")).toMatchObject({
      status: "not-evaluated",
      reason: "No curated assessment explains how this task's possible results would favor or weaken the competing hypotheses.",
    });
  });

  it("an approved assessment cannot score a task whose gaps concern fewer than two hypotheses", () => {
    const t = syntheticScenario();
    t.discriminationAssessments[0] = { ...t.discriminationAssessments[0], taskId: "task-orbital-repeat", review: approved };
    // Integrity rejects it (interp-2 is not concerned by the orbital task's gaps) ...
    expect(checkScenarioIntegrity(t, syntheticSources)).toContain(
      'assessment da-rover: "interp-2" is not concerned by any gap the task addresses',
    );
    // ... and the engine still refuses to score it.
    expect(outcome(recAt("2020-01-01", t), "task-orbital-repeat", "hypothesis-discrimination")).toMatchObject({
      status: "not-evaluated",
    });
  });

  it("rejects outcomes that favor or weaken nothing, or both favor and weaken the same hypothesis", () => {
    const t = syntheticScenario();
    t.discriminationAssessments[0].outcomes = [
      { ifObserved: "a", favors: [], weakens: [] },
      { ifObserved: "b", favors: ["interp-1"], weakens: ["interp-1"] },
    ];
    expect(checkScenarioIntegrity(t, syntheticSources)).toEqual(
      expect.arrayContaining([
        "assessment da-rover: outcome 1 favors/weakens nothing",
        "assessment da-rover: outcome 2 both favors and weakens a hypothesis",
      ]),
    );
  });
});

describe("4. Changing mission constraints gives deterministic, explainable outcomes", () => {
  it("a smaller budget excludes tasks with a stated reason and re-ranks deterministically", () => {
    const constraints = { budgets: { "res-time": 50 }, unavailablePlatforms: [] };
    const a = recAt("2020-01-01", syntheticScenario(), constraints);
    const b = recAt("2020-01-01", syntheticScenario(), constraints);
    expect(a).toEqual(b);
    expect(a.infeasible).toContainEqual({
      taskId: "task-rover-insitu",
      reason: "Needs 60 points of Operations time; simulated budget is 50.",
    });
    expect(a.ranking[0].taskId).toBe("task-orbital-repeat");
  });

  it("an unavailable platform excludes its tasks with a stated reason", () => {
    const rec = recAt("2020-01-01", syntheticScenario(), { budgets: { "res-time": 1000 }, unavailablePlatforms: ["lab"] });
    expect(rec.infeasible).toEqual([
      { taskId: "task-too-expensive", reason: 'Platform "lab" is unavailable under the current constraints.' },
    ]);
  });

  it("a larger budget raises feasibility values monotonically", () => {
    const low = recAt("2020-01-01", syntheticScenario(), { budgets: { "res-time": 100 }, unavailablePlatforms: [] });
    const high = recAt("2020-01-01", syntheticScenario(), { budgets: { "res-time": 200 }, unavailablePlatforms: [] });
    const v = (r: Recommendation) => (outcome(r, "task-rover-insitu", "resource-feasibility") as { value: number }).value;
    expect(v(high)).toBeGreaterThan(v(low));
    expect(v(low)).toBeCloseTo(0.4, 9);
    expect(v(high)).toBeCloseTo(0.7, 9);
  });
});

describe("5. Missing data is explicitly handled", () => {
  it("a missing cost makes a task unrankable instead of free", () => {
    const t = syntheticScenario();
    delete t.tasks[1].costs["res-time"];
    expect(recAt("2020-01-01", t).infeasible).toContainEqual({
      taskId: "task-orbital-repeat",
      reason: 'Missing simulated cost for "Operations time"; feasibility cannot be assessed.',
    });
  });

  it("no open gaps → coverage is Not Evaluated, not zero", () => {
    const t = syntheticScenario();
    t.observations[0].addressesGapIds = ["gap-origin", "gap-context"];
    t.observations[0].availableFrom = "2015-06-01";
    t.observations[0].citations = [{ sourceId: "src-2015", quote: "q" }];
    t.interpretations[0].supportingObservationIds = [];
    const rec = recAt("2020-01-01", t);
    expect(outcome(rec, "task-rover-insitu", "gap-coverage")).toEqual({
      criterionId: "gap-coverage",
      status: "not-evaluated",
      reason: "No local evidence gap is open on the snapshot date.",
    });
  });

  it("all-zero weights → no ranking, with a reason", () => {
    const zero = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0])) as Weights;
    const rec = recommend(selectEvidenceAsOf(syntheticScenario(), "2020-01-01").snapshot, zero);
    expect(rec.status).toEqual({
      state: "not-ranked",
      reason: "No criterion with a non-zero weight is evaluated for every feasible task.",
    });
    expect(rec.ranking).toEqual([]);
    expect(rec.unranked.length).toBe(3);
  });

  it("no feasible task → no ranking, with a reason", () => {
    const rec = recAt("2020-01-01", syntheticScenario(), { budgets: { "res-time": 1 }, unavailablePlatforms: [] });
    expect(rec.status).toEqual({ state: "not-ranked", reason: "No task is feasible under the current constraints." });
  });
});

describe("6. Citations stay valid", () => {
  it("every citation in the fixture resolves to a known source (integrity)", () => {
    const t = syntheticScenario();
    t.discriminationAssessments[0].citations = [{ sourceId: "src-unknown", quote: "q" }];
    expect(checkScenarioIntegrity(t, syntheticSources)).toContain('assessment da-rover: unknown source "src-unknown"');
  });

  it("pending review is the default state for AI-drafted judgements in the fixture", () => {
    expect(syntheticScenario().tasks[0].addresses[0].review).toEqual(pending);
  });
});
