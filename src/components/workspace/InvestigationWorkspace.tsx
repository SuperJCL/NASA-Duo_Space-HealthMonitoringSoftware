"use client";

import { useMemo, useState } from "react";
import { DEFAULT_WEIGHTS, type CriterionId, type Weights } from "@/lib/decision/criteria";
import { defaultConstraints, recommend, type Constraints } from "@/lib/decision/engine";
import { reviewAgainstLaterEvidence } from "@/lib/decision/retrospective";
import type { Scenario, Source } from "@/lib/evidence/schema";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { Citations } from "./Citations";
import { DecisionSection } from "./DecisionSection";
import { EvidenceSection } from "./EvidenceSection";
import { RevealSection } from "./RevealSection";

type Props = { scenario: Scenario; sources: Source[] };

/**
 * Client-side investigation workflow. All logic lives in src/lib (pure,
 * tested); this component only holds UI state (snapshot date, weights).
 */
export function InvestigationWorkspace({ scenario, sources }: Props) {
  const [asOf, setAsOf] = useState(scenario.defaultSnapshotDate);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);

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
  const constraints = useMemo(
    () => constraintsOverride ?? defaultConstraints(snapshot),
    [constraintsOverride, snapshot],
  );
  const recommendation = useMemo(
    () => recommend(snapshot, weights, constraints),
    [snapshot, weights, constraints],
  );
  const review = useMemo(
    () => reviewAgainstLaterEvidence(recommendation, later),
    [recommendation, later],
  );

  const onDateChange = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= scenario.minSnapshotDate) setAsOf(value);
  };
  const onWeightChange = (id: CriterionId, value: number) =>
    setWeights((prev) => ({ ...prev, [id]: value }));

  return (
    <aside
      aria-labelledby="workspace-heading"
      className="flex min-h-0 flex-1 flex-col border-t border-border bg-surface lg:w-[30rem] lg:flex-none lg:border-t-0 lg:border-l xl:w-[34rem]"
    >
      <div className="border-b border-border px-4 py-3">
        <p className="text-[11px] uppercase tracking-wider text-muted">Retrospective scenario</p>
        <h2 id="workspace-heading" className="text-base font-semibold">
          {scenario.title}
        </h2>
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer">
            {scenario.site.name} · {scenario.site.parentFeature}
          </summary>
          <p className="mt-1">{scenario.site.description}</p>
          <Citations citations={scenario.site.citations} sourceById={sourceById} />
        </details>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="block text-muted">Snapshot date</span>
            <input
              type="date"
              value={asOf}
              min={scenario.minSnapshotDate}
              max={latestRecordDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="mt-0.5 rounded border border-border bg-surface-raised px-2 py-1 font-mono text-foreground"
              data-testid="snapshot-date"
            />
          </label>
          <button
            type="button"
            onClick={() => setAsOf(scenario.defaultSnapshotDate)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-raised"
          >
            Scenario default
          </button>
          <button
            type="button"
            onClick={() => setAsOf(latestRecordDate)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-raised"
          >
            All evidence
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted" data-testid="snapshot-summary">
          Using evidence public on or before {asOf}:{" "}
          {snapshot.observations.filter((o) => o.relevance === "local").length} margin-unit observations,{" "}
          {snapshot.interpretations.filter((i) => i.relevance === "local").length} hypotheses/interpretations,{" "}
          {snapshot.gaps.filter((g) => g.relevance === "local").length} gaps, plus{" "}
          {[...snapshot.observations, ...snapshot.interpretations, ...snapshot.gaps].filter((r) => r.relevance === "regional-context").length}{" "}
          regional-context records. {snapshot.hiddenLaterCount} later record(s) withheld.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <EvidenceSection
          observations={snapshot.observations}
          interpretations={snapshot.interpretations}
          gaps={snapshot.gaps}
          sourceById={sourceById}
        />
        <DecisionSection
          recommendation={recommendation}
          tasks={snapshot.tasks}
          gaps={snapshot.gaps}
          interpretations={snapshot.interpretations}
          assessments={snapshot.discriminationAssessments}
          resources={snapshot.resources}
          assumptions={snapshot.assumptions}
          weights={weights}
          onWeightChange={onWeightChange}
          onResetWeights={() => setWeights(DEFAULT_WEIGHTS)}
          constraints={constraints}
          onConstraintsChange={setConstraints}
          onResetConstraints={() => setConstraints(null)}
          sourceById={sourceById}
        />
        <RevealSection
          asOf={asOf}
          later={later}
          review={review}
          tasks={scenario.tasks}
          allGaps={scenario.gaps}
          sourceById={sourceById}
        />
      </div>
    </aside>
  );
}
