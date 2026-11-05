"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_WEIGHTS, type CriterionId, type Weights } from "@/lib/decision/criteria";
import { defaultConstraints, type Constraints } from "@/lib/decision/engine";
import { reviewAgainstLaterEvidence } from "@/lib/decision/retrospective";
import { rankProvisional, rankReviewed, visibleRelationships } from "@/lib/decision/review-modes";
import type { ReviewRegistry } from "@/lib/evidence/review-registry";
import type { Scenario, Source } from "@/lib/evidence/schema";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import { describeFeature } from "@/lib/geo/details";
import type { GeoBundle } from "@/lib/geo/repository";
import { describeActions } from "@/lib/mission/actions";
import { missionContext, selectGeoFeatures } from "@/lib/mission/mode";
import type { MissionConfig, MissionMode } from "@/lib/mission/schema";
import { IntegrityBar } from "@/components/flow/IntegrityBar";
import { MarsMapLoader } from "@/components/map/MarsMapLoader";
import { ConstraintsControls, DecisionSection } from "@/components/workspace/DecisionSection";
import { EvidenceSection } from "@/components/workspace/EvidenceSection";
import { feasibleExcluded, makeDescriber, ProvisionalSection, ReviewedRankingSection, ReviewRegistrySection } from "@/components/workspace/RankingIntegrity";
import { RevealSection } from "@/components/workspace/RevealSection";
import { ActionDetail } from "./ActionDetail";
import { ActionStrip } from "./ActionStrip";
import { Drawer } from "./Drawer";
import { FeatureCard } from "./FeatureCard";

type Props = { scenario: Scenario; sources: Source[]; registry: ReviewRegistry; geo: GeoBundle; mission: MissionConfig };
type DrawerId = "evidence" | "advanced" | null;

/**
 * Map-first mission explorer (MF-1). Holds UI state only: mission mode,
 * weights, constraints, selections and drawers. All science lives in
 * src/lib (pure, tested). Everything stays mounted, so selections survive
 * opening and closing drawers.
 */
