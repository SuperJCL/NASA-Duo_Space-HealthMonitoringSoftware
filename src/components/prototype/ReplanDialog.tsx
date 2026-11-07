"use client";

import { useEffect, useRef, useState } from "react";
import { replanAffected, replanChoiceOutcome, type ImpactVerdict, type ReplanChoice, type ReplanProposal, type TaskView } from "@/lib/prototype/mission-glass";
import type { MissionSequence } from "@/lib/prototype/mission-sequence";
import { SequenceDiagram } from "./SequenceViews";

const VERDICT: Record<ImpactVerdict, { label: string; tone: string }> = {
  "kept-done": { label: "Done · kept", tone: "text-[var(--mg-ok)]" },
  fits: { label: "Still fits", tone: "text-[var(--mg-dim)]" },
  "no-longer-fits": { label: "No longer fits", tone: "text-[var(--mg-caution)]" },
  "too-large": { label: "Too large now", tone: "text-[var(--mg-caution)]" },
};

/** "A, B and C" */
const listText = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * MG-3 replanning: Constraint changed → Explain impact → Compare options →
 * Choose → Confirm. A modal alert dialog fixed in the viewport: the decision
 * footer is always visible, never below the fold. There is no dismiss-without-
 * deciding (Escape does nothing); both options are explicit and logged.
 *
 * Replan change summary: the old and new budget, which remaining actions are
 * affected, and any tie in the engine's provisional scores (read from the
 * engine's result). Choosing an option only previews it next to the confirm
 * button (kept and removed actions, effort left, new order); nothing is
 * applied until the user confirms.
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

  const [choice, setChoice] = useState<ReplanChoice | null>(null);
  const p = proposal;
  const name = (id: string) => viewById.get(id)?.shortTitle ?? id;
  const cost = (id: string) => p.impact.find((i) => i.taskId === id)?.cost ?? viewById.get(id)?.cost ?? 0;
  const over = p.current.overBy > 0;
  const live = new Set(p.current.order);
  const { affected, stillFits } = replanAffected(p);
  // Only ties that involve the remaining plan are relevant here.
  const ties = p.ties.filter((t) => t.taskIds.some((id) => live.has(id)));
  const outcome = choice ? replanChoiceOutcome(p, choice) : null;
  const doneCount = p.impact.filter((i) => i.status === "done").length;
  const withCosts = (ids: string[]) => ids.map((id) => `${name(id)} (${cost(id)} pts)`).join(", ");
  const choiceLabel: Record<ReplanChoice, string> = {
    suggested: p.noFeasible ? "End remaining work" : "Use suggested plan",
    current: over ? "Keep current plan anyway" : "Keep current plan",
  };

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

          {/* Change summary: old and new budget, the remaining actions affected, engine ties. */}
          <div className="mt-3 rounded-xl border border-[var(--mg-line-strong)] bg-[var(--mg-surface)] p-3" data-testid="mg-replan-summary">
            <p className="text-[17px] font-semibold" data-testid="mg-replan-budget-change">
              {p.trigger.from === p.trigger.to ? `Budget unchanged: ${p.trigger.to} pts` : `Budget: ${p.trigger.from} pts → ${p.trigger.to} pts`}
            </p>
            <ul className="mt-1.5 space-y-1 text-[15px]" data-testid="mg-replan-affected">
              {affected.map((a) => (
                <li key={a.taskId} data-task={a.taskId} data-effect={a.verdict}>
                  <span className="font-medium text-[var(--mg-caution)]">{"Affected: "}</span>
                  {a.verdict === "too-large"
                    ? `${name(a.taskId)} needs ${a.cost} pts, more than the ${p.available} pts now available.`
                    : `${name(a.taskId)} (${a.cost} pts) no longer fits after the actions before it.`}
                </li>
              ))}
              {stillFits.length ? (
                <li data-effect="fits">
                  <span className="font-medium">{"Still fits: "}</span>
                  {withCosts(stillFits.map((x) => x.taskId))}
                  {"."}
                </li>
              ) : null}
              {!affected.length && !stillFits.length ? <li>{"No remaining actions."}</li> : null}
            </ul>
            {ties.map((t) => {
              const outside = t.taskIds.filter((id) => !live.has(id));
              return (
                <p key={t.taskIds.join()} className="mt-2 text-[14px] text-[var(--mg-dim)]" data-testid="mg-replan-tie" data-tasks={t.taskIds.join(" ")}>
                  {`Tied at the current provisional score: ${listText(t.taskIds.map(name))} (${t.scorePct} of 100 each at ${p.available} pts). The engine lists ${name(t.taskIds[0])} first because its simulated cost is lower${t.orderedBy === "cost-then-id" ? " (equal costs keep a fixed order)" : ""}. This is a tie-break, not a scientific preference.${outside.length ? ` ${listText(outside.map(name))} ${outside.length === 1 ? "is" : "are"} not in your plan.` : ""}`}
                </p>
              );
            })}
          </div>

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
            <div className={`rounded-xl border p-3 ${choice === "suggested" ? "border-2 border-[var(--mg-coral)]" : "border-[var(--mg-line)]"}`} data-testid="mg-option-suggested" data-chosen={choice === "suggested"}>
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
            <div className={`rounded-xl border p-3 ${choice === "current" ? "border-2 border-[var(--mg-coral)]" : "border-[var(--mg-line)]"}`} data-testid="mg-option-current" data-chosen={choice === "current"}>
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

        {/* 4. Choose, see what changes, then confirm: always visible. */}
        <div className="border-t border-[var(--mg-line)] p-3 sm:p-4" data-testid="mg-replan-actions">
          <div role="radiogroup" aria-label="Choose how to continue" className="grid grid-cols-2 gap-2">
            {(["suggested", "current"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={choice === c}
                onClick={() => setChoice(c)}
                className={`min-h-12 rounded-xl border px-3 text-[15px] leading-tight ${choice === c ? "border-2 border-[var(--mg-coral)] bg-[var(--mg-surface)] font-semibold" : "border-[var(--mg-line-strong)]"}`}
                data-testid={c === "suggested" ? "mg-choose-suggested" : "mg-choose-current"}
              >
                {choiceLabel[c]}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 text-[14px] leading-snug" aria-live="polite" data-testid="mg-replan-selection" data-choice={choice ?? ""}>
              {outcome ? (
                <>
                  <p data-testid="mg-replan-kept">
                    <span className="font-medium">{"Keeps: "}</span>
                    {outcome.kept.length ? withCosts(outcome.kept) : "none"}
                    {"."}
                  </p>
                  <p data-testid="mg-replan-removed">
                    <span className="font-medium">{"Removes: "}</span>
                    {outcome.removed.length ? `${withCosts(outcome.removed)}, kept in the plan as "dropped by replan" (Undo is offered after confirming).` : "none."}
                  </p>
                  <p data-testid="mg-replan-left" className={outcome.left < 0 ? "text-[var(--mg-caution)]" : ""}>
                    <span className="font-medium">{"After the change: "}</span>
                    {outcome.left < 0 ? `${-outcome.left} pts over the ${p.available} pts available.` : `${outcome.left} of ${p.available} pts left.`}
                  </p>
                  <p data-testid="mg-replan-order">
                    {outcome.orderChanged ? (
                      <>
                        <span className="font-medium">{"New order: "}</span>
                        {outcome.kept.map((id, n) => `${n + 1}. ${name(id)}`).join(" → ")}
                      </>
                    ) : (
                      "Order unchanged."
                    )}
                    {doneCount ? ` Completed actions (${doneCount}) are not changed.` : ""}
                  </p>
                </>
              ) : (
                <p className="text-[var(--mg-dim)]">{"Choose an option to see what it keeps and removes. Nothing changes until you confirm."}</p>
              )}
            </div>
            <button
              type="button"
              disabled={!choice}
              onClick={() => (choice === "suggested" ? onAccept() : choice === "current" ? onKeep() : undefined)}
              className="min-h-12 w-full shrink-0 rounded-xl bg-[var(--mg-coral)] px-6 text-[16px] font-semibold text-[#1a0f0c] disabled:opacity-40 sm:w-auto"
              data-testid="mg-confirm-replan"
            >
              {choice === "suggested" ? (p.noFeasible ? "Confirm: end remaining work" : "Confirm: use suggested plan") : choice === "current" ? "Confirm: keep current plan" : "Confirm"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
