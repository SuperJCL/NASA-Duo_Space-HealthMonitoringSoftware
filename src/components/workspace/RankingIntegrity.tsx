import type { ReactNode } from "react";
import type { ProvisionalRanking, ReviewedRanking } from "@/lib/decision/review-modes";
import type { RecordRef, ReviewEntry, ReviewRegistry } from "@/lib/evidence/review-registry";
import type { Scenario, Source } from "@/lib/evidence/schema";
import { Citations } from "./Citations";
import { EpistemicBadge, ReviewBadge } from "./EpistemicBadge";
import { Section } from "./EvidenceSection";

const pct = (v: number) => Math.round(v * 100);

const TYPE_LABEL: Record<ReviewEntry["type"], string> = {
  "task-gap-link": "Task addresses gap",
  "gap-hypothesis-link": "Gap concerns hypothesis",
  "observation-gap-link": "Observation addresses gap",
  "hypothesis-support": "Interpretation rests on observation",
  "derived-gap": "Rule-defined gap",
  "relevance-classification": "Local / regional classification",
  "priority-statement": "Priority statement",
  "discrimination-assessment": "Discrimination assessment",
};

/** Human-readable names for registry references (all strings; translation-safe). */
export function makeDescriber(scenario: Scenario, registry: ReviewRegistry) {
  const title = new Map<string, string>([
    ...scenario.tasks.map((t) => [`task:${t.id}`, t.title] as const),
    ...scenario.gaps.map((g) => [`gap:${g.id}`, g.title] as const),
    ...scenario.interpretations.map((i) => [`interpretation:${i.id}`, i.title] as const),
    ...scenario.observations.map((o) => [`observation:${o.id}`, o.title] as const),
  ]);
  const name = (r: RecordRef) =>
    r.kind === "classification" ? r.id : r.kind === "rule" ? "MDI rule" : r.kind === "statement" ? "cited importance" : (title.get(`${r.kind}:${r.id}`) ?? r.id);
  const byId = new Map(registry.entries.map((e) => [e.id, e]));
  return (reviewId: string) => {
    const e = byId.get(reviewId);
    return e ? `${TYPE_LABEL[e.type]}: ${name(e.source)} → ${name(e.target)}` : reviewId;
  };
}

/** Feasible tasks (under the current constraints) that the reviewed ranking could not assess. */
export function feasibleExcluded(reviewed: ReviewedRanking, provisional: ProvisionalRanking): string[] {
  const infeasible = new Set(provisional.recommendation.infeasible.map((t) => t.taskId));
  return reviewed.notAssessed.map((t) => t.taskId).filter((id) => !infeasible.has(id));
}

