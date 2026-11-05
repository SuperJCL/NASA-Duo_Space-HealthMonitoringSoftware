import {
  enumerateRelationships,
  relationshipIds as ids,
  type Relationship,
  type ReviewEntry,
  type ReviewRegistry,
} from "@/lib/evidence/review-registry";
import type { Scenario } from "@/lib/evidence/schema";
import { selectEvidenceAsOf, type SnapshotEvidence } from "@/lib/evidence/snapshot";
import type { CriterionId, Weights } from "./criteria";
import { defaultConstraints, recommend, type Constraints, type Recommendation } from "./engine";

/**
 * Reviewed vs provisional rankings (RI-1).
 *
 * The scoring engine is unchanged. Both modes feed it a scenario from which
 * some relationships have been removed:
 *  - provisional (exploratory): all draft relationships except rejected ones.
 *    With no rejections this is exactly the M3 ranking.
 *  - reviewed: only approved relationships, and only tasks whose every
 *    ranking-relevant relationship has been decided (approved or rejected).
 *    Tasks still awaiting review are listed as "not assessed", never ranked
 *    below others, so no task wins because others lack reviewed evidence.
 */

const BLOCKING: ReadonlySet<ReviewEntry["status"]> = new Set(["pending", "needs_revision"]);
const SCIENTIFIC_CRITERIA: readonly CriterionId[] = ["gap-coverage", "hypothesis-discrimination", "scientific-priority"];

export type StatusLookup = (reviewId: string) => ReviewEntry["status"];

export function statusLookup(registry: ReviewRegistry): StatusLookup {
  const byId = new Map(registry.entries.map((e) => [e.id, e.status]));
  // A relationship without an entry is treated as pending (integrity checks forbid this in real data).
  return (id) => byId.get(id) ?? "pending";
}

/** Remove a set of relationships from a scenario; removing a relevance or derived-gap entry removes the record. */
export function withoutRelationships(s: Scenario, remove: ReadonlySet<string>): Scenario {
  const removedObs = new Set(s.observations.filter((o) => remove.has(ids.relevance(o.id))).map((o) => o.id));
  const removedInterp = new Set(s.interpretations.filter((i) => remove.has(ids.relevance(i.id))).map((i) => i.id));
  const removedGaps = new Set(
    s.gaps
      .filter((g) => remove.has(ids.relevance(g.id)) || (g.origin.kind === "derived" && remove.has(ids.derivedGap(g.id))))
      .map((g) => g.id),
  );
  return {
    ...s,
    observations: s.observations
      .filter((o) => !removedObs.has(o.id))
      .map((o) => ({
        ...o,
        addressesGapIds: o.addressesGapIds.filter((g) => !removedGaps.has(g) && !remove.has(ids.observationGap(o.id, g))),
      })),
    interpretations: s.interpretations
      .filter((i) => !removedInterp.has(i.id))
      .map((i) => ({
        ...i,
        supportingObservationIds: i.supportingObservationIds.filter(
          (o) => !removedObs.has(o) && !remove.has(ids.support(i.id, o)),
        ),
        contextRecordIds: i.contextRecordIds.filter((c) => !removedObs.has(c) && !removedInterp.has(c)),
      })),
    gaps: s.gaps
      .filter((g) => !removedGaps.has(g.id))
      .map((g) => {
        const { priority, ...rest } = g;
        const keepPriority = priority && !remove.has(ids.priority(g.id));
        return {
          ...rest,
          ...(keepPriority ? { priority } : {}),
          discriminatesInterpretationIds: g.discriminatesInterpretationIds.filter(
            (h) => !removedInterp.has(h) && !remove.has(ids.gapHypothesis(g.id, h)),
          ),
        };
      }),
    tasks: s.tasks.map((t) => ({
      ...t,
      addresses: t.addresses.filter((l) => !removedGaps.has(l.gapId) && !remove.has(ids.taskGap(t.id, l.gapId))),
    })),
    discriminationAssessments: s.discriminationAssessments.filter((a) => !remove.has(ids.discrimination(a.id))),
  };
}

/** Relationships present in a snapshot (i.e. already public on its date). */
export function visibleRelationships(snapshot: SnapshotEvidence): Relationship[] {
  return enumerateRelationships(snapshot as unknown as Scenario);
}

