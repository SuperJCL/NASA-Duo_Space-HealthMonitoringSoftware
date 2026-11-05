import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "./criteria";
import { defaultConstraints, recommend, type Constraints } from "./engine";
import { rankProvisional, rankReviewed } from "./review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import type { Scenario } from "@/lib/evidence/schema";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";

/**
 * MF-1 intentional output-text change (owner-authorised 2026-11-05): the
 * scenario limitation about sample markers was replaced. This test proves
 * that the replacement changes ONLY that limitation string: scores, task
 * order, feasibility, review statuses and replay behaviour stay identical.
 */
const OLD =
  "No Margin Unit outline or sample markers are drawn: no published footprint was found, and the PDS sample coordinates' convention is not stated in the source.";
const NEW =
  "Verified historical sample locations are displayed on the map (in historical replay, only once their source is public); their coordinate convention is inferred by cross-validation. No verified Margin Unit boundary is available, and simulated observation tasks have not been assigned precise geographic locations.";

const { scenario, registry } = loadJezeroMarginScenario();
/** The same scenario with the pre-MF-1 limitation text restored. */
const before: Scenario = { ...scenario, limitations: scenario.limitations.map((l) => (l === NEW ? OLD : l)) };
/** Maps any output back to the old wording, so the comparison isolates the text change. */
const restoreText = <T>(x: T): T => JSON.parse(JSON.stringify(x).split(JSON.stringify(NEW).slice(1, -1)).join(JSON.stringify(OLD).slice(1, -1)));

const DATES = ["2019-11-11", "2023-09-08", "2025-05-06"];
const WEIGHTS = { default: DEFAULT_WEIGHTS, "cost-heavy": { ...DEFAULT_WEIGHTS, "resource-feasibility": 5, "gap-coverage": 1 } };
const variants = (base: Constraints): Record<string, Constraints> => ({
  default: base,
  budget0: { ...base, budgets: { "res-effort": 0 } },
  budget30: { ...base, budgets: { "res-effort": 30 } },
  budget200: { ...base, budgets: { "res-effort": 200 } },
  noPlatforms: { ...base, unavailablePlatforms: ["orbital", "rover", "lab"] },
  noLab: { ...base, unavailablePlatforms: ["lab"] },
});

describe("MF-1 limitation text change", () => {
  it("replaces exactly one scenario limitation", () => {
    expect(scenario.limitations).toContain(NEW);
    expect(scenario.limitations).not.toContain(OLD);
    expect(scenario.limitations.filter((l) => l !== NEW)).toEqual(before.limitations.filter((l) => l !== OLD));
  });

  it("appears in the engine's limitations output", () => {
    const rec = recommend(selectEvidenceAsOf(scenario, "2025-05-06").snapshot, DEFAULT_WEIGHTS, defaultConstraints(selectEvidenceAsOf(scenario, "2025-05-06").snapshot));
    expect(rec.limitations).toContain(NEW);
    expect(rec.limitations.join(" ")).not.toContain("sample markers are drawn");
  });

  for (const date of DATES) {
    it(`changes nothing else on ${date} (36-state grid: engine, provisional and reviewed rankings)`, () => {
      const snapNow = selectEvidenceAsOf(scenario, date).snapshot;
      const snapBefore = selectEvidenceAsOf(before, date).snapshot;
      for (const [vk, c] of Object.entries(variants(defaultConstraints(snapNow)))) {
        for (const [wk, w] of Object.entries(WEIGHTS)) {
          const label = `${date}/${vk}/${wk}`;
          const now = recommend(snapNow, w, c);
          const old = recommend(snapBefore, w, c);
          // Scores, order, feasibility, stability, basis: identical.
          expect(now.ranking, label).toEqual(old.ranking);
          expect(now.unranked, label).toEqual(old.unranked);
          expect(now.infeasible, label).toEqual(old.infeasible);
          expect(now.stability, label).toEqual(old.stability);
          expect(now.basis, label).toEqual(old.basis);
          expect(now.status, label).toEqual(old.status);
          // The only difference anywhere is the limitation wording.
          expect(restoreText(now), label).toEqual(old);
          expect(restoreText(rankProvisional(scenario, registry, date, w, c)), label).toEqual(rankProvisional(before, registry, date, w, c));
          expect(restoreText(rankReviewed(scenario, registry, date, w, c)), label).toEqual(rankReviewed(before, registry, date, w, c));
        }
      }
    });
  }

  it("keeps historical replay behaviour: 11 later records withheld on 2023-09-08, same top tasks", () => {
    const { snapshot } = selectEvidenceAsOf(scenario, "2023-09-08");
    expect(snapshot.hiddenLaterCount).toBe(11);
    const top = (c: Constraints) => recommend(snapshot, DEFAULT_WEIGHTS, c).ranking[0]?.taskId;
    expect(top(defaultConstraints(snapshot))).toBe("task-abrasion-proximity");
    expect(top({ ...defaultConstraints(snapshot), budgets: { "res-effort": 30 } })).toBe("task-standoff-survey");
    const reviewed = rankReviewed(scenario, registry, "2023-09-08", DEFAULT_WEIGHTS);
    expect(reviewed.status.state).toBe("unavailable");
    expect(reviewed.awaitingReview).toHaveLength(28);
  });
});
