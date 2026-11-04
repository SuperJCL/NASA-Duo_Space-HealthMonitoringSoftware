"use client";

import { useState } from "react";
import type { RetrospectiveReview } from "@/lib/decision/retrospective";
import type { CandidateTask, EvidenceGap, Source } from "@/lib/evidence/schema";
import type { LaterEvidence } from "@/lib/evidence/snapshot";
import { ObservationCard, Section } from "./EvidenceSection";

type Props = {
  asOf: string;
  later: LaterEvidence;
  review: RetrospectiveReview;
  tasks: readonly CandidateTask[];
  allGaps: readonly EvidenceGap[];
  sourceById: ReadonlyMap<string, Source>;
};

/**
 * Retrospective reveal: evidence published after the snapshot date. Hidden
 * until the user asks, and never used for scoring.
 */
export function RevealSection({ asOf, later, review, tasks, allGaps, sourceById }: Props) {
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const revealed = revealedFor === asOf; // re-hide when the snapshot date changes
  const count = later.observations.length + later.interpretations.length + later.gaps.length;
  const gapQuestion = new Map(allGaps.map((g) => [g.id, g.question]));
  const topTitle = tasks.find((t) => t.id === review.topTaskId)?.title;

  return (
    <Section title="What happened later" count={count}>
      {!revealed ? (
        <div>
          <p className="text-xs text-muted">
            {count} record(s) published after {asOf} are hidden and were not used for the recommendation.
          </p>
          <button
            type="button"
            disabled={count === 0}
            onClick={() => setRevealedFor(asOf)}
            className="mt-2 rounded border border-accent-muted px-2 py-1 text-xs text-accent hover:bg-surface-raised disabled:opacity-40"
          >
            Reveal later evidence
          </button>
        </div>
      ) : (
        <div data-testid="reveal">
          <div className="rounded-md border border-border bg-background p-3 text-xs">
            <p className="font-semibold">Retrospective check</p>
            {review.topTaskId ? (
              <>
                <p className="mt-1">
                  The top-ranked task (&ldquo;{topTitle}&rdquo;) targeted {review.topTaskGapsAddressedLater.length +
                    review.topTaskGapsNotAddressedLater.length}{" "}
                  open gap(s).
                </p>
                {review.topTaskGapsAddressedLater.length ? (
                  <p className="mt-1 text-ok">
                    Later evidence bears on:{" "}
                    {review.topTaskGapsAddressedLater.map((g) => gapQuestion.get(g) ?? g).join(" · ")}
                  </p>
                ) : null}
                {review.topTaskGapsNotAddressedLater.length ? (
                  <p className="mt-1 text-muted">
                    Not addressed by later evidence in this dataset:{" "}
                    {review.topTaskGapsNotAddressedLater.map((g) => gapQuestion.get(g) ?? g).join(" · ")}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-muted">No task was ranked.</p>
            )}
            <p className="mt-1 text-[11px] text-muted">
              &ldquo;Bears on&rdquo; means a later observation is linked to that gap in our curated data; it does
              not mean the question was settled.
            </p>
          </div>
          <ul className="mt-2 space-y-2">
            {later.observations.map((o) => (
              <ObservationCard key={o.id} observation={o} sourceById={sourceById} later />
            ))}
          </ul>
          {later.interpretations.length || later.gaps.length ? (
            <p className="mt-2 text-[11px] text-muted">
              Also published later: {later.interpretations.map((i) => i.title).join("; ")}
              {later.interpretations.length && later.gaps.length ? "; " : ""}
              {later.gaps.map((g) => g.question).join("; ")}
            </p>
          ) : null}
        </div>
      )}
    </Section>
  );
}
