/**
 * RI-1: reviewed vs provisional rankings. Synthetic fixture; real-data checks
 * live in lib/evidence/jezero-data.test.ts.
 */
import { describe, expect, it } from "vitest";
import { checkRegistryIntegrity, ReviewEntry } from "@/lib/evidence/review-registry";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import {
  reviewed,
  syntheticRegistry,
  syntheticScenario,
  syntheticSources,
  withStatus,
} from "@/lib/test-fixtures/synthetic-scenario";
import { DEFAULT_WEIGHTS } from "./criteria";
import { recommend, type Recommendation } from "./engine";
import { rankProvisional, rankReviewed } from "./review-modes";

const AS_OF = "2020-01-01";
const totals = (rec: Recommendation | null) =>
  Object.fromEntries((rec?.ranking ?? []).map((r) => [r.taskId, Number(r.total.toFixed(6))]));
const ORBITAL_LINK = "task-gap:task-orbital-repeat->gap-context";
const EXPENSIVE_LINK = "task-gap:task-too-expensive->gap-origin";

describe("review registry", () => {
  it("fixture registry covers every relationship exactly once", () => {
    expect(checkRegistryIntegrity(syntheticScenario(), syntheticRegistry(), syntheticSources)).toEqual([]);
  });

  it("flags missing, unknown and mismatched entries", () => {
    const r = syntheticRegistry();
    r.entries = r.entries.filter((e) => e.id !== ORBITAL_LINK);
    r.entries.push({ ...r.entries[0], id: "relevance:obs-nonexistent" });
    const rel = r.entries.find((e) => e.id === "relevance:obs-orbital-a")!;
    rel.target = { kind: "classification", id: "regional-context" };
    expect(checkRegistryIntegrity(syntheticScenario(), r, syntheticSources)).toEqual(
      expect.arrayContaining([
        `relationship "${ORBITAL_LINK}" has no review entry`,
        'review entry "relevance:obs-nonexistent" matches no relationship in the scenario',
        'review entry "relevance:obs-orbital-a": target classification:regional-context does not match the scenario (classification:local)',
      ]),
    );
  });

  it("rejects evidence published after the relationship exists (no leakage through review text)", () => {
    const r = syntheticRegistry();
    r.entries.find((e) => e.id === "relevance:obs-orbital-a")!.evidence = [{ sourceId: "src-2024", quote: "q" }];
    expect(checkRegistryIntegrity(syntheticScenario(), r, syntheticSources)).toContain(
      'review entry "relevance:obs-orbital-a": evidence published 2024-03-01, after the relationship exists (2010-01-01)',
    );
  });

  it("refuses invented approvals: non-pending entries need a reviewer and date, pending ones must have none", () => {
    const base = syntheticRegistry().entries[0];
    expect(ReviewEntry.safeParse({ ...base, status: "approved" }).success).toBe(false);
    expect(ReviewEntry.safeParse({ ...base, status: "pending", reviewedBy: "X", reviewedOn: "2026-11-05" }).success).toBe(false);
    expect(ReviewEntry.safeParse({ ...base, status: "needs_revision", reviewedBy: "X", reviewedOn: "2026-11-05" }).success).toBe(true);
  });
});

describe("provisional (exploratory) ranking", () => {
  it("with nothing rejected, reproduces the plain engine output exactly", () => {
    const reg = syntheticRegistry();
    const scenario = reviewed(reg);
    const p = rankProvisional(scenario, reg, AS_OF, DEFAULT_WEIGHTS);
    expect(p.recommendation).toEqual(recommend(selectEvidenceAsOf(scenario, AS_OF).snapshot, DEFAULT_WEIGHTS));
  });

  it("lists unreviewed inputs and the pivotal ones", () => {
    const reg = syntheticRegistry();
    const p = rankProvisional(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS);
    expect(p.unreviewedInputs).toContain("task-gap:task-rover-insitu->gap-origin");
    expect(p.unreviewedInputs).not.toContain("task-gap:task-later-gap->gap-later-only"); // not public yet
    expect(p.unreviewedNotScored).toEqual(["priority:gap-origin#statement", "discrimination:da-rover"]);
    // Removing the rover task's link to the 'context' gap alone does not flip rover (0.61 vs 0.47)…
    expect(p.pivotalInputs.map((x) => x.reviewId)).not.toContain("task-gap:task-rover-insitu->gap-context");
    // …and every pivotal input really changes the top task.
    for (const x of p.pivotalInputs) expect(x.topTaskWithout).not.toBe("task-rover-insitu");
  });

  it("drops rejected relationships", () => {
    const reg = withStatus(withStatus(syntheticRegistry(), "all", "approved"), ["task-gap:task-rover-insitu->gap-context"], "rejected");
    const p = rankProvisional(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS);
    expect(totals(p.recommendation)["task-rover-insitu"]).toBe(0.614286); // (3·0.5 + 2·0.4 + 2·1) / 7
  });
});

