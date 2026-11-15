import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboundEnvelope, MockStationAdapter } from "./adapter";
import { commStream } from "./comms";
import { StationController } from "./controller";
import { crewCards, notifications } from "./crew";
import { DemoDirector, demoTargetCase, hudInput, nextAutoStep } from "./demo";
import { DEMO_START, FIXTURES } from "./fixtures";
import { buildFlow, type FlowView } from "./flow";

/** Controller + mock adapter + demo director, wired like the page does. */
function setup(autoHud = false) {
  const adapter = new MockStationAdapter();
  const ctl = new StationController(adapter, 1100);
  ctl.attach();
  const director = new DemoDirector((raw) => adapter.inject(raw));
  director.setAutoHud(autoHud);
  ctl.subscribe(() => director.update(ctl.getSnapshot().state));
  director.update(ctl.getSnapshot().state);
  const st = () => ctl.getSnapshot().state;
  const caseOf = (astronautId: string) => demoTargetCase(st(), astronautId)!;
  const flow = (caseId: string): FlowView => buildFlow(st(), st().cases[caseId], { mock: true });
  const at = (f: FlowView) => `${f.current?.node.id}:${f.current?.node.state}:${f.who}`;
  return { adapter, ctl, director, st, caseOf, flow, at };
}
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const ANALYSIS = 4 * 1100 + 50;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("crew demo: device observation change → analysis → approve retest → simulated HUD → re-evaluation → close", () => {
  it("follows recorded state only, end to end, for the right astronaut", async () => {
    const { ctl, director, st, caseOf, flow, at } = setup(true);
    director.launch("ev1", "change");
    // Run started immediately: three simulated crew members, devices connected, no data yet.
    let cards = crewCards(st(), { mock: true });
    expect(cards.map((c) => [c.callsign, c.connection.state, c.data.validity])).toEqual([
      ["EV1 (simulated)", "connected", "none"],
      ["EV2 (simulated)", "connected", "none"],
      ["EV3 (simulated)", "connected", "none"],
    ]);
    expect(cards[1].data.summary).toBe("Unable to Assess (no valid data)");
    await tick(1500);
    const id = caseOf("ev1");
    expect(at(flow(id))).toBe("v1:quality:running:System");
    cards = crewCards(st(), { mock: true });
    expect(cards[0]).toMatchObject({ unread: 1, openCases: 1, event: { text: "Device observation received, being checked", source: "Device observation" } });
    expect(cards[1]).toMatchObject({ unread: 0, openCases: 0, event: null });
    expect(notifications(st(), { mock: true }).map((n) => [n.astronautId, n.text, n.count])).toEqual([["ev1", "Device observation received, being checked", 1]]);
    await tick(ANALYSIS);

    // Stops for the base staff; auto feedback never approves, however long we wait.
    expect(at(flow(id))).toBe("v1:pending-0:human:Base staff");
    expect(crewCards(st(), { mock: true })[0].event).toMatchObject({ text: "Awaiting Base Review", needsBase: true });
    await tick(60_000);
    expect(at(flow(id))).toBe("v1:pending-0:human:Base staff");
    expect(st().outbox.filter((m) => m.type === "station.notice.approved")).toHaveLength(0);

    // Viewing marks the case as seen (unread 0) but changes nothing else.
    const before = st().cases[id].phase;
    ctl.view(id);
    expect(crewCards(st(), { mock: true })[0].unread).toBe(0);
    expect(st().cases[id].phase).toBe(before);
    expect(st().outbox.filter((m) => !m.type.startsWith("station.audit."))).toHaveLength(0);

    ctl.review(id, 1, "approve", "Several indicators deviate in the same direction; retest with the standard protocol to confirm", "Base duty officer");
    await tick(0);
    let f = flow(id);
    expect(at(f)).toBe("v1:hud:waiting:HUD");
    expect(f.current!.node.since).toBeTruthy();
    await tick(1500);
    expect(at(flow(id))).toBe("v1:hud:waiting:HUD"); // nothing inferred from time
    await tick(200);
    expect(at(flow(id))).toBe("v1:crew:waiting:Crew");
    await tick(2300);
    expect(at(flow(id))).toBe("v1:result:waiting:Crew");
    await tick(3100 + ANALYSIS);
    f = flow(id);
    expect(f.rows.map((r) => r.id)).toEqual(["v1:analysis", "v1:dispatch", "v2:analysis", "v2:handling"]);
    expect(f.current!.node).toMatchObject({ label: "Awaiting base decision", state: "human" });
    expect(f.current!.node.indicators.map((i) => [i.before?.value, i.after.value])).toEqual([
      [80, 89],
      [44, 39.5],
      [142, 156],
    ]);
    expect(crewCards(st(), { mock: true })[0].event?.text).toBe("Retest returned, awaiting base decision");

    ctl.review(id, 2, "close", "Retest back within the reference range; closed after the duty assessment", "Base duty officer");
    await tick(0);
    f = flow(id);
    expect(f.finished).toBe(true);
    expect(f.noticePending).toBe("Status notice sent; awaiting the HUD receipt");
    await tick(1700);
    expect(flow(id).noticePending).toBeNull();
    expect(crewCards(st(), { mock: true })[0]).toMatchObject({ openCases: 0, event: { text: "Handled (Case Closed)", closed: true } });

    // The message stream keeps kinds apart and never shows analysis as sent.
    const kinds = commStream(st(), st().cases[id], { mock: true }).map((i) => i.kind);
    expect(kinds).toContain("action");
    expect(kinds).toContain("status");
    expect(kinds).toContain("feedback");
    expect(kinds).toContain("receipt");
    expect(commStream(st(), st().cases[id], { mock: true }).filter((i) => i.kind === "analysis").every((i) => !/(?<!not )\bsent\b/i.test(i.text))).toBe(true);
  });

  it("without auto feedback the flow waits; manual simulated inputs only apply to what was sent", async () => {
    const { ctl, director, st, caseOf, flow, at } = setup(false);
    director.launch("ev1", "change");
    await tick(1500 + ANALYSIS);
    const id = caseOf("ev1");
    expect(hudInput(st(), id, "received", Date.now())).toBeNull(); // nothing sent yet: no receipt to fake
    expect(director.hud(id, "ack")).toBe(false);
    ctl.review(id, 1, "approve", "Retest", "Base duty officer");
    await tick(120_000);
    expect(at(flow(id))).toBe("v1:hud:waiting:HUD");
    expect(director.getSnapshot().pending).toBeNull();
    expect(director.hud(id, "received")).toBe(true);
    expect(director.hud(id, "received")).toBe(false); // already received: nothing to repeat
    expect(at(flow(id))).toBe("v1:crew:waiting:Crew");
  });

  it("another astronaut's event stays with that astronaut (no cross-person data)", async () => {
    const { director, st, caseOf } = setup(false);
    director.launch("ev1", "change");
    director.launch("ev2", "normal");
    await tick(1500);
    await tick(1500 + ANALYSIS);
    const a = st().cases[caseOf("ev1")];
    const b = st().cases[caseOf("ev2")];
    expect(a.astronautId).toBe("ev1");
    expect(b.astronautId).toBe("ev2");
    expect(b.evaluations[0].observation!.features).toEqual({ medianFreqHz: 86, rmsPctMvc: 37, gripForceN: 170 }); // EV2's own values
    expect(b.evaluations[0].result.outcome).toBe("within-baseline");
    const cards = crewCards(st(), { mock: true });
    expect(cards[1]).toMatchObject({ openCases: 1, data: { validity: "valid", summary: "Latest measurement Within Reference Range" } });
    expect(cards[0].cases.map((c) => c.caseId)).toEqual([a.caseId]);
    expect(cards[2]).toMatchObject({ openCases: 0, unread: 0 });
  });

  it("pause holds scripted inputs; step sends one; reset cancels every pending task", async () => {
    const { ctl, director, st } = setup(true);
    director.setPaused(true);
    director.launch("ev1", "change");
    await tick(10_000);
    expect(st().caseOrder).toHaveLength(0);
    expect(director.getSnapshot()).toMatchObject({ paused: true, pending: { dueAt: null }, queued: 1 });
    director.stepNow();
    expect(st().caseOrder).toHaveLength(1);
    director.setPaused(false);
    await tick(1500);
    expect(ctl.pendingTimers).toBe(1);
    director.reset();
    expect(ctl.pendingTimers).toBe(0);
    expect(director.hasTimer).toBe(false);
    expect(st().run).toBeNull();
    await tick(60_000);
    expect(st().caseOrder).toHaveLength(0);
  });

  it("a device disconnect is a device status (not a pause) and is shown separately from data", async () => {
    const { director, st } = setup(false);
    director.launch("ev3", "normal");
    await tick(1500 + ANALYSIS);
    director.toggleDevice("ev3");
    const card = crewCards(st(), { mock: true })[2];
    expect(card.connection.state).toBe("disconnected");
    expect(card.data.validity).toBe("valid"); // the last data stays what it was
    expect(director.getSnapshot().paused).toBe(false);
  });

  it("only drives its own demo runs", () => {
    const { st, adapter } = setup(true);
    adapter.inject(inboundEnvelope("scenario.start", { runId: "dev-run", payload: DEMO_START, eventId: "s" }));
    expect(nextAutoStep(st(), Date.now())).toBeNull();
  });
});

