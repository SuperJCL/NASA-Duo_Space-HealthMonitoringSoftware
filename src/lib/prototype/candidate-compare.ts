/**
 * Candidate comparison (Planning): two actions side by side on three aligned
 * rows: simulated cost, possible new observation, key unknowns.
 *
 * Read-only presentation. The cost row comes from the existing engine views
 * (simulated effort). The two science rows are short summaries of the SCI-1
 * v1 evidence (`src/data/prototype/candidate-compare.json`), drafted by the AI
 * agent and pending expert review; each line cites SCI-1 evidence ids whose
 * quotes `npm run verify:sci1` checks. Nothing here is read by the decision
 * engine (`src/lib/decision`) or the evidence loader, and nothing changes a
 * score, a rank, a review state or the plan.
 */
import { z } from "zod";
import { IsoDate, RecordId, type Source } from "@/lib/evidence/schema";
import type { Sci1Proposals } from "@/lib/evidence/sci1-proposals";

const Cited = z.object({ text: z.string().min(1), evidenceIds: z.array(RecordId) }).strict();

export const CandidateCompareData = z
  .object({
    id: RecordId,
    basis: z.string().min(1),
    /** The comparison is shown only for evidence dates on or after this (no future evidence in a replay). */
    availableFrom: IsoDate,
    scope: z.array(z.string().min(1)).min(1),
    /** PDS Initial Reports page-label prefix → short report name. */
    reports: z.record(z.string().regex(/^\d+$/), z.string().min(1)),
    actions: z
      .array(
        z
          .object({
            taskId: RecordId,
            observation: z
              .object({
                mode: z.string().min(1),
                target: z.string().min(1),
                note: z.string().min(1),
                instruments: z.string().min(1),
                evidenceIds: z.array(RecordId).min(1),
              })
              .strict(),
            unknowns: z.array(Cited).min(1).max(3),
          })
          .strict(),
      )
      .min(2),
  })
  .strict();
export type CandidateCompareData = z.infer<typeof CandidateCompareData>;

/** Integrity against the SCI-1 evidence and the Mission Glass actions. */
export function compareProblems(data: CandidateCompareData, sci1: Sci1Proposals, actionTaskIds: readonly string[]): string[] {
  const problems: string[] = [];
  const ev = new Map(sci1.evidence.map((e) => [e.id, e]));
  const seen = new Set<string>();
  for (const a of data.actions) {
    if (seen.has(a.taskId)) problems.push(`duplicate action ${a.taskId}`);
    seen.add(a.taskId);
    if (!actionTaskIds.includes(a.taskId)) problems.push(`${a.taskId}: not a Mission Glass action`);
    const ids = [...a.observation.evidenceIds, ...a.unknowns.flatMap((u) => u.evidenceIds)];
    for (const id of ids) {
      const e = ev.get(id);
      if (!e) problems.push(`${a.taskId}: unknown SCI-1 evidence ${id}`);
      else if (!e.about.includes(a.taskId)) problems.push(`${a.taskId}: SCI-1 evidence ${id} is not about this action`);
      else if (e.report && !data.reports[e.report.pagePrefix]) problems.push(`${a.taskId}: no report name for page prefix ${e.report.pagePrefix}`);
    }
  }
  for (const t of actionTaskIds) if (!seen.has(t)) problems.push(`action ${t} has no comparison entry`);
  return problems;
}

/** What the client receives: plain text with resolved source names; no SCI-1 file in the browser bundle. */
export type CompareCell = {
  taskId: string;
  observation: { mode: string; target: string; note: string; instruments: string; sources: string[] };
  unknowns: { text: string; sources: string[] }[];
};
export type CompareView = { scope: string[]; availableFrom: string; cells: CompareCell[] };

/**
 * Builds the comparison view (server side; see `candidate-compare-data.ts`),
 * or null when the evidence date precedes the SCI-1 evidence (a historical
 * replay must not show later sources).
 */
export function buildCompareView(args: {
  data: CandidateCompareData;
  sci1: Sci1Proposals;
  asOf: string;
  sources: readonly Source[];
  actionTaskIds: readonly string[];
}): CompareView | null {
  const { data, sci1 } = args;
  const problems = compareProblems(data, sci1, args.actionTaskIds);
  if (problems.length) throw new Error(`Invalid candidate comparison:\n${problems.join("\n")}`);
  if (args.asOf < data.availableFrom) return null;
  const ev = new Map(sci1.evidence.map((e) => [e.id, e]));
  const sourceTitle = new Map(args.sources.map((s) => [s.id, s.title]));
  const sourcesOf = (ids: readonly string[]) => [
    ...new Set(
      ids.map((id) => {
        const e = ev.get(id)!;
        return e.report ? data.reports[e.report.pagePrefix] : `NASA: ${sourceTitle.get(e.sourceId) ?? e.sourceId}`;
      }),
    ),
  ];
  return {
    scope: data.scope,
    availableFrom: data.availableFrom,
    cells: data.actions.map((a) => ({
      taskId: a.taskId,
      observation: { mode: a.observation.mode, target: a.observation.target, note: a.observation.note, instruments: a.observation.instruments, sources: sourcesOf(a.observation.evidenceIds) },
      unknowns: a.unknowns.map((u) => ({ text: u.text, sources: sourcesOf(u.evidenceIds) })),
    })),
  };
}

/** Plain-language difference of two simulated costs (effort points). */
export function costDifferenceText(a: { name: string; cost: number }, b: { name: string; cost: number }): string {
  if (a.cost === b.cost) return `Same simulated cost: ${a.cost} pts each.`;
  const [lo, hi] = a.cost < b.cost ? [a, b] : [b, a];
  return `${hi.name} costs ${hi.cost - lo.cost} pts more than ${lo.name} (simulated).`;
}