/** Review ids a task's scores depend on, in a snapshot. */
export function taskDependencies(snapshot: SnapshotEvidence, taskId: string): string[] {
  const deps = new Set<string>();
  const task = snapshot.tasks.find((t) => t.id === taskId);
  if (!task) return [];
  const interpById = new Map(snapshot.interpretations.map((i) => [i.id, i]));
  for (const link of task.addresses) {
    deps.add(ids.taskGap(task.id, link.gapId));
    const gap = snapshot.gaps.find((g) => g.id === link.gapId);
    if (!gap) continue;
    deps.add(ids.relevance(gap.id));
    if (gap.origin.kind === "derived") deps.add(ids.derivedGap(gap.id));
    for (const h of gap.discriminatesInterpretationIds) {
      deps.add(ids.gapHypothesis(gap.id, h));
      deps.add(ids.relevance(h));
      for (const obsId of interpById.get(h)?.supportingObservationIds ?? []) {
        deps.add(ids.support(h, obsId));
        deps.add(ids.relevance(obsId));
      }
    }
    for (const o of snapshot.observations) {
      if (o.addressesGapIds.includes(gap.id)) {
        deps.add(ids.observationGap(o.id, gap.id));
        deps.add(ids.relevance(o.id));
      }
    }
  }
  return [...deps].sort();
}

export type ProvisionalRanking = {
  recommendation: Recommendation;
  /** Relationships visible on this date that are not approved and that the engine can use. */
  unreviewedInputs: string[];
  /** Visible curated judgements that are not approved; the engine already leaves them unscored (Not Evaluated). */
  unreviewedNotScored: string[];
  /** Unreviewed inputs whose removal alone changes the top-ranked task. */
  pivotalInputs: { reviewId: string; topTaskWithout: string | null }[];
};

export type ReviewedRanking = {
  status:
    | { state: "available" }
    | { state: "partial"; notAssessedTaskIds: string[] }
    | { state: "unavailable"; reason: string };
  recommendation: Recommendation | null;
  eligibleTaskIds: string[];
  notAssessed: { taskId: string; blockingReviewIds: string[] }[];
  /** Visible relationships that are pending or need revision (excluded from the reviewed ranking). */
  awaitingReview: string[];
};

const decisionInputs = (r: Relationship) => r.type !== "priority-statement" && r.type !== "discrimination-assessment";

/**
 * The engine's first limitation states how many later records were withheld.
 * Filtering by review status would change that count, so it is always taken
 * from the unfiltered snapshot: review status (even of future records) must
 * not change what the user is told.
 */
function withTrueHiddenCount(rec: Recommendation, scenario: Scenario, asOf: string, prefix: string[] = []): Recommendation {
  const hidden = selectEvidenceAsOf(scenario, asOf).snapshot.hiddenLaterCount;
  return {
    ...rec,
    limitations: [
      ...prefix,
      `Only evidence public on or before ${asOf} was used; ${hidden} later record(s) were withheld from scoring.`,
      ...rec.limitations.slice(1),
    ],
  };
}

export function rankProvisional(
  scenario: Scenario,
  registry: ReviewRegistry,
  asOf: string,
  weights: Weights,
  constraints?: Constraints,
): ProvisionalRanking {
  const status = statusLookup(registry);
  const rejected = new Set(enumerateRelationships(scenario).filter((r) => status(r.id) === "rejected").map((r) => r.id));
  const base = withoutRelationships(scenario, rejected);
  const { snapshot } = selectEvidenceAsOf(base, asOf);
  const c = constraints ?? defaultConstraints(snapshot);
  const recommendation = withTrueHiddenCount(recommend(snapshot, weights, c), scenario, asOf);
  const unapproved = visibleRelationships(snapshot).filter((r) => status(r.id) !== "approved");
  const unreviewedInputs = unapproved.filter(decisionInputs).map((r) => r.id);
  const unreviewedNotScored = unapproved.filter((r) => !decisionInputs(r)).map((r) => r.id);

  const top = recommendation.ranking[0]?.taskId ?? null;
  const pivotalInputs: ProvisionalRanking["pivotalInputs"] = [];
  for (const id of unreviewedInputs) {
    const without = withoutRelationships(base, new Set([id]));
    const alt = recommend(selectEvidenceAsOf(without, asOf).snapshot, weights, c).ranking[0]?.taskId ?? null;
    if (alt !== top) pivotalInputs.push({ reviewId: id, topTaskWithout: alt });
  }
  return { recommendation, unreviewedInputs, unreviewedNotScored, pivotalInputs };
}

