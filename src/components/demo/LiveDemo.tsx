"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CrewStation, type StationMission } from "@/components/station/crew/CrewStation";
import { activeRunOf, createBrowserRelay, type BrowserRelay } from "@/lib/demo/browser-relay";
import { connectHudFrame } from "@/lib/demo/hud-bridge";
import { intakeCheck, observationEnvelope, sampleById } from "@/lib/replay/replay";

type View = "base" | "hud";
/** Messages that ask something of the other view (badges only; nothing is switched automatically). */
const FOR_HUD = new Set(["station.notice.approved", "station.retest.requested", "station.reassessment"]);
const FOR_BASE = new Set(["observation.submitted", "hud.ack", "hud.defer", "retest.completed", "retest.result"]);
const noop = () => () => {};
const HUD_SRC = "/hud/hud.html?mode=integration&link=parent&session=";
const SAMPLE_ID = "change";

/**
 * Online single-page demo: Mars Base and Astronaut HUD in one tab, exchanging messages through an
 * in-browser bus (no relay process, no server session). Client only: the bus and the session are
 * created in the visitor's browser.
 */
export function LiveDemo({ mission }: { mission: StationMission }) {
  const client = useSyncExternalStore(noop, () => true, () => false);
  if (!client) return <div className="mission-glass h-dvh" data-testid="live-demo-loading" />;
  return <LiveDemoClient mission={mission} />;
}

