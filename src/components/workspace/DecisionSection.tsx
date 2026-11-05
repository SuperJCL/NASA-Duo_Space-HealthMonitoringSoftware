import { CRITERIA, MAX_WEIGHT, type CriterionId, type Weights } from "@/lib/decision/criteria";
import { relationshipIds } from "@/lib/evidence/review-registry";
import type { Constraints, CriterionOutcome, Recommendation, TaskEvaluation } from "@/lib/decision/engine";
import type {
  Assumption,
  CandidateTask,
  DiscriminationAssessment,
  Interpretation,
  SimulatedResource,
  Source,
  TaskPlatform,
} from "@/lib/evidence/schema";
import type { SnapshotGap } from "@/lib/evidence/snapshot";
import { Citations } from "./Citations";
import { EpistemicBadge, ReviewBadge } from "./EpistemicBadge";
import { Section } from "./EvidenceSection";

const pct = (value: number) => Math.round(value * 100);
const SHORT_LABEL: Record<CriterionId, string> = {
  "gap-coverage": "Gaps",
  "hypothesis-discrimination": "Discrim.",
  "resource-feasibility": "Feasib.",
  "scientific-priority": "Priority",
  "evidence-quality": "Quality",
};
const PLATFORMS: { id: TaskPlatform; label: string }[] = [
  { id: "orbital", label: "Orbital imaging" },
  { id: "rover", label: "Rover operations" },
  { id: "lab", label: "Earth laboratories (sample return)" },
];

type Props = {
  /** "inputs": tasks, constraints, weights. "results": provisional comparison and recommendation. */
  part: "inputs" | "results";
  recommendation: Recommendation;
  tasks: readonly CandidateTask[];
  gaps: readonly SnapshotGap[];
  interpretations: readonly Interpretation[];
  assessments: readonly DiscriminationAssessment[];
  resources: readonly SimulatedResource[];
  assumptions: readonly Assumption[];
  weights: Weights;
  onWeightChange: (id: CriterionId, value: number) => void;
  onResetWeights: () => void;
  constraints: Constraints;
  onConstraintsChange: (c: Constraints) => void;
  onResetConstraints: () => void;
  sourceById: ReadonlyMap<string, Source>;
};

function OutcomeCell({ o, inBasis }: { o: CriterionOutcome | undefined; inBasis: boolean }) {
  if (!o || o.status === "not-evaluated") {
    return (
      <td className="py-1.5 pr-2 text-right font-mono text-warn" title={o?.status === "not-evaluated" ? o.reason : ""}>
        NE
      </td>
    );
  }
  return <td className={`py-1.5 pr-2 text-right font-mono ${inBasis ? "text-foreground" : "text-muted/60"}`}>{pct(o.value)}</td>;
}

