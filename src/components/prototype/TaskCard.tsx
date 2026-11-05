"use client";

import type { SimulatedTarget, TaskView } from "@/lib/prototype/mission-glass";

/**
 * Level 1 (always visible): rank, action, one-line rationale, status.
 * Level 2 (expand): what, equipment, target, resources, priority conditions,
 * limitations. Level 3 is the evidence sheet (onEvidence).
 */
export function TaskCard({
  view,
  target,
  selected,
  inPlan,
  expanded,
  limitations,
  onSelect,
  onTogglePlan,
  onToggleExpand,
  onEvidence,
}: {
  view: TaskView;
  target: SimulatedTarget | undefined;
  selected: boolean;
  inPlan: boolean;
  expanded: boolean;
  limitations: string[];
  onSelect: () => void;
  onTogglePlan: () => void;
  onToggleExpand: () => void;
  onEvidence: () => void;
}) {
  const fits = view.status === "fits";
  const pct = Math.min(100, Math.round((view.cost / Math.max(view.budget, 1)) * 100));
  return (
    <article
      data-testid={`mg-card-${view.taskId}`}
      data-selected={selected}
      data-rank={view.rank ?? ""}
      onClick={onSelect}
      className={`group relative cursor-pointer rounded-2xl border p-4 transition-[background-color,border-color,transform] duration-200 ease-out ${
        selected ? "border-[var(--mg-coral)] bg-[var(--mg-surface)]" : "border-[var(--mg-line)] bg-[var(--mg-glass)] hover:border-[var(--mg-line-strong)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          aria-label={view.rank ? `Provisional rank ${view.rank}` : "Not ranked"}
          className={`flex size-10 shrink-0 items-center justify-center rounded-full border text-lg font-semibold ${
            view.rank ? "border-[var(--mg-line-strong)] text-[var(--mg-text)]" : "border-dashed border-[var(--mg-line)] text-[var(--mg-faint)]"
          }`}
        >
          {view.rank ? `${view.rank}` : "–"}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold leading-snug">{view.shortTitle}</h3>
          <p className="mt-0.5 text-sm text-[var(--mg-dim)]" data-testid="mg-rationale">
            {view.rationale}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
            <span
              className={`rounded-full px-2 py-0.5 ${fits ? "bg-[var(--mg-cyan-soft)] text-[var(--mg-cyan)]" : "bg-[rgba(241,200,120,0.12)] text-[var(--mg-caution)]"}`}
              data-testid="mg-status"
            >
              {view.statusText}
            </span>
            {inPlan ? <span className="rounded-full border border-[var(--mg-coral)] px-2 py-0.5 text-[var(--mg-coral)]">{"In plan"}</span> : null}
            <span className="text-[var(--mg-faint)]">{"Provisional"}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onTogglePlan}
          disabled={!fits && !inPlan}
          aria-pressed={inPlan}
          data-testid="mg-plan-toggle"
          className={`rounded-xl px-3 py-1 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
            inPlan ? "bg-[var(--mg-coral-soft)] text-[var(--mg-coral)]" : "bg-[var(--mg-coral)] text-[#1a0f0c] hover:brightness-110"
          }`}
        >
          {inPlan ? "✓ In plan" : "+ Add to plan"}
        </button>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-controls={`mg-detail-${view.taskId}`}
          data-testid="mg-expand"
          className="rounded-xl border border-[var(--mg-line)] px-3 py-1 text-sm text-[var(--mg-dim)] hover:text-[var(--mg-text)]"
        >
          {expanded ? "Hide details" : "Details"}
        </button>
      </div>


      {/* Level 2: animated height via grid rows; content stays mounted for state. */}
      <div
        id={`mg-detail-${view.taskId}`}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        aria-hidden={!expanded}
        data-testid="mg-detail"
      >
        <div className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <dl className="mt-4 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-sm">
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
            <dt className="text-[var(--mg-faint)]">{"Resources"}</dt>
            <dd>
              <span className="block">{`${view.cost} of ${view.budget} simulated effort points`}</span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--mg-line)]">
                <span className={`block h-full rounded-full ${fits ? "bg-[var(--mg-cyan)]" : "bg-[var(--mg-caution)]"}`} style={{ width: `${pct}%` }} />
              </span>
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
            className="mt-3 rounded-xl border border-[var(--mg-cyan)] px-3 py-1.5 text-sm text-[var(--mg-cyan)] hover:bg-[var(--mg-cyan-soft)]"
          >
            {"Evidence and sources →"}
          </button>
        </div>
      </div>
    </article>
  );
}
