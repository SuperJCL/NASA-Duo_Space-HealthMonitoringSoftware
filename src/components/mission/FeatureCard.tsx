import type { FeatureDetails } from "@/lib/geo/details";

/**
 * Concise context card for a selected geographic feature (MF-1). Every
 * changing text is the sole child of its element (translation-safe).
 */
export function FeatureCard({
  details,
  onClose,
  onShowEvidence,
  className = "",
}: {
  details: FeatureDetails;
  onClose: () => void;
  onShowEvidence: (observationId: string) => void;
  className?: string;
}) {
  const historical = details.layer === "historical-rover";
  return (
    <section
      aria-label={`Selected map feature: ${details.name}`}
      data-testid="feature-card"
      data-feature-id={details.id}
      className={`rounded-md border border-border bg-surface/95 p-3 text-xs shadow-lg ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`inline-flex rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider ${
              historical ? "border-sky-300/60 text-sky-200" : "border-stone-400/60 text-stone-300"
            }`}
            data-testid="feature-type"
          >
            {historical ? `Verified historical data · ${details.typeLabel}` : details.typeLabel}
          </p>
          <h3 className="mt-1 text-sm font-semibold" data-testid="feature-name">
            {details.name}
          </h3>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded border border-border px-1.5 py-0.5 hover:bg-surface-raised" aria-label="Close feature details">
          {"✕"}
        </button>
      </div>

      {details.warning ? (
        <p className="mt-2 rounded border border-warn/70 px-2 py-1 text-warn" data-testid="feature-warning" role="note">
          {details.warning}
        </p>
      ) : null}

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {details.facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted">{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-[11px]" data-testid="feature-convention" data-basis={details.convention.basis}>
        <span className="font-semibold">{details.convention.basis === "stated" ? "Coordinates (stated): " : "Coordinates (inferred): "}</span>
        <span className="text-muted">{details.convention.text}</span>
      </p>

      <div className="mt-2 text-[11px]">
        <p className="font-semibold">{"Source"}</p>
        <ul className="mt-0.5 space-y-0.5">
          {details.sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                {s.title}
              </a>
              <span className="text-muted">{` · published ${s.publishedOn}`}</span>
            </li>
          ))}
        </ul>
      </div>

      {details.relatedObservationIds.length ? (
        <button
          type="button"
          onClick={() => onShowEvidence(details.relatedObservationIds[0])}
          className="mt-2 rounded border border-border px-2 py-1 hover:bg-surface-raised"
          data-testid="feature-evidence"
        >
          {`Show related evidence (${details.relatedObservationIds.length})`}
        </button>
      ) : null}
    </section>
  );
}
