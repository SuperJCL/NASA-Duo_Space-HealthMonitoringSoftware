import { describe, expect, it } from "vitest";
import { analyse } from "./analysis";
import { inboundEnvelope } from "./adapter";
import { DEMO_BASELINES, DEMO_START, FIXTURES, RETEST_FIXTURES } from "./fixtures";
import { allowedDecisions, initialState, latest, step, stagesToReveal, workbenchStage, type Action, type Effect, type StationState } from "./station";
import { comparisonView, flowSteps } from "./views";

const T = "2026-11-14T10:00:00Z";
const RUN = "run-1";

/** Apply actions in order; returns the final state and every effect produced. */
function run(state: StationState, actions: Action[]) {
  const effects: Effect[] = [];
  const errors: (string | null)[] = [];
  for (const a of actions) {
    const r = step(state, a);
    state = r.state;
    effects.push(...r.effects);
    errors.push(r.error);
  }
  return { state, effects, errors };
}
const inbound = (raw: unknown): Action => ({ type: "inbound", raw, at: T });
const start = (runId = RUN) => inboundEnvelope("scenario.start", { runId, payload: DEMO_START, eventId: `start-${runId}` });
const observe = (fx: keyof typeof FIXTURES, eventId = `obs-${fx}`, runId = RUN) => inboundEnvelope("observation.submitted", { runId, caseId: FIXTURES[fx].caseId, payload: FIXTURES[fx].observation, eventId });
/** Tick the latest evaluation of a case to completion. */
function finishEffects(state: StationState, caseId: string) {
  const ev = latest(state.cases[caseId]);
  const acts: Action[] = [];
  for (let i = 0; i < stagesToReveal(ev.result); i++) acts.push({ type: "stage-tick", runId: state.run!.runId, caseId, version: ev.version, at: T });
  return run(state, acts).effects;
}
const hudOutbox = (s: StationState) => s.outbox.filter((m) => !m.type.startsWith("station.audit."));
function finish(state: StationState, caseId: string) {
  const ev = latest(state.cases[caseId]);
  const acts: Action[] = [];
  for (let i = 0; i < stagesToReveal(ev.result); i++) acts.push({ type: "stage-tick", runId: state.run!.runId, caseId, version: ev.version, at: T });
  return run(state, acts).state;
}
/** Messages for the HUD / Trigger (audit records excluded; they are traceability only). */
const sends = (effects: Effect[]) => allSends(effects).filter((e) => !e.type.startsWith("station.audit."));
const allSends = (effects: Effect[]) => effects.filter((e): e is Extract<Effect, { kind: "send" }> => e.kind === "send").map((e) => e.envelope);
const review = (caseId: string, version: number, decision: Action & { type: "review" } extends infer R ? (R extends { decision: infer D } ? D : never) : never, reason = "已核对证据"): Action => ({ type: "review", caseId, version, decision, reason, reviewer: "基地值班员 A", at: T });

describe("simulated analysis (deterministic, demo rules)", () => {
  const b = DEMO_BASELINES[0];
  it("gives the same result for the same input", () => {
    expect(analyse(FIXTURES.change.observation, b)).toEqual(analyse(FIXTURES.change.observation, b));
  });
  it("normal: within the individual baseline, record-only candidate", () => {
    const r = analyse(FIXTURES.normal.observation, b);
    expect(r.outcome).toBe("within-baseline");
    expect(r.candidate?.kind).toBe("record-only");
    expect(r.stages.map((s) => s.status)).toEqual(["done", "done", "done", "done"]);
  });
  it("acquisition anomaly: stops at the quality check, no physiological inference", () => {
    const r = analyse(FIXTURES.acquisition.observation, b);
    expect(r.outcome).toBe("quality-blocked");
    expect(r.stages.map((s) => s.status)).toEqual(["blocked", "skipped", "skipped", "skipped"]);
    expect(r.comparisons).toHaveLength(0);
    expect(r.conclusion).toMatch(/不对肌肉状态作任何推断/);
  });
  it("not comparable: stops at comparability, no decline claim", () => {
    const r = analyse(FIXTURES["not-comparable"].observation, b);
    expect(r.outcome).toBe("not-comparable");
    expect(r.stages.map((s) => s.status)).toEqual(["done", "blocked", "skipped", "skipped"]);
    expect(r.comparisons).toHaveLength(0);
    expect(r.conclusion).toMatch(/不能据此得出肌肉功能下降的结论/);
    expect(r.headline).not.toMatch(/下降/);
  });
  it("comparable change: several features beyond baseline → notice + retest candidate (not a diagnosis)", () => {
    const r = analyse(FIXTURES.change.observation, b);
    expect(r.outcome).toBe("change-beyond-baseline");
    expect(r.comparisons.filter((c) => c.flagged).length).toBeGreaterThanOrEqual(2);
    expect(r.candidate?.kind).toBe("notice-and-retest");
    expect(r.conclusion).toMatch(/不是诊断/);
  });
  it("missing features: analysis fails", () => {
    const r = analyse({ ...FIXTURES.normal.observation, features: null }, b);
    expect(r.outcome).toBe("analysis-failed");
    expect(r.stages[2].status).toBe("failed");
  });
});