describe("HUD report entry (local mock extension)", () => {
  it("is checked, never a diagnosis, and not discarded without sensor data", async () => {
    const { director, st, caseOf, flow } = setup(false);
    director.launch("ev2", "report");
    await tick(1500 + ANALYSIS);
    const id = caseOf("ev2");
    const f = flow(id);
    expect(f.rows[0].nodes.map((n) => [n.label, n.state])).toEqual([
      ["Report Received", "done"],
      ["Report check", "done"],
      ["Sensor data", "stopped"],
      ["Comparison", "skipped"],
      ["Recommendation", "done"],
    ]);
    expect(f.rows[0].nodes[2].reason).toMatch(/no sEMG analysis/);
    expect(f.current!.node).toMatchObject({ label: "Awaiting Base Review", state: "human" });
    expect(crewCards(st(), { mock: true })[1].event).toMatchObject({ source: "HUD report", text: "Awaiting Base Review" });
    expect(commStream(st(), st().cases[id], { mock: true })[0]).toMatchObject({ kind: "report", title: "Astronaut report" });
    expect(st().outbox.filter((m) => m.type === "station.audit.assessment")).toHaveLength(0); // no contract form for a report check
  });
});

describe("flow view stops where the business state stops", () => {
  async function analysed(fx: keyof typeof FIXTURES) {
    const t = setup(false);
    t.adapter.inject(inboundEnvelope("scenario.start", { runId: "run-x", payload: DEMO_START, eventId: "start-x" }));
    t.adapter.inject(inboundEnvelope("observation.submitted", { runId: "run-x", caseId: FIXTURES[fx].caseId, payload: FIXTURES[fx].observation, eventId: `obs-${fx}` }));
    await tick(ANALYSIS);
    return t;
  }

  it("quality failure: stops at Signal Quality with the reason; later steps are not executed", async () => {
    const { flow } = await analysed("acquisition");
    const f = flow(FIXTURES.acquisition.caseId);
    expect(f.rows[0].nodes.map((n) => n.state)).toEqual(["done", "stopped", "skipped", "skipped", "skipped"]);
    expect(f.rows[0].nodes[1].reason).toMatch(/Signal quality failed/);
    expect(f.current!.node.reason).toMatch(/Signal quality failed.*Base staff review the candidate/);
  });

  it("not comparable: stops at Comparability", async () => {
    const { flow } = await analysed("not-comparable");
    const f = flow(FIXTURES["not-comparable"].caseId);
    expect(f.rows[0].nodes.map((n) => n.state)).toEqual(["done", "done", "stopped", "skipped", "skipped"]);
    expect(f.rows[0].nodes[2].summary).toMatch(/^Not comparable/);
  });

  it("send failure stops at Retest sent with a resend action; a deferral stops at Acknowledged by Crew with the reason", async () => {
    const { ctl, adapter, flow, at } = await analysed("change");
    adapter.failNextSends(1);
    ctl.review("case-change", 1, "approve", "Retest (test)", "Base duty officer");
    await tick(0);
    let f = flow("case-change");
    expect(at(f)).toBe("v1:send:stopped:Base staff");
    expect(f.current!.node.action).toMatchObject({ kind: "resend" });
    ctl.resend((f.current!.node.action as { eventIds: string[] }).eventIds[0]);
    await tick(0);
    expect(at(flow("case-change"))).toBe("v1:hud:waiting:HUD");
    const msg = ctl.getSnapshot().state.outbox.find((m) => m.type === "station.retest.requested")!;
    adapter.inject(inboundEnvelope("hud.defer", { runId: "run-x", caseId: "case-change", payload: { messageId: msg.eventId, reason: "Busy with the task" }, eventId: "defer-1" }));
    f = flow("case-change");
    const crew = f.rows[1].nodes.find((n) => n.label === "Acknowledged by Crew")!;
    expect(crew).toMatchObject({ state: "stopped", owner: "Base staff" });
    expect(crew.reason).toMatch(/Deferred by the crew: Busy with the task/);
    expect(f.rows[1].nodes.find((n) => n.label === "Awaiting retest result")!.state).toBe("todo");
  });

  it("Continue Monitoring is not the end: the case stays open with a pending human node", async () => {
    const { ctl, flow } = await analysed("normal");
    ctl.review("case-normal", 1, "keep-open", "Continue Monitoring (test)", "Base duty officer");
    await tick(0);
    const f = flow("case-normal");
    expect(f.finished).toBe(false);
    expect(f.current!.node).toMatchObject({ label: "Continue Monitoring", state: "human" });
    expect(f.current!.node.action).toMatchObject({ options: ["close"], primary: "close" });
    expect(f.rows.find((r) => r.id === "v1:handling")!.nodes.at(-1)).toMatchObject({ label: "Handling complete", state: "todo" });
  });
});