export function MissionWorkspace({ scenario, sources, registry, geo, mission }: Props) {
  const [mode, setMode] = useState<MissionMode>(mission.defaultMode);
  const [replayDate, setReplayDate] = useState(scenario.defaultSnapshotDate);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [constraintsOverride, setConstraints] = useState<Constraints | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [chosenActionId, setChosenActionId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerId>(null);
  const [highlightRecordId, setHighlightRecordId] = useState<string | null>(null);

  const ctx = useMemo(() => missionContext(mission, scenario, mode, replayDate), [mission, scenario, mode, replayDate]);
  const asOf = ctx.evidenceAsOf;
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const { snapshot, later } = useMemo(() => selectEvidenceAsOf(scenario, asOf), [scenario, asOf]);
  const constraints = useMemo(() => constraintsOverride ?? defaultConstraints(snapshot), [constraintsOverride, snapshot]);
  // RI-1, unchanged: the reviewed ranking (approved relationships only) is primary;
  // the provisional ranking is for inspection and is never shown as validated.
  const provisional = useMemo(() => rankProvisional(scenario, registry, asOf, weights, constraints), [scenario, registry, asOf, weights, constraints]);
  const reviewed = useMemo(() => rankReviewed(scenario, registry, asOf, weights, constraints), [scenario, registry, asOf, weights, constraints]);
  const recommendation = provisional.recommendation;
  const review = useMemo(() => reviewAgainstLaterEvidence(recommendation, later), [recommendation, later]);
  const describe = useMemo(() => makeDescriber(scenario, registry), [scenario, registry]);
  const visibleReviewIds = useMemo(() => new Set(visibleRelationships(snapshot).map((r) => r.id)), [snapshot]);
  const excluded = feasibleExcluded(reviewed, provisional);
  const taskTitle = (id: string) => scenario.tasks.find((t) => t.id === id)?.title ?? id;

  const geoSelection = useMemo(() => selectGeoFeatures(geo, ctx), [geo, ctx]);
  const selectedFeature = selectedFeatureId ? geoSelection.features.find((f) => f.id === selectedFeatureId) : undefined;
  const featureDetails = useMemo(() => (selectedFeature ? describeFeature(selectedFeature, geo, sources) : null), [selectedFeature, geo, sources]);

  const actions = useMemo(
    () => describeActions({ tasks: snapshot.tasks, resources: snapshot.resources, gaps: snapshot.gaps, constraints, provisional: recommendation, reviewed }),
    [snapshot, constraints, recommendation, reviewed],
  );
  const selectedAction = actions.find((a) => a.id === selectedActionId);
  const chosenAction = actions.find((a) => a.id === chosenActionId);
  const reviewedStatusText =
    reviewed.status.state === "unavailable"
      ? `Reviewed ranking unavailable: ${excluded.length} feasible action(s) excluded pending expert review. No action is scientifically recommended.`
      : reviewed.status.state === "partial"
        ? `Reviewed ranking is partial: top among reviewed actions is ${taskTitle(reviewed.recommendation!.ranking[0].taskId)}.`
        : `Reviewed ranking: ${taskTitle(reviewed.recommendation!.ranking[0].taskId)} ranks first (approved relationships only).`;

  const onSelectFeature = useCallback((id: string | null) => setSelectedFeatureId(id), []);
  const openDrawer = (id: DrawerId) => setDrawer(id);
  const showEvidence = (recordId: string | null) => {
    setHighlightRecordId(recordId);
    setDrawer("evidence");
  };

  // Evidence on demand: scroll to and mark the record a context card pointed at.
  const evidenceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = evidenceRef.current;
    if (drawer !== "evidence" || !root) return;
    root.querySelectorAll("[data-highlight]").forEach((el) => el.removeAttribute("data-highlight"));
    if (!highlightRecordId) return;
    const el = root.querySelector(`[data-record-id="${highlightRecordId}"]`);
    if (!el) return;
    el.closest("details")?.setAttribute("open", "");
    el.setAttribute("data-highlight", "true");
    el.scrollIntoView({ block: "center" });
  }, [drawer, highlightRecordId]);

  const latest = ctx.latestRecordDate;
  const onReplayDate = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= scenario.minSnapshotDate && value <= latest) setReplayDate(value);
  };
  const decisionProps = {
    recommendation,
    tasks: snapshot.tasks,
    gaps: snapshot.gaps,
    interpretations: snapshot.interpretations,
    assessments: snapshot.discriminationAssessments,
    resources: snapshot.resources,
    assumptions: snapshot.assumptions,
    weights,
    onWeightChange: (id: CriterionId, value: number) => setWeights((prev) => ({ ...prev, [id]: value })),
    onResetWeights: () => setWeights(DEFAULT_WEIGHTS),
    constraints,
    onConstraintsChange: setConstraints,
    onResetConstraints: () => setConstraints(null),
    sourceById,
  };
  const replay = mode === "historical-replay";
  const evidenceText = replay ? `Historical replay · evidence as of ${asOf}` : `Evidence: latest verified in this dataset, through ${latest} (not all NASA data)`;

  return (
    <div className="flex flex-1 flex-col lg:min-h-0">
      {/* Objective strip */}
      <div className="space-y-1.5 border-b border-border bg-surface px-4 py-2" data-testid="objective-strip">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className={`rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider ${replay ? "border-warn/70 text-warn" : "border-accent/70 text-accent"}`} data-testid="mission-mode">
                {replay ? "Historical replay (advanced)" : `Simulated mission · ${mission.missionYear}`}
              </span>
              <span className="text-sm font-semibold" id="workspace-heading">
                {mission.title}
              </span>
            </p>
            <p className="mt-0.5 text-xs" data-testid="mission-objective">
              {"Objective: with incomplete evidence and a limited simulated budget, decide what to investigate next at the Margin Unit of Jezero crater, and why."}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5 text-xs">
            <button type="button" onClick={() => showEvidence(null)} aria-expanded={drawer === "evidence"} aria-controls="evidence-drawer" className="rounded border border-border px-2 py-1 hover:bg-surface-raised" data-testid="open-evidence">
              {"Evidence"}
            </button>
            <button type="button" onClick={() => openDrawer("advanced")} aria-expanded={drawer === "advanced"} aria-controls="advanced-drawer" className="rounded border border-border px-2 py-1 hover:bg-surface-raised" data-testid="open-advanced">
              {"Advanced workspace"}
            </button>
          </div>
        </div>
        <IntegrityBar
          evidenceText={evidenceText}
          hiddenLaterCount={snapshot.hiddenLaterCount}
          reviewed={reviewed}
          excludedCount={excluded.length}
          onShowEvidenceMode={() => openDrawer("advanced")}
          onShowRanking={() => openDrawer("advanced")}
        />
        <p className="text-[11px] text-muted" data-testid="mission-disclaimer">
          {mission.disclaimer}
        </p>
        {chosenAction ? (
          <p className="text-[11px]" data-testid="chosen-summary">
            {`Your simulated choice: ${chosenAction.title}${chosenAction.feasible ? "" : " (not feasible under current constraints)"}`}
          </p>
        ) : null}
      </div>

      {/* Grid: on phones map, feature card, actions, action details stack in that order;
          on desktop the cards float over the map cell. */}
      <main className="grid flex-1 grid-cols-1 [grid-template-areas:'map'_'feature'_'strip'_'action'] lg:min-h-0 lg:grid-rows-[minmax(0,1fr)_auto] lg:[grid-template-areas:'map'_'strip']">
          <section aria-label="Mars map" className="relative h-[50dvh] [grid-area:map] lg:h-auto lg:min-h-0">
            <MarsMapLoader features={geoSelection.features} selectedId={selectedFeature ? selectedFeature.id : null} onSelect={onSelectFeature} />
          </section>
          {featureDetails ? (
            <FeatureCard
              details={featureDetails}
              onClose={() => setSelectedFeatureId(null)}
              onShowEvidence={(id) => showEvidence(id)}
              className={`m-3 [grid-area:feature] lg:z-10 lg:ml-12 lg:w-[22rem] lg:self-start lg:justify-self-start lg:overflow-y-auto lg:[grid-area:map] ${
                selectedAction ? "lg:max-h-[48%]" : "lg:max-h-[calc(100%-3rem)]"
              }`}
            />
          ) : null}
          {selectedAction ? (
            <ActionDetail
              action={selectedAction}
              chosen={selectedAction.id === chosenActionId}
              reviewedStatusText={reviewedStatusText}
              caveats={ctx.caveats.slice(0, 1)}
              actionFraming={ctx.actionFraming}
              onChoose={() => setChosenActionId(selectedAction.id)}
              onClearChoice={() => setChosenActionId(null)}
              onClose={() => setSelectedActionId(null)}
              onShowEvidence={() => showEvidence(null)}
              onShowAdvanced={() => openDrawer("advanced")}
              className="m-3 [grid-area:action] lg:z-10 lg:mb-9 lg:ml-12 lg:max-h-[48%] lg:w-[26rem] lg:self-end lg:justify-self-start lg:overflow-y-auto lg:[grid-area:map]"
            />
          ) : null}

        <ActionStrip
          actions={actions}
          selectedId={selectedActionId}
          chosenId={chosenActionId}
          onSelect={setSelectedActionId}
          constraints={
            <ConstraintsControls
              resources={snapshot.resources}
              constraints={constraints}
              onConstraintsChange={setConstraints}
              onResetConstraints={() => setConstraints(null)}
            />
          }
        />
      </main>

      <Drawer id="evidence-drawer" title="Evidence" subtitle={ctx.evidenceNote} open={drawer === "evidence"} onClose={() => setDrawer(null)} widthClass="sm:w-[32rem]">
        <div ref={evidenceRef}>
          <EvidenceSection observations={snapshot.observations} interpretations={snapshot.interpretations} gaps={snapshot.gaps} sourceById={sourceById} />
        </div>
      </Drawer>

      <Drawer
        id="advanced-drawer"
        title="Advanced scientific workspace"
        subtitle="Ranking integrity, scores, assumptions, audit records and historical replay."
        open={drawer === "advanced"}
        onClose={() => setDrawer(null)}
        widthClass="sm:w-[40rem]"
      >
        <section className="border-b border-border px-4 py-3 text-xs" data-testid="mission-mode-controls" aria-labelledby="mode-heading">
          <h3 id="mode-heading" className="text-sm font-semibold">
            {"Mission mode"}
          </h3>
          <div className="mt-2 flex flex-wrap gap-3" role="radiogroup" aria-label="Mission mode">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="mission-mode" checked={!replay} onChange={() => setMode("present-day")} className="accent-accent" data-testid="mode-present" />
              <span>{`Present-day simulated mission (${mission.missionYear})`}</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="mission-mode" checked={replay} onChange={() => setMode("historical-replay")} className="accent-accent" data-testid="mode-replay" />
              <span>{mission.historicalReplay.label}</span>
            </label>
          </div>
          <p className="mt-1 text-[11px] text-muted" data-testid="evidence-note">
            {ctx.evidenceNote}
          </p>
          {replay ? (
            <div className="mt-2">
              <label className="flex flex-wrap items-center gap-2">
                <span className="text-muted">{"Replay date"}</span>
                <input
                  type="date"
                  value={replayDate}
                  min={scenario.minSnapshotDate}
                  max={latest}
                  onChange={(e) => onReplayDate(e.target.value)}
                  className="rounded border border-border bg-surface-raised px-2 py-1 font-mono text-foreground"
                  data-testid="snapshot-date"
                />
                <button type="button" onClick={() => setReplayDate(scenario.defaultSnapshotDate)} className="rounded border border-border px-2 py-1 hover:bg-surface-raised">
                  {"Scenario default"}
                </button>
              </label>
              <p className="mt-1 text-[11px] text-muted" data-testid="snapshot-summary">
                {`Using evidence public on or before ${asOf}: ${snapshot.observations.filter((o) => o.relevance === "local").length} margin-unit observations, ${
                  snapshot.interpretations.filter((i) => i.relevance === "local").length
                } hypotheses/interpretations, ${snapshot.gaps.filter((g) => g.relevance === "local").length} gaps, plus ${
                  [...snapshot.observations, ...snapshot.interpretations, ...snapshot.gaps].filter((r) => r.relevance === "regional-context").length
                } regional-context records. ${snapshot.hiddenLaterCount} later record(s) withheld.`}
              </p>
              <p className="mt-1 text-[11px] text-muted" data-testid="replay-map-note">
                {`Map in replay: ${geoSelection.features.length} feature(s) shown, ${geoSelection.withheld.length} withheld (published after the replay date, or the traverse, which is not yet filtered by sol).`}
              </p>
            </div>
          ) : null}
        </section>

        <ReviewedRankingSection reviewed={reviewed} excludedCount={excluded.length} taskTitle={taskTitle} />
        <ProvisionalSection provisional={provisional} describe={describe} taskTitle={taskTitle}>
          <DecisionSection part="recommendation" {...decisionProps} />
        </ProvisionalSection>
        <details className="group border-b border-border" data-testid="provisional-comparison">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
            <span>{"Compare actions side by side (provisional, not validated)"}</span>
            <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
              ›
            </span>
          </summary>
          <DecisionSection part="comparison" {...decisionProps} />
        </details>
        <DecisionSection part="weights" {...decisionProps} />
        <p className="border-b border-border px-4 py-2 text-[11px] text-muted">{"Mission constraints (budget, platforms) are set in the action strip below the map."}</p>
        <DecisionSection part="tasks" {...decisionProps} />
        {replay ? <RevealSection asOf={asOf} later={later} review={review} tasks={scenario.tasks} allGaps={scenario.gaps} sourceById={sourceById} /> : null}
        <ReviewRegistrySection registry={registry} visibleIds={visibleReviewIds} describe={describe} sourceById={sourceById} />
      </Drawer>
    </div>
  );
}
