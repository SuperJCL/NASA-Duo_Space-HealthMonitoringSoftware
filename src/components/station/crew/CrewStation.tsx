"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MockStationAdapter, type StationAdapter } from "@/lib/station/adapter";
import { resolveLink, type LinkConfig } from "@/lib/station/link-config";
import { RelayStationAdapter, type RelayStatus } from "@/lib/station/relay-adapter";
import { crewCards, notifications } from "@/lib/station/crew";
import { evaRunId, MISSION_CREW, missionPhase, type MissionDef } from "@/lib/station/mission";
import { openCases, type Decision } from "@/lib/station/station";
import { DemoDirector } from "@/lib/station/demo";
import type { CrewMarker } from "@/components/map/MarsMap";
import { DevPanel } from "../DevPanel";
import { useStation } from "../useStation";
import { DemoBar, DemoDrawer } from "./DemoDrawer";
import type { DemoScenario } from "@/lib/station/demo";
import { useNow } from "./motion";
import { HealthOverlay, type OverlayLink } from "./HealthOverlay";
import { RelayDevDrawer } from "./RelayDevDrawer";
import { MissionMapView, type MissionGlassData } from "./MissionMapView";
import { EndEvaDialog, MissionBar, MissionStrip, StartEvaDialog, type StationView } from "./MissionPanels";

/** The mission the station prepares and runs: the existing Mission Glass scenario (loaded on the server). */
export type StationMission = { data: MissionGlassData; def: MissionDef };
const VIEW_KEY = "myomars.station.view";
/** The user's own overlay choice for one run (kept across a refresh of the tab). "health" = overlay open. */
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
const REVIEWER = "Base duty officer";
/** Business pacing of the simulated analysis on this page (display pacing, not an algorithm's duration). */
const STAGE_MS = 2600;
const BUILD = `${process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "unknown"} · ${(process.env.NEXT_PUBLIC_BUILD_TIME ?? "").slice(11, 16)} UTC${process.env.NODE_ENV === "development" ? " · dev mode" : ""}`;
/**
 * Offset of the SIMULATED crew position from the task target (Mars degrees, ≈ 90 m east):
 * a documented demo assumption (the astronaut works near the target). There is no position source.
 */
const CREW_OFFSET: readonly [number, number] = [0.0015, 0.0001];

const readLink = () => JSON.stringify(resolveLink(window.location.search, window.location, process.env.NEXT_PUBLIC_MYOMARS_RELAY));
const CONN_TEXT: Record<RelayStatus["conn"], string> = { connecting: "connecting…", online: "online", reconnecting: "disconnected, reconnecting…", offline: "offline" };
const CONN_TONE: Record<RelayStatus["conn"], string> = { connecting: "border-[var(--mg-line-strong)] text-[var(--mg-dim)]", online: "border-[var(--mg-ok)] text-[var(--mg-ok)]", reconnecting: "border-[var(--mg-caution)] text-[var(--mg-caution)]", offline: "border-[#ff6b6b] text-[#ff8f8f]" };
const CONN_OVERLAY: Record<RelayStatus["conn"], OverlayLink["tone"]> = { connecting: "neutral", online: "ok", reconnecting: "caution", offline: "alert" };
const noStatus = () => () => {};
const nullStatus = () => null;
const READ_ONLY = "Read-only window: another base window handles this session. Use that window.";
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
 * MyoMars Mars Base: the Mission Map is always the background; Health Monitoring is an overlay on
 * it (open / collapsed). Rendering only: the rules live in src/lib/station/ (state machine,
 * analysis, flow, crew, comms); every input travels through the adapter — the local mock
 * (standalone demo, default) or the local relay (`?relay=…`, integration).
 */
