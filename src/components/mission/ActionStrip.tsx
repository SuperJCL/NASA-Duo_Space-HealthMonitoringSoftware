import type { ReactNode } from "react";
import type { ActionView } from "@/lib/mission/actions";

/**
 * Compact strip of the simulated observation actions (MF-1). Selecting a
 * card only opens its details; nothing is executed. Translation-safe: each
 * changing text is the sole child of its element.
 */
export function ActionStrip({
  actions,
  selectedId,
  chosenId,
  onSelect,
  constraints,
}: {
  actions: readonly ActionView[];
  selectedId: string | null;
  chosenId: string | null;
  onSelect: (id: string | null) => void;
  constraints: ReactNode;
}) {
  return (
    <section aria-labelledby="actions-heading" className="min-w-0 border-t border-border bg-surface px-3 py-2 [grid-area:strip]" data-testid="action-strip">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id="actions-heading" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span>{"Simulated observation actions"}</span>
          <span className="rounded border border-accent/70 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-accent">{"Simulated · not NASA plans"}</span>
        </h2>
        <p className="text-[11px] text-muted">{"Select an action to inspect it. Choosing one is a simulated decision; nothing is executed."}</p>
      </div>
      <div className="mt-1.5">{constraints}</div>
      <ul className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible" aria-label="Simulated actions">
        {actions.map((a) => {
          const selected = a.id === selectedId;
          const chosen = a.id === chosenId;
          return (
            <li key={a.id} className="w-64 shrink-0 snap-start lg:w-auto">
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : a.id)}
                data-testid={`action-${a.id}`}
                data-feasible={a.feasible}
                className={`flex h-full w-full flex-col items-start rounded-md border p-2 text-left text-[11px] hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
                  selected ? "border-accent bg-surface-raised" : "border-border"
                } ${a.feasible ? "" : "opacity-75"}`}
              >
                <span className="flex w-full items-center justify-between gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{`Simulated action · ${a.platformText.split(" · ")[0]}`}</span>
                  {chosen ? <span className="font-mono text-[10px] uppercase text-foreground">{"Your choice"}</span> : null}
                </span>
                <span className="mt-0.5 block text-xs font-semibold text-foreground">{a.title}</span>
                <span className="mt-0.5 block text-muted">{a.purpose}</span>
                <span className="mt-1 block" data-testid="action-cost">{`Cost: ${a.costText}`}</span>
                <span className={`block ${a.feasible ? "text-foreground" : "text-warn"}`} data-testid="action-feasibility">
                  {a.feasibilityText}
                </span>
                <span className="mt-0.5 block text-warn" data-testid="action-review">
                  {a.review.text}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
