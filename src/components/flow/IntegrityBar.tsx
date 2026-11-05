import type { ReviewedRanking } from "@/lib/decision/review-modes";

/**
 * Concise scientific-integrity status, visible on every step (UX-1).
 * Each fact is its own element (translation-safe dynamic text).
 */
export function IntegrityBar({
  asOf,
  hiddenLaterCount,
  reviewed,
  excludedCount,
  onShowMission,
  onShowResult,
}: {
  asOf: string;
  hiddenLaterCount: number;
  reviewed: ReviewedRanking;
  excludedCount: number;
  onShowMission: () => void;
  onShowResult: () => void;
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
      <button type="button" onClick={onShowMission} className="underline decoration-border underline-offset-2 hover:text-foreground">
        {`Mission date ${asOf}`}
      </button>
      <span className="text-muted">{`${hiddenLaterCount} later record(s) hidden`}</span>
      <span className="rounded border border-accent/70 px-1 text-accent">{"Simulated scenario · not a NASA plan or endorsement"}</span>
      <button
        type="button"
        onClick={onShowResult}
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
