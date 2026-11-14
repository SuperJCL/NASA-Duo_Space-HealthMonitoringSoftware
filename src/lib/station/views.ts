// Render-neutral view helpers for the base station workbench (pure, tested).

import type { AnalysisResult, FeatureComparison } from "./analysis";
import { latest, type Case, type Evaluation } from "./station";

/** True when an evaluation passed the quality and comparability stages and compared features. */
export const comparable = (ev: Evaluation) => ev.result.stages[0].status === "done" && ev.result.stages[1].status === "done" && ev.result.comparisons.length > 0;

export type ComparisonView =
  | { kind: "single"; ev: Evaluation }
  /** Both measurements comparable with the same individual baseline: values may be shown side by side. */
  | { kind: "paired"; before: Evaluation; after: Evaluation; rows: { before: FeatureComparison; after: FeatureComparison }[] }
  /** At least one measurement is not comparable: describe each separately, no values side by side, no change size. */
  | { kind: "separate"; before: Evaluation; after: Evaluation; why: string };

/**
 * The evaluation pair to show for a case: the retest's source evaluation and the latest one.
 * Values are put side by side only when BOTH are comparable with the baseline.
 */
export function comparisonView(c: Case): ComparisonView {
  const after = latest(c);
  if (after.version === 1 || after.completedAt === null) return { kind: "single", ev: after };
  const rt = after.retestId ? c.retests.find((r) => r.retestId === after.retestId) : null;
  const before = c.evaluations.find((e) => e.version === (rt?.requestedFromVersion ?? after.version - 1)) ?? c.evaluations[0];
  if (comparable(before) && comparable(after)) {
    return { kind: "paired", before, after, rows: before.result.comparisons.map((b) => ({ before: b, after: after.result.comparisons.find((x) => x.key === b.key)! })) };
  }
  const which = [!comparable(before) ? `v${before.version}` : null, !comparable(after) ? `v${after.version}` : null].filter(Boolean).join("、");
  return { kind: "separate", before, after, why: `${which} 未通过质量或可比性检查，两次测量不直接比较数值，也不计算变化幅度。` };
}

/** Up to three key reasons for the summary: the stages that ran (not skipped, not the template). */
export function keyBasis(r: AnalysisResult): string[] {
  return r.stages.filter((s) => s.id !== "recommendation" && s.status !== "skipped").map((s) => s.summary);
}
