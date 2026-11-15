import { describe, expect, it } from "vitest";
import { missionPhase, runTask, type MissionDef } from "./mission";

const def: MissionDef = { id: "mission-glass-lefroy", title: "t", label: "l", tasks: [{ taskId: "task-a", title: "Survey", targetId: "sim-target-a", targetName: "Target A" }] };
const run = (o: Partial<{ evaEndedAt: string | null; scenarioId: string; taskId: string }> = {}) => ({
  runId: "eva-1",
  scenarioId: o.scenarioId ?? "mission-glass-lefroy",
  astronaut: { id: "a-02", callsign: "A-02" },
  task: { id: o.taskId ?? "task-a", title: "Survey", targetId: "sim-target-a" },
  startedAt: "t",
  startedBy: "station" as const,
  evaEndedAt: o.evaEndedAt ?? null,
  evaEndedBy: null,
});

describe("mission phase (derived from the station state, never from the views)", () => {
  it("preparing → starting → EVA active → EVA ended; a new start after an end is 'starting'", () => {
    expect(missionPhase({ run: null, pendingStart: null })).toBe("preparing");
    expect(missionPhase({ run: null, pendingStart: { eventId: "e", runId: "eva-1", at: "t" } })).toBe("starting");
    expect(missionPhase({ run: run(), pendingStart: null })).toBe("eva-active");
    expect(missionPhase({ run: run({ evaEndedAt: "t2" }), pendingStart: null })).toBe("eva-ended");
    expect(missionPhase({ run: run({ evaEndedAt: "t2" }), pendingStart: { eventId: "e2", runId: "eva-2", at: "t" } })).toBe("starting");
  });
  it("the run's task is looked up in the mission only for this mission's runs", () => {
    expect(runTask(def, { run: run() })?.targetName).toBe("Target A");
    expect(runTask(def, { run: run({ scenarioId: "other" }) })).toBeNull();
    expect(runTask(def, { run: null })).toBeNull();
  });
});
