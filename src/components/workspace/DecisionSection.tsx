import { CRITERIA, MAX_WEIGHT, type CriterionId, type Weights } from "@/lib/decision/criteria";
import type { Recommendation } from "@/lib/decision/engine";
import type { Assumption, CandidateTask, SimulatedResource, Source } from "@/lib/evidence/schema";
import { Citations } from "./Citations";
import { EpistemicBadge } from "./EpistemicBadge";
import { Section } from "./EvidenceSection";

const pct = (value: number) => Math.round(value * 100);
const SHORT_LABEL: Record<CriterionId, string> = {
  "gap-coverage": "Gaps",
  discrimination: "Discrim.",
  "independent-evidence": "Indep.",
  "resource-cost": "Cost",
};

type Props = {
  recommendation: Recommendation;
  tasks: readonly CandidateTask[];
  resources: readonly SimulatedResource[];
  assumptions: readonly Assumption[];
  weights: Weights;
  onWeightChange: (id: CriterionId, value: number) => void;
  onResetWeights: () => void;
  sourceById: ReadonlyMap<string, Source>;
};

export function DecisionSection({
  recommendation,
  tasks,
  resources,
  assumptions,
  weights,
  onWeightChange,
  onResetWeights,
  sourceById,
}: Props) {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const assumptionById = new Map(assumptions.map((a) => [a.id, a]));
  const top = recommendation.ranking[0];
  const topTask = top ? taskById.get(top.taskId) : undefined;

  return (
    <>
      <Section title="Candidate observation tasks" count={tasks.length}>
        <p className="text-xs text-muted">
          Tasks, costs and budgets are <EpistemicBadge kind="simulated" /> planning constructs, not NASA
          mission plans. Instruments named are real Perseverance or orbiter instruments.
        </p>
        <ul className="mt-2 space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="rounded-md border border-border bg-surface-raised p-3" data-record-id={t.id}>
              <div className="flex flex-wrap items-center gap-1.5">
                <EpistemicBadge kind="simulated" detail="task" />
                <span className="text-[11px] text-muted">
                  {t.platform} · {t.instruments.join(", ")}
                </span>
              </div>
              <p className="mt-1.5 text-sm font-medium">{t.title}</p>
              <p className="mt-0.5 text-xs text-foreground/85">{t.description}</p>
              <p className="mt-1 text-[11px] text-muted">
                Cost:{" "}
                {resources
                  .map((r) => `${t.costs[r.id] ?? 0} / ${r.budget} ${r.unit} (${r.name})`)
                  .join("; ")}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Criteria weights">
        <p className="text-xs text-muted">
          Deterministic, rule-derived criteria. Adjust weights to see how the ranking responds.
        </p>
        <div className="mt-2 space-y-2">
          {CRITERIA.map((c) => (
            <label key={c.id} className="block">
              <span className="flex items-center justify-between text-xs">
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-muted">{weights[c.id]}</span>
              </span>
              <input
                type="range"
                min={0}
                max={MAX_WEIGHT}
                step={1}
                value={weights[c.id]}
                onChange={(e) => onWeightChange(c.id, Number(e.target.value))}
                className="w-full accent-accent"
                aria-describedby={`rule-${c.id}`}
              />
              <span id={`rule-${c.id}`} className="block text-[11px] text-muted">
                {c.rule}
              </span>
            </label>
          ))}
          <button
            type="button"
            onClick={onResetWeights}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-raised"
          >
            Reset weights
          </button>
        </div>
      </Section>

      <Section title="Comparison">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="comparison-table">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-2 font-normal">#</th>
                <th className="py-1 pr-2 font-normal">Task</th>
                {CRITERIA.map((c) => (
                  <th key={c.id} className="py-1 pr-2 text-right font-normal" title={c.rule}>
                    {SHORT_LABEL[c.id]}
                  </th>
                ))}
                <th className="py-1 text-right font-normal">Score</th>
              </tr>
            </thead>
            <tbody>
              {recommendation.ranking.map((r) => (
                <tr key={r.taskId} className="border-t border-border" data-task-id={r.taskId}>
                  <td className="py-1.5 pr-2 font-mono">{r.rank}</td>
                  <td className="py-1.5 pr-2">{taskById.get(r.taskId)?.title ?? r.taskId}</td>
                  {r.scores.map((s) => (
                    <td key={s.criterionId} className="py-1.5 pr-2 text-right font-mono text-muted">
                      {pct(s.value)}
                    </td>
                  ))}
                  <td className="py-1.5 text-right font-mono font-semibold">{pct(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recommendation.infeasible.length ? (
          <ul className="mt-2 space-y-1 text-[11px] text-warn">
            {recommendation.infeasible.map((t) => (
              <li key={t.taskId}>
                Not ranked — {taskById.get(t.taskId)?.title ?? t.taskId}: {t.reason}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-[11px] text-muted">
          Criterion values and scores are 0–100. Score = weighted average of criterion values.
        </p>
      </Section>

      <Section title="Recommendation">
        {top && topTask ? (
          <div data-testid="recommendation">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted">
                  Top-ranked as of {recommendation.asOf}
                </p>
                <p className="text-base font-semibold">{topTask.title}</p>
              </div>
              <p className="font-mono text-2xl font-semibold text-accent">{pct(top.total)}</p>
            </div>

            <h4 className="mt-3 text-xs font-semibold">Why</h4>
            <ul className="mt-1 space-y-1.5">
              {top.scores.map((s) => {
                const criterion = CRITERIA.find((c) => c.id === s.criterionId)!;
                return (
                  <li key={s.criterionId} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span>{criterion.name}</span>
                      <span className="font-mono text-muted">
                        {pct(s.value)} × w{s.weight} → +{pct(s.contribution)}
                      </span>
                    </div>
                    <div className="mt-0.5 h-1 rounded bg-border">
                      <div className="h-1 rounded bg-accent" style={{ width: `${pct(s.value)}%` }} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">{s.explanation}</p>
                  </li>
                );
              })}
            </ul>

            <p className="mt-3 text-xs">
              <span className="font-semibold">Stability: </span>
              stays #1 in {recommendation.stability.topUnchanged} of {recommendation.stability.trials} runs
              with each weight changed by ±{pct(recommendation.stability.perturbation)}%
              {recommendation.stability.margin !== null
                ? `; lead over #2: ${pct(recommendation.stability.margin)} points.`
                : "."}
            </p>

            <h4 className="mt-3 text-xs font-semibold">Assumptions</h4>
            {recommendation.assumptionIds.length ? (
              <ul className="mt-1 space-y-1.5">
                {recommendation.assumptionIds.map((id) => {
                  const a = assumptionById.get(id);
                  if (!a) return null;
                  return (
                    <li key={id} className="text-xs">
                      <EpistemicBadge kind="assumed" /> {a.statement}
                      <span className="block text-[11px] text-muted">{a.rationale}</span>
                      <Citations citations={a.citations} sourceById={sourceById} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted">None recorded.</p>
            )}

            <h4 className="mt-3 text-xs font-semibold">Limitations</h4>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-muted">
              {recommendation.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="mt-2 font-mono text-[10px] text-muted">engine v{recommendation.engineVersion}</p>
          </div>
        ) : (
          <p className="text-xs text-muted">No feasible task to recommend.</p>
        )}
      </Section>
    </>
  );
}
