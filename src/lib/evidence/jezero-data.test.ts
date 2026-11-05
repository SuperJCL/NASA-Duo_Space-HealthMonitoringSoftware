import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { recommend } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "./repository";
import { selectEvidenceAsOf } from "./snapshot";

/**
 * Guards on the curated Jezero Margin Unit data (not on the code).
 * Schema + integrity are enforced by loadJezeroMarginScenario itself.
 */
const { scenario, sources, registry } = loadJezeroMarginScenario();

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

  it("UX-0: all platforms disabled or budget 0 → no ranking, every task excluded with a reason", () => {
    const { snapshot } = selectEvidenceAsOf(scenario, scenario.defaultSnapshotDate);
    const noPlatforms = recommend(snapshot, DEFAULT_WEIGHTS, {
      budgets: { "res-effort": 100 },
      unavailablePlatforms: ["orbital", "rover", "lab"],
    });
    const budgetZero = recommend(snapshot, DEFAULT_WEIGHTS, { budgets: { "res-effort": 0 }, unavailablePlatforms: [] });
    for (const rec of [noPlatforms, budgetZero]) {
      expect(rec.status).toEqual({ state: "not-ranked", reason: "No task is feasible under the current constraints." });
      expect(rec.ranking).toEqual([]);
      expect(rec.unranked).toEqual([]);
      expect(rec.infeasible.map((t) => t.taskId).sort()).toEqual(scenario.tasks.map((t) => t.id).sort());
    }
    expect(noPlatforms.infeasible.find((t) => t.taskId === "task-abrasion-proximity")?.reason).toBe(
      'Platform "rover" is unavailable under the current constraints.',
    );
    expect(budgetZero.infeasible.find((t) => t.taskId === "task-orbital-stereo")?.reason).toBe(
      "Needs 10 points of Investigation effort; simulated budget is 0.",
    );
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

  describe("RI-1 review registry and ranking integrity", () => {
    it("covers all 50 ranking-relevant relationships, every one pending with no reviewer (no invented approvals)", () => {
      expect(registry.entries).toHaveLength(50);
      for (const e of registry.entries) {
        expect(e.status, e.id).toBe("pending");
        expect(e.draftedBy, e.id).toBe("ai-agent");
        expect(e.reviewedBy, e.id).toBeUndefined();
        expect(e.reviewedOn, e.id).toBeUndefined();
        expect(e.reasoning.length, e.id).toBeGreaterThan(0);
      }
    });

    it("reviewed ranking is unavailable at the default snapshot and with all evidence — no fabricated winner", () => {
      for (const [date, n] of [["2023-09-08", 28], ["2025-05-06", 50]] as const) {
        const r = rankReviewed(scenario, registry, date, DEFAULT_WEIGHTS);
        expect(r.recommendation).toBeNull();
        expect(r.eligibleTaskIds).toEqual([]);
        expect(r.status).toEqual({
          state: "unavailable",
          reason: `No candidate task has fully reviewed scientific relationships on this date (${n} relationship(s) await expert review).`,
        });
      }
    });

    it("provisional ranking reproduces the M3 ranking exactly", () => {
      for (const date of ["2023-09-08", "2025-05-06"]) {
        const p = rankProvisional(scenario, registry, date, DEFAULT_WEIGHTS);
        expect(p.recommendation).toEqual(recommend(selectEvidenceAsOf(scenario, date).snapshot, DEFAULT_WEIGHTS));
      }
    });

    it("identifies the unreviewed relationships that can flip the provisional top task", () => {
      const at = (d: string) => rankProvisional(scenario, registry, d, DEFAULT_WEIGHTS).pivotalInputs;
      expect(at("2023-09-08")).toEqual([
        { reviewId: "relevance:gap-lake-connection", topTaskWithout: "task-standoff-survey" },
        { reviewId: "task-gap:task-abrasion-proximity->gap-no-in-situ-data", topTaskWithout: "task-standoff-survey" },
        { reviewId: "task-gap:task-abrasion-proximity->gap-formation-unknown", topTaskWithout: "task-standoff-survey" },
        { reviewId: "task-gap:task-abrasion-proximity->gap-lake-connection", topTaskWithout: "task-standoff-survey" },
      ]);
      expect(at("2025-05-06").map((x) => x.reviewId)).toEqual([
        "relevance:gap-lake-connection",
        "task-gap:task-abrasion-proximity->gap-formation-unknown",
        "task-gap:task-abrasion-proximity->gap-lake-connection",
      ]);
    });

    it("lists pending curated judgements as unscored rather than hiding them", () => {
      const p = rankProvisional(scenario, registry, "2023-09-08", DEFAULT_WEIGHTS);
      expect(p.unreviewedNotScored).toEqual(["priority:gap-lake-connection#statement", "priority:gap-formation-unknown#statement"]);
      expect(p.unreviewedInputs).toHaveLength(26);
    });
  });

  it("keeps every simulated resource flagged as simulated", () => {
    expect(scenario.resources.every((r) => r.simulated === true)).toBe(true);
  });
});
