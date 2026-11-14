"use client";

import Link from "next/link";
import { useMemo, useReducer, useState, useSyncExternalStore } from "react";
import type { BriefingView } from "@/lib/briefing/view";
import { DEFAULT_WEIGHTS } from "@/lib/decision/criteria";
import { defaultConstraints } from "@/lib/decision/engine";
import { rankProvisional, rankReviewed } from "@/lib/decision/review-modes";
import type { ReviewRegistry } from "@/lib/evidence/review-registry";
import type { Scenario, Source } from "@/lib/evidence/schema";
import { selectEvidenceAsOf } from "@/lib/evidence/snapshot";
import type { MapFeature } from "@/lib/geo/features";
import {
  consumedEffort,
  addability,
  fitInOrder,
  planFit,
  initialMissionState,
  missionReducer,
  taskViews,
  type MgScenario,
  type SimulatedTarget,
} from "@/lib/prototype/mission-glass";
import { targetMarkers } from "@/lib/prototype/target-markers";
import { missionSequence, replanSequences } from "@/lib/prototype/mission-sequence";
import type { MapSequence } from "@/components/map/MarsMap";
import { MarsMapLoader } from "@/components/map/MarsMapLoader";
import { TerrainLoader } from "@/components/terrain/TerrainLoader";
import type { TerrainMarker, TerrainSequence } from "@/components/terrain/TerrainViewer";
import { useTerrainHeights } from "@/components/terrain/terrain-data";
import { LEFROY_TERRAIN, profileAlong, segmentCoverage } from "@/lib/terrain/terrain";
import { EvaHud } from "./EvaHud";
import { EvidenceSheet } from "./EvidenceSheet";
import { PlanReview } from "./PlanReview";
import { ReplanDialog } from "./ReplanDialog";
import { TargetList, TargetSummary } from "./TargetMapOverlay";
import { TaskCard } from "./TaskCard";
import { CandidateCompare } from "./CandidateCompare";
import type { CompareView } from "@/lib/prototype/candidate-compare";
import { SegmentSummary, SequenceList } from "./SequenceViews";
import type { ResolvedScouting } from "@/lib/eva-route/scenario";
import { RouteWorkspace } from "@/components/route/RouteWorkspace";
import { useEvaRoute } from "@/components/route/useEvaRoute";

type Props = {
  scenario: Scenario;
  registry: ReviewRegistry;
  sources: Source[];
  s: MgScenario;
  targets: SimulatedTarget[];
  features: MapFeature[];
  asOf: string;
  briefing: BriefingView | null;
  /** Candidate comparison science rows (SCI-1 draft summaries), or null when not available at this evidence date. */
  compare: CompareView | null;
  /** EVA route & scouting: the simulated scenario (src/data/prototype/eva-scouting.json), resolved server-side. */
  routeScenario: ResolvedScouting;
};

const LABEL_KINDS = ["sample-site"] as const;
const MAP_LABEL =
  "Map of the Lefroy Bay area, Jezero crater. Coral diamonds are simulated targets with their provisional priority; blue features are verified NASA/PDS data. Use the target buttons above the map to select a target with the keyboard.";

// Wide layout: the planning panel covers the right of the map.
const wideQuery = "(min-width: 1024px)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(wideQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * MDI 2.0 "Mission Glass" prototype: Planning and EVA HUD share one mission
 * state (src/lib/prototype/mission-glass.ts). Ranks and feasibility come from
 * the existing engine; this component only renders and dispatches.
 */
