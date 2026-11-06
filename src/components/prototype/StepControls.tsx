"use client";

import { useEffect, useRef, useState } from "react";
import { NOTE_MAX, REASON_MAX, type StepRecord } from "@/lib/prototype/mission-glass";

export type StepFormKind = "skip-step" | "note" | "skip-action" | "reason";

const QUICK_REASONS = ["Not needed for this target", "Equipment issue (simulated)", "Time constraint (simulated)"] as const;

/**
 * EVA-1 inline form: a reason for skipping a step (required) or the action
 * (optional), or the user's own simulated observation note. Enter submits,
 * Escape cancels.
 */
export function StepForm({
  kind,
  stepNumber,
  initialNote = "",
  caution = null,
  onSubmit,
  onCancel,
}: {
  kind: StepFormKind;
  stepNumber: number;
  /** Prefill: the note (note) or the current skip reason (reason). */
  initialNote?: string;
  /** EVA-1.2: neutral caution shown before a step is skipped. */
  caution?: string | null;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(kind === "note" || kind === "reason" ? initialNote : "");
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "nearest" });
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  const max = kind === "note" ? NOTE_MAX : REASON_MAX;
  const required = kind === "skip-step" || kind === "reason";
  const label =
    kind === "skip-step"
      ? `Reason for skipping step ${stepNumber} (required)`
      : kind === "reason"
        ? `Correct the skip reason of step ${stepNumber} (required)`
        : kind === "skip-action"
          ? "Reason for skipping this whole action (optional)"
          : `Observation note for step ${stepNumber} (optional)`;
  const submit = () => {
    if (required && !text.trim()) return;
    onSubmit(text);
  };
  return (
    <form
      ref={formRef}
      className="mt-4 rounded-2xl border border-[var(--mg-line-strong)] bg-[var(--mg-surface)] p-4"
      data-testid={`mg-form-${kind}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <label htmlFor="mg-step-input" className="block text-[15px] font-medium">
        {label}
      </label>
      {kind === "note" ? (
        <>
          <p className="mt-0.5 text-[13px] text-[var(--mg-dim)]">{"Your own words, kept in this simulated session only. Not measured data and not used by the ranking."}</p>
          <textarea
            id="mg-step-input"
            ref={inputRef}
            value={text}
            maxLength={max}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="mt-2 w-full rounded-xl border border-[var(--mg-line-strong)] bg-[var(--mg-bg)] p-3 text-[16px]"
            data-testid="mg-step-input"
          />
        </>
      ) : (
        <>
          {kind === "skip-step" ? (
            <p className="mt-1 text-[13px] text-[var(--mg-dim)]">{"The step is recorded as skipped, not done: its measurement is not made. You can reopen it later."}</p>
          ) : null}
          {caution ? (
            <p className="mt-1 rounded-lg bg-[rgba(241,200,120,0.1)] px-2 py-1 text-[13px] text-[var(--mg-caution)]" data-testid="mg-skip-caution-form">
              {caution}
            </p>
          ) : null}
          {kind === "skip-step" || kind === "reason" ? (
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Common reasons">
              {QUICK_REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setText(r)} className="min-h-10 rounded-xl border border-[var(--mg-line)] px-3 text-[14px] text-[var(--mg-dim)] hover:text-[var(--mg-text)]">
                  {r}
                </button>
              ))}
            </div>
          ) : null}
          <input
            id="mg-step-input"
            ref={inputRef}
            value={text}
            maxLength={max}
            onChange={(e) => setText(e.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--mg-line-strong)] bg-[var(--mg-bg)] p-3 text-[16px]"
            data-testid="mg-step-input"
          />
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[12px] text-[var(--mg-faint)]">{`${text.length}/${max}`}</span>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-[var(--mg-line)] px-4" data-testid="mg-form-cancel">
          {"Cancel"}
        </button>
        <button
          type="submit"
          disabled={required && !text.trim()}
          className="min-h-11 rounded-xl border border-[var(--mg-coral)] px-4 font-medium text-[var(--mg-coral)] disabled:opacity-40"
          data-testid="mg-form-submit"
        >
          {kind === "note" ? "Save note" : kind === "skip-step" ? `Skip step ${stepNumber}` : kind === "reason" ? "Save reason" : "Skip action"}
        </button>
      </div>
    </form>
  );
}

const STATE_TEXT: Record<"done" | "skipped" | "current" | "paused" | "todo", string> = {
  done: "Done",
  skipped: "Skipped",
  current: "Current",
  paused: "Paused",
  todo: "To do",
};

/**
 * EVA-1 steps panel: every step of an action with its state, the recorded
 * skip reason and note, and per-step actions. EVA-1.1: completed actions can
 * be chosen too, and a done or skipped step can be reopened (after a
 * confirmation). The step list is the planned procedure; it cannot be edited
 * here.
 */
export function StepsPanel({
  actions,
  selectedTaskId,
  onSelectAction,
  labels,
  records,
  current,
  paused,
  editable,
  onComplete,
  onSkip,
  onNote,
  onReopen,
  onEditReason,
  outcome = null,
}: {
  /** EVA-1.2: correct the reason of a skipped step (action in progress). */
  onEditReason: (index: number) => void;
  /** EVA-1.2: execution outcome of an ended action, e.g. "Ended with 1 of 4 step(s) skipped…". */
  outcome?: string | null;
  /** Actions whose steps can be shown: the one in progress and completed ones. */
  actions: readonly { taskId: string; label: string }[];
  selectedTaskId: string;
  onSelectAction: (taskId: string) => void;
  labels: readonly string[];
  records: readonly StepRecord[];
  current: number | null;
  paused: boolean;
  /** The shown action is the one in progress (steps can be marked, skipped and noted). */
  editable: boolean;
  onComplete: (index: number) => void;
  onSkip: (index: number) => void;
  onNote: (index: number) => void;
  onReopen: (index: number) => void;
}) {
  return (
    <div data-testid="mg-steps-panel">
      {actions.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Show the steps of">
          {actions.map((a) => (
            <button
              key={a.taskId}
              type="button"
              aria-pressed={a.taskId === selectedTaskId}
              onClick={() => onSelectAction(a.taskId)}
              className={`min-h-9 rounded-lg border px-2.5 text-[13px] ${a.taskId === selectedTaskId ? "border-[var(--mg-text)] text-[var(--mg-text)]" : "border-[var(--mg-line)] text-[var(--mg-dim)]"}`}
              data-testid={`mg-steps-of-${a.taskId}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      {outcome ? (
        <p className="mb-2 text-[13px] text-[var(--mg-dim)]" data-testid="mg-steps-outcome">
          {outcome}
        </p>
      ) : null}
      <ol className="space-y-2">
        {labels.map((label, n) => {
          const r = records[n] ?? { status: "todo" as const };
          const state = r.status !== "todo" ? r.status : n === current ? (paused ? "paused" : "current") : "todo";
          return (
            <li key={label} data-state={state} className="rounded-xl bg-[var(--mg-surface)] px-3 py-2" data-testid={`mg-step-row-${n}`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{`${n + 1}. ${label}`}</span>
                <span
                  className={`text-[13px] ${state === "done" ? "text-[var(--mg-ok)]" : state === "skipped" ? "text-[var(--mg-faint)]" : state === "paused" ? "text-[var(--mg-caution)]" : state === "current" ? "text-[var(--mg-coral)]" : "text-[var(--mg-dim)]"}`}
                >
                  {STATE_TEXT[state]}
                </span>
              </div>
              {r.reason ? <p className="mt-0.5 text-[13px] text-[var(--mg-dim)]">{`Skip reason: ${r.reason}`}</p> : null}
              {r.history?.length ? (
                <p className="mt-0.5 text-[13px] text-[var(--mg-faint)]" data-testid={`mg-step-history-${n}`}>
                  {`Earlier: ${r.history.map((h) => (h.status === "done" ? "done" : `skipped (${h.reason ?? "no reason"})`)).join(", then ")}; reopened.`}
                </p>
              ) : null}
              {r.note ? <p className="mt-0.5 text-[13px] text-[var(--mg-dim)]" data-testid={`mg-step-note-${n}`}>{`Your note (simulated): ${r.note}`}</p> : null}
              <div className="mt-1.5 flex flex-wrap gap-2">
                {editable && r.status === "skipped" ? (
                  <button type="button" onClick={() => onEditReason(n)} className="min-h-9 rounded-lg border border-[var(--mg-line)] px-3 text-[14px]" data-testid={`mg-step-reason-${n}`}>
                    {"Edit reason…"}
                  </button>
                ) : null}
                {r.status !== "todo" ? (
                  <button type="button" onClick={() => onReopen(n)} className="min-h-9 rounded-lg border border-[var(--mg-line)] px-3 text-[14px]" data-testid={`mg-step-reopen-${n}`}>
                    {"Reopen…"}
                  </button>
                ) : null}
                {editable && r.status === "todo" ? (
                  <>
                    <button type="button" disabled={paused} onClick={() => onComplete(n)} className="min-h-9 rounded-lg border border-[var(--mg-line)] px-3 text-[14px] disabled:opacity-40" data-testid={`mg-step-done-${n}`}>
                      {"Mark done"}
                    </button>
                    <button type="button" disabled={paused} onClick={() => onSkip(n)} className="min-h-9 rounded-lg border border-[var(--mg-line)] px-3 text-[14px] disabled:opacity-40" data-testid={`mg-step-skip-${n}`}>
                      {"Skip…"}
                    </button>
                  </>
                ) : null}
                {editable ? (
                  <button type="button" onClick={() => onNote(n)} className="min-h-9 rounded-lg border border-[var(--mg-line)] px-3 text-[14px]" data-testid={`mg-step-note-btn-${n}`}>
                    {r.note ? "Edit note…" : "Note…"}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[13px] text-[var(--mg-faint)]" data-testid="mg-procedure-lock">
        {"These steps are the planned procedure. Changing them or adding new scientific steps needs a separate planning confirmation; the HUD cannot edit the procedure. A done or skipped step can be reopened (with a confirmation) or undone."}
      </p>
      {paused && editable ? <p className="mt-1 text-[13px] text-[var(--mg-caution)]">{"Paused: resume the step to mark or skip steps."}</p> : null}
    </div>
  );
}

/**
 * EVA-1.1: explicit confirmation before a step is reopened. The lines come
 * from `reopenEffects` and say what changes (current step, committed effort,
 * an action set aside). Escape cancels.
 */
export function ReopenConfirm({
  title,
  stepNumber,
  execution,
  accounting,
  feasibility,
  affectsPlan,
  onConfirm,
  onCancel,
}: {
  title: string;
  stepNumber: number;
  /** EVA-1.2: what happens to the step and the action. */
  execution: readonly string[];
  /** EVA-1.2: what happens to the simulated effort accounting (kept separate from execution). */
  accounting: readonly string[];
  /** EVA-1.2: feasibility of the remaining plan after reopening (completed actions only). */
  feasibility: string | null;
  affectsPlan: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // Bring the whole confirmation, including its buttons, into view; then focus its heading.
    boxRef.current?.scrollIntoView({ block: "nearest" });
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={boxRef}
      role="group"
      aria-labelledby="mg-reopen-title"
      className={`mt-4 rounded-2xl border p-4 ${affectsPlan ? "border-[var(--mg-caution)] bg-[rgba(241,200,120,0.08)]" : "border-[var(--mg-line-strong)] bg-[var(--mg-surface)]"}`}
      data-testid="mg-reopen-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <h3 id="mg-reopen-title" ref={headingRef} tabIndex={-1} className="text-[17px] font-semibold focus:outline-none">
        {`Reopen step ${stepNumber} of ${title}?`}
      </h3>
      {affectsPlan ? <p className="mt-1 text-[14px] font-medium text-[var(--mg-caution)]">{"This changes your confirmed plan and committed effort."}</p> : null}
      <div data-testid="mg-reopen-effects">
        <h4 className="mt-2 text-[12px] uppercase tracking-[0.1em] text-[var(--mg-faint)]">{"Execution"}</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] text-[var(--mg-dim)]" data-testid="mg-reopen-execution">
          {execution.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <h4 className="mt-2 text-[12px] uppercase tracking-[0.1em] text-[var(--mg-faint)]">{"Simulated effort accounting"}</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] text-[var(--mg-dim)]" data-testid="mg-reopen-accounting">
          {accounting.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {feasibility ? (
          <>
            <h4 className="mt-2 text-[12px] uppercase tracking-[0.1em] text-[var(--mg-faint)]">{"Feasibility after reopening"}</h4>
            <p className="mt-1 text-[14px] text-[var(--mg-dim)]" data-testid="mg-reopen-feasibility">
              {feasibility}
            </p>
          </>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-[var(--mg-line)] px-4" data-testid="mg-reopen-cancel">
          {"Cancel"}
        </button>
        <button type="button" onClick={onConfirm} className="min-h-11 rounded-xl border border-[var(--mg-coral)] px-4 font-medium text-[var(--mg-coral)]" data-testid="mg-reopen-yes">
          {`Reopen step ${stepNumber}`}
        </button>
      </div>
    </section>
  );
}

/** EVA-1.1: header of an expanded optional panel, with its own Collapse control. */
export function PanelHeader({ title, onCollapse }: { title: string; onCollapse: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{title}</h3>
      <button type="button" onClick={onCollapse} className="min-h-9 shrink-0 whitespace-nowrap rounded-lg border border-[var(--mg-line)] px-3 text-[13px] text-[var(--mg-dim)] hover:text-[var(--mg-text)]" data-testid="mg-panel-collapse">
        {"Collapse ▴"}
      </button>
    </div>
  );
}