export function rankReviewed(
  scenario: Scenario,
  registry: ReviewRegistry,
  asOf: string,
  weights: Weights,
  constraints?: Constraints,
): ReviewedRanking {
  const status = statusLookup(registry);
  const all = enumerateRelationships(scenario);
  const rejected = new Set(all.filter((r) => status(r.id) === "rejected").map((r) => r.id));
  const notApproved = new Set(all.filter((r) => status(r.id) !== "approved").map((r) => r.id));

  // Dependencies are read from the snapshot without rejected relationships (rejections are decisions).
  const decidedBase = selectEvidenceAsOf(withoutRelationships(scenario, rejected), asOf).snapshot;
  const c = constraints ?? defaultConstraints(decidedBase);
  const awaitingReview = visibleRelationships(decidedBase)
    .filter((r) => BLOCKING.has(status(r.id)))
    .map((r) => r.id);

  const notAssessed = decidedBase.tasks
    .map((t) => ({ taskId: t.id, blockingReviewIds: taskDependencies(decidedBase, t.id).filter((id) => BLOCKING.has(status(id))) }))
    .filter((t) => t.blockingReviewIds.length > 0);
  const blocked = new Set(notAssessed.map((t) => t.taskId));
  const eligibleTaskIds = decidedBase.tasks.map((t) => t.id).filter((id) => !blocked.has(id));

  const unavailable = (reason: string): ReviewedRanking => ({
    status: { state: "unavailable", reason },
    recommendation: null,
    eligibleTaskIds,
    notAssessed,
    awaitingReview,
  });

  if (eligibleTaskIds.length === 0) {
    return unavailable(
      `No candidate task has fully reviewed scientific relationships on this date (${awaitingReview.length} relationship(s) await expert review).`,
    );
  }

  const reviewedScenario = withoutRelationships(scenario, notApproved);
  const eligible = new Set(eligibleTaskIds);
  const { snapshot } = selectEvidenceAsOf({ ...reviewedScenario, tasks: reviewedScenario.tasks.filter((t) => eligible.has(t.id)) }, asOf);
  const raw = recommend(snapshot, weights, c);
  const recommendation = withTrueHiddenCount(raw, scenario, asOf, [
    `Reviewed ranking: uses only approved relationships; ${awaitingReview.length} visible relationship(s) awaiting review were excluded.`,
  ]);

  if (raw.status.state === "not-ranked") return unavailable(raw.status.reason);
  if (raw.ranking.length < 2) {
    return unavailable("Fewer than two fully reviewed tasks are feasible; a ranking needs at least two to compare.");
  }
  // A scientific criterion must be in the basis AND distinguish at least one task (value > 0);
  // otherwise the order would come from cost and platform alone.
  const scientific = raw.basis.some(
    (b) =>
      b.inBasis &&
      SCIENTIFIC_CRITERIA.includes(b.criterionId) &&
      raw.ranking.some((t) => {
        const o = t.outcomes.find((x) => x.criterionId === b.criterionId);
        return o?.status === "evaluated" && o.value > 0;
      }),
  );
  if (!scientific) {
    return unavailable(
      "No scientific criterion (gap coverage, hypothesis discrimination, scientific priority) can be scored from approved relationships with a non-zero result; feasibility and evidence type alone are not a scientific ranking.",
    );
  }

  // Tasks still awaiting review that would otherwise be feasible make the comparison partial.
  const provisionalInfeasible = new Set(recommend(decidedBase, weights, c).infeasible.map((t) => t.taskId));
  const notAssessedFeasible = notAssessed.map((t) => t.taskId).filter((id) => !provisionalInfeasible.has(id));
  return {
    status: notAssessedFeasible.length ? { state: "partial", notAssessedTaskIds: notAssessedFeasible } : { state: "available" },
    recommendation,
    eligibleTaskIds,
    notAssessed,
    awaitingReview,
  };
}
