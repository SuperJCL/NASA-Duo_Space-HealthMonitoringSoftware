import { isApproved, type CandidateTask, type TaskPlatform } from "@/lib/evidence/schema";
import type { SnapshotEvidence, SnapshotGap } from "@/lib/evidence/snapshot";
import {
  CRITERIA,
  EVIDENCE_LEVEL,
  EVIDENCE_LEVEL_LABEL,
  type CriterionId,
  type Weights,
} from "./criteria";

/**
 * Deterministic, explainable recommendation engine (M3).
 *
 * - Pure function: same snapshot + weights + constraints → identical output.
 * - Accepts only SnapshotEvidence, so evidence after the snapshot date cannot
 *   influence the outcome (see lib/evidence/snapshot.ts).
 * - Each criterion is either evaluated (value in [0, 1] with an explanation)
 *   or explicitly "not evaluated" with a reason. Missing data never becomes 0.
 * - Only criteria evaluated for every feasible task (and with weight > 0) form
 *   the ranking basis, so tasks are always compared on the same terms.
 */
export const ENGINE_VERSION = "0.2.0";
export const STABILITY_PERTURBATION = 0.2;

export type Constraints = {
  /** Simulated budget per resource id. */
  budgets: Record<string, number>;
  /** Platforms unavailable in this run (e.g. no sample return). */
  unavailablePlatforms: TaskPlatform[];
};

export type CriterionOutcome =
  | { criterionId: CriterionId; status: "evaluated"; value: number; explanation: string }
  | { criterionId: CriterionId; status: "not-evaluated"; reason: string };

export type TaskEvaluation = {
  taskId: string;
  openGapIds: string[];
  outcomes: CriterionOutcome[];
};

export type RankedTask = TaskEvaluation & {
  rank: number;
  /** Weighted score in [0, 1] over the ranking basis. */
  total: number;
  /** Share of the total contributed by each basis criterion. */
  contributions: Partial<Record<CriterionId, number>>;
};

export type BasisEntry = {
  criterionId: CriterionId;
  weight: number;
  inBasis: boolean;
  /** Why the criterion is excluded from the ranking basis. */
  reason?: string;
};

export type Recommendation = {
  engineVersion: string;
  asOf: string;
  weights: Weights;
  constraints: Constraints;
  basis: BasisEntry[];
  status: { state: "ranked" } | { state: "not-ranked"; reason: string };
  ranking: RankedTask[];
  /** Feasible tasks that could not be ranked (only when status is not-ranked). */
  unranked: TaskEvaluation[];
  infeasible: { taskId: string; reason: string }[];
  stability: { perturbation: number; trials: number; topUnchanged: number; margin: number | null };
  assumptionIds: string[];
  limitations: string[];
  evidenceUsed: { observationIds: string[]; interpretationIds: string[]; gapIds: string[] };
};

export function defaultConstraints(snapshot: SnapshotEvidence): Constraints {
  return {
    budgets: Object.fromEntries(snapshot.resources.map((r) => [r.id, r.budget])),
    unavailablePlatforms: [],
  };
}

const evaluated = (criterionId: CriterionId, value: number, explanation: string): CriterionOutcome => ({
  criterionId,
  status: "evaluated",
  value,
  explanation,
});
const notEvaluated = (criterionId: CriterionId, reason: string): CriterionOutcome => ({
  criterionId,
  status: "not-evaluated",
  reason,
});

const localOpenGaps = (snapshot: SnapshotEvidence) =>
  snapshot.gaps.filter((g) => g.relevance === "local" && g.status.state === "open");