describe("reviewed ranking", () => {
  it("is unavailable when relationships are pending, and names no winner", () => {
    const reg = syntheticRegistry();
    const r = rankReviewed(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS);
    expect(r.status).toEqual({
      state: "unavailable",
      reason: "Fewer than two fully reviewed tasks are feasible; a ranking needs at least two to compare.",
    });
    expect(r.recommendation).toBeNull();
    expect(r.notAssessed.map((t) => t.taskId).sort()).toEqual(["task-orbital-repeat", "task-rover-insitu", "task-too-expensive"]);
    expect(r.awaitingReview.length).toBeGreaterThan(0);
  });

  it("equals the provisional ranking when every relationship is approved", () => {
    const reg = withStatus(syntheticRegistry(), "all", "approved");
    const scenario = reviewed(reg);
    const r = rankReviewed(scenario, reg, AS_OF, DEFAULT_WEIGHTS);
    expect(r.status).toEqual({ state: "available" });
    expect(totals(r.recommendation)).toEqual(totals(rankProvisional(scenario, reg, AS_OF, DEFAULT_WEIGHTS).recommendation));
    expect(totals(r.recommendation)).toEqual({ "task-rover-insitu": 0.828571, "task-orbital-repeat": 0.471429, "task-later-gap": 0.271429 });
  });

  it("is partial when a feasible task still awaits review, and never ranks that task", () => {
    const reg = withStatus(withStatus(syntheticRegistry(), "all", "approved"), [ORBITAL_LINK, EXPENSIVE_LINK], "pending");
    const r = rankReviewed(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS);
    expect(r.status).toEqual({ state: "partial", notAssessedTaskIds: ["task-orbital-repeat"] });
    expect(r.notAssessed).toEqual([
      { taskId: "task-orbital-repeat", blockingReviewIds: [ORBITAL_LINK] },
      { taskId: "task-too-expensive", blockingReviewIds: [EXPENSIVE_LINK] },
    ]);
    // Only reviewed tasks are compared: (3+3+0.8+2+2)/12 and (1.9)/12.
    expect(totals(r.recommendation)).toEqual({ "task-rover-insitu": 0.9, "task-later-gap": 0.158333 });
  });

  it("treats needs_revision like pending", () => {
    const reg = withStatus(withStatus(syntheticRegistry(), "all", "approved"), [ORBITAL_LINK], "needs_revision");
    const r = rankReviewed(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS);
    expect(r.notAssessed.map((t) => t.taskId)).toEqual(["task-orbital-repeat"]);
  });

  it("treats rejected relationships as decided (removed, task still assessed)", () => {
    const reg = withStatus(withStatus(syntheticRegistry(), "all", "approved"), ["task-gap:task-rover-insitu->gap-context"], "rejected");
    const r = rankReviewed(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS);
    expect(r.status.state).toBe("available");
    expect(totals(r.recommendation)["task-rover-insitu"]).toBe(0.614286);
  });

  it("is unavailable when no scientific criterion separates any task", () => {
    const links = syntheticRegistry().entries.filter((e) => e.type === "task-gap-link").map((e) => e.id);
    const reg = withStatus(withStatus(syntheticRegistry(), "all", "approved"), links, "rejected");
    const r = rankReviewed(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS);
    expect(r.status.state).toBe("unavailable");
    expect(r.recommendation).toBeNull();
  });
});

describe("acceptance: unreviewed relationships never silently influence the reviewed ranking", () => {
  it("changing pending relationships leaves the reviewed scores unchanged", () => {
    const reg = withStatus(withStatus(syntheticRegistry(), "all", "approved"), [ORBITAL_LINK, EXPENSIVE_LINK], "pending");
    const before = rankReviewed(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS);

    const changed = syntheticScenario();
    changed.tasks[1].addresses[0].rationale = "rewritten";
    changed.tasks[1].addresses.push({ gapId: "gap-origin", rationale: "new pending link", citations: [], review: { draftedBy: "ai-agent", status: "pending" } });
    changed.tasks[2].costs["res-time"] = 50;
    const reg2 = withStatus(
      withStatus(syntheticRegistry(changed), "all", "approved"),
      [ORBITAL_LINK, EXPENSIVE_LINK, "task-gap:task-orbital-repeat->gap-origin"],
      "pending",
    );
    const after = rankReviewed(reviewed(reg2, changed), reg2, AS_OF, DEFAULT_WEIGHTS);

    expect(after.recommendation?.ranking).toEqual(before.recommendation?.ranking);
    expect(after.status.state).toBe("partial");
  });

  it("future relationships, even approved, cannot change an earlier reviewed ranking", () => {
    const allApproved = withStatus(syntheticRegistry(), "all", "approved");
    const futureIds = ["task-gap:task-later-gap->gap-later-only", "observation-gap:obs-rover-later->gap-origin",
      "observation-gap:obs-rover-later->gap-later-only", "relevance:obs-rover-later", "relevance:gap-later-only",
      "gap-hypothesis:gap-later-only->interp-1"];
    const futurePending = withStatus(allApproved, futureIds, "pending");
    const a = rankReviewed(reviewed(allApproved), allApproved, AS_OF, DEFAULT_WEIGHTS);
    const b = rankReviewed(reviewed(futurePending), futurePending, AS_OF, DEFAULT_WEIGHTS);
    expect(b).toEqual(a);
    expect(a.recommendation?.limitations[1]).toBe(
      "Only evidence public on or before 2020-01-01 was used; 2 later record(s) were withheld from scoring.",
    );
  });

  it("is deterministic under changed constraints", () => {
    const reg = withStatus(syntheticRegistry(), "all", "approved");
    const c = { budgets: { "res-time": 50 }, unavailablePlatforms: [] };
    const x = rankReviewed(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS, c);
    expect(x).toEqual(rankReviewed(reviewed(reg), reg, AS_OF, DEFAULT_WEIGHTS, c));
    expect(x.recommendation?.infeasible.map((t) => t.taskId)).toContain("task-rover-insitu");
  });
});
