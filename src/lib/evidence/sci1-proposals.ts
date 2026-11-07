/**
 * SCI-1 candidate evidence and relationships (`src/data/scenarios/
 * jezero-margin-unit.sci1-proposals.json`).
 *
 * Every entry is drafted by the AI agent and `pending`. This module only
 * validates the file: the decision engine, the evidence repository and the
 * app never import it, so nothing here is scored or displayed. Approval by a
 * named human reviewer, and a separate change (SCI-2), are needed before any
 * of it enters the scenario. A verified quote is not a scientific approval.
 */
import { z } from "zod";
import type { ReviewRegistry } from "./review-registry";
import { IsoDate, RecordId, type Scenario, type Source } from "./schema";

const PDS_SOURCE = "pds-m2020-initial-reports-vol4";

export const Sci1Evidence = z
  .object({
    id: RecordId,
    sourceId: RecordId,
    /** Verbatim from the source; `npm run verify:sci1` checks it live (and, for PDS, inside the named report). */
    quote: z.string().min(10),
    class: z.enum(["observation", "interpretation", "open-question", "proposed-by-source", "capability", "status"]),
    /** Candidate actions (task ids) this evidence bears on. */
    about: z.array(RecordId).min(1),
    summary: z.string().min(1),
    /** PDS Initial Reports: the sample report (page-label prefix, e.g. "27" = M2020-1088-27) and section. */
    report: z.object({ pagePrefix: z.string().regex(/^\d+$/), section: z.string().min(1) }).strict().optional(),
  })
  .strict();

export const Sci1Proposal = z
  .object({
    id: z.string().regex(/^sci1:[a-z0-9:>=_.-]+$/),
    type: z.enum(["task-gap-link", "sample-interpretation-informs-unit-hypothesis", "discrimination-assessment", "assumption-citation", "locator-correction", "review-note"]),
    status: z.literal("pending"),
    draftedBy: z.literal("ai-agent"),
    subject: z.record(z.string(), z.unknown()),
    evidenceIds: z.array(RecordId).min(1),
    reasoning: z.string().min(1),
    limitations: z.array(z.string().min(1)).min(1),
    /** How the proposal would change the comparison of the three actions if approved (SCI-2 decides). */
    affectsComparison: z.string().min(1),
    suggestedChange: z.string().min(1).optional(),
  })
  .strict();

export const Sci1Proposals = z
  .object({
    scenarioId: RecordId,
    policy: z.string().min(1),
    retrievedOn: IsoDate,
    evidence: z.array(Sci1Evidence).min(1),
    proposals: z.array(Sci1Proposal).min(1),
  })
  .strict();
export type Sci1Proposals = z.infer<typeof Sci1Proposals>;

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Referential integrity against the current scenario, bibliography and review registry. */
export function sci1Problems(p: Sci1Proposals, scenario: Scenario, sources: readonly Source[], registry: ReviewRegistry): string[] {
  const problems: string[] = [];
  const sourceIds = new Set(sources.map((s) => s.id));
  const taskIds = new Set(scenario.tasks.map((t) => t.id));
  const gapIds = new Set(scenario.gaps.map((g) => g.id));
  const interpIds = new Set(scenario.interpretations.map((i) => i.id));
  const assumptionIds = new Set(scenario.assumptions.map((a) => a.id));
  const reviewIds = new Set(registry.entries.map((e) => e.id));
  const evIds = new Set<string>();
  if (p.scenarioId !== scenario.id) problems.push(`scenarioId ${p.scenarioId} is not ${scenario.id}`);
  for (const e of p.evidence) {
    if (evIds.has(e.id)) problems.push(`duplicate evidence id ${e.id}`);
    evIds.add(e.id);
    if (!sourceIds.has(e.sourceId)) problems.push(`${e.id}: unknown source ${e.sourceId}`);
    if (e.sourceId === PDS_SOURCE && !e.report) problems.push(`${e.id}: PDS evidence must name its sample report`);
    for (const t of e.about) if (!taskIds.has(t)) problems.push(`${e.id}: unknown task ${t}`);
  }
  const propIds = new Set<string>();
  for (const pr of p.proposals) {
    if (propIds.has(pr.id)) problems.push(`duplicate proposal id ${pr.id}`);
    propIds.add(pr.id);
    for (const id of pr.evidenceIds) if (!evIds.has(id)) problems.push(`${pr.id}: unknown evidence ${id}`);
    const s = pr.subject;
    const check = (key: string, ids: Set<string>) => {
      const v = str(s[key]);
      if (v !== null && !ids.has(v)) problems.push(`${pr.id}: unknown ${key} ${v}`);
    };
    check("taskId", taskIds);
    check("gapId", gapIds);
    check("interpretationId", interpIds);
    check("hypothesisId", interpIds);
    check("assumptionId", assumptionIds);
    check("reviewId", reviewIds);
    for (const h of Array.isArray(s.hypothesisIds) ? s.hypothesisIds : []) if (!interpIds.has(String(h))) problems.push(`${pr.id}: unknown hypothesis ${String(h)}`);
    if (pr.type === "task-gap-link") {
      const t = scenario.tasks.find((x) => x.id === str(s.taskId));
      if (t?.addresses.some((l) => l.gapId === str(s.gapId))) problems.push(`${pr.id}: link already exists in the scenario`);
    }
  }
  return problems;
}
