import { describe, expect, it } from "vitest";
import { syntheticScenario, syntheticSources } from "@/lib/test-fixtures/synthetic-scenario";
import { checkScenarioIntegrity } from "./integrity";
import { Observation, Scenario, Source } from "./schema";
import { selectEvidenceAsOf } from "./snapshot";

describe("schemas", () => {
  it("accept the synthetic fixture", () => {
    expect(Scenario.safeParse(syntheticScenario()).success).toBe(true);
    for (const s of syntheticSources) expect(Source.safeParse(s).success).toBe(true);
  });

  it("reject impossible dates and unknown fields", () => {
    const obs = syntheticScenario().observations[0];
    expect(Observation.safeParse({ ...obs, availableFrom: "2021-02-30" }).success).toBe(false);
    expect(Observation.safeParse({ ...obs, confidence: 0.9 }).success).toBe(false);
  });

  it("require at least one citation on observations", () => {
    const obs = syntheticScenario().observations[0];
    expect(Observation.safeParse({ ...obs, citations: [] }).success).toBe(false);
  });

  it("require simulated resources to be flagged as simulated", () => {
    const scenario = syntheticScenario();
    const bad = { ...scenario, resources: [{ ...scenario.resources[0], simulated: false }] };
    expect(Scenario.safeParse(bad).success).toBe(false);
  });
});

describe("checkScenarioIntegrity", () => {
  it("passes for the synthetic fixture", () => {
    expect(checkScenarioIntegrity(syntheticScenario(), syntheticSources)).toEqual([]);
  });

  it("flags availableFrom that does not match the earliest cited source", () => {
    const scenario = syntheticScenario();
    scenario.observations[0].availableFrom = "2009-01-01";
    expect(checkScenarioIntegrity(scenario, syntheticSources)).toEqual([
      "observation obs-orbital-a: availableFrom 2009-01-01 must equal earliest cited source date 2010-01-01",
    ]);
  });

  it("flags interpretations supported by later observations (temporal leakage)", () => {
    const scenario = syntheticScenario();
    scenario.interpretations[0].supportingObservationIds.push("obs-rover-later");
    expect(checkScenarioIntegrity(scenario, syntheticSources)).toContain(
      'interpretation interp-1: supported by later observation "obs-rover-later"',
    );
  });

  it("flags dangling references and unknown sources", () => {
    const scenario = syntheticScenario();
    scenario.tasks[0].addressesGapIds.push("gap-missing");
    scenario.tasks[0].costs["res-missing"] = 1;
    scenario.gaps[0].discriminatesInterpretationIds.push("interp-missing");
    scenario.site.citations = [{ sourceId: "src-missing", quote: "q" }];
    const problems = checkScenarioIntegrity(scenario, syntheticSources);
    expect(problems).toEqual(
      expect.arrayContaining([
        'task task-rover-insitu: unknown gap "gap-missing"',
        'task task-rover-insitu: unknown resource "res-missing"',
        'gap gap-origin: unknown interpretation "interp-missing"',
        'site: unknown source "src-missing"',
      ]),
    );
  });

  it("flags duplicate ids", () => {
    const scenario = syntheticScenario();
    scenario.gaps[1].id = "gap-origin";
    expect(checkScenarioIntegrity(scenario, syntheticSources)).toContain('duplicate record id "gap-origin"');
  });
});

describe("selectEvidenceAsOf", () => {
  it("includes only records public on or before the snapshot date", () => {
    const { snapshot, later } = selectEvidenceAsOf(syntheticScenario(), "2012-01-01");
    expect(snapshot.observations.map((o) => o.id)).toEqual(["obs-orbital-a"]);
    expect(snapshot.interpretations.map((i) => i.id)).toEqual(["interp-1"]);
    expect(snapshot.gaps).toEqual([]);
    expect(later.interpretations.map((i) => i.id)).toEqual(["interp-2"]);
    expect(snapshot.hiddenLaterCount).toBe(1 + 3 + 1);
  });

  it("treats the snapshot date as inclusive", () => {
    const { snapshot } = selectEvidenceAsOf(syntheticScenario(), "2015-06-01");
    expect(snapshot.interpretations.map((i) => i.id)).toEqual(["interp-1", "interp-2"]);
  });

  it("marks gaps as addressed once an observation addressing them is public", () => {
    const before = selectEvidenceAsOf(syntheticScenario(), "2020-01-01").snapshot;
    expect(before.gaps.find((g) => g.id === "gap-origin")?.status).toEqual({ state: "open" });

    const after = selectEvidenceAsOf(syntheticScenario(), "2024-03-01").snapshot;
    expect(after.gaps.find((g) => g.id === "gap-origin")?.status).toEqual({
      state: "addressed",
      byObservationIds: ["obs-rover-later"],
    });
  });

  it("strips references to records that did not exist yet", () => {
    const scenario = syntheticScenario();
    // A pre-snapshot observation that (in hindsight) also bears on a later gap.
    scenario.observations[0].addressesGapIds = ["gap-later-only"];
    const { snapshot } = selectEvidenceAsOf(scenario, "2020-01-01");
    expect(snapshot.observations[0].addressesGapIds).toEqual([]);
    expect(snapshot.gaps.map((g) => g.id)).not.toContain("gap-later-only");
  });
});
