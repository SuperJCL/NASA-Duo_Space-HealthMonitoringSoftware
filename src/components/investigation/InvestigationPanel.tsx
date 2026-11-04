/**
 * Placeholder investigation panel (Milestone 1b). To be replaced by the
 * evidence and decision panels in Milestone 2.
 *
 * Intentionally contains NO scientific content: evidence records, sources and
 * interpretations will come from curated local JSON in a later milestone.
 * Showing invented observations here — even as filler — would violate the
 * project's "no fabricated NASA data" rule.
 */

const WORKFLOW_STEPS = [
  {
    title: "Explore the location",
    detail: "Real NASA Mars Trek imagery of Jezero Crater.",
  },
  {
    title: "Review observations & interpretations",
    detail: "Sourced NASA observations, kept separate from scientific interpretations.",
  },
  {
    title: "Identify evidence gaps",
    detail: "Open questions that current evidence cannot settle.",
  },
  {
    title: "Compare candidate observations",
    detail: "Tasks scored against gaps and simulated resource limits.",
  },
  {
    title: "Explainable recommendation",
    detail: "Ranked tasks with evidence, assumptions and limitations.",
  },
] as const;

export function InvestigationPanel() {
  return (
    <aside
      aria-labelledby="investigation-heading"
      className="flex min-h-0 flex-1 flex-col border-t border-border bg-surface lg:w-96 lg:flex-none lg:border-t-0 lg:border-l"
    >
      <div className="border-b border-border px-4 py-3">
        <h2
          id="investigation-heading"
          className="text-sm font-semibold uppercase tracking-wider text-muted"
        >
          Investigation
        </h2>
        <p className="mt-1 text-sm">No site selected.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-xs text-muted">
          Planned workflow. Only step 1 (map) is available in this prototype.
        </p>
        <ol className="mt-3 space-y-2">
          {WORKFLOW_STEPS.map((step, index) => {
            const available = index === 0;
            return (
              <li
                key={step.title}
                className="flex gap-3 rounded-md border border-border bg-surface-raised p-3"
              >
                <span
                  aria-hidden
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs ${
                    available
                      ? "bg-accent text-background"
                      : "border border-border text-muted"
                  }`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {step.title}
                    <span
                      className={`ml-2 font-mono text-[10px] uppercase tracking-wider ${
                        available ? "text-ok" : "text-muted"
                      }`}
                    >
                      {available ? "Available" : "Planned"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{step.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
