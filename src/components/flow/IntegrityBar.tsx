import type { ReviewedRanking } from "@/lib/decision/review-modes";

/**
 * Concise scientific-integrity status (UX-1, reused in the MF-1 objective
 * strip). Each fact is its own element (translation-safe dynamic text).
 */
export function IntegrityBar({
  evidenceText,
  hiddenLaterCount,
  reviewed,
  excludedCount,
  onShowEvidenceMode,
  onShowRanking,
}: {
  evidenceText: string;
  hiddenLaterCount: number;
  reviewed: ReviewedRanking;
  excludedCount: number;
  onShowEvidenceMode: () => void;
  onShowRanking: () => void;
}) {
  const state = reviewed.status.state;
  const rankingLabel =
    state === "unavailable"
      ? "Reviewed ranking: unavailable"
      : state === "partial"
        ? "Reviewed ranking: partial (top among reviewed tasks only)"
        : "Reviewed ranking: available";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Scientific integrity status"
      data-testid="integrity-bar"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
    >
      <button type="button" onClick={onShowEvidenceMode} className="underline decoration-border underline-offset-2 hover:text-foreground" data-testid="integrity-evidence">
        {evidenceText}
      </button>
      {hiddenLaterCount > 0 ? <span className="text-muted">{`${hiddenLaterCount} later record(s) hidden`}</span> : null}
      <span className="rounded border border-accent/70 px-1 text-accent">{"Simulated scenario · not a NASA plan or endorsement"}</span>
      <button
        type="button"
        onClick={onShowRanking}
        data-testid="integrity-ranking"
        className={`rounded border px-1 underline-offset-2 hover:underline ${state === "unavailable" ? "border-warn/70 text-warn" : "border-ok/70 text-ok"}`}
      >
        {rankingLabel}
      </button>
      {excludedCount > 0 ? <span className="text-warn">{`${excludedCount} feasible task(s) excluded pending review`}</span> : null}
      <span className="text-warn">{`${reviewed.awaitingReview.length} relationship(s) awaiting expert review`}</span>
    </div>
  );
}
