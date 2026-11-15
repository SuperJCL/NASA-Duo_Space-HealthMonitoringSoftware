"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MockStationAdapter, type StationAdapter } from "@/lib/station/adapter";
import { resolveLink, type LinkConfig } from "@/lib/station/link-config";
import { RelayStationAdapter, type RelayStatus } from "@/lib/station/relay-adapter";
import { crewCards, notifications } from "@/lib/station/crew";
import { evaRunId, MISSION_CREW, missionPhase, type MissionDef } from "@/lib/station/mission";
import { openCases } from "@/lib/station/station";
import { DemoDirector } from "@/lib/station/demo";
import { DevPanel } from "../DevPanel";
import { useStation } from "../useStation";
import { DemoBar, DemoDrawer } from "./DemoDrawer";
import type { DemoScenario } from "@/lib/station/demo";
import { useNow } from "./motion";
import { CrewCard, NotificationBar } from "./Overview";
import { PersonPanel } from "./PersonPanel";
import { RelayDevDrawer } from "./RelayDevDrawer";
import { MissionMapView, type MissionGlassData } from "./MissionMapView";
import { EndEvaDialog, MissionBar, MissionStrip, StartEvaDialog, type StationView } from "./MissionPanels";

/** The mission the station prepares and runs: the existing Mission Glass scenario (loaded on the server). */
export type StationMission = { data: MissionGlassData; def: MissionDef };
const VIEW_KEY = "myomars.station.view";
/** The user's own view choice for one run (kept across a refresh of the tab). */
const readStoredView = (): { runKey: string; view: StationView } | null => {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null") as { runKey?: unknown; view?: unknown } | null;
    return v && typeof v.runKey === "string" && (v.view === "map" || v.view === "health") ? { runKey: v.runKey, view: v.view } : null;
  } catch {
    return null;
  }
};

const noop = () => () => {};
const isDev = () => new URLSearchParams(window.location.search).get("dev") === "1";
/** The demo identity of the base staff (recorded with every decision; not asked again each time). */
const REVIEWER = "基地值班员";
/** Business pacing of the simulated analysis on this page (display pacing, not an algorithm's duration). */
const STAGE_MS = 2600;
const BUILD = `${process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "unknown"} · ${(process.env.NEXT_PUBLIC_BUILD_TIME ?? "").slice(11, 16)} UTC${process.env.NODE_ENV === "development" ? " · 开发模式" : ""}`;

const readLink = () => JSON.stringify(resolveLink(window.location.search, window.location, process.env.NEXT_PUBLIC_MYOMARS_RELAY));
const CONN_TEXT: Record<RelayStatus["conn"], string> = { connecting: "连接中…", online: "已连接", reconnecting: "断线，重连中…", offline: "未连接" };
const CONN_TONE: Record<RelayStatus["conn"], string> = { connecting: "border-[var(--mg-line-strong)] text-[var(--mg-dim)]", online: "border-[var(--mg-ok)] text-[var(--mg-ok)]", reconnecting: "border-[var(--mg-caution)] text-[var(--mg-caution)]", offline: "border-[#ff6b6b] text-[#ff8f8f]" };
const noStatus = () => () => {};
const nullStatus = () => null;
const READ_ONLY = "只读窗口：另一个基站窗口正在处理这个会话，请在那个窗口操作。";
/**
 * Station client id for the relay lease: kept across a RELOAD of the same tab (so the reloaded page
 * renews its own lease at once), fresh for a new or duplicated tab (which then stays read-only).
 */
