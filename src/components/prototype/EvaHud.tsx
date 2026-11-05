"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { MgScenario, MissionState, TaskView } from "@/lib/prototype/mission-glass";

/**
 * Simulated EVA HUD: current planned task, why it is first, essential
 * constraints and warnings, minimal map, simulated task-state updates and a
 * replanning prompt. Not real telemetry; no astronaut position is shown.
 */
export function EvaHud({
  state,
  s,
  viewById,
  consumed,
  map,
  onStart,
  onCompleteStep,
  onSkip,
  onEvent,
  onAcceptReplan,
  onKeepPlan,
  onBackToPlanning,
  onEvidence,
}: {
  state: MissionState;
  s: MgScenario;
  viewById: ReadonlyMap<string, TaskView>;
  consumed: number;
  map: ReactNode;
  onStart: () => void;
  onCompleteStep: () => void;
  onSkip: () => void;
  onEvent: (id: string) => void;
  onAcceptReplan: () => void;
  onKeepPlan: () => void;
  onBackToPlanning: () => void;
  onEvidence: (taskId: string) => void;
}) {
  const replanRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.replan) replanRef.current?.focus();
  }, [state.replan]);

  const items = state.plan?.items ?? [];
  const live = items.filter((i) => i.status === "planned" || i.status === "active");
  const current = items.find((i) => i.status === "active") ?? items.find((i) => i.status === "planned");
  const view = current ? viewById.get(current.taskId) : undefined;
  const steps = current ? (s.actions.find((a) => a.taskId === current.taskId)?.steps ?? []) : [];
  const left = state.budget - consumed;
  const index = current ? items.indexOf(current) + 1 : items.length;
  const next = live.find((i) => i !== current);
  const nextView = next ? viewById.get(next.taskId) : undefined;
  const overBudget = live.filter((i) => (viewById.get(i.taskId)?.cost ?? 0) > left);

  if (!state.plan) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="mg-glass mg-rise max-w-md p-6 text-center" data-testid="mg-eva-empty">
          <h2 className="text-xl font-semibold">{"No mission plan yet"}</h2>
          <p className="mt-2 text-[var(--mg-dim)]">{"Create a simulated plan in Planning, then come back to run it here."}</p>
          <button type="button" onClick={onBackToPlanning} className="mt-4 rounded-xl bg-[var(--mg-coral)] px-4 py-2 font-medium text-[#1a0f0c]">
            {"Go to planning"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden" data-testid="mg-eva">
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full border border-[var(--mg-coral)] px-3 py-1 text-[13px] font-medium tracking-wide text-[var(--mg-coral)]">{"SIMULATED EVA · not real telemetry"}</span>
          <span className="text-[var(--mg-dim)]" data-testid="mg-eva-progress">
            {current ? `Task ${index} of ${items.length}` : `Plan complete: ${items.filter((i) => i.status === "done").length} done, ${items.filter((i) => i.status === "skipped").length} skipped`}
          </span>
        </div>

        <section className="mg-glass mg-rise p-6" aria-labelledby="mg-current-title" data-testid="mg-current">
          {current && view ? (
            <>
              <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{current.status === "active" ? "Current task" : "Next planned task"}</p>
              <h2 id="mg-current-title" className="mt-1 text-[32px] font-semibold leading-tight">
                {view.shortTitle}
              </h2>
              <p className="mt-2 text-[17px] text-[var(--mg-dim)]" data-testid="mg-current-why">
                {`${view.rank ? `Provisional priority #${view.rank}` : "Not ranked now"}: ${view.rationale}`}
              </p>
              <ol className="mt-5 space-y-2" data-testid="mg-steps">
                {steps.map((label, n) => {
                  const done = current.status === "active" && n < current.step;
                  const now = current.status === "active" && n === current.step;
                  return (
                    <li
                      key={label}
                      data-state={done ? "done" : now ? "current" : "todo"}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[16px] transition-colors duration-200 ${now ? "bg-[var(--mg-coral-soft)]" : ""}`}
                    >
                      <span
                        aria-hidden
                        className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[13px] ${
                          done ? "border-[var(--mg-ok)] text-[var(--mg-ok)]" : now ? "border-[var(--mg-coral)] text-[var(--mg-coral)]" : "border-[var(--mg-line)] text-[var(--mg-faint)]"
                        }`}
                      >
                        {done ? "✓" : `${n + 1}`}
                      </span>
                      <span className={done ? "text-[var(--mg-dim)] line-through decoration-[var(--mg-line-strong)]" : now ? "" : "text-[var(--mg-dim)]"}>{label}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--mg-line)]">
                <div className="h-full rounded-full bg-[var(--mg-coral)] transition-[width] duration-300 ease-out" style={{ width: `${Math.round((current.step / Math.max(steps.length, 1)) * 100)}%` }} />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {current.status === "planned" ? (
                  <button type="button" onClick={onStart} className="rounded-xl bg-[var(--mg-coral)] px-5 py-2.5 text-[16px] font-medium text-[#1a0f0c] hover:brightness-110" data-testid="mg-start">
                    {"Start task"}
                  </button>
                ) : (
                  <button type="button" onClick={onCompleteStep} className="rounded-xl bg-[var(--mg-coral)] px-5 py-2.5 text-[16px] font-medium text-[#1a0f0c] hover:brightness-110" data-testid="mg-complete-step">
                    {current.step + 1 >= steps.length ? "Complete task" : "Complete step"}
                  </button>
                )}
                <button type="button" onClick={onSkip} className="rounded-xl border border-[var(--mg-line)] px-4 py-2.5 text-[16px] text-[var(--mg-dim)]" data-testid="mg-skip">
                  {"Skip task"}
                </button>
                <button type="button" onClick={() => onEvidence(current.taskId)} className="rounded-xl border border-[var(--mg-cyan)] px-4 py-2.5 text-[16px] text-[var(--mg-cyan)]">
                  {"Why this task?"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 id="mg-current-title" className="text-[28px] font-semibold">
                {"Simulated plan complete"}
              </h2>
              <p className="mt-2 text-[var(--mg-dim)]">{"Return to planning to build another plan."}</p>
              <button type="button" onClick={onBackToPlanning} className="mt-4 rounded-xl border border-[var(--mg-line)] px-4 py-2">
                {"Back to planning"}
              </button>
            </>
          )}
        </section>

        <section className="mg-glass p-4" aria-label="Mission plan" data-testid="mg-plan-timeline">
          <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Mission plan (simulated)"}</p>
          <ol className="mt-2 flex flex-wrap gap-2">
            {items.map((i, n) => (
              <li
                key={i.taskId}
                data-status={i.status}
                className={`rounded-xl border px-3 py-1.5 text-sm ${
                  i.status === "active"
                    ? "border-[var(--mg-coral)] text-[var(--mg-text)]"
                    : i.status === "done"
                      ? "border-[var(--mg-ok)] text-[var(--mg-ok)]"
                      : i.status === "skipped"
                        ? "border-[var(--mg-line)] text-[var(--mg-faint)] line-through"
                        : "border-[var(--mg-line)] text-[var(--mg-dim)]"
                }`}
              >
                {`${n + 1}. ${viewById.get(i.taskId)?.shortTitle ?? i.taskId} · ${i.status === "active" ? "in progress" : i.status}`}
              </li>
            ))}
          </ol>
        </section>

        {state.replan ? (
          <section role="alertdialog" aria-labelledby="mg-replan-title" className="mg-glass mg-rise border-[var(--mg-caution)] p-5" data-testid="mg-replan">
            <h3 id="mg-replan-title" ref={replanRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
              {"Constraints changed: replan?"}
            </h3>
            <p className="mt-1 text-[var(--mg-dim)]">{state.replan.reason}</p>
            <p className="mt-3 text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Suggested (existing engine, provisional order)"}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5" data-testid="mg-replan-suggested">
              {state.replan.suggested.length ? (
                state.replan.suggested.map((id) => <li key={id}>{viewById.get(id)?.shortTitle ?? id}</li>)
              ) : (
                <li>{"No remaining task fits the available effort."}</li>
              )}
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={onAcceptReplan} className="rounded-xl bg-[var(--mg-coral)] px-4 py-2 font-medium text-[#1a0f0c]" data-testid="mg-accept-replan">
                {"Accept new plan"}
              </button>
              <button type="button" onClick={onKeepPlan} className="rounded-xl border border-[var(--mg-line)] px-4 py-2" data-testid="mg-keep-plan">
                {"Keep my plan"}
              </button>
            </div>
          </section>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto">
        <section className="mg-glass p-4" aria-label="Constraints" data-testid="mg-constraints">
          <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Simulated effort left"}</p>
          <p className="mt-1 text-2xl font-semibold" data-testid="mg-effort-left">
            {`${left} / ${state.budget} pts`}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--mg-line)]">
            <div className="h-full rounded-full bg-[var(--mg-cyan)] transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, Math.round((left / Math.max(state.budget, 1)) * 100))}%` }} />
          </div>
          {nextView ? <p className="mt-2 text-sm text-[var(--mg-dim)]">{`Up next: ${nextView.shortTitle} (${nextView.cost} pts)`}</p> : null}
        </section>

        <section className="mg-glass p-4" aria-label="Warnings" data-testid="mg-warnings">
          <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Warnings"}</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {overBudget.length ? (
              <li className="text-[var(--mg-caution)]" data-testid="mg-warning-budget">
                {`Over budget: ${overBudget.map((i) => viewById.get(i.taskId)?.shortTitle).join(", ")}`}
              </li>
            ) : null}
            {s.warnings.map((w) => (
              <li key={w} className="text-[var(--mg-dim)]">
                {w}
              </li>
            ))}
          </ul>
        </section>

        <section className="mg-glass overflow-hidden" aria-label="Map" data-testid="mg-minimap">
          <p className="px-4 pt-3 text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Map · simulated target in coral"}</p>
          <div className="relative mt-2 h-56">{map}</div>
        </section>

        <section className="rounded-2xl border border-dashed border-[var(--mg-line-strong)] p-4" aria-label="Scenario controls" data-testid="mg-scenario-controls">
          <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Scenario controls (demo)"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {s.events.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onEvent(e.id)}
                className="rounded-xl border border-[var(--mg-line)] px-3 py-1.5 text-sm hover:border-[var(--mg-line-strong)]"
                data-testid={`mg-event-${e.id}`}
              >
                {`Simulate: ${e.label}`}
              </button>
            ))}
          </div>
          <button type="button" onClick={onBackToPlanning} className="mt-3 text-sm text-[var(--mg-dim)] underline underline-offset-2">
            {"Back to planning"}
          </button>
        </section>

        {state.log.length ? (
          <details className="mg-glass p-4 text-sm" data-testid="mg-log">
            <summary className="cursor-pointer text-[var(--mg-dim)]">{`Simulated event log (${state.log.length})`}</summary>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[var(--mg-dim)]">
              {state.log.map((l, n) => (
                <li key={n}>{l}</li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </div>
  );
}
