// DEMO FIXTURES (simulated). The station's individual baselines live here; the Trigger-side
// inputs (scenario start, observations, retest results) are shared contracts and are re-exported
// from src/contracts/demo-fixtures.ts. Values are invented for the demo; they are not measurements
// and carry no clinical meaning. The astronaut, task and baseline are simulated.

import type { Baseline } from "./analysis";
import { STANDARD_PROTOCOL } from "@/contracts/demo-fixtures.ts";

export { DEMO_ASTRONAUT, DEMO_START, FIXTURES, RETEST_FIXTURES, STANDARD_PROTOCOL } from "@/contracts/demo-fixtures.ts";
export type { FixtureId, RetestFixtureId } from "@/contracts/demo-fixtures.ts";

export const DEMO_BASELINES: readonly Baseline[] = [
  {
    astronautId: "ev1",
    protocol: STANDARD_PROTOCOL,
    sessions: 6,
    recordedAt: "2026-11-10T08:00:00Z",
    features: { medianFreqHz: { mean: 92, sd: 4 }, rmsPctMvc: { mean: 38, sd: 3 }, gripForceN: { mean: 160, sd: 8 } },
  },
];
