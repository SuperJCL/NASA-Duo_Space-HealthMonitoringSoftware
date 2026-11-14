import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboundEnvelope, MockStationAdapter } from "./adapter";
import { StationController } from "./controller";
import { DEMO_START, FIXTURES, RETEST_FIXTURES } from "./fixtures";
import { latest } from "./station";

describe("station controller (adapter + timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const adapter = new MockStationAdapter();
    const ctl = new StationController(adapter, 1000);
    const detach = ctl.attach();
    return { adapter, ctl, detach, s: () => ctl.getSnapshot().state };
  };

  it("paces the simulated analysis with timers and ends in a pending candidate, sending nothing", async () => {
    const { adapter, ctl, s } = setup();
    adapter.inject(inboundEnvelope("scenario.start", { runId: "r1", payload: DEMO_START }));
    adapter.inject(inboundEnvelope("observation.submitted", { runId: "r1", caseId: "case-change", payload: FIXTURES.change.observation }));
    expect(ctl.pendingTimers).toBe(1);
    expect(latest(s().cases["case-change"]).revealed).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(latest(s().cases["case-change"]).revealed).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(s().cases["case-change"].phase).toBe("awaiting-review");
    expect(ctl.pendingTimers).toBe(0);
    expect(adapter.sent.filter((e) => !e.type.startsWith("station.audit."))).toHaveLength(0);
  });

  it("reset cancels pending analysis timers; nothing from the old run changes the new state", async () => {
    const { adapter, ctl, s } = setup();
    adapter.inject(inboundEnvelope("scenario.start", { runId: "r1", payload: DEMO_START }));
    adapter.inject(inboundEnvelope("observation.submitted", { runId: "r1", caseId: "case-change", payload: FIXTURES.change.observation }));
    await vi.advanceTimersByTimeAsync(1500);
    adapter.inject(inboundEnvelope("scenario.reset", { runId: "r1", payload: {} }));
    expect(ctl.pendingTimers).toBe(0);
    adapter.inject(inboundEnvelope("scenario.start", { runId: "r2", payload: DEMO_START }));
    const before = s();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s()).toBe(before);
    expect(s().caseOrder).toHaveLength(0);
  });

  it("approval sends through the adapter and records delivery; a forced failure is visible and resendable", async () => {
    const { adapter, ctl, s } = setup();
    adapter.inject(inboundEnvelope("scenario.start", { runId: "r1", payload: DEMO_START }));
    adapter.inject(inboundEnvelope("observation.submitted", { runId: "r1", caseId: "case-change", payload: FIXTURES.change.observation }));
    await vi.advanceTimersByTimeAsync(4000);
    adapter.failNextSends(1);
    expect(ctl.review("case-change", 1, "approve", "证据一致，安排复测", "值班员 A")).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    const [notice, retest] = s().outbox.filter((m) => !m.type.startsWith("station.audit."));
    expect(notice.delivery).toBe("failed");
    expect(retest.delivery).toBe("sent");
    expect(adapter.sent.map((e) => e.type).filter((t) => !t.startsWith("station.audit."))).toEqual(["station.retest.requested"]);
    ctl.resend(notice.eventId);
    await vi.advanceTimersByTimeAsync(0);
    expect(s().outbox.find((m) => m.eventId === notice.eventId)!.delivery).toBe("sent");
    expect(adapter.sent.map((e) => e.eventId)).toContain(notice.eventId);

    // Retest result → receipt → v2 analysis.
    adapter.inject(inboundEnvelope("retest.result", { runId: "r1", caseId: "case-change", retestId: "case-change-rt1", payload: { observation: RETEST_FIXTURES["retest-normal"].observation(1) } }));
    await vi.advanceTimersByTimeAsync(4000);
    expect(adapter.sent.some((e) => e.type === "station.receipt")).toBe(true);
    expect(latest(s().cases["case-change"]).version).toBe(2);
    expect(s().cases["case-change"].phase).toBe("awaiting-review");
  });

  it("detach stops receiving and clears timers", () => {
    const { adapter, ctl, detach, s } = setup();
    adapter.inject(inboundEnvelope("scenario.start", { runId: "r1", payload: DEMO_START }));
    adapter.inject(inboundEnvelope("observation.submitted", { runId: "r1", caseId: "case-normal", payload: FIXTURES.normal.observation }));
    detach();
    expect(ctl.pendingTimers).toBe(0);
    adapter.inject(inboundEnvelope("observation.submitted", { runId: "r1", caseId: "case-change", payload: FIXTURES.change.observation }));
    expect(s().caseOrder).toEqual(["case-normal"]);
  });
});
