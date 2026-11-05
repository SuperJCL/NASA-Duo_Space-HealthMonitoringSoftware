import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { defaultConstraints } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { describeFeature } from "@/lib/geo/details";
import { allFeatures } from "@/lib/geo/features";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { GEO_LAYERS, geoLayerFor, pickFeature } from "@/lib/map/geo-layers";
import { describeActions } from "./actions";
import { loadMission, missionContext } from "./mode";

/** MF-1 view models: pure, so the UI only renders what is tested here. */
const { scenario, sources, registry } = loadJezeroMarginScenario();
const geo = loadJezeroGeo();
const features = allFeatures(geo);
const byId = (id: string) => {
  const f = features.find((x) => x.id === id);
  if (!f) throw new Error(id);
  return f;
};

describe("feature details (context cards)", () => {
  it("describes a sample site from its PDS record, with the inferred convention", () => {
    const d = describeFeature(byId("sample-pelican-point"), geo, sources);
    expect(d.name).toBe("Pelican Point");
    expect(d.typeLabel).toBe("Historical rover sample site");
    expect(Object.fromEntries(d.facts.map((f) => [f.label, f.value]))).toMatchObject({
      Sample: "M2020-923-25 Pelican Point",
      Location: "18.48345° N, 77.35065° E",
      Cored: "2023-09-23 (“Date of Coring”), sealed on sol 923",
    });
    expect(d.convention.basis).toBe("inferred-cross-validation");
    expect(d.convention.text).toMatch(/not confirmed by complete authoritative coordinate-system metadata/);
    expect(d.sources.map((s) => s.id)).toEqual(["pds-m2020-initial-reports-vol4"]);
    expect(d.warning).toBeNull();
  });

  it("quotes the cross-validation figures recorded in the geo catalog", () => {
    const checks = geo.catalog.crossValidation.checks.map((c) => c.result).join(" ");
    expect(checks).toMatch(/2\.2–2\.5 m/);
    expect(checks).toMatch(/\+3\.6 m/);
    expect(describeFeature(byId("sample-lefroy-bay"), geo, sources).convention.text).toMatch(/within 2\.5 m .* within 3\.6 m/);
  });

  it("warns that the last position is historical, not live or current", () => {
    const d = describeFeature(byId("rover-last-position-in-dataset"), geo, sources);
    expect(d.warning).toMatch(/not live telemetry and not the rover’s current position/);
    expect(d.facts.find((f) => f.label === "Sol")?.value).toBe("End of the sol 1176 drive");
    expect(d.facts.find((f) => f.label === "Date")?.value).toBe("Not stated by the source (only the sol)");
  });

  it("gives a traverse drive its source length and no invented date", () => {
    const seg = geo.traverse.segments.find((s) => s.sol === 909)!;
    const d = describeFeature(byId(`traverse-sol-909-fid-${seg.fid}`), geo, sources);
    expect(d.facts.find((f) => f.label === "Drive length")?.value).toBe(`${seg.length.toFixed(1)} m (source attribute)`);
    expect(d.facts.find((f) => f.label === "Date")?.value).toMatch(/Not stated/);
  });

  it("states the convention as stated for sphere-based products and the Gazetteer", () => {
    expect(describeFeature(byId("extent-hirise-dtm"), geo, sources).convention.basis).toBe("stated");
    expect(describeFeature(byId("jezero-crater-centre"), geo, sources).convention.basis).toBe("stated");
    expect(describeFeature(byId("extent-ctx-dtm"), geo, sources).facts.find((f) => f.label === "Served as")?.value).toMatch(/Download only/);
  });
});

describe("map layers", () => {
  it("has a layer for every feature kind and none for tasks", () => {
    for (const f of features) expect(GEO_LAYERS.map((l) => l.key)).toContain(geoLayerFor(f.kind));
    expect(JSON.stringify(GEO_LAYERS)).not.toMatch(/task/);
  });

  it("keeps the extents overlay optional (off by default) and the rest on", () => {
    expect(Object.fromEntries(GEO_LAYERS.map((l) => [l.key, l.defaultVisible]))).toEqual({
      extents: false,
      traverse: true,
      craterCentre: true,
      samples: true,
      lastPosition: true,
    });
  });

  it("prefers points over lines over outlines when features overlap", () => {
    expect(pickFeature([{ kind: "product-extent" }, { kind: "traverse-segment" }, { kind: "sample-site" }])?.kind).toBe("sample-site");
    expect(pickFeature([{ kind: "sample-site" }, { kind: "rover-last-position" }])?.kind).toBe("rover-last-position");
    expect(pickFeature([])).toBeNull();
  });
});

describe("simulated action view model", () => {
  const ctx = missionContext(loadMission(), scenario);
  const { snapshot } = selectEvidenceAsOf(scenario, ctx.evidenceAsOf);
  const view = (budget?: number) => {
    const base = defaultConstraints(snapshot);
    const constraints = budget === undefined ? base : { ...base, budgets: { "res-effort": budget } };
    return describeActions({
      tasks: snapshot.tasks,
      resources: snapshot.resources,
      gaps: snapshot.gaps,
      constraints,
      provisional: rankProvisional(scenario, registry, ctx.evidenceAsOf, DEFAULT_WEIGHTS, constraints).recommendation,
      reviewed: rankReviewed(scenario, registry, ctx.evidenceAsOf, DEFAULT_WEIGHTS, constraints),
    });
  };

  it("shows the model platform, simulated cost and provisional review status for all four actions", () => {
    const v = view();
    expect(v.map((a) => a.platformText.split(" · ")[0])).toEqual(["Rover", "Rover", "Earth laboratory", "Orbiter"]);
    expect(v.map((a) => a.costText)).toEqual([
      "15 simulated points of investigation effort",
      "40 simulated points of investigation effort",
      "55 simulated points of investigation effort",
      "10 simulated points of investigation effort",
    ]);
    expect(v.every((a) => a.feasible && a.review.state === "provisional")).toBe(true);
  });

  it("follows the engine's feasibility under a budget, with its stated reason", () => {
    const v = view(30);
    const abrasion = v.find((a) => a.id === "task-abrasion-proximity")!;
    expect(abrasion.feasible).toBe(false);
    expect(abrasion.feasibilityText).toBe("Not feasible: Needs 40 points of Investigation effort; simulated budget is 30.");
    expect(v.find((a) => a.id === "task-standoff-survey")!.feasibilityText).toBe("Feasible: needs 15 of 30 points");
  });

  it("exposes the provisional rank only as data for an explicitly not-validated view", () => {
    const v = view();
    expect(v.find((a) => a.id === "task-abrasion-proximity")!.provisional).toEqual({ rank: 1, of: 4, scorePct: 74 });
  });
});
