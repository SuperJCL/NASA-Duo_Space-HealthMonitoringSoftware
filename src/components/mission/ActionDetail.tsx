import type { ActionView } from "@/lib/mission/actions";

/**
 * Details of the selected simulated action, with its essential limitations
 * next to it (MF-1). "Choose" records a simulated decision only.
 */
export function ActionDetail({
  action,
  chosen,
  reviewedStatusText,
  caveats,
  actionFraming,
  onChoose,
  onClearChoice,
  onClose,
  onShowEvidence,
  onShowAdvanced,
  className = "",
}: {
  action: ActionView;
  chosen: boolean;
  reviewedStatusText: string;
  caveats: readonly string[];
  actionFraming: string;
  onChoose: () => void;
  onClearChoice: () => void;
  onClose: () => void;
  onShowEvidence: () => void;
  onShowAdvanced: () => void;
  className?: string;
}) {
  return (
    <section
      aria-label={`Selected simulated action: ${action.title}`}
      data-testid="action-detail"
      data-action-id={action.id}
      className={`rounded-md border border-accent/60 bg-surface/95 p-3 text-xs shadow-lg ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="inline-flex rounded border border-accent/70 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-accent">
            {"Simulated future action · not a NASA operation"}
          </p>
          <h3 className="mt-1 text-sm font-semibold">{action.title}</h3>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded border border-border px-1.5 py-0.5 hover:bg-surface-raised" aria-label="Close action details">
          {"✕"}
        </button>
      </div>

      <p className="mt-1 text-muted">{action.purpose}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-muted">{"Platform"}</dt>
        <dd>{action.platformText}</dd>
        <dt className="text-muted">{"Cost"}</dt>
        <dd>{action.costText}</dd>
        <dt className="text-muted">{"Feasibility"}</dt>
        <dd className={action.feasible ? "" : "text-warn"}>{action.feasibilityText}</dd>
        <dt className="text-muted">{"Location"}</dt>
        <dd>{"None assigned: no verified Margin Unit boundary exists, so this action is not drawn on the map."}</dd>
      </dl>

      {action.gaps.length ? (
        <div className="mt-2">
          <p className="font-semibold">{"Open questions it is linked to (AI-drafted links, pending review)"}</p>
          <ul className="mt-0.5 list-disc pl-4">
            {action.gaps.map((g) => (
              <li key={g.id}>{g.open ? g.title : `${g.title} (addressed by evidence in this dataset)`}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-2 rounded border border-warn/60 px-2 py-1.5 text-[11px]" data-testid="action-limitations">
        <p className="font-semibold text-warn">{action.review.text}</p>
        <p className="mt-0.5">{reviewedStatusText}</p>
        <p className="mt-0.5">{actionFraming}</p>
        {caveats.map((c) => (
          <p key={c} className="mt-0.5 text-muted">
            {c}
          </p>
        ))}
      </div>

      <details className="mt-2 text-[11px]" data-testid="action-provisional">
        <summary className="cursor-pointer text-muted">{"Inspect provisional ranking (not scientifically validated)"}</summary>
        <p className="mt-1">
          {action.provisional.rank !== null
            ? `Provisional rank ${action.provisional.rank} of ${action.provisional.of}, scenario score ${action.provisional.scorePct} / 100. Not validated: it uses unreviewed AI-drafted relationships.`
            : "Not ranked under the current simulated constraints."}
        </p>
        <button type="button" onClick={onShowAdvanced} className="mt-1 rounded border border-border px-2 py-0.5 hover:bg-surface-raised">
          {"Scores, assumptions and audit (advanced workspace)"}
        </button>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {chosen ? (
          <>
            <p className="font-semibold" data-testid="action-chosen" role="status">
              {"Chosen as your simulated next action. Nothing is executed."}
            </p>
            <button type="button" onClick={onClearChoice} className="rounded border border-border px-2 py-1 hover:bg-surface-raised">
              {"Clear choice"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onChoose}
            data-testid="action-choose"
            className="rounded border border-accent bg-accent px-2 py-1 font-medium text-background hover:opacity-90"
          >
            {"Choose this action (simulated decision)"}
          </button>
        )}
        <button type="button" onClick={onShowEvidence} className="rounded border border-border px-2 py-1 hover:bg-surface-raised">
          {"Evidence"}
        </button>
      </div>
      {chosen && !action.feasible ? (
        <p className="mt-1 text-warn" role="note">
          {"Your chosen action is not feasible under the current simulated constraints."}
        </p>
      ) : null}
    </section>
  );
}