export function MissionGlass({ scenario, registry, sources, s, targets, features, asOf, briefing, compare, routeScenario }: Props) {
  const { snapshot } = useMemo(() => selectEvidenceAsOf(scenario, asOf), [scenario, asOf]);
  const defaultBudget = snapshot.resources[0]?.budget ?? 100;
  const [state, dispatch] = useReducer(missionReducer, defaultBudget, initialMissionState);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [verifiedPick, setVerifiedPick] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Candidate comparison (read-only): the chosen pair is kept while the sheet is closed.
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparePair, setComparePair] = useState<string[]>([]);
  // MAP-1: a focus request moves the map to a target; the summary closes independently.
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [summaryFor, setSummaryFor] = useState<string | null>(null);
  // MAP-3A: 2D map or local 3D terrain (planning only). The 2D map stays mounted, so its view is kept.
  const [mapView, setMapView] = useState<"2d" | "3d">("2d");
  const [terrainNotice, setTerrainNotice] = useState<string | null>(null);
  // MAP-2: the selected sequence connection (UI state; the sequence itself is derived from the mission state).
  const [segmentSel, setSegmentSel] = useState<string | null>(null);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(wideQuery).matches, () => false);
  const sourceById = useMemo(() => new Map(sources.map((x) => [x.id, x])), [sources]);
  const costs = useMemo(() => Object.fromEntries(snapshot.tasks.map((t) => [t.id, t.costs["res-effort"] ?? Infinity])), [snapshot]);
  const stepsByTask = useMemo(() => Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length])), [s]);

  /** The existing engine at a given simulated budget, with the scenario's excluded platforms. */
  const engineAt = (budget: number) => {
    const constraints = { ...defaultConstraints(snapshot), budgets: { "res-effort": budget }, unavailablePlatforms: s.excludedPlatforms };
    const provisional = rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, constraints);
    const reviewed = rankReviewed(scenario, registry, asOf, DEFAULT_WEIGHTS, constraints);
    return { provisional, reviewed, views: taskViews({ s, snapshot, provisional, reviewed, budget, registry }) };
  };
  // engineAt only depends on inputs listed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const planning = useMemo(() => engineAt(state.budget), [state.budget, snapshot, scenario, registry, asOf, s]);
  const consumed = consumedEffort(state, costs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const eva = useMemo(() => engineAt(Math.max(0, state.budget - consumed)), [state.budget, consumed, snapshot, scenario, registry, asOf, s]);
  // One decision context for cards, map and HUD: before a plan exists, the
  // whole budget; once a plan exists, the effort still available (budget −
  // committed), which is also what replanning uses.
  const views = state.plan ? eva.views : planning.views;
  const viewById = useMemo(() => new Map(views.map((v) => [v.taskId, v])), [views]);
  const planViewById = useMemo(() => new Map(planning.views.map((v) => [v.taskId, v])), [planning]);

  const targetByTask = new Map(targets.map((t) => [t.taskId, t]));
  // MAP-1: decision state per target, from the engine views of the current mode and the shared mission state.
  const markers = useMemo(() => targetMarkers({ targets, viewById, state, stepsByTask }), [targets, viewById, state, stepsByTask]);
  const markerById = new Map(markers.map((m) => [m.id, m]));
  // MAP-3A: verified sample sites and the verified traverse for the 3D view, kept apart from simulated targets.
  const traverseLines = useMemo(
    () => features.flatMap((f) => (f.kind === "traverse-segment" && f.geometry.type === "MultiLineString" ? f.geometry.coordinates.map((l) => l.map((p) => [p[0], p[1]] as const)) : [])),
    [features],
  );
  // EVA route & scouting (simulated): a third screen next to Planning and the EVA HUD. Its state lives
  // here, so an approved route stays available in the HUD.
  const [screen, setScreen] = useState<"mission" | "route">("mission");
  const [routeOpened, setRouteOpened] = useState(false);
  const routeTargets = useMemo(() => targets.map((t) => ({ id: t.id, name: t.name, position: t.position })), [targets]);
  const route = useEvaRoute({ scenario: routeScenario, targets: routeTargets, traverse: traverseLines, enabled: routeOpened });
  const verifiedSites = useMemo(
    () => features.flatMap((f) => (f.kind === "sample-site" && f.geometry.type === "Point" ? [{ id: f.id, name: f.name, position: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as const }] : [])),
    [features],
  );
  const approvedRoute = route.mission?.routes.approved ?? null;
  const routeStatus = (
    <span className="text-[14px] text-[var(--mg-dim)]" data-testid="mg-eva-route-status">
      {approvedRoute
        ? `Route (simulated): ${approvedRoute.option} → ${routeTargets.find((t) => t.id === approvedRoute.targetId)?.name ?? approvedRoute.targetId} · walk ${(approvedRoute.sortie.distanceM / 1000).toFixed(2)} km · EVA ${(approvedRoute.sortie.totalS / 3600).toFixed(2)} h · O₂ margin ${Math.round(approvedRoute.sortie.marginPct)} %`
        : "No EVA route approved yet (EVA route tab)"}
    </span>
  );
  const mapTargets = useMemo(() => targets.map((t) => ({ ...t, badge: markerById.get(t.id)?.badge, status: markerById.get(t.id)?.status, tone: markerById.get(t.id)?.tone })), [targets, markers]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedMarker = markers.find((m) => m.taskId === state.selectedTaskId);
  const summaryOpen = Boolean(selectedMarker) && !verifiedPick && summaryFor === state.selectedTaskId && state.mode === "planning";
  const terrainMarkers = useMemo<TerrainMarker[]>(
    () => [
      ...features.flatMap((f): TerrainMarker[] => (f.kind === "sample-site" && f.geometry.type === "Point" ? [{ id: f.id, kind: "verified", name: f.name, position: [f.geometry.coordinates[0], f.geometry.coordinates[1]] }] : [])),
      ...mapTargets.map((t): TerrainMarker => ({ id: t.id, kind: "simulated", name: t.name, position: t.position, badge: t.badge, status: t.status, tone: t.tone })),
    ],
    [features, mapTargets],
  );
  // MAP-2: the conceptual mission sequence, from the same mission state as cards, markers and HUD.
  const draftFitItems = planFit(state.draft, costs, state.budget).items;
  const feasibleByTask = useMemo(
    () => (state.plan ? Object.fromEntries(markers.map((m) => [m.taskId, m.feasible])) : Object.fromEntries(draftFitItems.map((i) => [i.taskId, i.fits]))),
    // draftFitItems is derived from state.draft, costs and state.budget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.plan, markers, state.draft, costs, state.budget],
  );
  const sequence = useMemo(() => missionSequence({ state, targets, stepsByTask, feasibleByTask }), [state, targets, stepsByTask, feasibleByTask]);
  const selectedSegment = sequence.segments.find((x) => x.id === segmentSel) ?? null;
  const highlightIds = useMemo(() => (selectedSegment ? [selectedSegment.from.targetId, selectedSegment.to.targetId] : []), [selectedSegment]);
  const highlightTasks = selectedSegment ? [selectedSegment.from.taskId, selectedSegment.to.taskId] : [];
  const mapSequence = useMemo<MapSequence | null>(
    () =>
      sequence.phase === "none"
        ? null
        : {
            phase: sequence.phase,
            segments: sequence.segments.map((x) => ({ id: x.id, from: x.from.position, to: x.to.position, state: x.state, infeasible: x.infeasible })),
            nodes: sequence.nodes.flatMap((n) => (n.targetId ? [{ targetId: n.targetId, order: n.order, onLine: n.onLine, state: n.state }] : [])),
          },
    [sequence],
  );
  const terrainSequence = useMemo<TerrainSequence | null>(
    () =>
      sequence.phase === "none"
        ? null
        : {
            phase: sequence.phase,
            segments: sequence.segments.map((x) => ({
              id: x.id,
              from: x.from.position,
              to: x.to.position,
              fromId: x.from.targetId,
              toId: x.to.targetId,
              fromOrder: x.from.order,
              toOrder: x.to.order,
              state: x.state,
              infeasible: x.infeasible,
            })),
            nodes: sequence.nodes.flatMap((n) => (n.targetId ? [{ targetId: n.targetId, order: n.order, onLine: n.onLine }] : [])),
          },
    [sequence],
  );
  const titleByTask = useMemo(() => Object.fromEntries(planning.views.map((v) => [v.taskId, v.shortTitle])), [planning]);
  // The selected connection's coverage and (2D) its real-DTM profile, loaded only when needed.
  const segCoverage = selectedSegment ? segmentCoverage(LEFROY_TERRAIN, selectedSegment.from.position, selectedSegment.to.position) : "inside";
  const segTerrain = useTerrainHeights(LEFROY_TERRAIN, Boolean(selectedSegment) && mapView === "2d" && segCoverage === "inside");
  const segProfile = useMemo(
    () => (selectedSegment && segTerrain.heights && segCoverage === "inside" ? profileAlong(LEFROY_TERRAIN, segTerrain.heights, selectedSegment.from.position, selectedSegment.to.position) : null),
    [selectedSegment, segTerrain.heights, segCoverage],
  );
  /** Select a connection: its two targets are highlighted and its summary shown (in 2D and 3D). */
  const pickSegment = (id: string) => {
    setSegmentSel(id);
    setVerifiedPick(null);
    setSummaryFor(null);
    dispatch({ type: "select", taskId: null });
  };

  /** Select a task from a card or the target list, and focus its target on the map. */
  const pickTask = (taskId: string) => {
    setSegmentSel(null);
    setVerifiedPick(null);
    dispatch({ type: "select", taskId });
    setSummaryFor(taskId);
    const id = targetByTask.get(taskId)?.id;
    if (id) setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };
  const evaCurrent = state.plan?.items.find((i) => i.status === "active") ?? state.plan?.items.find((i) => i.status === "planned");
  const focusTask = state.mode === "eva" ? (evaCurrent?.taskId ?? null) : state.selectedTaskId;
  const mapSelected = verifiedPick ?? (focusTask ? (targetByTask.get(focusTask)?.id ?? null) : null);
  const onMapSelect = (id: string | null) => {
    setSegmentSel(null);
    const t = targets.find((x) => x.id === id);
    if (t) {
      setVerifiedPick(null);
      dispatch({ type: "select", taskId: t.taskId });
      setSummaryFor(t.taskId);
    } else {
      setVerifiedPick(id);
      setSummaryFor(null);
    }
  };
  const picked = verifiedPick ? features.find((f) => f.id === verifiedPick) : undefined;

  /** The engine's provisional total per ranked task, read from the same result as the order (replan change summary). */
  const engineScores = (at: ReturnType<typeof engineAt>) => Object.fromEntries(at.provisional.recommendation.ranking.map((r) => [r.taskId, r.total]));
  /** A constraint change (or a re-check): the engine's provisional order at the newly available effort. */
  const checkConstraints = (budget: number, label: string) => {
    const at = engineAt(Math.max(0, budget - consumed));
    dispatch({
      type: "constraint-event",
      budget,
      label,
      rankedTaskIds: at.views.filter((v) => v.rank !== null).map((v) => v.taskId),
      scores: engineScores(at),
      costs,
      stepsByTask,
      titles: Object.fromEntries(planning.views.map((v) => [v.taskId, v.shortTitle])),
    });
  };

  const draftFit = planFit(state.draft, costs, state.budget);
  const suggested = fitInOrder(
    planning.views.filter((v) => v.rank !== null).map((v) => v.taskId),
    costs,
    state.budget,
  );
  const limitationsFor = (taskId: string) => {
    const task = snapshot.tasks.find((t) => t.id === taskId);
    return [
      ...(task?.assumptionIds ?? []).map((id) => snapshot.assumptions.find((a) => a.id === id)?.statement).filter((x): x is string => Boolean(x)),
      "Target position is scenario-defined, not a verified outcrop.",
    ];
  };

  const ranges = useMemo(() => {
    const lons = targets.map((t) => t.position[0]);
    const lats = targets.map((t) => t.position[1]);
    return [Math.min(...lons) - 0.004, Math.min(...lats) - 0.003, Math.max(...lons) + 0.004, Math.max(...lats) + 0.003] as const;
  }, [targets]);
  const map = (chrome: "full" | "minimal", simLabels: "all" | "selected" = "all") => (
    <MarsMapLoader
      features={features}
      selectedId={mapSelected}
      onSelect={onMapSelect}
      labelKinds={LABEL_KINDS}
      initialExtent={ranges}
      layerPanelOpenOnDesktop={false}
      simulatedTargets={mapTargets}
      chrome={chrome}
      ariaLabel={MAP_LABEL}
      simLabels={simLabels}
      focusRequest={chrome === "minimal" && state.mode === "planning" ? focus : null}
      // Keep the focused target clear of the planning panel, the target list and (on wide screens) the summary.
      focusPadding={wide ? [64, 472, 16, summaryOpen ? 440 : 16] : [56, 0, 0, 0]}
      initialOverlays={["jezeroCtx", "jezeroHirise"]}
      sequence={mapSequence}
      selectedSegmentId={state.mode === "planning" ? (selectedSegment?.id ?? null) : null}
      onSelectSegment={state.mode === "planning" ? pickSegment : undefined}
      highlightIds={state.mode === "planning" ? highlightIds : undefined}
    />
  );

  const evidenceView = evidenceFor ? (viewById.get(evidenceFor) ?? planViewById.get(evidenceFor)) : undefined;
  const evidenceTask = evidenceFor ? snapshot.tasks.find((t) => t.id === evidenceFor) : undefined;

  return (
    <div className="mission-glass flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden" data-testid="mission-glass">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--mg-line)] px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">{"MDI 2.0"}</span>
          <span className="text-sm text-[var(--mg-dim)]">{"Mission Glass · interaction prototype"}</span>
        </div>
        <div role="tablist" aria-label="Mode" className="flex rounded-xl border border-[var(--mg-line)] p-1 text-sm">
          {(["planning", "route", "eva"] as const).map((m) => {
            const selected = m === "route" ? screen === "route" : screen === "mission" && state.mode === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  if (m === "route") {
                    setRouteOpened(true);
                    setScreen("route");
                  } else {
                    setScreen("mission");
                    dispatch({ type: "set-mode", mode: m });
                  }
                }}
                data-testid={`mg-mode-${m}`}
                className={`rounded-lg px-4 py-1.5 transition-colors duration-150 ${selected ? "bg-[var(--mg-surface)] text-[var(--mg-text)]" : "text-[var(--mg-dim)] hover:text-[var(--mg-text)]"}`}
              >
                {m === "planning" ? "Mission planning" : m === "route" ? "EVA route" : "EVA HUD"}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[var(--mg-coral)] px-3 py-1 text-[13px] font-medium text-[var(--mg-coral)]" title={s.label} data-testid="mg-sim-pill">
            {"Simulated scenario"}
          </span>
          <button
            type="button"
            // EVA-1.1: a toggle (it used to only open the sheet, which then covered it).
            aria-expanded={evidenceFor !== null}
            onClick={() => setEvidenceFor((e) => (e !== null ? null : (focusTask ?? planning.views[0]?.taskId ?? null)))}
            className="rounded-xl border border-[var(--mg-line)] px-3 py-1.5 text-sm hover:border-[var(--mg-line-strong)]"
            data-testid="mg-open-evidence"
          >
            {evidenceFor !== null ? "Hide evidence" : "Evidence"}
          </button>
          <Link href="/research" className="rounded-xl border border-[var(--mg-line)] px-3 py-1.5 text-sm text-[var(--mg-dim)] hover:border-[var(--mg-line-strong)] hover:text-[var(--mg-text)]" data-testid="mg-link-research">
            {"Research"}
          </Link>
        </div>
      </header>

      {screen === "route" ? (
        <RouteWorkspace r={route} scenario={routeScenario} targets={routeTargets} verifiedSites={verifiedSites} traverse={traverseLines} />
      ) : state.mode === "planning" ? (
        <main className="relative flex flex-1 flex-col lg:min-h-0 lg:block">
          <section aria-label="Investigation map" className={`relative shrink-0 lg:absolute lg:inset-0 lg:h-auto ${mapView === "3d" ? "h-[66dvh]" : "h-[42dvh]"}`}>
            {map("minimal")}
            {mapView === "3d" ? (
              <div className="absolute inset-0 z-[2] lg:right-[30rem]" data-testid="mg-terrain">
                <TerrainLoader
                  meta={LEFROY_TERRAIN}
                  markers={terrainMarkers}
                  traverse={traverseLines}
                  selectedId={mapSelected}
                  onSelect={onMapSelect}
                  onFallback={(reason) => {
                    setMapView("2d");
                    setTerrainNotice(reason);
                  }}
                  sequence={terrainSequence}
                  selectedSegmentId={selectedSegment?.id ?? null}
                  onSelectSegment={pickSegment}
                  highlightIds={highlightIds}
                />
              </div>
            ) : null}
            {terrainNotice ? (
              <div role="alert" className="mg-glass absolute bottom-3 left-3 z-[4] flex max-w-md items-start gap-2 p-3 text-[13px]" data-testid="mg-terrain-fallback">
                <p className="text-[var(--mg-caution)]">{`3D terrain unavailable: ${terrainNotice}. Showing the 2D map.`}</p>
                <button type="button" aria-label="Dismiss" onClick={() => setTerrainNotice(null)} className="shrink-0 rounded border border-[var(--mg-line)] px-2">
                  {"✕"}
                </button>
              </div>
            ) : null}
            {/* The legend gives way to an open connection summary (same corner of the map). */}
            <div className={`pointer-events-none absolute bottom-12 left-4 hidden ${mapView === "2d" && !selectedSegment ? "lg:block" : ""}`}>
              <div className="mg-glass pointer-events-auto flex flex-col gap-1.5 px-3 py-2 text-[13px]" data-testid="mg-legend">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-block size-3 rounded-full bg-[#8ecae6]" />
                  {"Verified NASA/PDS data (sample sites, traverse)"}
                </span>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-block size-3 rotate-45 border-2 border-dashed border-[var(--mg-coral)]" />
                  {"Simulated target (scenario-defined position)"}
                </span>
                <span className="pl-5 text-[12px] text-[var(--mg-dim)]">{"Number: provisional priority (existing engine, not validated)"}</span>
                <span className="pl-5 text-[12px] text-[var(--mg-dim)]">{"Solid: in plan · ✓ done · ½ ended with skipped steps · yellow: not feasible"}</span>
                {sequence.phase !== "none" ? (
                  <>
                    <span className="flex items-center gap-2 font-medium text-[var(--mg-coral)]" data-testid="mg-legend-seq">
                      <span aria-hidden className={`inline-block w-3 border-t-2 border-[var(--mg-coral)] ${sequence.phase === "draft" ? "border-dashed" : ""}`} />
                      {sequence.label}
                    </span>
                    <span className="pl-5 text-[12px] text-[var(--mg-dim)]">
                      {sequence.phase === "draft" ? "Draft n: position in your draft (not priority)" : "Seq n: plan order (not priority) · green: leads to completed work · yellow dashed: does not fit"}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            {mapView === "2d" && sequence.phase !== "none" ? (
              <p className="mg-glass pointer-events-none absolute bottom-9 left-2 z-[2] px-2 py-1 text-[12px] font-medium text-[var(--mg-coral)] lg:hidden" data-testid="mg-seq-map-label">
                {sequence.label}
              </p>
            ) : null}
            <TargetList
              markers={markers}
              selectedTaskId={state.selectedTaskId}
              onPick={pickTask}
              rightInset={mapView === "3d" ? "right-3 sm:right-56 lg:right-[42rem]" : undefined}
              leading={
                <div role="group" aria-label="Map view" className="mg-glass flex shrink-0 items-center rounded-xl p-0.5 text-[13px]" data-testid="mg-view-toggle">
                  {(["2d", "3d"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={mapView === v}
                      onClick={() => {
                        setMapView(v);
                        setTerrainNotice(null);
                      }}
                      className={`min-h-9 whitespace-nowrap rounded-lg px-2.5 ${mapView === v ? "bg-[var(--mg-surface)] font-medium text-[var(--mg-text)]" : "text-[var(--mg-dim)]"}`}
                      data-testid={`mg-view-${v}`}
                    >
                      {v === "2d" ? "2D map" : "3D terrain"}
                    </button>
                  ))}
                </div>
              }
            />
          </section>

          {selectedSegment ? (
            <SegmentSummary
              key={selectedSegment.id}
              segment={selectedSegment}
              phase={sequence.phase}
              titleByTask={titleByTask}
              view={mapView}
              coverage={segCoverage}
              profile={segProfile}
              profileState={segTerrain.error ? { error: segTerrain.error } : segTerrain.heights ? "ready" : "loading"}
              onClose={() => setSegmentSel(null)}
            />
          ) : picked ? (
            <div className="mg-glass mg-rise relative z-[5] mx-3 mt-3 p-3 text-sm lg:absolute lg:left-14 lg:top-16 lg:m-0 lg:max-w-xs" data-testid="mg-verified-pick">
              <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-cyan)]">{"Verified feature"}</p>
              <p className="mt-0.5 font-medium">{picked.name}</p>
              <p className="text-[var(--mg-dim)]">{picked.label}</p>
              <button type="button" onClick={() => setVerifiedPick(null)} className="mt-2 text-[var(--mg-dim)] underline underline-offset-2">
                {"Close"}
              </button>
            </div>
          ) : summaryOpen && selectedMarker ? (
            <TargetSummary
              marker={selectedMarker}
              // Before a plan exists, the same plain-language feasibility as the card; afterwards, the plan state.
              feasibilityText={state.plan ? selectedMarker.planText : addability(viewById.get(selectedMarker.taskId)!, state.draft, costs, state.budget).text}
              detailsOpen={expanded === selectedMarker.taskId}
              // EVA-1.1: the summary's Details toggles the card's Level 2 (it used to only open it).
              onDetails={(taskId) => setExpanded((e) => (e === taskId ? null : taskId))}
              onEvidence={(taskId) => setEvidenceFor(taskId)}
              onClose={() => setSummaryFor(null)}
            />
          ) : null}

          <aside
            aria-labelledby="mg-plan-title"
            className="mg-glass relative z-10 m-3 flex flex-col overflow-hidden lg:absolute lg:inset-y-4 lg:right-4 lg:m-0 lg:w-[27.5rem]"
            data-testid="mg-planning"
          >
            <div className="border-b border-[var(--mg-line)] px-5 pt-4 pb-3">
              <ol className="flex gap-3 text-[13px]" aria-label="Planning progress" data-testid="mg-flow">
                {["Compare", "Add", "Review & create"].map((label, n) => {
                  const step = state.plan ? 3 : state.draft.length ? 2 : 1;
                  return (
                    <li key={label} aria-current={n + 1 === step ? "step" : undefined} className={n + 1 === step ? "font-semibold text-[var(--mg-text)]" : n + 1 < step ? "text-[var(--mg-dim)]" : "text-[var(--mg-faint)]"}>
                      {`${n + 1} ${label}`}
                    </li>
                  );
                })}
              </ol>
              <h1 id="mg-plan-title" className="mt-1.5 text-xl font-semibold">
                {"Plan the next investigation"}
              </h1>
              <p className="mt-0.5 text-[13px] text-[var(--mg-dim)]" data-testid="mg-ranking-note">
                {`Priorities are provisional: existing MDI engine, not scientifically validated (${planning.reviewed.awaitingReview.length} relationships await expert review).`}
              </p>
              <div className="mt-3 flex items-center gap-3 text-sm">
                <label htmlFor="mg-budget-range" className="shrink-0 text-[var(--mg-dim)]">
                  {"Simulated effort"}
                </label>
                <input
                  id="mg-budget-range"
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={state.budget}
                  onChange={(e) => dispatch({ type: "set-budget", budget: Number(e.target.value) })}
                  aria-label="Simulated effort budget"
                  disabled={Boolean(state.plan)}
                  className="min-w-0 flex-1 accent-[var(--mg-coral)] disabled:opacity-40"
                />
                <span className="shrink-0 whitespace-nowrap text-right text-lg font-semibold" data-testid="mg-budget">
                  {`${state.budget} pts`}
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="mg-cards">
              <button
                type="button"
                onClick={() => setCompareOpen(true)}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--mg-line-strong)] px-4 py-2 text-left"
                data-testid="mg-compare-open"
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">{"Compare two actions"}</span>
                  <span className="block text-[13px] text-[var(--mg-dim)]">{"Simulated cost, possible new observation, key unknowns"}</span>
                </span>
                <span aria-hidden="true" className="text-[var(--mg-coral)]">
                  {"→"}
                </span>
              </button>
              {views.map((v) => (
                <TaskCard
                  key={v.taskId}
                  view={v}
                  target={targetByTask.get(v.taskId)}
                  selected={state.selectedTaskId === v.taskId}
                  highlighted={highlightTasks.includes(v.taskId)}
                  addable={
                    state.plan
                      ? {
                          state: state.plan.items.some((i) => i.taskId === v.taskId) ? "in-plan" : v.status === "fits" ? "fits" : "infeasible",
                          text: markers.find((m) => m.taskId === v.taskId)?.planText ?? "",
                        }
                      : addability(v, state.draft, costs, state.budget)
                  }
                  locked={Boolean(state.plan)}
                  expanded={expanded === v.taskId}
                  limitations={limitationsFor(v.taskId)}
                  onSelect={() => pickTask(v.taskId)}
                  onTogglePlan={() => dispatch({ type: "toggle-draft", taskId: v.taskId })}
                  onToggleExpand={() => setExpanded((e) => (e === v.taskId ? null : v.taskId))}
                  onEvidence={() => setEvidenceFor(v.taskId)}
                />
              ))}
            </div>

            <div className="border-t border-[var(--mg-line)] px-4 py-3" data-testid="mg-plan-bar">
              {state.plan ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-sm">
                    <span className="block font-semibold">{`Plan created · ${state.plan.items.length} action(s)`}</span>
                    <span className="block text-[var(--mg-dim)]">{state.plan.items.map((i) => planViewById.get(i.taskId)?.shortTitle).join(" → ")}</span>
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => dispatch({ type: "reset-plan" })} className="min-h-11 rounded-xl border border-[var(--mg-line)] px-3 text-sm" data-testid="mg-clear-plan">
                      {"Discard plan"}
                    </button>
                    <button type="button" onClick={() => dispatch({ type: "set-mode", mode: "eva" })} className="min-h-11 rounded-xl bg-[var(--mg-coral)] px-4 text-sm font-semibold text-[#1a0f0c]" data-testid="mg-start-eva">
                      {"Open EVA HUD →"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold" data-testid="mg-plan-summary">
                      {state.draft.length ? `Your plan · ${state.draft.length} action(s)` : "Your plan is empty"}
                    </span>
                    <span className={draftFit.overBy ? "text-[var(--mg-caution)]" : "text-[var(--mg-dim)]"} data-testid="mg-draft-cost">
                      {`${draftFit.total} of ${state.budget} pts`}
                    </span>
                  </div>
                  {/* Effort used by each added action, in plan order. */}
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[var(--mg-line)]" aria-hidden data-testid="mg-plan-meter">
                    {draftFit.items.map((it, n) => (
                      <span
                        key={it.taskId}
                        className={`h-full ${it.fits ? (n % 2 ? "bg-[var(--mg-cyan)]" : "bg-[#3fa9bb]") : "bg-[var(--mg-caution)]"}`}
                        style={{ width: `${Math.min(100, (it.cost / Math.max(state.budget, 1)) * 100)}%` }}
                      />
                    ))}
                  </div>
                  <p className={`mt-1.5 text-[13px] ${draftFit.overBy ? "text-[var(--mg-caution)]" : "text-[var(--mg-dim)]"}`} data-testid="mg-plan-hint">
                    {!state.draft.length
                      ? "Add actions above, then review."
                      : draftFit.overBy
                        ? `Over budget by ${draftFit.overBy} pts: remove an action or raise the budget.`
                        : `${draftFit.left} pts left. Review the order, then create the plan.`}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "use-suggested", order: suggested })}
                      className="text-sm text-[var(--mg-dim)] underline underline-offset-2 hover:text-[var(--mg-text)]"
                      data-testid="mg-use-suggested"
                    >
                      {"Fill with suggested order"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewOpen(true)}
                      disabled={!state.draft.length || draftFit.overBy > 0}
                      className="min-h-11 rounded-xl bg-[var(--mg-coral)] px-5 text-sm font-semibold text-[#1a0f0c] disabled:opacity-40"
                      data-testid="mg-review-plan"
                    >
                      {state.draft.length ? `Review plan (${state.draft.length})` : "Review plan"}
                    </button>
                  </div>
                </>
              )}
              {sequence.phase !== "none" ? (
                <SequenceList
                  // A new phase (draft → confirmed) starts with its own default: the confirmed sequence opens.
                  key={sequence.phase}
                  sequence={sequence}
                  titleByTask={titleByTask}
                  selectedTaskId={state.selectedTaskId}
                  selectedSegmentId={selectedSegment?.id ?? null}
                  onSelectTask={pickTask}
                  onSelectSegment={pickSegment}
                  defaultOpen={sequence.phase === "confirmed"}
                />
              ) : null}
            </div>
            <PlanReview
              open={reviewOpen && !state.plan}
              fit={draftFit}
              budget={state.budget}
              viewById={planViewById}
              onMove={(taskId, by) => dispatch({ type: "move-draft", taskId, by })}
              onRemove={(taskId) => dispatch({ type: "toggle-draft", taskId })}
              onCreate={() => {
                dispatch({ type: "create-plan" });
                setReviewOpen(false);
              }}
              onClose={() => setReviewOpen(false)}
            />
          </aside>
        </main>
      ) : (
        <EvaHud
          state={state}
          s={s}
          viewById={viewById}
          consumed={consumed}
          map={map("minimal", "selected")}
          routeStatus={routeStatus}
          onStart={() => dispatch({ type: "start-task" })}
          onCompleteStep={(index) => dispatch({ type: "complete-step", stepsByTask, index })}
          onSkipStep={(reason, index) => dispatch({ type: "skip-step", stepsByTask, index, reason })}
          onPause={() => dispatch({ type: "pause-step" })}
          onResume={() => dispatch({ type: "resume-step" })}
          onNote={(index, note) => dispatch({ type: "set-step-note", stepsByTask, index, note })}
          onUndoStep={() => dispatch({ type: "undo-step" })}
          onReopen={(taskId, index) => {
            const titles = Object.fromEntries(s.actions.map((a) => [a.taskId, a.shortTitle]));
            const wasDone = state.plan?.items.find((i) => i.taskId === taskId)?.status === "done";
            dispatch({ type: "reopen-step", stepsByTask, taskId, index, titles });
            // EVA-1.2: reopening a completed action changes the remaining work, so feasibility is re-checked
            // with the existing engine at the effort available after the release.
            if (wasDone) {
              const at = engineAt(Math.max(0, state.budget - (consumed - (costs[taskId] ?? 0))));
              dispatch({
                type: "recheck",
                label: `Reopened: ${titles[taskId] ?? taskId}`,
                rankedTaskIds: at.views.filter((v) => v.rank !== null).map((v) => v.taskId),
                scores: engineScores(at),
                costs,
                stepsByTask,
                titles,
              });
            }
          }}
          onSetSkipReason={(index, reason) => dispatch({ type: "set-skip-reason", stepsByTask, index, reason })}
          onSkip={(reason) => dispatch({ type: "skip-task", reason })}
          onEvent={(id) => {
            const ev = s.events.find((e) => e.id === id);
            if (ev) checkConstraints(ev.budget, ev.label);
          }}
          onReviewReplan={() => checkConstraints(state.budget, "Re-check of the current plan")}
          onUndo={() => dispatch({ type: "undo-replan", costs })}
          onDismissNotice={() => dispatch({ type: "dismiss-notice" })}
          replan={
            state.replan && state.plan ? (
              <ReplanDialog
                proposal={state.replan}
                viewById={viewById}
                // MAP-2: both options as plan-order diagrams, before the decision.
                preview={replanSequences({ items: state.plan.items, proposal: state.replan, targets, stepsByTask })}
                onAccept={() => dispatch({ type: "accept-replan" })}
                onKeep={() => dispatch({ type: "keep-plan" })}
              />
            ) : null
          }
          onBackToPlanning={() => dispatch({ type: "set-mode", mode: "planning" })}
          onEvidence={(id) => setEvidenceFor(id)}
        />
      )}

      <CandidateCompare
        open={compareOpen && state.mode === "planning"}
        suspended={evidenceFor !== null}
        views={views}
        compare={compare}
        pair={comparePair}
        onPair={setComparePair}
        onEvidence={(taskId) => setEvidenceFor(taskId)}
        onClose={() => setCompareOpen(false)}
      />
      <EvidenceSheet
        open={evidenceFor !== null}
        onClose={() => setEvidenceFor(null)}
        view={evidenceView}
        task={evidenceTask}
        gaps={snapshot.gaps}
        assumptions={snapshot.assumptions}
        sourceById={sourceById}
        briefing={briefing}
        awaitingReview={planning.reviewed.awaitingReview.length}
        unreviewedIds={planning.provisional.unreviewedInputs}
      />
    </div>
  );
}
