// DEMO FIXTURES (simulated). The station's individual baselines live here; the Trigger-side
// inputs (scenario start, observations, retest results) are shared contracts and are re-exported
// from src/contracts/demo-fixtures.ts. Values are invented for the demo; they are not measurements
// and carry no clinical meaning. Astronauts, tasks and baselines are simulated.
//
// Crew demo (local): three simulated astronauts. EV2 and EV3 reuse the shared observation
// fixtures with their own astronautId and with every indicator shifted by the same offset as their
// baseline mean (same SD), so each person's numbers differ while the demo outcomes stay identical.
// That makes any mix-up between people visible.

import type { Baseline, FeatureKey } from "./analysis";
import type { CrewMemberPayload, HudReport } from "./local-protocol";
import type { Observation } from "./protocol";
import { STANDARD_PROTOCOL } from "@/contracts/demo-fixtures.ts";

export { DEMO_ASTRONAUT, DEMO_START, FIXTURES, RETEST_FIXTURES, STANDARD_PROTOCOL } from "@/contracts/demo-fixtures.ts";
export type { FixtureId, RetestFixtureId } from "@/contracts/demo-fixtures.ts";

const EV1_MEANS: Record<FeatureKey, number> = { medianFreqHz: 92, rmsPctMvc: 38, gripForceN: 160 };
/** Offset of each simulated astronaut's baseline mean from EV1's (same SDs). */
const OFFSETS: Record<string, Record<FeatureKey, number>> = {
  ev1: { medianFreqHz: 0, rmsPctMvc: 0, gripForceN: 0 },
  ev2: { medianFreqHz: -4, rmsPctMvc: -2, gripForceN: 12 },
  ev3: { medianFreqHz: 3, rmsPctMvc: 1, gripForceN: -10 },
};
const baseline = (astronautId: string): Baseline => {
  const o = OFFSETS[astronautId];
  return {
    astronautId,
    protocol: STANDARD_PROTOCOL,
    sessions: 6,
    recordedAt: "2026-11-10T08:00:00Z",
    features: { medianFreqHz: { mean: EV1_MEANS.medianFreqHz + o.medianFreqHz, sd: 4 }, rmsPctMvc: { mean: EV1_MEANS.rmsPctMvc + o.rmsPctMvc, sd: 3 }, gripForceN: { mean: EV1_MEANS.gripForceN + o.gripForceN, sd: 8 } },
  };
};
export const DEMO_BASELINES: readonly Baseline[] = [baseline("ev1"), baseline("ev2"), baseline("ev3")];

/** The simulated crew of the local demo (local roster extension). Times are relative to the demo start. */
export const DEMO_CREW: readonly { astronautId: string; callsign: string; task: { id: string; title: string }; minutesIntoEva: number; deviceId: string }[] = [
  { astronautId: "ev1", callsign: "EV1（模拟宇航员）", task: { id: "eva-sampling", title: "EVA 采样作业" }, minutesIntoEva: 95, deviceId: "semg-ev1" },
  { astronautId: "ev2", callsign: "EV2（模拟宇航员）", task: { id: "eva-inspection", title: "EVA 设备巡检" }, minutesIntoEva: 62, deviceId: "semg-ev2" },
  { astronautId: "ev3", callsign: "EV3（模拟宇航员）", task: { id: "eva-transfer", title: "EVA 样本转运" }, minutesIntoEva: 38, deviceId: "semg-ev3" },
];

export const rosterMembers = (nowMs: number): CrewMemberPayload[] =>
  DEMO_CREW.map((m) => ({ astronautId: m.astronautId, callsign: m.callsign, task: m.task, evaStartedAt: new Date(nowMs - m.minutesIntoEva * 60_000).toISOString(), deviceId: m.deviceId }));

/** A shared fixture observation re-targeted to one simulated astronaut (id, time, EVA minute, shifted indicators). */
export function crewObservation(o: Observation, astronautId: string, observationId: string, capturedAt: string, minutesIntoEva: number | null): Observation {
  const off = OFFSETS[astronautId] ?? OFFSETS.ev1;
  const f = o.features;
  return {
    ...o,
    observationId,
    astronautId,
    capturedAt,
    deviceId: DEMO_CREW.find((m) => m.astronautId === astronautId)?.deviceId,
    context: { ...o.context, minutesIntoEva: o.context.phase === "eva" ? minutesIntoEva : null },
    features: f
      ? {
          medianFreqHz: f.medianFreqHz === null ? null : f.medianFreqHz + off.medianFreqHz,
          rmsPctMvc: f.rmsPctMvc === null ? null : f.rmsPctMvc + off.rmsPctMvc,
          gripForceN: f.gripForceN === null ? null : f.gripForceN + off.gripForceN,
        }
      : null,
  };
}

/** The astronaut's own report used by the local demo (simulated; not a diagnosis). */
export const demoReport = (astronautId: string, reportId: string, reportedAt: string): HudReport => ({
  reportId,
  astronautId,
  text: "右前臂持续酸胀，握工具时比平时吃力。",
  request: "请基地评估是否需要做一次测量",
  reportedAt,
});