describe("station state machine", () => {
  const s0 = initialState(DEMO_BASELINES);

  it("ignores a duplicate observation (same eventId): one case, one evaluation, one analysis", () => {
    const { state, effects } = run(s0, [inbound(start()), inbound(observe("change")), inbound(observe("change"))]);
    expect(state.cases["case-change"].evaluations).toHaveLength(1);
    expect(effects.filter((e) => e.kind === "schedule-tick")).toHaveLength(1);
    expect(state.timeline.some((t) => t.kind === "ignored" && /重复事件/.test(t.text))).toBe(true);
  });

  it("analysis ends in a pending candidate: nothing is sent to the HUD before a human approves", () => {
    const first = run(s0, [inbound(start()), inbound(observe("change"))]);
    const effects = first.effects;
    const state = finish(first.state, "case-change");
    expect(state.cases["case-change"].phase).toBe("awaiting-review");
    expect(state.cases["case-change"].alert.level).toBe("alert");
    expect(sends(effects)).toHaveLength(0);
    expect(state.outbox.filter((m) => !m.type.startsWith("station.audit."))).toHaveLength(0);
    // Only the audit record of the completed assessment was produced.
    expect(allSends(finishEffects(first.state, "case-change")).map((e) => e.type)).toEqual(["station.audit.assessment"]);
  });

  it("review needs the latest version, a reason and an allowed decision", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    // Not allowed while analysing.
    expect(step(state, review("case-change", 1, "approve")).error).toMatch(/不允许/);
    state = finish(state, "case-change");
    expect(step(state, review("case-change", 1, "approve", " ")).error).toMatch(/理由/);
    expect(step(state, review("case-change", 2, "approve")).error).toMatch(/最新版本/);
    expect(step(state, review("case-change", 1, "close")).error).toMatch(/不允许/);
  });

  it("approval publishes the notice and a retest task once; a second approval is refused", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    const r1 = step(state, review("case-change", 1, "approve"));
    const out = sends(r1.effects);
    expect(out.map((e) => e.type)).toEqual(["station.notice.approved", "station.retest.requested"]);
    expect(out[1].retestId).toBe("case-change-rt1");
    expect(out.every((e) => e.caseId === "case-change" && e.runId === RUN && e.source === "station")).toBe(true);
    expect(r1.state.cases["case-change"].phase).toBe("awaiting-hud");
    const r2 = step(r1.state, review("case-change", 1, "approve"));
    expect(r2.error).toBeTruthy();
    expect(r2.effects).toHaveLength(0);
  });

  it("rejecting or holding sends nothing", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    for (const d of ["reject", "hold"] as const) {
      const r = step(state, review("case-change", 1, d));
      expect(sends(r.effects)).toHaveLength(0);
      expect(r.state.cases["case-change"].phase).toBe(d === "reject" ? "rejected" : "on-hold");
    }
  });

  it("closes the loop: HUD ack → retest result → receipt → v2 re-evaluation → human decision → reassessment", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    state = step(state, review("case-change", 1, "approve")).state;
    const retestMsg = state.outbox.find((m) => m.type === "station.retest.requested")!;
    state = step(state, inbound(inboundEnvelope("hud.ack", { runId: RUN, caseId: "case-change", payload: { messageId: retestMsg.eventId }, eventId: "ack-1" }))).state;
    expect(state.cases["case-change"].phase).toBe("awaiting-retest");
    expect(state.cases["case-change"].retests[0].status).toBe("acknowledged");

    const result = inboundEnvelope("retest.result", { runId: RUN, caseId: "case-change", retestId: "case-change-rt1", payload: { observation: RETEST_FIXTURES["retest-normal"].observation(1) }, eventId: "res-1" });
    const r = step(state, inbound(result));
    const receipt = sends(r.effects).find((e) => e.type === "station.receipt")!;
    expect(receipt.payload).toMatchObject({ receivedEventId: "res-1", status: "accepted" });
    expect(receipt.retestId).toBe("case-change-rt1");
    state = finish(r.state, "case-change");
    const c = state.cases["case-change"];
    expect(c.evaluations).toHaveLength(2);
    expect(latest(c).trigger).toBe("retest");
    expect(latest(c).result.outcome).toBe("within-baseline");
    // A single normal retest does not close the case or lower the alert by itself.
    expect(c.phase).toBe("awaiting-review");
    expect(c.alert.level).toBe("alert");
    expect(allowedDecisions(c)).toEqual(["close", "keep-open", "hold"]);

    // The same result again (same eventId, or a new eventId for the same retest) creates no new evaluation.
    const dupSame = step(state, inbound(result));
    expect(dupSame.state.cases["case-change"].evaluations).toHaveLength(2);
    expect(sends(dupSame.effects)[0].payload).toMatchObject({ status: "duplicate" });
    const dupNew = step(state, inbound({ ...result, eventId: "res-1b" }));
    expect(dupNew.state.cases["case-change"].evaluations).toHaveLength(2);
    expect(sends(dupNew.effects)[0].payload).toMatchObject({ status: "duplicate" });

    const closed = step(state, review("case-change", 2, "close", "复测正常，结合值班评估关闭"));
    const re = sends(closed.effects);
    expect(re.map((e) => e.type)).toEqual(["station.reassessment"]);
    expect(re[0].payload).toMatchObject({ evaluationVersion: 2, reviewDecision: "close", caseStatus: "closed" });
    expect(closed.state.cases["case-change"].alert.level).toBe("none");
  });

  it("rejects a retest result for an unknown retest task, and a defer keeps the case with base staff", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    state = step(state, review("case-change", 1, "approve")).state;
    const bad = step(state, inbound(inboundEnvelope("retest.result", { runId: RUN, caseId: "case-change", retestId: "nope", payload: { observation: RETEST_FIXTURES["retest-normal"].observation(1) } })));
    expect(sends(bad.effects)[0].payload).toMatchObject({ status: "rejected" });
    expect(bad.state.cases["case-change"].evaluations).toHaveLength(1);
    const notice = state.outbox.find((m) => m.type === "station.notice.approved")!;
    const deferred = step(state, inbound(inboundEnvelope("hud.defer", { runId: RUN, caseId: "case-change", payload: { messageId: notice.eventId, reason: "正在钻取，稍后" } }))).state;
    expect(deferred.cases["case-change"].phase).toBe("deferred");
  });

  it("an invalid retest or a failed analysis never clears an existing alert", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    state = step(state, review("case-change", 1, "approve")).state;
    state = step(state, inbound(inboundEnvelope("retest.result", { runId: RUN, caseId: "case-change", retestId: "case-change-rt1", payload: { observation: RETEST_FIXTURES["retest-invalid"].observation(1) } }))).state;
    state = finish(state, "case-change");
    const c = state.cases["case-change"];
    expect(latest(c).result.outcome).toBe("quality-blocked");
    expect(c.alert.level).toBe("alert");
  });

  it("reset cancels analysis, and late ticks or events from the old run are ignored", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    const reset = step(state, inbound(inboundEnvelope("scenario.reset", { runId: RUN, payload: {}, eventId: "reset-1" })));
    expect(reset.effects).toContainEqual({ kind: "cancel-ticks" });
    state = run(reset.state, [inbound(start("run-2"))]).state;
    // A late tick from run-1 changes nothing.
    const late = step(state, { type: "stage-tick", runId: RUN, caseId: "case-change", version: 1, at: T });
    expect(late.state).toBe(state);
    // A late observation from run-1 is ignored.
    const lateObs = step(state, inbound(observe("change", "obs-late", RUN)));
    expect(lateObs.state.caseOrder).toHaveLength(0);
    expect(lateObs.state.timeline.at(-1)?.text).toMatch(/已重置的上一轮/);
    // The new run works normally.
    state = step(state, inbound(observe("normal", "obs-n2", "run-2"))).state;
    expect(state.caseOrder).toEqual(["case-normal"]);
  });

  it("a superseded evaluation's ticks are ignored", () => {
    const { state } = run(s0, [inbound(start()), inbound(observe("change")), inbound(observe("change", "obs-change-again"))]);
    expect(state.cases["case-change"].evaluations).toHaveLength(2);
    const stale = step(state, { type: "stage-tick", runId: RUN, caseId: "case-change", version: 1, at: T });
    expect(stale.state).toBe(state);
  });

  it("rejects invalid envelopes and events without an active run", () => {
    const bad = step(s0, inbound({ hello: "world" }));
    expect(bad.error).toMatch(/invalid envelope/);
    const noRun = step(s0, inbound(observe("normal")));
    expect(noRun.state.caseOrder).toHaveLength(0);
    expect(noRun.state.timeline.at(-1)?.text).toMatch(/没有进行中的场景/);
  });

  it("delivery failure is visible and can be resent with the same eventId", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    state = step(state, review("case-change", 1, "approve")).state;
    const id = hudOutbox(state)[0].eventId;
    state = step(state, { type: "delivery", eventId: id, ok: false, note: "offline", at: T }).state;
    expect(hudOutbox(state)[0].delivery).toBe("failed");
    const r = step(state, { type: "resend", eventId: id, at: T });
    expect(sends(r.effects)[0].eventId).toBe(id);
  });

  it("keeps adapter hand-off, HUD receipt and astronaut confirmation separate; nothing is filled in", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    state = step(state, review("case-change", 1, "approve")).state;
    const [notice, retest] = hudOutbox(state);
    expect([notice.delivery, notice.hudReceivedAt, notice.feedback]).toEqual(["queued", null, "none"]);
    state = step(state, { type: "delivery", eventId: notice.eventId, ok: true, note: "mock", at: T }).state;
    expect(hudOutbox(state)[0].delivery).toBe("sent");
    expect(hudOutbox(state)[0].hudReceivedAt).toBeNull();
    // An astronaut confirmation does not invent a HUD receipt.
    state = step(state, inbound(inboundEnvelope("hud.ack", { runId: RUN, caseId: "case-change", payload: { messageId: retest.eventId }, eventId: "ack-r" }))).state;
    expect(hudOutbox(state)[1].feedback).toBe("acknowledged");
    expect(hudOutbox(state)[1].hudReceivedAt).toBeNull();
    state = step(state, inbound(inboundEnvelope("hud.received", { runId: RUN, caseId: "case-change", payload: { messageId: notice.eventId }, eventId: "rcv-n" }))).state;
    expect(hudOutbox(state)[0].hudReceivedAt).toBe(T);
    expect(hudOutbox(state)[0].feedback).toBe("none");
  });

  it("maps phases to workbench stages and narrows decisions per stage", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    const c = () => state.cases["case-change"];
    expect(workbenchStage(c())).toBe("analysing");
    state = finish(state, "case-change");
    expect(workbenchStage(c())).toBe("review");
    state = step(state, review("case-change", 1, "approve")).state;
    expect(workbenchStage(c())).toBe("dispatched");
    expect(allowedDecisions(c())).toEqual(["close"]);
    state = step(state, inbound(inboundEnvelope("retest.result", { runId: RUN, caseId: "case-change", retestId: "case-change-rt1", payload: { observation: RETEST_FIXTURES["retest-changed"].observation(1) } }))).state;
    expect(workbenchStage(c())).toBe("reassessing");
    state = finish(state, "case-change");
    expect(workbenchStage(c())).toBe("reassessed");
    // Still changed at v2: a new dispatch may be approved, or the case closed / kept under watch.
    expect(allowedDecisions(c())).toEqual(["approve", "close", "keep-open", "hold"]);
    state = step(state, review("case-change", 2, "keep-open")).state;
    expect(workbenchStage(c())).toBe("decided");
    expect(allowedDecisions(c())).toEqual(["close"]);
    state = step(state, review("case-change", 2, "close")).state;
    expect(workbenchStage(c())).toBe("closed");
    expect(allowedDecisions(c())).toEqual([]);
  });

  it("puts v1 and v2 side by side only when both are comparable", () => {
    const loop = (fx: "retest-normal" | "retest-invalid") => {
      let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
      state = finish(state, "case-change");
      state = step(state, review("case-change", 1, "approve")).state;
      state = step(state, inbound(inboundEnvelope("retest.result", { runId: RUN, caseId: "case-change", retestId: "case-change-rt1", payload: { observation: RETEST_FIXTURES[fx].observation(1) } }))).state;
      return comparisonView(finish(state, "case-change").cases["case-change"]);
    };
    const paired = loop("retest-normal");
    expect(paired.kind).toBe("paired");
    const separate = loop("retest-invalid");
    expect(separate.kind).toBe("separate");
    if (separate.kind === "separate") expect(separate.why).toMatch(/不计算变化幅度/);
  });

  it("v1: retest.completed is recorded separately from the retest data", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    state = step(state, review("case-change", 1, "approve")).state;
    state = step(state, inbound(inboundEnvelope("retest.completed", { runId: RUN, caseId: "case-change", retestId: "case-change-rt1", payload: { completedAt: T }, eventId: "done-1" }))).state;
    const c = state.cases["case-change"];
    expect(c.retests[0]).toMatchObject({ status: "completed", completedAt: T, resultEventId: null });
    expect(c.phase).toBe("awaiting-retest");
    expect(c.evaluations).toHaveLength(1); // completion alone starts no re-evaluation
  });

  it("v1: relay sequence numbers — events at or below the cursor are already applied; own echoes only record the seq", () => {
    let { state } = run(s0, [inbound({ ...start(), sessionId: "local", seq: 1, receivedAt: T, sender: { role: "trigger", clientId: "t" } })]);
    expect(state.cursor).toBe(1);
    const obs = { ...observe("change"), seq: 2, receivedAt: T, sender: { role: "trigger", clientId: "t" } };
    state = step(state, inbound(obs)).state;
    const again = step(state, inbound(obs));
    expect(again.state).toBe(state); // seq ≤ cursor: no change at all
    state = finish(state, "case-change");
    state = step(state, review("case-change", 1, "approve")).state;
    const notice = hudOutbox(state)[0];
    const echo = step(state, inbound({ ...notice.envelope, seq: 9, receivedAt: T, sender: { role: "station", clientId: "s" } }));
    expect(echo.state.outbox.find((m) => m.eventId === notice.eventId)!.relaySeq).toBe(9);
    expect(echo.state.cursor).toBe(9);
    expect(echo.effects).toHaveLength(0);
  });

  it("v1: messages from another demo session are ignored", () => {
    const { state } = run(s0, [inbound(start()), inbound({ ...observe("change"), sessionId: "other" })]);
    expect(state.caseOrder).toHaveLength(0);
  });

  it("v1: audit records trace each completed assessment and each human decision (never sent as actions)", () => {
    const first = run(s0, [inbound(start()), inbound(observe("change"))]);
    const audit1 = allSends(finishEffects(first.state, "case-change"));
    expect(audit1).toHaveLength(1);
    expect(audit1[0]).toMatchObject({ type: "station.audit.assessment", caseId: "case-change", source: "station", sessionId: "local" });
    expect(audit1[0].payload).toMatchObject({ evaluationVersion: 1, outcome: "change-beyond-baseline", candidateKind: "notice-and-retest", simulated: true });
    const r = step(finish(first.state, "case-change"), review("case-change", 1, "approve"));
    const all = allSends(r.effects);
    const rev = all.find((e) => e.type === "station.audit.review")!;
    expect(rev.payload).toMatchObject({ decision: "approve", reviewer: "基地值班员 A", caseStatus: "awaiting-hud" });
    expect((rev.payload as { dispatchedEventIds: string[] }).dispatchedEventIds).toEqual(sends(r.effects).map((e) => e.eventId));
  });

  it("flow steps: waiting → analysing → review → dispatched → retest → done; unvisited steps are skipped, not done", () => {
    const states = (c: Parameters<typeof flowSteps>[0]) => flowSteps(c).map((x) => `${x.id}:${x.state}`).join(" ");
    expect(states(null)).toBe("waiting:current analysing:todo review:todo dispatched:todo retest:todo done:todo");
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    const c = () => state.cases["case-change"];
    expect(states(c())).toBe("waiting:done analysing:current review:todo dispatched:todo retest:todo done:todo");
    state = finish(state, "case-change");
    expect(states(c())).toBe("waiting:done analysing:done review:current dispatched:todo retest:todo done:todo");
    state = step(state, review("case-change", 1, "approve")).state;
    expect(states(c())).toBe("waiting:done analysing:done review:done dispatched:current retest:todo done:todo");
    state = step(state, inbound(inboundEnvelope("retest.result", { runId: RUN, caseId: "case-change", retestId: "case-change-rt1", payload: { observation: RETEST_FIXTURES["retest-normal"].observation(1) } }))).state;
    expect(states(c())).toBe("waiting:done analysing:done review:done dispatched:done retest:current done:todo");
    state = finish(state, "case-change");
    state = step(state, review("case-change", 2, "close")).state;
    expect(states(c())).toBe("waiting:done analysing:done review:done dispatched:done retest:done done:done");
    // Normal case closed at v1: no dispatch, no retest.
    let n = run(s0, [inbound(start()), inbound(observe("normal"))]).state;
    n = finish(n, "case-normal");
    n = step(n, review("case-normal", 1, "close")).state;
    expect(states(n.cases["case-normal"])).toBe("waiting:done analysing:done review:done dispatched:skipped retest:skipped done:done");
  });
});