export function ReviewedRankingSection({
  reviewed,
  excludedCount,
  taskTitle,
}: {
  reviewed: ReviewedRanking;
  /** Feasible tasks excluded because their scientific review is incomplete. */
  excludedCount: number;
  taskTitle: (id: string) => string;
}) {
  const rec = reviewed.recommendation;
  const top = rec?.ranking[0];
  return (
    <Section title="Reviewed scenario ranking">
      <div data-testid="reviewed-ranking">
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <EpistemicBadge kind="reviewed" />
          <span className="text-muted">{"Uses only relationships approved by a named human reviewer. Not a NASA recommendation or endorsement."}</span>
        </p>
        <p className="mt-1 text-xs" data-testid="excluded-count">
          {`Feasible tasks excluded because their scientific review is incomplete: ${excludedCount}`}
        </p>
        {reviewed.status.state === "unavailable" ? (
          <div className="mt-2 rounded-md border border-warn/60 bg-background p-3" data-testid="reviewed-status" data-state="unavailable">
            <p className="text-sm font-semibold">{"Reviewed ranking unavailable"}</p>
            <p className="mt-1 text-xs">{reviewed.status.reason}</p>
            <p className="mt-1 text-xs text-muted">
              {"No reviewed recommendation is shown. A provisional, unvalidated ranking is available below for exploration."}
            </p>
          </div>
        ) : rec ? (
          <div className="mt-2" data-testid="reviewed-status" data-state={reviewed.status.state}>
            {top ? (
              <p className="text-sm font-semibold" data-testid="reviewed-top">
                {reviewed.status.state === "partial"
                  ? `Top among reviewed tasks: ${taskTitle(top.taskId)}`
                  : `Top-ranked task (all feasible tasks reviewed): ${taskTitle(top.taskId)}`}
              </p>
            ) : null}
            {reviewed.status.state === "partial" ? (
              <p className="mb-2 rounded border border-warn/60 px-2 py-1 text-xs text-warn">
                {`Partial comparison: ${reviewed.status.notAssessedTaskIds.map(taskTitle).join("; ")} not assessed (awaiting review). This ranking does not compare against those tasks.`}
              </p>
            ) : null}
            <ol className="space-y-1 text-xs" data-testid="reviewed-list">
              {rec.ranking.map((r) => (
                <li key={r.taskId} className="flex justify-between gap-2">
                  <span>{`${r.rank}. ${taskTitle(r.taskId)}`}</span>
                  <span className="font-mono">{`${pct(r.total)} / 100`}</span>
                </li>
              ))}
            </ol>
            <p className="mt-1 text-[11px] text-muted">
              {"Scenario decision score: how well each option fits this simulated scenario using approved relationships only. Not a probability and not a NASA recommendation."}
            </p>
          </div>
        ) : null}
        {reviewed.notAssessed.length ? (
          <details className="mt-2 text-[11px]">
            <summary className="cursor-pointer text-muted">
              {`${reviewed.notAssessed.length} task(s) not assessed · ${reviewed.awaitingReview.length} relationship(s) awaiting review`}
            </summary>
            <ul className="mt-1 list-disc pl-4">
              {reviewed.notAssessed.map((t) => (
                <li key={t.taskId}>{`${taskTitle(t.taskId)}: blocked by ${t.blockingReviewIds.length} unreviewed relationship(s)`}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Section>
  );
}

export function ProvisionalSection({
  provisional,
  describe,
  taskTitle,
  children,
}: {
  provisional: ProvisionalRanking;
  describe: (reviewId: string) => string;
  taskTitle: (id: string) => string;
  children: ReactNode;
}) {
  const top = provisional.recommendation.ranking[0];
  return (
    <details className="group border-b border-border px-4 py-3" data-testid="provisional-ranking">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
        <span>{`Provisional exploratory ranking (${provisional.unreviewedInputs.length} unreviewed inputs)`}</span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-2">
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <EpistemicBadge kind="provisional" />
          <span className="text-muted">
            {"Uses AI-drafted relationships that no human has reviewed. For exploration and debugging only."}
          </span>
        </p>
        <div className="mt-2 rounded border border-warn/60 px-2 py-1.5 text-xs" data-testid="pivotal-inputs">
          <p className="font-semibold">
            {top
              ? `Unreviewed inputs that change the provisional top task (${taskTitle(top.taskId)}) if removed: ${provisional.pivotalInputs.length}`
              : "No provisional top task."}
          </p>
          <ul className="mt-1 space-y-1">
            {provisional.pivotalInputs.map((p) => (
              <li key={p.reviewId} data-review-id={p.reviewId}>
                <span className="block">{describe(p.reviewId)}</span>
                <span className="block font-mono text-[10px] text-muted">
                  {`${p.reviewId} → top task would be: ${p.topTaskWithout ? taskTitle(p.topTaskWithout) : "none"}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer text-muted">{`All ${provisional.unreviewedInputs.length} unreviewed inputs used`}</summary>
          <ul className="mt-1 space-y-0.5 font-mono text-[10px]" data-testid="unreviewed-inputs">
            {provisional.unreviewedInputs.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
          {provisional.unreviewedNotScored.length ? (
            <p className="mt-1 text-muted">
              {`Also pending but not scored (Not Evaluated until approved): ${provisional.unreviewedNotScored.join(", ")}`}
            </p>
          ) : null}
        </details>
      </div>
      <div className="-mx-4 mt-2">{children}</div>
    </details>
  );
}

export function ReviewRegistrySection({
  registry,
  visibleIds,
  describe,
  sourceById,
}: {
  registry: ReviewRegistry;
  visibleIds: ReadonlySet<string>;
  describe: (reviewId: string) => string;
  sourceById: ReadonlyMap<string, Source>;
}) {
  const entries = registry.entries.filter((e) => visibleIds.has(e.id));
  const counts = entries.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
  const summary = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  return (
    <Section title="Scientific review registry" count={entries.length} defaultOpen={false}>
      <p className="text-[11px] text-muted">
        {`Relationships that can affect a ranking and exist on this date: ${summary || "none"}. A verified citation is not a scientific approval; only a named human reviewer can approve.`}
      </p>
      <ul className="mt-2 space-y-2" data-testid="review-registry">
        {entries.map((e) => (
          <li key={e.id} className="rounded-md border border-border bg-surface-raised p-2 text-[11px]" data-review-id={e.id} data-status={e.status}>
            <p className="flex flex-wrap items-center gap-1.5">
              <ReviewBadge review={{ draftedBy: e.draftedBy, status: e.status, reviewedBy: e.reviewedBy, reviewedOn: e.reviewedOn }} />
              <span className="font-mono text-[10px] text-muted">{e.id}</span>
            </p>
            <p className="mt-1 font-medium">{describe(e.id)}</p>
            <p className="mt-0.5">{`Reasoning: ${e.reasoning}`}</p>
            {e.limitations.length ? (
              <ul className="mt-0.5 list-disc pl-4 text-muted">
                {e.limitations.map((l) => (
                  <li key={l}>{`Limitation: ${l}`}</li>
                ))}
              </ul>
            ) : null}
            <Citations citations={e.evidence} sourceById={sourceById} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
