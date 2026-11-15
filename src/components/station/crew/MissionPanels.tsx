"use client";

import type { ReactNode, RefObject } from "react";
import type { CrewCardView } from "@/lib/station/crew";
import { CONDITION_NOTES, MISSION_CREW, PHASE_LABEL, runTask, type MissionDef, type MissionPhase, type MissionTask } from "@/lib/station/mission";
import type { StationState } from "@/lib/station/station";

export type StationView = "map" | "health";

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
