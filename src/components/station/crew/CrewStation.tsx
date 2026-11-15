"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MockStationAdapter, type StationAdapter } from "@/lib/station/adapter";
import { resolveLink, type LinkConfig } from "@/lib/station/link-config";
import { RelayStationAdapter, type RelayStatus } from "@/lib/station/relay-adapter";
import { crewCards, notifications } from "@/lib/station/crew";
import { DemoDirector } from "@/lib/station/demo";
import { DevPanel } from "../DevPanel";
import { useStation } from "../useStation";
import { DemoBar, DemoDrawer } from "./DemoDrawer";
import type { DemoScenario } from "@/lib/station/demo";
import { useNow } from "./motion";
import { CrewCard, NotificationBar } from "./Overview";
import { PersonPanel } from "./PersonPanel";
import { RelayDevDrawer } from "./RelayDevDrawer";

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
export function CrewStation() {
  // Resolved on the client only (the server renders a neutral shell), so the adapter is created once.
  const linkJson = useSyncExternalStore(noop, readLink, () => null);
  if (!linkJson) return <div lang="zh-CN" className="mission-glass min-h-dvh" data-testid="crew-station-loading" />;
  return <StationShell key={linkJson} link={JSON.parse(linkJson) as LinkConfig} />;
}

function StationShell({ link }: { link: LinkConfig }) {
  const [adapter] = useState<StationAdapter>(() => (link.mode === "relay" ? new RelayStationAdapter({ baseUrl: link.baseUrl, sessionId: link.sessionId, clientId: stationClientId() }) : new MockStationAdapter()));
  const relay = adapter instanceof RelayStationAdapter ? adapter : null;
  const mockAdapter = adapter instanceof MockStationAdapter ? adapter : null;
  const relayStatus = useSyncExternalStore(relay ? relay.subscribeStatus : noStatus, relay ? relay.getStatus : nullStatus, relay ? relay.getStatus : nullStatus);
  const rawApi = useStation(adapter, { stageDelayMs: STAGE_MS, sessionId: link.mode === "relay" ? link.sessionId : "local" });
  // Read-only window (another station window holds the relay lease): no decisions, no resends here.
  const readOnly = !!relayStatus && relayStatus.lease !== "holder";
  const api = readOnly ? { ...rawApi, review: () => READ_ONLY, resend: () => READ_ONLY } : rawApi;
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
                {"未连接真实 Trigger / HUD · 本地模拟"}
              </span>
            )}
            <span className="text-[12px] text-[var(--mg-dim)]">{`当前身份：${REVIEWER}（演示）`}</span>
            <span className="rounded border border-[var(--mg-line)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--mg-faint)]" title="构建标识：服务启动 / 构建时的提交与时间" data-testid="build-id">
              {`构建 ${BUILD}`}
            </span>
            <button type="button" onClick={() => setDrawerMode((d) => (d === "open" ? "hidden" : "open"))} aria-expanded={drawer === "open"} className="rounded-full border border-dashed border-[#d678ff] px-3 py-1 text-[12px] text-[#e3a6ff]" data-testid="demo-toggle">
              {relay ? (drawer === "open" ? "隐藏开发入口" : "开发入口（模拟 Trigger）") : drawer === "open" ? "隐藏本地模拟演示" : "本地模拟演示"}
            </button>
          </div>
        </header>
        {relay ? (
          <p className="border-b border-[var(--mg-line)] bg-[rgba(214,120,255,0.08)] px-5 py-1.5 text-[12px] text-[#e3a6ff]" data-testid="integration-banner">
            {"双端联调：HUD 为真实页面，经通信服务收发；观测仍由基站开发入口模拟注入（真实 Trigger 未接入），不是三端联调。自动模拟 HUD 反馈已关闭。"}
          </p>
        ) : null}

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
              <p className="text-[14px] text-[var(--mg-dim)]">
                {relay
                  ? relayStatus?.conn === "online"
                    ? "已连接通信服务，等待运行开始：请在 HUD 页面选择一个场景（HUD 以本地设备身份开始运行）。"
                    : `未连接通信服务（${relay.getStatus().baseUrl}）：请先启动 npm run relay，或检查地址与网络。`
                  : "基站还没有收到场景开始与人员信息。Trigger 接入前，可打开“本地模拟演示”，选择模拟宇航员和场景后启动。"}
              </p>
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
              <li>{relay ? `传输：${adapter.label}（本窗口 ${relay.getStatus().clientId}）。“基站已发出”只表示通信服务已接收（带序号），不代表 HUD 已收到；HUD 接收与宇航员确认只来自 HUD 的回传。` : `传输：${adapter.label}。“基站已发出”只表示交给本地模拟通道，不代表 HUD 已收到。`}</li>
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
