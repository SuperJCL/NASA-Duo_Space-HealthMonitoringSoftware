"use client";

import { useMemo, useState } from "react";
import { TerrainLoader } from "@/components/terrain/TerrainLoader";
import type { TerrainMarker } from "@/components/terrain/TerrainViewer";
import { LEFROY_TERRAIN, type LonLat } from "@/lib/terrain/terrain";
import type { ResolvedScouting } from "@/lib/eva-route/scenario";
import type { RouteTarget } from "@/lib/eva-route/world";
import { RoutePanel } from "./RoutePanel";
import { RoutePlanCanvas } from "./RoutePlanCanvas";
import type { EvaRouteState } from "./useEvaRoute";

/**
 * EVA route view in Mission Glass: the verified 3D terrain (or a 2D plan) with the simulated route
 * overlay, and the route / resources / scouting panel. Rendering only: every rule and number comes
 * from src/lib/eva-route/.
 */
export function RouteWorkspace({
  r,
  scenario,
  targets,
  verifiedSites,
  traverse,
}: {
  r: EvaRouteState;
  scenario: ResolvedScouting;
  targets: readonly RouteTarget[];
  verifiedSites: readonly { id: string; name: string; position: LonLat }[];
  traverse: readonly (readonly LonLat[])[];
}) {
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [notice, setNotice] = useState<string | null>(null);
  const roleOf = (id: string) => (id === r.config.primaryId ? ("primary" as const) : id === r.config.alternativeId ? ("alternative" as const) : null);
  const markers = useMemo<TerrainMarker[]>(
    () => [
      ...verifiedSites.map((v): TerrainMarker => ({ id: v.id, kind: "verified", name: v.name, position: v.position })),
      ...targets.map((t): TerrainMarker => ({
        id: t.id,
        kind: "simulated",
        name: t.name,
        position: t.position,
        status: t.id === r.config.primaryId ? "primary EVA target" : t.id === r.config.alternativeId ? "alternative EVA target" : undefined,
        tone: t.id === r.config.primaryId ? "active" : t.id === r.config.alternativeId ? "planned" : "candidate",
      })),
    ],
    [verifiedSites, targets, r.config.primaryId, r.config.alternativeId],
  );
  const planTargets = useMemo(() => targets.map((t) => ({ ...t, role: roleOf(t.id) })), [targets, r.config.primaryId, r.config.alternativeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="relative flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_30rem]" data-testid="route-workspace">
      <section aria-label="EVA route map" className="relative h-[60dvh] shrink-0 lg:h-auto">
        <div className="absolute left-3 top-3 z-[6] flex gap-2">
          <div role="group" aria-label="Route view" className="mg-glass flex items-center rounded-xl p-0.5 text-[13px]">
            {(["3d", "2d"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  setNotice(null);
                }}
                className={`min-h-9 whitespace-nowrap rounded-lg px-2.5 ${view === v ? "bg-[var(--mg-surface)] font-medium text-[var(--mg-text)]" : "text-[var(--mg-dim)]"}`}
                data-testid={`route-view-${v}`}
              >
                {v === "3d" ? "3D terrain" : "2D plan"}
              </button>
            ))}
          </div>
        </div>
        {view === "3d" ? (
          <div className="absolute inset-0" data-testid="route-terrain">
            <TerrainLoader
              meta={LEFROY_TERRAIN}
              markers={markers}
              traverse={traverse}
              selectedId={r.config.primaryId}
              // Selecting a simulated target makes it the primary EVA target (verified sites are context only).
              onSelect={(id) => {
                if (id && targets.some((t) => t.id === id) && id !== r.config.primaryId) r.setPrimary(id);
              }}
              onFallback={(reason) => {
                setView("2d");
                setNotice(reason);
              }}
              routeOverlay={r.overlay}
              showProfile={false}
              followSelection={false}
            />
          </div>
        ) : (
          <div className="flex size-full items-center justify-center p-3 pt-14">
            <RoutePlanCanvas meta={LEFROY_TERRAIN} overlay={r.overlay} targets={planTargets} />
          </div>
        )}
        {notice ? (
          <p role="alert" className="mg-glass absolute bottom-3 left-3 z-[6] max-w-md p-3 text-[13px] text-[var(--mg-caution)]" data-testid="route-terrain-fallback">
            {`3D terrain unavailable: ${notice}. Showing the 2D plan.`}
          </p>
        ) : null}
      </section>
      <aside aria-label="EVA route planning" className="mg-glass relative z-10 m-3 flex min-h-0 flex-col overflow-hidden lg:m-4 lg:ml-0">
        <RoutePanel r={r} scenario={scenario} targets={targets} />
      </aside>
    </main>
  );
}
