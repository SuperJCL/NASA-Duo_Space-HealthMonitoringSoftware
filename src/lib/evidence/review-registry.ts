import { z } from "zod";
import {
  Citation,
  IsoDate,
  RecordId,
  ReviewStatus,
  type Review,
  type Scenario,
  type ScenarioInput,
  type Source,
} from "./schema";

/**
 * Scientific review registry (RI-1).
 *
 * One entry per scientific relationship that can affect a ranking. The
 * registry is the ONLY place where review state is stored. A citation that
 * has been verified against its source is NOT the same as an approved
 * relationship: verification checks the quote, review checks the reasoning.
 *
 * Relationship types and why each can affect a ranking:
 *  - task-gap-link            gap coverage; which hypotheses a task concerns
 *  - gap-hypothesis-link      competing hypotheses → discrimination, evidence quality
 *  - observation-gap-link     whether a gap is still open
 *  - hypothesis-support       best existing evidence level → evidence quality
 *  - derived-gap              a rule-defined gap counts toward coverage
 *  - relevance-classification local vs regional context: what counts as local evidence
 *  - priority-statement       scientific priority
 *  - discrimination-assessment hypothesis discrimination
 * Not included: `contextRecordIds` (regional context links). They can only add
 * evidence level 0, which no task level (≥ 1) can fail to exceed, so they
 * cannot change any score.
 */

export const RelationshipType = z.enum([
  "task-gap-link",
  "gap-hypothesis-link",
  "observation-gap-link",
  "hypothesis-support",
  "derived-gap",
  "relevance-classification",
  "priority-statement",
  "discrimination-assessment",
]);
export type RelationshipType = z.infer<typeof RelationshipType>;

export const RecordRef = z
  .object({
    kind: z.enum(["task", "gap", "interpretation", "observation", "assessment", "classification", "rule", "statement"]),
    id: z.string().min(1),
  })
  .strict();
export type RecordRef = z.infer<typeof RecordRef>;

