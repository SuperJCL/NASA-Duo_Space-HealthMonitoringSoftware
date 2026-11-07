"use client";

import { useEffect, useRef } from "react";
import { costDifferenceText, type CompareView } from "@/lib/prototype/candidate-compare";
import type { TaskView } from "@/lib/prototype/mission-glass";

const ROW = "grid grid-cols-1 gap-2 border-t border-[var(--mg-line)] py-3 sm:grid-cols-[9.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:gap-4";

/**
 * Candidate comparison (Planning, read-only): two chosen actions on three
 * aligned rows: simulated cost, possible new observation, key unknowns.
 * Side by side from the `sm` breakpoint (first chosen on the left); on a
 * phone each row lists the two actions one above the other. Details use the
 * existing evidence sheet.
 * Choosing actions here changes no score, rank, review state or plan.
 */
export function CandidateCompare({
  open,
  suspended,
  views,
  compare,
  pair,
  onPair,
  onEvidence,
  onClose,
}: {
  open: boolean;
  /** The evidence sheet is open above this one: Escape and outside clicks belong to it. */
  suspended: boolean;
  /** The same engine views as the cards (cost and fit only are read here). */
  views: readonly TaskView[];
  compare: CompareView | null;
  pair: readonly string[];
  onPair: (next: string[]) => void;
  onEvidence: (taskId: string) => void;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open || suspended) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, suspended, onClose]);
  if (!open) return null;

  // Columns follow the order in which the user chose the actions (never the rank order).
  const chosen = pair.map((id) => views.find((v) => v.taskId === id)).filter((v): v is TaskView => Boolean(v));
  const cellOf = (taskId: string) => compare?.cells.find((c) => c.taskId === taskId);
  const toggle = (taskId: string) => onPair(pair.includes(taskId) ? pair.filter((t) => t !== taskId) : [...pair, taskId].slice(-2));
  const sources = (list: string[]) =>
    list.length ? <span className="mt-1 block text-[12px] text-[var(--mg-faint)]">{`Sources: ${list.join("; ")}`}</span> : <span className="mt-1 block text-[12px] text-[var(--mg-faint)]">{"Scenario fact; no source"}</span>;
  const phoneName = (v: TaskView) => <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--mg-coral)] sm:hidden">{v.shortTitle}</p>;
  const draftLabel = <span className="mt-0.5 block text-[12px] font-normal normal-case tracking-normal text-[var(--mg-faint)]">{"SCI-1 draft · pending expert review"}</span>;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-[rgba(8,12,20,0.55)] p-3 sm:items-center" onClick={() => (suspended ? undefined : onClose())}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mg-compare-title"
        data-testid="mg-compare"
        onClick={(e) => e.stopPropagation()}
        className="mg-glass mg-rise flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col bg-[var(--mg-glass-strong)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--mg-line)] p-4">
          <div className="min-w-0">
            <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Step 1 · compare"}</p>
            <h2 id="mg-compare-title" ref={headingRef} tabIndex={-1} className="mt-0.5 text-xl font-semibold focus:outline-none">
              {"Compare two actions"}
            </h2>
            <p className="mt-0.5 text-[14px] text-[var(--mg-dim)]">{"Read-only: choosing here changes no score, rank or plan."}</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-xl border border-[var(--mg-line)] px-4 text-[15px]" data-testid="mg-compare-close">
            {"Close"}
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-4 pb-4" data-testid="mg-compare-body">
          <div role="group" aria-label="Choose two actions" className="flex flex-wrap gap-2 pt-3">
            {views.map((v) => {
              const on = pair.includes(v.taskId);
              return (
                <button
                  key={v.taskId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(v.taskId)}
                  className={`min-h-11 rounded-full border px-4 text-[15px] ${on ? "border-2 border-[var(--mg-coral)] bg-[var(--mg-surface)] font-semibold" : "border-[var(--mg-line-strong)]"}`}
                  data-testid={`mg-compare-pick-${v.taskId}`}
                >
                  {v.shortTitle}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[14px] text-[var(--mg-dim)]" data-testid="mg-compare-hint" aria-live="polite">
            {pair.length < 2 ? `Choose ${2 - pair.length} more action${pair.length === 1 ? "" : "s"} to compare.` : "Two actions chosen. Choosing another replaces the earlier one."}
          </p>

          {chosen.length === 2 ? (
            <div role="table" aria-label={`${chosen[0].shortTitle} compared with ${chosen[1].shortTitle}`} className="mt-2" data-testid="mg-compare-table" data-tasks={chosen.map((v) => v.taskId).join(" ")}>
              {/* Actions and the existing details entry. */}
              <div role="row" className={ROW}>
                <span role="rowheader" className="hidden text-[13px] uppercase tracking-[0.1em] text-[var(--mg-faint)] sm:block">
                  {"Action"}
                </span>
                {chosen.map((v) => (
                  <div key={v.taskId} role="columnheader" className="min-w-0" data-testid={`mg-compare-head-${v.taskId}`}>
                    <h3 className="text-[17px] font-semibold">{v.shortTitle}</h3>
                    <p className="text-[13px] text-[var(--mg-dim)]">{v.platformText}</p>
                    <button type="button" onClick={() => onEvidence(v.taskId)} className="mt-1 min-h-10 text-[14px] text-[var(--mg-coral)] underline-offset-4 hover:underline" data-testid={`mg-compare-evidence-${v.taskId}`}>
                      {"Evidence and sources →"}
                    </button>
                  </div>
                ))}
              </div>

              {/* 1. Simulated cost (existing engine views). */}
              <div role="row" className={ROW} data-testid="mg-compare-row-cost">
                <span role="rowheader" className="text-[13px] font-medium uppercase tracking-[0.1em] text-[var(--mg-faint)]">
                  {"Simulated cost"}
                  <span className="mt-0.5 block text-[12px] font-normal normal-case tracking-normal">{"Scenario effort points, not real cost"}</span>
                </span>
                {chosen.map((v) => (
                  <div key={v.taskId} role="cell" className="min-w-0 rounded-lg bg-[var(--mg-surface)] px-3 py-2 sm:bg-transparent sm:p-0" data-testid={`mg-compare-cost-${v.taskId}`}>
                    {phoneName(v)}
                    <p className="text-2xl font-semibold">{`${v.cost} pts`}</p>
                    <p className={`text-[14px] ${v.status === "fits" ? "text-[var(--mg-dim)]" : "text-[var(--mg-caution)]"}`}>{v.statusText}</p>
                  </div>
                ))}
                <p className="text-[14px] font-medium sm:col-start-2 sm:col-end-4" data-testid="mg-compare-cost-diff">
                  {costDifferenceText({ name: chosen[0].shortTitle, cost: chosen[0].cost }, { name: chosen[1].shortTitle, cost: chosen[1].cost })}
                </p>
              </div>

              {/* 2. Possible new observation (SCI-1 draft). */}
              <div role="row" className={ROW} data-testid="mg-compare-row-observation">
                <span role="rowheader" className="text-[13px] font-medium uppercase tracking-[0.1em] text-[var(--mg-faint)]">
                  {"Possible new observation"}
                  {draftLabel}
                </span>
                {chosen.map((v) => {
                  const c = cellOf(v.taskId);
                  return (
                    <div key={v.taskId} role="cell" className="min-w-0 rounded-lg bg-[var(--mg-surface)] px-3 py-2 sm:bg-transparent sm:p-0" data-testid={`mg-compare-observation-${v.taskId}`}>
                      {phoneName(v)}
                      {c ? (
                        <>
                          <p className="inline-block rounded-full border border-[var(--mg-line-strong)] px-2.5 py-0.5 text-[13px]" data-testid={`mg-compare-mode-${v.taskId}`}>
                            {c.observation.mode}
                          </p>
                          <p className="mt-1.5 text-[15px] font-medium">{c.observation.target}</p>
                          <p className="mt-1 text-[14px] text-[var(--mg-dim)]">{c.observation.note}</p>
                          <p className="mt-1 text-[14px]">
                            <span className="text-[var(--mg-faint)]">{"Instruments: "}</span>
                            {c.observation.instruments}
                          </p>
                          {sources(c.observation.sources)}
                        </>
                      ) : (
                        <p className="text-[14px] text-[var(--mg-dim)]">{"Not available for this evidence date."}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 3. Key unknowns (SCI-1 draft). */}
              <div role="row" className={ROW} data-testid="mg-compare-row-unknowns">
                <span role="rowheader" className="text-[13px] font-medium uppercase tracking-[0.1em] text-[var(--mg-faint)]">
                  {"Key unknowns"}
                  {draftLabel}
                </span>
                {chosen.map((v) => {
                  const c = cellOf(v.taskId);
                  return (
                    <div key={v.taskId} role="cell" className="min-w-0 rounded-lg bg-[var(--mg-surface)] px-3 py-2 sm:bg-transparent sm:p-0" data-testid={`mg-compare-unknowns-${v.taskId}`}>
                      {phoneName(v)}
                      {c ? (
                        <ul className="space-y-2">
                          {c.unknowns.map((u) => (
                            <li key={u.text} className="text-[14px]">
                              {u.text}
                              {sources(u.sources)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[14px] text-[var(--mg-dim)]">{"Not available for this evidence date."}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {compare ? (
            <div className="mt-3 rounded-xl border border-[var(--mg-line)] p-3 text-[13px] text-[var(--mg-dim)]" data-testid="mg-compare-scope">
              <p className="font-medium text-[var(--mg-text)]">{"Scope of the science rows"}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {compare.scope.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
