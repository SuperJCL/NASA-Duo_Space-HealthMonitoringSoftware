"use client";

import type { ReactNode, RefObject } from "react";
import type { CrewCardView } from "@/lib/station/crew";
import { CONDITION_NOTES, MISSION_CREW, PHASE_LABEL, runTask, type MissionDef, type MissionPhase, type MissionTask } from "@/lib/station/mission";
import type { StationState } from "@/lib/station/station";

export type StationView = "map" | "health";
const hhmm = (iso: string | null | undefined) => (iso ? `${new Date(iso).toISOString().slice(11, 16)} UTC` : "–");

/** Cards with a health case waiting for base staff (what "to review" counts). */
export const pendingCards = (cards: CrewCardView[]) => cards.filter((c) => c.needsBase > 0 && c.event);

/** Mission context row of the station header: always visible, overlay open or collapsed. */
export function MissionBar({ def, state, phase, view, onView, cards, onJump, onEndEva, canAct, toggleRef }: {
  def: MissionDef | null;
  state: StationState;
  phase: MissionPhase;
  view: StationView;
  onView: (v: StationView) => void;
  cards: CrewCardView[];
  onJump: (astronautId: string, caseId: string) => void;
  onEndEva: () => void;
  canAct: boolean;
  toggleRef?: RefObject<HTMLButtonElement | null>;
}) {
  const run = state.run;
  const task = runTask(def, state);
  const pending = pendingCards(cards);
  const pendingCount = pending.reduce((n, c) => n + c.needsBase, 0);
  const open = view === "health";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--mg-line)] px-5 py-1.5 text-[13px]" data-testid="mission-bar">
      <span className="font-semibold" data-testid="mission-map-label">{"Mission Map"}</span>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls="health-overlay-title"
        onClick={() => onView(open ? "map" : "health")}
        className={`min-h-8 rounded-lg border px-3 text-[13px] font-semibold ${open ? "border-[var(--mg-cyan)] bg-[var(--mg-cyan-soft)]" : "border-[var(--mg-line-strong)] bg-[var(--mg-surface)]"}`}
        data-testid="overlay-toggle"
        data-state={open ? "open" : "collapsed"}
      >
        {open ? "Health Monitoring ▾ Collapse" : "Health Monitoring ▸ Open"}
      </button>
      <span className="text-[var(--mg-dim)]" data-testid="mission-name">{def?.title ?? "Mission not loaded"}</span>
      <span className={`rounded-full border px-2.5 py-0.5 ${phase === "eva-active" ? "border-[var(--mg-ok)] text-[var(--mg-ok)]" : "border-[var(--mg-line-strong)] text-[var(--mg-dim)]"}`} data-testid="mission-phase" data-phase={phase}>
        {PHASE_LABEL[phase]}
      </span>
      <span className="text-[var(--mg-dim)]" data-testid="mission-task">
        {run ? `${run.task.title}${task ? ` → ${task.targetName}` : ""} · ${run.astronaut.callsign}` : "No EVA started"}
      </span>
      <button
        type="button"
        disabled={!pending.length}
        onClick={() => pending[0]?.event && onJump(pending[0].astronautId, pending[0].event.caseId)}
        className={`rounded-full border px-2.5 py-0.5 ${pendingCount ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] font-semibold text-[var(--mg-text)]" : "border-[var(--mg-line)] text-[var(--mg-dim)]"}`}
        title={pendingCount ? "Open the first health case awaiting base review" : undefined}
        data-testid="mission-pending"
        data-count={pendingCount}
      >
        {`To review: ${pendingCount}`}
      </button>
      {phase === "eva-active" ? (
        <button type="button" disabled={!canAct} onClick={onEndEva} className="ml-auto min-h-8 rounded-lg border border-[var(--mg-line-strong)] px-3 disabled:opacity-40" data-testid="eva-end-open">
          {"End EVA"}
        </button>
      ) : null}
    </div>
  );
}

