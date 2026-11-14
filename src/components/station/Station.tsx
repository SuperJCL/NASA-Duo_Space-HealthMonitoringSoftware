"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { MapFeature } from "@/lib/geo/features";
import type { SimulatedTarget } from "@/lib/prototype/mission-glass";
import { MockStationAdapter } from "@/lib/station/adapter";
import { latest, type Case } from "@/lib/station/station";
import type { ResolvedScouting } from "@/lib/eva-route/scenario";
import { traverseLinesOf } from "@/lib/eva-route/repository";
import { MarsMapLoader } from "@/components/map/MarsMapLoader";
import type { SimTarget } from "@/components/map/MarsMap";
import { RouteWorkspace } from "@/components/route/RouteWorkspace";
import { useEvaRoute } from "@/components/route/useEvaRoute";
import { CasePanel } from "./CasePanel";
import { DevPanel } from "./DevPanel";
import { useStation } from "./useStation";

const noop = () => () => {};
const isDev = () => new URLSearchParams(window.location.search).get("dev") === "1";
const ALERT_TEXT = { none: "无告警", watch: "关注", alert: "告警" } as const;

/**
 * MyoMars base station, built on the Mission Glass shell (header, map-first layout, glass panels,
 * EVA route view). It shows simulated observations, a simulated (rule-based) analysis, human
 * review, dispatch to the HUD through an adapter, and retest re-evaluation. Rendering only: the
 * rules live in src/lib/station/.
 */