function LiveDemoClient({ mission }: { mission: StationMission }) {
  const [bus] = useState<BrowserRelay>(() => createBrowserRelay());
  const [sid, setSid] = useState(() => bus.newSessionId());
  const [view, setView] = useState<View>("base");
  const [seenAt, setSeenAt] = useState<Record<View, number>>({ base: 0, hud: 0 });
  const [hudMounted, setHudMounted] = useState(false);
  const [hudLinked, setHudLinked] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [round, setRound] = useState(1);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const controlsRef = useRef<HTMLDetailsElement>(null);
  const closeControls = () => {
    if (controlsRef.current) controlsRef.current.open = false;
  };

  // Delivered sequence of this session (re-renders the badges when something arrives).
  const lastSeq = useSyncExternalStore(
    (cb) => bus.core.subscribe(sid, 0, () => cb()),
    () => bus.core.history(sid, 0).lastSeq,
    () => 0,
  );
  const events = useMemo(() => (lastSeq >= 0 ? bus.core.history(sid, 0).events : []), [bus, sid, lastSeq]);
  const pending = (v: View) => (v === view ? 0 : events.filter((e) => e.seq > seenAt[v] && (v === "hud" ? e.sender.role === "station" && FOR_HUD.has(e.type) : FOR_BASE.has(e.type))).length);
  const run = useMemo(() => (lastSeq >= 0 ? activeRunOf(bus.core, sid) : null), [bus, sid, lastSeq]);

  // The HUD page loads shortly after the Base (its 3D scene is built on the main thread), or at once
  // when the HUD tab is opened. It is the HUD "device": it acknowledges receipt of what it received.
  useEffect(() => {
    const t = setTimeout(() => setHudMounted(true), 1200);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const f = frameRef.current;
    if (!hudMounted || !f) return;
    return connectHudFrame({ frame: f, sessionId: sid, fetchImpl: bus.fetch, onLinked: () => setHudLinked(sid) });
  }, [bus, sid, hudMounted]);

  // The status note clears itself (it never blocks anything).
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 10_000);
    return () => clearTimeout(t);
  }, [note]);

  // Read-only handle for automated checks (events of the current session only; nothing writable).
  useEffect(() => {
    (window as unknown as { __myomarsDemo?: unknown }).__myomarsDemo = { sessionId: sid, events: () => bus.core.history(sid, 0).events.map((e) => ({ seq: e.seq, eventId: e.eventId, runId: e.runId, type: e.type, role: e.sender.role, caseId: (e as { caseId?: string }).caseId ?? null })) };
  }, [bus, sid]);

  const show = (v: View) => {
    if (v === "hud") setHudMounted(true);
    setSeenAt((s) => ({ ...s, [view]: lastSeq, [v]: lastSeq }));
    setView(v);
  };
  const loadSample = () => {
    closeControls();
    const sample = sampleById(SAMPLE_ID);
    if (!sample || !run) return setNote("Start the EVA on the Mars Base first (select a task, Review summary, Confirm Start EVA).");
    if (!intakeCheck(sample, run, "").publishable) return setNote("This sample cannot be loaded for the current run.");
    const r = bus.core.publish(sid, observationEnvelope(sid, run, sample, Date.now()), "trigger", "demo-controls-replay");
    setNote(r.status === 200 ? `Loaded "${sample.label}" (simulated sample). The Base analyses it and stops at Awaiting Base Review.` : `Not loaded: ${String(r.body.error ?? r.status)}`);
    show("base");
  };
  const reset = () => {
    closeControls();
    const old = sid;
    setSid(bus.newSessionId());
    setSeenAt({ base: 0, hud: 0 });
    setView("base");
    setHudLinked(null);
    setNote("Demo reset: a new, empty session for both views.");
    setRound((n) => n + 1);
    // The old Base and HUD are unmounted (their timers and streams stop); forget the old session after
    // the station's delayed lease release has run.
    setTimeout(() => bus.core.drop(old), 3000);
  };

  const hudBadge = pending("hud");
  const baseBadge = pending("base");
  const tab = (v: View, label: string, badge: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === v}
      onClick={() => show(v)}
      className={`relative min-h-9 rounded-lg px-4 text-[14px] font-semibold transition-colors duration-150 ${view === v ? "bg-[var(--mm-surface-2)] text-[var(--mm-text)] outline outline-1 outline-[var(--mm-data)]" : "text-[var(--mm-dim)] hover:text-[var(--mm-text)]"}`}
      data-testid={`demo-tab-${v}`}
      data-badge={badge}
    >
      {label}
      {badge ? (
        <span className="ml-2 rounded-full bg-[var(--mm-action)] px-2 py-0.5 text-[11px] font-bold text-[var(--mm-action-ink)]" aria-label={`${badge} new for this view`} data-testid={`demo-badge-${v}`}>
          {`${badge} new`}
        </span>
      ) : null}
    </button>
  );

  return (
    <div lang="en" className="mission-glass flex h-dvh flex-col overflow-hidden" data-testid="live-demo" data-view={view} data-session={sid} data-hud-linked={hudLinked === sid ? "1" : "0"} data-round={round}>
      <header className="relative z-[80] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--mm-line-strong)] bg-[var(--mm-bg)] px-4 py-1.5">
        <span className="text-[15px] font-semibold tracking-tight">{"MyoMars · Live demo"}</span>
        <span className="rounded-full border border-dashed border-[var(--mm-sim)] px-2.5 py-0.5 text-[12px] text-[var(--mm-sim)]" data-testid="demo-label-browser">
          {"Browser-based demo"}
        </span>
        <span className="rounded-full border border-[var(--mm-action)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--mm-action)]" data-testid="demo-label-sim">
          {"Simulated data / Simulated analysis"}
        </span>
        <div role="tablist" aria-label="Demo view" className="mx-auto flex items-center gap-1 rounded-xl border border-[var(--mm-line)] p-1">
          {tab("base", "Mars Base", baseBadge)}
          {tab("hud", "Astronaut HUD", hudBadge)}
        </div>
        <details ref={controlsRef} className="relative" data-testid="demo-controls">
          <summary className="min-h-8 cursor-pointer list-none rounded-lg border border-[var(--mm-line-strong)] px-3 py-1 text-[13px] font-semibold marker:hidden">{"Demo controls ▾"}</summary>
          <div className="absolute right-0 top-10 w-[25rem] rounded-xl border border-[var(--mm-line-strong)] bg-[var(--mm-glass-strong)] p-4 text-[13px] shadow-2xl backdrop-blur">
            <p className="font-semibold">{"Simulated sample"}</p>
            <p className="mt-0.5 text-[12px] text-[var(--mm-dim)]">{"Sends one stored simulated measurement as the data producer (the same data replay the Base's dev entry uses). Available once an EVA is running."}</p>
            <button type="button" onClick={loadSample} disabled={!run} className="mt-2 min-h-9 w-full rounded-lg bg-[var(--mm-action)] px-3 font-semibold text-[var(--mm-action-ink)] disabled:opacity-40" data-testid="demo-load-sample">
              {"Load sample: Comparable change"}
            </button>
            <p className="mt-3 font-semibold">{"Walkthrough"}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[12px] text-[var(--mm-dim)]">
              <li>{"Mars Base: select a task, Review summary, Confirm Start EVA."}</li>
              <li>{"Load sample: Comparable change. The Base analyses it and stops at review."}</li>
              <li>{"Approve the retest with a reason (always a human decision)."}</li>
              <li>{"Astronaut HUD: Enter HUD, Acknowledge, View task, Start, Submit."}</li>
              <li>{"Mars Base: see the re-evaluation, then Close case."}</li>
              <li>{"Astronaut HUD: the closing notice and the task history."}</li>
            </ol>
            <button type="button" onClick={reset} className="mt-3 min-h-9 w-full rounded-lg border border-[var(--mm-line-strong)] px-3 font-semibold" data-testid="demo-reset">
              {"Reset demo"}
            </button>
            <p className="mt-2 text-[11px] text-[var(--mm-faint)]">{"Both views share one session in this browser tab. Reset demo or reloading the page starts a new, empty session; nothing is stored on a server."}</p>
          </div>
        </details>
        {note ? (
          <p className="basis-full text-[12px] text-[var(--mm-dim)]" role="status" data-testid="demo-note">
            {note}
          </p>
        ) : null}
      </header>
      <div className="relative min-h-0 flex-1">
        {/* Base: kept laid out (map and terrain keep their size); hidden and inert while the HUD is shown. */}
        <div className={`absolute inset-0 ${view === "base" ? "" : "invisible"}`} inert={view !== "base"} aria-hidden={view !== "base"} data-testid="demo-view-base">
          <CrewStation key={sid} mission={mission} demoLink={{ sessionId: sid, fetchImpl: bus.fetch }} fill />
        </div>
        {/* HUD: the existing HUD page, same origin. display:none while hidden pauses its 3D scene. */}
        {hudMounted ? (
          <iframe
            key={sid}
            ref={frameRef}
            src={`${HUD_SRC}${encodeURIComponent(sid)}`}
            title="Astronaut HUD"
            className="absolute inset-0 h-full w-full border-0"
            style={{ display: view === "hud" ? "block" : "none" }}
            data-testid="demo-view-hud"
          />
        ) : null}
      </div>
    </div>
  );
}