/** Top of the map view: preparation (task → astronaut → summary → start) or the running / ended EVA. */
export function MissionStrip({ def, state, phase, selectedTask, astronautId, setAstronautId, onSummary, onJump, onOpenPerson, cards, canAct, mode, openCount, onResendStart }: {
  def: MissionDef | null;
  state: StationState;
  phase: MissionPhase;
  selectedTask: MissionTask | null;
  astronautId: string;
  setAstronautId: (id: string) => void;
  onSummary: () => void;
  onJump: (astronautId: string, caseId: string) => void;
  onOpenPerson: (astronautId: string) => void;
  cards: CrewCardView[];
  canAct: boolean;
  mode: "relay" | "mock";
  openCount: number;
  onResendStart: (eventId: string) => void;
}) {
  const run = state.run;
  const runT = runTask(def, state);
  const pending = pendingCards(cards);
  const startMsg = state.pendingStart ? state.outbox.find((m) => m.eventId === state.pendingStart!.eventId) : null;
  const blocked = phase === "eva-ended" && openCount > 0;
  const prep = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="mission-prep">
      <span>
        <b className="mr-1 text-[var(--mg-coral)]">{"①"}</b>
        {selectedTask ? (
          <span data-testid="prep-task" data-task={selectedTask.taskId}>{`Task: ${selectedTask.title} → ${selectedTask.targetName} (simulated target, scenario-defined position)`}</span>
        ) : (
          <span className="text-[var(--mg-dim)]" data-testid="prep-task">{"Select a task on the map or in the task list"}</span>
        )}
      </span>
      <label className="flex items-center gap-1.5">
        <b className="text-[var(--mg-coral)]">{"②"}</b>
        {"Astronaut"}
        <select value={astronautId} onChange={(e) => setAstronautId(e.target.value)} className="rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1" data-testid="prep-astronaut">
          {MISSION_CREW.map((m) => (
            <option key={m.id} value={m.id}>{`${m.callsign} · ${m.hud}`}</option>
          ))}
        </select>
      </label>
      <button type="button" disabled={!selectedTask || !canAct || blocked || mode !== "relay"} onClick={onSummary} className="min-h-9 rounded-lg bg-[var(--mg-coral)] px-3 font-semibold text-[#1a0f0c] disabled:opacity-40" data-testid="prep-summary">
        <b className="mr-1">{"③"}</b>
        {phase === "eva-ended" ? "Review summary, start the next EVA" : "Review summary, start EVA"}
      </button>
      {mode !== "relay" ? <span className="text-[12px] text-[var(--mg-caution)]">{"Standalone demo: EVAs are not started here; runs come from the local simulated demo. Use the two-end mode (?relay=auto) for the full mission flow."}</span> : null}
      {!canAct && mode === "relay" ? <span className="text-[12px] text-[var(--mg-caution)]">{"Read-only window: another base window starts and ends EVAs."}</span> : null}
      {blocked ? <span className="text-[12px] text-[var(--mg-caution)]" data-testid="prep-blocked">{`The previous EVA still has ${openCount} open health case(s): handle them in Health Monitoring before starting a new EVA.`}</span> : null}
    </div>
  );
  let body: ReactNode;
  if (phase === "starting")
    body = (
      <p data-testid="mission-starting">
        {"Starting EVA: waiting for the relay to confirm (Health Monitoring opens once confirmed)."}
        {startMsg && startMsg.delivery === "failed" ? (
          <>
            <span className="ml-2 text-[var(--mg-caution)]">{`Send failed: ${startMsg.deliveryNote ?? "unknown reason"}`}</span>
            <button type="button" onClick={() => onResendStart(startMsg.eventId)} className="ml-2 rounded border border-[var(--mg-line-strong)] px-2" data-testid="mission-start-resend">
              {"Resend (same message)"}
            </button>
          </>
        ) : null}
      </p>
    );
  else if (phase === "eva-active" && run)
    body = (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="mission-active">
        <span>{`Simulated EVA in progress (not a real EVA): ${run.task.title}${runT ? ` → ${runT.targetName}` : ""} · ${run.astronaut.callsign} · started ${hhmm(run.startedAt)}`}</span>
        {cards.map((c) => (
          <button key={`crew-${c.astronautId}`} type="button" onClick={() => onOpenPerson(c.astronautId)} className="flex items-center gap-1.5 rounded-full border border-[var(--mg-line-strong)] px-3 py-1 text-[12px]" title="No live position source: the map marker is a simulated position near the task target" data-testid={`map-crew-${c.astronautId}`}>
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#0e1520] bg-white outline-dashed outline-1 outline-offset-1 outline-white" />
            <b>{c.callsign}</b>
            <span className="text-[var(--mg-dim)]">{"simulated position · Health Monitoring →"}</span>
          </button>
        ))}
        {pending.length ? (
          pending.map((c) => (
            <button key={c.astronautId} type="button" onClick={() => onJump(c.astronautId, c.event!.caseId)} className="flex items-center gap-1.5 rounded-full border border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] px-3 py-1 text-[12px]" data-testid={`map-pending-${c.astronautId}`}>
              <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--mg-coral)]" />
              <b>{c.callsign}</b>
              <span>{c.event!.text}</span>
              <span className="text-[var(--mg-dim)]">{"→ review"}</span>
            </button>
          ))
        ) : (
          <span className="text-[var(--mg-dim)]" data-testid="map-pending-none">{"No health case awaiting base review"}</span>
        )}
      </div>
    );
  else if (phase === "eva-ended" && run)
    body = (
      <div className="flex flex-col gap-2">
        <p data-testid="mission-ended">{`Simulated EVA ended · ${run.task.title} · ${run.astronaut.callsign} · ended ${hhmm(run.evaEndedAt)} · open health cases: ${openCount} (ending the EVA closes none of them and says nothing about health)`}</p>
        {prep}
      </div>
    );
  else body = prep;
  return (
    <section aria-label="Mission preparation and EVA status" className="border-b border-[var(--mg-line)] bg-[rgba(255,255,255,0.02)] px-5 py-2.5 text-[13px]" data-testid="mission-strip">
      {body}
    </section>
  );
}