export function Station({ features, targets, routeScenario }: { features: MapFeature[]; targets: SimulatedTarget[]; routeScenario: ResolvedScouting }) {
  const [adapter] = useState(() => new MockStationAdapter());
  const api = useStation(adapter);
  const { state } = api;
  const dev = useSyncExternalStore(noop, isDev, () => false);
  const [tab, setTab] = useState<"station" | "route">("station");
  const [routeOpened, setRouteOpened] = useState(false);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);

  // EVA route context (reused unchanged from Mission Glass).
  const traverse = useMemo(() => traverseLinesOf(features), [features]);
  const routeTargets = useMemo(() => targets.map((t) => ({ id: t.id, name: t.name, position: t.position })), [targets]);
  const verifiedSites = useMemo(
    () => features.flatMap((f) => (f.kind === "sample-site" && f.geometry.type === "Point" ? [{ id: f.id, name: f.name, position: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as const }] : [])),
    [features],
  );
  const route = useEvaRoute({ scenario: routeScenario, targets: routeTargets, traverse, enabled: routeOpened });

  const taskTargetId = state.run?.task.targetId ?? null;
  const mapTargets = useMemo<SimTarget[]>(
    () => targets.map((t) => ({ id: t.id, name: t.name, position: t.position, tone: t.id === taskTargetId ? "active" : "candidate", status: t.id === taskTargetId ? "宇航员当前任务位置（模拟）" : undefined })),
    [targets, taskTargetId],
  );
  const extent = useMemo(() => {
    const lons = targets.map((t) => t.position[0]);
    const lats = targets.map((t) => t.position[1]);
    return [Math.min(...lons) - 0.004, Math.min(...lats) - 0.003, Math.max(...lons) + 0.004, Math.max(...lats) + 0.003] as const;
  }, [targets]);

  const cases: Case[] = state.caseOrder.map((id) => state.cases[id]);
  const current = (selectedCase && state.cases[selectedCase]) || cases[cases.length - 1] || null;
  const lastObs = [...cases].map((c) => ({ c, ev: latest(c) })).sort((a, b) => a.ev.startedAt.localeCompare(b.ev.startedAt)).at(-1);
  const pending = cases.filter((c) => ["awaiting-review", "on-hold", "deferred", "rejected"].includes(c.phase)).length;

  return (
    <div lang="zh-CN" className="mission-glass flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden" data-testid="station" data-link-mode={adapter.mode}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--mg-line)] px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">{"MyoMars"}</span>
          <span className="text-sm text-[var(--mg-dim)]">{"火星基站 · 演示原型"}</span>
        </div>
        <div role="tablist" aria-label="视图" className="flex rounded-xl border border-[var(--mg-line)] p-1 text-sm">
          {(["station", "route"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={tab === m}
              onClick={() => {
                if (m === "route") setRouteOpened(true);
                setTab(m);
              }}
              data-testid={m === "route" ? "mg-mode-route" : "station-tab-station"}
              className={`rounded-lg px-4 py-1.5 transition-colors duration-150 ${tab === m ? "bg-[var(--mg-surface)] text-[var(--mg-text)]" : "text-[var(--mg-dim)] hover:text-[var(--mg-text)]"}`}
            >
              {m === "station" ? "基站总览" : "EVA 路线"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--mg-coral)] px-3 py-1 text-[13px] font-semibold text-[var(--mg-coral)]" data-testid="station-sim-pill">
            {"模拟数据 / 模拟分析"}
          </span>
          <span className="rounded-full border border-[var(--mg-line-strong)] px-3 py-1 text-[12px] text-[var(--mg-dim)]" title={adapter.label} data-testid="station-link">
            {"独立演示 · 未连接 Trigger / HUD"}
          </span>
        </div>
      </header>

      {tab === "route" ? (
        <RouteWorkspace r={route} scenario={routeScenario} targets={routeTargets} verifiedSites={verifiedSites} traverse={traverse} />
      ) : (
        <main className="relative flex flex-1 flex-col lg:block lg:min-h-0">
          <section aria-label="宇航员位置（地图）" className="relative h-[38dvh] shrink-0 lg:absolute lg:inset-0 lg:h-auto">
            <MarsMapLoader
              features={features}
              selectedId={taskTargetId}
              onSelect={() => {}}
              labelKinds={["sample-site"]}
              initialExtent={extent}
              layerPanelOpenOnDesktop={false}
              simulatedTargets={mapTargets}
              chrome="minimal"
              simLabels="selected"
              ariaLabel="Lefroy Bay 地区地图：白色为宇航员当前任务的模拟目标位置，蓝色为已核实的 NASA/PDS 数据。"
              initialOverlays={["jezeroCtx", "jezeroHirise"]}
            />
            {/* Astronaut and current task (replaces the Mission Glass target strip). */}
            <div className="mg-glass absolute left-3 top-3 z-[5] max-w-sm p-3 text-[13px] lg:left-16" data-testid="station-crew">
              <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"宇航员与当前任务"}</p>
              {state.run ? (
                <>
                  <p className="font-semibold">{state.run.astronaut.callsign}</p>
                  <p className="text-[var(--mg-dim)]">{state.run.task.title}</p>
                  <p className="text-[12px] text-[var(--mg-faint)]">{`场景 ${state.run.scenarioId} · 运行 ${state.run.runId}`}</p>
                  <p className="mt-1 text-[12px]" data-testid="station-crew-status">
                    {`${cases.length} 个事件 · ${pending} 个待基地处理${current ? ` · 最高等级 ${ALERT_TEXT[cases.reduce<"none" | "watch" | "alert">((m, c) => (c.alert.level === "alert" || m === "alert" ? "alert" : c.alert.level === "watch" || m === "watch" ? "watch" : "none"), "none")]}` : ""}`}
                  </p>
                </>
              ) : (
                <p className="text-[var(--mg-dim)]">{"尚未开始场景"}</p>
              )}
            </div>
            {/* Latest observation and signal quality (replaces the map legend). */}
            {lastObs ? (
              <div className="mg-glass absolute bottom-10 left-3 z-[5] max-w-sm p-3 text-[13px] lg:left-16" data-testid="station-latest">
                <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"最新模拟观测"}</p>
                <p className="font-medium">{`${lastObs.ev.observation.observationId} · ${lastObs.c.caseId}`}</p>
                <p className="text-[12px] text-[var(--mg-dim)]">{`数据时间 ${lastObs.ev.observation.capturedAt.slice(11, 19)} UTC · ${lastObs.ev.observation.protocol.label}`}</p>
                <p className={`text-[12px] ${lastObs.ev.result.stages[0].status === "done" ? "text-[var(--mg-ok)]" : "text-[var(--mg-caution)]"}`}>
                  {lastObs.ev.completedAt === null && lastObs.ev.revealed === 0 ? "信号质量：检查中…" : lastObs.ev.result.stages[0].status === "done" ? "信号质量：合格" : "信号质量：不合格"}
                </p>
              </div>
            ) : null}
          </section>
          <aside aria-label="事件与审核" className="mg-glass relative z-10 m-3 flex min-h-0 flex-col overflow-hidden lg:absolute lg:inset-y-4 lg:right-4 lg:m-0 lg:w-[34rem]" data-testid="station-panel">
            <CasePanel api={api} selectedId={current?.caseId ?? null} onSelect={setSelectedCase} />
          </aside>
        </main>
      )}
      {api.lastError && api.lastError.startsWith("invalid") ? (
        <p role="alert" className="fixed bottom-3 left-3 z-50 max-w-md rounded-lg bg-[rgba(11,17,28,0.95)] p-2 text-[12px] text-[var(--mg-caution)]">
          {`拒收一条无效消息：${api.lastError.split("\n")[0]}`}
        </p>
      ) : null}
      {dev ? <DevPanel adapter={adapter} state={state} caseId={current?.caseId ?? null} /> : null}
    </div>
  );
}
