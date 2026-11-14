// MyoMars base station: DATA-FLOW CANVAS model of one analysis round (pure, render-neutral, tested).
//
// One node-link graph with fixed positions:
//   设备 → 设备数据 → 质量检查 → 条件核对 → 指标比较 → 等待基地审核
//                       ╰─ 质量不合格 ─╮   ╰─ 条件不可比 ─╮
//                               检查设备 / 重新测量 ── 建议待审核 ──→ 等待基地审核
//
// `canvasPlan` lists the steps the data ACTUALLY took (from the evaluation's fixed result).
// Every step has a gate (`needs`): the business progress required before the node may show its
// result. The canvas player never shows a result before the station revealed it, and never
// invents data, results or HUD receipts. Replays only re-draw what already happened.

import { FEATURES } from "./analysis";
import type { Evaluation } from "./station";

export type CanvasNodeId = "source" | "receive" | "quality" | "context" | "features" | "branch" | "review";
export type CanvasEdgeId = "e-source" | "e-quality" | "e-context" | "e-features" | "e-review" | "b-quality" | "b-context" | "b-review";

/** Coordinates in a 1000 × 420 canvas. */
export const CANVAS_W = 1000;
export const CANVAS_H = 420;
export const CANVAS_NODES: Record<CanvasNodeId, { label: string; x: number; y: number; kind: "source" | "step" | "branch" | "human" }> = {
  source: { label: "设备", x: 44, y: 105, kind: "source" },
  receive: { label: "设备数据", x: 175, y: 105, kind: "step" },
  quality: { label: "质量检查", x: 410, y: 105, kind: "step" },
  context: { label: "条件核对", x: 645, y: 105, kind: "step" },
  features: { label: "指标比较", x: 880, y: 105, kind: "step" },
  branch: { label: "检查设备 / 重新测量", x: 410, y: 320, kind: "branch" },
  review: { label: "等待基地审核", x: 880, y: 320, kind: "human" },
};
/** Edges run between node borders (node boxes are 140 × 80, the source 64 × 80) so every arrowhead stays visible. */
export const CANVAS_EDGES: Record<CanvasEdgeId, { from: CanvasNodeId; to: CanvasNodeId; d: string; label: string | null; lx: number; ly: number }> = {
  "e-source": { from: "source", to: "receive", d: "M76,105 L104,105", label: null, lx: 0, ly: 0 },
  "e-quality": { from: "receive", to: "quality", d: "M245,105 L339,105", label: null, lx: 0, ly: 0 },
  "e-context": { from: "quality", to: "context", d: "M480,105 L574,105", label: "质量合格", lx: 527, ly: 88 },
  "e-features": { from: "context", to: "features", d: "M715,105 L809,105", label: "条件一致", lx: 762, ly: 88 },
  "e-review": { from: "features", to: "review", d: "M880,145 L880,279", label: "建议候选", lx: 892, ly: 212 },
  "b-quality": { from: "quality", to: "branch", d: "M410,145 L410,279", label: "质量不合格", lx: 398, ly: 212 },
  "b-context": { from: "context", to: "branch", d: "M645,145 C645,240 560,300 481,305", label: "条件不可比", lx: 610, ly: 252 },
  "b-review": { from: "branch", to: "review", d: "M480,338 L809,338", label: "建议待审核", lx: 645, ly: 322 },
};

export type StepOutcome = "done" | "stopped" | "human";
export type CanvasStep = {
  edge: CanvasEdgeId;
  to: CanvasNodeId;
  /** Short summary carried by the moving data marker. */
  packet: string;
  /** One-line result shown on the node once the station revealed it. */
  result: string;
  outcome: StepOutcome;
  /** Business progress needed before the result may be shown (see businessProgress). */
  needs: number;
};

/** How far the station has really got: revealed analysis stages (0–4), 5 once the round is complete. */
export const businessProgress = (ev: Evaluation) => (ev.completedAt !== null ? 5 : Math.min(4, ev.revealed));

const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);

/** The path the data of this round took. Null for a report check (no measurement: not drawn as a data flow). */
export function canvasPlan(ev: Evaluation, callsign: string, review: { label: string; outcome: StepOutcome }): CanvasStep[] | null {
  const o = ev.observation;
  if (!o) return null;
  const [q, ctx, feat] = ev.result.stages;
  const failed = (i: number) =>
    ev.result.stages[i].evidence
      .filter((e) => e.ok === false)
      .map((e) => e.label)
      .join("、");
  const cand = ev.result.candidate;
  const steps: CanvasStep[] = [
    { edge: "e-source", to: "receive", packet: `${callsign.replace(/（.*）/, "")} · ${ev.trigger === "retest" ? "复测数据" : "设备数据"} ${hhmm(o.capturedAt)}`, result: `已接收：${o.protocol.label}`, outcome: "done", needs: 0 },
    { edge: "e-quality", to: "quality", packet: "6 项信号质量参数", result: q.status === "done" ? "合格：6 项参数在阈值内" : `不合格：${failed(0)}`, outcome: q.status === "done" ? "done" : "stopped", needs: 1 },
  ];
  const toReview = (from: "e-review" | "b-review") => steps.push({ edge: from, to: "review", packet: `建议：${cand?.title ?? "无"}（未发送）`, result: review.label, outcome: review.outcome, needs: 5 });
  if (q.status !== "done") {
    steps.push({ edge: "b-quality", to: "branch", packet: `质量不合格：${failed(0)}`, result: cand?.title ?? "需要重新测量", outcome: "done", needs: 5 });
    toReview("b-review");
    return steps;
  }
  steps.push({ edge: "e-context", to: "context", packet: "协议 · 负荷 · 姿势 · 手套", result: ctx.status === "done" ? "条件一致，可比较" : `不可比：${failed(1)}不同`, outcome: ctx.status === "done" ? "done" : "stopped", needs: 2 });
  if (ctx.status !== "done") {
    steps.push({ edge: "b-context", to: "branch", packet: `条件不可比：${failed(1)}`, result: cand?.title ?? "按标准协议重新测量", outcome: "done", needs: 5 });
    toReview("b-review");
    return steps;
  }
  const flagged = ev.result.comparisons.filter((x) => x.flagged).map((x) => FEATURES[x.key].label);
  steps.push({
    edge: "e-features",
    to: "features",
    packet: "3 项汇总指标（sEMG ×2 · 握力计）",
    result: feat.status !== "done" ? "特征缺失，无法比较" : ev.result.outcome === "change-beyond-baseline" ? `${flagged.length} 项超出参考范围` : ev.result.outcome === "single-feature" ? `仅 ${flagged[0]} 超出参考范围` : "均在参考范围内",
    outcome: feat.status === "done" ? "done" : "stopped",
    needs: 3,
  });
  toReview("e-review");
  return steps;
}

/** The step at which the data left the normal path (a stop), or null when it did not. */
export const divergence = (steps: CanvasStep[]) => {
  const i = steps.findIndex((s) => s.outcome === "stopped");
  return i < 0 ? null : i;
};
