"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { stepCounts, stepRecords, type MgScenario, type MissionState, type TaskView } from "@/lib/prototype/mission-glass";
import { StepForm, StepsPanel, type StepFormKind } from "./StepControls";

/**
 * MG-2 EVA glance HUD. The primary view answers, in this order:
 *   1. current action  2. current step  3. ONE primary next action
 *   4. essential constraints  5. brief mission progress.
 * Secondary information (map, caveats, scenario controls, log, skip,
 * evidence) sits behind optional controls. A training prototype: not
 * flight software, not real telemetry, no astronaut position.
 *
 * EVA-1 adds step management: pause/resume beside the primary action; skip
 * a step (with a reason), add a note and skip the action under "More"; a
 * Steps panel for any single step; Undo of the last step change. The step
 * list (procedure) is never edited here.
 */
type Panel = "steps" | "map" | "caveats" | "scenario" | "log" | null;

export function EvaHud({
  state,
  s,
  viewById,
  consumed,
  map,
  replan,
  onStart,
  onCompleteStep,
  onSkipStep,
  onPause,
  onResume,
  onNote,
  onUndoStep,
  onSkip,
  onEvent,
  onReviewReplan,
  onUndo,
  onDismissNotice,
  onBackToPlanning,
  onEvidence,
}: {
  state: MissionState;
  s: MgScenario;
  viewById: ReadonlyMap<string, TaskView>;
  consumed: number;
  map: ReactNode;
  /** Replanning dialog (MG-3), a fixed modal rendered when a proposal exists. */
  replan?: ReactNode;
  onStart: () => void;
  onCompleteStep: (index?: number) => void;
  onSkipStep: (reason: string, index?: number) => void;
  onPause: () => void;
  onResume: () => void;
  onNote: (index: number, note: string) => void;
  onUndoStep: () => void;
  onSkip: (reason?: string) => void;
  onEvent: (id: string) => void;
  onReviewReplan: () => void;
  onUndo: () => void;
  onDismissNotice: () => void;
  onBackToPlanning: () => void;
  onEvidence: (taskId: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [form, setForm] = useState<{ kind: StepFormKind; index: number } | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const items = state.plan?.items ?? [];
  const current = items.find((i) => i.status === "active") ?? items.find((i) => i.status === "planned");
  const view = current ? viewById.get(current.taskId) : undefined;
  const steps = current ? (s.actions.find((a) => a.taskId === current.taskId)?.steps ?? []) : [];
  const stepIndex = current ? Math.min(current.step, steps.length - 1) : 0;
  const records = current ? stepRecords(current, steps.length) : [];
  const counts = current ? stepCounts(current, steps.length) : { done: 0, skipped: 0, todo: 0, current: null };
  const paused = Boolean(current?.status === "active" && current.paused);
  // The step after the current one that is still to do (steps may be resolved out of order).
  const nextTodo = records.findIndex((r, n) => n > stepIndex && r.status === "todo");
  const available = state.budget - consumed;
  const remainingNeed = items.filter((i) => i.status === "planned" || i.status === "active").reduce((sum, i) => sum + (viewById.get(i.taskId)?.cost ?? 0), 0);
  const actionNo = current ? items.indexOf(current) + 1 : items.length;

  // Keep keyboard focus on the single primary action as the state advances
  // (and return it there after a replanning decision).
  const replanOpen = state.replan !== null;
  useEffect(() => {
    if (!replanOpen) primaryRef.current?.focus({ preventScroll: true });
  }, [current?.taskId, current?.status, current?.step, current?.paused, replanOpen]);
  const closeForm = () => {
    setForm(null);
    primaryRef.current?.focus({ preventScroll: true });
  };
  const retainedOver = state.retained && remainingNeed > available ? remainingNeed - available : 0;

  if (!state.plan) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="mg-glass mg-rise max-w-md p-6 text-center" data-testid="mg-eva-empty">
          <h2 className="text-2xl font-semibold">{"No mission plan yet"}</h2>
          <p className="mt-2 text-[var(--mg-dim)]">{"Create a simulated plan in Planning, then run it here."}</p>
          <button type="button" onClick={onBackToPlanning} className="mt-5 min-h-12 rounded-xl bg-[var(--mg-coral)] px-6 text-lg font-semibold text-[#1a0f0c]">
            {"Go to planning"}
          </button>
        </div>
      </div>
    );
  }

  const primary = !current
    ? { label: "Back to planning", onClick: onBackToPlanning, testId: "mg-finish-plan" }
    : current.status === "planned"
      ? { label: "Start action", onClick: onStart, testId: "mg-start" }
      : paused
        ? { label: `Resume step ${current.step + 1}`, onClick: onResume, testId: "mg-resume" }
        : { label: counts.todo <= 1 ? "Finish action" : `Complete step ${current.step + 1}`, onClick: () => onCompleteStep(), testId: "mg-complete-step" };
  const toggle = (p: Panel) => setPanel((x) => (x === p ? null : p));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 p-4" data-testid="mg-eva">
      {/* Top strip: what this is, where you are, the way back. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="rounded-full border border-[var(--mg-coral)] px-3 py-1 text-[13px] font-medium text-[var(--mg-coral)]" data-testid="mg-eva-label">
          {"SIMULATED EVA · training prototype, not flight software or real telemetry"}
        </span>
        <span className="text-[15px] text-[var(--mg-dim)]" data-testid="mg-eva-progress">
          {current
            ? `Action ${actionNo} of ${items.length} · ${current.status === "active" ? `Step ${stepIndex + 1} of ${steps.length}` : "not started"}`
            : `Plan complete: ${[
                `${items.filter((i) => i.status === "done").length} done`,
                ...(items.some((i) => i.status === "skipped" && i.dropped?.by !== "replan") ? [`${items.filter((i) => i.status === "skipped" && i.dropped?.by !== "replan").length} skipped`] : []),
                ...(items.some((i) => i.dropped?.by === "replan") ? [`${items.filter((i) => i.status === "skipped" && i.dropped?.by === "replan").length} dropped by replan`] : []),
              ].join(", ")}`}
        </span>
        <button type="button" onClick={onBackToPlanning} className="ml-auto min-h-10 rounded-xl border border-[var(--mg-line)] px-4 text-[15px]" data-testid="mg-back-planning">
          {"← Planning"}
        </button>
      </div>

      {/* MG-3: an infeasible plan kept by the user stays explicitly flagged. */}
      {retainedOver ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--mg-caution)] bg-[rgba(241,200,120,0.1)] px-4 py-3" data-testid="mg-retained-warning">
          <p className="min-w-0 flex-1 text-[16px] text-[var(--mg-caution)]">
            {`You kept a plan that exceeds the available effort by ${retainedOver} pts. Later actions may not be possible.`}
          </p>
          <button type="button" onClick={onReviewReplan} className="min-h-11 rounded-xl border border-[var(--mg-caution)] px-4 text-[15px] text-[var(--mg-caution)]" data-testid="mg-review-replan">
            {"Review replanning"}
          </button>
        </div>
      ) : null}
      {state.notice ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--mg-line-strong)] bg-[var(--mg-glass)] px-4 py-2" data-testid="mg-notice">
          <p className="min-w-0 flex-1 text-[15px]" data-testid="mg-notice-text">
            {state.notice}
          </p>
          {state.stepUndo ? (
            <button type="button" onClick={onUndoStep} className="min-h-10 rounded-xl border border-[var(--mg-line-strong)] px-4 text-[15px]" data-testid="mg-undo-step">
              {"Undo"}
            </button>
          ) : state.previous ? (
            <button type="button" onClick={onUndo} className="min-h-10 rounded-xl border border-[var(--mg-line-strong)] px-4 text-[15px]" data-testid="mg-undo-replan">
              {"Undo"}
            </button>
          ) : null}
          <button type="button" aria-label="Dismiss message" onClick={onDismissNotice} className="size-10 rounded-xl border border-[var(--mg-line)] text-[var(--mg-dim)]" data-testid="mg-dismiss-notice">
            {"✕"}
          </button>
        </div>
      ) : null}

      {/* Brief mission progress: one segment per action. */}
      <ol className="flex gap-1.5" aria-label="Mission progress" data-testid="mg-plan-timeline">
        {items.map((i, n) => (
          <li key={i.taskId} data-status={i.status} data-drop={i.dropped?.by ?? ""} className="min-w-0 flex-1">
            <span
              aria-hidden
              className={`block h-1.5 rounded-full ${
                i.status === "done" ? "bg-[var(--mg-ok)]" : i.status === "active" ? "bg-[var(--mg-coral)]" : i.status === "skipped" ? "bg-[var(--mg-line)]" : "bg-[var(--mg-line-strong)]"
              }`}
            />
            <span className={`mt-1 block truncate text-[13px] ${i.status === "active" ? "text-[var(--mg-text)]" : "text-[var(--mg-faint)]"} ${i.status === "skipped" ? "line-through" : ""}`}>
              {`${n + 1}. ${viewById.get(i.taskId)?.shortTitle ?? i.taskId} · ${
                i.status === "active" ? (i.paused ? "paused" : "in progress") : i.status === "skipped" ? (i.dropped?.by === "replan" ? "dropped by replan" : "skipped by you") : i.status
              }`}
            </span>
          </li>
        ))}
      </ol>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_21rem]">
        {/* 1–3: current action, current step, single primary action. */}
        <section className="mg-glass mg-rise flex min-h-0 flex-col self-start p-6 lg:p-8" aria-labelledby="mg-current-title" data-testid="mg-current">
          {current && view ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{current.status === "active" ? "Current action" : "Next action"}</p>
                <span className="rounded-full border border-[var(--mg-line-strong)] px-2 py-0.5 text-[13px] text-[var(--mg-dim)]" data-testid="mg-uncertainty">
                  {view.rank ? `Priority #${view.rank} · provisional, not validated` : "Not ranked now · provisional engine"}
                </span>
              </div>
              <h2 id="mg-current-title" className="mt-1 text-[28px] font-semibold leading-tight">
                {view.shortTitle}
              </h2>
              <div className="mt-6 border-t border-[var(--mg-line)] pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-[13px] uppercase tracking-[0.12em] ${paused ? "text-[var(--mg-caution)]" : "text-[var(--mg-coral)]"}`} data-testid="mg-step-label">
                    {current.status === "active" ? `Step ${stepIndex + 1} of ${steps.length}${paused ? " · paused" : ""}` : "First step"}
                  </p>
                  {current.status === "active" && counts.done + counts.skipped ? (
                    <span className="text-[13px] text-[var(--mg-dim)]" data-testid="mg-step-counts">
                      {`${counts.done} done${counts.skipped ? ` · ${counts.skipped} skipped` : ""} · ${counts.todo} to do`}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[34px] font-semibold leading-tight" data-testid="mg-current-step">
                  {steps[current.status === "active" ? stepIndex : 0]}
                </p>
                <div className="mt-3 flex gap-1.5" aria-hidden>
                  {steps.map((st, n) => (
                    <span
                      key={st}
                      className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${
                        records[n]?.status === "done"
                          ? "bg-[var(--mg-ok)]"
                          : records[n]?.status === "skipped"
                            ? "bg-[var(--mg-faint)] opacity-60"
                            : current.status === "active" && n === current.step
                              ? paused
                                ? "bg-[var(--mg-caution)]"
                                : "bg-[var(--mg-coral)]"
                              : "bg-[var(--mg-line)]"
                      }`}
                    />
                  ))}
                </div>
                <ol className="sr-only" data-testid="mg-steps">
                  {steps.map((label, n) => (
                    <li
                      key={label}
                      data-state={records[n]?.status !== "todo" ? records[n]?.status : current.status === "active" && n === current.step ? (paused ? "paused" : "current") : "todo"}
                    >
                      {label}
                    </li>
                  ))}
                </ol>
                {current.status === "active" && nextTodo !== -1 ? (
                  <p className="mt-2 text-[16px] text-[var(--mg-dim)]" data-testid="mg-next-step">
                    {`Then: ${steps[nextTodo]}`}
                  </p>
                ) : null}
                {current.status === "active" && records[stepIndex]?.note ? (
                  <p className="mt-1 text-[14px] text-[var(--mg-dim)]" data-testid="mg-current-note">
                    {`Your note (simulated): ${records[stepIndex].note}`}
                  </p>
                ) : null}
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  ref={primaryRef}
                  type="button"
                  onClick={primary.onClick}
                  className="min-h-16 rounded-2xl bg-[var(--mg-coral)] px-8 text-xl font-semibold text-[#1a0f0c] transition-[filter] duration-150 hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--mg-coral-soft)]"
                  data-testid={primary.testId}
                >
                  {primary.label}
                </button>
                {current.status === "active" && !paused ? (
                  <button type="button" onClick={onPause} className="min-h-12 rounded-xl border border-[var(--mg-line-strong)] px-4 text-[16px]" data-testid="mg-pause">
                    {"Pause"}
                  </button>
                ) : null}
                <div className="relative">
                  <button type="button" aria-expanded={moreOpen} aria-controls="mg-more" onClick={() => setMoreOpen((o) => !o)} className="min-h-12 rounded-xl border border-[var(--mg-line)] px-4 text-[16px] text-[var(--mg-dim)]" data-testid="mg-more">
                    {"More ▾"}
                  </button>
                  <div id="mg-more" hidden={!moreOpen} className="mg-glass absolute bottom-14 left-0 z-10 w-64 bg-[var(--mg-glass-strong)] p-2">
                    {current.status === "active" ? (
                      <>
                        <button type="button" disabled={paused} onClick={() => { setMoreOpen(false); setForm({ kind: "skip-step", index: current.step }); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--mg-surface)] disabled:opacity-40" data-testid="mg-skip-step">
                          {`Skip step ${current.step + 1}…`}
                        </button>
                        <button type="button" onClick={() => { setMoreOpen(false); setForm({ kind: "note", index: current.step }); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--mg-surface)]" data-testid="mg-add-note">
                          {`Note on step ${current.step + 1}…`}
                        </button>
                        <button type="button" onClick={() => { setMoreOpen(false); setPanel("steps"); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--mg-surface)]" data-testid="mg-open-steps">
                          {"All steps…"}
                        </button>
                      </>
                    ) : null}
                    <button type="button" onClick={() => { setMoreOpen(false); onEvidence(current.taskId); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--mg-surface)]">
                      {"Why this action? (evidence)"}
                    </button>
                    <button type="button" onClick={() => { setMoreOpen(false); setForm({ kind: "skip-action", index: current.step }); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--mg-surface)]" data-testid="mg-skip">
                      {"Skip this action…"}
                    </button>
                  </div>
                </div>
              </div>
              {form ? (
                <StepForm
                  key={`${form.kind}-${form.index}`}
                  kind={form.kind}
                  stepNumber={form.index + 1}
                  initialNote={records[form.index]?.note ?? ""}
                  onCancel={closeForm}
                  onSubmit={(text) => {
                    if (form.kind === "skip-step") onSkipStep(text, form.index);
                    else if (form.kind === "note") onNote(form.index, text);
                    else onSkip(text);
                    closeForm();
                  }}
                />
              ) : null}
            </>
          ) : (
            <>
              <h2 id="mg-current-title" className="text-[28px] font-semibold">
                {"Simulated plan complete"}
              </h2>
              <p className="mt-2 text-[var(--mg-dim)]">{"Return to planning to build another plan."}</p>
              <div className="mt-auto pt-6">
                <button ref={primaryRef} type="button" onClick={primary.onClick} className="min-h-16 rounded-2xl bg-[var(--mg-coral)] px-8 text-xl font-semibold text-[#1a0f0c]" data-testid={primary.testId}>
                  {primary.label}
                </button>
              </div>
            </>
          )}
        </section>

        {/* 4: essential constraints; then optional panels. */}
        <div className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          <section className="mg-glass p-4" aria-label="Constraints" data-testid="mg-constraints">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-[13px] text-[var(--mg-faint)]">{"Available"}</dt>
                <dd className="text-2xl font-semibold" data-testid="mg-effort-left">
                  {`${available}`}
                </dd>
              </div>
              <div>
                <dt className="text-[13px] text-[var(--mg-faint)]">{"This action"}</dt>
                <dd className="text-2xl font-semibold">{view ? `${view.cost}` : "–"}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-[var(--mg-faint)]">{"Plan left"}</dt>
                <dd className={`text-2xl font-semibold ${remainingNeed > available ? "text-[var(--mg-caution)]" : ""}`} data-testid="mg-plan-need">
                  {`${remainingNeed}`}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-center text-[13px] text-[var(--mg-dim)]" data-testid="mg-effort-note">
              {`Simulated effort points. Committed so far: ${consumed} of ${state.budget}. Costs ahead are estimates.`}
            </p>
            {remainingNeed > available ? (
              <p className="mt-2 rounded-lg bg-[rgba(241,200,120,0.12)] px-2 py-1 text-center text-[13px] text-[var(--mg-caution)]" data-testid="mg-warning-budget">
                {`The remaining plan needs ${remainingNeed} pts but only ${available} are available.`}
              </p>
            ) : null}
          </section>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Optional panels">
            {(
              [
                ...(current?.status === "active" ? ([["steps", `Steps (${counts.done + counts.skipped}/${steps.length})`]] as const) : []),
                ["map", "Map"],
                ["caveats", `Caveats (${s.warnings.length})`],
                ["scenario", "Scenario controls"],
                ["log", `Log (${state.log.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-expanded={panel === id}
                onClick={() => toggle(id)}
                className={`min-h-10 rounded-xl border px-3 text-[15px] ${panel === id ? "border-[var(--mg-cyan)] text-[var(--mg-cyan)]" : "border-[var(--mg-line)] text-[var(--mg-dim)]"}`}
                data-testid={`mg-toggle-${id}`}
              >
                {label}
              </button>
            ))}
          </div>

          {panel === "steps" && current?.status === "active" ? (
            <StepsPanel
              labels={steps}
              records={records}
              current={counts.current}
              paused={paused}
              onComplete={(n) => onCompleteStep(n)}
              onSkip={(n) => setForm({ kind: "skip-step", index: n })}
              onNote={(n) => setForm({ kind: "note", index: n })}
            />
          ) : null}
          {panel === "map" ? (
            <section className="mg-glass overflow-hidden" aria-label="Map" data-testid="mg-minimap">
              <p className="px-4 pt-3 text-[13px] text-[var(--mg-faint)]">{"Coral: simulated target · blue: verified NASA/PDS data"}</p>
              <div className="relative mt-2 h-60">{map}</div>
            </section>
          ) : null}
          {panel === "caveats" ? (
            <section className="mg-glass p-4" aria-label="Caveats" data-testid="mg-warnings">
              <ul className="space-y-1.5 text-[15px] text-[var(--mg-dim)]">
                {s.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {panel === "scenario" ? (
            <section className="rounded-2xl border border-dashed border-[var(--mg-line-strong)] p-4" aria-label="Scenario controls" data-testid="mg-scenario-controls">
              <p className="text-[13px] text-[var(--mg-faint)]">{"Demo only: simulate a constraint change."}</p>
              <div className="mt-2 flex flex-col gap-2">
                {s.events.map((e) => (
                  <button key={e.id} type="button" onClick={() => onEvent(e.id)} className="min-h-10 rounded-xl border border-[var(--mg-line)] px-3 text-left text-[15px]" data-testid={`mg-event-${e.id}`}>
                    {e.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {panel === "log" ? (
            <section className="mg-glass p-4 text-[15px]" aria-label="Simulated event log" data-testid="mg-log">
              <ol className="list-decimal space-y-0.5 pl-5 text-[var(--mg-dim)]">
                {state.log.map((l, n) => (
                  <li key={n}>{l}</li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>

      {replan}
    </div>
  );
}
