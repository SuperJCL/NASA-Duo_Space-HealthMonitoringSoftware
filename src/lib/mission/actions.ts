import type { Constraints, Recommendation } from "@/lib/decision/engine";
import type { ReviewedRanking } from "@/lib/decision/review-modes";
import type { CandidateTask, SimulatedResource, TaskPlatform } from "@/lib/evidence/schema";
import type { SnapshotGap } from "@/lib/evidence/snapshot";

/**
 * View model for the simulated observation actions (MF-1 action strip).
 * It only reads engine outputs; it computes no score of its own.
 */
export const PLATFORMS: readonly { id: TaskPlatform; label: string; short: string }[] = [
  { id: "orbital", label: "Orbital imaging", short: "Orbiter" },
  { id: "rover", label: "Rover operations", short: "Rover" },
  { id: "lab", label: "Earth laboratories (sample return)", short: "Earth laboratory" },
];
export const platformLabel = (p: TaskPlatform) => PLATFORMS.find((x) => x.id === p)?.short ?? p;

export type ActionView = {
  id: string;
  title: string;
  purpose: string;
  platform: TaskPlatform;
  platformText: string;
  costText: string;
  feasible: boolean;
  feasibilityText: string;
  review: { state: "reviewed" | "provisional"; text: string };
  /** For inspection only; never presented as validated. */
  provisional: { rank: number | null; of: number; scorePct: number | null };
  gaps: { id: string; title: string; open: boolean }[];
};

export function describeActions({
  tasks,
  resources,
  gaps,
  constraints,
  provisional,
  reviewed,
}: {
  tasks: readonly CandidateTask[];
  resources: readonly SimulatedResource[];
  gaps: readonly SnapshotGap[];
  constraints: Constraints;
  provisional: Recommendation;
  reviewed: ReviewedRanking;
}): ActionView[] {
  const gapById = new Map(gaps.map((g) => [g.id, g]));
  const ranked = provisional.ranking;
  return tasks.map((t) => {
    const infeasible = provisional.infeasible.find((x) => x.taskId === t.id);
    const blocked = reviewed.notAssessed.find((x) => x.taskId === t.id);
    const rankEntry = ranked.find((r) => r.taskId === t.id);
    const costs = resources.map((r) => ({ r, cost: t.costs[r.id], budget: constraints.budgets[r.id] ?? r.budget }));
    return {
      id: t.id,
      title: t.title,
      purpose: t.description,
      platform: t.platform,
      platformText: `${platformLabel(t.platform)} · ${t.instruments.join(", ")}`,
      costText: costs.map(({ r, cost }) => `${cost ?? "missing"} simulated ${r.unit} of ${r.name.toLowerCase()}`).join("; "),
      feasible: !infeasible,
      feasibilityText: infeasible
        ? `Not feasible: ${infeasible.reason}`
        : `Feasible: ${costs.map(({ r, cost, budget }) => `needs ${cost} of ${budget} ${r.unit}`).join("; ")}`,
      review: blocked
        ? { state: "provisional", text: `Provisional: ${blocked.blockingReviewIds.length} scientific relationship(s) await expert review` }
        : { state: "reviewed", text: "Reviewed: all scientific relationships approved by a named reviewer" },
      provisional: { rank: rankEntry?.rank ?? null, of: ranked.length, scorePct: rankEntry ? Math.round(rankEntry.total * 100) : null },
      gaps: t.addresses.map((l) => {
        const g = gapById.get(l.gapId);
        return { id: l.gapId, title: g?.title ?? l.gapId, open: g?.status.state === "open" };
      }),
    };
  });
}
