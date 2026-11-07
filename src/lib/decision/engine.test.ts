import { describe, expect, it } from "vitest";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { approved, syntheticScenario } from "@/lib/test-fixtures/synthetic-scenario";
import { DEFAULT_WEIGHTS } from "./criteria";
import { recommend, type CriterionOutcome, type Recommendation } from "./engine";
import { reviewAgainstLaterEvidence } from "./retrospective";

const at = (date: string, scenario = syntheticScenario()) => selectEvidenceAsOf(scenario, date);
const totals = (rec: Recommendation) =>
  Object.fromEntries(rec.ranking.map((r) => [r.taskId, Number(r.total.toFixed(6))]));
const outcome = (rec: Recommendation, taskId: string, criterionId: string): CriterionOutcome =>
  [...rec.ranking, ...rec.unranked].find((r) => r.taskId === taskId)!.outcomes.find((o) => o.criterionId === criterionId)!;

describe("recommend — five criteria", () => {
  it("ranks on the criteria evaluated for every feasible task (hand-computed)", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    // Basis = coverage (w3), feasibility (w2), evidence quality (w2); sum 7.
    // rover:   (3·1   + 2·0.40 + 2·1) / 7
    // orbital: (3·0.5 + 2·0.90 + 2·0) / 7
    // later:   (3·0   + 2·0.95 + 2·0) / 7
    expect(totals(rec)).toEqual({
      "task-rover-insitu": 0.828571,
      "task-orbital-repeat": 0.471429,
      "task-later-gap": 0.271429,
    });
    expect(rec.basis.filter((b) => b.inBasis).map((b) => b.criterionId)).toEqual([
      "gap-coverage",
      "resource-feasibility",
      "evidence-quality",
    ]);
  });

  it("explains why curated criteria are excluded instead of scoring them", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    const disc = rec.basis.find((b) => b.criterionId === "hypothesis-discrimination")!;
    expect(disc.inBasis).toBe(false);
    expect(disc.reason).toBe(
      "Not evaluated for 2 of 3 feasible task(s); excluded so tasks are compared on the same terms.",
    );
    expect(outcome(rec, "task-rover-insitu", "hypothesis-discrimination")).toEqual({
      criterionId: "hypothesis-discrimination",
      status: "not-evaluated",
      reason: "1 assessment(s) drafted but pending human review; not scored.",
    });
    expect(outcome(rec, "task-orbital-repeat", "hypothesis-discrimination")).toMatchObject({
      status: "not-evaluated",
      reason: "The task's open gaps concern 1 local hypothesis(es); discrimination needs at least two.",
    });
    expect(outcome(rec, "task-rover-insitu", "scientific-priority")).toMatchObject({
      status: "not-evaluated",
      reason: "1 cited priority statement(s) drafted but pending human review; not scored.",
    });
  });

  it("treats 'addresses no open gap' as a rule-derived zero, not missing data", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    for (const c of ["gap-coverage", "hypothesis-discrimination", "scientific-priority", "evidence-quality"]) {
      expect(outcome(rec, "task-later-gap", c)).toMatchObject({ status: "evaluated", value: 0 });
    }
  });

  it("explains coverage, flags pending links, and explains evidence quality", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    expect(outcome(rec, "task-rover-insitu", "gap-coverage")).toMatchObject({
      explanation: "Linked to 2 of 2 open local gaps: Origin; Context. 2 link(s) are AI-drafted and pending human review.",
    });
    expect(outcome(rec, "task-rover-insitu", "evidence-quality")).toMatchObject({
      value: 1,
      // SCI-0 A3: the comparison is stated as covering only observations linked to these hypotheses.
      explanation:
        "Would add rover in situ evidence. Closest evidence currently linked to these hypotheses in this dataset: orbital. Other observations may not be linked to them yet.",
    });
    expect(outcome(rec, "task-orbital-repeat", "evidence-quality")).toMatchObject({ value: 0 });
  });

  it("re-scores when later evidence becomes public (gaps get addressed)", () => {
    const rec = recommend(at("2025-01-01").snapshot, DEFAULT_WEIGHTS);
    expect(totals(rec)).toEqual({
      "task-rover-insitu": 0.828571,
      "task-orbital-repeat": 0.685714,
      "task-later-gap": 0.271429,
    });
  });

  it("reports rank stability over the basis criteria only", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    expect(rec.stability.trials).toBe(6);
    expect(rec.stability.topUnchanged).toBe(6);
  });

  it("lists scenario-wide assumptions plus the top task's own", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    expect(rec.assumptionIds).toEqual(["asm-scenario-wide", "asm-rover-access"]);
  });

  it("is deterministic", () => {
    expect(recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS)).toEqual(
      recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS),
    );
  });
});

describe("recommend — approved curated judgements", () => {
  it("scores discrimination and priority once approved and evaluable for every feasible task", () => {
    const scenario = syntheticScenario();
    scenario.discriminationAssessments[0].review = approved;
    scenario.gaps[0].priority!.review = approved;
    const { snapshot } = at("2020-01-01", scenario);
    // Remove the orbital task (its gaps concern only one hypothesis → not evaluable).
    const rec = recommend(snapshot, DEFAULT_WEIGHTS, {
      budgets: { "res-time": 100 },
      unavailablePlatforms: ["orbital"],
    });
    expect(rec.basis.every((b) => b.inBasis)).toBe(true);
    // rover: (3·1 + 3·1 + 2·0.4 + 2·1 + 2·1) / 12 ; later: (2·0.95) / 12
    expect(totals(rec)).toEqual({ "task-rover-insitu": 0.9, "task-later-gap": 0.158333 });
    expect(outcome(rec, "task-rover-insitu", "hypothesis-discrimination")).toMatchObject({
      status: "evaluated",
      value: 1,
      explanation:
        "Approved assessment by Test Reviewer (2026-11-05): possible results would favor or weaken 2 of 2 competing hypotheses: Hypothesis 1; Hypothesis 2.",
    });
  });
});

describe("reviewAgainstLaterEvidence", () => {
  it("compares the top task's gaps with what later evidence addressed", () => {
    const { snapshot, later } = at("2020-01-01");
    const review = reviewAgainstLaterEvidence(recommend(snapshot, DEFAULT_WEIGHTS), later);
    expect(review).toEqual({
      laterObservationIds: ["obs-rover-later"],
      gapsAddressedLater: ["gap-later-only", "gap-origin"],
      topTaskId: "task-rover-insitu",
      topTaskGapsAddressedLater: ["gap-origin"],
      topTaskGapsNotAddressedLater: ["gap-context"],
    });
  });
});
