"use client";

import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import type { MissionGlass } from "@/components/prototype/MissionGlass";

/** Server-loaded inputs of the existing Mission Glass (2D map, 3D terrain, tasks), passed through unchanged. */
export type MissionGlassData = Omit<Parameters<typeof MissionGlass>[0], "embedded">;

// Loaded only when the map view is first opened: the health view never waits for map code or assets.
// One lazy component per load attempt: a failed import is not cached, so "重试" really loads again.
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
    {"正在加载任务地图…"}
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
          <p className="font-semibold text-[var(--mg-caution)]">{"任务地图暂不可用"}</p>
          <p className="text-[var(--mg-dim)]">{"地图组件或地图资源加载失败。健康监测、通信与审核不受影响，可切换到“健康监测”继续处理。"}</p>
          <p className="font-mono text-[11px] text-[var(--mg-faint)]">{this.state.error.slice(0, 200)}</p>
          <button type="button" onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))} className="rounded-lg border border-[var(--mg-line-strong)] px-3 py-1.5 text-[13px]" data-testid="mission-map-retry">
            {"重试加载地图"}
          </button>
        </div>
      );
    return <div key={this.state.attempt} className="flex min-h-0 flex-1 flex-col">{this.props.children(this.state.attempt)}</div>;
  }
}

/**
 * The existing Mission Glass as the station's "任务地图" view (embedded mode). It stays mounted while
 * the health view is shown (hidden, so map view and planning state are kept; the 2D map and the 3D
 * terrain render on demand only, so a hidden map does no rendering work).
 */
export function MissionMapView({ data, onSelectTask, activeTaskId }: { data: MissionGlassData; onSelectTask: (taskId: string | null) => void; activeTaskId: string | null }) {
  return (
    <MapBoundary>
      {(attempt) => {
        const MissionGlassLazy = missionGlassFor(attempt);
        return (
          <Suspense fallback={loading}>
            <MissionGlassLazy {...data} embedded={{ onSelectTask, activeTaskId }} />
          </Suspense>
        );
      }}
    </MapBoundary>
  );
}
