// DEV ONLY (relay mode): the simulated Trigger observation injected from the station's development
// entry while the real Trigger is not connected. It joins the run the relay currently has (the HUD
// starts it today) and is clearly published as role "trigger" by a "-dev-trigger" client.
import { crewObservation, FIXTURES, type FixtureId } from "./fixtures";
import { SCHEMA, type Envelope } from "./protocol";
import type { StationState } from "./station";

export function devObservation(s: StationState, fixture: FixtureId, nowMs: number): Envelope | null {
  if (!s.run) return null;
  const runId = s.run.runId;
  const at = new Date(nowMs).toISOString();
  const caseId = `${runId}-stn-dev-${nowMs.toString(36)}`;
  const payload = crewObservation(FIXTURES[fixture].observation, s.run.astronaut.id, `${caseId}-obs`, at, null);
  return { schema: SCHEMA, eventId: `${caseId}-evt`, sessionId: s.sessionId, runId, caseId, sentAt: at, occurredAt: at, source: "trigger", type: "observation.submitted", payload };
}