function feasibility(task: CandidateTask, snapshot: SnapshotEvidence, constraints: Constraints) {
  if (constraints.unavailablePlatforms.includes(task.platform)) {
    return { ok: false as const, reason: `Platform "${task.platform}" is unavailable under the current constraints.` };
  }
  const parts: { name: string; unit: string; cost: number; budget: number }[] = [];
  for (const r of snapshot.resources) {
    const cost = task.costs[r.id];
    if (cost === undefined) {
      return { ok: false as const, reason: `Missing simulated cost for "${r.name}"; feasibility cannot be assessed.` };
    }
    const budget = constraints.budgets[r.id] ?? r.budget;
    if (cost > budget) {
      return { ok: false as const, reason: `Needs ${cost} ${r.unit} of ${r.name}; simulated budget is ${budget}.` };
    }
    parts.push({ name: r.name, unit: r.unit, cost, budget });
  }
  return { ok: true as const, parts };
}

function evaluateTask(
  task: CandidateTask,
  snapshot: SnapshotEvidence,
  feasibleParts: { name: string; unit: string; cost: number; budget: number }[],
): TaskEvaluation {
  const openGaps = localOpenGaps(snapshot);
  const linked = new Map(task.addresses.map((l) => [l.gapId, l]));
  const taskGaps: SnapshotGap[] = openGaps.filter((g) => linked.has(g.id));
  const interpretationById = new Map(snapshot.interpretations.map((i) => [i.id, i]));
  const observationById = new Map(snapshot.observations.map((o) => [o.id, o]));
  const competing = [...new Set(taskGaps.flatMap((g) => g.discriminatesInterpretationIds))].filter(
    (id) => interpretationById.get(id)?.relevance === "local",
  );

  const outcomes: CriterionOutcome[] = [];

  // 1. Evidence-gap coverage (deterministic).
  if (openGaps.length === 0) {
    outcomes.push(notEvaluated("gap-coverage", "No local evidence gap is open on the snapshot date."));
  } else {
    const pending = taskGaps.filter((g) => !isApproved(linked.get(g.id)!.review)).length;
    outcomes.push(
      evaluated(
        "gap-coverage",
        taskGaps.length / openGaps.length,
        `Linked to ${taskGaps.length} of ${openGaps.length} open local gaps${
          taskGaps.length ? `: ${taskGaps.map((g) => g.title).join("; ")}` : ""
        }.${pending ? ` ${pending} link(s) are AI-drafted and pending human review.` : ""}`,
      ),
    );
  }

  // 2. Hypothesis discrimination (curated, review-gated).
  const assessments = snapshot.discriminationAssessments.filter((a) => a.taskId === task.id);
  const approved = assessments.filter((a) => isApproved(a.review));
  if (taskGaps.length === 0) {
    outcomes.push(
      evaluated("hypothesis-discrimination", 0, "Addresses no open local gap, so it bears on no competing hypothesis."),
    );
  } else if (competing.length < 2) {
    outcomes.push(
      notEvaluated(
        "hypothesis-discrimination",
        `The task's open gaps concern ${competing.length} local hypothesis(es); discrimination needs at least two.`,
      ),
    );
  } else if (approved.length === 0) {
    const pending = assessments.filter((a) => a.review.status === "pending").length;
    outcomes.push(
      notEvaluated(
        "hypothesis-discrimination",
        pending
          ? `${pending} assessment(s) drafted but pending human review; not scored.`
          : "No curated assessment explains how this task's possible results would favor or weaken the competing hypotheses.",
      ),
    );
  } else {
    const affected = new Set(
      approved.flatMap((a) => a.outcomes.flatMap((o) => [...o.favors, ...o.weakens])),
    );
    const hit = competing.filter((id) => affected.has(id));
    const reviewers = [...new Set(approved.map((a) => `${a.review.reviewedBy} (${a.review.reviewedOn})`))];
    outcomes.push(
      evaluated(
        "hypothesis-discrimination",
        hit.length / competing.length,
        `Approved assessment by ${reviewers.join(", ")}: possible results would favor or weaken ${hit.length} of ${
          competing.length
        } competing hypotheses${hit.length ? `: ${hit.map((id) => interpretationById.get(id)!.title).join("; ")}` : ""}.`,
      ),
    );
  }

  // 3. Resource feasibility (deterministic, under constraints).
  const value =
    feasibleParts.reduce((sum, p) => sum + (p.budget > 0 ? Math.max(0, 1 - p.cost / p.budget) : 1), 0) /
    feasibleParts.length;
  outcomes.push(
    evaluated(
      "resource-feasibility",
      value,
      `Uses ${feasibleParts.map((p) => `${p.cost} of ${p.budget} ${p.unit} (${p.name})`).join("; ")} — simulated.`,
    ),
  );

  // 4. Scientific priority (curated, review-gated).
  const withPriority = taskGaps.filter((g) => g.priority);
  const approvedPriority = withPriority.filter((g) => isApproved(g.priority!.review));
  if (taskGaps.length === 0) {
    outcomes.push(evaluated("scientific-priority", 0, "Addresses no open local gap."));
  } else if (approvedPriority.length > 0) {
    outcomes.push(
      evaluated(
        "scientific-priority",
        1,
        `Addresses a gap whose importance is stated in a cited source (approved): ${approvedPriority
          .map((g) => g.title)
          .join("; ")}.`,
      ),
    );
  } else {
    outcomes.push(
      notEvaluated(
        "scientific-priority",
        withPriority.length
          ? `${withPriority.length} cited priority statement(s) drafted but pending human review; not scored.`
          : "No cited priority statement for the task's open gaps.",
      ),
    );
  }

  // 5. Evidence quality gain (deterministic).
  if (taskGaps.length === 0) {
    outcomes.push(evaluated("evidence-quality", 0, "Addresses no open local gap, so it adds no evidence."));
  } else {
    const levels: number[] = [];
    for (const id of competing) {
      const interp = interpretationById.get(id)!;
      for (const obsId of interp.supportingObservationIds) {
        const obs = observationById.get(obsId);
        if (obs) levels.push(EVIDENCE_LEVEL[obs.platform]);
      }
      if (interp.contextRecordIds.length) levels.push(EVIDENCE_LEVEL["regional-context"]);
    }
    const best = levels.length ? Math.max(...levels) : -1;
    const taskLevel = EVIDENCE_LEVEL[task.platform];
    const bestLabel = best < 0 ? "none" : EVIDENCE_LEVEL_LABEL[best];
    outcomes.push(
      evaluated(
        "evidence-quality",
        taskLevel > best ? 1 : 0,
        taskLevel > best
          ? `Would add ${EVIDENCE_LEVEL_LABEL[taskLevel]} evidence; best existing support for these hypotheses: ${bestLabel}.`
          : `Its ${EVIDENCE_LEVEL_LABEL[taskLevel]} evidence does not exceed the best existing support (${bestLabel}).`,
      ),
    );
  }

  return { taskId: task.id, openGapIds: taskGaps.map((g) => g.id), outcomes };
}

