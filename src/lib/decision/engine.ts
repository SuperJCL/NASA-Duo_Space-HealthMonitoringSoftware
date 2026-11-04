import type { CandidateTask } from "@/lib/evidence/schema";
import type { SnapshotEvidence } from "@/lib/evidence/snapshot";
import { CRITERIA, type CriterionId, type Weights } from "./criteria";

/**
 * Deterministic, explainable recommendation engine.
 *
 * - Pure function: same snapshot + weights → identical output.
 * - Accepts only SnapshotEvidence, so evidence after the snapshot date
 *   cannot influence the ranking (see lib/evidence/snapshot.ts).
 * - Scores are weighted averages of rule-derived criteria in [0, 1].
 */
export const ENGINE_VERSION = "0.1.0";

export const STABILITY_PERTURBATION = 0.2;

export type CriterionScore = {
  criterionId: CriterionId;
  /** Normalised criterion value in [0, 1] (higher is better). */
  value: number;
  weight: number;
  /** value × weight ÷ Σweights — the share of the total this criterion contributes. */
  contribution: number;
  explanation: string;
};

export type RankedTask = {
  taskId: string;
  rank: number;
  /** Weighted score in [0, 1]. */
  total: number;
  scores: CriterionScore[];
  openGapIds: string[];
};

export type InfeasibleTask = { taskId: string; reason: string };

export type Recommendation = {
  engineVersion: string;
  asOf: string;
  weights: Weights;
  ranking: RankedTask[];
  infeasible: InfeasibleTask[];
  stability: {
    perturbation: number;
    trials: number;
    topUnchanged: number;
    /** Score difference between rank 1 and rank 2 (null if fewer than 2 tasks). */
    margin: number | null;
  };
  assumptionIds: string[];
  limitations: string[];
  evidenceUsed: { observationIds: string[]; interpretationIds: string[]; gapIds: string[] };
};

type CriterionValue = { value: number; explanation: string };

function evaluateTask(task: CandidateTask, snapshot: SnapshotEvidence) {
  const openGaps = snapshot.gaps.filter((g) => g.status.state === "open");
  const taskOpenGaps = openGaps.filter((g) => task.addressesGapIds.includes(g.id));
  const openGapIds = taskOpenGaps.map((g) => g.id);

  const values: Record<CriterionId, CriterionValue> = {
    "gap-coverage": (() => {
      if (openGaps.length === 0) return { value: 0, explanation: "No evidence gaps are open on the snapshot date." };
      return {
        value: taskOpenGaps.length / openGaps.length,
        explanation: `Addresses ${taskOpenGaps.length} of ${openGaps.length} open evidence gaps${
          taskOpenGaps.length ? `: ${taskOpenGaps.map((g) => g.title).join("; ")}` : ""
        }.`,
      };
    })(),

    discrimination: (() => {
      const known = snapshot.interpretations.length;
      const discriminated = new Set(taskOpenGaps.flatMap((g) => g.discriminatesInterpretationIds));
      if (known === 0) return { value: 0, explanation: "No interpretations are known on the snapshot date." };
      const titles = snapshot.interpretations.filter((i) => discriminated.has(i.id)).map((i) => i.title);
      return {
        value: discriminated.size / known,
        explanation: `Its open gaps concern ${discriminated.size} of ${known} known interpretations${
          titles.length ? `: ${titles.join("; ")}` : ""
        }.`,
      };
    })(),

    "independent-evidence": (() => {
      if (taskOpenGaps.length === 0) {
        return { value: 0, explanation: "Addresses no open gap, so it adds no new line of evidence." };
      }
      const interpIds = new Set(taskOpenGaps.flatMap((g) => g.discriminatesInterpretationIds));
      const supportingObsIds = new Set(
        snapshot.interpretations
          .filter((i) => interpIds.has(i.id))
          .flatMap((i) => i.supportingObservationIds),
      );
      const platforms = new Set<string>(
        snapshot.observations.filter((o) => supportingObsIds.has(o.id)).map((o) => o.platform),
      );
      const isNew = !platforms.has(task.platform);
      const existing = platforms.size ? [...platforms].join(" + ") : "none";
      return {
        value: isNew ? 1 : 0,
        explanation: isNew
          ? `Adds ${task.platform} evidence; existing support for these interpretations: ${existing}.`
          : `Repeats a platform (${task.platform}) already supporting these interpretations.`,
      };
    })(),

    "resource-cost": (() => {
      const parts = snapshot.resources.map((r) => {
        const cost = task.costs[r.id] ?? 0;
        return { r, cost, value: Math.max(0, 1 - cost / r.budget) };
      });
      const value = parts.reduce((sum, p) => sum + p.value, 0) / parts.length;
      return {
        value,
        explanation: `Uses ${parts
          .map((p) => `${p.cost} of ${p.r.budget} ${p.r.unit} (${p.r.name})`)
          .join("; ")} — simulated.`,
      };
    })(),
  };

  return { values, openGapIds };
}

