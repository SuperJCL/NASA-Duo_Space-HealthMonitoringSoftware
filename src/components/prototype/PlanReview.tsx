"use client";

import { useEffect, useRef } from "react";
import type { PlanFit, TaskView } from "@/lib/prototype/mission-glass";

/**
 * MG-1 review step: an understandable plan summary before confirmation.
 * Reorder or remove here; "Create plan" is the only primary action.
 */
export function PlanReview({
  open,
  fit,
  budget,
  viewById,
  onMove,
  onRemove,
  onCreate,
  onClose,
}: {
  open: boolean;
  fit: PlanFit;
  budget: number;
  viewById: ReadonlyMap<string, TaskView>;
  onMove: (taskId: string, by: -1 | 1) => void;
  onRemove: (taskId: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);
  // Escape closes even when focus was lost (e.g. a reordered row moved in the DOM).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const ok = fit.items.length > 0 && fit.overBy === 0;
  return (
    <div className="absolute inset-0 z-20 flex items-end bg-[rgba(8,12,20,0.55)] p-3 lg:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mg-review-title"
        data-testid="mg-review"
        onClick={(e) => e.stopPropagation()}
        className="mg-glass mg-rise w-full bg-[var(--mg-glass-strong)] p-5"
      >
        <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Step 3 · review"}</p>
        <h2 id="mg-review-title" ref={headingRef} tabIndex={-1} className="mt-0.5 text-xl font-semibold focus:outline-none">
          {"Review your simulated plan"}
        </h2>
        <ol className="mt-3 space-y-2" data-testid="mg-review-list">
          {fit.items.map((it, n) => {
            const v = viewById.get(it.taskId);
            return (
              <li key={it.taskId} className="flex items-center gap-3 rounded-xl bg-[var(--mg-surface)] px-3 py-2">
                <span className="w-5 text-[var(--mg-faint)]">{`${n + 1}.`}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{v?.shortTitle ?? it.taskId}</span>
                  <span className={`block text-[13px] ${it.fits ? "text-[var(--mg-dim)]" : "text-[var(--mg-caution)]"}`}>
                    {`${it.cost} pts · ${it.fits ? `running total ${it.cumulative} of ${budget}` : `over budget at this point (${it.cumulative} of ${budget})`}`}
                  </span>
                </span>
                <span className="flex gap-1">
                  <button type="button" aria-label={`Move ${v?.shortTitle ?? it.taskId} up`} disabled={n === 0} onClick={() => onMove(it.taskId, -1)} className="size-9 rounded-lg border border-[var(--mg-line)] disabled:opacity-30">
                    {"↑"}
                  </button>
                  <button type="button" aria-label={`Move ${v?.shortTitle ?? it.taskId} down`} disabled={n === fit.items.length - 1} onClick={() => onMove(it.taskId, 1)} className="size-9 rounded-lg border border-[var(--mg-line)] disabled:opacity-30">
                    {"↓"}
                  </button>
                  <button type="button" aria-label={`Remove ${v?.shortTitle ?? it.taskId}`} onClick={() => onRemove(it.taskId)} className="size-9 rounded-lg border border-[var(--mg-line)]">
                    {"✕"}
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[15px]" data-testid="mg-review-total">
          {fit.overBy ? `Uses ${fit.total} of ${budget} simulated points: ${fit.overBy} over budget.` : `Uses ${fit.total} of ${budget} simulated points · ${fit.left} left.`}
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-[var(--mg-dim)]">
          <li>{"Order and priorities are provisional (existing engine, not scientifically validated)."}</li>
          <li>{"Targets are scenario-defined positions. No route or safety assessment."}</li>
          <li>{"Creating the plan executes nothing; you run it step by step in the EVA HUD."}</li>
        </ul>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-[var(--mg-line)] px-4" data-testid="mg-review-back">
            {"Back to actions"}
          </button>
          <button type="button" onClick={onCreate} disabled={!ok} className="min-h-11 rounded-xl bg-[var(--mg-coral)] px-5 font-semibold text-[#1a0f0c] disabled:opacity-40" data-testid="mg-create-plan">
            {"Create plan"}
          </button>
        </div>
      </section>
    </div>
  );
}
