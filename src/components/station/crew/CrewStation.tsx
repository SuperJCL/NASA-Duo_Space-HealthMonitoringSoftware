"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MockStationAdapter } from "@/lib/station/adapter";
import { crewCards, notifications } from "@/lib/station/crew";
import { DemoDirector } from "@/lib/station/demo";
import { DevPanel } from "../DevPanel";
import { useStation } from "../useStation";
import { DemoBar, DemoDrawer } from "./DemoDrawer";
import type { DemoScenario } from "@/lib/station/demo";
import { useNow } from "./motion";
import { CrewCard, NotificationBar } from "./Overview";
import { PersonPanel } from "./PersonPanel";

const noop = () => () => {};
const isDev = () => new URLSearchParams(window.location.search).get("dev") === "1";
/** The demo identity of the base staff (recorded with every decision; not asked again each time). */
const REVIEWER = "基地值班员";
/** Business pacing of the simulated analysis on this page (display pacing, not an algorithm's duration). */
const STAGE_MS = 2600;
const BUILD = `${process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "unknown"} · ${(process.env.NEXT_PUBLIC_BUILD_TIME ?? "").slice(11, 16)} UTC${process.env.NODE_ENV === "development" ? " · 开发模式" : ""}`;

/**
 * MyoMars base station: crew overview → alerts → person panel (analysis + communication) → back to
 * the overview. Rendering only: the rules live in src/lib/station/ (state machine, analysis,
 * flow, crew, comms) and every input travels through the adapter (local mock today).
 */