function infeasibility(task: CandidateTask, snapshot: SnapshotEvidence): string | null {
  for (const r of snapshot.resources) {
    const cost = task.costs[r.id] ?? 0;
    if (cost > r.budget) return `Needs ${cost} ${r.unit} of ${r.name}; simulated budget is ${r.budget}.`;
  }
  return null;
}

function rank(
  snapshot: SnapshotEvidence,
  weights: Weights,
): { ranking: RankedTask[]; infeasible: InfeasibleTask[] } {
  const weightSum = CRITERIA.reduce((sum, c) => sum + Math.max(0, weights[c.id] ?? 0), 0);
  const infeasible: InfeasibleTask[] = [];
  const scored: Omit<RankedTask, "rank">[] = [];

  for (const task of snapshot.tasks) {
    const reason = infeasibility(task, snapshot);
    if (reason) {
      infeasible.push({ taskId: task.id, reason });
      continue;
    }
    const { values, openGapIds } = evaluateTask(task, snapshot);
    const scores: CriterionScore[] = CRITERIA.map((c) => {
      const weight = Math.max(0, weights[c.id] ?? 0);
      const { value, explanation } = values[c.id];
      return {
        criterionId: c.id,
        value,
        weight,
        contribution: weightSum > 0 ? (value * weight) / weightSum : 0,
        explanation,
      };
    });
    const total = scores.reduce((sum, s) => sum + s.contribution, 0);
    scored.push({ taskId: task.id, total, scores, openGapIds });
  }

  const costValue = (t: Omit<RankedTask, "rank">) =>
    t.scores.find((s) => s.criterionId === "resource-cost")?.value ?? 0;
  // Deterministic order: score, then cheaper, then id.
  scored.sort(
    (a, b) => b.total - a.total || costValue(b) - costValue(a) || a.taskId.localeCompare(b.taskId),
  );

  return { ranking: scored.map((t, i) => ({ ...t, rank: i + 1 })), infeasible };
}

export function recommend(snapshot: SnapshotEvidence, weights: Weights): Recommendation {
  const { ranking, infeasible } = rank(snapshot, weights);
  const topTaskId = ranking[0]?.taskId;

  // Rank stability: perturb each weight by ±20%, one at a time.
  let trials = 0;
  let topUnchanged = 0;
  for (const c of CRITERIA) {
    for (const factor of [1 - STABILITY_PERTURBATION, 1 + STABILITY_PERTURBATION]) {
      const perturbed = { ...weights, [c.id]: (weights[c.id] ?? 0) * factor };
      trials++;
      if (rank(snapshot, perturbed).ranking[0]?.taskId === topTaskId) topUnchanged++;
    }
  }

  // Assumptions behind the top recommendation: scenario-wide ones plus the top task's own.
  const topTask = snapshot.tasks.find((t) => t.id === topTaskId);
  const assumptionIds = [
    ...new Set([
      ...snapshot.assumptions.filter((a) => a.scope === "scenario").map((a) => a.id),
      ...(topTask?.assumptionIds ?? []),
    ]),
  ];

  return {
    engineVersion: ENGINE_VERSION,
    asOf: snapshot.asOf,
    weights: { ...weights },
    ranking,
    infeasible,
    stability: {
      perturbation: STABILITY_PERTURBATION,
      trials,
      topUnchanged,
      margin: ranking.length >= 2 ? ranking[0].total - ranking[1].total : null,
    },
    assumptionIds,
    limitations: [
      `Only evidence public on or before ${snapshot.asOf} was used; ${snapshot.hiddenLaterCount} later record(s) were withheld from scoring.`,
      "Scores are rule-derived from curated links between tasks, gaps and interpretations; curating those links is a team judgement.",
      "Resource costs and budgets are simulated and are not NASA mission figures.",
      ...snapshot.limitations,
    ],
    evidenceUsed: {
      observationIds: snapshot.observations.map((o) => o.id),
      interpretationIds: snapshot.interpretations.map((i) => i.id),
      gapIds: snapshot.gaps.map((g) => g.id),
    },
  };
}