function Dialog({ title, children, onClose, testid }: { title: string; children: ReactNode; onClose: () => void; testid: string }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Handled here: the Health Monitoring overlay must not also collapse.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={`${testid}-title`} className="mg-glass flex max-h-[90dvh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-2xl p-5 text-[14px]" data-testid={testid}>
        <h2 id={`${testid}-title`} className="text-[17px] font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** "Review summary" → the human confirmation that starts the simulated EVA (one scenario.start). */
export function StartEvaDialog({ def, task, astronautId, onConfirm, onCancel, error }: { def: MissionDef; task: MissionTask; astronautId: string; onConfirm: () => void; onCancel: () => void; error: string | null }) {
  const crew = MISSION_CREW.find((m) => m.id === astronautId);
  return (
    <Dialog title="Mission summary · confirm Start EVA (simulated)" onClose={onCancel} testid="eva-start-dialog">
      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-[var(--mg-dim)]">{"Mission"}</dt>
        <dd>{`${def.title} (${def.id})`}</dd>
        <dt className="text-[var(--mg-dim)]">{"EVA task"}</dt>
        <dd data-testid="eva-start-task">{`${task.title} (${task.taskId})`}</dd>
        <dt className="text-[var(--mg-dim)]">{"Target"}</dt>
        <dd>{`${task.targetName} (simulated target, scenario-defined position, not a verified outcrop)`}</dd>
        <dt className="text-[var(--mg-dim)]">{"Astronaut"}</dt>
        <dd data-testid="eva-start-crew">{crew ? `${crew.callsign} · ${crew.hud}` : astronautId}</dd>
        <dt className="text-[var(--mg-dim)]">{"Health data"}</dt>
        <dd>{"Simulated samples from the data replay (not the teammate's health data)."}</dd>
      </dl>
      <div className="rounded-xl border border-[var(--mg-line)] p-3 text-[13px]" data-testid="eva-start-conditions">
        <p className="mb-1 font-semibold">{"Health measurement conditions"}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-[var(--mg-dim)]">
          {CONDITION_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
      <p className="text-[12px] text-[var(--mg-faint)]">{"This is a simulated EVA: confirming publishes one run start (scenario.start) and the HUD joins that run; it is not a real EVA. Selecting a task, opening the map or switching views never starts an EVA."}</p>
      {error ? (
        <p className="text-[var(--mg-caution)]" data-testid="eva-start-error">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3">
          {"Cancel"}
        </button>
        {/* A second click is refused by the station itself (one start per EVA). */}
        <button type="button" onClick={onConfirm} className="min-h-9 rounded-lg bg-[var(--mg-coral)] px-4 font-semibold text-[#1a0f0c]" data-testid="eva-start-confirm">
          {"Confirm Start EVA"}
        </button>
      </div>
    </Dialog>
  );
}

/** "End EVA": a mission phase change; it closes no health case and says nothing about health. */
export function EndEvaDialog({ openCount, onConfirm, onCancel, error }: { openCount: number; onConfirm: () => void; onCancel: () => void; error: string | null }) {
  return (
    <Dialog title="End EVA (simulated)" onClose={onCancel} testid="eva-end-dialog">
      <ul className="list-disc space-y-1 pl-5">
        <li data-testid="eva-end-open-count">{openCount ? `${openCount} health case(s) still open: ending the EVA does not close them; you can still handle them in Health Monitoring.` : "No open health case."}</li>
        <li>{"Nothing is deleted; cases and their handling stay visible after the EVA."}</li>
        <li>{"Ending the EVA does not mean the astronaut is healthy."}</li>
      </ul>
      {error ? <p className="text-[var(--mg-caution)]">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3">
          {"Cancel"}
        </button>
        <button type="button" onClick={onConfirm} className="min-h-9 rounded-lg border border-[var(--mg-caution)] px-4 font-semibold text-[var(--mg-caution)]" data-testid="eva-end-confirm">
          {"Confirm End EVA"}
        </button>
      </div>
    </Dialog>
  );
}
