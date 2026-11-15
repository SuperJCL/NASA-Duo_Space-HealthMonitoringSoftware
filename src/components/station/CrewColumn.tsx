"use client";

import { latest, workbenchStage, type StationState } from "@/lib/station/station";
import { caseStatus, evaluationStatus } from "@/lib/station/views";
import { Label, StatusChip } from "./ui";

/** Left column: the astronaut and the events that actually exist for them. */
export function CrewColumn({ state, selectedId, onSelect }: { state: StationState; selectedId: string | null; onSelect: (id: string) => void }) {
  const run = state.run;
  const cases = state.caseOrder.map((id) => state.cases[id]);
  // Latest EVA minute reported by any observation (retests are taken outside the EVA timeline).
  const minutes =
    cases
      .flatMap((c) => c.evaluations)
      .filter((e) => e.observation && e.observation.context.minutesIntoEva !== null)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .at(-1)?.observation?.context.minutesIntoEva ?? null;
  const open = cases.filter((c) => c.phase !== "closed").length;
  return (
    <nav aria-label="Astronaut and cases" className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4" data-testid="station-left">
      <Label>{"Astronaut"}</Label>
      {run ? (
        <button type="button" aria-pressed="true" className="mg-glass flex flex-col items-start gap-0.5 p-3 text-left ring-1 ring-[var(--mg-coral)]" data-testid="station-crew">
          <span className="font-semibold">{run.astronaut.callsign}</span>
          <span className="text-[13px] text-[var(--mg-dim)]" data-testid="station-task">
            {`${run.task.title}${minutes !== null ? ` · minute ${minutes}` : ""}`}
          </span>
          <span className="text-[12px] text-[var(--mg-faint)]">{`${open} open case${open === 1 ? "" : "s"}`}</span>
        </button>
      ) : (
        <p className="text-[13px] text-[var(--mg-dim)]" data-testid="station-crew-empty">
          {"No scenario start event received yet"}
        </p>
      )}

      <Label>{"Cases"}</Label>
      {cases.length === 0 ? (
        <p className="text-[13px] text-[var(--mg-dim)]">{run ? "No cases yet" : "–"}</p>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="station-events">
          {[...cases].reverse().map((c) => {
            const ev = latest(c);
            const sel = c.caseId === selectedId;
            return (
              <li key={c.caseId}>
                <button
                  type="button"
                  aria-pressed={sel}
                  onClick={() => onSelect(c.caseId)}
                  className={`flex w-full flex-col gap-1 rounded-xl border p-2.5 text-left ${sel ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)]" : "border-[var(--mg-line)] hover:border-[var(--mg-line-strong)]"}`}
                  data-testid={`station-case-tab-${c.caseId}`}
                  data-stage={workbenchStage(c)}
                >
                  <StatusChip tone={caseStatus(c).tone}>{caseStatus(c).label}</StatusChip>
                  <span className="text-[13px] font-medium leading-snug">{ev.completedAt ? ev.result.headline : "Simulated Analysis in progress…"}</span>
                  <span className={`text-[12px] ${{ ok: "text-[var(--mg-ok)]", alert: "text-[#ff8f8f]", caution: "text-[var(--mg-caution)]", neutral: "text-[var(--mg-faint)]" }[evaluationStatus(ev).tone]}`}>{evaluationStatus(ev).label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
