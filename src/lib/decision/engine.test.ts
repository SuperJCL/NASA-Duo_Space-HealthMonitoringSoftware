import { describe, expect, it } from "vitest";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { syntheticScenario } from "@/lib/test-fixtures/synthetic-scenario";
import { DEFAULT_WEIGHTS, type Weights } from "./criteria";
import { recommend } from "./engine";
import { reviewAgainstLaterEvidence } from "./retrospective";

const at = (date: string, scenario = syntheticScenario()) => selectEvidenceAsOf(scenario, date);
const totals = (rec: ReturnType<typeof recommend>) =>
  Object.fromEntries(rec.ranking.map((r) => [r.taskId, Number(r.total.toFixed(6))]));

describe("recommend — scoring", () => {
  it("computes rule-derived scores with default weights (3,3,2,2)", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    // rover: coverage 2/2, discrimination 2/2, new platform 1, cost 1-60/100 → (3+3+2+0.8)/10
    // orbital: 1/2, 1/2, 0, 0.9 → (1.5+1.5+0+1.8)/10
    // later-gap task: its only gap is not yet known → 0,0,0, cost 0.95 → 1.9/10
    expect(totals(rec)).toEqual({
      "task-rover-insitu": 0.88,
      "task-orbital-repeat": 0.48,
      "task-later-gap": 0.19,
    });
    expect(rec.ranking.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("excludes over-budget tasks with a reason", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    expect(rec.infeasible).toEqual([
      { taskId: "task-too-expensive", reason: "Needs 150 points of Operations time; simulated budget is 100." },
    ]);
  });

  it("explains each criterion in plain language", () => {
    const top = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS).ranking[0];
    const byId = Object.fromEntries(top.scores.map((s) => [s.criterionId, s.explanation]));
    expect(byId["gap-coverage"]).toBe("Addresses 2 of 2 open evidence gaps: Origin; Context.");
    expect(byId["independent-evidence"]).toBe(
      "Adds rover evidence; existing support for these interpretations: orbital.",
    );
    expect(byId["resource-cost"]).toContain("simulated");
  });

  it("responds to weights: cost-only weighting favours the cheapest task", () => {
    const costOnly: Weights = { "gap-coverage": 0, discrimination: 0, "independent-evidence": 0, "resource-cost": 1 };
    expect(recommend(at("2020-01-01").snapshot, costOnly).ranking[0].taskId).toBe("task-later-gap");
  });

  it("returns zero totals when all weights are zero", () => {
    const zero: Weights = { "gap-coverage": 0, discrimination: 0, "independent-evidence": 0, "resource-cost": 0 };
    const rec = recommend(at("2020-01-01").snapshot, zero);
    expect(rec.ranking.every((r) => r.total === 0)).toBe(true);
  });

  it("re-scores when later evidence becomes public (gaps get addressed)", () => {
    const rec = recommend(at("2025-01-01").snapshot, DEFAULT_WEIGHTS);
    expect(totals(rec)).toEqual({
      "task-rover-insitu": 0.73,
      "task-orbital-repeat": 0.63,
      "task-later-gap": 0.19,
    });
  });

  it("reports rank stability under ±20% weight perturbation", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    expect(rec.stability.trials).toBe(8);
    expect(rec.stability.topUnchanged).toBe(8);
    expect(rec.stability.margin).toBeCloseTo(0.4, 9);
  });
});

describe("recommend — assumptions", () => {
  it("lists scenario-wide assumptions plus the top task's own", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    expect(rec.assumptionIds).toEqual(["asm-scenario-wide", "asm-rover-access"]);
  });
});

describe("recommend — determinism and leakage", () => {
  it("is deterministic", () => {
    const a = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    const b = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    expect(a).toEqual(b);
  });

  it("is unaffected by any change to records published after the snapshot", () => {
    const baseline = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);

    const tampered = syntheticScenario();
    // Rewrite, extend and add future records — none may change the outcome.
    tampered.observations[1].statement = "changed";
    tampered.observations[1].platform = "orbital";
    tampered.observations[1].addressesGapIds = ["gap-context"];
    tampered.observations.push({
      ...tampered.observations[1],
      id: "obs-future-extra",
      addressesGapIds: ["gap-origin"],
    });
    tampered.gaps[2].discriminatesInterpretationIds = ["interp-1", "interp-2"];

    expect(recommend(at("2020-01-01", tampered).snapshot, DEFAULT_WEIGHTS)).toEqual({
      ...baseline,
      limitations: baseline.limitations.map((l) =>
        l.replace("2 later record(s)", "3 later record(s)"),
      ),
    });
  });

  it("never lists post-snapshot evidence ids as used", () => {
    const rec = recommend(at("2020-01-01").snapshot, DEFAULT_WEIGHTS);
    const used = [...rec.evidenceUsed.observationIds, ...rec.evidenceUsed.gapIds];
    expect(used).not.toContain("obs-rover-later");
    expect(used).not.toContain("gap-later-only");
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
