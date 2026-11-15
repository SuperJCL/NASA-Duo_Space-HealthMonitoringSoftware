import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRelay } from "../../../relay/relay.ts";
import { StationController } from "./controller";
import { DEMO_BASELINES, RETEST_FIXTURES, crewObservation } from "./fixtures";
import { RelayStationAdapter } from "./relay-adapter";
import { observationEnvelope, sampleById } from "../replay/replay";
import { latest, type StationState } from "./station";

const SID = "demo";
const relay = createRelay({ leaseMs: 15_000 });
let base = "";
beforeAll(async () => {
  base = `http://127.0.0.1:${await relay.listen(0, "127.0.0.1")}`;
});
afterAll(() => relay.close());

const waitFor = async <T,>(fn: () => T | undefined | false, ms = 8000): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};
/** A HUD stand-in: publishes as role hud / trigger exactly like a client would. */
const hudPost = (body: Record<string, unknown>, role = "hud") => fetch(`${base}/v1/sessions/${SID}/events`, { method: "POST", headers: { "content-type": "application/json", "x-myomars-role": role, "x-myomars-client": `test-${role}` }, body: JSON.stringify(body) }).then((r) => r.json());
const envelope = (o: Record<string, unknown>) => ({ schema: "myomars/v1", sessionId: SID, sentAt: new Date().toISOString(), ...o });
function station(clientId: string) {
  const adapter = new RelayStationAdapter({ baseUrl: base, sessionId: SID, clientId });
  const ctl = new StationController(adapter, 5, DEMO_BASELINES, SID);
  const detach = ctl.attach();
  const st = (): StationState => ctl.getSnapshot().state;
  return { adapter, ctl, detach, st };
}
const stationSent = () => relay.events(SID).filter((e) => e.sender.role === "station");

describe("station lease", () => {
  it("an immediate unsubscribe + resubscribe (React development mode) keeps the lease against another window", async () => {
    const sid = "lease-strict";
    // In a browser the release request can reach the relay AFTER the renewed claim; simulate that order.
    const lateRelease: typeof fetch = async (input, init) => {
      if (init?.method === "DELETE") await new Promise((r) => setTimeout(r, 400));
      return fetch(input, init);
    };
    const mk = (clientId: string) => new RelayStationAdapter({ baseUrl: base, sessionId: sid, clientId, fetchImpl: lateRelease });
    const A1 = mk("win-strict");
    const un1 = A1.subscribe(() => undefined);
    await waitFor(() => A1.getStatus().lease === "holder");
    const B = mk("win-other");
    const unB = B.subscribe(() => undefined);
    await waitFor(() => B.getStatus().lease === "readonly");
    // the double mount: release, then the same window id claims again at once
    un1();
    const A2 = mk("win-strict");
    const un2 = A2.subscribe(() => undefined);
    await waitFor(() => A2.getStatus().lease === "holder");
    await new Promise((r) => setTimeout(r, 6500)); // past the release delay and one heartbeat of B
    expect(A2.getStatus().lease).toBe("holder");
    expect(B.getStatus().lease).toBe("readonly");
    un2();
    unB();
  }, 20_000);
});