export function DecisionSection(props: Props) {
  const { recommendation: rec, tasks, gaps, interpretations, assessments, resources, weights, constraints, sourceById } = props;
  const gapById = new Map(gaps.map((g) => [g.id, g]));
  const interpTitle = (id: string) => interpretations.find((i) => i.id === id)?.title ?? id;
  // With no feasible task there is nothing to rank, so "ranking basis" does not apply.
  const noFeasibleTask = rec.ranking.length === 0 && rec.unranked.length === 0;

  // Translation safety: every piece of text that can change is the sole child
  // of an element (a single template string). Browser page translators replace
  // text nodes; React can then update or remove only whole elements.

  if (props.part === "results") return <ProvisionalResults {...props} />;

  return (
    <>
      <Section title="Candidate observation tasks" count={tasks.length}>
        <p className="text-xs text-muted">
          Tasks, costs and budgets are <EpistemicBadge kind="simulated" /> planning constructs, not NASA mission plans.
          Instruments named are real Perseverance, orbiter, or laboratory capabilities.
        </p>
        <ul className="mt-2 space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="rounded-md border border-border bg-surface-raised p-3" data-record-id={t.id}>
              <div className="flex flex-wrap items-center gap-1.5">
                <EpistemicBadge kind="simulated" detail="task" />
                <span className="text-[11px] text-muted">{`${t.platform} · ${t.instruments.join(", ")}`}</span>
              </div>
              <p className="mt-1.5 text-sm font-medium">{t.title}</p>
              <p className="mt-0.5 text-xs text-foreground/85">{t.description}</p>
              <p className="mt-1 text-[11px] text-muted">
                {`Cost: ${resources.map((r) => `${t.costs[r.id] ?? "missing"} ${r.unit} (${r.name})`).join("; ")}`}
              </p>
              <div className="mt-2" data-testid="task-gap-links">
                <p className="text-[11px] font-semibold">Evidence gaps this task addresses (MDI curation)</p>
                {t.addresses.length === 0 ? (
                  <p className="text-[11px] text-muted">None of its linked gaps exist yet on this date.</p>
                ) : (
                  <ul className="mt-1 space-y-1.5">
                    {t.addresses.map((l) => {
                      const g = gapById.get(l.gapId);
                      return (
                        <li key={l.gapId} className="border-l-2 border-border pl-2 text-[11px]">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{g?.title ?? l.gapId}</span>
                            {g?.status.state === "addressed" ? <span className="text-ok">(addressed)</span> : null}
                            <ReviewBadge review={l.review} />
                          </span>
                          <span className="block font-mono text-[10px] text-muted">{relationshipIds.taskGap(t.id, l.gapId)}</span>
                          <span className="block text-muted">{`Why: ${l.rationale}`}</span>
                          <Citations citations={l.citations} sourceById={sourceById} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {assessments
                .filter((a) => a.taskId === t.id)
                .map((a) => (
                  <div key={a.id} className="mt-2 rounded border border-border px-2 py-1.5 text-[11px]" data-testid="discrimination-assessment">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <EpistemicBadge kind="curated" detail="discrimination" /> <ReviewBadge review={a.review} />
                    </p>
                    <p className="mt-1">{`Competing: ${a.hypothesisIds.map(interpTitle).join(" vs. ")}`}</p>
                    <ul className="mt-1 list-disc pl-4">
                      {a.outcomes.map((o, n) => (
                        <li key={n}>
                          {`If observed: ${o.ifObserved}${o.favors.length ? ` → favors ${o.favors.map(interpTitle).join(", ")}` : ""}${
                            o.weakens.length ? ` → weakens ${o.weakens.map(interpTitle).join(", ")}` : ""
                          }`}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-muted">{a.rationale}</p>
                    <Citations citations={a.citations} sourceById={sourceById} />
                  </div>
                ))}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Mission constraints">
        <p className="text-xs text-muted">
          <EpistemicBadge kind="simulated" /> Change the budget or platform availability; infeasible tasks are excluded with a
          stated reason.
        </p>
        <div className="mt-2 space-y-2" data-testid="constraints">
          {resources.map((r) => (
            <label key={r.id} className="block text-xs">
              <span className="flex justify-between">
                <span className="font-medium">{`${r.name} budget (${r.unit})`}</span>
                <span className="font-mono text-muted">{constraints.budgets[r.id] ?? r.budget}</span>
              </span>
              <input
                type="range"
                min={0}
                max={r.budget * 2}
                step={5}
                value={constraints.budgets[r.id] ?? r.budget}
                onChange={(e) =>
                  props.onConstraintsChange({ ...constraints, budgets: { ...constraints.budgets, [r.id]: Number(e.target.value) } })
                }
                className="w-full accent-accent"
                aria-label={`${r.name} budget`}
              />
            </label>
          ))}
          {PLATFORMS.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!constraints.unavailablePlatforms.includes(p.id)}
                onChange={(e) =>
                  props.onConstraintsChange({
                    ...constraints,
                    unavailablePlatforms: e.target.checked
                      ? constraints.unavailablePlatforms.filter((x) => x !== p.id)
                      : [...constraints.unavailablePlatforms, p.id],
                  })
                }
                className="accent-accent"
              />
              <span>{`${p.label} available`}</span>
            </label>
          ))}
          <button type="button" onClick={props.onResetConstraints} className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-raised">
            Reset constraints
          </button>
        </div>
      </Section>

      <Section title="Criteria and weights">
        <p className="text-xs text-muted">
          <EpistemicBadge kind="deterministic" /> computed by fixed rules. <EpistemicBadge kind="curated" /> derived from
          human-approved scientific judgements; otherwise Not Evaluated (NE).
        </p>
        <div className="mt-2 space-y-3">
          {CRITERIA.map((c) => {
            const b = rec.basis.find((x) => x.criterionId === c.id)!;
            return (
              <label key={c.id} className="block">
                <span className="flex flex-wrap items-center justify-between gap-1 text-xs">
                  <span className="flex items-center gap-1.5 font-medium">
                    {c.name} <EpistemicBadge kind={c.basis} />
                  </span>
                  <span className="font-mono text-muted">{`w${weights[c.id]}`}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={MAX_WEIGHT}
                  step={1}
                  value={weights[c.id]}
                  onChange={(e) => props.onWeightChange(c.id, Number(e.target.value))}
                  className="w-full accent-accent"
                  aria-describedby={`rule-${c.id}`}
                  aria-label={`${c.name} weight`}
                />
                <span id={`rule-${c.id}`} className="block text-[11px] text-muted">
                  {c.rule}
                </span>
                <span
                  className={`block text-[11px] ${noFeasibleTask ? "text-muted" : b.inBasis ? "text-ok" : "text-warn"}`}
                  data-testid={`basis-${c.id}`}
                >
                  {noFeasibleTask
                    ? "Provisional ranking basis: not applicable — no task is feasible under the current constraints."
                    : b.inBasis
                      ? "Provisional ranking: In ranking basis."
                      : `Provisional ranking: Not in ranking basis: ${b.reason}`}
                </span>
              </label>
            );
          })}
          <button type="button" onClick={props.onResetWeights} className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-raised">
            Reset weights
          </button>
        </div>
      </Section>
    </>
  );
}

/** Provisional comparison table and recommendation card (rendered inside the collapsed provisional section). */
function ProvisionalResults(props: Props) {
  const { recommendation: rec, tasks, assumptions, weights, sourceById } = props;
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const assumptionById = new Map(assumptions.map((a) => [a.id, a]));
  const inBasis = new Set(rec.basis.filter((b) => b.inBasis).map((b) => b.criterionId));
  const rows: (TaskEvaluation & { rank?: number; total?: number })[] = rec.status.state === "ranked" ? rec.ranking : rec.unranked;
  const top = rec.ranking[0];
  const topTask = top ? taskById.get(top.taskId) : undefined;
  const noFeasibleTask = rec.ranking.length === 0 && rec.unranked.length === 0;
  const stabilityText = `stays #1 in ${rec.stability.topUnchanged} of ${rec.stability.trials} runs with each basis weight changed by ±${pct(
    rec.stability.perturbation,
  )}%${rec.stability.margin !== null ? `; lead over #2: ${pct(rec.stability.margin)} points.` : "."}`;

  return (
    <>
      <Section title="Comparison (provisional)">
        {rec.status.state === "not-ranked" ? (
          <p className="mb-2 text-xs text-warn" data-testid="not-ranked">
            {`Not ranked: ${rec.status.reason}`}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="comparison-table">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-2 font-normal">#</th>
                <th className="py-1 pr-2 font-normal">Task</th>
                {CRITERIA.map((c) => (
                  <th key={c.id} className="py-1 pr-2 text-right font-normal" title={c.rule}>
                    {`${SHORT_LABEL[c.id]}${noFeasibleTask || inBasis.has(c.id) ? "" : "*"}`}
                  </th>
                ))}
                <th className="py-1 text-right font-normal">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.taskId} className="border-t border-border" data-task-id={r.taskId}>
                  <td className="py-1.5 pr-2 font-mono">{r.rank ?? "–"}</td>
                  <td className="py-1.5 pr-2">{taskById.get(r.taskId)?.title ?? r.taskId}</td>
                  {CRITERIA.map((c) => (
                    <OutcomeCell key={c.id} o={r.outcomes.find((o) => o.criterionId === c.id)} inBasis={inBasis.has(c.id)} />
                  ))}
                  <td className="py-1.5 text-right font-mono font-semibold">{r.total !== undefined ? pct(r.total) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rec.infeasible.length ? (
          <ul className="mt-2 space-y-1 text-[11px] text-warn" data-testid="infeasible">
            {rec.infeasible.map((t) => (
              <li key={t.taskId}>{`Not ranked — ${taskById.get(t.taskId)?.title ?? t.taskId}: ${t.reason}`}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-[11px] text-muted">
          Values 0–100. NE = Not Evaluated (hover for the reason). * = not in the ranking basis. Score = weighted average over
          the ranking-basis criteria only.
        </p>
      </Section>

      <Section title="Provisional top-ranked task">
        {top && topTask ? (
          <div data-testid="recommendation">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-warn">{`Provisional · not scientifically validated · as of ${rec.asOf}`}</p>
                <p className="text-base font-semibold" data-testid="top-task">
                  {topTask.title}
                </p>
              </div>
              <p className="font-mono text-2xl font-semibold text-accent">{pct(top.total)}</p>
            </div>

            <h4 className="mt-3 text-xs font-semibold">Why</h4>
            <ul className="mt-1 space-y-1.5">
              {CRITERIA.map((c) => {
                const o = top.outcomes.find((x) => x.criterionId === c.id)!;
                const contribution = top.contributions[c.id];
                return (
                  <li key={c.id} className="text-xs" data-criterion={c.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        {c.name} <EpistemicBadge kind={c.basis} />
                      </span>
                      <span className="font-mono text-muted">
                        {o.status === "evaluated"
                          ? `${pct(o.value)} × w${weights[c.id]}${contribution !== undefined ? ` → +${pct(contribution)}` : " (not in basis)"}`
                          : "Not Evaluated"}
                      </span>
                    </div>
                    {o.status === "evaluated" ? (
                      <>
                        <div className="mt-0.5 h-1 rounded bg-border">
                          <div className="h-1 rounded bg-accent" style={{ width: `${pct(o.value)}%` }} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted">{o.explanation}</p>
                      </>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-warn">{o.reason}</p>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="mt-3 text-xs" data-testid="stability">
              <span className="font-semibold">{"Stability: "}</span>
              <span>{stabilityText}</span>
            </p>

            <h4 className="mt-3 text-xs font-semibold">Assumptions</h4>
            <ul className="mt-1 space-y-1.5">
              {rec.assumptionIds.map((id) => {
                const a = assumptionById.get(id);
                if (!a) return null;
                return (
                  <li key={id} className="text-xs">
                    <EpistemicBadge kind="assumed" /> <span>{a.statement}</span>
                    <span className="block text-[11px] text-muted">{a.rationale}</span>
                    <Citations citations={a.citations} sourceById={sourceById} />
                  </li>
                );
              })}
            </ul>

            <h4 className="mt-3 text-xs font-semibold">Limitations</h4>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-muted">
              {rec.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="mt-2 font-mono text-[10px] text-muted">{`engine v${rec.engineVersion}`}</p>
          </div>
        ) : (
          <p className="text-xs text-warn" data-testid="no-recommendation">
            {`No recommendation: ${rec.status.state === "not-ranked" ? rec.status.reason : "no ranked task."}`}
          </p>
        )}
      </Section>
    </>
  );
}