function rank(snapshot: SnapshotEvidence, weights: Weights, constraints: Constraints) {
  const infeasible: { taskId: string; reason: string }[] = [];
  const evaluations: TaskEvaluation[] = [];
  for (const task of snapshot.tasks) {
    const f = feasibility(task, snapshot, constraints);
    if (!f.ok) infeasible.push({ taskId: task.id, reason: f.reason });
    else evaluations.push(evaluateTask(task, snapshot, f.parts));
  }

  const basis: BasisEntry[] = CRITERIA.map((c) => {
    const weight = Math.max(0, weights[c.id] ?? 0);
    if (weight === 0) return { criterionId: c.id, weight, inBasis: false, reason: "Weight is 0." };
    const missing = evaluations.filter(
      (e) => e.outcomes.find((o) => o.criterionId === c.id)?.status !== "evaluated",
    ).length;
    if (evaluations.length > 0 && missing > 0) {
      return {
        criterionId: c.id,
        weight,
        inBasis: false,
        reason: `Not evaluated for ${missing} of ${evaluations.length} feasible task(s); excluded so tasks are compared on the same terms.`,
      };
    }
    return { criterionId: c.id, weight, inBasis: true };
  });

  const inBasis = basis.filter((b) => b.inBasis);
  const weightSum = inBasis.reduce((s, b) => s + b.weight, 0);
  if (evaluations.length === 0) {
    return { basis, infeasible, ranking: [], unranked: [], status: { state: "not-ranked" as const, reason: "No task is feasible under the current constraints." } };
  }
  if (inBasis.length === 0) {
    return {
      basis,
      infeasible,
      ranking: [],
      unranked: evaluations,
      status: { state: "not-ranked" as const, reason: "No criterion with a non-zero weight is evaluated for every feasible task." },
    };
  }

  const scored = evaluations.map((e) => {
    const contributions: Partial<Record<CriterionId, number>> = {};
    let total = 0;
    for (const b of inBasis) {
      const o = e.outcomes.find((x) => x.criterionId === b.criterionId);
      const v = o && o.status === "evaluated" ? o.value : 0;
      contributions[b.criterionId] = (v * b.weight) / weightSum;
      total += contributions[b.criterionId]!;
    }
    return { ...e, total, contributions };
  });
  const feasibilityValue = (e: TaskEvaluation) => {
    const o = e.outcomes.find((x) => x.criterionId === "resource-feasibility");
    return o && o.status === "evaluated" ? o.value : 0;
  };
  // Deterministic order: score, then cheaper, then id.
  scored.sort(
    (a, b) => b.total - a.total || feasibilityValue(b) - feasibilityValue(a) || a.taskId.localeCompare(b.taskId),
  );
  return {
    basis,
    infeasible,
    ranking: scored.map((t, i) => ({ ...t, rank: i + 1 })),
    unranked: [],
    status: { state: "ranked" as const },
  };
}

