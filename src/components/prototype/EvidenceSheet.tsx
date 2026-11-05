"use client";

import { useEffect, useRef } from "react";
import type { BriefingView } from "@/lib/briefing/view";
import { CRITERIA } from "@/lib/decision/criteria";
import type { Assumption, CandidateTask, Source } from "@/lib/evidence/schema";
import type { SnapshotGap } from "@/lib/evidence/snapshot";
import type { TaskView } from "@/lib/prototype/mission-glass";

/**
 * Level 3: scientific evidence, NASA/PDS citations, assumptions and review
 * status for one task. Reads existing records only.
 */
export function EvidenceSheet({
  open,
  onClose,
  view,
  task,
  gaps,
  assumptions,
  sourceById,
  briefing,
  awaitingReview,
}: {
  open: boolean;
  onClose: () => void;
  view: TaskView | undefined;
  task: CandidateTask | undefined;
  gaps: readonly SnapshotGap[];
  assumptions: readonly Assumption[];
  sourceById: ReadonlyMap<string, Source>;
  briefing: BriefingView | null;
  awaitingReview: number;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);
  const criterionName = (id: string) => CRITERIA.find((c) => c.id === id)?.name ?? id;
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="mg-evidence-title"
      hidden={!open}
      data-testid="mg-evidence-sheet"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="mg-glass mg-rise fixed inset-y-3 right-3 z-40 flex w-[calc(100%-1.5rem)] flex-col bg-[var(--mg-glass-strong)] sm:w-[34rem]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--mg-line)] px-5 py-4">
        <div>
          <p className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-cyan)]">{"Level 3 · evidence and sources"}</p>
          <h2 id="mg-evidence-title" ref={headingRef} tabIndex={-1} className="text-xl font-semibold focus:outline-none">
            {view ? view.shortTitle : "Evidence"}
          </h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl border border-[var(--mg-line)] px-3 py-1.5 text-sm" data-testid="mg-evidence-close">
          {"Close"}
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
        {view && task ? (
          <>
            <section>
              <h3 className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Why this rank (existing engine, provisional)"}</h3>
              <ul className="mt-2 space-y-1.5" data-testid="mg-engine-notes">
                {view.engineNotes.map((n) => (
                  <li key={n.criterion}>
                    <span className="block font-medium">{n.evaluated ? criterionName(n.criterion) : `${criterionName(n.criterion)}: not evaluated`}</span>
                    <span className="block text-[var(--mg-dim)]">{n.text}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Open questions it addresses"}</h3>
              <ul className="mt-2 space-y-3" data-testid="mg-gap-links">
                {task.addresses.map((l) => {
                  const g = gaps.find((x) => x.id === l.gapId);
                  return (
                    <li key={l.gapId} className="rounded-xl border border-[var(--mg-line)] p-3">
                      <span className="block font-medium">{g ? `${g.title}${g.status.state === "addressed" ? " (already addressed)" : ""}` : l.gapId}</span>
                      <span className="mt-0.5 block text-[var(--mg-dim)]">{l.rationale}</span>
                      <span className="mt-1 block text-[13px] text-[var(--mg-caution)]">{"Link drafted by AI · awaiting expert review"}</span>
                      {g?.origin.kind === "cited"
                        ? g.origin.citations.map((c, n) => (
                            <blockquote key={`g${n}`} className="mt-2 border-l-2 border-[var(--mg-cyan)] pl-2 text-[13px] text-[var(--mg-dim)]">
                              <span className="block text-[var(--mg-faint)]">{"Question stated in the source:"}</span>
                              <span className="block italic">{`“${c.quote}”`}</span>
                              <a href={sourceById.get(c.sourceId)?.url} target="_blank" rel="noreferrer" className="text-[var(--mg-cyan)] underline underline-offset-2">
                                {sourceById.get(c.sourceId)?.title ?? c.sourceId}
                              </a>
                            </blockquote>
                          ))
                        : g?.origin.kind === "derived"
                          ? <span className="mt-2 block text-[13px] text-[var(--mg-faint)]">{`Rule-defined question: ${g.origin.rule}`}</span>
                          : null}
                      {l.citations.map((c, n) => (
                        <blockquote key={n} className="mt-2 border-l-2 border-[var(--mg-line-strong)] pl-2 text-[13px] text-[var(--mg-dim)]">
                          <span className="block italic">{`“${c.quote}”`}</span>
                          <a href={sourceById.get(c.sourceId)?.url} target="_blank" rel="noreferrer" className="text-[var(--mg-cyan)] underline underline-offset-2">
                            {sourceById.get(c.sourceId)?.title ?? c.sourceId}
                          </a>
                        </blockquote>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        ) : (
          <p className="text-[var(--mg-dim)]">{"Select a task to see its evidence."}</p>
        )}
        {briefing ? (
          <section data-testid="mg-verified-context">
            <h3 className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Verified context at Lefroy Bay (real NASA/PDS records)"}</h3>
            <ul className="mt-2 space-y-2">
              {[briefing.measured[0], briefing.keyQuestion, briefing.alreadyDone[briefing.alreadyDone.length - 2]].map((l) => (
                <li key={l.id}>
                  <span className="block">{l.claim}</span>
                  <span className="block text-[13px] text-[var(--mg-faint)]">{l.sources[0]?.where}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-[var(--mg-dim)]">{"Perseverance already imaged, abraded, cored and sealed a sample at Lefroy Bay (sols 920–949). The simulated targets here are other, scenario-defined positions."}</p>
          </section>
        ) : null}
        {view && task ? (
          <section>
            <h3 className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Assumptions"}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--mg-dim)]" data-testid="mg-assumptions">
              {task.assumptionIds.map((id) => {
                const a = assumptions.find((x) => x.id === id);
                return a ? <li key={id}>{a.statement}</li> : null;
              })}
            </ul>
          </section>
        ) : null}
        <section data-testid="mg-review-status">
          <h3 className="text-[13px] uppercase tracking-[0.12em] text-[var(--mg-faint)]">{"Review status"}</h3>
          <p className="mt-2">
            {`No scientific relationship has been approved: the reviewed ranking is unavailable, and ${awaitingReview} relationship(s) await expert review.${
              view ? ` This task depends on ${view.pendingRelationships} of them.` : ""
            } The ranks shown are provisional and not scientifically validated.`}
          </p>
        </section>
      </div>
    </aside>
  );
}
