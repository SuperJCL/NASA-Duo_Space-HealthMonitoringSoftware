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

import { FEATURES, inSentence } from "./analysis";
import type { Evaluation } from "./station";

export type CanvasNodeId = "source" | "receive" | "quality" | "context" | "features" | "branch" | "review";
export type CanvasEdgeId = "e-source" | "e-quality" | "e-context" | "e-features" | "e-review" | "b-quality" | "b-context" | "b-review";

/** Coordinates in a 1000 × 420 canvas. */
export const CANVAS_W = 1000;
export const CANVAS_H = 420;
export const CANVAS_NODES: Record<CanvasNodeId, { label: string; x: number; y: number; kind: "source" | "step" | "branch" | "human" }> = {
  source: { label: "Device", x: 44, y: 105, kind: "source" },
  receive: { label: "Data Received", x: 175, y: 105, kind: "step" },
  quality: { label: "Signal Quality", x: 410, y: 105, kind: "step" },
  context: { label: "Comparability", x: 645, y: 105, kind: "step" },
  features: { label: "Comparison", x: 880, y: 105, kind: "step" },
  branch: { label: "Check device / remeasure", x: 410, y: 320, kind: "branch" },
  review: { label: "Base Review", x: 880, y: 320, kind: "human" },
};
/** Edges run between node borders (node boxes are 140 × 80, the source 64 × 80) so every arrowhead stays visible. */
export const CANVAS_EDGES: Record<CanvasEdgeId, { from: CanvasNodeId; to: CanvasNodeId; d: string; label: string | null; lx: number; ly: number }> = {
  "e-source": { from: "source", to: "receive", d: "M76,105 L104,105", label: null, lx: 0, ly: 0 },
  "e-quality": { from: "receive", to: "quality", d: "M245,105 L339,105", label: null, lx: 0, ly: 0 },
  "e-context": { from: "quality", to: "context", d: "M480,105 L574,105", label: "quality passed", lx: 527, ly: 88 },
  "e-features": { from: "context", to: "features", d: "M715,105 L809,105", label: "comparable", lx: 762, ly: 88 },
  "e-review": { from: "features", to: "review", d: "M880,145 L880,279", label: "candidate", lx: 892, ly: 212 },
  "b-quality": { from: "quality", to: "branch", d: "M410,145 L410,279", label: "quality failed", lx: 398, ly: 212 },
  "b-context": { from: "context", to: "branch", d: "M645,145 C645,240 560,300 481,305", label: "not comparable", lx: 610, ly: 252 },
  "b-review": { from: "branch", to: "review", d: "M480,338 L809,338", label: "candidate for review", lx: 645, ly: 322 },
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

/** "EV1 (simulated)" → "EV1": the callsign without its parenthesised note. */
export const shortCallsign = (callsign: string) => callsign.replace(/\s*[（(].*[)）]\s*$/, "");

/** The path the data of this round took. Null for a report check (no measurement: not drawn as a data flow). */
export function canvasPlan(ev: Evaluation, callsign: string, review: { label: string; outcome: StepOutcome }): CanvasStep[] | null {
  const o = ev.observation;
  if (!o) return null;
  const [q, ctx, feat] = ev.result.stages;
  const failed = (i: number) =>
    ev.result.stages[i].evidence
      .filter((e) => e.ok === false)
      .map((e) => inSentence(e.label))
      .join(", ");
  const cand = ev.result.candidate;
  const steps: CanvasStep[] = [
    { edge: "e-source", to: "receive", packet: `${shortCallsign(callsign)} · ${ev.trigger === "retest" ? "retest data" : "device data"} ${hhmm(o.capturedAt)}`, result: `Received: ${o.protocol.label}`, outcome: "done", needs: 0 },
    { edge: "e-quality", to: "quality", packet: "6 signal-quality parameters", result: q.status === "done" ? "Passed: 6 parameters within limits" : `Failed: ${failed(0)}`, outcome: q.status === "done" ? "done" : "stopped", needs: 1 },
  ];
  const toReview = (from: "e-review" | "b-review") => steps.push({ edge: from, to: "review", packet: `Candidate: ${cand?.title ?? "none"} (not sent)`, result: review.label, outcome: review.outcome, needs: 5 });
  if (q.status !== "done") {
    steps.push({ edge: "b-quality", to: "branch", packet: `Quality failed: ${failed(0)}`, result: cand?.title ?? "Remeasure needed", outcome: "done", needs: 5 });
    toReview("b-review");
    return steps;
  }
  steps.push({ edge: "e-context", to: "context", packet: "protocol · load · posture · glove", result: ctx.status === "done" ? "Conditions match: comparable" : `Not comparable: ${failed(1)} differ`, outcome: ctx.status === "done" ? "done" : "stopped", needs: 2 });
  if (ctx.status !== "done") {
    steps.push({ edge: "b-context", to: "branch", packet: `Not comparable: ${failed(1)}`, result: cand?.title ?? "Remeasure with the standard protocol", outcome: "done", needs: 5 });
    toReview("b-review");
    return steps;
  }
  const flagged = ev.result.comparisons.filter((x) => x.flagged).map((x) => inSentence(FEATURES[x.key].label));
  steps.push({
    edge: "e-features",
    to: "features",
    packet: "3 summary indicators (sEMG ×2 · grip meter)",
    result: ev.result.outcome === "result-incomplete" ? `${ev.result.headline}; not compared` : feat.status !== "done" ? "Features missing: not compared" : ev.result.outcome === "change-beyond-baseline" ? `${flagged.length} indicators outside the reference range` : ev.result.outcome === "single-feature" ? `Only ${flagged[0]} outside the reference range` : "All Within Reference Range",
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
