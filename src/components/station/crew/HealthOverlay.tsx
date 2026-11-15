"use client";

// Health Monitoring overlay over the Mission Map. The map stays the mission background; this overlay
// shows ONE crew member at a time: observation, indicators, a compact analysis chain, recent
// communications (left) and a fixed decision area (right). Collapsing it changes nothing in the
// flow: analysis, communication and receipts keep running; selected case, drafts and an open review
// form are kept by the station shell. Rendering only — every state comes from src/lib/station/.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { commStream } from "@/lib/station/comms";
import { unreadEntries, type CrewCardView, type Notice } from "@/lib/station/crew";
import { buildFlow, hhmmss, type FlowNode, type FlowView } from "@/lib/station/flow";
import { allowedDecisions, latest, type Case, type Decision, type OutMessage, type StationState } from "@/lib/station/station";
import { alertNote, caseStatus, evaluationStatus, keyBasis, type Tone } from "@/lib/station/views";
import { PHASE_LABEL, runTask, type MissionDef, type MissionPhase } from "@/lib/station/mission";
import type { StationApi } from "../useStation";
import { duration, elapsed, prefersReducedMotion, useNow, useOnceAnimation, usePageVisible } from "./motion";
import { CanvasSection, CommList, CONDITIONS, DECIDED, DECISION_WORD, IndicatorChart, NodeDetail, outgoingFor, primaryLabel, ReviewForm, STATE_ICON } from "./FlowParts";

export const TONE_TEXT: Record<Tone, string> = { alert: "text-[#ff9f8a]", caution: "text-[var(--mg-caution)]", ok: "text-[var(--mg-ok)]", neutral: "text-[var(--mg-dim)]" };
export const TONE_BORDER: Record<Tone, string> = { alert: "border-[var(--mg-coral)]", caution: "border-[var(--mg-caution)]", ok: "border-[var(--mg-ok)]", neutral: "border-[var(--mg-line-strong)]" };

export type OverlayLink = { text: string; tone: Tone; title: string };

type Props = {
  open: boolean;
  /** False when there is no map behind (no mission): the overlay is then the whole station view. */
  collapsible: boolean;
  state: StationState;
  api: StationApi;
  mock: boolean;
  def: MissionDef | null;
  phase: MissionPhase;
  link: OverlayLink;
  cards: CrewCardView[];
  notes: Notice[];
  personId: string | null;
  caseId: string | null;
  onSelectPerson: (astronautId: string, caseId?: string) => void;
  onSelectCase: (caseId: string) => void;
  onCollapse: () => void;
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  reviewing: Record<string, Decision>;
  setReviewing: (caseId: string, decision: Decision | null) => void;
  fullFlow: boolean;
  setFullFlow: (v: boolean) => void;
  reviewer: string;
  /** Shown instead of the body when no crew member is known yet (no EVA started). */
  empty: ReactNode;
  /** Technical notes (secondary). */
  footnotes: ReactNode;
};

const DEVICE = { connected: { dot: "bg-[var(--mg-ok)]", text: "Device connected" }, disconnected: { dot: "bg-[#ff6b6b]", text: "Device disconnected" }, unknown: { dot: "bg-[var(--mg-faint)]", text: "Device status unknown" } } as const;

