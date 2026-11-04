import type { LaterEvidence } from "@/lib/evidence/snapshot";
import type { Recommendation } from "./engine";

/**
 * Retrospective comparison: which gaps did evidence published after the
 * snapshot actually address, and did the top-ranked task target them?
 *
 * This runs only after a recommendation exists and never feeds back into
 * scoring.
 */
export type RetrospectiveReview = {
  laterObservationIds: string[];
  gapsAddressedLater: string[];
  topTaskId: string | null;
  topTaskGapsAddressedLater: string[];
  topTaskGapsNotAddressedLater: string[];
};

export function reviewAgainstLaterEvidence(
  recommendation: Recommendation,
  later: LaterEvidence,
): RetrospectiveReview {
  const gapsAddressedLater = [
    ...new Set(later.observations.flatMap((o) => o.addressesGapIds)),
  ].sort();
  const top = recommendation.ranking[0];
  const topGaps = top?.openGapIds ?? [];

  return {
    laterObservationIds: later.observations.map((o) => o.id),
    gapsAddressedLater,
    topTaskId: top?.taskId ?? null,
    topTaskGapsAddressedLater: topGaps.filter((g) => gapsAddressedLater.includes(g)),
    topTaskGapsNotAddressedLater: topGaps.filter((g) => !gapsAddressedLater.includes(g)),
  };
}
