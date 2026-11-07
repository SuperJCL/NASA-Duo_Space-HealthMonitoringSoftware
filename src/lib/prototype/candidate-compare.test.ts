import { describe, expect, it } from "vitest";
import compareJson from "@/data/prototype/candidate-compare.json";
import scenarioJson from "@/data/prototype/mission-glass.json";
import sci1Json from "@/data/scenarios/jezero-margin-unit.sci1-proposals.json";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { Sci1Proposals } from "@/lib/evidence/sci1-proposals";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { buildCompareView, CandidateCompareData, compareProblems, costDifferenceText } from "./candidate-compare";
import { loadCandidateCompare } from "./candidate-compare-data";
import { parseScenario } from "./mission-glass";

const { scenario, sources } = loadJezeroMarginScenario();
const s = parseScenario(scenarioJson, scenario, loadJezeroGeo().catalog);
const actionTaskIds = s.actions.map((a) => a.taskId);
const data = CandidateCompareData.parse(compareJson);
const sci1 = Sci1Proposals.parse(sci1Json);
const SURVEY = "task-standoff-survey";
const ABRADE = "task-abrasion-proximity";

describe("candidate comparison data (SCI-1 draft summaries)", () => {
  it("covers every Mission Glass action and cites only SCI-1 evidence about that action", () => {
    expect(compareProblems(data, sci1, actionTaskIds)).toEqual([]);
  });

  it("rejects unknown evidence, evidence about another action, and a missing action", () => {
    const bad = structuredClone(data);
    bad.actions[0].observation.evidenceIds.push("ev-does-not-exist", "ev-cg-texture-either");
    bad.actions.pop();
    expect(compareProblems(bad, sci1, actionTaskIds)).toEqual([
      `${SURVEY}: unknown SCI-1 evidence ev-does-not-exist`,
      `${SURVEY}: SCI-1 evidence ev-cg-texture-either is not about this action`,
      "action task-core-for-earth has no comparison entry",
    ]);
  });

  it("states its scope: pending review, relative to past work, scenario targets, not scored", () => {
    const scope = data.scope.join(" ");
    for (const phrase of ["pending expert review", "relative to the Margin-unit work already done", "not findings", "no verified geology", "Not used for scores, ranks or your plan"]) {
      expect(scope).toContain(phrase);
    }
  });

  it("makes no ranking or value claim", () => {
    const text = JSON.stringify(data.actions);
    expect(text).not.toMatch(/\b(better|best|priority|rank|more valuable|score)\b/i);
  });
});

describe("candidate comparison view (server side)", () => {
  const view = loadCandidateCompare({ asOf: "2025-05-06", sources, actionTaskIds })!;
  const cell = (id: string) => view.cells.find((c) => c.taskId === id)!;

  it("Survey and Abrade differ in observation mode and target, with resolved sources", () => {
    expect(cell(SURVEY).observation.mode).toBe("Stand-off · outcrop scale");
    expect(cell(ABRADE).observation.mode).toBe("Close-up · abraded patch");
    expect(cell(SURVEY).observation.target).toMatch(/sedimentary structures/);
    expect(cell(ABRADE).observation.target).toMatch(/not yet abraded/);
    expect(cell(SURVEY).observation.sources).toEqual(["PDS Pelican Point report", "NASA: Perseverance Science Instruments"]);
    expect(cell(ABRADE).observation.sources).toEqual(["PDS Comet Geyser report", "NASA: Perseverance Science Instruments"]);
    expect(cell(SURVEY).unknowns).toHaveLength(3);
  });

  it("is not shown for an evidence date before the SCI-1 evidence (no later sources in a replay)", () => {
    expect(buildCompareView({ data, sci1, asOf: "2023-09-08", sources, actionTaskIds })).toBeNull();
  });

  it("states the simulated cost difference in plain language", () => {
    expect(costDifferenceText({ name: "Survey the outcrops", cost: 15 }, { name: "Abrade and analyse a rock", cost: 40 })).toBe(
      "Abrade and analyse a rock costs 25 pts more than Survey the outcrops (simulated).",
    );
    expect(costDifferenceText({ name: "A", cost: 40 }, { name: "B", cost: 40 })).toBe("Same simulated cost: 40 pts each.");
  });
});