export function HealthOverlay(p: Props) {
  const { state, mock, open } = p;
  const now = useNow();
  const visible = usePageVisible();
  const card = p.cards.find((x) => x.astronautId === p.personId) ?? null;
  const c = p.caseId ? (state.cases[p.caseId] ?? null) : null;
  const flow = c ? buildFlow(state, c, { mock }) : null;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Mark the shown case as viewed (only while the overlay is open and the page visible). Never an acknowledgement or a close.
  const unread = c ? unreadEntries(state, c).length : 0;
  const caseId = c?.caseId ?? null;
  const { view } = p.api;
  useEffect(() => {
    if (open && caseId && visible && unread > 0) view(caseId);
  }, [open, caseId, visible, unread, view]);
  // Focus moves into the overlay when it opens (the shell returns it to the toggle on collapse).
  useEffect(() => {
    if (open) headingRef.current?.focus({ preventScroll: true });
  }, [open]);
  // Esc only collapses the overlay (it never closes a case, ends the EVA or cancels a review).
  const { onCollapse, collapsible } = p;
  useEffect(() => {
    if (!open || !collapsible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onCollapse();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, collapsible, onCollapse]);

  const run = state.run;
  const task = runTask(p.def, state);
  const others = p.notes.filter((n) => n.astronautId !== p.personId);
  const onDecide = (d: Decision) => c && p.setReviewing(c.caseId, d);

  return (
    <div hidden={!open} className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(5,9,16,0.42)] p-2 sm:p-3" data-testid="overlay-backdrop">
      <section
        role="region"
        aria-labelledby="health-overlay-title"
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[var(--mg-line-strong)] bg-[rgba(14,21,32,0.66)] shadow-2xl backdrop-blur-md ${collapsible ? "lg:h-[min(80dvh,100%)] lg:w-[min(85vw,100%)]" : ""}`}
        data-testid="health-overlay"
        data-astronaut={p.personId ?? ""}
        data-case={caseId ?? ""}
        data-full-flow={p.fullFlow ? "yes" : "no"}
      >
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--mg-line)] px-4 py-2.5">
          <div className="min-w-0">
            <h2 id="health-overlay-title" ref={headingRef} tabIndex={-1} className="text-[17px] font-semibold outline-none">
              {"Health Monitoring"}
            </h2>
            <p className="text-[12px] text-[var(--mg-dim)]" data-testid="overlay-mission">
              {run ? `${run.task.title}${task ? ` → ${task.targetName}` : ""} · ${PHASE_LABEL[p.phase]} · EVA time ${duration(card?.evaStartedAt ?? run.startedAt, now)}` : "No EVA running"}
            </p>
          </div>
          {p.cards.length ? (
            <nav aria-label="Crew on this EVA" className="flex flex-wrap items-center gap-1.5" data-testid="overlay-crew">
              {p.cards.map((x) => (
                <CrewChip key={x.astronautId} card={x} selected={x.astronautId === p.personId} onSelect={() => p.onSelectPerson(x.astronautId)} />
              ))}
            </nav>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2 text-[12px]">
            {others.length ? (
              <div role="status" aria-live="polite" className="flex flex-wrap gap-1.5" data-testid="panel-other-notices">
                {others.slice(0, 2).map((n) => (
                  <button key={n.astronautId} type="button" onClick={() => p.onSelectPerson(n.astronautId, n.caseId)} className="flex items-center gap-1.5 rounded-full border border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] px-2.5 py-0.5" data-testid={`panel-notice-${n.astronautId}`}>
                    <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--mg-coral)]" />
                    <b>{n.callsign}</b>
                    <span>{n.text}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <span className={`rounded-full border px-2.5 py-0.5 ${TONE_BORDER[p.link.tone]} ${TONE_TEXT[p.link.tone]}`} title={p.link.title} data-testid="overlay-link">
              {p.link.text}
            </span>
            {card ? (
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--mg-line)] px-2.5 py-0.5 text-[var(--mg-dim)]" title={card.connection.text} data-testid="panel-connection" data-connection={card.connection.state}>
                <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${DEVICE[card.connection.state].dot}`} />
                {DEVICE[card.connection.state].text}
              </span>
            ) : null}
            <span className="rounded-full border border-[var(--mg-coral)] px-2.5 py-0.5 font-semibold text-[var(--mg-coral)]">{"Simulated Data · Simulated Analysis"}</span>
            {collapsible ? (
              <button type="button" onClick={p.onCollapse} className="min-h-9 rounded-lg border border-[var(--mg-line-strong)] bg-[var(--mg-bg)] px-3 text-[13px]" data-testid="panel-close" title="Collapse to the Mission Map. The case, drafts and communication are kept; nothing is closed or ended.">
                {"Collapse (Esc)"}
              </button>
            ) : null}
          </div>
        </header>

        {!card ? (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-[var(--mg-bg)] p-5" data-testid="overlay-empty">
            {p.empty}
            {p.footnotes}
          </div>
        ) : (
          <div className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden ${p.fullFlow && c ? "" : "lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]"}`}>
            <div className="order-2 flex min-h-0 flex-col gap-3 p-3 lg:order-1 lg:overflow-y-auto" data-testid="overlay-left">
              {card.cases.length > 1 ? (
                <nav aria-label="Cases of this crew member" className="flex flex-wrap gap-1.5" data-testid="panel-case-switch">
                  {card.cases.map((x, i) => (
                    <button key={x.caseId} type="button" aria-pressed={x.caseId === caseId} onClick={() => p.onSelectCase(x.caseId)} className={`rounded-lg border bg-[var(--mg-bg)] px-2 py-1 text-[12px] ${x.caseId === caseId ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)]" : "border-[var(--mg-line)]"}`} data-testid={`panel-case-${x.caseId}`}>
                      {`Case ${i + 1} · ${x.source} · ${x.text}`}
                    </button>
                  ))}
                </nav>
              ) : null}
              {c && flow && p.fullFlow ? (
                <Panel
                  title={`Full flow · ${card.callsign}`}
                  testid="full-flow"
                  aside={
                    <button type="button" onClick={() => p.setFullFlow(false)} className="min-h-8 rounded-lg border border-[var(--mg-line-strong)] px-3 text-[12px]" data-testid="full-flow-back">
                      {"← Back to overview and decision"}
                    </button>
                  }
                >
                  <p className="mb-2 text-[12px] text-[var(--mg-dim)]" data-testid="full-flow-state">
                    {`Now: ${flow.where} · next: ${flow.who === "None" ? "nobody (done)" : flow.who}. Opening the full flow changes nothing: communication continues, the review state is kept and nothing is resent.`}
                  </p>
                  {open ? (
                    <CanvasSection
                      c={c}
                      flow={flow}
                      callsign={card.callsign}
                      now={now}
                      onDecide={(d) => {
                        onDecide(d);
                        p.setFullFlow(false);
                      }}
                      onResend={p.api.resend}
                    />
                  ) : null}
                </Panel>
              ) : c && flow ? (
                <>
                  <ObservationPanel c={c} card={card} />
                  <IndicatorPanel c={c} flow={flow} />
                  <ChainPanel key={`${c.caseId}:v${latest(c).version}`} c={c} flow={flow} now={now} onDecide={onDecide} onResend={p.api.resend} onFull={() => p.setFullFlow(true)} />
                  <Panel title={`Communications (${commStream(state, c, { mock }).length})`} testid="panel-comms" aside={<span className="text-[11px] text-[var(--mg-faint)]">{"Internal analysis is never sent to the HUD"}</span>}>
                    <div className="flex max-h-56 min-h-0 flex-col">
                      <CommList items={commStream(state, c, { mock })} />
                    </div>
                  </Panel>
                </>
              ) : (
                <>
                  <Panel title="Observation" testid="panel-waiting">
                    <p className="text-[13px] text-[var(--mg-dim)]">{`No case for ${card.callsign} yet. When the data replay sends an observation, the simulated analysis starts automatically; nothing is shown before data arrives.`}</p>
                    <p className="mt-1 text-[12px] text-[var(--mg-faint)]">{`Latest data: ${card.data.text} · ${card.data.summary}`}</p>
                  </Panel>
                  <Panel title="Analysis" testid="compact-chain">
                    <ol className="grid grid-cols-5 gap-1.5" data-testid="chain-nodes">
                      {["Data Received", "Signal Quality", "Comparability", "Comparison", "Base Review"].map((label, i) => (
                        <li key={label} className={`rounded-lg border px-2 py-1.5 ${CHAIN_STYLE.todo}`} data-testid={`chain-${i}`} data-state="todo">
                          <p className="text-[12px] font-semibold leading-tight">{`○ ${label}`}</p>
                          <p className="mt-0.5 text-[11px]">{i === 0 ? "Waiting for data…" : "Not reached"}</p>
                        </li>
                      ))}
                    </ol>
                  </Panel>
                </>
              )}
              {p.footnotes}
            </div>
            {p.fullFlow && c ? null : (
            <DecisionPanel
              c={c}
              flow={flow}
              card={card}
              state={state}
              mock={mock}
              now={now}
              reviewing={c ? (p.reviewing[c.caseId] ?? null) : null}
              setReviewing={(d) => c && p.setReviewing(c.caseId, d)}
              draft={(d) => (c ? (p.drafts[`${c.caseId}:${d}`] ?? "") : "")}
              setDraft={(d, v) => c && p.setDraft(`${c.caseId}:${d}`, v)}
              api={p.api}
              reviewer={p.reviewer}
            />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Panel({ title, testid, aside, children }: { title: string; testid: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--mg-line)] bg-[var(--mg-bg)] p-3" aria-label={title} data-testid={testid}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

const CHIP_PULSE: Keyframe[] = [{ boxShadow: "0 0 0 0 rgba(255,128,102,0)" }, { boxShadow: "0 0 0 5px rgba(255,128,102,0.5)" }, { boxShadow: "0 0 0 0 rgba(255,128,102,0)" }];
const CHIP_PULSE_OPTS: KeyframeAnimationOptions = { duration: 1200, easing: "ease-out" };

/** One crew member of the run (the real crew list only). A new message pulses once; it never takes focus. */
function CrewChip({ card, selected, onSelect }: { card: CrewCardView; selected: boolean; onSelect: () => void }) {
  const ref = useOnceAnimation<HTMLButtonElement>(card.latestInbound?.eventId ?? null, CHIP_PULSE, CHIP_PULSE_OPTS);
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      aria-label={`${card.callsign}: ${card.event ? card.event.text : "no case"}${card.unread ? `, ${card.unread} unread` : ""}`}
      className={`flex items-center gap-2 rounded-xl border px-2.5 py-1 text-[12px] ${selected ? "border-[var(--mg-cyan)] bg-[var(--mg-cyan-soft)]" : "border-[var(--mg-line)] bg-[var(--mg-bg)]"}`}
      data-crew-card={card.astronautId}
      data-testid={`crew-card-${card.astronautId}`}
      data-unread={card.unread}
      data-needs-base={card.needsBase > 0 ? "yes" : "no"}
    >
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${DEVICE[card.connection.state].dot}`} />
      <b className="text-[13px]">{card.callsign}</b>
      {card.needsBase ? <span className="rounded-full bg-[var(--mg-coral)] px-1.5 text-[11px] font-semibold text-[#1a0f0c]">{`${card.needsBase} to review`}</span> : <span className="text-[var(--mg-dim)]">{card.openCases ? `${card.openCases} open` : "no open case"}</span>}
      {card.unread && !selected ? <span className="text-[11px] text-[var(--mg-coral)]" data-testid="crew-card-unread">{`${card.unread} new`}</span> : null}
    </button>
  );
}

/** The observation behind the case: one simulated sample (or the astronaut's report). No invented history. */
function ObservationPanel({ c, card }: { c: Case; card: CrewCardView }) {
  const measured = c.evaluations.filter((e) => e.observation);
  const ev = measured.at(-1);
  const report = c.evaluations.find((e) => e.trigger === "report")?.report ?? null;
  const o = ev?.observation;
  return (
    <Panel title="Observation" testid="obs-summary" aside={<span className="rounded-full border border-dashed border-[var(--mg-caution)] px-2 py-0.5 text-[11px] text-[var(--mg-caution)]">{"Simulated sample · data replay"}</span>}>
      {o && ev ? (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-[var(--mg-faint)]">{"Data time"}</dt>
          <dd data-testid="obs-time">{`${hhmmss(o.capturedAt)}${ev.trigger === "retest" ? " · retest" : ""}`}</dd>
          <dt className="text-[var(--mg-faint)]">{"Protocol"}</dt>
          <dd>{`${o.protocol.label} · ${o.protocol.targetPctMvc}% MVC · ${o.protocol.posture} · ${o.protocol.glove === "eva-glove" ? "EVA glove" : "no glove"}`}</dd>
          <dt className="text-[var(--mg-faint)]">{"Data"}</dt>
          <dd>{card.data.text}</dd>
          <dt className="text-[var(--mg-faint)]">{"History"}</dt>
          <dd className="text-[var(--mg-dim)]" data-testid="obs-history">
            {measured.length === 1 ? "Single observation · no earlier data, no trend" : `${measured.length} observations in this case: ${measured.map((e) => `v${e.version} ${e.trigger === "retest" ? "retest" : "measurement"}`).join(", ")}`}
          </dd>
        </dl>
      ) : report ? (
        <p className="text-[13px]">{`Astronaut report: "${report.text}"${report.request ? ` · request: ${report.request}` : ""}`}</p>
      ) : (
        <p className="text-[13px] text-[var(--mg-dim)]">{"No measurement in this case."}</p>
      )}
    </Panel>
  );
}

/** Summary indicators of the latest measured round against the individual baseline (v1 → v2 only when both are comparable). */
function IndicatorPanel({ c, flow }: { c: Case; flow: FlowView }) {
  const ev = c.evaluations.filter((e) => e.observation).at(-1);
  if (!ev) return null;
  const features = flow.rows.find((r) => r.id === `v${ev.version}:analysis`)?.nodes.find((n) => n.id === `v${ev.version}:features`) ?? null;
  const items = features?.indicators ?? [];
  let note: string | null = null;
  if (!items.length) note = !features || features.state === "todo" || features.state === "running" ? "Indicators appear when the Comparison step is reached." : features.state === "skipped" ? "Not compared: an earlier step stopped (no values are shown or invented)." : features.summary;
  return (
    <Panel title="Indicators vs individual baseline" testid="obs-indicators" aside={<span className="text-[11px] text-[var(--mg-faint)]">{"Summary features only"}</span>}>
      {items.length ? <IndicatorChart items={items} compact /> : <p className="text-[12px] text-[var(--mg-dim)]">{note}</p>}
    </Panel>
  );
}

type ChainItem = { id: string; label: string; node: FlowNode | null; state: FlowNode["state"]; summary: string };

/** The five steps of the latest round, from the station's own flow (never ahead of it). */
function chainItems(c: Case, flow: FlowView): ChainItem[] {
  const ev = latest(c);
  const row = flow.rows.find((r) => r.id === `v${ev.version}:analysis`);
  const nodes = row?.nodes ?? [];
  const items: ChainItem[] = nodes.slice(0, 4).map((n) => ({ id: n.id, label: n.label, node: n, state: n.state, summary: n.summary }));
  const pending = flow.current && flow.current.node.state === "human" && !flow.finished && flow.current.node.id.startsWith(`v${ev.version}:pending`) ? flow.current.node : null;
  const decision = c.reviews.filter((r) => r.version === ev.version).at(-1);
  const rec = nodes[4] ?? null;
  if (pending) items.push({ id: "review", label: "Base Review", node: pending, state: "human", summary: pending.label });
  else if (decision) items.push({ id: "review", label: "Base Review", node: rec, state: "done", summary: DECIDED[decision.decision] });
  else items.push({ id: "review", label: "Base Review", node: rec, state: rec && rec.state !== "done" ? rec.state : "todo", summary: rec && rec.state !== "done" ? rec.summary : "Not reached" });
  return items;
}

/** The party a step waits for, inside a sentence. */
const party = (o: FlowNode["owner"]) => ({ "Base staff": "base staff", Crew: "the crew", HUD: "the HUD", System: "the system", "Data source": "the data replay", None: "nobody" })[o];

const CHAIN_STYLE: Record<FlowNode["state"], string> = {
  done: "border-[var(--mg-ok)]/70 text-[var(--mg-text)]",
  running: "border-[var(--mg-cyan)] bg-[var(--mg-cyan-soft)] text-[var(--mg-text)]",
  human: "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] text-[var(--mg-text)]",
  waiting: "border-dashed border-[var(--mg-cyan)] text-[var(--mg-text)]",
  stopped: "border-[var(--mg-caution)] bg-[rgba(241,200,120,0.1)] text-[var(--mg-text)]",
  todo: "border-dashed border-[var(--mg-line)] text-[var(--mg-faint)]",
  skipped: "border-dashed border-[var(--mg-line)] text-[var(--mg-faint)] opacity-60",
};
/** Hops already shown by the data marker (module level: a remount never replays them). */
const hopsShown = new Set<string>();

/**
 * Compact analysis chain: Data Received → Signal Quality → Comparability → Comparison → Base Review.
 * A data marker moves briefly along the path the data actually took, one hop per step the station
 * revealed; it stops at a human or waiting step. No looping, no replay on ordinary updates.
 */
function ChainPanel({ c, flow, now, onDecide, onResend, onFull }: { c: Case; flow: FlowView; now: number; onDecide: (d: Decision) => void; onResend: (eventId: string) => void; onFull: () => void }) {
  const items = chainItems(c, flow);
  const ev = latest(c);
  const reached = items.reduce((at, it, i) => (it.state === "done" || it.state === "stopped" || it.state === "human" || it.state === "waiting" || it.state === "running" ? i : at), -1);
  const stoppedAt = items.findIndex((it) => it.state === "stopped");
  const [open, setOpen] = useState<string | null>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const lastPos = useRef<number | null>(null);
  useEffect(() => {
    const el = markerRef.current;
    const from = lastPos.current;
    lastPos.current = reached;
    const key = `${c.caseId}:v${ev.version}:${reached}`;
    if (!el || reached < 0 || hopsShown.has(key)) return;
    hopsShown.add(key);
    // First render of this round: animate only a fresh arrival (a refresh or reopen shows the state, it does not replay it).
    const start = from === null ? (Date.now() - Date.parse(ev.startedAt) < 4000 ? -1 : null) : from;
    if (start === null || start >= reached || prefersReducedMotion() || typeof el.animate !== "function") return;
    const x = (i: number) => `${((i + 0.5) / items.length) * 100}%`;
    const a = el.animate(
      [
        { left: x(start), opacity: 0 },
        { left: x(start), opacity: 1, offset: 0.1 },
        { left: x(reached), opacity: 1, offset: 0.85 },
        { left: x(reached), opacity: 0 },
      ],
      { duration: Math.min(1400, 520 * (reached - start)), easing: "ease-in-out" },
    );
    return () => a.cancel();
  }, [reached, c.caseId, ev.version, ev.startedAt, items.length]);
  const openItem = items.find((it) => it.id === open) ?? null;
  const current = flow.current;
  const waiting = current && (current.node.state === "waiting" || current.node.state === "human") && !flow.finished ? current.node : null;
  return (
    <Panel
      title={`Analysis · round ${ev.version}${ev.trigger === "retest" ? " (retest)" : ""}`}
      testid="compact-chain"
      aside={
        <button type="button" onClick={onFull} className="min-h-8 rounded-lg border border-[var(--mg-line-strong)] px-3 text-[12px]" data-testid="full-flow-open">
          {"Full flow ⤢"}
        </button>
      }
    >
      <div className="relative">
        <ol className="grid grid-cols-5 gap-1.5" data-testid="chain-nodes">
          {items.map((it, i) => (
            <li key={it.id} className="relative flex min-w-0">
              {i > 0 ? <span aria-hidden className={`absolute -left-1.5 top-5 h-0.5 w-1.5 ${i <= reached && it.state !== "skipped" ? "bg-[var(--mg-cyan)]" : "bg-[var(--mg-line)]"}`} /> : null}
              <button
                type="button"
                onClick={() => setOpen(open === it.id ? null : it.id)}
                aria-expanded={open === it.id}
                aria-current={i === reached && !flow.finished ? "step" : undefined}
                title={it.summary}
                className={`flex w-full min-w-0 flex-col items-start rounded-lg border px-2 py-1.5 text-left ${CHAIN_STYLE[it.state]} ${open === it.id ? "ring-2 ring-[var(--mg-cyan)]" : ""}`}
                data-testid={`chain-${i}`}
                data-state={it.state}
              >
                <span className="text-[12px] font-semibold leading-tight">{`${STATE_ICON[it.state]} ${it.label}`}</span>
                <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug opacity-90" data-testid={`chain-${i}-result`}>
                  {it.summary}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <span ref={markerRef} aria-hidden className="pointer-events-none absolute -top-1 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[var(--mg-cyan)] opacity-0 shadow-[0_0_8px_var(--mg-cyan)]" data-testid="chain-marker" />
      </div>
      {stoppedAt >= 0 ? <p className="mt-1.5 text-[12px] text-[var(--mg-caution)]" data-testid="chain-branch">{`↳ Branch at ${items[stoppedAt].label}: check device / remeasure → Base Review (later steps not run)`}</p> : null}
      {waiting ? (
        <p className="mt-1.5 text-[12px] text-[var(--mg-dim)]" data-testid="chain-waiting">{`Transfer paused · waiting for ${party(waiting.owner)} since ${hhmmss(waiting.since).slice(0, 8)} · ${elapsed(waiting.since, now)}`}</p>
      ) : null}
      {openItem?.node ? <NodeDetail c={c} n={openItem.node} isCurrent={false} now={now} onDecide={onDecide} onResend={onResend} onBack={() => setOpen(null)} /> : null}
    </Panel>
  );
}

const IF_DECIDED: Record<Decision, string> = { approve: "If approved", reject: "If rejected", close: "If the case is closed", "keep-open": "If you choose Continue Monitoring" };

type DecisionPhase = "idle" | "analysing" | "review" | "reassessed" | "sending" | "dispatched" | "failed" | "deferred" | "monitoring" | "decided" | "closed";

function decisionPhase(c: Case | null, flow: FlowView | null): DecisionPhase {
  if (!c || !flow) return "idle";
  if (flow.finished) return "closed";
  const n = flow.current?.node;
  if (!n) return "idle";
  if (n.state === "running") return flow.current!.rowId.endsWith(":analysis") ? "analysing" : "sending";
  if (n.state === "human") return c.phase === "monitoring" ? "monitoring" : c.phase === "rejected" ? "decided" : latest(c).version > 1 ? "reassessed" : "review";
  if (n.state === "waiting") return "dispatched";
  if (n.state === "stopped") return n.action?.kind === "resend" ? "failed" : "deferred";
  return "dispatched";
}

/**
 * Fixed decision area: conclusion, key evidence, the actual content to be sent, and the main
 * actions, by phase. Results show at once; delivery is shown only from real receipts.
 */
function DecisionPanel({ c, flow, card, state, mock, now, reviewing, setReviewing, draft, setDraft, api, reviewer }: {
  c: Case | null;
  flow: FlowView | null;
  card: CrewCardView;
  state: StationState;
  mock: boolean;
  now: number;
  reviewing: Decision | null;
  setReviewing: (d: Decision | null) => void;
  draft: (d: Decision) => string;
  setDraft: (d: Decision, v: string) => void;
  api: StationApi;
  reviewer: string;
}) {
  const phase = decisionPhase(c, flow);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const node = flow?.current?.node ?? null;
  const ev = c ? latest(c) : null;
  const st = c ? caseStatus(c) : null;
  const evs = ev ? evaluationStatus(ev) : null;
  const options: Decision[] = node?.action?.kind === "decide" ? node.action.options : c ? allowedDecisions(c) : [];
  const primary = node?.action?.kind === "decide" ? node.action.primary : null;
  // A review form opened earlier stays open (also across collapse / person switch) while the decision is still allowed.
  const form = reviewing && options.includes(reviewing) ? reviewing : null;
  const previewDecision = form ?? (phase === "review" || phase === "reassessed" ? primary : null);
  const out = c && previewDecision ? outgoingFor(c, previewDecision) : null;
  let body: ReactNode = null;
  if (!c || !flow || !ev) {
    body = <p className="text-[13px] text-[var(--mg-dim)]">{`Nothing to decide for ${card.callsign}. A case appears when an observation arrives; the decision area then shows the conclusion and what would be sent.`}</p>;
  } else if (phase === "analysing") {
    const first = c.evaluations[0];
    body = (
      <>
        <p className="text-[15px] font-semibold text-[var(--mg-cyan)]" data-testid="decision-conclusion">{ev.version > 1 ? "Retest result received · re-evaluating" : "Simulated analysis in progress"}</p>
        <p className="text-[12px] text-[var(--mg-dim)]">{`Step ${Math.min(4, ev.revealed + 1)} of 4 · deterministic demo rules, no model called · no action needed`}</p>
        <Progress done={ev.revealed} total={4} />
        {ev.version > 1 && first.completedAt ? <p className="mt-2 text-[12px]" data-testid="decision-first-result">{`Round 1 result (kept unchanged): ${first.result.headline}`}</p> : null}
      </>
    );
  } else {
    body = (
      <>
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--mg-faint)]" data-testid="panel-eval-status" data-tone={evs?.tone}>
          {`Latest evaluation v${ev.version}${ev.trigger === "retest" ? " · retest" : ev.trigger === "report" ? " · report check" : ""}`}
        </p>
        <p className={`text-[16px] font-semibold leading-snug ${evs ? TONE_TEXT[evs.tone] : ""}`} data-testid="decision-conclusion">
          {ev.result.headline}
        </p>
        {form ? null : <p className="text-[12px] text-[var(--mg-dim)]">{ev.result.conclusion}</p>}
        {ev.version > 1 && !form ? (
          <div className="mt-2 rounded-lg border border-[var(--mg-line)] p-2 text-[12px]" data-testid="decision-first-result">
            <p>{`Round 1 (kept): ${c.evaluations[0].result.headline}`}</p>
            {alertNote(c) ? <p className="mt-0.5 text-[var(--mg-caution)]">{alertNote(c)}</p> : null}
          </div>
        ) : null}
        {form ? null : <StatusBlock phase={phase} c={c} flow={flow} node={node} state={state} mock={mock} now={now} />}
        {(phase === "review" || phase === "reassessed") && !form ? (
          <div className="mt-3" data-testid="decision-evidence">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--mg-faint)]">{"Key evidence"}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px]">
              {keyBasis(ev.result).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <details className="mt-1 text-[11px] text-[var(--mg-faint)]">
              <summary className="cursor-pointer">{`Limitations (${ev.result.limitations.length})`}</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {ev.result.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
        {out ? (
          <div className="mt-3 rounded-lg border border-[var(--mg-line-strong)] p-2.5" data-testid="decision-outgoing" data-decision={previewDecision}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--mg-faint)]">{`${IF_DECIDED[previewDecision!]}: sent to the HUD`}</p>
            {out.actions.length || out.status ? (
              <>
                {out.actions.map((a, i) => (
                  <p key={a.title} className="mt-1 text-[12px]" data-testid="outgoing-action">
                    <b>{`${i + 1}. ${a.title}: `}</b>
                    {a.text}
                  </p>
                ))}
                {out.status ? (
                  <p className="mt-1 text-[12px] text-[var(--mg-dim)]" data-testid="outgoing-status">
                    <b>{"Status notice: "}</b>
                    {out.status}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-[12px]" data-testid="outgoing-none">{"Nothing is sent."}</p>
            )}
            <p className="mt-1 text-[11px] text-[var(--mg-faint)]">{"Draft only: nothing is sent before you confirm."}</p>
          </div>
        ) : null}
        {form ? <p className="mt-2 text-[12px] text-[var(--mg-dim)]" data-testid="confirm-conditions">{CONDITIONS[form]}</p> : null}
      </>
    );
  }

  let footer: ReactNode = null;
  if (c && form) {
    footer = (
      <ReviewForm
        key={`${c.caseId}:${form}`}
        c={c}
        decision={form}
        reviewer={reviewer}
        draft={draft(form)}
        setDraft={(v) => setDraft(form, v)}
        onCancel={() => setReviewing(null)}
        onConfirm={(reason) => {
          const err = api.review(c.caseId, latest(c).version, form, reason, reviewer);
          if (!err) {
            setDraft(form, "");
            setReviewing(null);
            requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
          }
          return err;
        }}
      />
    );
  } else if (c && node?.action?.kind === "resend") {
    const ids = node.action.eventIds;
    footer = (
      <button type="button" onClick={() => ids.forEach(api.resend)} className="min-h-10 w-full rounded-xl border border-[var(--mg-caution)] px-4 text-[14px] font-semibold text-[var(--mg-caution)]" data-testid="action-resend">
        {"Resend the same message"}
      </button>
    );
  } else if (c && options.length) {
    const quiet = phase === "dispatched" || phase === "deferred" || phase === "monitoring" || phase === "sending";
    footer = (
      <div className="flex flex-wrap items-center gap-2" data-testid="node-actions">
        {!quiet && primary ? (
          <button type="button" onClick={() => setReviewing(primary)} className="min-h-10 rounded-xl bg-[var(--mg-coral)] px-4 text-[14px] font-semibold text-[#1a0f0c]" data-testid={`decide-${primary}`}>
            {`${primaryLabel(primary, c)}…`}
          </button>
        ) : null}
        {options
          .filter((d) => quiet || d !== primary)
          .map((d) => (
            <button key={d} type="button" onClick={() => setReviewing(d)} className={`min-h-9 rounded-lg border px-3 text-[13px] ${quiet ? "border-[var(--mg-line)] text-[var(--mg-dim)]" : "border-[var(--mg-line-strong)]"}`} data-testid={`decide-${d}`}>
              {quiet && d === "close" ? "Close case early…" : `${DECISION_WORD[d]}…`}
            </button>
          ))}
      </div>
    );
  }

  return (
    <aside aria-labelledby="decision-title" className="order-1 flex min-h-0 flex-col border-b border-[var(--mg-line)] bg-[var(--mg-bg)] lg:order-2 lg:border-b-0 lg:border-l" data-testid="decision-panel" data-phase={phase}>
      <div className="border-b border-[var(--mg-line)] px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <h3 id="decision-title" ref={titleRef} tabIndex={-1} className="text-[14px] font-semibold outline-none">
            {"Decision"}
          </h3>
          <span className="ml-auto text-[11px] text-[var(--mg-faint)]">{c ? `${card.callsign} · ${c.caseId.slice(-6)}` : card.callsign}</span>
        </div>
        {st && flow ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className={`rounded-md border px-1.5 py-0.5 ${TONE_BORDER[st.tone]} ${TONE_TEXT[st.tone]}`} data-testid="panel-case-status">{st.label}</span>
            <span className="text-[var(--mg-dim)]">
              {"Next action: "}
              <b className={flow.who === "Base staff" ? "text-[var(--mg-coral)]" : "text-[var(--mg-text)]"} data-testid="panel-fact-who">
                {flow.who === "None" ? "nobody (done)" : flow.who}
              </b>
            </span>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="decision-body">
        {body}
      </div>
      {footer ? <div className="max-h-[60%] overflow-y-auto border-t border-[var(--mg-line)] bg-[var(--mg-bg-2)] px-3 py-3" data-testid="decision-footer">{footer}</div> : null}
    </aside>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="mt-2 flex gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? "bg-[var(--mg-cyan)]" : "bg-[var(--mg-line)]"}`} />
      ))}
    </div>
  );
}

