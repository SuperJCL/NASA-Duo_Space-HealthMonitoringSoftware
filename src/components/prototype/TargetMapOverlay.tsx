"use client";

import type { ReactNode } from "react";
import type { TargetMarker } from "@/lib/prototype/target-markers";

const TONE_CLASS: Record<TargetMarker["tone"], string> = {
  candidate: "border-dashed border-[var(--mg-coral)] text-[var(--mg-coral)]",
  added: "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] text-[var(--mg-coral)]",
  planned: "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] text-[var(--mg-coral)]",
  active: "border-white bg-[var(--mg-coral)] text-[#1a0f0c]",
  done: "border-[var(--mg-ok)] text-[var(--mg-ok)]",
  skipped: "border-dashed border-[var(--mg-faint)] text-[var(--mg-faint)]",
  infeasible: "border-dashed border-[var(--mg-caution)] text-[var(--mg-caution)]",
};

/**
 * MAP-1 map context for the planning map. All values come from
 * `targetMarkers` (engine + mission state).
 *
 * TargetList: a row of target buttons over the map, in provisional-rank
 * order: the keyboard and touch alternative to clicking a marker.
 */
export function TargetList({
  markers,
  selectedTaskId,
  onPick,
  leading,
  rightInset = "right-3 lg:right-[29.5rem]",
}: {
  markers: readonly TargetMarker[];
  selectedTaskId: string | null;
  onPick: (taskId: string) => void;
  /** MAP-3A: a control shown before the target buttons (the 2D / 3D switch). */
  leading?: ReactNode;
  /** Right edge, so the row stays clear of controls on the map's right. */
  rightInset?: string;
}) {
  return (
    <div className={`absolute left-14 top-3 z-[3] flex gap-1.5 overflow-x-auto pb-1 ${rightInset}`} data-testid="mg-map-toolbar">
      {leading}
      <div role="group" aria-label="Simulated targets, in provisional priority order" className="flex gap-1.5" data-testid="mg-target-list">
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={m.taskId === selectedTaskId}
          aria-label={`${m.name}: ${m.taskTitle}. ${m.stateText}`}
          onClick={() => onPick(m.taskId)}
          data-testid={`mg-target-${m.id}`}
          data-tone={m.tone}
          data-badge={m.badge}
          className={`mg-glass flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-2.5 text-[13px] transition-colors duration-150 ${
            m.taskId === selectedTaskId ? "bg-[var(--mg-surface)] font-medium text-[var(--mg-text)] outline-2 outline-offset-0 outline-[var(--mg-text)]" : "text-[var(--mg-dim)] hover:text-[var(--mg-text)]"
          }`}
        >
          <span aria-hidden className={`flex size-6 rotate-45 items-center justify-center rounded-[5px] border-2 ${TONE_CLASS[m.tone]}`}>
            <span className="-rotate-45 text-[12px] font-bold">{m.badge}</span>
          </span>
          <span className="whitespace-nowrap">{m.status ? `${m.name} · ${m.status}` : m.name}</span>
        </button>
      ))}
      </div>
    </div>
  );
}

/**
 * TargetSummary: a concise summary of the selected target with optional
 * Level 2 (Details) and Level 3 (Evidence). On wide screens it floats on the
 * map's top-left, right of the zoom buttons; on phones it sits below the map
 * so it never covers it.
 * It can be closed.
 */
export function TargetSummary({
  marker: sel,
  feasibilityText,
  onDetails,
  onEvidence,
  onClose,
}: {
  marker: TargetMarker;
  /** Plain-language feasibility of the selected task in the current planning context. */
  feasibilityText: string;
  onDetails: (taskId: string) => void;
  onEvidence: (taskId: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      aria-label={`${sel.name} summary`}
      className="mg-glass mg-rise relative z-[5] mx-3 mt-3 bg-[var(--mg-glass-strong)] p-3 text-sm lg:absolute lg:left-14 lg:top-16 lg:m-0 lg:w-[22rem]"
      data-testid="mg-target-summary"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--mg-coral)]">{`SIM · ${sel.name} · scenario-defined position`}</p>
          <h2 className="mt-0.5 text-[16px] font-semibold leading-snug" data-testid="mg-summary-title">
            {sel.taskTitle}
          </h2>
        </div>
        <button type="button" aria-label="Close target summary" onClick={onClose} className="size-9 shrink-0 rounded-lg border border-[var(--mg-line)] text-[var(--mg-dim)]" data-testid="mg-summary-close">
          {"✕"}
        </button>
      </div>
      <p className="mt-1 text-[var(--mg-dim)]" data-testid="mg-summary-priority">
        {sel.rank ? `Provisional priority #${sel.rank} · not validated · ${sel.cost} pts` : `Not ranked under the current budget · ${sel.cost} pts`}
      </p>
      <p className={`mt-0.5 ${sel.feasible ? "text-[var(--mg-dim)]" : "text-[var(--mg-caution)]"}`} data-testid="mg-summary-state">
        {feasibilityText}
      </p>
      <p className="mt-0.5 text-[12px] text-[var(--mg-faint)]">{`${sel.distanceFromAnchorM} m straight-line from the verified Lefroy Bay site. No route or safety assessment.`}</p>
      <div className="mt-2 flex gap-3">
        <button type="button" onClick={() => onDetails(sel.taskId)} className="min-h-9 text-[13px] text-[var(--mg-text)] underline underline-offset-2" data-testid="mg-summary-details">
          {"Details"}
        </button>
        <button type="button" onClick={() => onEvidence(sel.taskId)} className="min-h-9 text-[13px] text-[var(--mg-cyan)] underline underline-offset-2" data-testid="mg-summary-evidence">
          {"Evidence and sources →"}
        </button>
      </div>
    </section>
  );
}