describe("station ↔ relay (two windows, reload, simulated HUD replies)", () => {
  it("runs the minimal real chain and never sends twice", async () => {
    const runId = "run-hud-1";
    // The HUD starts the run today (its simulated patch acts as the Trigger).
    await hudPost(envelope({ eventId: "start-1", runId, caseId: null, source: "trigger", type: "scenario.start", payload: { scenarioId: "myomars-normal", astronaut: { id: "a-02", callsign: "A-02" }, task: { id: "eva-patrol", title: "EVA patrol", targetId: null } } }), "trigger");

    const A = station("win-A");
    await waitFor(() => A.adapter.getStatus().lease === "holder" && A.st().run?.runId === runId);
    const B = station("win-B");
    await waitFor(() => B.adapter.getStatus().lease === "readonly" && B.st().run?.runId === runId);

    // Data replay (dev entry): a stored simulated sample into the current run, as the data producer.
    const run = A.st().run!;
    const obs = observationEnvelope(SID, { runId: run.runId, astronaut: run.astronaut, task: run.task }, sampleById("change")!, Date.now());
    expect((await A.adapter.publishAsReplay(obs)).ok).toBe(true);
    const caseId = obs.caseId!;
    await waitFor(() => A.st().cases[caseId]?.phase === "awaiting-review");
    expect(latest(A.st().cases[caseId]).result.outcome).toBe("change-beyond-baseline");

    // Human approval in window A → notice + retest task through the relay. B mirrors, never sends.
    expect(A.ctl.review(caseId, 1, "approve", "Several indicators deviate in the same direction; retest with the standard protocol to confirm", "Base duty officer")).toBeNull();
    await waitFor(() => stationSent().some((e) => e.type === "station.retest.requested"));
    await waitFor(() => B.st().cases[caseId]?.phase === "awaiting-hud" && B.st().cases[caseId].reviews.length === 1);
    expect(new Set(stationSent().map((e) => e.sender.clientId))).toEqual(new Set(["win-A"]));
    expect(B.ctl.review(caseId, 1, "approve", "A second window tries to approve again", "x")).toBeTruthy(); // not allowed any more

    // HUD: device receipt for both messages, then the astronaut confirms both.
    const actions = stationSent().filter((e) => e.type === "station.notice.approved" || e.type === "station.retest.requested");
    for (const m of actions) await hudPost(envelope({ eventId: `rcv-${m.eventId}`, runId, caseId, source: "hud", type: "hud.received", payload: { messageId: m.eventId } }));
    await waitFor(() => A.st().outbox.filter((m) => m.hudReceivedAt).length === 2);
    expect(A.st().outbox.filter((m) => m.feedback === "acknowledged")).toHaveLength(0); // receipt ≠ confirmation
    for (const m of actions) await hudPost(envelope({ eventId: `ack-${m.eventId}`, runId, caseId, source: "hud", type: "hud.ack", payload: { messageId: m.eventId } }));
    await waitFor(() => A.st().cases[caseId].phase === "awaiting-retest");

    // Reload: close both windows, open a new one. It restores everything and sends nothing.
    B.detach();
    A.detach();
    const sentBefore = stationSent().length;
    const C = station("win-C");
    await waitFor(() => C.adapter.getStatus().lease === "holder" && C.st().cases[caseId]?.phase === "awaiting-retest");
    const c = C.st().cases[caseId];
    expect(c.reviews.map((r) => r.decision)).toEqual(["approve"]);
    expect(c.retests).toHaveLength(1);
    expect(C.st().outbox.filter((m) => m.feedback === "acknowledged")).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 200));
    expect(stationSent()).toHaveLength(sentBefore);
    expect(C.ctl.review(caseId, 1, "approve", "Approve again after the reload", "x")).toBeTruthy();

    // Step 2 preview: a retest result → one receipt; a further reload adopts it instead of re-sending.
    const o = crewObservation(RETEST_FIXTURES["retest-normal"].observation(1), "a-02", "rt-obs-1", new Date().toISOString(), null);
    await hudPost(envelope({ eventId: "result-1", runId, caseId, retestId: c.retests[0].retestId, source: "hud", type: "retest.result", payload: { observation: o } }));
    await waitFor(() => latest(C.st().cases[caseId]).version === 2 && latest(C.st().cases[caseId]).completedAt);
    await waitFor(() => stationSent().filter((e) => e.type === "station.receipt").length === 1);
    C.detach();
    const D = station("win-D");
    await waitFor(() => D.adapter.getStatus().lease === "holder" && latest(D.st().cases[caseId] ?? { evaluations: [] } as never)?.version === 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(stationSent().filter((e) => e.type === "station.receipt")).toHaveLength(1);
    D.detach();
  }, 30_000);
});
