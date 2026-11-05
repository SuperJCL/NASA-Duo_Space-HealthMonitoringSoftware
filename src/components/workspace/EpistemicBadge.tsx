import type { Review } from "@/lib/evidence/schema";

const STYLES = {
  observed: { label: "Observed", className: "border-ok/60 text-ok" },
  measured: { label: "Measured in situ", className: "border-emerald-300/60 text-emerald-200" },
  interpreted: { label: "Interpreted", className: "border-sky-400/60 text-sky-300" },
  hypothesis: { label: "Hypothesis", className: "border-cyan-400/60 text-cyan-300" },
  context: { label: "Regional context", className: "border-stone-400/60 text-stone-300" },
  gap: { label: "Gap", className: "border-warn/60 text-warn" },
  assumed: { label: "Assumed", className: "border-violet-400/60 text-violet-300" },
  simulated: { label: "Simulated", className: "border-accent/70 text-accent" },
  later: { label: "Published later", className: "border-muted/60 text-muted" },
  deterministic: { label: "Deterministic", className: "border-ok/50 text-ok" },
  curated: { label: "Curated", className: "border-violet-400/60 text-violet-300" },
  pending: { label: "AI draft · pending review", className: "border-warn/70 text-warn" },
  approved: { label: "Human-approved", className: "border-ok/70 text-ok" },
  rejected: { label: "Rejected", className: "border-error/70 text-error" },
  revision: { label: "Needs revision", className: "border-warn/70 text-warn" },
  provisional: { label: "Provisional · not validated", className: "border-warn/70 text-warn" },
  reviewed: { label: "Reviewed relationships only", className: "border-ok/70 text-ok" },
} as const;

export type EpistemicKind = keyof typeof STYLES;

/** Label that keeps the epistemic category of every record visible. */
export function EpistemicBadge({ kind, detail }: { kind: EpistemicKind; detail?: string }) {
  const style = STYLES[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider ${style.className}`}
    >
      {detail ? `${style.label} · ${detail}` : style.label}
    </span>
  );
}

export function ReviewBadge({ review }: { review: Review }) {
  if (review.status === "approved") {
    return <EpistemicBadge kind="approved" detail={`${review.reviewedBy} ${review.reviewedOn}`} />;
  }
  if (review.status === "rejected") return <EpistemicBadge kind="rejected" />;
  if (review.status === "needs_revision") return <EpistemicBadge kind="revision" />;
  return review.draftedBy === "ai-agent" ? <EpistemicBadge kind="pending" /> : <EpistemicBadge kind="curated" detail="pending review" />;
}
