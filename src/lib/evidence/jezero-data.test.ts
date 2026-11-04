import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { recommend } from "@/lib/decision/engine";
import { loadJezeroMarginScenario } from "./repository";
import { selectEvidenceAsOf } from "./snapshot";

/**
 * Guards on the curated Jezero Margin Unit data (not on the code).
 * Schema + integrity are enforced by loadJezeroMarginScenario itself.
 */
const { scenario, sources } = loadJezeroMarginScenario();

const ALLOWED_SOURCE_HOSTS = [
  "science.nasa.gov",
  "trek.nasa.gov",
  "pds-geosciences.wustl.edu",
  "planetarynames.wr.usgs.gov",
  "pubs.usgs.gov",
  "astrogeology.usgs.gov",
];

describe("Jezero Margin Unit scenario data", () => {
  it("loads and passes schema + integrity checks", () => {
    expect(scenario.id).toBe("jezero-margin-unit");
  });

  it("cites only sources on hosts the team has verified access to", () => {
    for (const s of sources) {
      expect(ALLOWED_SOURCE_HOSTS, `${s.id}: ${s.url}`).toContain(new URL(s.url).host);
    }
  });

  it("every source is cited at least once (no orphan bibliography entries)", () => {
    const cited = new Set(
      [
        ...scenario.site.citations,
        ...scenario.observations.flatMap((o) => o.citations),
        ...scenario.interpretations.flatMap((i) => i.citations),
        ...scenario.gaps.flatMap((g) => (g.origin.kind === "cited" ? g.origin.citations : [])),
        ...scenario.assumptions.flatMap((a) => a.citations),
      ].map((c) => c.sourceId),
    );
    for (const s of sources) expect(cited, s.id).toContain(s.id);
  });

  it("the default snapshot withholds later rover evidence (so the reveal is meaningful)", () => {
    const { snapshot, later } = selectEvidenceAsOf(scenario, scenario.defaultSnapshotDate);
    expect(snapshot.observations.length).toBeGreaterThan(0);
    expect(snapshot.interpretations.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.gaps.some((g) => g.status.state === "open")).toBe(true);
    expect(later.observations.some((o) => o.platform === "rover")).toBe(true);
  });

  it("produces a recommendation at the default snapshot", () => {
    const { snapshot } = selectEvidenceAsOf(scenario, scenario.defaultSnapshotDate);
    const rec = recommend(snapshot, DEFAULT_WEIGHTS);
    expect(rec.ranking.length).toBeGreaterThan(0);
  });

  it("keeps every simulated resource flagged as simulated", () => {
    expect(scenario.resources.every((r) => r.simulated === true)).toBe(true);
  });
});
