"use client";

import { useEffect, useRef, useState } from "react";
import { NOTE_MAX, REASON_MAX, type StepRecord } from "@/lib/prototype/mission-glass";

export type StepFormKind = "skip-step" | "note" | "skip-action";

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
  onSubmit,
  onCancel,
}: {
  kind: StepFormKind;
  stepNumber: number;
  initialNote?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(kind === "note" ? initialNote : "");
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const max = kind === "note" ? NOTE_MAX : REASON_MAX;
  const required = kind === "skip-step";
  const label =
    kind === "skip-step"
      ? `Reason for skipping step ${stepNumber} (required)`
      : kind === "skip-action"
        ? "Reason for skipping this whole action (optional)"
        : `Observation note for step ${stepNumber} (optional)`;
  const submit = () => {
    if (required && !text.trim()) return;
    onSubmit(text);
  };
  return (
    <form
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
          {kind === "note" ? "Save note" : kind === "skip-step" ? `Skip step ${stepNumber}` : "Skip action"}
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
 * EVA-1 steps panel: every step of the current action with its state, the
 * recorded skip reason and note, and per-step actions. The step list is the
 * planned procedure; it cannot be edited here.
 */
export function StepsPanel({
  labels,
  records,
  current,
  paused,
  onComplete,
  onSkip,
  onNote,
}: {
  labels: readonly string[];
  records: readonly StepRecord[];
  current: number | null;
  paused: boolean;
  onComplete: (index: number) => void;
  onSkip: (index: number) => void;
  onNote: (index: number) => void;
}) {
  return (
    <section className="mg-glass p-4" aria-label="Steps of the current action" data-testid="mg-steps-panel">
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
              {r.note ? <p className="mt-0.5 text-[13px] text-[var(--mg-dim)]" data-testid={`mg-step-note-${n}`}>{`Your note (simulated): ${r.note}`}</p> : null}
              <div className="mt-1.5 flex flex-wrap gap-2">
                {r.status === "todo" ? (
                  <>
                    <button type="button" disabled={paused} onClick={() => onComplete(n)} className="min-h-9 rounded-lg border border-[var(--mg-line)] px-3 text-[14px] disabled:opacity-40" data-testid={`mg-step-done-${n}`}>
                      {"Mark done"}
                    </button>
                    <button type="button" disabled={paused} onClick={() => onSkip(n)} className="min-h-9 rounded-lg border border-[var(--mg-line)] px-3 text-[14px] disabled:opacity-40" data-testid={`mg-step-skip-${n}`}>
                      {"Skip…"}
                    </button>
                  </>
                ) : null}
                <button type="button" onClick={() => onNote(n)} className="min-h-9 rounded-lg border border-[var(--mg-line)] px-3 text-[14px]" data-testid={`mg-step-note-btn-${n}`}>
                  {r.note ? "Edit note…" : "Note…"}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[13px] text-[var(--mg-faint)]" data-testid="mg-procedure-lock">
        {"These steps are the planned procedure. Changing them or adding new scientific steps needs a separate planning confirmation; the HUD cannot edit the procedure. A done or skipped step changes only through Undo."}
      </p>
      {paused ? <p className="mt-1 text-[13px] text-[var(--mg-caution)]">{"Paused: resume the step to mark or skip steps."}</p> : null}
    </section>
  );
}
