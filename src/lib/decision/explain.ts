/**
 * SCI-0 A1–A4: plain-language scope statements for what the app shows about
 * the provisional ranking. Text only: nothing here computes or changes a
 * score, an order, a gap state or a review status. The numbers come from the
 * engine (`recommend`, `rankProvisional`) and the review registry.
 * See docs/sci0/FOLLOW_UP_PROPOSALS.md (track A).
 */
import { relationshipIds } from "@/lib/evidence/review-registry";
import type { SnapshotGap } from "@/lib/evidence/snapshot";
import type { Recommendation } from "./engine";

/**
 * A1: how many open questions a task is linked to, and whether those links
 * have been reviewed. `unreviewed` counts the linked ones that are not
 * approved; `aiDrafted` is true when all of those were drafted by the AI agent.
 */
export function linkedQuestionsText(args: { linked: number; open: number; unreviewed: number; aiDrafted: boolean }): string {
  const { linked, open, unreviewed, aiDrafted } = args;
  if (linked === 0) return `Linked to none of the ${open} open questions`;
  const base = `Linked to ${linked} of ${open} open questions`;
  if (unreviewed === 0) return `${base} (links reviewed by an expert)`;
  if (unreviewed === linked) return `${base} (${aiDrafted ? "AI-drafted links, " : "links "}not yet reviewed)`;
  return `${base} (${unreviewed} of these links not yet reviewed)`;
}

/**
 * A2: the engine's weight-stability result, stated with its scope (it varies
 * weights only) and next to the input sensitivity that `rankProvisional`
 * already computes (unreviewed inputs, and how many of them alone change #1).
 */
export function stabilityScopeText(args: {
  stability: Recommendation["stability"];
  unreviewedInputs: number;
  pivotalInputs: number;
  /** Research workspace: also state the lead over #2 (score points). */
  showLead?: boolean;
}): string {
  const st = args.stability;
  const lead = args.showLead && st.margin !== null ? `; lead over #2: ${Math.round(st.margin * 100)} points` : "";
  const weights = `Weights only: stays #1 in ${st.topUnchanged} of ${st.trials} runs with each scored weight changed by ±${Math.round(st.perturbation * 100)}%${lead}.`;
  if (args.unreviewedInputs === 0) return `${weights} All inputs it uses are reviewed.`;
  const n = args.unreviewedInputs;
  const p = args.pivotalInputs;
  const effect =
    p === 0 ? "removing any single one does not change #1" : p === 1 ? "removing one of them alone changes #1" : `removing any one of ${p} of them alone changes #1`;
  return `${weights} Not covered by this check: ${n} unreviewed input${n === 1 ? "" : "s"}; ${effect}.`;
}

/**
 * A4: a question that the engine no longer counts as open. States the basis
 * (an MDI rule, or linked observations), whether that basis awaits expert
 * review, and that it closes only this question. Null while the question is open.
 */
export function closedQuestionText(gap: SnapshotGap, unreviewedIds: ReadonlySet<string>): { label: string; note: string } | null {
  if (gap.status.state !== "addressed") return null;
  const derived = gap.origin.kind === "derived";
  const basisIds = [
    ...(derived ? [relationshipIds.derivedGap(gap.id)] : []),
    ...gap.status.byObservationIds.map((o) => relationshipIds.observationGap(o, gap.id)),
  ];
  const pending = basisIds.some((id) => unreviewedIds.has(id));
  return {
    label: "no longer counted as open",
    note: `${derived ? "Closed by an MDI rule" : "Closed by linked observations"}${pending ? " (awaiting expert review)" : ""}. This closes only this question; the other open questions are not affected.`,
  };
}
