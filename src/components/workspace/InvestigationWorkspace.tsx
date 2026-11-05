"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_WEIGHTS, type CriterionId, type Weights } from "@/lib/decision/criteria";
import { defaultConstraints, type Constraints } from "@/lib/decision/engine";
import { reviewAgainstLaterEvidence } from "@/lib/decision/retrospective";
import { rankProvisional, rankReviewed, visibleRelationships } from "@/lib/decision/review-modes";
import type { ReviewRegistry } from "@/lib/evidence/review-registry";
import type { Scenario, Source } from "@/lib/evidence/schema";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { IntegrityBar } from "@/components/flow/IntegrityBar";
import { Stepper } from "@/components/flow/Stepper";
import { STEPS, stepIndex } from "@/components/flow/steps";
import { Citations } from "./Citations";
import { DecisionSection } from "./DecisionSection";
import { EvidenceSection } from "./EvidenceSection";
import {
  feasibleExcluded,
  makeDescriber,
  ProvisionalSection,
  ReviewedRankingSection,
  ReviewRegistrySection,
} from "./RankingIntegrity";
import { RevealSection } from "./RevealSection";

type Props = { scenario: Scenario; sources: Source[]; registry: ReviewRegistry; map: ReactNode };

/**
 * Guided five-step investigation (UX-1). All scientific logic lives in
 * src/lib (pure, tested); this component only holds UI state: mission date,
 * weights, constraints and the current step. All steps stay mounted (hidden
 * when inactive) so every selection survives navigation.
 */
