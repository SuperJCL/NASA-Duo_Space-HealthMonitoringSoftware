"use client";

import { useEffect, useRef } from "react";
import type { ImpactVerdict, ReplanProposal, TaskView } from "@/lib/prototype/mission-glass";
import type { MissionSequence } from "@/lib/prototype/mission-sequence";
import { SequenceDiagram } from "./SequenceViews";

const VERDICT: Record<ImpactVerdict, { label: string; tone: string }> = {
  "kept-done": { label: "Done · kept", tone: "text-[var(--mg-ok)]" },
  fits: { label: "Still fits", tone: "text-[var(--mg-dim)]" },
  "no-longer-fits": { label: "No longer fits", tone: "text-[var(--mg-caution)]" },
  "too-large": { label: "Too large now", tone: "text-[var(--mg-caution)]" },
};

/**
 * MG-3 replanning: Constraint changed → Explain impact → Compare options →
 * Confirm or retain. A modal alert dialog fixed in the viewport: the decision
 * footer is always visible, never below the fold. There is no dismiss-without-
 * deciding (Escape does nothing); both options are explicit and logged.
 */
export function ReplanDialog({
  proposal,
  viewById,
  preview,
  onAccept,
  onKeep,
}: {
  proposal: ReplanProposal;
  viewById: ReadonlyMap<string, TaskView>;
  /** MAP-2: the sequence each option would leave (plan order only). */
  preview?: { suggested: MissionSequence; current: MissionSequence };
  onAccept: () => void;
  onKeep: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [proposal]);
  // Keep Tab inside the dialog while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialogRef.current) return;
      const f = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      const inside = dialogRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const p = proposal;
  const name = (id: string) => viewById.get(id)?.shortTitle ?? id;
  const cost = (id: string) => p.impact.find((i) => i.taskId === id)?.cost ?? 0;
  const over = p.current.overBy > 0;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-[rgba(8,12,20,0.62)] p-3 sm:items-center">
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mg-replan-title"
        aria-describedby="mg-replan-reason"
        data-testid="mg-replan"
        className="mg-glass mg-rise flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col bg-[var(--mg-glass-strong)]"
      >
        <div className="min-h-0 overflow-y-auto p-5" data-testid="mg-replan-body">
          {/* 1. Constraint changed */}
          <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-[var(--mg-caution)] sm:tracking-[0.12em]" data-testid="mg-replan-trigger">
            {`Constraint changed · ${p.trigger.label} (scenario event)`}
          </p>
          <h2 id="mg-replan-title" ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold focus:outline-none">
            {p.noFeasible ? "No remaining action fits" : over ? "Your plan no longer fits" : "The suggested order changed"}
          </h2>
          <p id="mg-replan-reason" className="mt-1 text-[16px] text-[var(--mg-dim)]">
            {p.reason}
          </p>

          {/* Committed vs estimated */}
          <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-[var(--mg-line)] p-3 text-center" data-testid="mg-replan-resources">
            <div>
              <dt className="text-[13px] text-[var(--mg-faint)]">{"Committed (spent)"}</dt>
              <dd className="text-xl font-semibold" data-testid="mg-replan-committed">
                {`${p.committed} pts`}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-[var(--mg-faint)]">{"Available now"}</dt>
              <dd className="text-xl font-semibold" data-testid="mg-replan-available">
                {`${p.available} pts`}
              </dd>
              <dd className="text-[12px] text-[var(--mg-faint)]">{`${p.trigger.to} budget − ${p.committed} committed`}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-[var(--mg-faint)]">{"Remaining plan (estimated)"}</dt>
              <dd className={`text-xl font-semibold ${over ? "text-[var(--mg-caution)]" : ""}`} data-testid="mg-replan-need">
                {`${p.remainingNeed} pts`}
              </dd>
            </div>
          </dl>

          {/* 2. Explain impact */}
          <h3 className="mt-4 text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Impact on your plan"}</h3>
          <ul className="mt-1.5 space-y-1.5" data-testid="mg-replan-impact">
            {p.impact.map((i) => (
              <li key={i.taskId} data-verdict={i.verdict} className="flex flex-wrap items-baseline gap-x-3 rounded-lg bg-[var(--mg-surface)] px-3 py-2">
                <span className="font-medium">{name(i.taskId)}</span>
                <span className={`text-[13px] font-medium ${VERDICT[i.verdict].tone}`}>{VERDICT[i.verdict].label}</span>
                <span className="basis-full text-[14px] text-[var(--mg-dim)]">{i.explanation}</span>
              </li>
            ))}
          </ul>

          {/* 3. Compare options (remaining work only) */}
          <h3 className="mt-4 text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Options for the remaining work"}</h3>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--mg-coral)] p-3" data-testid="mg-option-suggested">
              {p.noFeasible ? (
                <>
                  <p className="font-semibold">{"No feasible alternative"}</p>
                  <p className="mt-1 text-[14px] text-[var(--mg-dim)]" data-testid="mg-no-feasible">
                    {`None of the remaining actions fits the ${p.available} pts available. Ending the remaining work keeps everything completed; the unfinished actions are marked "dropped by replan", not deleted.`}
                  </p>
                  {preview ? <SequenceDiagram sequence={preview.suggested} testId="mg-replan-seq-suggested" caption="No remaining sequence: nothing new is drawn. Completed work stays." /> : null}
                </>
              ) : (
                <>
                  <p className="font-semibold">{"Suggested"}</p>
                  <ol className="mt-1 list-decimal pl-5 text-[15px]" data-testid="mg-replan-suggested">
                    {p.suggested.order.map((id) => (
                      <li key={id}>{`${name(id)} · ${cost(id)} pts`}</li>
                    ))}
                  </ol>
                  <p className="mt-1 text-[14px] text-[var(--mg-ok)]">{`Fits: ${p.suggested.total} of ${p.available} pts.`}</p>
                  {p.suggested.dropped.length ? (
                    <p className="mt-1 text-[14px] text-[var(--mg-dim)]" data-testid="mg-replan-dropped">
                      {`Dropped by this replan (kept in the plan, can be undone): ${p.suggested.dropped.map(name).join(", ")}.`}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[13px] text-[var(--mg-faint)]">{"Order from the existing engine: provisional, not scientifically validated."}</p>
                  {preview ? <SequenceDiagram sequence={preview.suggested} testId="mg-replan-seq-suggested" caption="Proposed sequence. Numbers: plan order. Not a navigable route." /> : null}
                </>
              )}
            </div>
            <div className="rounded-xl border border-[var(--mg-line)] p-3" data-testid="mg-option-current">
              <p className="font-semibold">{"Keep current plan"}</p>
              <ol className="mt-1 list-decimal pl-5 text-[15px]">
                {p.current.order.map((id) => (
                  <li key={id}>{`${name(id)} · ${cost(id)} pts`}</li>
                ))}
              </ol>
              <p className={`mt-1 text-[14px] ${over ? "text-[var(--mg-caution)]" : "text-[var(--mg-ok)]"}`} data-testid="mg-current-feasibility">
                {over ? `Infeasible: needs ${p.current.total} pts, ${p.current.overBy} more than available. Later actions may not be possible.` : `Fits: ${p.current.total} of ${p.available} pts.`}
              </p>
              {preview ? <SequenceDiagram sequence={preview.current} testId="mg-replan-seq-current" caption="Current sequence. Numbers: plan order; yellow dashed: does not fit." /> : null}
            </div>
          </div>
        </div>

        {/* 4. Confirm or retain: always visible. */}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--mg-line)] p-4 sm:flex-row sm:items-center sm:justify-end" data-testid="mg-replan-actions">
          <button type="button" onClick={onKeep} className="min-h-12 w-full rounded-xl border border-[var(--mg-line-strong)] px-5 text-[16px] sm:w-auto" data-testid="mg-keep-plan">
            {over ? "Keep current plan anyway" : "Keep current plan"}
          </button>
          <button type="button" onClick={onAccept} className="min-h-12 w-full rounded-xl bg-[var(--mg-coral)] px-6 text-[16px] font-semibold text-[#1a0f0c] sm:w-auto" data-testid="mg-accept-replan">
            {p.noFeasible ? "End remaining work" : "Use suggested plan"}
          </button>
        </div>
      </section>
    </div>
  );
}
