import { describe, expect, it } from "vitest";
import { syntheticScenario, syntheticSources } from "@/lib/test-fixtures/synthetic-scenario";
import { checkScenarioIntegrity } from "./integrity";
import { Observation, Review, Scenario, Source } from "./schema";
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

  it("require citations, a relevance class and simulated flags", () => {
    const scenario = syntheticScenario();
    const obs = scenario.observations[0];
    expect(Observation.safeParse({ ...obs, citations: [] }).success).toBe(false);
    const noRelevance = Object.fromEntries(Object.entries(obs).filter(([k]) => k !== "relevance"));
    expect(Observation.safeParse(noRelevance).success).toBe(false);
    const bad = { ...scenario, resources: [{ ...scenario.resources[0], simulated: false }] };
    expect(Scenario.safeParse(bad).success).toBe(false);
  });

  it("require a reviewer and date for approved or rejected judgements", () => {
    expect(Review.safeParse({ draftedBy: "ai-agent", status: "approved" }).success).toBe(false);
    expect(
      Review.safeParse({ draftedBy: "ai-agent", status: "approved", reviewedBy: "A", reviewedOn: "2026-11-05" })
        .success,
    ).toBe(true);
  });
});

describe("checkScenarioIntegrity", () => {
  it("passes for the synthetic fixture", () => {
    expect(checkScenarioIntegrity(syntheticScenario(), syntheticSources)).toEqual([]);
  });

  it("requires availableFrom to equal the latest cited source date", () => {
    const scenario = syntheticScenario();
    scenario.observations[0].availableFrom = "2009-01-01";
    expect(checkScenarioIntegrity(scenario, syntheticSources)).toEqual([
      "observation obs-orbital-a: availableFrom 2009-01-01 must equal latest cited source date 2010-01-01",
    ]);
    const multi = syntheticScenario();
    multi.observations[0].citations.push({ sourceId: "src-2015", quote: "later quote" });
    expect(checkScenarioIntegrity(multi, syntheticSources)).toContain(
      "observation obs-orbital-a: availableFrom 2010-01-01 must equal latest cited source date 2015-06-01",
    );
  });

  it("rejects an observation date after its public availability date", () => {
    const scenario = syntheticScenario();
    scenario.observations[0].observedOn = "2012-01-01";
    expect(checkScenarioIntegrity(scenario, syntheticSources)).toEqual([
      "observation obs-orbital-a: observedOn 2012-01-01 is after availableFrom 2010-01-01",
    ]);
  });

  it("rejects interpretations supported by later observations", () => {
    const scenario = syntheticScenario();
    scenario.interpretations[0].supportingObservationIds.push("obs-rover-later");
    expect(checkScenarioIntegrity(scenario, syntheticSources)).toContain(
      'interpretation interp-1: supported by later observation "obs-rover-later"',
    );
  });

  it("requires always-visible citations (site, assumptions) to predate minSnapshotDate", () => {
    const scenario = syntheticScenario();
    scenario.assumptions[0].citations = [{ sourceId: "src-2024", quote: "q" }];
    expect(checkScenarioIntegrity(scenario, syntheticSources)).toEqual([
      "assumption asm-rover-access: cites a source published 2024-03-01, after minSnapshotDate 2010-01-01",
    ]);
  });

  it("requires curated items to wait for their citations", () => {
    const scenario = syntheticScenario();
    scenario.tasks[3].addresses[0].availableFrom = "2015-06-01";
    scenario.gaps[0].priority!.citations = [{ sourceId: "src-2024", quote: "q" }];
    const problems = checkScenarioIntegrity(scenario, syntheticSources);
    expect(problems).toContain(
      "task task-later-gap link gap-later-only: availableFrom must equal latest cited source date 2024-03-01",
    );
    expect(problems).toContain("gap gap-origin: priority cites a source (2024-03-01) published after the gap (2015-06-01)");
  });

  it("flags dangling references, unknown sources and duplicate ids", () => {
    const scenario = syntheticScenario();
    scenario.tasks[0].addresses.push({ gapId: "gap-missing", rationale: "x", citations: [], review: scenario.tasks[0].addresses[0].review });
    scenario.tasks[0].costs["res-missing"] = 1;
    scenario.site.citations = [{ sourceId: "src-missing", quote: "q" }];
    scenario.gaps[1].id = "gap-origin";
    expect(checkScenarioIntegrity(scenario, syntheticSources)).toEqual(
      expect.arrayContaining([
        'task task-rover-insitu: unknown gap "gap-missing"',
        'task task-rover-insitu: unknown resource "res-missing"',
        'site: unknown source "src-missing"',
        'duplicate record id "gap-origin"',
      ]),
    );
  });
});

describe("selectEvidenceAsOf", () => {
  it("includes only records public on or before the snapshot date (inclusive)", () => {
    const { snapshot, later } = selectEvidenceAsOf(syntheticScenario(), "2012-01-01");
    expect(snapshot.observations.map((o) => o.id)).toEqual(["obs-orbital-a", "obs-regional"]);
    expect(snapshot.interpretations.map((i) => i.id)).toEqual(["interp-1", "interp-regional"]);
    expect(snapshot.gaps.map((g) => g.id)).toEqual(["gap-regional"]);
    expect(later.interpretations.map((i) => i.id)).toEqual(["interp-2"]);
    expect(snapshot.hiddenLaterCount).toBe(1 + 1 + 3);
    const onDate = selectEvidenceAsOf(syntheticScenario(), "2015-06-01").snapshot;
    expect(onDate.interpretations.map((i) => i.id)).toContain("interp-2");
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

  it("drops task links, assessments and hypothesis references that are not yet public", () => {
    const scenario = syntheticScenario();
    scenario.gaps[0].availableFrom = "2010-01-01";
    scenario.gaps[0].origin = { kind: "derived", rule: "fixture" };
    delete scenario.gaps[0].priority;
    const early = selectEvidenceAsOf(scenario, "2012-01-01").snapshot;
    expect(early.gaps.find((g) => g.id === "gap-origin")?.discriminatesInterpretationIds).toEqual(["interp-1"]);
    expect(early.discriminationAssessments).toEqual([]);
    expect(early.tasks.find((t) => t.id === "task-later-gap")?.addresses).toEqual([]);
    const late = selectEvidenceAsOf(scenario, "2024-03-01").snapshot;
    expect(late.tasks.find((t) => t.id === "task-later-gap")?.addresses.map((l) => l.gapId)).toEqual([
      "gap-later-only",
    ]);
  });

  it("strips ids of gaps that did not exist yet from visible observations", () => {
    const scenario = syntheticScenario();
    scenario.observations[0].addressesGapIds = ["gap-later-only"];
    const { snapshot } = selectEvidenceAsOf(scenario, "2020-01-01");
    expect(snapshot.observations[0].addressesGapIds).toEqual([]);
  });
});