export function InvestigationWorkspace({ scenario, sources, registry, map }: Props) {
  const [asOf, setAsOf] = useState(scenario.defaultSnapshotDate);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [step, setStep] = useState(0);

  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const latestRecordDate = useMemo(
    () =>
      [...scenario.observations, ...scenario.interpretations, ...scenario.gaps]
        .map((r) => r.availableFrom)
        .reduce((a, b) => (a > b ? a : b), scenario.defaultSnapshotDate),
    [scenario],
  );

  const { snapshot, later } = useMemo(() => selectEvidenceAsOf(scenario, asOf), [scenario, asOf]);
  const [constraintsOverride, setConstraints] = useState<Constraints | null>(null);
  const constraints = useMemo(() => constraintsOverride ?? defaultConstraints(snapshot), [constraintsOverride, snapshot]);
  // RI-1: the reviewed ranking (approved relationships only) is the primary result;
  // the provisional ranking reproduces the M3 engine output and is shown collapsed.
  const provisional = useMemo(
    () => rankProvisional(scenario, registry, asOf, weights, constraints),
    [scenario, registry, asOf, weights, constraints],
  );
  const reviewedRanking = useMemo(
    () => rankReviewed(scenario, registry, asOf, weights, constraints),
    [scenario, registry, asOf, weights, constraints],
  );
  const recommendation = provisional.recommendation;
  const review = useMemo(() => reviewAgainstLaterEvidence(recommendation, later), [recommendation, later]);
  const describe = useMemo(() => makeDescriber(scenario, registry), [scenario, registry]);
  const visibleReviewIds = useMemo(() => new Set(visibleRelationships(snapshot).map((r) => r.id)), [snapshot]);
  const excluded = feasibleExcluded(reviewedRanking, provisional);
  const taskTitle = (id: string) => scenario.tasks.find((t) => t.id === id)?.title ?? id;
  const provisionalTop = recommendation.ranking[0];

  const onDateChange = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= scenario.minSnapshotDate) setAsOf(value);
  };
  const onWeightChange = (id: CriterionId, value: number) => setWeights((prev) => ({ ...prev, [id]: value }));

  // Navigation: scroll the panel to the top and move focus to the step heading.
  const headingRefs = useRef<(HTMLHeadingElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigated = useRef(false);
  const goTo = (index: number) => {
    navigated.current = true;
    setStep(Math.max(0, Math.min(STEPS.length - 1, index)));
  };
  useEffect(() => {
    if (!navigated.current) return; // do not steal focus on first load
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    headingRefs.current[step]?.focus();
  }, [step]);

  const decisionProps = {
    recommendation,
    tasks: snapshot.tasks,
    gaps: snapshot.gaps,
    interpretations: snapshot.interpretations,
    assessments: snapshot.discriminationAssessments,
    resources: snapshot.resources,
    assumptions: snapshot.assumptions,
    weights,
    onWeightChange,
    onResetWeights: () => setWeights(DEFAULT_WEIGHTS),
    constraints,
    onConstraintsChange: setConstraints,
    onResetConstraints: () => setConstraints(null),
    sourceById,
  };

  const panel = (index: number, intro: string, children: ReactNode) => {
    const s = STEPS[index];
    return (
      <section
        key={s.id}
        hidden={step !== index}
        aria-labelledby={`step-heading-${s.id}`}
        data-step={s.id}
        data-testid={`panel-${s.id}`}
      >
        <div className="border-b border-border px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-muted">{`Step ${index + 1} of ${STEPS.length}`}</p>
          <h2
            id={`step-heading-${s.id}`}
            ref={(el) => {
              headingRefs.current[index] = el;
            }}
            tabIndex={-1}
            className="text-base font-semibold focus:outline-none focus-visible:underline"
          >
            {s.heading}
          </h2>
          <p className="mt-1 text-xs text-muted">{intro}</p>
        </div>
        {children}
      </section>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-border bg-surface px-4 py-2">
        <Stepper current={step} onSelect={goTo} />
        <IntegrityBar
          asOf={asOf}
          hiddenLaterCount={snapshot.hiddenLaterCount}
          reviewed={reviewedRanking}
          excludedCount={excluded.length}
          onShowMission={() => goTo(stepIndex("mission"))}
          onShowResult={() => goTo(stepIndex("result"))}
        />
      </div>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section aria-label="Mars map" className="relative h-[40dvh] shrink-0 lg:h-auto lg:flex-1">
          {map}
        </section>

        <aside
          aria-label="Investigation workflow"
          className="flex min-h-0 flex-1 flex-col border-t border-border bg-surface lg:w-[30rem] lg:flex-none lg:border-t-0 lg:border-l xl:w-[34rem]"
        >
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {panel(
              0,
              "Read the goal, choose the mission date, then continue.",
              <div className="space-y-3 px-4 py-3 text-xs">
                <p className="rounded-md border border-accent-muted bg-background p-3 text-sm font-medium" data-testid="mission-question">
                  {"You have limited time to investigate Mars. What should you observe next, and why?"}
                </p>
                <p>
                  {
                    "In this simulated scenario you plan the next observation of the margin unit in Jezero crater. You see only the evidence that was public on the mission date you choose; later results stay hidden until the end."
                  }
                </p>
                <ol className="list-decimal space-y-0.5 pl-5" aria-label="How it works">
                  <li>{"Mission: choose the mission date."}</li>
                  <li>{"Evidence: what had been observed and proposed by then."}</li>
                  <li>{"Unknowns: what scientists did not yet know."}</li>
                  <li>{"Decision: compare candidate observations under a simulated budget."}</li>
                  <li>{"Result: which options fit best, how reliable that is, and what happened later."}</li>
                </ol>

                <div className="rounded-md border border-border bg-surface-raised p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted">{"Retrospective scenario"}</p>
                  <h3 id="workspace-heading" className="text-sm font-semibold">
                    {scenario.title}
                  </h3>
                  <details className="mt-1 text-muted">
                    <summary className="cursor-pointer">{`${scenario.site.name} · ${scenario.site.parentFeature}`}</summary>
                    <p className="mt-1">{scenario.site.description}</p>
                    <Citations citations={scenario.site.citations} sourceById={sourceById} />
                  </details>
                </div>

                <div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label>
                      <span className="block text-muted">{"Mission date"}</span>
                      <input
                        type="date"
                        value={asOf}
                        min={scenario.minSnapshotDate}
                        max={latestRecordDate}
                        onChange={(e) => onDateChange(e.target.value)}
                        className="mt-0.5 rounded border border-border bg-surface-raised px-2 py-1 font-mono text-foreground"
                        data-testid="snapshot-date"
                        aria-describedby="date-range-help"
                      />
                    </label>
                    <button type="button" onClick={() => setAsOf(scenario.defaultSnapshotDate)} className="rounded border border-border px-2 py-1 hover:bg-surface-raised">
                      Scenario default
                    </button>
                    <button type="button" onClick={() => setAsOf(latestRecordDate)} className="rounded border border-border px-2 py-1 hover:bg-surface-raised">
                      All evidence
                    </button>
                  </div>
                  <p id="date-range-help" className="mt-1 text-[11px] text-muted">
                    {`Valid range: ${scenario.minSnapshotDate} to ${latestRecordDate}. The default is ${scenario.defaultSnapshotDate}.`}
                  </p>
                  <p className="mt-1 text-[11px] text-muted" data-testid="snapshot-summary">
                    {`Using evidence public on or before ${asOf}: ${
                      snapshot.observations.filter((o) => o.relevance === "local").length
                    } margin-unit observations, ${
                      snapshot.interpretations.filter((i) => i.relevance === "local").length
                    } hypotheses/interpretations, ${snapshot.gaps.filter((g) => g.relevance === "local").length} gaps, plus ${
                      [...snapshot.observations, ...snapshot.interpretations, ...snapshot.gaps].filter(
                        (r) => r.relevance === "regional-context",
                      ).length
                    } regional-context records. ${snapshot.hiddenLaterCount} later record(s) withheld.`}
                  </p>
                </div>

                <div className="rounded-md border border-warn/60 p-3" data-testid="mission-caveats">
                  <p className="font-semibold">{"Before you start"}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    <li>{"This is a simulation for learning and exploration, not a NASA plan, recommendation or endorsement."}</li>
                    <li>{"Task costs and budgets are simulated."}</li>
                    <li>{"Scores are scenario decision scores, not probabilities that a hypothesis is true."}</li>
                    <li>{`Some scientific relationships were drafted by AI and await expert review (${reviewedRanking.awaitingReview.length} on this date); they are labelled, and the reviewed ranking does not use them.`}</li>
                  </ul>
                </div>
              </div>,
            )}

            {panel(
              1,
              `What had been observed and proposed by ${asOf}. Each item quotes its source. Regional background is kept separate from margin-unit evidence.`,
              <EvidenceSection
                show={["observations", "hypotheses", "regional"]}
                observations={snapshot.observations}
                interpretations={snapshot.interpretations}
                gaps={snapshot.gaps}
                sourceById={sourceById}
              />,
            )}

            {panel(
              2,
              `Open questions that the evidence public by ${asOf} could not settle. Each is quoted from a source or defined by a stated rule.`,
              <EvidenceSection
                show={["gaps"]}
                observations={snapshot.observations}
                interpretations={snapshot.interpretations}
                gaps={snapshot.gaps}
                sourceById={sourceById}
              />,
            )}

            {panel(
              3,
              "Look at the candidate observations, adjust the simulated budget and factors, and see how the rankings respond.",
              <>
                <div className="border-b border-border px-4 py-3 text-xs" data-testid="decision-status">
                  <p className="font-semibold">{"Ranking status"}</p>
                  <p className="mt-0.5">
                    {reviewedRanking.status.state === "unavailable"
                      ? "Reviewed ranking: unavailable until enough relationships are expert-reviewed."
                      : reviewedRanking.status.state === "partial"
                        ? `Reviewed ranking: top among reviewed tasks is ${taskTitle(reviewedRanking.recommendation!.ranking[0].taskId)}.`
                        : `Reviewed ranking: ${taskTitle(reviewedRanking.recommendation!.ranking[0].taskId)} ranks first.`}
                  </p>
                  <p className="mt-0.5 text-warn">
                    {provisionalTop
                      ? `Provisional top task (not validated): ${taskTitle(provisionalTop.taskId)}`
                      : "Provisional ranking: no task can be ranked under the current constraints."}
                  </p>
                  <button
                    type="button"
                    onClick={() => goTo(stepIndex("result"))}
                    className="mt-2 rounded border border-accent-muted px-2 py-1 text-accent hover:bg-surface-raised"
                  >
                    See the result
                  </button>
                </div>
                <DecisionSection part="inputs" {...decisionProps} />
                <details className="group border-b border-border" data-testid="provisional-comparison">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
                    <span>{"Compare tasks side by side (provisional, not validated)"}</span>
                    <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
                      ›
                    </span>
                  </summary>
                  <DecisionSection part="comparison" {...decisionProps} />
                </details>
              </>,
            )}

            {panel(
              4,
              "The reviewed ranking uses only expert-approved relationships. The provisional ranking is for exploration and is not scientifically validated.",
              <>
                <ReviewedRankingSection reviewed={reviewedRanking} excludedCount={excluded.length} taskTitle={taskTitle} />
                <ProvisionalSection provisional={provisional} describe={describe} taskTitle={taskTitle}>
                  <DecisionSection part="recommendation" {...decisionProps} />
                </ProvisionalSection>
                <RevealSection asOf={asOf} later={later} review={review} tasks={scenario.tasks} allGaps={scenario.gaps} sourceById={sourceById} />
                <ReviewRegistrySection registry={registry} visibleIds={visibleReviewIds} describe={describe} sourceById={sourceById} />
              </>,
            )}
          </div>

          <nav aria-label="Step navigation" className="flex items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2">
            <button
              type="button"
              onClick={() => goTo(step - 1)}
              disabled={step === 0}
              data-testid="step-back"
              className="rounded border border-border px-3 py-1.5 text-xs hover:bg-surface-raised disabled:opacity-40"
            >
              {step > 0 ? `← Back: ${STEPS[step - 1].label}` : "← Back"}
            </button>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => goTo(step + 1)}
                data-testid="step-next"
                className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
              >
                {`Next: ${STEPS[step + 1].label} →`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goTo(0)}
                data-testid="step-restart"
                className="rounded border border-border px-3 py-1.5 text-xs hover:bg-surface-raised"
              >
                {"Back to Mission"}
              </button>
            )}
          </nav>
        </aside>
      </main>
    </div>
  );
}
