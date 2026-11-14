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
  if (before.trigger === "report") return { kind: "separate", before, after, why: `v${before.version} 是宇航员报告核查（不是测量），不与 v${after.version} 的测量数值比较，也不计算变化幅度。` };
  const which = [!comparable(before) ? `v${before.version}` : null, !comparable(after) ? `v${after.version}` : null].filter(Boolean).join("、");
  return { kind: "separate", before, after, why: `${which} 未通过质量或可比性检查，两次测量不直接比较数值，也不计算变化幅度。` };
}

export type Tone = "alert" | "caution" | "ok" | "neutral";

/** What is pending on an open case (or that it is closed), from its stage. */
export function pendingText(c: Case): string {
  switch (workbenchStage(c)) {
    case "analysing":
      return "分析中";
    case "review":
      return "待审核";
    case "dispatched":
      return "已派发，等待宇航员反馈";
    case "reassessing":
      return "重评中";
    case "reassessed":
      return "待人工处理";
    case "decided":
      return c.phase === "rejected" ? "候选已驳回，待人工处理" : "保留关注";
    case "closed":
      return "已关闭";
  }
}

/**
 * CASE status: open or closed, whether its alert is still open (only a human close clears it),
 * and what is pending. Deliberately separate from the latest evaluation result.
 */
export function caseStatus(c: Case): { label: string; tone: Tone; alertOpen: boolean } {
  if (c.phase === "closed") return { label: "事件已关闭", tone: "neutral", alertOpen: false };
  const alert = c.alert.level === "alert" ? "告警未关闭" : c.alert.level === "watch" ? "关注未关闭" : "事件未关闭";
  return { label: `${alert} · ${pendingText(c)}`, tone: c.alert.level === "alert" ? "alert" : c.alert.level === "watch" ? "caution" : "neutral", alertOpen: c.alert.level !== "none" };
}

const OUTCOME: Record<AnalysisResult["outcome"], { text: string; tone: Tone }> = {
  "within-baseline": { text: "在参考范围内", tone: "ok" },
  "single-feature": { text: "单项超出，证据不足", tone: "caution" },
  "change-beyond-baseline": { text: "超出个体基线波动", tone: "alert" },
  "quality-blocked": { text: "采集质量不合格", tone: "caution" },
  "not-comparable": { text: "条件不可比", tone: "caution" },
  "analysis-failed": { text: "分析失败", tone: "caution" },
  "report-received": { text: "宇航员报告，待核查", tone: "caution" },
};

/** LATEST EVALUATION result (one measurement), independent of whether the case is still open. */
export function evaluationStatus(ev: Evaluation): { label: string; tone: Tone } {
  const name = `最新评估 v${ev.version}${ev.trigger === "retest" ? "（复测）" : ev.trigger === "report" ? "（报告核查）" : ""}`;
  if (ev.completedAt === null) return { label: `${name}：分析中`, tone: "neutral" };
  return { label: `${name}：${OUTCOME[ev.result.outcome].text}`, tone: OUTCOME[ev.result.outcome].tone };
}

/** One-line summary: the latest result, then what is pending (e.g. "复测在参考范围内，待人工处理"). */
export function summaryHeadline(c: Case): string {
  const ev = latest(c);
  if (ev.completedAt === null) return ev.version > 1 ? "收到复测结果，正在重新评估…" : "收到标准化模拟测量，正在模拟分析…";
  return `${ev.result.headline}，${c.phase === "closed" ? "事件已关闭" : pendingText(c)}`;
}

/** Why an alert is still shown although the latest result may look normal (null: nothing to say). */
export function alertNote(c: Case): string | null {
  const ev = latest(c);
  if (c.phase === "closed" || c.alert.level === "none" || ev.completedAt === null || ev.version < 2) return null;
  return ev.result.outcome === "within-baseline"
    ? "原告警尚未关闭：单次正常复测不能证明已经恢复。告警只在基地人员关闭事件时解除。"
    : "原告警尚未关闭：告警只在基地人员关闭事件时解除。";
}

/** Up to three key reasons for the summary: the stages that ran (not skipped, not the template). */
export function keyBasis(r: AnalysisResult): string[] {
  return r.stages.filter((s) => s.id !== "recommendation" && s.status !== "skipped").map((s) => s.summary);
}

/** The six demo steps of a health event, for the station's flow indicator. */
export const FLOW_STEPS = [
  { id: "waiting", label: "等待观测" },
  { id: "analysing", label: "分析中" },
  { id: "review", label: "待审核" },
  { id: "dispatched", label: "已派发等待反馈" },
  { id: "retest", label: "复测与重评" },
  { id: "done", label: "人工处理完成" },
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
