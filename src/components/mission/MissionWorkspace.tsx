"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Briefing } from "@/lib/briefing/schema";
import { briefingView } from "@/lib/briefing/view";
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
import { BriefingMethods } from "@/components/briefing/BriefingMethods";
import { BriefingPanel } from "@/components/briefing/BriefingPanel";
import { SiteChooser } from "@/components/briefing/SiteChooser";
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

type Props = { scenario: Scenario; sources: Source[]; registry: ReviewRegistry; geo: GeoBundle; mission: MissionConfig; briefings: Briefing[] };
type DrawerId = "evidence" | "advanced" | "methods" | null;

const SAMPLE_LABELS = ["sample-site", "rover-last-position"] as const;

/**
 * Science-briefing explorer (BR-2; built on the MF-1 map workspace).
 * Default view: the map plus a panel that shows a site chooser, a location
 * briefing, or a feature card. The MF-1 ranking workspace (simulated actions,
 * constraints, rankings, registry, historical replay) is unchanged and lives
 * in the advanced drawer. All science lives in src/lib (pure, tested);
 * everything stays mounted, so state survives opening and closing drawers.
 */
export function MissionWorkspace({ scenario, sources, registry, geo, mission, briefings }: Props) {
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
  const briefingFor = useMemo(() => new Map(briefings.map((b) => [b.locationId, b])), [briefings]);
  const selectedBriefing = selectedFeature ? briefingFor.get(selectedFeature.id) : undefined;
  const view = useMemo(() => (selectedBriefing ? briefingView(selectedBriefing, geo, sources) : null), [selectedBriefing, geo, sources]);
  const sites = geoSelection.features
    .filter((f) => f.kind === "sample-site")
    .map((f) => ({ id: f.id, name: f.name, hasBriefing: briefingFor.has(f.id) }))
    .sort((a, b) => Number(b.hasBriefing) - Number(a.hasBriefing));

  // First view: the sample sites and the last traverse position, with a margin.
  const initialExtent = useMemo(() => {
    const pts = geoSelection.features.filter((f) => f.geometry.type === "Point" && SAMPLE_LABELS.includes(f.kind as (typeof SAMPLE_LABELS)[number]));
    const lons = pts.map((f) => (f.geometry.type === "Point" ? f.geometry.coordinates[0] : 0));
    const lats = pts.map((f) => (f.geometry.type === "Point" ? f.geometry.coordinates[1] : 0));
    return lons.length ? ([Math.min(...lons) - 0.01, Math.min(...lats) - 0.01, Math.max(...lons) + 0.01, Math.max(...lats) + 0.01] as const) : undefined;
    // Only the first render uses it; geoSelection changes later must not refit the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions = useMemo(
    () => describeActions({ tasks: snapshot.tasks, resources: snapshot.resources, gaps: snapshot.gaps, constraints, provisional: recommendation, reviewed }),
    [snapshot, constraints, recommendation, reviewed],
  );
  const selectedAction = actions.find((a) => a.id === selectedActionId);
  const reviewedStatusText =
    reviewed.status.state === "unavailable"
      ? `Reviewed ranking unavailable: ${excluded.length} feasible action(s) excluded pending expert review. No action is scientifically recommended.`
      : reviewed.status.state === "partial"
        ? `Reviewed ranking is partial: top among reviewed actions is ${taskTitle(reviewed.recommendation!.ranking[0].taskId)}.`
        : `Reviewed ranking: ${taskTitle(reviewed.recommendation!.ranking[0].taskId)} ranks first (approved relationships only).`;

  const onSelectFeature = useCallback((id: string | null) => setSelectedFeatureId(id), []);
  const showEvidence = (recordId: string | null) => {
    setHighlightRecordId(recordId);
    setDrawer("evidence");
  };

  // Evidence on demand: scroll to and mark the record a card pointed at.
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

  // Show the top of a newly opened briefing or card.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [selectedFeatureId]);

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
    unreviewedIds: provisional.unreviewedInputs,
    pivotalInputCount: provisional.pivotalInputs.length,
  };
  const replay = mode === "historical-replay";
  const evidenceText = replay ? `Historical replay · evidence as of ${asOf}` : `Evidence: latest verified in this dataset, through ${latest} (not all NASA data)`;

  return (
    <div className="flex flex-1 flex-col lg:min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-1.5" data-testid="objective-strip">
        <p className="min-w-0 text-[11px] text-muted" data-testid="mission-disclaimer">
          {"Learning tool built from published NASA/PDS records. Not a NASA mission and not live telemetry; rover data shown are historical."}
        </p>
        <div className="flex shrink-0 gap-1.5 text-xs">
          {replay ? (
            <span className="rounded border border-warn/70 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-warn" data-testid="mission-mode">
              {"Historical replay (advanced)"}
            </span>
          ) : null}
          <button type="button" onClick={() => showEvidence(null)} aria-expanded={drawer === "evidence"} aria-controls="evidence-drawer" className="rounded border border-border px-2 py-1 hover:bg-surface-raised" data-testid="open-evidence">
            {"All evidence"}
          </button>
          <button type="button" onClick={() => setDrawer("advanced")} aria-expanded={drawer === "advanced"} aria-controls="advanced-drawer" className="rounded border border-border px-2 py-1 hover:bg-surface-raised" data-testid="open-advanced">
            {"Advanced ranking workspace"}
          </button>
        </div>
      </div>

      <main className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        <section aria-label="Mars map" className="relative h-[42dvh] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
          <MarsMapLoader
            features={geoSelection.features}
            selectedId={selectedFeature ? selectedFeature.id : null}
            onSelect={onSelectFeature}
            labelKinds={SAMPLE_LABELS}
            initialExtent={initialExtent}
            layerPanelOpenOnDesktop={false}
          />
        </section>

        <aside
          ref={panelRef}
          aria-label="Location panel"
          className="border-t border-border bg-surface lg:w-[30rem] lg:flex-none lg:overflow-y-auto lg:border-t-0 lg:border-l xl:w-[34rem]"
          data-testid="location-panel"
        >
          {view ? (
            <BriefingPanel view={view} onClose={() => setSelectedFeatureId(null)} onShowMethods={() => setDrawer("methods")} onShowAdvanced={() => setDrawer("advanced")} />
          ) : featureDetails ? (
            <div className="p-3">
              <FeatureCard details={featureDetails} onClose={() => setSelectedFeatureId(null)} onShowEvidence={(id) => showEvidence(id)} />
              {selectedFeature?.kind === "sample-site" ? (
                <p className="mt-2 text-[11px] text-muted" data-testid="no-briefing-note">
                  {"No science briefing has been curated for this site yet. Only its verified location details are shown."}
                </p>
              ) : null}
              <button type="button" onClick={() => setSelectedFeatureId(null)} className="mt-2 rounded border border-border px-2 py-1 text-xs hover:bg-surface-raised">
                {"Back to the site list"}
              </button>
            </div>
          ) : (
            <SiteChooser sites={sites} onSelect={setSelectedFeatureId} />
          )}
        </aside>
      </main>

      <Drawer id="evidence-drawer" title="All evidence in this dataset" subtitle={ctx.evidenceNote} open={drawer === "evidence"} onClose={() => setDrawer(null)} widthClass="sm:w-[32rem]">
        <div ref={evidenceRef}>
          <EvidenceSection observations={snapshot.observations} interpretations={snapshot.interpretations} gaps={snapshot.gaps} sourceById={sourceById} unreviewedIds={provisional.unreviewedInputs} />
        </div>
      </Drawer>

      <Drawer
        id="methods-drawer"
        title="Methods & audit"
        subtitle="How the location briefing was built and verified, and what was left out."
        open={drawer === "methods"}
        onClose={() => setDrawer(null)}
        widthClass="sm:w-[34rem]"
      >
        {selectedBriefing ?? briefings[0] ? <BriefingMethods briefing={selectedBriefing ?? briefings[0]} /> : null}
      </Drawer>

      <Drawer
        id="advanced-drawer"
        title="Advanced ranking workspace"
        subtitle="The MF-1 scenario workspace: simulated Margin-unit actions, constraints, rankings, review registry and historical replay. These actions are not tied to any location."
        open={drawer === "advanced"}
        onClose={() => setDrawer(null)}
        widthClass="sm:w-[44rem]"
      >
        <div className="space-y-1.5 border-b border-border px-4 py-3" data-testid="advanced-status">
          <p className="text-xs font-semibold">{mission.title}</p>
          <IntegrityBar
            evidenceText={evidenceText}
            hiddenLaterCount={snapshot.hiddenLaterCount}
            reviewed={reviewed}
            excludedCount={excluded.length}
            onShowEvidenceMode={() => document.getElementById("mode-heading")?.scrollIntoView()}
            onShowRanking={() => document.getElementById("reviewed-ranking-anchor")?.scrollIntoView()}
          />
          <p className="text-[11px] text-muted">{mission.disclaimer}</p>
        </div>

        <ActionStrip
          stacked
          actions={actions}
          selectedId={selectedActionId}
          chosenId={chosenActionId}
          onSelect={setSelectedActionId}
          constraints={<ConstraintsControls resources={snapshot.resources} constraints={constraints} onConstraintsChange={setConstraints} onResetConstraints={() => setConstraints(null)} />}
        />
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
            onShowAdvanced={() => document.getElementById("reviewed-ranking-anchor")?.scrollIntoView()}
            className="mx-3 my-2"
          />
        ) : null}

        <section className="border-y border-border px-4 py-3 text-xs" data-testid="mission-mode-controls" aria-labelledby="mode-heading">
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

        <div id="reviewed-ranking-anchor">
          <ReviewedRankingSection reviewed={reviewed} excludedCount={excluded.length} taskTitle={taskTitle} />
        </div>
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
        <DecisionSection part="tasks" {...decisionProps} />
        {replay ? <RevealSection asOf={asOf} later={later} review={review} tasks={scenario.tasks} allGaps={scenario.gaps} sourceById={sourceById} /> : null}
        <ReviewRegistrySection registry={registry} visibleIds={visibleReviewIds} describe={describe} sourceById={sourceById} />
      </Drawer>
    </div>
  );
}
