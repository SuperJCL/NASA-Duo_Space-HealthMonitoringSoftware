import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import raw from "@/data/scenarios/jezero-margin-unit.sci1-proposals.json";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { defaultConstraints } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import { loadJezeroMarginScenario } from "./repository";
import { Sci1Proposals, sci1Problems } from "./sci1-proposals";
import { selectEvidenceAsOf } from "./snapshot";

const { scenario, sources, registry } = loadJezeroMarginScenario();
const p = Sci1Proposals.parse(raw);

describe("SCI-1 v1 proposals: pending candidate evidence, never scored", () => {
  it("is valid and refers only to existing records, sources and registry entries", () => {
    expect(sci1Problems(p, scenario, sources, registry)).toEqual([]);
  });

  it("every proposal is pending and AI-drafted; no review state is set", () => {
    expect(p.proposals.every((x) => x.status === "pending" && x.draftedBy === "ai-agent")).toBe(true);
    expect(registry.entries.every((e) => e.status === "pending")).toBe(true);
  });

  it("covers all three Mission Glass actions with evidence", () => {
    for (const t of ["task-standoff-survey", "task-abrasion-proximity", "task-core-for-earth"]) {
      expect(p.evidence.some((e) => e.about.includes(t)), t).toBe(true);
    }
  });

  it("is not imported by the engine, the evidence loader or the app", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const path = join(d, f);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(f)) files.push(path);
      }
    };
    walk("src");
    const importers = files.filter((f) => /sci1-proposals/.test(readFileSync(f, "utf8"))).map((f) => f.replace(/\\/g, "/"));
    expect(importers.sort()).toEqual(["src/lib/evidence/jezero-data.test.ts", "src/lib/evidence/sci1-proposals.test.ts", "src/lib/evidence/sci1-proposals.ts"]);
  });

  it("leaves the provisional ranking exactly as SCI-0 measured it (no scoring change)", () => {
    const asOf = "2025-05-06";
    const { snapshot } = selectEvidenceAsOf(scenario, asOf);
    const c = { ...defaultConstraints(snapshot), budgets: { "res-effort": 100 }, unavailablePlatforms: ["orbital" as const] };
    const prov = rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, c);
    expect(prov.recommendation.ranking.map((x) => [x.taskId, x.total])).toEqual([
      ["task-abrasion-proximity", 0.7428571428571429],
      ["task-core-for-earth", 0.7],
      ["task-standoff-survey", 0.6714285714285714],
    ]);
    expect(prov.unreviewedInputs.length).toBe(47);
    expect(prov.pivotalInputs.map((x) => x.reviewId)).toEqual([
      "relevance:gap-lake-connection",
      "task-gap:task-abrasion-proximity->gap-formation-unknown",
      "task-gap:task-abrasion-proximity->gap-lake-connection",
    ]);
    expect(rankReviewed(scenario, registry, asOf, DEFAULT_WEIGHTS, c).status.state).toBe("unavailable");
  });
});
