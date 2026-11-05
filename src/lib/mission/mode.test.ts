import { describe, expect, it } from "vitest";
import missionJson from "@/data/missions/jezero-2026.json";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { latestRecordDate, loadMission, missionContext, selectGeoFeatures } from "./mode";

const { scenario, registry } = loadJezeroMarginScenario();
const mission = loadMission();
const geo = loadJezeroGeo();

describe("mission config", () => {
  it("defaults to the simulated present-day (2026) astronaut mission", () => {
    expect(mission.defaultMode).toBe("present-day");
    expect(mission.missionYear).toBe(2026);
    expect(mission.persona).toBe("astronaut");
    expect(mission.scenarioId).toBe(scenario.id);
  });

  it("never presents the simulation as a NASA mission, a real astronaut mission or live telemetry", () => {
    expect(mission.disclaimer).toMatch(/not a NASA mission/);
    expect(mission.disclaimer).toMatch(/not a real astronaut mission/);
    expect(mission.disclaimer).toMatch(/not live telemetry/);
    expect(mission.disclaimer).toMatch(/historical/);
    expect(mission.actionFraming).toMatch(/Simulated future action, not a NASA plan/);
    expect(mission.actionFraming).toMatch(/rover, orbital or laboratory/);
  });

  it("records the pending 2026 reassessment of the four candidate actions (R4)", () => {
    expect(mission.caveats.join(" ")).toMatch(/curated for the 2023 .*reassessment for a 2026 mission is pending \(research task R4\)/);
    expect(mission.caveats.join(" ")).toMatch(/provisional, never as validated/);
  });

  it("rejects an invalid config", () => {
    expect(() => loadMission({ ...missionJson, persona: "rover" })).toThrow(/Invalid mission config/);
    expect(() => loadMission({ ...missionJson, presentDay: { evidenceNote: "no placeholder" } })).toThrow();
  });
});

describe("present-day mode", () => {
  const ctx = missionContext(mission, scenario);

  it("uses the latest verified record date in the dataset (2025-05-06), not the mission year", () => {
    expect(ctx.mode).toBe("present-day");
    expect(ctx.latestRecordDate).toBe("2025-05-06");
    expect(ctx.evidenceAsOf).toBe("2025-05-06");
    expect(latestRecordDate(scenario)).toBe("2025-05-06");
  });

  it("says the evidence is the latest in this dataset, not all NASA data", () => {
    expect(ctx.evidenceNote).toBe(
      "Uses the latest verified evidence in this app's dataset, through 2025-05-06. This is not all NASA data, and newer findings may exist.",
    );
    expect(ctx.evidenceNote).not.toMatch(/latest NASA data/i);
  });

  it("withholds no scientific record", () => {
    expect(selectEvidenceAsOf(scenario, ctx.evidenceAsOf).snapshot.hiddenLaterCount).toBe(0);
  });

  it("shows every verified geographic feature", () => {
    const sel = selectGeoFeatures(geo, ctx);
    expect(sel.withheld).toEqual([]);
    expect(sel.features.filter((f) => f.kind === "sample-site")).toHaveLength(3);
    expect(sel.features.filter((f) => f.kind === "traverse-segment")).toHaveLength(332);
    expect(sel.features.filter((f) => f.kind === "rover-last-position")).toHaveLength(1);
  });

  it("leaves the engine's behaviour unchanged: same rankings as the existing all-evidence state", () => {
    const viaMission = rankProvisional(scenario, registry, ctx.evidenceAsOf, DEFAULT_WEIGHTS);
    const direct = rankProvisional(scenario, registry, "2025-05-06", DEFAULT_WEIGHTS);
    expect(viaMission).toEqual(direct);
    expect(viaMission.recommendation.ranking.map((r) => r.taskId)).toEqual([
      "task-abrasion-proximity",
      "task-core-for-earth",
      "task-standoff-survey",
      "task-orbital-stereo",
    ]);
    const reviewed = rankReviewed(scenario, registry, ctx.evidenceAsOf, DEFAULT_WEIGHTS);
    expect(reviewed.status.state).toBe("unavailable");
    expect(reviewed.awaitingReview).toHaveLength(50);
  });
});

describe("historical replay mode", () => {
  it("defaults to the scenario's snapshot date and withholds later records", () => {
    const ctx = missionContext(mission, scenario, "historical-replay");
    expect(ctx.evidenceAsOf).toBe("2023-09-08");
    expect(ctx.evidenceNote).toBe("Historical replay: only evidence public on or before 2023-09-08 is used; later records are withheld.");
    expect(selectEvidenceAsOf(scenario, ctx.evidenceAsOf).snapshot.hiddenLaterCount).toBe(11);
  });

  it("rejects dates outside the scenario's valid range", () => {
    expect(() => missionContext(mission, scenario, "historical-replay", "2019-01-01")).toThrow(RangeError);
    expect(() => missionContext(mission, scenario, "historical-replay", "2026-11-05")).toThrow(RangeError);
    expect(() => missionContext(mission, scenario, "historical-replay", "not-a-date")).toThrow(RangeError);
  });

  it("hides sample sites published after the replay date and the whole traverse (until MF-2)", () => {
    const sel = selectGeoFeatures(geo, missionContext(mission, scenario, "historical-replay", "2023-09-08"));
    const kinds = new Set(sel.features.map((f) => f.kind));
    expect(kinds).toEqual(new Set(["crater-centre", "product-extent"]));
    const reasons = new Map(sel.withheld.map((w) => [w.id, w.reason]));
    expect(reasons.get("sample-pelican-point")).toBe("Published 2025-05-06, after the replay date 2023-09-08.");
    expect(reasons.get("rover-last-position-in-dataset")).toMatch(/MF-2/);
    expect(sel.features.length + sel.withheld.length).toBe(geo.catalog.records.length + 332 + 1);
  });

  it("hides product extents before their catalog date", () => {
    const sel = selectGeoFeatures(geo, missionContext(mission, scenario, "historical-replay", "2019-11-11"));
    expect(sel.features.map((f) => f.id)).toEqual(["jezero-crater-centre"]);
  });

  it("shows the sample sites once their source is public", () => {
    const sel = selectGeoFeatures(geo, missionContext(mission, scenario, "historical-replay", "2025-05-06"));
    expect(sel.features.filter((f) => f.kind === "sample-site")).toHaveLength(3);
    expect(sel.features.some((f) => f.kind === "traverse-segment")).toBe(false);
  });
});
