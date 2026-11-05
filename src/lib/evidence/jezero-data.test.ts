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
        ...scenario.gaps.flatMap((g) => g.priority?.citations ?? []),
        ...scenario.tasks.flatMap((t) => t.addresses.flatMap((l) => l.citations)),
        ...scenario.discriminationAssessments.flatMap((a) => a.citations),
      ].map((c) => c.sourceId),
    );
    for (const s of sources) expect(cited, s.id).toContain(s.id);
  });

  it("the default snapshot withholds later rover evidence (so the reveal is meaningful)", () => {
    const { snapshot, later } = selectEvidenceAsOf(scenario, scenario.defaultSnapshotDate);
    expect(snapshot.observations.filter((o) => o.relevance === "local").length).toBeGreaterThan(0);
    expect(snapshot.interpretations.filter((i) => i.relevance === "local").length).toBeGreaterThanOrEqual(2);
    expect(snapshot.gaps.some((g) => g.status.state === "open")).toBe(true);
    expect(later.observations.some((o) => o.platform === "rover")).toBe(true);
  });

  it("produces a recommendation at the default snapshot", () => {
    const { snapshot } = selectEvidenceAsOf(scenario, scenario.defaultSnapshotDate);
    const rec = recommend(snapshot, DEFAULT_WEIGHTS);
    expect(rec.ranking.length).toBeGreaterThan(0);
  });

  it("regression: ranking at the default snapshot and with all evidence (hand-checked)", () => {
    const totalsAt = (date: string) =>
      Object.fromEntries(
        recommend(selectEvidenceAsOf(scenario, date).snapshot, DEFAULT_WEIGHTS).ranking.map((r) => [
          r.taskId,
          Number(r.total.toFixed(4)),
        ]),
      );
    // Basis at both dates: coverage (w3), feasibility (w2), evidence quality (w2) → /7.
    // 2023-09-08: 3 open local gaps; competing hypotheses: lacustrine vs mineral carbonation.
    expect(totalsAt("2023-09-08")).toEqual({
      "task-abrasion-proximity": 0.8857, // (3·3/3 + 2·0.60 + 2·1) / 7
      "task-standoff-survey": 0.8143, //    (3·2/3 + 2·0.85 + 2·1) / 7
      "task-core-for-earth": 0.5571, //     (3·1/3 + 2·0.45 + 2·1) / 7
      "task-orbital-stereo": 0.4, //        (3·1/3 + 2·0.90 + 2·0) / 7
    });
    // 2025-05-06: the in-situ gap is addressed; a sedimentary-vs-igneous gap is open.
    expect(totalsAt("2025-05-06")).toEqual({
      "task-abrasion-proximity": 0.7429, // (3·2/3 + 2·0.60 + 2·1) / 7
      "task-core-for-earth": 0.7, //        (3·2/3 + 2·0.45 + 2·1) / 7
      "task-standoff-survey": 0.6714, //    (3·1/3 + 2·0.85 + 2·1) / 7
      "task-orbital-stereo": 0.4, //        (3·1/3 + 2·0.90 + 2·0) / 7
    });
  });

  it("keeps SIM 3464 (unit Nue) and the crater-wide mineral map as regional context", () => {
    const relevance = (id: string) =>
      [...scenario.observations, ...scenario.interpretations, ...scenario.gaps].find((r) => r.id === id)?.relevance;
    expect(relevance("obs-upper-etched-unit-mapping")).toBe("regional-context");
    expect(relevance("interp-volcanic-drape")).toBe("regional-context");
    expect(relevance("gap-origin-needs-rover")).toBe("regional-context");
    expect(relevance("obs-crism-ctx-mineral-map")).toBe("regional-context");
    // Every record citing SIM 3464 is regional context or links to it only as context.
    for (const r of [...scenario.observations, ...scenario.interpretations]) {
      if (r.citations.some((c) => c.sourceId === "usgs-sim3464")) expect(r.relevance, r.id).toBe("regional-context");
    }
  });

  it("does not score discrimination or priority at the default snapshot (nothing is human-approved)", () => {
    const rec = recommend(selectEvidenceAsOf(scenario, scenario.defaultSnapshotDate).snapshot, DEFAULT_WEIGHTS);
    for (const r of rec.ranking) {
      for (const c of ["hypothesis-discrimination", "scientific-priority"]) {
        expect(r.outcomes.find((o) => o.criterionId === c)?.status, `${r.taskId} ${c}`).toBe("not-evaluated");
      }
    }
    expect(rec.basis.filter((b) => !b.inBasis).map((b) => b.criterionId)).toEqual([
      "hypothesis-discrimination",
      "scientific-priority",
    ]);
  });

  it("marks every AI-drafted curated judgement as pending review", () => {
    const reviews = [
      ...scenario.tasks.flatMap((t) => t.addresses.map((l) => l.review)),
      ...scenario.discriminationAssessments.map((a) => a.review),
      ...scenario.gaps.flatMap((g) => (g.priority ? [g.priority.review] : [])),
    ];
    expect(reviews.length).toBeGreaterThan(0);
    for (const r of reviews) if (r.draftedBy === "ai-agent") expect(r.status).toBe("pending");
  });

  it("keeps every simulated resource flagged as simulated", () => {
    expect(scenario.resources.every((r) => r.simulated === true)).toBe(true);
  });
});
