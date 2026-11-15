import { describe, expect, it } from "vitest";
import { parseEnvelope } from "../../contracts/envelope.ts";
import { intakeCheck, observationEnvelope, REPLAY_SAMPLES, sampleById, startEnvelope } from "./replay";

const run = { runId: "run-rp-x", astronaut: { id: "a-02", callsign: "A-02" }, task: { id: "eva-sampling", title: "EVA sampling" } };

describe("data replay module (simulated samples, data producer role)", () => {
  it("every sample is labelled simulated and none is teammate data", () => {
    for (const s of REPLAY_SAMPLES) {
      expect(s.source.teammateData).toBe(false);
      expect(s.source.label).toMatch(/Simulated sample/);
    }
  });
  it("start and observation envelopes are valid contract messages from the trigger role", () => {
    const st = startEnvelope("demo", 1_700_000_000_000);
    expect(parseEnvelope(st).ok).toBe(true);
    expect(st.source).toBe("trigger");
    const o = observationEnvelope("demo", run, sampleById("change")!, 1_700_000_000_000);
    expect(parseEnvelope(o).ok).toBe(true);
    expect(o.type).toBe("observation.submitted");
  });
  it("publishes every measured value as stored; only person and time change, and both are listed as assumptions", () => {
    const s = sampleById("change")!;
    const p = observationEnvelope("demo", run, s, 1_700_000_000_000).payload as typeof s.observation;
    expect(p.features).toEqual(s.observation.features);
    expect(p.signal).toEqual(s.observation.signal);
    expect(p.protocol).toEqual(s.observation.protocol);
    expect(p.astronautId).toBe("a-02");
    expect(p.context).toEqual({ ...s.observation.context, taskId: run.task.id, minutesIntoEva: null });
    const { items, publishable } = intakeCheck(s, run, "t");
    expect(publishable).toBe(true);
    expect(items.find((i) => i.item === "Person")).toMatchObject({ status: "assumed" });
    expect(items.find((i) => i.item === "Time")).toMatchObject({ status: "assumed" });
    expect(items.find((i) => i.item === "Body site")).toMatchObject({ status: "assumed" });
    expect(items.find((i) => i.item === "Device")).toMatchObject({ status: "missing" });
    expect(items.find((i) => i.item === "EVA time point")).toMatchObject({ status: "missing" });
  });
  it("a missing grip-meter reading stays null (never zero) and is reported as missing", () => {
    const s = sampleById("grip-missing")!;
    const p = observationEnvelope("demo", run, s, 1).payload as typeof s.observation;
    expect(p.features?.gripForceN).toBeNull();
    expect(intakeCheck(s, run, "t").items.find((i) => i.item === "Missing values")).toMatchObject({ status: "missing" });
  });
  it("teammate data for another person, raw signals, or no run is blocked", () => {
    const s = sampleById("change")!;
    const teammate = { ...s, source: { label: "x", teammateData: true, kind: "features" as const } };
    expect(intakeCheck(teammate, run, "t").publishable).toBe(false);
    expect(intakeCheck({ ...teammate, observation: { ...s.observation, astronautId: "a-02" } }, run, "t").publishable).toBe(true);
    expect(intakeCheck({ ...s, source: { ...s.source, kind: "raw" } }, run, "t").publishable).toBe(false);
    expect(intakeCheck(s, null, "t").publishable).toBe(false);
  });
  it("a file that is not a contract observation stops at the format check and names the fields", () => {
    const odd = { ...sampleById("change")!, observation: { signal: {}, features: {} } as never };
    const r = intakeCheck(odd, run, "t");
    expect(r.publishable).toBe(false);
    expect(r.items.map((i) => i.item)).toEqual(["Format", "Source"]);
    expect(r.items[0].detail).toMatch(/observationId/);
  });
});
