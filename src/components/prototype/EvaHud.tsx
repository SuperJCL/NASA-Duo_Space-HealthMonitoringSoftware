"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ACCOUNTING_ASSUMPTION,
  executionOutcome,
  executionText,
  reopenEffects,
  skipCaution,
  stepCounts,
  stepRecords,
  type MgScenario,
  type MissionState,
  type TaskView,
} from "@/lib/prototype/mission-glass";
import { PanelHeader, ReopenConfirm, StepForm, StepsPanel, type StepFormKind } from "./StepControls";

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
type Panel = "map" | "caveats" | "scenario" | "log" | null;

export function EvaHud({
  state,
  s,
  viewById,
  consumed,
  map,
  replan,
  routeStatus,
  onStart,
  onCompleteStep,
  onSkipStep,
  onPause,
  onResume,
  onNote,
  onUndoStep,
  onReopen,
  onSetSkipReason,
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
  /** EVA route & scouting: the approved simulated route's budget (one line), if any. */
  routeStatus?: ReactNode;
  /** Replanning dialog (MG-3), a fixed modal rendered when a proposal exists. */
  replan?: ReactNode;
  onStart: () => void;
  onCompleteStep: (index?: number) => void;
  onSkipStep: (reason: string, index?: number) => void;
  onPause: () => void;
  onResume: () => void;
  onNote: (index: number, note: string) => void;
  onUndoStep: () => void;
  /** EVA-1.1: reopen a done or skipped step (after the user confirmed its effects). */
  onReopen: (taskId: string, index: number) => void;
  /** EVA-1.2: correct a skip reason (action in progress). */
  onSetSkipReason: (index: number, reason: string) => void;
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
  // EVA-1.1: viewing another step (read-only navigation) is separate from reopening one (a confirmed state change).
  const [viewAt, setViewAt] = useState<{ taskId: string; step: number; index: number } | null>(null);
  const [reopenAsk, setReopenAsk] = useState<{ taskId: string; index: number } | null>(null);
  const [stepsFor, setStepsFor] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const toggleRefs = useRef<Partial<Record<Exclude<Panel, null>, HTMLButtonElement | null>>>({});

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
  const stepsOf = (taskId: string) => s.actions.find((a) => a.taskId === taskId)?.steps ?? [];
  const titleOf = (taskId: string) => viewById.get(taskId)?.shortTitle ?? taskId;

  // Read-only step navigation; it is valid only while the action and its current step are unchanged.
  const viewIndex = viewAt && current?.status === "active" && viewAt.taskId === current.taskId && viewAt.step === current.step ? viewAt.index : null;
  const viewing = viewIndex !== null && viewIndex !== stepIndex;
  const shownIndex = viewing ? viewIndex : stepIndex;
  const shownState = records[shownIndex]?.status ?? "todo";

  // Steps panel: the action in progress, or a completed one the user picks.
  const withSteps = items.filter((i) => i.status === "active" || i.status === "done");
  const stepsItem = withSteps.find((i) => i.taskId === stepsFor) ?? withSteps.find((i) => i.status === "active") ?? withSteps.at(-1);
  const stepsLabels = stepsItem ? stepsOf(stepsItem.taskId) : [];
  const stepsRecords = stepsItem ? stepRecords(stepsItem, stepsLabels.length) : [];
  const stepsCounts = stepsItem ? stepCounts(stepsItem, stepsLabels.length) : null;

  // Effects of a pending reopen, for the confirmation.
  const costs = Object.fromEntries([...viewById].map(([id, v]) => [id, v.cost]));
  const stepsByTask = Object.fromEntries(s.actions.map((a) => [a.taskId, a.steps.length]));
  const titles = Object.fromEntries(s.actions.map((a) => [a.taskId, titleOf(a.taskId)]));
  const reopenFx = reopenAsk ? reopenEffects({ state, taskId: reopenAsk.taskId, index: reopenAsk.index, costs, stepsByTask, titles }) : null;

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
  const closeReopen = () => {
    setReopenAsk(null);
    primaryRef.current?.focus({ preventScroll: true });
  };
  /** Collapse an optional panel from inside it, and return focus to its toggle. */
  const collapse = (p: Exclude<Panel, null>) => {
    setPanel(null);
    toggleRefs.current[p]?.focus({ preventScroll: true });
  };
  const retainedOver = state.retained && remainingNeed > available ? remainingNeed - available : 0;

  if (!state.plan) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="mg-glass mg-rise max-w-md p-6 text-center" data-testid="mg-eva-empty">
          <h2 className="text-2xl font-semibold">{"No mission plan yet"}</h2>
          <p className="mt-2 text-[var(--mg-dim)]">{"Create a simulated plan in Planning, then run it here."}</p>
          {routeStatus ? <p className="mt-2">{routeStatus}</p> : null}
          <button type="button" onClick={onBackToPlanning} className="mt-5 min-h-12 rounded-xl bg-[var(--mg-coral)] px-6 text-lg font-semibold text-[#1a0f0c]">
            {"Go to planning"}
          </button>
        </div>
      </div>
    );
  }

  /** EVA-1.3: Reopen is immediate (and undoable) inside the action in progress; a completed action needs confirmation. */
  const reopenFrom = (taskId: string, index: number) => {
    const it = items.find((i) => i.taskId === taskId);
    if (it?.status === "active") {
      onReopen(taskId, index);
      setViewAt(null);
      primaryRef.current?.focus({ preventScroll: true });
    } else setReopenAsk({ taskId, index });
  };
  const checklist =
    stepsItem && stepsCounts ? (
      <StepsPanel
        actions={withSteps.map((i) => ({ taskId: i.taskId, label: `${items.indexOf(i) + 1}. ${titleOf(i.taskId)} · ${i.status === "active" ? "in progress" : "done"}` }))}
        selectedTaskId={stepsItem.taskId}
        onSelectAction={setStepsFor}
        labels={stepsLabels}
        records={stepsRecords}
        current={stepsCounts.current}
        viewing={stepsItem.status === "active" && viewing ? viewIndex : null}
        paused={Boolean(stepsItem.paused)}
        editable={stepsItem.status === "active"}
        onView={(n) => {
          if (stepsItem.status !== "active") return;
          setViewAt(n === stepsItem.step ? null : { taskId: stepsItem.taskId, step: stepsItem.step, index: n });
        }}
        onComplete={(n) => onCompleteStep(n)}
        onSkip={(n) => setForm({ kind: "skip-step", index: n })}
        onNote={(n) => setForm({ kind: "note", index: n })}
        onReopen={(n) => reopenFrom(stepsItem.taskId, n)}
        onEditReason={(n) => setForm({ kind: "reason", index: n })}
        outcome={stepsItem.status === "done" ? executionText(stepsItem, stepsLabels.length) : null}
      />
    ) : null;

  const primary = !current
    ? { label: "Back to planning", onClick: onBackToPlanning, testId: "mg-finish-plan" }
    : viewing
      ? { label: `Back to current step (${stepIndex + 1})`, onClick: () => setViewAt(null), testId: "mg-back-current" }
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
        {routeStatus}
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
          <li key={i.taskId} data-status={i.status} data-drop={i.dropped?.by ?? ""} data-outcome={executionOutcome(i, stepsOf(i.taskId).length) ?? ""} className="min-w-0 flex-1">
            <span
              aria-hidden
              className={`block h-1.5 rounded-full ${
                i.status === "done" ? "bg-[var(--mg-ok)]" : i.status === "active" ? "bg-[var(--mg-coral)]" : i.status === "skipped" ? "bg-[var(--mg-line)]" : "bg-[var(--mg-line-strong)]"
              }`}
            />
            <span className={`mt-1 block truncate text-[13px] ${i.status === "active" ? "text-[var(--mg-text)]" : "text-[var(--mg-faint)]"} ${i.status === "skipped" ? "line-through" : ""}`}>
              {`${n + 1}. ${viewById.get(i.taskId)?.shortTitle ?? i.taskId} · ${
                i.status === "active"
                  ? i.paused
                    ? "paused"
                    : "in progress"
                  : i.status === "skipped"
                    ? i.dropped?.by === "replan"
                      ? "dropped by replan"
                      : "skipped by you"
                    : i.status === "done" && executionOutcome(i, stepsOf(i.taskId).length) === "partial"
                      ? `done · ${stepCounts(i, stepsOf(i.taskId).length).skipped} step(s) skipped`
                      : i.status
              }`}
            </span>
          </li>
        ))}
      </ol>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_21rem]">
        {/* 1–3: current action, current step, single primary action. */}
        {/* EVA-1.2: the card scrolls on wide screens (the page itself does not), so long forms and confirmations stay reachable. */}
        <section className="mg-glass mg-rise flex min-h-0 flex-col self-start p-6 lg:max-h-full lg:overflow-y-auto lg:p-8" aria-labelledby="mg-current-title" data-testid="mg-current">
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
                  {current.status === "active" ? (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        aria-label="View previous step"
                        disabled={shownIndex === 0}
                        onClick={() => setViewAt({ taskId: current.taskId, step: current.step, index: shownIndex - 1 })}
                        className="size-8 rounded-lg border border-[var(--mg-line)] text-[var(--mg-dim)] disabled:opacity-30"
                        data-testid="mg-view-prev"
                      >
                        {"‹"}
                      </button>
                      <button
                        type="button"
                        aria-label="View next step"
                        disabled={shownIndex >= steps.length - 1}
                        onClick={() => setViewAt({ taskId: current.taskId, step: current.step, index: shownIndex + 1 })}
                        className="size-8 rounded-lg border border-[var(--mg-line)] text-[var(--mg-dim)] disabled:opacity-30"
                        data-testid="mg-view-next"
                      >
                        {"›"}
                      </button>
                    </span>
                  ) : null}
                  <p className={`text-[13px] uppercase tracking-[0.12em] ${viewing ? "text-[var(--mg-cyan)]" : paused ? "text-[var(--mg-caution)]" : "text-[var(--mg-coral)]"}`} data-testid="mg-step-label">
                    {current.status !== "active"
                      ? "First step"
                      : viewing
                        ? `Viewing step ${shownIndex + 1} of ${steps.length} · ${shownState === "done" ? "done" : shownState === "skipped" ? "skipped" : "to do"}`
                        : `Step ${stepIndex + 1} of ${steps.length}${paused ? " · paused" : ""}`}
                  </p>
                  {current.status === "active" && counts.done + counts.skipped ? (
                    <span className="text-[13px] text-[var(--mg-dim)]" data-testid="mg-step-counts">
                      {`${counts.done} done${counts.skipped ? ` · ${counts.skipped} skipped` : ""} · ${counts.todo} to do`}
                    </span>
                  ) : null}
                </div>
                <p className={`mt-1 text-[34px] font-semibold leading-tight ${viewing ? "text-[var(--mg-dim)]" : ""}`} data-testid="mg-current-step">
                  {steps[current.status === "active" ? shownIndex : 0]}
                </p>
                {viewing ? (
                  <p className="mt-1 text-[14px] text-[var(--mg-cyan)]" data-testid="mg-viewing">
                    {`Viewing only: this does not change step ${shownIndex + 1}. The current step is still step ${stepIndex + 1}.`}
                  </p>
                ) : null}
                <div className="mt-3 flex gap-1.5" aria-hidden>
                  {steps.map((st, n) => (
                    <span
                      key={st}
                      className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${viewing && n === shownIndex ? "outline outline-2 outline-offset-2 outline-[var(--mg-cyan)] " : ""}${
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
                {current.status === "active" && !viewing && nextTodo !== -1 ? (
                  <p className="mt-2 text-[16px] text-[var(--mg-dim)]" data-testid="mg-next-step">
                    {`Then: ${steps[nextTodo]}`}
                  </p>
                ) : null}
                {current.status === "active" && !viewing && records.slice(0, stepIndex).some((r) => r.status === "skipped") ? (
                  <p className="mt-2 rounded-lg bg-[rgba(241,200,120,0.1)] px-2 py-1 text-[14px] text-[var(--mg-caution)]" data-testid="mg-skip-caution">
                    {`Earlier step ${records
                      .slice(0, stepIndex)
                      .map((r, n) => (r.status === "skipped" ? n + 1 : 0))
                      .filter(Boolean)
                      .join(", ")} was skipped. This step may rely on it; the scenario has no step-dependency data, so check before continuing.`}
                  </p>
                ) : null}
                {current.status === "active" && records[shownIndex]?.note ? (
                  <p className="mt-1 text-[14px] text-[var(--mg-dim)]" data-testid="mg-current-note">
                    {`Your note (simulated): ${records[shownIndex].note}`}
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
                {viewing && shownState !== "todo" ? (
                  <button type="button" onClick={() => reopenFrom(current.taskId, shownIndex)} className="min-h-12 rounded-xl border border-[var(--mg-line-strong)] px-4 text-[16px]" data-testid="mg-reopen-viewed">
                    {`Reopen step ${shownIndex + 1}…`}
                  </button>
                ) : null}
                {current.status === "active" && !paused && !viewing ? (
                  // EVA-1.2: skipping the current step is a visible step control (it was hidden under More).
                  <button
                    type="button"
                    onClick={() => setForm({ kind: "skip-step", index: current.step })}
                    className="min-h-12 rounded-xl border border-[var(--mg-line-strong)] px-4 text-[16px]"
                    data-testid="mg-skip-step"
                  >
                    {`Skip step ${current.step + 1}…`}
                  </button>
                ) : null}
                {current.status === "active" && !paused && !viewing ? (
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
                        <button type="button" onClick={() => { setMoreOpen(false); setForm({ kind: "note", index: current.step }); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--mg-surface)]" data-testid="mg-add-note">
                          {`Note on step ${current.step + 1}…`}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        // The sheet returns focus to whatever had it; the menu item is about to be hidden.
                        primaryRef.current?.focus({ preventScroll: true });
                        onEvidence(current.taskId);
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--mg-surface)]"
                    >
                      {"Why this action? (evidence)"}
                    </button>
                    <button type="button" onClick={() => { setMoreOpen(false); setForm({ kind: "skip-action", index: current.step }); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--mg-surface)]" data-testid="mg-skip">
                      {"Skip this action…"}
                    </button>
                  </div>
                </div>
              </div>
              {reopenAsk && reopenFx?.ok ? (
                <ReopenConfirm
                  key={`${reopenAsk.taskId}-${reopenAsk.index}`}
                  title={titleOf(reopenAsk.taskId)}
                  stepNumber={reopenAsk.index + 1}
                  execution={reopenFx.execution}
                  accounting={reopenFx.accounting}
                  feasibility={reopenFx.feasibility}
                  affectsPlan={reopenFx.affectsPlan}
                  onCancel={closeReopen}
                  onConfirm={() => {
                    onReopen(reopenAsk.taskId, reopenAsk.index);
                    setViewAt(null);
                    closeReopen();
                  }}
                />
              ) : null}
              {form ? (
                <StepForm
                  key={`${form.kind}-${form.index}`}
                  kind={form.kind}
                  stepNumber={form.index + 1}
                  initialNote={form.kind === "reason" ? (records[form.index]?.reason ?? "") : (records[form.index]?.note ?? "")}
                  caution={form.kind === "skip-step" && current.status === "active" ? skipCaution(current, steps.length, form.index) : null}
                  onCancel={closeForm}
                  onSubmit={(text) => {
                    if (form.kind === "skip-step") onSkipStep(text, form.index);
                    else if (form.kind === "reason") onSetSkipReason(form.index, text);
                    else if (form.kind === "note") onNote(form.index, text);
                    else onSkip(text);
                    closeForm();
                  }}
                />
              ) : null}
              {checklist}
            </>
          ) : (
            <>
              <h2 id="mg-current-title" className="text-[28px] font-semibold">
                {"Simulated plan complete"}
              </h2>
              <p className="mt-2 text-[var(--mg-dim)]">{"Return to planning to build another plan."}</p>
              {checklist}
              {reopenAsk && reopenFx?.ok ? (
                <ReopenConfirm
                  key={`${reopenAsk.taskId}-${reopenAsk.index}`}
                  title={titleOf(reopenAsk.taskId)}
                  stepNumber={reopenAsk.index + 1}
                  execution={reopenFx.execution}
                  accounting={reopenFx.accounting}
                  feasibility={reopenFx.feasibility}
                  affectsPlan={reopenFx.affectsPlan}
                  onCancel={closeReopen}
                  onConfirm={() => {
                    onReopen(reopenAsk.taskId, reopenAsk.index);
                    closeReopen();
                  }}
                />
              ) : null}
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
            {items.some((i) => executionOutcome(i, stepsOf(i.taskId).length) === "partial") ? (
              <p className="mt-2 text-center text-[12px] text-[var(--mg-faint)]" data-testid="mg-accounting-note">
                {`Includes an action that ended with skipped steps. ${ACCOUNTING_ASSUMPTION}`}
              </p>
            ) : null}
            {remainingNeed > available ? (
              <p className="mt-2 rounded-lg bg-[rgba(241,200,120,0.12)] px-2 py-1 text-center text-[13px] text-[var(--mg-caution)]" data-testid="mg-warning-budget">
                {`The remaining plan needs ${remainingNeed} pts but only ${available} are available.`}
              </p>
            ) : null}
          </section>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Optional panels">
            {(
              [
                ["map", "Map"],
                ["caveats", `Caveats (${s.warnings.length})`],
                ["scenario", "Scenario controls"],
                ["log", `Log (${state.log.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                ref={(el) => {
                  toggleRefs.current[id] = el;
                }}
                aria-expanded={panel === id}
                onClick={() => toggle(id)}
                className={`min-h-10 rounded-xl border px-3 text-[15px] ${panel === id ? "border-[var(--mg-cyan)] text-[var(--mg-cyan)]" : "border-[var(--mg-line)] text-[var(--mg-dim)]"}`}
                data-testid={`mg-toggle-${id}`}
              >
                {label}
              </button>
            ))}
          </div>

          {panel === "map" ? (
            <section className="mg-glass overflow-hidden" aria-label="Map" data-testid="mg-minimap">
              <div className="px-4 pt-3">
                <PanelHeader title="Map" onCollapse={() => collapse("map")} />
              </div>
              <p className="px-4 text-[13px] text-[var(--mg-faint)]">{"Coral: simulated target · blue: verified NASA/PDS data"}</p>
              <p className="px-4 text-[13px] font-medium text-[var(--mg-coral)]" data-testid="mg-eva-seq-label">
                {"Coral line: conceptual mission sequence (plan order), not a navigable route. Bold: to the current action · green: completed."}
              </p>
              <div className="relative mt-2 h-60">{map}</div>
            </section>
          ) : null}
          {panel === "caveats" ? (
            <section className="mg-glass p-4" aria-label="Caveats" data-testid="mg-warnings">
              <PanelHeader title="Caveats" onCollapse={() => collapse("caveats")} />
              <ul className="space-y-1.5 text-[15px] text-[var(--mg-dim)]">
                {s.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {panel === "scenario" ? (
            <section className="rounded-2xl border border-dashed border-[var(--mg-line-strong)] p-4" aria-label="Scenario controls" data-testid="mg-scenario-controls">
              <PanelHeader title="Scenario controls" onCollapse={() => collapse("scenario")} />
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
              <PanelHeader title="Simulated event log" onCollapse={() => collapse("log")} />
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
