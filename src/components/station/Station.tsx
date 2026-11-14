"use client";

import { useState, useSyncExternalStore } from "react";
import { MockStationAdapter } from "@/lib/station/adapter";
import { workbenchStage } from "@/lib/station/station";
import { ActionPanel } from "./ActionPanel";
import { CaseDetails, CaseSummary, Timeline } from "./CaseView";
import { CrewColumn } from "./CrewColumn";
import { DevPanel } from "./DevPanel";
import { useStation } from "./useStation";

const noop = () => () => {};
const isDev = () => new URLSearchParams(window.location.search).get("dev") === "1";

/**
 * MyoMars base station: a health-event workbench built with the Mission Glass visual system
 * (header, tokens, glass panels). Left: astronaut and events. Centre: understand the event.
 * Right: the action for the event's current stage. Rendering only: rules live in src/lib/station/.
 */
export function Station() {
  const [adapter] = useState(() => new MockStationAdapter());
  const api = useStation(adapter);
  const { state } = api;
  const dev = useSyncExternalStore(noop, isDev, () => false);
  const [selected, setSelected] = useState<string | null>(null);
  const cases = state.caseOrder.map((id) => state.cases[id]);
  const current = (selected && state.cases[selected]) || cases[cases.length - 1] || null;
  const count = (stages: string[]) => cases.filter((c) => stages.includes(workbenchStage(c))).length;

  return (
    <div lang="zh-CN" className="mission-glass flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden" data-testid="station" data-link-mode={adapter.mode}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--mg-line)] px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">{"MyoMars"}</span>
          <span className="text-sm text-[var(--mg-dim)]">{"火星基站 · 健康事件工作台"}</span>
        </div>
        <p className="text-[13px] text-[var(--mg-dim)]" data-testid="station-counts">
          {`待审核 ${count(["review", "reassessed"])} · 等待宇航员 ${count(["dispatched"])} · 分析中 ${count(["analysing", "reassessing"])}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--mg-coral)] px-3 py-1 text-[13px] font-semibold text-[var(--mg-coral)]" data-testid="station-sim-pill">
            {"模拟数据 / 模拟分析"}
          </span>
          <span className="rounded-full border border-[var(--mg-line-strong)] px-3 py-1 text-[12px] text-[var(--mg-dim)]" title={adapter.label} data-testid="station-link">
            {"独立演示 · 未连接 Trigger / HUD"}
          </span>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-3 p-3 lg:min-h-0 lg:grid-cols-[16rem_minmax(0,1fr)_27rem] lg:grid-rows-[auto_minmax(0,1fr)]">
        <aside className="mg-glass flex min-h-0 flex-col lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <CrewColumn state={state} selectedId={current?.caseId ?? null} onSelect={setSelected} />
        </aside>
        {current ? (
          <>
            <div className="lg:col-start-2 lg:row-start-1" data-testid="station-case" data-case={current.caseId} data-phase={current.phase} data-stage={workbenchStage(current)} data-alert={current.alert.level} data-version={current.evaluations.at(-1)?.version}>
              <CaseSummary c={current} />
            </div>
            <section aria-label="当前处理" className="mg-glass flex min-h-0 flex-col overflow-y-auto lg:col-start-3 lg:row-span-2 lg:row-start-1">
              <ActionPanel c={current} state={state} api={api} />
            </section>
            <section aria-label="分析与证据" className="mg-glass min-h-0 overflow-y-auto p-4 lg:col-start-2 lg:row-start-2">
              <CaseDetails c={current} state={state} />
            </section>
          </>
        ) : (
          <>
            <div className="mg-glass flex flex-col gap-1 p-5 lg:col-start-2 lg:row-start-1" data-testid="station-empty">
              <p className="text-[12px] text-[var(--mg-faint)]">{"发生了什么"}</p>
              <h2 className="text-[19px] font-semibold">{state.run ? "场景进行中，等待模拟观测" : "等待场景开始"}</h2>
              <p className="text-[14px] text-[var(--mg-dim)]">
                {state.run
                  ? `运行 ${state.run.runId}：${state.run.astronaut.callsign} · ${state.run.task.title}。尚未收到观测；收到后基站自动进行模拟分析并生成待审候选。`
                  : "基站尚未收到场景开始事件。Trigger 接入前，可在地址后加 ?dev=1 打开开发测试入口注入模拟事件。"}
              </p>
              <p className="text-[12px] text-[var(--mg-faint)]">{`输入来源：${adapter.mode === "standalone-mock" ? "本地 mock 适配层（未连接 Trigger / HUD）" : adapter.label}`}</p>
            </div>
            <section aria-label="当前处理" className="mg-glass min-h-0 overflow-y-auto lg:col-start-3 lg:row-span-2 lg:row-start-1">
              <ActionPanel c={null} state={state} api={api} />
            </section>
            <section aria-label="事件时间线" className="mg-glass min-h-0 overflow-y-auto p-4 lg:col-start-2 lg:row-start-2">
              <Timeline entries={state.timeline} />
            </section>
          </>
        )}
      </main>
      {api.lastError && api.lastError.startsWith("invalid") ? (
        <p role="alert" className="fixed bottom-3 right-3 z-50 max-w-md rounded-lg bg-[rgba(11,17,28,0.95)] p-2 text-[12px] text-[var(--mg-caution)]">
          {`拒收一条无效消息：${api.lastError.split("\n")[0]}`}
        </p>
      ) : null}
      {dev ? <DevPanel adapter={adapter} state={state} caseId={current?.caseId ?? null} /> : null}
    </div>
  );
}
