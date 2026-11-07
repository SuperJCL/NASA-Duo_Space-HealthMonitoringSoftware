import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { defaultConstraints } from "@/lib/decision/engine";
import { rankProvisional } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { closedQuestionText, linkedQuestionsText, stabilityScopeText } from "./explain";

const { scenario, registry } = loadJezeroMarginScenario();
const at = (asOf: string, budget: number) => {
  const { snapshot } = selectEvidenceAsOf(scenario, asOf);
  const c = { ...defaultConstraints(snapshot), budgets: { "res-effort": budget }, unavailablePlatforms: ["orbital" as const] };
  return { snapshot, p: rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, c) };
};

describe("SCI-0 A1: linked open questions state whether their links are reviewed", () => {
  it("covers every review situation without claiming coverage as fact", () => {
    expect(linkedQuestionsText({ linked: 2, open: 3, unreviewed: 2, aiDrafted: true })).toBe("Linked to 2 of 3 open questions (AI-drafted links, not yet reviewed)");
    expect(linkedQuestionsText({ linked: 2, open: 3, unreviewed: 2, aiDrafted: false })).toBe("Linked to 2 of 3 open questions (links not yet reviewed)");
    expect(linkedQuestionsText({ linked: 2, open: 3, unreviewed: 1, aiDrafted: true })).toBe("Linked to 2 of 3 open questions (1 of these links not yet reviewed)");
    expect(linkedQuestionsText({ linked: 2, open: 3, unreviewed: 0, aiDrafted: false })).toBe("Linked to 2 of 3 open questions (links reviewed by an expert)");
    expect(linkedQuestionsText({ linked: 0, open: 3, unreviewed: 0, aiDrafted: false })).toBe("Linked to none of the 3 open questions");
  });
});

describe("SCI-0 A2: weight stability is stated as weights-only, with the input sensitivity", () => {
  it("uses the engine's own numbers (2025-05-06: 6/6 at 100 pts, 4/6 at 50 pts; 47 unreviewed, 3 pivotal)", () => {
    const a = at("2025-05-06", 100).p;
    expect(stabilityScopeText({ stability: a.recommendation.stability, unreviewedInputs: a.unreviewedInputs.length, pivotalInputs: a.pivotalInputs.length })).toBe(
      "Weights only: stays #1 in 6 of 6 runs with each scored weight changed by ±20%. Not covered by this check: 47 unreviewed inputs; removing any one of 3 of them alone changes #1.",
    );
    const b = at("2025-05-06", 50).p;
    expect(stabilityScopeText({ stability: b.recommendation.stability, unreviewedInputs: b.unreviewedInputs.length, pivotalInputs: b.pivotalInputs.length, showLead: true })).toBe(
      "Weights only: stays #1 in 4 of 6 runs with each scored weight changed by ±20%; lead over #2: 0 points. Not covered by this check: 47 unreviewed inputs; removing any one of 3 of them alone changes #1.",
    );
  });

  it("handles one, none and fully reviewed inputs", () => {
    const st = { perturbation: 0.2, trials: 6, topUnchanged: 6, margin: 0.1 };
    expect(stabilityScopeText({ stability: st, unreviewedInputs: 5, pivotalInputs: 1 })).toMatch(/5 unreviewed inputs; removing one of them alone changes #1\.$/);
    expect(stabilityScopeText({ stability: st, unreviewedInputs: 1, pivotalInputs: 0 })).toMatch(/1 unreviewed input; removing any single one does not change #1\.$/);
    expect(stabilityScopeText({ stability: st, unreviewedInputs: 0, pivotalInputs: 0 })).toMatch(/All inputs it uses are reviewed\.$/);
  });
});

describe("SCI-0 A4: a closed question states its basis and scope", () => {
  it("the rover-measurement question at 2025-05-06: closed by an MDI rule awaiting review; open questions are untouched", () => {
    const { snapshot, p } = at("2025-05-06", 100);
    const unreviewed = new Set(p.unreviewedInputs);
    const gn = snapshot.gaps.find((g) => g.id === "gap-no-in-situ-data")!;
    expect(closedQuestionText(gn, unreviewed)).toEqual({
      label: "no longer counted as open",
      note: "Closed by an MDI rule (awaiting expert review). This closes only this question; the other open questions are not affected.",
    });
    for (const g of snapshot.gaps.filter((x) => x.id !== "gap-no-in-situ-data")) expect(closedQuestionText(g, unreviewed)).toBeNull();
    // Once its basis were approved the note would drop the pending marker (text only; no status is changed here).
    expect(closedQuestionText(gn, new Set())?.note).toBe("Closed by an MDI rule. This closes only this question; the other open questions are not affected.");
  });
});
