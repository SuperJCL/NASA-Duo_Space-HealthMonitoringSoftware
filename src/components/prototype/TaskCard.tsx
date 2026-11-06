"use client";

import { useEffect, useRef } from "react";
import type { Addability, SimulatedTarget, TaskView } from "@/lib/prototype/mission-glass";

/**
 * MG-1 task card.
 * Level 1 (always visible): provisional rank, action, one-line rationale,
 *   cost vs budget, and a plain-language feasibility line.
 * Level 2 (Details): what, equipment, target, priority conditions, limitations.
 * Level 3 is the evidence sheet (onEvidence).
 * Only one control per card competes for attention: the add/remove toggle.
 */
export function TaskCard({
  view,
  target,
  selected,
  addable,
  expanded,
  limitations,
  locked = false,
  onSelect,
  onTogglePlan,
  onToggleExpand,
  onEvidence,
}: {
  view: TaskView;
  target: SimulatedTarget | undefined;
  selected: boolean;
  addable: Addability;
  expanded: boolean;
  limitations: string[];
  /** A plan exists: the card shows plan state and cannot change the draft (MAP-1 consistency fix). */
  locked?: boolean;
  onSelect: () => void;
  onTogglePlan: () => void;
  onToggleExpand: () => void;
  onEvidence: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // Map → card: bring the selected card into view, but only inside a list
  // that scrolls on its own (wide layout). On phones the page itself scrolls,
  // and jumping away from the map would hide the target the user just chose.
  useEffect(() => {
    const list = ref.current?.closest<HTMLElement>('[data-testid="mg-cards"]');
    if (selected && list && list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY !== "visible")
      ref.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [selected]);

  const inPlan = addable.state === "in-plan";
  const blocked = addable.state === "infeasible" || addable.state === "no-room";
  const pct = Math.min(100, Math.round((view.cost / Math.max(view.budget, 1)) * 100));
  const tone = blocked ? "text-[var(--mg-caution)]" : inPlan ? "text-[var(--mg-coral)]" : "text-[var(--mg-dim)]";

  return (
    <article
      ref={ref}
      data-testid={`mg-card-${view.taskId}`}
      data-selected={selected}
      data-rank={view.rank ?? ""}
      data-addable={addable.state}
      className={`rounded-2xl border p-4 transition-[background-color,border-color] duration-200 ease-out ${
        selected ? "border-[var(--mg-coral)] bg-[var(--mg-surface)]" : "border-[var(--mg-line)] bg-[var(--mg-glass)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-label={view.rank ? `Provisional priority ${view.rank}` : "Not ranked under current budget"}
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border text-base font-semibold ${
            view.rank ? "border-[var(--mg-line-strong)]" : "border-dashed border-[var(--mg-line)] text-[var(--mg-faint)]"
          }`}
        >
          {view.rank ? `${view.rank}` : "–"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <button
              type="button"
              onClick={onSelect}
              aria-pressed={selected}
              className="text-left text-[17px] font-semibold leading-snug hover:underline focus-visible:underline focus:outline-none"
              data-testid="mg-select"
            >
              {view.shortTitle}
            </button>
            <span className="shrink-0 text-sm text-[var(--mg-dim)]" data-testid="mg-cost">
              {`${view.cost} pts`}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[var(--mg-dim)]" data-testid="mg-rationale">
            {view.rationale.replace(/ · \d+ pts$/, "")}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--mg-line)]" aria-hidden>
            <div className={`h-full rounded-full ${blocked ? "bg-[var(--mg-caution)]" : "bg-[var(--mg-cyan)]"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className={`mt-1.5 text-[13px] ${tone}`} data-testid="mg-status">
            {addable.text}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-controls={`mg-detail-${view.taskId}`}
          data-testid="mg-expand"
          className="text-sm text-[var(--mg-dim)] underline-offset-2 hover:text-[var(--mg-text)] hover:underline"
        >
          {expanded ? "Hide details" : "Details"}
        </button>
        {locked ? (
          <span className={`text-sm ${inPlan ? "text-[var(--mg-coral)]" : "text-[var(--mg-faint)]"}`} data-testid="mg-plan-locked">
            {inPlan ? "In the plan" : "Not in the plan"}
          </span>
        ) : (
          <button
            type="button"
            onClick={onTogglePlan}
            disabled={blocked && !inPlan}
            aria-pressed={inPlan}
            data-testid="mg-plan-toggle"
            className={`min-h-10 rounded-xl border px-4 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              inPlan ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] text-[var(--mg-coral)]" : "border-[var(--mg-line-strong)] text-[var(--mg-text)] hover:border-[var(--mg-coral)]"
            }`}
          >
            {inPlan ? "✓ Added · remove" : "Add to plan"}
          </button>
        )}
      </div>

      {/* Level 2: animated height via grid rows; content stays mounted for state. */}
      <div
        id={`mg-detail-${view.taskId}`}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        aria-hidden={!expanded}
        data-testid="mg-detail"
      >
        <div className="overflow-hidden">
          <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-[var(--mg-faint)]">{"What"}</dt>
            <dd>{view.description}</dd>
            <dt className="text-[var(--mg-faint)]">{"Equipment"}</dt>
            <dd>{view.platformText}</dd>
            <dt className="text-[var(--mg-faint)]">{"Target"}</dt>
            <dd data-testid="mg-target">
              {target
                ? `${target.name}: scenario-defined position, ${target.distanceFromAnchorM} m straight-line from the verified Lefroy Bay site. No route or safety assessment.`
                : "No target"}
            </dd>
            <dt className="text-[var(--mg-faint)]">{"Priority holds"}</dt>
            <dd>
              <ul className="space-y-0.5" data-testid="mg-conditions">
                {view.conditions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </dd>
            <dt className="text-[var(--mg-faint)]">{"Limitations"}</dt>
            <dd>
              <ul className="list-disc space-y-0.5 pl-4 text-[var(--mg-dim)]">
                {limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </dd>
          </dl>
          <button
            type="button"
            onClick={onEvidence}
            data-testid="mg-evidence"
            tabIndex={expanded ? 0 : -1}
            className="mt-3 text-sm text-[var(--mg-cyan)] underline underline-offset-2"
          >
            {"Evidence and sources →"}
          </button>
        </div>
      </div>
    </article>
  );
}
