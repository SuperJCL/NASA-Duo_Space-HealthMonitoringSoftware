// MyoMars base station: SIMULATED analysis. A deterministic rule pipeline stands in for the
// "LLM analysis" of the demo; no model is called. Input: ONE standardised simulated measurement
// (fixed grip protocol), not continuous sEMG monitoring during free activity. Grip force is an
// independent simulated grip-meter reading taken with the protocol, never derived from sEMG. The same observation and baseline always give
// the same result (the UI only reveals the stages with a delay).
//
// Stages: quality check → context & comparability → feature comparison → recommendation template.
// - Poor data quality stops the pipeline: no physiological inference is made.
// - Non-comparable movement, load or protocol stops it too: no "muscle function decline" claim.
// - The output is a CANDIDATE for human review, never an action sent to the HUD.
// - No diagnosis, no treatment, no automatic task restriction.
// All thresholds, baselines and data are DEMO VALUES (not clinical, not validated).

import type { HudReport } from "./local-protocol";
import type { Observation, Protocol } from "./protocol";

export const STAGES = [
  { id: "quality", label: "质量检查" },
  { id: "context", label: "情境与可比性检查" },
  { id: "features", label: "特征比较" },
  { id: "recommendation", label: "建议模板" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export type StageStatus = "done" | "blocked" | "failed" | "skipped";

export type FeatureKey = "medianFreqHz" | "rmsPctMvc" | "gripForceN";
/** The three compared indicators. `source`: sEMG features vs the independent grip-meter reading. */
export const FEATURES: Record<FeatureKey, { label: string; unit: string; concern: "down" | "up"; source: string }> = {
  medianFreqHz: { label: "肌电中位频率", unit: "Hz", concern: "down", source: "sEMG" },
  rmsPctMvc: { label: "肌电幅值 RMS", unit: "%MVC", concern: "up", source: "sEMG" },
  gripForceN: { label: "握力", unit: "N", concern: "down", source: "握力计（独立测量）" },
};

export type Baseline = {
  astronautId: string;
  protocol: Protocol;
  sessions: number;
  recordedAt: string;
  features: Record<FeatureKey, { mean: number; sd: number }>;
};

/** DEMO thresholds (not clinical). */
export const DEMO_RULES = Object.freeze({
  quality: { minSampleRateHz: 1000, minDurationS: 10, maxImpedanceKOhm: 50, maxSaturationPct: 2, maxMotionArtifactPct: 15, maxDropoutPct: 5 },
  comparability: { maxTargetDiffPctPoints: 5 },
  features: { zFlag: 2, minFlaggedForChange: 2 },
});

export type Evidence = { label: string; value: string; ok: boolean | null; note?: string };
export type StageResult = { id: StageId; status: StageStatus; summary: string; evidence: Evidence[] };

export type Outcome = "within-baseline" | "single-feature" | "change-beyond-baseline" | "quality-blocked" | "not-comparable" | "analysis-failed" | "report-received";

export type Candidate =
  | { kind: "record-only"; title: string; rationale: string }
  | { kind: "retest"; title: string; rationale: string; retest: { protocol: Protocol; instructions: string } }
  | { kind: "notice-and-retest"; title: string; rationale: string; notice: { text: string }; retest: { protocol: Protocol; instructions: string } };

export type FeatureComparison = { key: FeatureKey; current: number | null; mean: number; sd: number; z: number | null; flagged: boolean };

export type AnalysisResult = {
  inputKey: string;
  stages: StageResult[];
  outcome: Outcome;
  /** Alert level this result asks for; existing alerts are never lowered by a result alone. */
  alert: "none" | "watch" | "alert";
  headline: string;
  conclusion: string;
  limitations: string[];
  comparisons: FeatureComparison[];
  candidate: Candidate | null;
};

const fmt = (x: number, d = 1) => (Number.isInteger(x) ? String(x) : x.toFixed(d));
const COMMON_LIMITS = ["演示规则与阈值，未经临床验证；不是诊断。", "仅与该宇航员自身基线比较，未考虑基线之外的因素（睡眠、补水、手套适配等）。"];

/** Stable key of the inputs (same input → same key → same result). */
export function inputKey(o: Observation, b: Baseline): string {
  return JSON.stringify([o.observationId, o.protocol, o.signal, o.features, b.astronautId, b.protocol.id, b.recordedAt]);
}

function standardRetest(b: Baseline, why: string): { protocol: Protocol; instructions: string } {
  return standardTask(b.protocol, why, "复测一次");
}
function standardTask(p: Protocol, why: string, what: string): { protocol: Protocol; instructions: string } {
  return { protocol: p, instructions: `${why}按标准协议「${p.label}」${what}（${p.targetPctMvc}% MVC，${postureText(p.posture)}，${p.glove === "eva-glove" ? "佩戴 EVA 手套" : "不戴手套"}）。` };
}

/**
 * The astronaut's OWN REPORT from the HUD (local mock extension). A report is checked, never
 * treated as a diagnosis, and never discarded because sensor data is missing or invalid. There is
 * no new measurement, so no sEMG comparison is made: the sensor step only states what the latest
 * measurement can (or cannot) tell, and the candidate asks for a standardised measurement.
 * Stage ids are reused: quality = report check, context = sensor data, features = not run.
 */
export function analyseReport(r: HudReport, latestMeasurement: { observation: Observation; result: AnalysisResult; at: string } | null, protocol: Protocol | null): AnalysisResult {
  const at = (iso: string) => new Date(iso).toISOString().slice(11, 16) + " UTC";
  const valid = latestMeasurement && ["within-baseline", "single-feature", "change-beyond-baseline"].includes(latestMeasurement.result.outcome);
  const stages: StageResult[] = [
    {
      id: "quality",
      status: "done",
      summary: `宇航员报告：“${r.text}”${r.request ? `；请求：${r.request}` : ""}。自述不是诊断，按流程核查。`,
      evidence: [
        { label: "报告内容", value: r.text, ok: null },
        { label: "请求", value: r.request ?? "无", ok: null },
        { label: "报告时间", value: at(r.reportedAt), ok: null },
      ],
    },
    {
      id: "context",
      status: valid ? "done" : "blocked",
      summary: !latestMeasurement
        ? "该宇航员本轮没有测量数据：无法用传感器核对报告，不作肌电分析。"
        : valid
          ? `最近一次有效测量（${at(latestMeasurement.at)}）：${latestMeasurement.result.headline}。仅作参考，不能证实或否定自述。`
          : `最近一次测量（${at(latestMeasurement.at)}）无效：${latestMeasurement.result.headline}。无法用传感器核对报告，不作肌电分析。`,
      evidence: [{ label: "最近测量", value: latestMeasurement ? `${at(latestMeasurement.at)} · ${latestMeasurement.result.headline}` : "无", ok: valid ? true : false }],
    },
    { id: "features", status: "skipped", summary: "未进行指标比较：报告本身不是测量，需要一次标准化测量。", evidence: [] },
  ];
  const candidate: Candidate = protocol
    ? {
        kind: "notice-and-retest",
        title: "回复宇航员并安排一次标准化测量",
        rationale: "自述需要用标准化测量核查；报告本身不是诊断。",
        notice: { text: "基地提示（模拟）：基地已收到你的报告。请在下一次停顿时按标准协议完成一次测量，便于基地核查；如情况变化请随时报告。" },
        retest: standardTask(protocol, "休息后，", "测量一次"),
      }
    : { kind: "record-only", title: "记录报告（缺少个体基线，无法安排标准测量）", rationale: "由基地人员直接处理。" };
  stages.push({ id: "recommendation", status: "done", summary: `生成待审候选：${candidate.title}。`, evidence: [{ label: "候选类型", value: candidate.kind, ok: null, note: "须经基地人员审核后才可发布" }] });
  return {
    inputKey: `report:${r.reportId}:${latestMeasurement?.observation.observationId ?? "none"}`,
    stages,
    outcome: "report-received",
    alert: "watch",
    headline: "宇航员主动报告，待核查",
    conclusion: "宇航员自述不是诊断。基地人员根据报告内容决定是否安排标准化测量；传感器数据的限制见“传感器数据”一步。",
    limitations: ["自述不能直接作为诊断依据。", "没有新的测量时不作肌电分析。", ...COMMON_LIMITS],
    comparisons: [],
    candidate,
  };
}
const postureText = (p: Protocol["posture"]) => ({ standing: "站姿", kneeling: "跪姿", seated: "坐姿" })[p];

export function analyse(o: Observation, b: Baseline, rules = DEMO_RULES): AnalysisResult {
  const key = inputKey(o, b);
  const stages: StageResult[] = [];
  const skip = (from: number, why: string) => {
    for (const s of STAGES.slice(from)) stages.push({ id: s.id, status: "skipped", summary: why, evidence: [] });
  };

  // 1. Quality check.
  const q = rules.quality;
  const sig = o.signal;
  const qEv: Evidence[] = [
    { label: "采样率", value: `${fmt(sig.sampleRateHz, 0)} Hz`, ok: sig.sampleRateHz >= q.minSampleRateHz, note: `≥ ${q.minSampleRateHz} Hz` },
    { label: "记录时长", value: `${fmt(sig.durationS)} s`, ok: sig.durationS >= q.minDurationS, note: `≥ ${q.minDurationS} s` },
    { label: "电极阻抗", value: `${fmt(sig.electrodeImpedanceKOhm)} kΩ`, ok: sig.electrodeImpedanceKOhm <= q.maxImpedanceKOhm, note: `≤ ${q.maxImpedanceKOhm} kΩ` },
    { label: "信号饱和", value: `${fmt(sig.saturationPct)} %`, ok: sig.saturationPct <= q.maxSaturationPct, note: `≤ ${q.maxSaturationPct} %` },
    { label: "运动伪迹", value: `${fmt(sig.motionArtifactPct)} %`, ok: sig.motionArtifactPct <= q.maxMotionArtifactPct, note: `≤ ${q.maxMotionArtifactPct} %` },
    { label: "数据丢失", value: `${fmt(sig.dropoutPct)} %`, ok: sig.dropoutPct <= q.maxDropoutPct, note: `≤ ${q.maxDropoutPct} %` },
  ];
  const qFail = qEv.filter((e) => e.ok === false);
  if (qFail.length) {
    stages.push({ id: "quality", status: "blocked", summary: `信号质量不合格（${qFail.map((e) => e.label).join("、")}），停止生理推断。`, evidence: qEv });
    skip(1, "因质量检查未通过而未执行");
    return {
      inputKey: key,
      stages,
      outcome: "quality-blocked",
      alert: "watch",
      headline: "采集质量不合格，无法评估",
      conclusion: "本次测量的信号质量未达到演示规则要求，不对肌肉状态作任何推断。",
      limitations: ["质量不合格的数据不能说明生理状态正常或异常。", ...COMMON_LIMITS],
      comparisons: [],
      candidate: { kind: "retest", title: "重新采集（检查电极与佩戴）", rationale: "数据质量问题，属于采集操作建议，不是生理结论。", retest: standardRetest(b, "检查电极接触与固定后，") },
    };
  }
  stages.push({ id: "quality", status: "done", summary: "信号质量满足演示规则，可继续。", evidence: qEv });

  // 2. Context & comparability with the individual baseline.
  const p = o.protocol;
  const cEv: Evidence[] = [
    { label: "协议", value: p.label, ok: p.id === b.protocol.id, note: `基线：${b.protocol.label}` },
    { label: "目标负荷", value: `${p.targetPctMvc}% MVC`, ok: Math.abs(p.targetPctMvc - b.protocol.targetPctMvc) <= rules.comparability.maxTargetDiffPctPoints, note: `基线 ${b.protocol.targetPctMvc}% MVC（±${rules.comparability.maxTargetDiffPctPoints}）` },
    { label: "姿势", value: postureText(p.posture), ok: p.posture === b.protocol.posture, note: `基线：${postureText(b.protocol.posture)}` },
    { label: "手套", value: p.glove === "eva-glove" ? "EVA 手套" : "无", ok: p.glove === b.protocol.glove, note: `基线：${b.protocol.glove === "eva-glove" ? "EVA 手套" : "无"}` },
    { label: "任务阶段", value: o.context.phase + (o.context.minutesIntoEva !== null ? ` · EVA 第 ${o.context.minutesIntoEva} 分钟` : ""), ok: null },
  ];
  const cFail = cEv.filter((e) => e.ok === false);
  if (cFail.length) {
    stages.push({ id: "context", status: "blocked", summary: `与个体基线不可比（${cFail.map((e) => e.label).join("、")}不同），不比较特征。`, evidence: cEv });
    skip(2, "因条件不可比而未执行");
    return {
      inputKey: key,
      stages,
      outcome: "not-comparable",
      alert: "watch",
      headline: "条件与基线不可比，不作肌肉功能判断",
      conclusion: "动作、负荷或协议与基线不同，数值差异可能来自条件本身，不能据此得出肌肉功能下降的结论。",
      limitations: ["不可比的测量只能说明条件不同，不能用于判断变化。", ...COMMON_LIMITS],
      comparisons: [],
      candidate: { kind: "retest", title: "按标准协议复测", rationale: "需要与基线条件一致的测量才能比较。", retest: standardRetest(b, "在下一次停顿时，") },
    };
  }
  stages.push({ id: "context", status: "done", summary: "协议、负荷、姿势和手套与个体基线一致，可比较。", evidence: cEv });

  // 3. Feature comparison (z-score against the individual baseline).
  if (!o.features || Object.values(o.features).some((v) => v === null || !Number.isFinite(v))) {
    stages.push({ id: "features", status: "failed", summary: "特征提取失败（模拟），无法比较。已有告警保持不变。", evidence: [{ label: "特征", value: "缺失或无效", ok: false }] });
    skip(3, "因特征比较失败而未执行");
    return {
      inputKey: key,
      stages,
      outcome: "analysis-failed",
      alert: "watch",
      headline: "分析失败：特征缺失",
      conclusion: "本次模拟分析未能完成，不能得出任何结论；不会清除已有告警。",
      limitations: ["分析失败不等于结果正常。", ...COMMON_LIMITS],
      comparisons: [],
      candidate: { kind: "retest", title: "重新采集", rationale: "特征缺失，需要新的测量。", retest: standardRetest(b, "") },
    };
  }
  const f = o.features;
  const comparisons: FeatureComparison[] = (Object.keys(FEATURES) as FeatureKey[]).map((k) => {
    const cur = f[k] as number;
    const { mean, sd } = b.features[k];
    const z = sd > 0 ? (cur - mean) / sd : 0;
    const flagged = FEATURES[k].concern === "down" ? z <= -rules.features.zFlag : z >= rules.features.zFlag;
    return { key: k, current: cur, mean, sd, z: Math.round(z * 100) / 100, flagged };
  });
  const flagged = comparisons.filter((c) => c.flagged);
  const fEv: Evidence[] = comparisons.map((c) => ({
    label: FEATURES[c.key].label,
    value: `${fmt(c.current!)} ${FEATURES[c.key].unit}（基线 ${fmt(c.mean)} ± ${fmt(c.sd)}，z = ${c.z!.toFixed(2)}）`,
    ok: !c.flagged,
    note: c.flagged ? `超出 ±${rules.features.zFlag} SD（关注方向：${FEATURES[c.key].concern === "down" ? "下降" : "上升"}）` : "在参考范围内",
  }));
  const outcome: Outcome = flagged.length >= rules.features.minFlaggedForChange ? "change-beyond-baseline" : flagged.length === 1 ? "single-feature" : "within-baseline";
  stages.push({
    id: "features",
    status: "done",
    summary:
      outcome === "change-beyond-baseline"
        ? `${flagged.length} 项指标超出个体基线波动（${flagged.map((c) => FEATURES[c.key].label).join("、")}）。`
        : outcome === "single-feature"
          ? `仅 ${FEATURES[flagged[0].key].label} 超出基线波动，证据不足以判断变化。`
          : `各项指标均在参考范围内（个体基线 ± ${rules.features.zFlag} SD）。`,
    evidence: fEv,
  });

  // 4. Recommendation template (candidate for human review only).
  let candidate: Candidate;
  let headline: string;
  let conclusion: string;
  let alert: AnalysisResult["alert"];
  const isRetest = o.context.phase === "retest";
  if (outcome === "change-beyond-baseline") {
    alert = "alert";
    headline = isRetest ? "复测仍超出个体基线波动" : "可比条件下指标超出个体基线波动";
    conclusion = "在与基线可比的标准化测量中，多项指标的变化超出该宇航员的基线波动（演示规则）。这是需要人工关注的信号，不是诊断。";
    candidate = {
      kind: "notice-and-retest",
      title: "向宇航员发送提示并安排标准复测",
      rationale: "多项特征同向变化；需要在相同条件下复测确认。",
      notice: { text: "基地提示（模拟）：你的前臂肌电与握力测量与平时基线不同。请在下一次停顿时按标准协议完成一次复测；如有不适请报告。" },
      retest: standardRetest(b, "休息后，"),
    };
  } else if (outcome === "single-feature") {
    alert = "watch";
    headline = "单项指标超出基线，证据不足";
    conclusion = "只有一项指标超出基线波动，不足以判断变化，建议复测。";
    candidate = { kind: "retest", title: "安排标准复测", rationale: "单项偏离可能来自测量波动。", retest: standardRetest(b, "") };
  } else {
    alert = "none";
    headline = isRetest ? "复测在参考范围内" : "测量在参考范围内";
    conclusion = isRetest
      ? "本次复测各项指标在参考范围内。单次正常结果不能证明已经恢复。"
      : "各项指标均在该宇航员的参考范围内（演示规则）。";
    candidate = { kind: "record-only", title: "仅记录：不发送行动消息", rationale: isRetest ? "复测结果在参考范围内，无需新的行动。" : "结果在参考范围内。" };
  }
  stages.push({ id: "recommendation", status: "done", summary: `生成待审候选：${candidate.title}。`, evidence: [{ label: "候选类型", value: candidate.kind, ok: null, note: "须经基地人员审核后才可发布" }] });
  return { inputKey: key, stages, outcome, alert, headline, conclusion, limitations: COMMON_LIMITS, comparisons, candidate };
}
