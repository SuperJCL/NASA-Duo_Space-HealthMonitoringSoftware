"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { useTerrainHeights } from "@/components/terrain/terrain-data";
import { LEFROY_TERRAIN, type LonLat } from "@/lib/terrain/terrain";
import { buildPlanningGrid } from "@/lib/eva-route/grid";
import { Mission } from "@/lib/eva-route/mission";
import { buildOverlay } from "@/lib/eva-route/overlay";
import type { DecisionAssumptions } from "@/lib/eva-route/assumptions";
import type { ResolvedScouting } from "@/lib/eva-route/scenario";
import type { RouteTarget } from "@/lib/eva-route/world";

export type RouteConfig = { variantId: string; primaryId: string; alternativeId: string; run: number };

/**
 * UI state for the EVA route view. The mission controller (src/lib/eva-route/mission.ts) owns
 * every rule and number; this hook only creates it, advances its simulated clock while the rover
 * moves, and re-renders. It lives in Mission Glass, so an approved route survives tab changes.
 */
export function useEvaRoute({ scenario, targets, traverse, enabled }: { scenario: ResolvedScouting; targets: readonly RouteTarget[]; traverse: readonly (readonly LonLat[])[]; enabled: boolean }) {
  const { heights, error } = useTerrainHeights(LEFROY_TERRAIN, enabled);
  const grid = useMemo(() => (heights ? buildPlanningGrid(LEFROY_TERRAIN, heights) : null), [heights]);
  const [config, setConfig] = useState<RouteConfig>({ variantId: scenario.variants[0].id, primaryId: scenario.defaultPrimaryId, alternativeId: scenario.defaultAlternativeId, run: 0 });
  const [truthView, setTruthView] = useState(false);
  const [warp, setWarp] = useState(60);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  const { mission, setupError } = useMemo(() => {
    if (!grid) return { mission: null, setupError: null };
    try {
      return { mission: new Mission({ grid, scenario, variantId: config.variantId, targets, primaryId: config.primaryId, alternativeId: config.alternativeId, traverse }), setupError: null };
    } catch (e) {
      return { mission: null, setupError: e instanceof Error ? e.message : String(e) };
    }
    // config.run: "Reset" makes a new mission with the same settings.
  }, [grid, scenario, targets, traverse, config]);

  const version = mission?.version ?? 0;
  // Options are recomputed once per state version (several A* runs), never per animation frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const evaluated = useMemo(() => mission?.options() ?? null, [mission, version]);
  const running = Boolean(mission?.rover.task);

  // While the rover moves, advance the simulated clock (warp × real time) and re-render ~8 times a second.
  useEffect(() => {
    if (!mission || !running) return;
    let raf = 0;
    let last = performance.now();
    let lastPaint = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      mission.advance(dt * warp);
      if (now - lastPaint > 120 || !mission.rover.task) {
        lastPaint = now;
        rerender();
      }
      if (mission.rover.task) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mission, running, warp]);

  const act = (fn: (m: Mission) => { ok: boolean; reason?: string }) => {
    if (!mission) return;
    const r = fn(mission);
    setToast(r.ok ? null : `Refused: ${r.reason ?? "not possible now"}`);
    setPreviewId(null);
    rerender();
  };

  const preview = useMemo(() => {
    if (!mission || !evaluated || mission.routes.approved) return null;
    const id = previewId ?? evaluated.recommendedByValue;
    const o = evaluated.options.find((x) => x.id === id);
    // Green is only for crew-approvable routes: never the unconfirmed scouting shortcut.
    return o && o.feasible && o.kind !== "scout" && o.route ? o.route : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission, evaluated, previewId, version]);

  const overlay = mission
    ? buildOverlay({
        grid: mission.grid,
        map: mission.map,
        verified: mission.verified,
        truth: truthView ? mission.debugTruth() : null,
        base: { cell: mission.cells.base, label: "Habitat" },
        rover: mission.rover,
        routes: mission.routes,
        preview,
        observationPosts: mission.observations.map((o) => o.post),
      })
    : null;

  return {
    status: error ? ("error" as const) : setupError ? ("error" as const) : mission ? ("ready" as const) : ("loading" as const),
    error: error ?? setupError,
    mission,
    evaluated,
    overlay,
    config,
    running,
    truthView,
    warp,
    toast,
    previewId: previewId ?? evaluated?.recommendedByValue ?? null,
    setVariant: (variantId: string) => setConfig((c) => ({ ...c, variantId, run: c.run + 1 })),
    setPrimary: (primaryId: string) => setConfig((c) => ({ ...c, primaryId, alternativeId: c.alternativeId === primaryId ? c.primaryId : c.alternativeId, run: c.run + 1 })),
    setAlternative: (alternativeId: string) => setConfig((c) => ({ ...c, alternativeId, primaryId: c.primaryId === alternativeId ? c.alternativeId : c.primaryId, run: c.run + 1 })),
    reset: () => {
      setToast(null);
      setPreviewId(null);
      setConfig((c) => ({ ...c, run: c.run + 1 }));
    },
    setTruthView,
    setWarp,
    setPreviewId,
    choose: (optionId: string) => act((m) => m.approve(optionId)),
    skip: () => act((m) => (m.skipScouting(), { ok: true })),
    applyAssumptions: (a: { assumptions: Partial<Omit<DecisionAssumptions, "targetValue">> & { targetValue?: Partial<DecisionAssumptions["targetValue"]> }; evaMaxH: number }) =>
      act((m) => {
        const r1 = m.setLimits({ evaMaxH: a.evaMaxH });
        if (!r1.ok) return r1;
        return m.setAssumptions(a.assumptions);
      }),
  };
}

export type EvaRouteState = ReturnType<typeof useEvaRoute>;