export function CrewStation() {
  const [adapter] = useState(() => new MockStationAdapter());
  const api = useStation(adapter, { stageDelayMs: STAGE_MS });
  const { state } = api;
  const mock = adapter.mode === "standalone-mock";
  const [director] = useState(() => new DemoDirector((raw) => adapter.inject(raw)));
  useEffect(() => director.update(state), [director, state]);
  useEffect(() => () => director.dispose(), [director]);
  const demo = useSyncExternalStore(director.subscribe, director.getSnapshot, director.getSnapshot);
  const dev = useSyncExternalStore(noop, isDev, () => false);
  const now = useNow();

  const [openId, setOpenId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [drawer, setDrawerMode] = useState<"hidden" | "open" | "bar">("hidden");

  const cards = crewCards(state, { mock });
  const notes = notifications(state, { mock });
  const openCard = cards.find((c) => c.astronautId === openId) ?? null;
  // The case shown for the open astronaut: the one chosen in the panel, else the one the card points at.
  const chosenCase = openId ? chosen[openId] : undefined;
  const panelCase = openCard ? (chosenCase && state.cases[chosenCase]?.astronautId === openId ? chosenCase : (openCard.event?.caseId ?? null)) : null;

  const openPanel = (astronautId: string, caseId?: string) => {
    if (caseId) setChosen((m) => ({ ...m, [astronautId]: caseId }));
    setOpenId(astronautId);
  };
  const playExample = (astronautId: string, scenario: DemoScenario) => {
    director.playExample(astronautId, scenario);
    setChosen((m) => {
      const next = { ...m };
      delete next[astronautId];
      return next;
    });
    setOpenId(astronautId);
    setDrawerMode("bar");
  };
  const closePanel = () => {
    const id = openId;
    setOpenId(null);
    // Focus returns to the person's card (presentation only).
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-crew-card="${id}"]`)?.focus());
  };

  return (
    <div lang="zh-CN" className="mission-glass flex min-h-dvh flex-col" data-testid="crew-station" data-link-mode={adapter.mode}>
      <div inert={openId !== null && openCard !== null} className="flex min-h-dvh flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--mg-line)] px-5 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold tracking-tight">{"MyoMars"}</span>
            <span className="text-sm text-[var(--mg-dim)]">{"火星基站 · 宇航员总览"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--mg-coral)] px-3 py-1 text-[13px] font-semibold text-[var(--mg-coral)]" data-testid="station-sim-pill">
              {"模拟数据 / 模拟分析"}
            </span>
            <span className="rounded-full border border-[var(--mg-line-strong)] px-3 py-1 text-[12px] text-[var(--mg-dim)]" title={adapter.label} data-testid="station-link">
              {"未连接真实 Trigger / HUD · 本地模拟"}
            </span>
            <span className="text-[12px] text-[var(--mg-dim)]">{`当前身份：${REVIEWER}（演示）`}</span>
            <span className="rounded border border-[var(--mg-line)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--mg-faint)]" title="构建标识：服务启动 / 构建时的提交与时间" data-testid="build-id">
              {`构建 ${BUILD}`}
            </span>
            <button type="button" onClick={() => setDrawerMode((d) => (d === "open" ? "hidden" : "open"))} aria-expanded={drawer === "open"} className="rounded-full border border-dashed border-[#d678ff] px-3 py-1 text-[12px] text-[#e3a6ff]" data-testid="demo-toggle">
              {drawer === "open" ? "隐藏本地模拟演示" : "本地模拟演示"}
            </button>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 p-5">
          <NotificationBar notes={notes} onOpen={openPanel} />
          {cards.length ? (
            <section aria-label="宇航员" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="crew-grid">
              {cards.map((card) => (
                <CrewCard key={card.astronautId} card={card} now={now} onOpen={() => openPanel(card.astronautId)} />
              ))}
            </section>
          ) : (
            <section className="mg-glass flex flex-col items-start gap-2 rounded-2xl p-6" data-testid="crew-empty">
              <p className="text-[18px] font-semibold">{"尚未开始场景"}</p>
              <p className="text-[14px] text-[var(--mg-dim)]">{"基站还没有收到场景开始与人员信息。Trigger 接入前，可打开“本地模拟演示”，选择模拟宇航员和场景后启动。"}</p>
              <button type="button" onClick={() => setDrawerMode("open")} className="rounded-lg border border-dashed border-[#d678ff] px-3 py-1.5 text-[13px] text-[#e3a6ff]">
                {"打开本地模拟演示"}
              </button>
            </section>
          )}
          <details className="mt-auto text-[12px] text-[var(--mg-faint)]">
            <summary className="cursor-pointer">{"技术说明"}</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>{"所有数据与分析均为模拟；分析是确定性规则，不调用模型，不作诊断、治疗或自动任务限制。"}</li>
              <li>{"人员名单、设备连接和宇航员主动报告是本地模拟扩展（myomars/v1-local），不属于共享契约 v1；接口提案见 docs/myomars/STATION-LOCAL-PROPOSALS.md。"}</li>
              <li>{`传输：${adapter.label}。“基站已发出”只表示交给本地模拟通道，不代表 HUD 已收到。`}</li>
              <li>{"旧版三栏工作台：/legacy/workbench；地图与 EVA 路线：/legacy/mission-glass。"}</li>
            </ul>
          </details>
        </main>
      </div>

      {openId && openCard ? (
        <PersonPanel
          state={state}
          api={api}
          mock={mock}
          astronautId={openId}
          caseId={panelCase}
          onSelectCase={(caseId) => setChosen((m) => ({ ...m, [openId]: caseId }))}
          onClose={closePanel}
          drafts={drafts}
          setDraft={(k, v) => setDrafts((d) => ({ ...d, [k]: v }))}
          others={notes.filter((n) => n.astronautId !== openId)}
          onSwitch={(astronautId, caseId) => openPanel(astronautId, caseId)}
          reviewer={REVIEWER}
          bottomGap={drawer === "bar"}
        />
      ) : null}
      {drawer === "bar" ? <DemoBar director={director} snap={demo} state={state} now={now} onExpand={() => setDrawerMode("open")} /> : null}
      {drawer === "open" ? (
        <DemoDrawer
          director={director}
          snap={demo}
          state={state}
          now={now}
          onLaunched={() => setDrawerMode("bar")}
          onPlayExample={playExample}
          onClose={() => {
            setDrawerMode("hidden");
            // Focus goes back to the panel when one is open, else to the drawer button.
            requestAnimationFrame(() => document.querySelector<HTMLElement>(openId ? '[data-testid="panel-close"]' : '[data-testid="demo-toggle"]')?.focus());
          }}
        />
      ) : null}
      {dev ? <DevPanel adapter={adapter} state={state} caseId={panelCase ?? cards.find((c) => c.event)?.event?.caseId ?? null} /> : null}
    </div>
  );
}
