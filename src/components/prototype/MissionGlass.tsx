"use client";

import { useMemo, useReducer, useState } from "react";
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
  fitInOrder,
  initialMissionState,
  missionReducer,
  taskViews,
  type MgScenario,
  type SimulatedTarget,
} from "@/lib/prototype/mission-glass";
import { MarsMapLoader } from "@/components/map/MarsMapLoader";
import { EvaHud } from "./EvaHud";
import { EvidenceSheet } from "./EvidenceSheet";
import { TaskCard } from "./TaskCard";

type Props = {
  scenario: Scenario;
  registry: ReviewRegistry;
  sources: Source[];
  s: MgScenario;
  targets: SimulatedTarget[];
  features: MapFeature[];
  asOf: string;
  briefing: BriefingView | null;
};

const LABEL_KINDS = ["sample-site"] as const;

/**
 * MDI 2.0 "Mission Glass" prototype: Planning and EVA HUD share one mission
 * state (src/lib/prototype/mission-glass.ts). Ranks and feasibility come from
 * the existing engine; this component only renders and dispatches.
 */
export function MissionGlass({ scenario, registry, sources, s, targets, features, asOf, briefing }: Props) {
  const { snapshot } = useMemo(() => selectEvidenceAsOf(scenario, asOf), [scenario, asOf]);
  const defaultBudget = snapshot.resources[0]?.budget ?? 100;
  const [state, dispatch] = useReducer(missionReducer, defaultBudget, initialMissionState);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [verifiedPick, setVerifiedPick] = useState<string | null>(null);
  const sourceById = useMemo(() => new Map(sources.map((x) => [x.id, x])), [sources]);
  const costs = useMemo(() => Object.fromEntries(snapshot.tasks.map((t) => [t.id, t.costs["res-effort"] ?? Infinity])), [snapshot]);
  const stepsByTask = useMemo(() => Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length])), [s]);

  /** The existing engine at a given simulated budget, with the scenario's excluded platforms. */
  const engineAt = (budget: number) => {
    const constraints = { ...defaultConstraints(snapshot), budgets: { "res-effort": budget }, unavailablePlatforms: s.excludedPlatforms };
    const provisional = rankProvisional(scenario, registry, asOf, DEFAULT_WEIGHTS, constraints);
    const reviewed = rankReviewed(scenario, registry, asOf, DEFAULT_WEIGHTS, constraints);
    return { provisional, reviewed, views: taskViews({ s, snapshot, provisional, reviewed, budget }) };
  };
  // engineAt only depends on inputs listed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const planning = useMemo(() => engineAt(state.budget), [state.budget, snapshot, scenario, registry, asOf, s]);
  const consumed = consumedEffort(state, costs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const eva = useMemo(() => engineAt(Math.max(0, state.budget - consumed)), [state.budget, consumed, snapshot, scenario, registry, asOf, s]);
  const views = state.mode === "eva" ? eva.views : planning.views;
  const viewById = useMemo(() => new Map(views.map((v) => [v.taskId, v])), [views]);
  const planViewById = useMemo(() => new Map(planning.views.map((v) => [v.taskId, v])), [planning]);

  const targetByTask = new Map(targets.map((t) => [t.taskId, t]));
  const evaCurrent = state.plan?.items.find((i) => i.status === "active") ?? state.plan?.items.find((i) => i.status === "planned");
  const focusTask = state.mode === "eva" ? (evaCurrent?.taskId ?? null) : state.selectedTaskId;
  const mapSelected = verifiedPick ?? (focusTask ? (targetByTask.get(focusTask)?.id ?? null) : null);
  const onMapSelect = (id: string | null) => {
    const t = targets.find((x) => x.id === id);
    if (t) {
      setVerifiedPick(null);
      dispatch({ type: "select", taskId: t.taskId });
    } else setVerifiedPick(id);
  };
  const picked = verifiedPick ? features.find((f) => f.id === verifiedPick) : undefined;

  const draftCost = state.draft.reduce((sum, id) => sum + (costs[id] ?? 0), 0);
  const draftFits = draftCost <= state.budget;
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
  const map = (chrome: "full" | "minimal") => (
    <MarsMapLoader
      features={features}
      selectedId={mapSelected}
      onSelect={onMapSelect}
      labelKinds={LABEL_KINDS}
      initialExtent={ranges}
      layerPanelOpenOnDesktop={false}
      simulatedTargets={targets}
      chrome={chrome}
      initialOverlays={["jezeroCtx", "jezeroHirise"]}
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
          {(["planning", "eva"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={state.mode === m}
              onClick={() => dispatch({ type: "set-mode", mode: m })}
              data-testid={`mg-mode-${m}`}
              className={`rounded-lg px-4 py-1.5 transition-colors duration-150 ${state.mode === m ? "bg-[var(--mg-surface)] text-[var(--mg-text)]" : "text-[var(--mg-dim)] hover:text-[var(--mg-text)]"}`}
            >
              {m === "planning" ? "Mission planning" : "EVA HUD"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[var(--mg-coral)] px-3 py-1 text-[13px] font-medium text-[var(--mg-coral)]" title={s.label} data-testid="mg-sim-pill">
            {"Simulated scenario"}
          </span>
          <button
            type="button"
            onClick={() => setEvidenceFor(focusTask ?? planning.views[0]?.taskId ?? null)}
            className="rounded-xl border border-[var(--mg-line)] px-3 py-1.5 text-sm hover:border-[var(--mg-line-strong)]"
            data-testid="mg-open-evidence"
          >
            {"Evidence"}
          </button>
        </div>
      </header>

      {state.mode === "planning" ? (
        <main className="relative flex flex-1 flex-col lg:min-h-0 lg:block">
          <section aria-label="Investigation map" className="relative h-[42dvh] shrink-0 lg:absolute lg:inset-0 lg:h-auto">
            {map("minimal")}
            <div className="pointer-events-none absolute bottom-12 left-4 hidden lg:block">
              <div className="mg-glass pointer-events-auto flex flex-col gap-1.5 px-3 py-2 text-[13px]" data-testid="mg-legend">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-block size-3 rounded-full bg-[#8ecae6]" />
                  {"Verified NASA/PDS data (sample sites, traverse)"}
                </span>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-block size-3 rotate-45 border-2 border-dashed border-[var(--mg-coral)]" />
                  {"Simulated target (scenario-defined position)"}
                </span>
              </div>
            </div>
            {picked ? (
              <div className="mg-glass mg-rise absolute left-16 top-4 max-w-xs p-3 text-sm" data-testid="mg-verified-pick">
                <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-cyan)]">{"Verified feature"}</p>
                <p className="mt-0.5 font-medium">{picked.name}</p>
                <p className="text-[var(--mg-dim)]">{picked.label}</p>
                <button type="button" onClick={() => setVerifiedPick(null)} className="mt-2 text-[var(--mg-dim)] underline underline-offset-2">
                  {"Close"}
                </button>
              </div>
            ) : null}
          </section>

          <aside
            aria-labelledby="mg-plan-title"
            className="mg-glass relative z-10 m-3 flex flex-col lg:absolute lg:inset-y-4 lg:right-4 lg:m-0 lg:w-[27.5rem]"
            data-testid="mg-planning"
          >
            <div className="border-b border-[var(--mg-line)] px-5 pt-4 pb-3">
              <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Mission planning"}</p>
              <h1 id="mg-plan-title" className="mt-0.5 text-xl font-semibold">
                {"Choose the next investigation"}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--mg-dim)]">{s.title}</p>
              <label className="mt-3 block text-sm">
                <span className="flex items-baseline justify-between">
                  <span className="text-[var(--mg-dim)]">{"Simulated effort budget"}</span>
                  <span className="text-lg font-semibold" data-testid="mg-budget">
                    {`${state.budget} pts`}
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={state.budget}
                  onChange={(e) => dispatch({ type: "set-budget", budget: Number(e.target.value) })}
                  aria-label="Simulated effort budget"
                  className="mt-1 w-full accent-[var(--mg-coral)]"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {planning.views.map((v) => (
                <TaskCard
                  key={v.taskId}
                  view={v}
                  target={targetByTask.get(v.taskId)}
                  selected={state.selectedTaskId === v.taskId}
                  inPlan={state.draft.includes(v.taskId)}
                  expanded={expanded === v.taskId}
                  limitations={limitationsFor(v.taskId)}
                  onSelect={() => {
                    setVerifiedPick(null);
                    dispatch({ type: "select", taskId: v.taskId });
                  }}
                  onTogglePlan={() => dispatch({ type: "toggle-draft", taskId: v.taskId })}
                  onToggleExpand={() => setExpanded((e) => (e === v.taskId ? null : v.taskId))}
                  onEvidence={() => setEvidenceFor(v.taskId)}
                />
              ))}
              <p className="px-1 text-[13px] text-[var(--mg-faint)]" data-testid="mg-ranking-note">
                {`Ranks: existing MDI engine, provisional and not scientifically validated. No reviewed ranking is available (${planning.reviewed.awaitingReview.length} relationships await expert review).`}
              </p>
            </div>

            <div className="border-t border-[var(--mg-line)] px-4 py-3" data-testid="mg-plan-bar">
              {state.plan ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-semibold">{"Plan ready"}</span>
                    <span className="text-[var(--mg-dim)]">{` · ${state.plan.items.map((i) => planViewById.get(i.taskId)?.shortTitle).join(" → ")}`}</span>
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => dispatch({ type: "reset-plan" })} className="rounded-xl border border-[var(--mg-line)] px-3 py-1.5 text-sm">
                      {"Clear"}
                    </button>
                    <button type="button" onClick={() => dispatch({ type: "set-mode", mode: "eva" })} className="rounded-xl bg-[var(--mg-coral)] px-4 py-1.5 text-sm font-medium text-[#1a0f0c]" data-testid="mg-start-eva">
                      {"Start EVA →"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold">{"Your plan"}</span>
                    <span className={draftFits ? "text-[var(--mg-dim)]" : "text-[var(--mg-caution)]"} data-testid="mg-draft-cost">
                      {`${draftCost} / ${state.budget} pts`}
                    </span>
                  </div>
                  {state.draft.length ? (
                    <ol className="mt-2 space-y-1" data-testid="mg-draft">
                      {state.draft.map((id, n) => (
                        <li key={id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--mg-surface)] px-2 py-1 text-sm">
                          <span>{`${n + 1}. ${planViewById.get(id)?.shortTitle ?? id}`}</span>
                          <span className="flex gap-1">
                            <button type="button" aria-label="Move up" onClick={() => dispatch({ type: "move-draft", taskId: id, by: -1 })} className="rounded px-1.5 text-[var(--mg-dim)] hover:text-[var(--mg-text)]">
                              {"↑"}
                            </button>
                            <button type="button" aria-label="Move down" onClick={() => dispatch({ type: "move-draft", taskId: id, by: 1 })} className="rounded px-1.5 text-[var(--mg-dim)] hover:text-[var(--mg-text)]">
                              {"↓"}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-1 text-sm text-[var(--mg-dim)]">{"Add tasks, or use the suggested order."}</p>
                  )}
                  {!draftFits ? <p className="mt-1 text-sm text-[var(--mg-caution)]">{"The plan exceeds the simulated budget."}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "use-suggested", order: suggested })}
                      className="rounded-xl border border-[var(--mg-line)] px-3 py-1.5 text-sm hover:border-[var(--mg-line-strong)]"
                      data-testid="mg-use-suggested"
                    >
                      {"Use suggested order"}
                    </button>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "create-plan" })}
                      disabled={!state.draft.length || !draftFits}
                      className="rounded-xl bg-[var(--mg-coral)] px-4 py-1.5 text-sm font-medium text-[#1a0f0c] disabled:opacity-40"
                      data-testid="mg-create-plan"
                    >
                      {"Create mission plan"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </aside>
        </main>
      ) : (
        <EvaHud
          state={state}
          s={s}
          viewById={viewById}
          consumed={consumed}
          map={map("minimal")}
          onStart={() => dispatch({ type: "start-task" })}
          onCompleteStep={() => dispatch({ type: "complete-step", stepsByTask })}
          onSkip={() => dispatch({ type: "skip-task" })}
          onEvent={(id) => {
            const ev = s.events.find((e) => e.id === id);
            if (!ev) return;
            const at = engineAt(Math.max(0, ev.budget - consumed));
            dispatch({
              type: "constraint-event",
              budget: ev.budget,
              label: ev.label,
              rankedTaskIds: at.views.filter((v) => v.rank !== null).map((v) => v.taskId),
              costs,
            });
          }}
          onAcceptReplan={() => dispatch({ type: "accept-replan" })}
          onKeepPlan={() => dispatch({ type: "keep-plan" })}
          onBackToPlanning={() => dispatch({ type: "set-mode", mode: "planning" })}
          onEvidence={(id) => setEvidenceFor(id)}
        />
      )}

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
      />
    </div>
  );
}
