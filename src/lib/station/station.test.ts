import { describe, expect, it } from "vitest";
import { analyse } from "./analysis";
import { inboundEnvelope } from "./adapter";
import { DEMO_BASELINES, DEMO_START, FIXTURES, RETEST_FIXTURES } from "./fixtures";
import { allowedDecisions, initialState, latest, messageKind, statusNoticeText, step, stagesToReveal, workbenchStage, type Action, type Effect, type StationState } from "./station";
import { alertNote, caseStatus, comparisonView, evaluationStatus, flowSteps, summaryHeadline } from "./views";

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
const review = (caseId: string, version: number, decision: Action & { type: "review" } extends infer R ? (R extends { decision: infer D } ? D : never) : never, reason = "Evidence checked"): Action => ({ type: "review", caseId, version, decision, reason, reviewer: "Base duty officer A", at: T });

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
    expect(r.conclusion).toMatch(/nothing is inferred about the muscle/);
  });
  it("not comparable: stops at comparability, no decline claim", () => {
    const r = analyse(FIXTURES["not-comparable"].observation, b);
    expect(r.outcome).toBe("not-comparable");
    expect(r.stages.map((s) => s.status)).toEqual(["done", "blocked", "skipped", "skipped"]);
    expect(r.comparisons).toHaveLength(0);
    expect(r.conclusion).toMatch(/no conclusion about muscle function can be drawn/);
    expect(r.headline).not.toMatch(/declin|decreas|drop/i);
  });
  it("comparable change: several features beyond baseline → notice + retest candidate (not a diagnosis)", () => {
    const r = analyse(FIXTURES.change.observation, b);
    expect(r.outcome).toBe("change-beyond-baseline");
    expect(r.comparisons.filter((c) => c.flagged).length).toBeGreaterThanOrEqual(2);
    expect(r.candidate?.kind).toBe("notice-and-retest");
    expect(r.conclusion).toMatch(/not a diagnosis/);
  });
  it("missing grip-meter reading: result incomplete by protocol, nothing invented, nothing compared", () => {
    const o = { ...FIXTURES.change.observation, features: { ...FIXTURES.change.observation.features!, gripForceN: null } };
    const r = analyse(o, b);
    expect(r.outcome).toBe("result-incomplete");
    expect(r.stages.map((s) => s.status)).toEqual(["done", "done", "blocked", "skipped"]);
    expect(r.comparisons).toHaveLength(0);
    expect(r.headline).toBe("Incomplete Results: missing grip force");
    const ev = r.stages[2].evidence;
    expect(ev.find((e) => e.label === "Grip force")).toMatchObject({ value: "missing (not provided)", ok: false });
    expect(ev.find((e) => e.label === "sEMG median frequency")?.value).toBe("80 Hz");
    expect(JSON.stringify(r)).not.toMatch(/grip force[^"]*\b0 N/i);
    expect(r.stages[2].summary).toMatch(/not invented or set to zero/);
    expect(r.candidate?.kind).toBe("retest");
    expect(evaluationStatus({ version: 2, trigger: "retest", completedAt: "x", result: r } as never).label).toMatch(/Incomplete Results/);
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
    expect(state.timeline.some((t) => t.kind === "ignored" && /Duplicate event/.test(t.text))).toBe(true);
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
    expect(step(state, review("case-change", 1, "approve")).error).toMatch(/not allowed/);
    state = finish(state, "case-change");
    expect(step(state, review("case-change", 1, "approve", " ")).error).toMatch(/enter a reason/);
    expect(step(state, review("case-change", 2, "approve")).error).toMatch(/latest evaluation/);
    expect(step(state, review("case-change", 1, "close")).error).toMatch(/not allowed/);
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

  it("rejecting sends nothing; a separate 'hold' decision is not offered", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    expect(allowedDecisions(state.cases["case-change"])).toEqual(["approve", "reject"]);
    const r = step(state, review("case-change", 1, "reject"));
    expect(sends(r.effects)).toHaveLength(0);
    expect(r.state.cases["case-change"].phase).toBe("rejected");
    expect(statusNoticeText(state.cases["case-change"], "reject")).toBeNull();
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
    expect(allowedDecisions(c)).toEqual(["close", "keep-open"]);

    // The same result again (same eventId, or a new eventId for the same retest) creates no new evaluation.
    const dupSame = step(state, inbound(result));
    expect(dupSame.state.cases["case-change"].evaluations).toHaveLength(2);
    expect(sends(dupSame.effects)[0].payload).toMatchObject({ status: "duplicate" });
    const dupNew = step(state, inbound({ ...result, eventId: "res-1b" }));
    expect(dupNew.state.cases["case-change"].evaluations).toHaveLength(2);
    expect(sends(dupNew.effects)[0].payload).toMatchObject({ status: "duplicate" });

    const preview = statusNoticeText(state.cases["case-change"], "close");
    const closed = step(state, review("case-change", 2, "close", "Retest normal; closed after the duty assessment"));
    const re = sends(closed.effects);
    expect(re.map((e) => e.type)).toEqual(["station.reassessment"]);
    expect(re[0].payload).toMatchObject({ evaluationVersion: 2, reviewDecision: "close", caseStatus: "closed", summary: preview });
    expect(messageKind(re[0].type)).toBe("status");
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
    // Astronaut-facing basis: analysis evidence only; the reviewer's reason is only in reviewReason (never shown by the HUD).
    const np = notice.envelope.payload as { basis: string[]; text: string; reviewReason: string };
    expect(np.basis.some((l) => /Candidate for base review/i.test(l))).toBe(false);
    expect(np.basis.join(" ")).not.toContain(np.reviewReason);
    expect(np.text).not.toContain(np.reviewReason);
    const deferred = step(state, inbound(inboundEnvelope("hud.defer", { runId: RUN, caseId: "case-change", payload: { messageId: notice.eventId, reason: "Drilling now, later" } }))).state;
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
    expect(lateObs.state.timeline.at(-1)?.text).toMatch(/from an earlier, ended run/);
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
    expect(noRun.state.timeline.at(-1)?.text).toMatch(/no run in progress/);
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
    expect(allowedDecisions(c())).toEqual(["approve", "close", "keep-open"]);
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
    if (separate.kind === "separate") expect(separate.why).toMatch(/no change is computed/);
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
    expect(rev.payload).toMatchObject({ decision: "approve", reviewer: "Base duty officer A", caseStatus: "awaiting-hud" });
    expect((rev.payload as { dispatchedEventIds: string[] }).dispatchedEventIds).toEqual(sends(r.effects).map((e) => e.eventId));
  });

  it("close and keep-open publish a STATUS notification at any version (never an action), once per status", () => {
    // v1 normal case: closed without ever dispatching → still one status notification for the HUD.
    let n = finish(run(s0, [inbound(start()), inbound(observe("normal"))]).state, "case-normal");
    const preview = statusNoticeText(n.cases["case-normal"], "close")!;
    expect(preview).toMatch(/Case Closed by base staff/);
    const closed = step(n, review("case-normal", 1, "close"));
    expect(sends(closed.effects).map((e) => [e.type, messageKind(e.type)])).toEqual([["station.reassessment", "status"]]);
    expect(sends(closed.effects)[0].payload).toMatchObject({ evaluationVersion: 1, reviewDecision: "close", caseStatus: "closed", summary: preview, simulated: true });
    // Confirming again (double click, stale form) is refused and publishes nothing.
    const again = step(closed.state, review("case-normal", 1, "close"));
    expect(again.error).toBeTruthy();
    expect(again.effects).toHaveLength(0);

    // keep-open → monitoring status; keep-open again refused; close → a different (closed) status.
    n = finish(run(s0, [inbound(start()), inbound(observe("normal"))]).state, "case-normal");
    const kept = step(n, review("case-normal", 1, "keep-open"));
    expect(sends(kept.effects).map((e) => (e.payload as { caseStatus: string }).caseStatus)).toEqual(["monitoring"]);
    expect(kept.state.cases["case-normal"].alert.level).toBe("none");
    expect(step(kept.state, review("case-normal", 1, "keep-open")).effects).toHaveLength(0);
    const fin = step(kept.state, review("case-normal", 1, "close"));
    expect(sends(fin.effects).map((e) => (e.payload as { caseStatus: string }).caseStatus)).toEqual(["closed"]);
    const statuses = fin.state.outbox.filter((m) => messageKind(m.type) === "status").map((m) => (m.envelope.payload as { caseStatus: string }).caseStatus);
    expect(statuses).toEqual(["monitoring", "closed"]);
  });

  it("a new run with the same demo caseId publishes its own status notification (no cross-run dedup)", () => {
    let st = finish(run(s0, [inbound(start("run-a")), inbound(observe("normal", "obs-a", "run-a"))]).state, "case-normal");
    st = step(st, review("case-normal", 1, "close")).state;
    st = run(st, [inbound(start("run-b")), inbound(observe("normal", "obs-b", "run-b"))]).state;
    st = finish(st, "case-normal");
    const r = step(st, review("case-normal", 1, "close"));
    expect(sends(r.effects).map((e) => [e.type, e.runId])).toEqual([["station.reassessment", "run-b"]]);
  });

  it("closing while dispatched tells the HUD the case is closed and the pending retest is no longer needed", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    state = step(state, review("case-change", 1, "approve")).state;
    const r = step(state, review("case-change", 1, "close", "Handled separately on site (test)"));
    const out = sends(r.effects);
    expect(out.map((e) => messageKind(e.type))).toEqual(["status"]);
    expect((out[0].payload as { summary: string }).summary).toMatch(/The retest scheduled earlier is no longer needed/);
    expect(r.state.cases["case-change"].phase).toBe("closed");
    // A late retest result for the closed case is only acknowledged as rejected, not re-evaluated.
    const late = step(r.state, inbound(inboundEnvelope("retest.result", { runId: RUN, caseId: "case-change", retestId: "case-change-rt1", payload: { observation: RETEST_FIXTURES["retest-normal"].observation(1) } })));
    expect(sends(late.effects).map((e) => [e.type, (e.payload as { status?: string }).status])).toEqual([["station.receipt", "rejected"]]);
    expect(late.state.cases["case-change"].evaluations).toHaveLength(1);
  });

  it("classifies station messages: actions, status, receipts, audit", () => {
    expect(messageKind("station.notice.approved")).toBe("action");
    expect(messageKind("station.retest.requested")).toBe("action");
    expect(messageKind("station.reassessment")).toBe("status");
    expect(messageKind("station.receipt")).toBe("receipt");
    expect(messageKind("station.audit.review")).toBe("audit");
  });

  it("shows case status and the latest evaluation separately (normal retest: open alert, result in range)", () => {
    let { state } = run(s0, [inbound(start()), inbound(observe("change"))]);
    state = finish(state, "case-change");
    const c = () => state.cases["case-change"];
    expect(caseStatus(c())).toMatchObject({ label: "Alert open · Awaiting Base Review", tone: "alert", alertOpen: true });
    expect(evaluationStatus(latest(c()))).toMatchObject({ label: "Latest evaluation v1: Beyond the individual baseline variation", tone: "alert" });
    state = step(state, review("case-change", 1, "approve")).state;
    state = step(state, inbound(inboundEnvelope("retest.result", { runId: RUN, caseId: "case-change", retestId: "case-change-rt1", payload: { observation: RETEST_FIXTURES["retest-normal"].observation(1) } }))).state;
    state = finish(state, "case-change");
    expect(summaryHeadline(c())).toBe("Retest Within Reference Range · awaiting base decision");
    expect(caseStatus(c())).toMatchObject({ label: "Alert open · awaiting base decision", tone: "alert" });
    expect(evaluationStatus(latest(c()))).toMatchObject({ label: "Latest evaluation v2 (retest): Within Reference Range", tone: "ok" });
    expect(alertNote(c())).toMatch(/The original alert is still open/);
    state = step(state, review("case-change", 2, "close")).state;
    expect(caseStatus(c())).toMatchObject({ label: "Case Closed", alertOpen: false });
    expect(summaryHeadline(c())).toBe("Retest Within Reference Range · Case Closed");
    expect(alertNote(c())).toBeNull();
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

describe("mission: start and end the simulated EVA", () => {
  const s0 = initialState(DEMO_BASELINES);
  const A02 = { id: "a-02", callsign: "A-02" };
  const TASK = { id: "task-standoff-survey", title: "Survey the outcrops", targetId: "sim-target-a" };
  const startEva = (runId = "run-eva-1"): Action => ({ type: "start-eva", runId, scenarioId: "mission-glass-lefroy", astronaut: A02, task: TASK, by: "Base duty officer", at: T });
  /** The relay's echo of the station's own scenario.start (sender role station). */
  const echo = (state: StationState, seq = 1) => {
    const env = state.outbox.find((m) => m.type === "scenario.start")!.envelope;
    return inbound({ ...env, seq, receivedAt: T, sender: { role: "station", clientId: "win-A" } });
  };

  it("publishes one scenario.start; the run begins only with the relay's echo; no second start", () => {
    const a = step(s0, startEva());
    expect(a.error).toBeNull();
    expect(allSends(a.effects).map((e) => [e.type, e.source, e.eventId])).toEqual([["scenario.start", "station", "stn-run-eva-1-start"]]);
    expect(a.state.run).toBeNull();
    expect(step(a.state, startEva("run-eva-2")).error).toMatch(/waiting for the relay to confirm/);
    const b = step(a.state, echo(a.state));
    expect(b.state.run).toMatchObject({ runId: "run-eva-1", startedBy: "station", evaEndedAt: null, task: TASK, astronaut: A02 });
    expect(b.state.pendingStart).toBeNull();
    expect(b.effects).toHaveLength(0);
    expect(step(b.state, startEva("run-eva-2")).error).toMatch(/An EVA is already in progress/);
  });

  it("ending the EVA closes nothing: open events stay open and can still be handled", () => {
    let st = step(s0, startEva()).state;
    st = step(st, echo(st)).state;
    st = step(st, inbound(inboundEnvelope("observation.submitted", { runId: "run-eva-1", caseId: "c1", payload: { ...FIXTURES.change.observation, astronautId: "a-02" }, eventId: "o1" }))).state;
    st = finish(st, "c1");
    const phaseBefore = st.cases.c1.phase;
    const e = step(st, { type: "end-eva", by: "Base duty officer", at: T });
    expect(e.error).toBeNull();
    expect(allSends(e.effects).map((x) => x.type)).toEqual(["station.eva.ended"]);
    expect(e.state.run?.evaEndedAt).toBe(T);
    expect(e.state.cases.c1.phase).toBe(phaseBefore);
    expect(e.state.cases.c1.alert.level).not.toBe("none");
    expect(step(e.state, { type: "end-eva", by: "x", at: T }).error).toMatch(/already ended/);
    // still handled after the EVA ended
    const r = step(e.state, review("c1", 1, "approve"));
    expect(r.error).toBeNull();
    expect(sends(r.effects).map((x) => x.type)).toEqual(["station.notice.approved", "station.retest.requested"]);
    // a new EVA is refused while a health event of the ended one is open
    expect(step(r.state, startEva("run-eva-2")).error).toMatch(/open health event/);
  });

  it("a reload restores the EVA start and end from relay history, sending nothing", () => {
    let st = step(s0, startEva()).state;
    st = step(st, echo(st)).state;
    const ended = step(st, { type: "end-eva", by: "Base duty officer", at: T });
    const history = [
      { ...st.outbox.find((m) => m.type === "scenario.start")!.envelope, seq: 1, receivedAt: T, sender: { role: "station", clientId: "win-A" } },
      { ...ended.state.outbox.find((m) => m.type === "station.eva.ended")!.envelope, seq: 2, receivedAt: T, sender: { role: "station", clientId: "win-A" } },
    ];
    const fresh = step(s0, { type: "history", raws: history, at: T });
    expect(fresh.state.run).toMatchObject({ runId: "run-eva-1", startedBy: "station", evaEndedBy: "Base duty officer" });
    expect(fresh.state.run?.evaEndedAt).toBe(T);
    expect(fresh.effects.filter((x) => x.kind === "send")).toHaveLength(0);
  });

  it("a start or end refused by the relay (read-only window) leaves no phase change", () => {
    const a = step(s0, startEva());
    const d = step(a.state, { type: "discard", eventId: "stn-run-eva-1-start", at: T });
    expect(d.state.pendingStart).toBeNull();
    expect(d.state.run).toBeNull();
    let st = step(s0, startEva()).state;
    st = step(st, echo(st)).state;
    const e = step(st, { type: "end-eva", by: "x", at: T }).state;
    const back = step(e, { type: "discard", eventId: "stn-run-eva-1-eva-ended", at: T });
    expect(back.state.run?.evaEndedAt).toBeNull();
  });
});