/** Phase-specific status: what is happening, who is awaited, and real delivery states only. */
function StatusBlock({ phase, c, flow, node, state, mock, now }: { phase: DecisionPhase; c: Case; flow: FlowView; node: FlowNode | null; state: StationState; mock: boolean; now: number }) {
  const why = <p className="mt-2 text-[12px]" data-testid="panel-fact-why">{flow.why}</p>;
  // Review: the conclusion, evidence and the draft to send say it all (no repeated reason line).
  if (phase === "review" || phase === "reassessed") return null;
  if (phase === "closed") {
    const close = c.reviews.filter((r) => r.decision === "close").at(-1);
    const hadRetest = c.retests.some((r) => r.status !== "result-received");
    return (
      <div className="mt-2 rounded-lg border border-[var(--mg-ok)] p-2.5 text-[12px]" data-testid="decision-closed">
        <p className="text-[14px] font-semibold text-[var(--mg-ok)]">{"Handling complete"}</p>
        {close ? <p className="mt-0.5">{`By ${close.reviewer} at ${hhmmss(close.at).slice(0, 8)}: ${close.reason}`}</p> : null}
        <p className="mt-0.5 text-[var(--mg-dim)]">{"The alert is cleared by base staff. Case Closed does not mean the astronaut is healthy or recovered."}</p>
        {hadRetest ? <p className="mt-0.5 text-[var(--mg-dim)]">{"The earlier retest task is no longer needed; the HUD shows it as history."}</p> : null}
        <p className={`mt-1 ${flow.noticePending ? "text-[var(--mg-cyan)]" : "text-[var(--mg-text)]"}`} data-testid="panel-notice-pending">
          {flow.noticePending ?? "Status notice: Received by HUD"}
        </p>
      </div>
    );
  }
  if (phase === "monitoring")
    return (
      <div className="mt-2 rounded-lg border border-[var(--mg-line)] p-2.5 text-[12px]" data-testid="decision-monitoring">
        <p className="text-[14px] font-semibold">{"Decision recorded: Continue Monitoring"}</p>
        <p className="mt-0.5 text-[var(--mg-dim)]">{"The case stays open and the alert stays. No action is needed now; you can close the case at any time."}</p>
        {flow.noticePending ? <p className="mt-1 text-[var(--mg-cyan)]">{flow.noticePending}</p> : null}
      </div>
    );
  if (phase === "decided") return <div className="text-[var(--mg-coral)]">{why}</div>;
  const msgs = (node?.messages.length ? node.messages : state.outbox.filter((m) => m.caseId === c.caseId && (m.type === "station.notice.approved" || m.type === "station.retest.requested"))).slice(-2);
  const retest = c.retests.at(-1) ?? null;
  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="decision-dispatch">
      {phase === "failed" || phase === "deferred" ? <p className="text-[12px] text-[var(--mg-caution)]" data-testid="node-reason">{node?.reason ?? flow.why}</p> : null}
      {msgs.length ? <DispatchTracker msgs={msgs} mock={mock} /> : null}
      {retest ? (
        <p className="text-[12px]" data-testid="decision-retest">
          <span className="text-[var(--mg-faint)]">{"Retest result: "}</span>
          {retest.status === "result-received" ? `received → analysis round ${retest.resultVersion}` : retest.status === "completed" ? "crew reports it done; waiting for the data" : retest.status === "deferred" ? "deferred by the crew" : "not received yet"}
        </p>
      ) : null}
      {node && (node.state === "waiting" || node.state === "running") ? (
        <p className="rounded-lg border border-dashed border-[var(--mg-cyan)] px-2.5 py-1.5 text-[12px] text-[var(--mg-cyan)]" data-testid="current-waiting">
          {node.state === "running" ? "Sending to the relay…" : `Waiting for ${party(node.owner)} (${node.label}) · since ${hhmmss(node.since).slice(0, 8)} · ${elapsed(node.since, now)}`}
        </p>
      ) : null}
    </div>
  );
}