export const ReviewEntry = z
  .object({
    /** Stable, deterministic id: `<type-prefix>:<source>(->|<-)<target>`. */
    id: z.string().regex(/^[a-z-]+:[a-z0-9-]+(?:(?:->|<-)[a-z0-9-]+|#[a-z-]+)?$/),
    type: RelationshipType,
    source: RecordRef,
    target: RecordRef,
    status: ReviewStatus,
    draftedBy: z.enum(["ai-agent", "human"]),
    /** Verbatim quotes the relationship rests on (verified by `verify:citations`). */
    evidence: z.array(Citation).default([]),
    reasoning: z.string().min(1),
    limitations: z.array(z.string().min(1)).default([]),
    reviewedBy: z.string().min(1).optional(),
    reviewedOn: IsoDate.optional(),
    reviewNotes: z.string().min(1).optional(),
  })
  .strict()
  .refine((e) => (e.status === "pending" ? !e.reviewedBy && !e.reviewedOn : Boolean(e.reviewedBy && e.reviewedOn)), {
    message: "non-pending entries need reviewedBy and reviewedOn; pending entries must not carry a reviewer",
  });
export type ReviewEntry = z.infer<typeof ReviewEntry>;

export const ReviewRegistry = z
  .object({
    scenarioId: RecordId,
    policy: z.string().min(1),
    entries: z.array(ReviewEntry),
  })
  .strict();
export type ReviewRegistry = z.infer<typeof ReviewRegistry>;

/** A relationship the scenario contains, independent of its review state. */
export type Relationship = {
  id: string;
  type: RelationshipType;
  source: RecordRef;
  target: RecordRef;
  /** Earliest date the relationship can exist in a snapshot. */
  availableFrom: string;
};

const max = (...dates: (string | undefined)[]) =>
  dates.filter((d): d is string => Boolean(d)).reduce((a, b) => (a > b ? a : b), "0000-01-01");

export const relationshipIds = {
  taskGap: (taskId: string, gapId: string) => `task-gap:${taskId}->${gapId}`,
  gapHypothesis: (gapId: string, interpId: string) => `gap-hypothesis:${gapId}->${interpId}`,
  observationGap: (obsId: string, gapId: string) => `observation-gap:${obsId}->${gapId}`,
  support: (interpId: string, obsId: string) => `hypothesis-support:${interpId}<-${obsId}`,
  derivedGap: (gapId: string) => `derived-gap:${gapId}#rule`,
  relevance: (recordId: string) => `relevance:${recordId}`,
  priority: (gapId: string) => `priority:${gapId}#statement`,
  discrimination: (assessmentId: string) => `discrimination:${assessmentId}`,
};

/** Every reviewable relationship in a scenario, in a stable order. */
export function enumerateRelationships(scenario: ScenarioInput | Scenario): Relationship[] {
  const out: Relationship[] = [];
  const gapById = new Map(scenario.gaps.map((g) => [g.id, g]));
  const interpById = new Map(scenario.interpretations.map((i) => [i.id, i]));
  const obsById = new Map(scenario.observations.map((o) => [o.id, o]));

  for (const o of scenario.observations) {
    out.push({
      id: relationshipIds.relevance(o.id),
      type: "relevance-classification",
      source: { kind: "observation", id: o.id },
      target: { kind: "classification", id: o.relevance },
      availableFrom: o.availableFrom,
    });
  }
  for (const i of scenario.interpretations) {
    out.push({
      id: relationshipIds.relevance(i.id),
      type: "relevance-classification",
      source: { kind: "interpretation", id: i.id },
      target: { kind: "classification", id: i.relevance },
      availableFrom: i.availableFrom,
    });
  }
  for (const g of scenario.gaps) {
    out.push({
      id: relationshipIds.relevance(g.id),
      type: "relevance-classification",
      source: { kind: "gap", id: g.id },
      target: { kind: "classification", id: g.relevance },
      availableFrom: g.availableFrom,
    });
    if (g.origin.kind === "derived") {
      out.push({
        id: relationshipIds.derivedGap(g.id),
        type: "derived-gap",
        source: { kind: "gap", id: g.id },
        target: { kind: "rule", id: "derived" },
        availableFrom: g.availableFrom,
      });
    }
    if (g.priority) {
      out.push({
        id: relationshipIds.priority(g.id),
        type: "priority-statement",
        source: { kind: "gap", id: g.id },
        target: { kind: "statement", id: "priority" },
        availableFrom: g.availableFrom,
      });
    }
    for (const h of g.discriminatesInterpretationIds) {
      out.push({
        id: relationshipIds.gapHypothesis(g.id, h),
        type: "gap-hypothesis-link",
        source: { kind: "gap", id: g.id },
        target: { kind: "interpretation", id: h },
        availableFrom: max(g.availableFrom, interpById.get(h)?.availableFrom),
      });
    }
  }
  for (const o of scenario.observations) {
    for (const gapId of o.addressesGapIds) {
      out.push({
        id: relationshipIds.observationGap(o.id, gapId),
        type: "observation-gap-link",
        source: { kind: "observation", id: o.id },
        target: { kind: "gap", id: gapId },
        availableFrom: max(o.availableFrom, gapById.get(gapId)?.availableFrom),
      });
    }
  }
  for (const i of scenario.interpretations) {
    for (const obsId of i.supportingObservationIds) {
      out.push({
        id: relationshipIds.support(i.id, obsId),
        type: "hypothesis-support",
        source: { kind: "interpretation", id: i.id },
        target: { kind: "observation", id: obsId },
        availableFrom: max(i.availableFrom, obsById.get(obsId)?.availableFrom),
      });
    }
  }
  for (const t of scenario.tasks) {
    for (const l of t.addresses) {
      out.push({
        id: relationshipIds.taskGap(t.id, l.gapId),
        type: "task-gap-link",
        source: { kind: "task", id: t.id },
        target: { kind: "gap", id: l.gapId },
        availableFrom: max(gapById.get(l.gapId)?.availableFrom, l.availableFrom),
      });
    }
  }
  for (const a of scenario.discriminationAssessments) {
    out.push({
      id: relationshipIds.discrimination(a.id),
      type: "discrimination-assessment",
      source: { kind: "task", id: a.taskId },
      target: { kind: "assessment", id: a.id },
      availableFrom: a.availableFrom,
    });
  }
  return out;
}

/** Registry ↔ scenario consistency. Returns problems (empty = OK). */
export function checkRegistryIntegrity(
  scenario: ScenarioInput | Scenario,
  registry: ReviewRegistry,
  sources: readonly Source[],
): string[] {
  const problems: string[] = [];
  if (registry.scenarioId !== scenario.id) problems.push(`registry is for "${registry.scenarioId}", not "${scenario.id}"`);
  const expected = new Map(enumerateRelationships(scenario).map((r) => [r.id, r]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const seen = new Set<string>();
  for (const e of registry.entries) {
    if (seen.has(e.id)) problems.push(`duplicate review entry "${e.id}"`);
    seen.add(e.id);
    const rel = expected.get(e.id);
    if (!rel) {
      problems.push(`review entry "${e.id}" matches no relationship in the scenario`);
      continue;
    }
    if (e.type !== rel.type) problems.push(`review entry "${e.id}": type ${e.type} should be ${rel.type}`);
    if (e.source.kind !== rel.source.kind || e.source.id !== rel.source.id) {
      problems.push(`review entry "${e.id}": source does not match the scenario`);
    }
    if (e.target.kind !== rel.target.kind || e.target.id !== rel.target.id) {
      problems.push(`review entry "${e.id}": target ${e.target.kind}:${e.target.id} does not match the scenario (${rel.target.kind}:${rel.target.id})`);
    }
    let latest = "0000-01-01";
    for (const c of e.evidence) {
      const s = sourceById.get(c.sourceId);
      if (!s) problems.push(`review entry "${e.id}": unknown source "${c.sourceId}"`);
      else if (s.publishedOn > latest) latest = s.publishedOn;
    }
    if (latest > rel.availableFrom) {
      problems.push(`review entry "${e.id}": evidence published ${latest}, after the relationship exists (${rel.availableFrom})`);
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) problems.push(`relationship "${id}" has no review entry`);
  return problems;
}

export function reviewFromEntry(e: ReviewEntry): Review {
  return {
    draftedBy: e.draftedBy,
    status: e.status,
    ...(e.reviewedBy ? { reviewedBy: e.reviewedBy } : {}),
    ...(e.reviewedOn ? { reviewedOn: e.reviewedOn } : {}),
    ...(e.reviewNotes ? { notes: e.reviewNotes } : {}),
  };
}

/**
 * Attach review state from the registry to the curated items that the engine
 * and UI read (`review` on task-gap links, priority statements, assessments).
 * Throws if an entry is missing (run checkRegistryIntegrity first).
 */
export function applyRegistry(scenario: ScenarioInput | Scenario, registry: ReviewRegistry): Scenario {
  const byId = new Map(registry.entries.map((e) => [e.id, e]));
  const review = (id: string): Review => {
    const e = byId.get(id);
    if (!e) throw new Error(`missing review entry "${id}"`);
    return reviewFromEntry(e);
  };
  return {
    ...scenario,
    gaps: scenario.gaps.map((g) => {
      const { priority, ...rest } = g;
      return priority ? { ...rest, priority: { statement: priority.statement, citations: priority.citations, review: review(relationshipIds.priority(g.id)) } } : rest;
    }),
    tasks: scenario.tasks.map((t) => ({
      ...t,
      addresses: t.addresses.map((l) => {
        const { gapId, rationale, citations, availableFrom } = l;
        return {
          gapId,
          rationale,
          citations,
          ...(availableFrom ? { availableFrom } : {}),
          review: review(relationshipIds.taskGap(t.id, l.gapId)),
        };
      }),
    })),
    discriminationAssessments: scenario.discriminationAssessments.map((a) => {
      const { id, taskId, hypothesisIds, outcomes, rationale, citations, availableFrom } = a;
      return { id, taskId, hypothesisIds, outcomes, rationale, citations, availableFrom, review: review(relationshipIds.discrimination(a.id)) };
    }),
  } as Scenario;
}

export const isDecided = (status: ReviewEntry["status"]) => status === "approved" || status === "rejected";