let pageClientId: string | null = null;
function stationClientId() {
  // Once per page load (React may call state initialisers twice in development).
  if (pageClientId) return pageClientId;
  const fresh = `station-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const kept = sessionStorage.getItem("myomars.station.clientId");
    pageClientId = nav?.type === "reload" && kept ? kept : fresh;
    sessionStorage.setItem("myomars.station.clientId", pageClientId);
  } catch {
    pageClientId = fresh;
  }
  return pageClientId;
}

/**
 * MyoMars base station: crew overview → alerts → person panel (analysis + communication) → back to
 * the overview. Rendering only: the rules live in src/lib/station/ (state machine, analysis,
 * flow, crew, comms); every input travels through the adapter — the local mock (standalone demo,
 * default) or the local relay (`?relay=…`, integration).
 */
export function CrewStation({ mission = null }: { mission?: StationMission | null }) {
  // Resolved on the client only (the server renders a neutral shell), so the adapter is created once.
  const linkJson = useSyncExternalStore(noop, readLink, () => null);
  if (!linkJson) return <div lang="zh-CN" className="mission-glass min-h-dvh" data-testid="crew-station-loading" />;
  return <StationShell key={linkJson} link={JSON.parse(linkJson) as LinkConfig} mission={mission} />;
}

function StationShell({ link, mission }: { link: LinkConfig; mission: StationMission | null }) {
  const [adapter] = useState<StationAdapter>(() => (link.mode === "relay" ? new RelayStationAdapter({ baseUrl: link.baseUrl, sessionId: link.sessionId, clientId: stationClientId() }) : new MockStationAdapter()));
  const relay = adapter instanceof RelayStationAdapter ? adapter : null;
  const mockAdapter = adapter instanceof MockStationAdapter ? adapter : null;
  const relayStatus = useSyncExternalStore(relay ? relay.subscribeStatus : noStatus, relay ? relay.getStatus : nullStatus, relay ? relay.getStatus : nullStatus);
  const rawApi = useStation(adapter, { stageDelayMs: STAGE_MS, sessionId: link.mode === "relay" ? link.sessionId : "local" });
  // Read-only window (another station window holds the relay lease): no decisions, no resends here.
  const readOnly = !!relayStatus && relayStatus.lease !== "holder";
  const api = readOnly ? { ...rawApi, review: () => READ_ONLY, resend: () => READ_ONLY, startEva: () => READ_ONLY, endEva: () => READ_ONLY } : rawApi;
  const { state } = api;
  const mock = adapter.mode === "standalone-mock";
  const [director] = useState(() => new DemoDirector((raw) => mockAdapter?.inject(raw)));
  useEffect(() => director.update(state), [director, state]);
  useEffect(() => () => director.dispose(), [director]);
  const demo = useSyncExternalStore(director.subscribe, director.getSnapshot, director.getSnapshot);
  const dev = useSyncExternalStore(noop, isDev, () => false);
  const now = useNow();

  const [openId, setOpenId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [drawer, setDrawerMode] = useState<"hidden" | "open" | "bar">("hidden");

  // ---- mission context: task preparation on the map, health monitoring during the EVA ----
  const def = mission?.def ?? null;
  const phase = missionPhase(state);
  const runKey = state.run?.runId ?? "none";
  const [userView, setUserView] = useState(readStoredView);
  // Default: the map while preparing, health monitoring once an EVA runs (once per run); the user's own
  // choice for the current run wins afterwards (no repeated forced switching). The standalone demo
  // (no relay) keeps health monitoring as its default. Before the relay history arrived, nothing is known.
  const historyPending = !!relayStatus && relayStatus.conn !== "online" && state.cursor === 0 && !state.run;
  const autoView: StationView = !mission || mock || historyPending ? "health" : phase === "preparing" || phase === "starting" ? "map" : "health";
  const view: StationView = !mission ? "health" : userView && userView.runKey === runKey ? userView.view : autoView;
  const chooseView = (v: StationView) => {
    const u = { runKey, view: v };
    setUserView(u);
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(u));
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  };
  // The map is mounted the first time it is shown and then only hidden (its view and planning state are kept).
  const [mapShown, setMapShown] = useState(false);
  if (view === "map" && !mapShown) setMapShown(true);
  const [mgTaskId, setMgTaskId] = useState<string | null>(null);
  const selectedTask = def?.tasks.find((t) => t.taskId === mgTaskId) ?? null;
  const [astronautId, setAstronautId] = useState<string>(MISSION_CREW[0].id);
  const [dialog, setDialog] = useState<null | "start" | "end">(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const openCount = openCases(state).length;
  const canAct = !!relay && !readOnly;
  const confirmStart = () => {
    const crew = MISSION_CREW.find((m) => m.id === astronautId);
    if (!def || !selectedTask || !crew) return;
    const err = api.startEva({ runId: evaRunId(Date.now()), scenarioId: def.id, astronaut: { id: crew.id, callsign: crew.callsign }, task: { id: selectedTask.taskId, title: selectedTask.title, targetId: selectedTask.targetId }, by: REVIEWER });
    setDialogError(err);
    if (!err) setDialog(null);
  };
  const confirmEnd = () => {
    const err = api.endEva(REVIEWER);
    setDialogError(err);
    if (!err) setDialog(null);
  };

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
  /** From the map (or the bar): health monitoring, at that person's event (an explicit click only). */
  const jump = (astronautId: string, caseId: string) => {
    chooseView("health");
    openPanel(astronautId, caseId);
  };
  const closePanel = () => {
    const id = openId;
    setOpenId(null);
    // Focus returns to the person's card (presentation only).
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-crew-card="${id}"]`)?.focus());
  };

  return (
    <div lang="zh-CN" className={`mission-glass flex flex-col ${view === "map" ? "h-dvh overflow-hidden" : "min-h-dvh"}`} data-testid="crew-station" data-link-mode={adapter.mode} data-view={view} data-phase={phase}>
      <div inert={openId !== null && openCard !== null} className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--mg-line)] px-5 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold tracking-tight">{"MyoMars"}</span>
            <span className="text-sm text-[var(--mg-dim)]">{mission ? "火星基站 · 任务准备与健康监测" : "火星基站 · 宇航员总览"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--mg-coral)] px-3 py-1 text-[13px] font-semibold text-[var(--mg-coral)]" data-testid="station-sim-pill">
              {"模拟数据 / 模拟分析"}
            </span>
            {relayStatus ? (
              <>
                <span className={`rounded-full border px-3 py-1 text-[12px] ${CONN_TONE[relayStatus.conn]}`} title={`${adapter.label}${relayStatus.lastError ? ` · ${relayStatus.lastError}` : ""}`} data-testid="station-link" data-conn={relayStatus.conn}>
                  {`通信服务：${CONN_TEXT[relayStatus.conn]} · 会话 ${relayStatus.sessionId}`}
                </span>
                <span className={`rounded-full border px-3 py-1 text-[12px] ${readOnly ? "border-[var(--mg-caution)] text-[var(--mg-caution)]" : "border-[var(--mg-line-strong)] text-[var(--mg-dim)]"}`} data-testid="station-lease" data-lease={relayStatus.lease}>
                  {relayStatus.lease === "holder" ? "本窗口负责处理" : relayStatus.lease === "readonly" ? "只读：另一基站窗口正在处理" : "确认处理窗口中…"}
                </span>
              </>
            ) : (
              <span className="rounded-full border border-[var(--mg-line-strong)] px-3 py-1 text-[12px] text-[var(--mg-dim)]" title={adapter.label} data-testid="station-link">
                {"未连接真实 HUD 与数据源 · 本地模拟"}
              </span>
            )}
            <span className="text-[12px] text-[var(--mg-dim)]">{`当前身份：${REVIEWER}（演示）`}</span>
            <span className="rounded border border-[var(--mg-line)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--mg-faint)]" title="构建标识：服务启动 / 构建时的提交与时间" data-testid="build-id">
              {`构建 ${BUILD}`}
            </span>
            <button type="button" onClick={() => setDrawerMode((d) => (d === "open" ? "hidden" : "open"))} aria-expanded={drawer === "open"} className="rounded-full border border-dashed border-[#d678ff] px-3 py-1 text-[12px] text-[#e3a6ff]" data-testid="demo-toggle">
              {relay ? (drawer === "open" ? "隐藏开发入口" : "开发入口（数据回放）") : drawer === "open" ? "隐藏本地模拟演示" : "本地模拟演示"}
            </button>
          </div>
        </header>
        {relay ? (
          <p className="border-b border-[var(--mg-line)] bg-[rgba(214,120,255,0.08)] px-5 py-1.5 text-[12px] text-[#e3a6ff]" data-testid="integration-banner">
            {"双端联调（基站 ↔ HUD）：HUD 为真实页面，经通信服务收发；观测来自数据回放模块的模拟样例，不是队友的健康数据。自动模拟 HUD 反馈已关闭。"}
          </p>
        ) : null}
        {mission ? <MissionBar def={def} state={state} phase={phase} view={view} onView={chooseView} cards={cards} onJump={jump} onEndEva={() => (setDialogError(null), setDialog("end"))} canAct={canAct} /> : null}

        {mission && mapShown ? (
          <div className={view === "map" ? "flex min-h-0 flex-1 flex-col" : "hidden"} aria-hidden={view !== "map"} data-testid="map-view">
            <MissionStrip def={def} state={state} phase={phase} selectedTask={selectedTask} astronautId={astronautId} setAstronautId={setAstronautId} onSummary={() => (setDialogError(null), setDialog("start"))} onJump={jump} cards={cards} canAct={canAct} mode={relay ? "relay" : "mock"} openCount={openCount} onResendStart={(id) => api.resend(id)} />
            <div className="relative flex min-h-0 flex-1 flex-col">
              <MissionMapView data={mission.data} onSelectTask={setMgTaskId} activeTaskId={state.run?.task.id ?? null} />
            </div>
          </div>
        ) : null}

        <main className={view === "health" ? "flex flex-1 flex-col gap-4 p-5" : "hidden"} data-testid="health-view">
          <NotificationBar notes={notes} onOpen={openPanel} />
          {cards.length ? (
            <section aria-label="宇航员" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="crew-grid">
              {cards.map((card) => (
                <CrewCard key={card.astronautId} card={card} now={now} onOpen={() => openPanel(card.astronautId)} />
              ))}
            </section>
          ) : (
            <section className="mg-glass flex flex-col items-start gap-2 rounded-2xl p-6" data-testid="crew-empty">
              <p className="text-[18px] font-semibold">{relay ? "尚未开始 EVA" : "尚未开始场景"}</p>
              <p className="text-[14px] text-[var(--mg-dim)]">
                {relay
                  ? relayStatus?.conn === "online"
                    ? "请在“任务地图”中选择任务和执行宇航员，查看任务摘要后确认开始 EVA。开始后，本次任务的宇航员卡片显示在这里。"
                    : `未连接通信服务（${relay.getStatus().baseUrl}）：请先启动 npm run relay，或检查地址与网络。`
                  : "基站还没有收到场景开始与人员信息。可打开“本地模拟演示”，选择模拟宇航员和场景后启动。"}
              </p>
              {relay ? (
                mission ? (
                  <button type="button" onClick={() => chooseView("map")} className="rounded-lg border border-[var(--mg-line-strong)] px-3 py-1.5 text-[13px]" data-testid="go-map">
                    {"前往任务地图"}
                  </button>
                ) : null
              ) : (
                <button type="button" onClick={() => setDrawerMode("open")} className="rounded-lg border border-dashed border-[#d678ff] px-3 py-1.5 text-[13px] text-[#e3a6ff]">
                  {"打开本地模拟演示"}
                </button>
              )}
            </section>
          )}
          <details className="mt-auto text-[12px] text-[var(--mg-faint)]">
            <summary className="cursor-pointer">{"技术说明"}</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>{"所有数据与分析均为模拟；分析是确定性规则，不调用模型，不作诊断、治疗或自动任务限制。"}</li>
              <li>{"人员名单、设备连接和宇航员主动报告是本地模拟扩展（myomars/v1-local），不属于共享契约 v1；接口提案见 docs/myomars/STATION-LOCAL-PROPOSALS.md。"}</li>
              <li>{relay ? `传输：${adapter.label}（本窗口 ${relay.getStatus().clientId}）。“基站已发出”只表示通信服务已接收（带序号），不代表 HUD 已收到；HUD 接收与宇航员确认只来自 HUD 的回传。` : `传输：${adapter.label}。“基站已发出”只表示交给本地模拟通道，不代表 HUD 已收到。`}</li>
              <li>{"任务地图复用原有 Mission Glass（2D 地图、3D 地形、任务选择、规划、EVA 路线与步骤）；独立的完整页面仍在 /legacy/mission-glass，研究工作区 /research，旧版三栏工作台 /legacy/workbench。"}</li>
            </ul>
          </details>
        </main>
      </div>

      {dialog === "start" && def && selectedTask ? <StartEvaDialog def={def} task={selectedTask} astronautId={astronautId} onConfirm={confirmStart} onCancel={() => setDialog(null)} error={dialogError} /> : null}
      {dialog === "end" ? <EndEvaDialog openCount={openCount} onConfirm={confirmEnd} onCancel={() => setDialog(null)} error={dialogError} /> : null}
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
      {relay && drawer === "open" ? (
        <RelayDevDrawer
          relay={relay}
          state={state}
          onOpenPerson={(astronautId) => {
            setChosen((m) => {
              const next = { ...m };
              delete next[astronautId];
              return next;
            });
            setOpenId(astronautId);
            setDrawerMode("hidden");
          }}
          onClose={() => setDrawerMode("hidden")}
        />
      ) : null}
      {!relay && drawer === "bar" ? <DemoBar director={director} snap={demo} state={state} now={now} onExpand={() => setDrawerMode("open")} /> : null}
      {!relay && drawer === "open" ? (
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
      {dev && mockAdapter ? <DevPanel adapter={mockAdapter} state={state} caseId={panelCase ?? cards.find((c) => c.event)?.event?.caseId ?? null} /> : null}
    </div>
  );
}