export function recommend(
  snapshot: SnapshotEvidence,
  weights: Weights,
  constraints: Constraints = defaultConstraints(snapshot),
): Recommendation {
  const result = rank(snapshot, weights, constraints);
  const topTaskId = result.ranking[0]?.taskId;

  // Rank stability: perturb each basis weight by ±20%, one at a time.
  let trials = 0;
  let topUnchanged = 0;
  for (const b of result.basis.filter((x) => x.inBasis)) {
    for (const factor of [1 - STABILITY_PERTURBATION, 1 + STABILITY_PERTURBATION]) {
      trials++;
      const perturbed = { ...weights, [b.criterionId]: b.weight * factor };
      if (rank(snapshot, perturbed, constraints).ranking[0]?.taskId === topTaskId) topUnchanged++;
    }
  }

  const topTask = snapshot.tasks.find((t) => t.id === topTaskId);
  const assumptionIds = [
    ...new Set([
      ...snapshot.assumptions.filter((a) => a.scope === "scenario").map((a) => a.id),
      ...(topTask?.assumptionIds ?? []),
    ]),
  ];

  const excluded = result.basis.filter((b) => !b.inBasis && b.weight > 0);
  return {
    engineVersion: ENGINE_VERSION,
    asOf: snapshot.asOf,
    weights: { ...weights },
    constraints: { budgets: { ...constraints.budgets }, unavailablePlatforms: [...constraints.unavailablePlatforms] },
    basis: result.basis,
    status: result.status,
    ranking: result.ranking,
    unranked: result.unranked,
    infeasible: result.infeasible,
    stability: {
      perturbation: STABILITY_PERTURBATION,
      trials,
      topUnchanged,
      margin: result.ranking.length >= 2 ? result.ranking[0].total - result.ranking[1].total : null,
    },
    assumptionIds,
    limitations: [
      `Only evidence public on or before ${snapshot.asOf} was used; ${snapshot.hiddenLaterCount} later record(s) were withheld from scoring.`,
      ...(excluded.length
        ? [
            `Excluded from the ranking basis: ${excluded
              .map((b) => CRITERIA.find((c) => c.id === b.criterionId)!.name)
              .join(", ")} (not evaluated for every task).`,
          ]
        : []),
      "Gap coverage depends on curated task-gap links; curated scientific judgements count only after human approval.",
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
