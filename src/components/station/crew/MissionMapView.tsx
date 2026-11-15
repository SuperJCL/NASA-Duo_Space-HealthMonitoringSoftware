"use client";

import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import type { MissionGlass } from "@/components/prototype/MissionGlass";
import type { CrewMarker } from "@/components/map/MarsMap";

/** Server-loaded inputs of the existing Mission Glass (2D map, 3D terrain, tasks), passed through unchanged. */
export type MissionGlassData = Omit<Parameters<typeof MissionGlass>[0], "embedded">;

// Loaded only when the map view is first opened: the health view never waits for map code or assets.
// One lazy component per load attempt: a failed import is not cached, so "Retry" really loads again.
// (The station shell renders on the client only, so no server rendering is involved.)
type MgComponent = ComponentType<Parameters<typeof MissionGlass>[0]>;
const attempts = new Map<number, MgComponent>();
const missionGlassFor = (attempt: number): MgComponent => {
  let c = attempts.get(attempt);
  if (!c) {
    c = lazy(() => import("@/components/prototype/MissionGlass").then((m) => ({ default: m.MissionGlass })));
    attempts.set(attempt, c);
  }
  return c;
};
const loading = (
  <p className="p-6 text-[14px] text-[var(--mg-dim)]" data-testid="mission-map-loading">
    {"Loading Mission Map…"}
  </p>
);

/** A failure inside the map (code or resources) stays inside the map view; health monitoring is not affected. */
class MapBoundary extends Component<{ children: (attempt: number) => ReactNode }, { error: string | null; attempt: number }> {
  state = { error: null as string | null, attempt: 0 };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error)
      return (
        <div role="alert" className="mg-glass m-4 flex max-w-xl flex-col items-start gap-2 rounded-2xl p-5 text-[14px]" data-testid="mission-map-error">
          <p className="font-semibold text-[var(--mg-caution)]">{"Mission Map unavailable"}</p>
          <p className="text-[var(--mg-dim)]">{"The map component or its resources failed to load. Health Monitoring, communication and review are not affected: switch to Health Monitoring to continue."}</p>
          <p className="font-mono text-[11px] text-[var(--mg-faint)]">{this.state.error.slice(0, 200)}</p>
          <button type="button" onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))} className="rounded-lg border border-[var(--mg-line-strong)] px-3 py-1.5 text-[13px]" data-testid="mission-map-retry">
            {"Retry loading the map"}
          </button>
        </div>
      );
    return <div key={this.state.attempt} className="flex min-h-0 flex-1 flex-col">{this.props.children(this.state.attempt)}</div>;
  }
}

/**
 * The existing Mission Glass as the station's Mission Map (embedded mode): always the background of
 * the station, under the Health Monitoring overlay. Crew markers are SIMULATED positions (labelled).
 */
type Embedded = NonNullable<Parameters<typeof MissionGlass>[0]["embedded"]>;
export function MissionMapView({ data, onSelectTask, activeTaskId, crewMarkers, onSelectCrew, side, advanced, onAdvanced }: { data: MissionGlassData; onSelectTask: (taskId: string | null) => void; activeTaskId: string | null; crewMarkers: readonly CrewMarker[]; onSelectCrew: (id: string) => void; side: Embedded["side"]; advanced: boolean; onAdvanced: (open: boolean) => void }) {
  return (
    <MapBoundary>
      {(attempt) => {
        const MissionGlassLazy = missionGlassFor(attempt);
        return (
          <Suspense fallback={loading}>
            <MissionGlassLazy {...data} embedded={{ onSelectTask, activeTaskId, crewMarkers, onSelectCrew, side, advanced, onAdvanced }} />
          </Suspense>
        );
      }}
    </MapBoundary>
  );
}
