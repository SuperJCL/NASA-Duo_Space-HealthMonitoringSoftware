// Render-neutral view helpers for the base station workbench (pure, tested).

import type { AnalysisResult, FeatureComparison } from "./analysis";
import { latest, workbenchStage, type Case, type Evaluation } from "./station";

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
  if (before.trigger === "report") return { kind: "separate", before, after, why: `v${before.version} is an astronaut-report check (not a measurement): its values are not compared with v${after.version}, and no change is computed.` };
  const which = [!comparable(before) ? `v${before.version}` : null, !comparable(after) ? `v${after.version}` : null].filter(Boolean).join(" and ");
  return { kind: "separate", before, after, why: `${which} did not pass the quality or comparability check: the two measurements are not compared value by value, and no change is computed.` };
}

export type Tone = "alert" | "caution" | "ok" | "neutral";

/** What is pending on an open case (or that it is closed), from its stage. */
export function pendingText(c: Case): string {
  switch (workbenchStage(c)) {
    case "analysing":
      return "analysing";
    case "review":
      return "Awaiting Base Review";
    case "dispatched":
      return "dispatched, awaiting crew feedback";
    case "reassessing":
      return "re-evaluating";
    case "reassessed":
      return "awaiting base decision";
    case "decided":
      return c.phase === "rejected" ? "candidate rejected, awaiting base decision" : "Continue Monitoring";
    case "closed":
      return "Case Closed";
  }
}

/**
 * CASE status: open or closed, whether its alert is still open (only a human close clears it),
 * and what is pending. Deliberately separate from the latest evaluation result.
 */
export function caseStatus(c: Case): { label: string; tone: Tone; alertOpen: boolean } {
  if (c.phase === "closed") return { label: "Case Closed", tone: "neutral", alertOpen: false };
  const alert = c.alert.level === "alert" ? "Alert open" : c.alert.level === "watch" ? "Watch open" : "Case open";
  return { label: `${alert} · ${pendingText(c)}`, tone: c.alert.level === "alert" ? "alert" : c.alert.level === "watch" ? "caution" : "neutral", alertOpen: c.alert.level !== "none" };
}

const OUTCOME: Record<AnalysisResult["outcome"], { text: string; tone: Tone }> = {
  "within-baseline": { text: "Within Reference Range", tone: "ok" },
  "single-feature": { text: "One indicator outside, insufficient evidence", tone: "caution" },
  "change-beyond-baseline": { text: "Beyond the individual baseline variation", tone: "alert" },
  "quality-blocked": { text: "Unable to Assess: signal quality", tone: "caution" },
  "not-comparable": { text: "Conditions Not Comparable", tone: "caution" },
  "result-incomplete": { text: "Incomplete Results", tone: "caution" },
  "analysis-failed": { text: "Analysis failed", tone: "caution" },
  "report-received": { text: "Astronaut report, being checked", tone: "caution" },
};

/** LATEST EVALUATION result (one measurement), independent of whether the case is still open. */
export function evaluationStatus(ev: Evaluation): { label: string; tone: Tone } {
  const name = `Latest evaluation v${ev.version}${ev.trigger === "retest" ? " (retest)" : ev.trigger === "report" ? " (report check)" : ""}`;
  if (ev.completedAt === null) return { label: `${name}: analysing`, tone: "neutral" };
  return { label: `${name}: ${OUTCOME[ev.result.outcome].text}`, tone: OUTCOME[ev.result.outcome].tone };
}

/** One-line summary: the latest result, then what is pending (e.g. "Retest Within Reference Range · awaiting base decision"). */
export function summaryHeadline(c: Case): string {
  const ev = latest(c);
  if (ev.completedAt === null) return ev.version > 1 ? "Retest result received, re-evaluating…" : "Standardised simulated measurement received, simulated analysis running…";
  return `${ev.result.headline} · ${c.phase === "closed" ? "Case Closed" : pendingText(c)}`;
}

/** Why an alert is still shown although the latest result may look normal (null: nothing to say). */
export function alertNote(c: Case): string | null {
  const ev = latest(c);
  if (c.phase === "closed" || c.alert.level === "none" || ev.completedAt === null || ev.version < 2) return null;
  return ev.result.outcome === "within-baseline"
    ? "The original alert is still open: one retest in range does not show recovery. Only base staff closing the case clears the alert."
    : "The original alert is still open: only base staff closing the case clears the alert.";
}

/** Up to three key reasons for the summary: the stages that ran (not skipped, not the template). */
export function keyBasis(r: AnalysisResult): string[] {
  return r.stages.filter((s) => s.id !== "recommendation" && s.status !== "skipped").map((s) => s.summary);
}

/** The six demo steps of a health event, for the station's flow indicator. */
export const FLOW_STEPS = [
  { id: "waiting", label: "Awaiting observation" },
  { id: "analysing", label: "Analysing" },
  { id: "review", label: "Awaiting Base Review" },
  { id: "dispatched", label: "Dispatched, awaiting feedback" },
  { id: "retest", label: "Retest and re-evaluation" },
  { id: "done", label: "Base handling complete" },
] as const;
export type FlowStepState = "done" | "current" | "todo" | "skipped";

/**
 * Where an event is in the flow. `null` case: waiting for the first observation. Steps the event
 * never went through (e.g. closed at v1 without a dispatch) are "skipped", not "done".
 */
export function flowSteps(c: Case | null): { id: (typeof FLOW_STEPS)[number]["id"]; label: string; state: FlowStepState }[] {
  const order = FLOW_STEPS.map((s) => s.id);
  if (!c) return FLOW_STEPS.map((s, i) => ({ ...s, state: i === 0 ? "current" : "todo" }));
  const stage = workbenchStage(c);
  const current = stage === "analysing" ? "analysing" : stage === "review" ? "review" : stage === "dispatched" ? "dispatched" : stage === "reassessing" || stage === "reassessed" ? "retest" : "done";
  const dispatched = c.retests.length > 0;
  const retested = c.evaluations.length > 1;
  const ci = order.indexOf(current);
  return FLOW_STEPS.map((s, i) => {
    if (i === ci) return { ...s, state: current === "done" && stage === "closed" ? "done" : "current" };
    if (i > ci) return { ...s, state: "todo" };
    if (s.id === "dispatched" && !dispatched) return { ...s, state: "skipped" };
    if (s.id === "retest" && !retested) return { ...s, state: "skipped" };
    return { ...s, state: "done" };
  });
}