export function CrewStation({ mission = null }: { mission?: StationMission | null }) {
  // Resolved on the client only (the server renders a neutral shell), so the adapter is created once.
  const linkJson = useSyncExternalStore(noop, readLink, () => null);
  if (!linkJson) return <div lang="en" className="mission-glass min-h-dvh" data-testid="crew-station-loading" />;
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

  // Overlay working state, kept while the overlay is collapsed or another person is shown.
  const [openId, setOpenId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reviewing, setReviewingMap] = useState<Record<string, Decision>>({});
  const [fullFlow, setFullFlow] = useState(false);
  const [drawer, setDrawerMode] = useState<"hidden" | "open" | "bar">("hidden");
  const toggleRef = useRef<HTMLButtonElement>(null);

  // ---- mission context: task preparation on the map; Health Monitoring overlay during the EVA ----
  const def = mission?.def ?? null;
  const phase = missionPhase(state);
  const runKey = state.run?.runId ?? "none";
  const [userView, setUserView] = useState(readStoredView);
  // Default: collapsed while preparing; opened ONCE per run when the EVA runs. The user's own choice for
  // the current run wins afterwards (never re-opened automatically). The standalone demo (no relay)
  // opens it by default. Before the relay history arrived, nothing is known.
  const historyPending = !!relayStatus && relayStatus.conn !== "online" && state.cursor === 0 && !state.run;
  const autoView: StationView = !mission || mock || historyPending ? "health" : phase === "preparing" || phase === "starting" ? "map" : "health";
  const view: StationView = !mission ? "health" : userView && userView.runKey === runKey ? userView.view : autoView;
  const overlayOpen = view === "health";
  const chooseView = (v: StationView) => {
    const u = { runKey, view: v };
    setUserView(u);
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(u));
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  };
  const collapse = () => {
    chooseView("map");
    // Focus returns to the toggle that opens the overlay again (presentation only).
    requestAnimationFrame(() => toggleRef.current?.focus());
  };
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
  // The person shown in the overlay: the one chosen, else the first crew member of the run (stable:
  // a message for someone else only notifies, it never moves the overlay to that person).
  const personId = openId && cards.some((c) => c.astronautId === openId) ? openId : (cards[0]?.astronautId ?? null);
  const personCard = cards.find((c) => c.astronautId === personId) ?? null;
  const chosenCase = personId ? chosen[personId] : undefined;
  const panelCase = personCard ? (chosenCase && state.cases[chosenCase]?.astronautId === personId ? chosenCase : (personCard.event?.caseId ?? null)) : null;

  const selectPerson = (id: string, caseId?: string) => {
    if (caseId) setChosen((m) => ({ ...m, [id]: caseId }));
    setOpenId(id);
  };
  const playExample = (id: string, scenario: DemoScenario) => {
    director.playExample(id, scenario);
    setChosen((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    setOpenId(id);
    chooseView("health");
    setDrawerMode("bar");
  };
  /** From the map, the strip or a marker: open the overlay at that person (and case). An explicit click only. */
  const jump = (id: string, caseId?: string) => {
    selectPerson(id, caseId);
    chooseView("health");
  };

  // Crew at SIMULATED positions (only during an active EVA): near the run's task target, never on it.
  const crewMarkers: CrewMarker[] = [];
  if (mission && phase === "eva-active" && state.run) {
    const target = mission.data.targets.find((t) => t.id === state.run!.task.targetId) ?? mission.data.targets.find((t) => t.taskId === state.run!.task.id);
    if (target)
      for (const c of cards)
        crewMarkers.push({ id: c.astronautId, label: `${c.callsign} · simulated position`, note: `not tracked · near ${target.name}`, position: [target.position[0] + CREW_OFFSET[0], target.position[1] + CREW_OFFSET[1]], attention: c.needsBase > 0 });
  }

  const linkInfo: OverlayLink = relayStatus
    ? { text: `Relay: ${CONN_TEXT[relayStatus.conn]}`, tone: CONN_OVERLAY[relayStatus.conn], title: `${adapter.label}${relayStatus.lastError ? ` · ${relayStatus.lastError}` : ""}` }
    : { text: "Local simulation (no real HUD)", tone: "neutral", title: adapter.label };

  const empty = (
    <section className="flex flex-col items-start gap-2" data-testid="crew-empty">
      <p className="text-[18px] font-semibold">{relay ? "No EVA started" : "No scenario started"}</p>
      <p className="max-w-2xl text-[14px] text-[var(--mg-dim)]">
        {relay
          ? relayStatus?.conn === "online"
            ? "On the Mission Map, select a task and the astronaut, review the mission summary and confirm Start EVA. The crew of that EVA then appears here."
            : `Not connected to the relay (${relay.getStatus().baseUrl}): start it with npm run relay, or check the address and network.`
          : "The base has not received a scenario start or crew data yet. Open the local simulated demo, choose a simulated astronaut and a scenario, then start it."}
      </p>
      {relay ? (
        mission ? (
          <button type="button" onClick={collapse} className="rounded-lg border border-[var(--mg-line-strong)] px-3 py-1.5 text-[13px]" data-testid="go-map">
            {"Back to the Mission Map"}
          </button>
        ) : null
      ) : (
        <button type="button" onClick={() => setDrawerMode("open")} className="rounded-lg border border-dashed border-[#d678ff] px-3 py-1.5 text-[13px] text-[#e3a6ff]">
          {"Open the local simulated demo"}
        </button>
      )}
    </section>
  );
  const footnotes = (
    <details className="mt-auto rounded-xl border border-[var(--mg-line)] bg-[var(--mg-bg)] px-3 py-2 text-[12px] text-[var(--mg-faint)]" data-testid="tech-notes">
      <summary className="cursor-pointer">{"Technical notes"}</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>{"All data and analysis are simulated; the analysis is deterministic rules, no model is called, and it makes no diagnosis, treatment or automatic task restriction."}</li>
        <li>{"Crew roster, device connection and astronaut reports are local simulated extensions (myomars/v1-local), not part of shared contract v1; see docs/myomars/STATION-LOCAL-PROPOSALS.md."}</li>
        <li>
          {relay
            ? `Transport: ${adapter.label} (this window ${relay.getStatus().clientId}). "Relay accepted" only means the relay stored the message (with a sequence number), not that the HUD received it; Received by HUD and Acknowledged by Crew come only from the HUD's replies.`
            : `Transport: ${adapter.label}. "Sent" only means handed to the local simulated channel, not received by a HUD.`}
        </li>
        <li>{"The crew marker on the map is a simulated position near the task target: there is no live position source."}</li>
        <li>{"The Mission Map reuses Mission Glass (2D map, 3D terrain, tasks, planning, EVA route and steps); the standalone page stays at /legacy/mission-glass, the research workspace at /research."}</li>
      </ul>
    </details>
  );

  const overlay = (
    <HealthOverlay
      open={overlayOpen}
      collapsible={!!mission}
      state={state}
      api={api}
      mock={mock}
      def={def}
      phase={phase}
      link={linkInfo}
      cards={cards}
      notes={notes}
      personId={personId}
      caseId={panelCase}
      onSelectPerson={selectPerson}
      onSelectCase={(caseId) => personId && setChosen((m) => ({ ...m, [personId]: caseId }))}
      onCollapse={collapse}
      drafts={drafts}
      setDraft={(k, v) => setDrafts((d) => ({ ...d, [k]: v }))}
      reviewing={reviewing}
      setReviewing={(caseId, d) =>
        setReviewingMap((m) => {
          const next = { ...m };
          if (d) next[caseId] = d;
          else delete next[caseId];
          return next;
        })
      }
      fullFlow={fullFlow}
      setFullFlow={setFullFlow}
      reviewer={REVIEWER}
      empty={empty}
      footnotes={footnotes}
    />
  );

  return (
    <div lang="en" className="mission-glass flex h-dvh flex-col overflow-hidden" data-testid="crew-station" data-link-mode={adapter.mode} data-view={view} data-overlay={overlayOpen ? "open" : "collapsed"} data-phase={phase}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-[var(--mg-line)] px-5 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">{"MyoMars"}</span>
          <span className="text-sm text-[var(--mg-dim)]">{"Mars Base"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-[var(--mg-coral)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--mg-coral)]" data-testid="station-sim-pill">
            {"Simulated Data · Simulated Analysis"}
          </span>
          {relayStatus ? (
            <>
              <span className={`rounded-full border px-2.5 py-0.5 text-[12px] ${CONN_TONE[relayStatus.conn]}`} title={`${adapter.label}${relayStatus.lastError ? ` · ${relayStatus.lastError}` : ""}`} data-testid="station-link" data-conn={relayStatus.conn}>
                {`Relay ${CONN_TEXT[relayStatus.conn]} · session ${relayStatus.sessionId}`}
              </span>
              <span className={`rounded-full border px-2.5 py-0.5 text-[12px] ${readOnly ? "border-[var(--mg-caution)] text-[var(--mg-caution)]" : "border-[var(--mg-line-strong)] text-[var(--mg-dim)]"}`} title={`Signed in as ${REVIEWER} (demo identity)`} data-testid="station-lease" data-lease={relayStatus.lease}>
                {relayStatus.lease === "holder" ? `${REVIEWER} · this window decides` : relayStatus.lease === "readonly" ? "Read-only: another base window decides" : "Checking which window decides…"}
              </span>
            </>
          ) : (
            <span className="rounded-full border border-[var(--mg-line-strong)] px-2.5 py-0.5 text-[12px] text-[var(--mg-dim)]" title={`${adapter.label} · signed in as ${REVIEWER} (demo)`} data-testid="station-link">
              {"Local simulation · no real HUD or data source"}
            </span>
          )}
          <span className="rounded border border-[var(--mg-line)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--mg-faint)]" title="Build id: commit and time of the server start / build" data-testid="build-id">
            {`Build ${BUILD}`}
          </span>
          <button type="button" onClick={() => setDrawerMode((d) => (d === "open" ? "hidden" : "open"))} aria-expanded={drawer === "open"} className="rounded-full border border-dashed border-[#d678ff] px-2.5 py-0.5 text-[12px] text-[#e3a6ff]" data-testid="demo-toggle">
            {relay ? (drawer === "open" ? "Hide dev entry" : "Dev entry (data replay)") : drawer === "open" ? "Hide local demo" : "Local simulated demo"}
          </button>
        </div>
      </header>
      {relay ? (
        <p className="border-b border-[var(--mg-line)] bg-[rgba(214,120,255,0.08)] px-5 py-0.5 text-[12px] text-[#e3a6ff]" data-testid="integration-banner">
          {"Two-end run: the HUD is the real page, connected through the local relay · observations are simulated samples from the data replay, not teammate health data · no auto-simulated HUD feedback"}
        </p>
      ) : null}
      {mission ? <MissionBar def={def} state={state} phase={phase} view={view} onView={(v) => (v === "map" ? collapse() : chooseView(v))} cards={cards} onJump={jump} onEndEva={() => (setDialogError(null), setDialog("end"))} canAct={canAct} toggleRef={toggleRef} /> : null}

      {/* Room for the compact demo bar (standalone demo) so it never covers the decision area. */}
      <div className={`relative flex min-h-0 flex-1 flex-col ${!relay && drawer === "bar" ? "pb-12" : ""}`}>
        {mission ? (
          // The map is always the mission background. While the overlay is open it is inert (no click-through).
          <div inert={overlayOpen} className="flex min-h-0 flex-1 flex-col" data-testid="map-view">
            <MissionStrip def={def} state={state} phase={phase} selectedTask={selectedTask} astronautId={astronautId} setAstronautId={setAstronautId} onSummary={() => (setDialogError(null), setDialog("start"))} onJump={jump} onOpenPerson={(id) => jump(id)} cards={cards} canAct={canAct} mode={relay ? "relay" : "mock"} openCount={openCount} onResendStart={(id) => api.resend(id)} />
            <div className="relative flex min-h-0 flex-1 flex-col">
              <MissionMapView data={mission.data} onSelectTask={setMgTaskId} activeTaskId={state.run?.task.id ?? null} crewMarkers={crewMarkers} onSelectCrew={(id) => jump(id)} />
            </div>
          </div>
        ) : null}
        {overlay}
      </div>

      {dialog === "start" && def && selectedTask ? <StartEvaDialog def={def} task={selectedTask} astronautId={astronautId} onConfirm={confirmStart} onCancel={() => setDialog(null)} error={dialogError} /> : null}
      {dialog === "end" ? <EndEvaDialog openCount={openCount} onConfirm={confirmEnd} onCancel={() => setDialog(null)} error={dialogError} /> : null}
      {relay && drawer === "open" ? (
        <RelayDevDrawer
          relay={relay}
          state={state}
          onOpenPerson={(id) => {
            setChosen((m) => {
              const next = { ...m };
              delete next[id];
              return next;
            });
            jump(id);
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
            requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="demo-toggle"]')?.focus());
          }}
        />
      ) : null}
      {dev && mockAdapter ? <DevPanel adapter={mockAdapter} state={state} caseId={panelCase ?? cards.find((c) => c.event)?.event?.caseId ?? null} /> : null}
    </div>
  );
}
