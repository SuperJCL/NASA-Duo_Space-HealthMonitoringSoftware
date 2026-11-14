// DEMO FIXTURES (simulated). Replaceable test inputs for developing the base station before the
// Trigger and HUD are connected. Values are invented for the demo; they are not measurements and
// carry no clinical meaning. The astronaut, task and baseline are simulated.

import type { Baseline } from "./analysis";
import type { Observation, Protocol, ScenarioStart } from "./protocol";

export const STANDARD_PROTOCOL: Protocol = { id: "std-grip-40", label: "标准握持 40% MVC · 30 s", targetPctMvc: 40, posture: "standing", glove: "eva-glove" };

export const DEMO_ASTRONAUT = { id: "ev1", callsign: "EV1（模拟宇航员）" };

export const DEMO_BASELINES: readonly Baseline[] = [
  {
    astronautId: "ev1",
    protocol: STANDARD_PROTOCOL,
    sessions: 6,
    recordedAt: "2026-11-10T08:00:00Z",
    features: { medianFreqHz: { mean: 92, sd: 4 }, rmsPctMvc: { mean: 38, sd: 3 }, gripForceN: { mean: 160, sd: 8 } },
  },
];

export const DEMO_START: ScenarioStart = {
  scenarioId: "myomars-demo",
  astronaut: DEMO_ASTRONAUT,
  // Neutral task context (mock until the Trigger's scenario payload is agreed).
  task: { id: "eva-sampling", title: "EVA 采样作业", targetId: null },
};

const goodSignal = { sampleRateHz: 2000, durationS: 30, electrodeImpedanceKOhm: 12, saturationPct: 0.2, motionArtifactPct: 4, dropoutPct: 0.5 };

function obs(id: string, phase: Observation["context"]["phase"], partial: Partial<Observation>): Observation {
  return {
    observationId: id,
    astronautId: "ev1",
    capturedAt: "2026-11-14T10:00:00Z",
    protocol: STANDARD_PROTOCOL,
    context: { taskId: "eva-sampling", phase, minutesIntoEva: phase === "eva" ? 95 : null },
    signal: goodSignal,
    features: { medianFreqHz: 90, rmsPctMvc: 39, gripForceN: 158 },
    ...partial,
  };
}

export type FixtureId = "normal" | "acquisition" | "not-comparable" | "change";

export const FIXTURES: Record<FixtureId, { label: string; caseId: string; observation: Observation }> = {
  normal: { label: "正常", caseId: "case-normal", observation: obs("obs-normal-1", "eva", {}) },
  acquisition: {
    label: "采集异常",
    caseId: "case-acquisition",
    observation: obs("obs-acq-1", "eva", { signal: { ...goodSignal, electrodeImpedanceKOhm: 180, motionArtifactPct: 32 } }),
  },
  "not-comparable": {
    label: "条件不可比",
    caseId: "case-noncomparable",
    observation: obs("obs-nc-1", "eva", {
      protocol: { id: "eva-core-drill", label: "岩芯钻取中持续握持", targetPctMvc: 70, posture: "kneeling", glove: "eva-glove" },
      features: { medianFreqHz: 78, rmsPctMvc: 61, gripForceN: 241 },
    }),
  },
  change: { label: "可比变化与复测", caseId: "case-change", observation: obs("obs-change-1", "eva", { features: { medianFreqHz: 80, rmsPctMvc: 44, gripForceN: 142 } }) },
};

export type RetestFixtureId = "retest-normal" | "retest-changed" | "retest-invalid";
export const RETEST_FIXTURES: Record<RetestFixtureId, { label: string; observation: (n: number) => Observation }> = {
  "retest-normal": { label: "复测：回到基线范围", observation: (n) => obs(`obs-retest-normal-${n}`, "retest", { capturedAt: "2026-11-14T10:40:00Z", features: { medianFreqHz: 89, rmsPctMvc: 39.5, gripForceN: 156 } }) },
  "retest-changed": { label: "复测：仍有变化", observation: (n) => obs(`obs-retest-changed-${n}`, "retest", { capturedAt: "2026-11-14T10:40:00Z", features: { medianFreqHz: 81, rmsPctMvc: 43, gripForceN: 144 } }) },
  "retest-invalid": {
    label: "复测：质量无效",
    observation: (n) => obs(`obs-retest-invalid-${n}`, "retest", { capturedAt: "2026-11-14T10:40:00Z", signal: { ...goodSignal, dropoutPct: 22 } }),
  },
};
