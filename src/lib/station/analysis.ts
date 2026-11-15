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
  { id: "quality", label: "Signal Quality" },
  { id: "context", label: "Comparability" },
  { id: "features", label: "Comparison" },
  { id: "recommendation", label: "Recommendation" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export type StageStatus = "done" | "blocked" | "failed" | "skipped";

export type FeatureKey = "medianFreqHz" | "rmsPctMvc" | "gripForceN";
/** The three compared indicators. `source`: sEMG features vs the independent grip-meter reading. */
export const FEATURES: Record<FeatureKey, { label: string; unit: string; concern: "down" | "up"; source: string }> = {
  medianFreqHz: { label: "sEMG median frequency", unit: "Hz", concern: "down", source: "sEMG" },
  rmsPctMvc: { label: "sEMG RMS amplitude", unit: "%MVC", concern: "up", source: "sEMG" },
  gripForceN: { label: "Grip force", unit: "N", concern: "down", source: "grip meter (independent reading)" },
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

export type Outcome = "within-baseline" | "single-feature" | "change-beyond-baseline" | "quality-blocked" | "not-comparable" | "result-incomplete" | "analysis-failed" | "report-received";

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

/** Lower-case a label inside a sentence, keeping acronyms ("sEMG RMS amplitude" stays as is, "Grip force" → "grip force"). */
export const inSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label);
const fmt = (x: number, d = 1) => (Number.isInteger(x) ? String(x) : x.toFixed(d));
const COMMON_LIMITS = ["Demo rules and thresholds, not clinically validated; not a diagnosis.", "Compared with this astronaut's own baseline only; factors outside the baseline (sleep, hydration, glove fit, …) are not considered."];

/** Stable key of the inputs (same input → same key → same result). */
export function inputKey(o: Observation, b: Baseline): string {
  return JSON.stringify([o.observationId, o.protocol, o.signal, o.features, b.astronautId, b.protocol.id, b.recordedAt]);
}

function standardRetest(b: Baseline, why: string): { protocol: Protocol; instructions: string } {
  return standardTask(b.protocol, why, "Retest once");
}
function standardTask(p: Protocol, why: string, what: string): { protocol: Protocol; instructions: string } {
  // `why` is an optional lead-in ending with a space (e.g. "After a rest, ").
  return { protocol: p, instructions: `${why}${why ? what.charAt(0).toLowerCase() + what.slice(1) : what} with the standard protocol "${p.label}" (${p.targetPctMvc}% MVC, ${postureText(p.posture)}, ${p.glove === "eva-glove" ? "EVA glove on" : "no glove"}).` };
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
      summary: `Astronaut report: "${r.text}"${r.request ? `; request: ${r.request}` : ""}. A self-report is not a diagnosis; checked as usual.`,
      evidence: [
        { label: "Report", value: r.text, ok: null },
        { label: "Request", value: r.request ?? "none", ok: null },
        { label: "Reported at", value: at(r.reportedAt), ok: null },
      ],
    },
    {
      id: "context",
      status: valid ? "done" : "blocked",
      summary: !latestMeasurement
        ? "No measurement for this astronaut in this run: the report cannot be checked against sensor data; no sEMG analysis."
        : valid
          ? `Latest valid measurement (${at(latestMeasurement.at)}): ${latestMeasurement.result.headline}. For reference only; it neither confirms nor rules out the report.`
          : `Latest measurement (${at(latestMeasurement.at)}) not usable: ${latestMeasurement.result.headline}. The report cannot be checked against sensor data; no sEMG analysis.`,
      evidence: [{ label: "Latest measurement", value: latestMeasurement ? `${at(latestMeasurement.at)} · ${latestMeasurement.result.headline}` : "none", ok: valid ? true : false }],
    },
    { id: "features", status: "skipped", summary: "No indicator comparison: a report is not a measurement; a standardised measurement is needed.", evidence: [] },
  ];
  const candidate: Candidate = protocol
    ? {
        kind: "notice-and-retest",
        title: "Reply to the astronaut and schedule one standardised measurement",
        rationale: "A self-report is checked with a standardised measurement; the report itself is not a diagnosis.",
        notice: { text: "Base notice (simulated): the base received your report. At your next pause, please complete one measurement with the standard protocol so the base can check it. Report any change at any time." },
        retest: standardTask(protocol, "After a rest, ", "Measure once"),
      }
    : { kind: "record-only", title: "Record the report (no individual baseline; no standard measurement can be scheduled)", rationale: "Handled directly by base staff." };
  stages.push({ id: "recommendation", status: "done", summary: `Candidate for base review: ${candidate.title}.`, evidence: [{ label: "Candidate type", value: candidate.kind, ok: null, note: "published only after base staff review" }] });
  return {
    inputKey: `report:${r.reportId}:${latestMeasurement?.observation.observationId ?? "none"}`,
    stages,
    outcome: "report-received",
    alert: "watch",
    headline: "Astronaut report, to be checked",
    conclusion: "A self-report is not a diagnosis. Base staff decide from the report whether to schedule a standardised measurement; the limits of the sensor data are shown in the sensor-data step.",
    limitations: ["A self-report is not a basis for a diagnosis.", "No sEMG analysis without a new measurement.", ...COMMON_LIMITS],
    comparisons: [],
    candidate,
  };
}
const postureText = (p: Protocol["posture"]) => ({ standing: "standing", kneeling: "kneeling", seated: "seated" })[p];

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
    { label: "Sample rate", value: `${fmt(sig.sampleRateHz, 0)} Hz`, ok: sig.sampleRateHz >= q.minSampleRateHz, note: `≥ ${q.minSampleRateHz} Hz` },
    { label: "Duration", value: `${fmt(sig.durationS)} s`, ok: sig.durationS >= q.minDurationS, note: `≥ ${q.minDurationS} s` },
    { label: "Electrode impedance", value: `${fmt(sig.electrodeImpedanceKOhm)} kΩ`, ok: sig.electrodeImpedanceKOhm <= q.maxImpedanceKOhm, note: `≤ ${q.maxImpedanceKOhm} kΩ` },
    { label: "Saturation", value: `${fmt(sig.saturationPct)} %`, ok: sig.saturationPct <= q.maxSaturationPct, note: `≤ ${q.maxSaturationPct} %` },
    { label: "Motion artefact", value: `${fmt(sig.motionArtifactPct)} %`, ok: sig.motionArtifactPct <= q.maxMotionArtifactPct, note: `≤ ${q.maxMotionArtifactPct} %` },
    { label: "Dropout", value: `${fmt(sig.dropoutPct)} %`, ok: sig.dropoutPct <= q.maxDropoutPct, note: `≤ ${q.maxDropoutPct} %` },
  ];
  const qFail = qEv.filter((e) => e.ok === false);
  if (qFail.length) {
    stages.push({ id: "quality", status: "blocked", summary: `Signal quality failed (${qFail.map((e) => inSentence(e.label)).join(", ")}); no physiological inference.`, evidence: qEv });
    skip(1, "Not run: the quality check failed");
    return {
      inputKey: key,
      stages,
      outcome: "quality-blocked",
      alert: "watch",
      headline: "Signal quality failed: Unable to Assess",
      conclusion: "The signal quality of this measurement does not meet the demo rules; nothing is inferred about the muscle.",
      limitations: ["Data that failed the quality check say nothing about whether the muscle is normal or not.", ...COMMON_LIMITS],
      comparisons: [],
      candidate: { kind: "retest", title: "Re-measure (check electrodes and fit)", rationale: "A data-quality problem: an acquisition step, not a physiological conclusion.", retest: standardRetest(b, "After checking electrode contact and fixation, ") },
    };
  }
  stages.push({ id: "quality", status: "done", summary: "Signal quality meets the demo rules.", evidence: qEv });

  // 2. Context & comparability with the individual baseline.
  const p = o.protocol;
  const cEv: Evidence[] = [
    { label: "Protocol", value: p.label, ok: p.id === b.protocol.id, note: `baseline: ${b.protocol.label}` },
    { label: "Target load", value: `${p.targetPctMvc}% MVC`, ok: Math.abs(p.targetPctMvc - b.protocol.targetPctMvc) <= rules.comparability.maxTargetDiffPctPoints, note: `baseline ${b.protocol.targetPctMvc}% MVC (±${rules.comparability.maxTargetDiffPctPoints})` },
    { label: "Posture", value: postureText(p.posture), ok: p.posture === b.protocol.posture, note: `baseline: ${postureText(b.protocol.posture)}` },
    { label: "Glove", value: p.glove === "eva-glove" ? "EVA glove" : "none", ok: p.glove === b.protocol.glove, note: `baseline: ${b.protocol.glove === "eva-glove" ? "EVA glove" : "none"}` },
    { label: "Mission phase", value: o.context.phase + (o.context.minutesIntoEva !== null ? ` · EVA minute ${o.context.minutesIntoEva}` : ""), ok: null },
  ];
  const cFail = cEv.filter((e) => e.ok === false);
  if (cFail.length) {
    stages.push({ id: "context", status: "blocked", summary: `Not comparable with the individual baseline (${cFail.map((e) => inSentence(e.label)).join(", ")} differ); indicators are not compared.`, evidence: cEv });
    skip(2, "Not run: conditions not comparable");
    return {
      inputKey: key,
      stages,
      outcome: "not-comparable",
      alert: "watch",
      headline: "Conditions Not Comparable: no muscle-function judgement",
      conclusion: "Movement, load or protocol differ from the baseline, so differences may come from the conditions themselves; no conclusion about muscle function can be drawn.",
      limitations: ["A measurement that is not comparable only shows that the conditions differ; it cannot show a change.", ...COMMON_LIMITS],
      comparisons: [],
      candidate: { kind: "retest", title: "Retest with the standard protocol", rationale: "Only a measurement under the baseline conditions can be compared.", retest: standardRetest(b, "At your next pause, ") },
    };
  }
  stages.push({ id: "context", status: "done", summary: "Protocol, load, posture and glove match the individual baseline: comparable.", evidence: cEv });

  // 3a. Result completeness by protocol. The standard protocol has three indicators: two sEMG
  // features and the independent grip-meter reading. A missing value stays missing (never invented,
  // never zero) and nothing is compared: comparing a subset would change the protocol, which is a
  // team decision (docs/myomars/INTEGRATION.md).
  const present = o.features ? (Object.keys(FEATURES) as FeatureKey[]).filter((k) => o.features![k] !== null && Number.isFinite(o.features![k])) : [];
  const absent = (Object.keys(FEATURES) as FeatureKey[]).filter((k) => !present.includes(k));
  if (o.features && present.length > 0 && absent.length > 0) {
    const names = absent.map((k) => `${inSentence(FEATURES[k].label)} (${FEATURES[k].source.replace(/ \(.*\)/, "")})`).join(", ");
    const total = Object.keys(FEATURES).length;
    stages.push({
      id: "features",
      status: "blocked",
      summary: `Incomplete Results: missing ${names}. The protocol requires ${total} indicators, ${present.length} received; missing values are not invented or set to zero, and nothing is compared.`,
      evidence: (Object.keys(FEATURES) as FeatureKey[]).map((k) => ({
        label: FEATURES[k].label,
        value: present.includes(k) ? `${fmt(o.features![k] as number)} ${FEATURES[k].unit}` : "missing (not provided)",
        ok: present.includes(k) ? null : false,
        note: present.includes(k) ? `${FEATURES[k].source} · received, not compared` : `${FEATURES[k].source} · required by the protocol`,
      })),
    });
    skip(3, "Not run: incomplete results");
    return {
      inputKey: key,
      stages,
      outcome: "result-incomplete",
      alert: "watch",
      headline: `Incomplete Results: missing ${absent.map((k) => inSentence(FEATURES[k].label)).join(", ")}`,
      conclusion: "This measurement lacks indicators the protocol requires: nothing is compared and nothing is inferred about the muscle; any existing alert stays.",
      limitations: ["An incomplete result says nothing about whether the muscle is normal or not.", "Comparing a subset of indicators would need a team decision on the protocol; not done.", ...COMMON_LIMITS],
      comparisons: [],
      candidate: { kind: "retest", title: "Complete the measurement per protocol", rationale: `Missing ${names}: one complete standard measurement is needed.`, retest: standardRetest(b, "") },
    };
  }
  // 3b. Feature comparison (z-score against the individual baseline).
  if (!o.features || absent.length > 0) {
    stages.push({ id: "features", status: "failed", summary: "Feature extraction failed (simulated): nothing can be compared. Any existing alert stays.", evidence: [{ label: "Features", value: "missing or invalid", ok: false }] });
    skip(3, "Not run: the comparison failed");
    return {
      inputKey: key,
      stages,
      outcome: "analysis-failed",
      alert: "watch",
      headline: "Analysis failed: features missing",
      conclusion: "This simulated analysis could not be completed; no conclusion can be drawn and no existing alert is cleared.",
      limitations: ["A failed analysis does not mean a normal result.", ...COMMON_LIMITS],
      comparisons: [],
      candidate: { kind: "retest", title: "Re-measure", rationale: "Features missing: a new measurement is needed.", retest: standardRetest(b, "") },
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
    value: `${fmt(c.current!)} ${FEATURES[c.key].unit} (baseline ${fmt(c.mean)} ± ${fmt(c.sd)}, z = ${c.z!.toFixed(2)})`,
    ok: !c.flagged,
    note: c.flagged ? `outside ±${rules.features.zFlag} SD (direction of concern: ${FEATURES[c.key].concern === "down" ? "lower" : "higher"})` : "Within Reference Range",
  }));
  const outcome: Outcome = flagged.length >= rules.features.minFlaggedForChange ? "change-beyond-baseline" : flagged.length === 1 ? "single-feature" : "within-baseline";
  stages.push({
    id: "features",
    status: "done",
    summary:
      outcome === "change-beyond-baseline"
        ? `${flagged.length} indicators beyond the individual baseline variation (${flagged.map((c) => inSentence(FEATURES[c.key].label)).join(", ")}).`
        : outcome === "single-feature"
          ? `Only ${inSentence(FEATURES[flagged[0].key].label)} is beyond the baseline variation: not enough evidence of a change.`
          : `All indicators Within Reference Range (individual baseline ± ${rules.features.zFlag} SD).`,
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
    headline = isRetest ? "Retest still beyond the individual baseline variation" : "Indicators beyond the individual baseline variation";
    conclusion = "In a standardised measurement comparable with the baseline, several indicators changed beyond this astronaut's baseline variation (demo rules). A signal for human attention, not a diagnosis.";
    candidate = {
      kind: "notice-and-retest",
      title: "Send a notice and schedule a standard retest",
      rationale: "Several indicators changed in the same direction; a retest under the same conditions is needed to confirm.",
      notice: { text: "Base notice (simulated): your forearm sEMG and grip measurement differs from your usual baseline. At your next pause, please complete one retest with the standard protocol. Report any discomfort." },
      retest: standardRetest(b, "After a rest, "),
    };
  } else if (outcome === "single-feature") {
    alert = "watch";
    headline = "Single indicator beyond the baseline: insufficient evidence";
    conclusion = "Only one indicator is beyond the baseline variation: not enough to judge a change; a retest is suggested.";
    candidate = { kind: "retest", title: "Schedule a standard retest", rationale: "A single deviation may be measurement variation.", retest: standardRetest(b, "") };
  } else {
    alert = "none";
    headline = isRetest ? "Retest Within Reference Range" : "Measurement Within Reference Range";
    conclusion = isRetest
      ? "All indicators of this retest are Within Reference Range. One result in range does not show recovery."
      : "All indicators are Within Reference Range for this astronaut (demo rules). This is not a health clearance.";
    candidate = { kind: "record-only", title: "Record only: no action message", rationale: isRetest ? "The retest is Within Reference Range; no new action is needed." : "The result is Within Reference Range." };
  }
  stages.push({ id: "recommendation", status: "done", summary: `Candidate for base review: ${candidate.title}.`, evidence: [{ label: "Candidate type", value: candidate.kind, ok: null, note: "published only after base staff review" }] });
  return { inputKey: key, stages, outcome, alert, headline, conclusion, limitations: COMMON_LIMITS, comparisons, candidate };
}