const SEND: Keyframe[] = [{ transform: "translateX(-10px)", opacity: 0.2 }, { transform: "none", opacity: 1 }];
const RECEIPT: Keyframe[] = [{ transform: "translateX(10px)", opacity: 0.2 }, { transform: "none", opacity: 1 }];
const STEP_OPTS: KeyframeAnimationOptions = { duration: 500, easing: "ease-out" };

/** Base → relay → HUD → crew, per message, from recorded states only (no receipt → no success). */
function DispatchTracker({ msgs, mock }: { msgs: OutMessage[]; mock: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5" data-testid="dispatch-tracker">
      {msgs.map((m) => (
        <li key={m.eventId} className="rounded-lg border border-[var(--mg-line)] p-2 text-[12px]">
          <p className="font-medium">{m.type === "station.notice.approved" ? "Notice → HUD" : "Retest task → HUD"}</p>
          <div className="mt-1 grid grid-cols-3 gap-1">
            <Step k={`${m.eventId}:sent:${m.delivery}`} frames={SEND} ok={m.delivery === "sent"} fail={m.delivery === "failed"} label={mock ? "Sent (local sim.)" : "Relay accepted"} at={m.delivery === "sent" ? m.adapterAt : null} testid="track-sent" />
            <Step k={m.hudReceivedAt ? `${m.eventId}:recv` : null} frames={RECEIPT} ok={!!m.hudReceivedAt} fail={false} label="Received by HUD" at={m.hudReceivedAt} testid="track-hud" />
            <Step k={m.feedback !== "none" ? `${m.eventId}:fb:${m.feedback}` : null} frames={RECEIPT} ok={m.feedback === "acknowledged"} fail={m.feedback === "deferred"} label={m.feedback === "deferred" ? "Deferred by crew" : "Acknowledged by Crew"} at={m.feedbackAt} testid="track-crew" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Step({ k, frames, ok, fail, label, at, testid }: { k: string | null; frames: Keyframe[]; ok: boolean; fail: boolean; label: string; at: string | null; testid: string }) {
  const ref = useOnceAnimation<HTMLDivElement>(ok || fail ? k : null, frames, STEP_OPTS);
  return (
    <div ref={ref} className={`rounded-md border px-1.5 py-1 ${fail ? "border-[var(--mg-caution)] text-[var(--mg-caution)]" : ok ? "border-[var(--mg-ok)] text-[var(--mg-text)]" : "border-dashed border-[var(--mg-line)] text-[var(--mg-faint)]"}`} data-testid={testid} data-state={fail ? "failed" : ok ? "done" : "pending"}>
      <p className="text-[11px] leading-tight">{`${fail ? "!" : ok ? "✓" : "○"} ${label}`}</p>
      <p className="text-[10px] tabular-nums opacity-80">{at ? hhmmss(at).slice(0, 8) : "–"}</p>
    </div>
  );
}
