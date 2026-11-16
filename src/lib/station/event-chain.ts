// MyoMars station: the EVENT CHAIN of one health case (pure, render-neutral, tested).
//
//   Data source → Base analysis → Base review → HUD → Crew response → Retest → Reassessment
//   + closure, stated as two separate facts: "case closed" (a base decision) and "closing notice
//     delivered" (a HUD receipt). One never implies the other.
//
// The chain describes the whole case; the internal analysis steps (signal quality, comparability,
// comparison) stay in flow.ts / canvas.ts. Every state is read from the recorded case and the
// station's own outbox: nothing is inferred from elapsed time, and a step never looks further than
// the station really got. `events` lists what happened (with its own timestamp) so the UI can play
// a short, one-off animation for each NEW event; animations never drive any of this.

import { inSentence } from "./analysis";
import { allowedDecisions, caseMessages, latest, messageKind, workbenchStage, type Case, type Decision, type Evaluation, type OutMessage, type StationState } from "./station";
import type { ReassessmentPayload } from "./protocol";
import { BusName } from "./transport-words";

export const CHAIN_IDS = ["source", "analysis", "review", "hud", "crew", "retest", "reassessment"] as const;
export type ChainId = (typeof CHAIN_IDS)[number];
/**
 * todo: not reached · running: the station is processing · human: waiting for base staff ·
 * waiting: waiting for the HUD / crew / data · stopped: halted with a reason (e.g. a deferral) ·
 * failed: a send failed · done · skipped: not needed / not run.
 */
export type ChainState = "todo" | "running" | "human" | "waiting" | "stopped" | "failed" | "done" | "skipped";
export type ChainTone = "ok" | "caution" | "alert" | "neutral";

export type ChainNode = {
  id: ChainId;
  label: string;
  state: ChainState;
  tone: ChainTone;
  /** One line on the node. */
  summary: string;
  /** When the step finished (done / skipped) or failed. */
  at: string | null;
  /** When the waiting / processing started (running, human, waiting, stopped). */
  since: string | null;
  /** Whom the step waits for, inside a sentence ("base staff", "the HUD", "the crew", "the system"). */
  waitingFor: string | null;
  /** Evaluation (analysis, review, reassessment) or dispatch version this node shows. */
  round: number | null;
  /** Evidence and facts for the detail view. */
  detail: string[];
  /** Station messages of this step (communication record). */
  messages: OutMessage[];
};

export type NoticeDelivery = "none" | "sending" | "sent" | "received" | "failed";
export type Closure = {
  /** The base decision that closed the case (null: open). */
  caseClosed: { at: string; by: string; reason: string } | null;
  /** Delivery of the closing status notice, from real relay / HUD replies only. */
  notice: { state: NoticeDelivery; at: string | null; text: string | null };
};

/** Something that happened, for a one-off animation from node `from` to node `to` (indices in CHAIN_IDS). */
export type ChainEvent = { key: string; from: number; to: number; kind: "data" | "send" | "feedback"; at: string };

export type EventChain = { nodes: ChainNode[]; closure: Closure; current: ChainId | null; events: ChainEvent[] };

const LABEL: Record<ChainId, string> = { source: "Data source", analysis: "Base analysis", review: "Base review", hud: "HUD", crew: "Crew response", retest: "Retest", reassessment: "Reassessment" };
const DECIDED: Record<Decision, string> = { approve: "Approved", reject: "Candidate rejected", close: "Case Closed", "keep-open": "Continue Monitoring" };
const idx = (id: ChainId) => CHAIN_IDS.indexOf(id);
const hhmm = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(11, 16) : "–");
const latestOf = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;
const earliestOf = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;

function tone(ev: Evaluation): ChainTone {
  if (ev.completedAt === null) return "neutral";
  switch (ev.result.outcome) {
    case "within-baseline":
      return "ok";
    case "change-beyond-baseline":
      return "alert";
    default:
      return "caution";
  }
}

function node(id: ChainId, p: Partial<ChainNode> & Pick<ChainNode, "state" | "summary">): ChainNode {
  return { id, label: LABEL[id], tone: "neutral", at: null, since: null, waitingFor: null, round: null, detail: [], messages: [], ...p };
}

function analysisNode(id: "analysis" | "reassessment", ev: Evaluation): ChainNode {
  const detail = [
    ...(ev.observation ? [`Measurement: ${ev.observation.protocol.label} · data time ${hhmm(ev.observation.capturedAt)} UTC`] : []),
    ...ev.result.stages.filter((s) => ev.completedAt !== null && s.status !== "skipped").map((s) => s.summary),
  ];
  if (ev.completedAt === null)
    return node(id, { state: "running", summary: `${ev.version > 1 ? "Re-evaluating" : "Analysing"} · step ${Math.min(4, ev.revealed + 1)} of 4`, since: ev.startedAt, waitingFor: "the system", round: ev.version, detail });
  return node(id, { state: "done", tone: tone(ev), summary: ev.result.headline, at: ev.completedAt, round: ev.version, detail });
}

export function eventChain(s: StationState, c: Case, { mock }: { mock: boolean }): EventChain {
  const first = c.evaluations[0];
  const last = latest(c);
  const closed = c.phase === "closed";
  const stage = workbenchStage(c);
  const msgs = caseMessages(s, c.caseId);
  const events: ChainEvent[] = [];
  const nodes: ChainNode[] = [];
  const reviewsOf = (v: number) => c.reviews.filter((r) => r.version === v);
  const decisionPending = (v: number) => last.version === v && last.completedAt !== null && !closed && allowedDecisions(c).length > 0 && (stage === "review" || stage === "reassessed" || c.phase === "rejected");

  // ---- Data source ----
  if (first.trigger === "report" && first.report)
    nodes.push(node("source", { state: "done", summary: `Astronaut report · ${hhmm(first.startedAt)}`, at: first.startedAt, detail: [`"${first.report.text}"`, ...(first.report.request ? [`Request: ${first.report.request}`] : []), "Local simulated extension (HUD report), not a measurement"] }));
  else {
    const o = first.observation!;
    nodes.push(
      node("source", {
        state: "done",
        summary: `Simulated sample · ${hhmm(first.startedAt)}`,
        at: first.startedAt,
        detail: [`Data replay (simulated sample; not teammate data)`, `Protocol: ${o.protocol.label} (${o.protocol.id})`, `Data time ${hhmm(o.capturedAt)} UTC · ${o.signal.sampleRateHz} Hz · ${o.signal.durationS} s`, "Summary indicators only (no raw sEMG waveform)"],
      }),
    );
  }
  events.push({ key: `${c.caseId}:arrive`, from: idx("source"), to: idx("analysis"), kind: "data", at: first.startedAt });

  // ---- Base analysis (round 1) ----
  nodes.push(analysisNode("analysis", first));
  if (first.completedAt) events.push({ key: `${c.caseId}:v1:analysed`, from: idx("analysis"), to: idx("review"), kind: "data", at: first.completedAt });

  // ---- Base review (round 1) ----
  const r1 = reviewsOf(1);
  const cand = first.result.candidate;
  const reviewDetail = [...(cand ? [`Candidate: ${cand.title}`, cand.rationale] : []), ...r1.map((r) => `${hhmm(r.at)} · ${r.reviewer}: ${DECIDED[r.decision]} — ${r.reason}`)];
  const statusMsgs = msgs.filter((m) => m.type === "station.reassessment");
  if (first.completedAt === null) nodes.push(node("review", { state: "todo", summary: "Not reached" }));
  else if (decisionPending(1))
    nodes.push(node("review", { state: "human", tone: "alert", summary: c.phase === "rejected" ? "Candidate rejected · decide next step" : "Awaiting Base Review", since: r1.at(-1)?.at ?? first.completedAt, waitingFor: "base staff", round: 1, detail: reviewDetail }));
  else if (r1.length) {
    const r = r1.at(-1)!;
    nodes.push(node("review", { state: "done", tone: r.decision === "approve" ? "neutral" : r.decision === "close" ? "ok" : "neutral", summary: `${DECIDED[r.decision]} · ${r.reviewer}`, at: r.at, round: 1, detail: reviewDetail, messages: statusMsgs.filter((m) => (m.envelope.payload as ReassessmentPayload).evaluationVersion === 1) }));
  } else nodes.push(node("review", { state: "todo", summary: "Not reached" }));

  // ---- Dispatch of the latest approval: HUD → Crew response → Retest ----
  const approve = c.reviews.filter((r) => r.decision === "approve").at(-1) ?? null;
  const dv = approve?.version ?? null;
  const acts = dv === null ? [] : msgs.filter((m) => messageKind(m.type) === "action" && (m.envelope.payload as { evaluationVersion?: number }).evaluationVersion === dv);
  const rt = dv === null ? null : (c.retests.find((r) => r.requestedFromVersion === dv) ?? null);
  const noDispatch = dv === null && (closed || c.reviews.length > 0);
  const titleOf = (m: OutMessage) => (m.type === "station.notice.approved" ? "Notice" : "Retest task");
  const textOf = (m: OutMessage) => {
    const p = m.envelope.payload as { text?: string; instructions?: string };
    return p.text ?? p.instructions ?? "";
  };

  // HUD
  if (dv === null) {
    const statusNote = statusMsgs.length ? (statusMsgs.some((m) => m.hudReceivedAt) ? " · status notice received" : " · status notice sent") : "";
    nodes.push(node("hud", noDispatch ? { state: "skipped", summary: `No task sent${statusNote}`, messages: statusMsgs } : { state: "todo", summary: "Not reached" }));
  } else {
    const failed = acts.filter((m) => m.delivery === "failed");
    const sentAt = earliestOf(acts.map((m) => m.adapterAt));
    const received = acts.filter((m) => m.hudReceivedAt);
    const detail = acts.map((m) => `${titleOf(m)}: ${textOf(m)}`);
    const base = { round: dv, detail, messages: acts };
    if (failed.length) nodes.push(node("hud", { ...base, state: "failed", tone: "caution", summary: `Send failed · ${failed[0].deliveryNote ?? "unknown reason"}`, at: approve!.at, waitingFor: "base staff" }));
    else if (acts.some((m) => m.delivery === "queued") || !acts.length) nodes.push(node("hud", { ...base, state: "running", summary: "Sending…", since: approve!.at, waitingFor: "the relay" }));
    else if (received.length === acts.length) {
      nodes.push(node("hud", { ...base, state: "done", summary: `Received by HUD · ${hhmm(latestOf(received.map((m) => m.hudReceivedAt)))}`, at: latestOf(received.map((m) => m.hudReceivedAt)) }));
    } else if (closed) nodes.push(node("hud", { ...base, state: "skipped", summary: "No receipt (case closed)" }));
    else nodes.push(node("hud", { ...base, state: "waiting", summary: `${mock ? "Sent (local simulation)" : `${BusName()} accepted`} · awaiting receipt`, since: sentAt, waitingFor: "the HUD" }));
    if (sentAt && !failed.length) events.push({ key: `${c.caseId}:d${dv}:sent`, from: idx("review"), to: idx("hud"), kind: "send", at: sentAt });
    if (received.length === acts.length && acts.length) events.push({ key: `${c.caseId}:d${dv}:received`, from: idx("hud"), to: idx("review"), kind: "feedback", at: latestOf(received.map((m) => m.hudReceivedAt))! });
  }

  // Crew response
  let crewDone = false;
  if (dv === null) nodes.push(node("crew", noDispatch ? { state: "skipped", summary: "Not needed" } : { state: "todo", summary: "Not reached" }));
  else {
    const acked = acts.filter((m) => m.feedback === "acknowledged");
    const deferred = acts.filter((m) => m.feedback === "deferred");
    const detail = acts.map((m) => `${titleOf(m)}: ${{ none: "no reply yet", acknowledged: `acknowledged ${hhmm(m.feedbackAt)}`, deferred: `deferred ${hhmm(m.feedbackAt)}${m.feedbackNote ? ` · ${m.feedbackNote}` : ""}` }[m.feedback]}`);
    const base = { round: dv, detail, messages: acts };
    if (acts.length && acked.length === acts.length) {
      crewDone = true;
      const at = latestOf(acked.map((m) => m.feedbackAt));
      nodes.push(node("crew", { ...base, state: "done", summary: `Acknowledged by Crew · ${hhmm(at)}`, at }));
      events.push({ key: `${c.caseId}:d${dv}:acknowledged`, from: idx("crew"), to: idx("hud"), kind: "feedback", at: at! });
    } else if (closed) nodes.push(node("crew", { ...base, state: "skipped", summary: "Not needed (case closed)" }));
    else if (deferred.length) {
      const d = deferred.at(-1)!;
      nodes.push(node("crew", { ...base, state: "stopped", tone: "caution", summary: `Deferred${d.feedbackNote ? ` · ${d.feedbackNote}` : ""}`, since: d.feedbackAt, waitingFor: "the crew (or a base decision)" }));
      events.push({ key: `${c.caseId}:d${dv}:deferred:${d.feedbackAt}`, from: idx("crew"), to: idx("hud"), kind: "feedback", at: d.feedbackAt! });
    } else if (acts.some((m) => m.hudReceivedAt)) nodes.push(node("crew", { ...base, state: "waiting", summary: "Awaiting acknowledgement", since: latestOf(acts.map((m) => m.hudReceivedAt)), waitingFor: "the crew" }));
    else nodes.push(node("crew", { ...base, state: "todo", summary: "Not reached" }));
  }

  // Retest
  if (dv === null) nodes.push(node("retest", noDispatch ? { state: "skipped", summary: "Not needed" } : { state: "todo", summary: "Not reached" }));
  else if (!rt) nodes.push(node("retest", closed ? { state: "skipped", summary: "Not needed" } : { state: "todo", summary: "Not reached", round: dv }));
  else {
    const resultEv = rt.resultVersion !== null ? (c.evaluations.find((e) => e.version === rt.resultVersion) ?? null) : null;
    const detail = [`Retest task: ${acts.find((m) => m.type === "station.retest.requested") ? textOf(acts.find((m) => m.type === "station.retest.requested")!) : "standard protocol"}`, ...(rt.completedAt ? [`Crew reported the retest done at ${hhmm(rt.completedAt)}`] : []), ...(resultEv?.observation ? [`Result data time ${hhmm(resultEv.observation.capturedAt)} UTC (simulated sample)`] : [])];
    if (rt.status === "result-received" && resultEv) {
      nodes.push(node("retest", { state: "done", summary: `Result received · ${hhmm(resultEv.startedAt)}`, at: resultEv.startedAt, round: dv, detail }));
      events.push({ key: `${c.caseId}:d${dv}:result`, from: idx("retest"), to: idx("reassessment"), kind: "data", at: resultEv.startedAt });
    } else if (closed) nodes.push(node("retest", { state: "skipped", summary: "Not needed (case closed)", round: dv, detail }));
    else if (rt.status === "completed") nodes.push(node("retest", { state: "waiting", summary: "Crew reports done · awaiting data", since: rt.completedAt, waitingFor: "the HUD", round: dv, detail }));
    else if (crewDone) nodes.push(node("retest", { state: "waiting", summary: "Awaiting the retest result", since: latestOf(acts.map((m) => m.feedbackAt)), waitingFor: "the crew", round: dv, detail }));
    else nodes.push(node("retest", { state: "todo", summary: "Not reached", round: dv, detail }));
  }

  // ---- Reassessment (latest evaluation after a retest) ----
  const rv = last.version > 1 ? last : null;
  if (!rv) nodes.push(node("reassessment", dv === null && noDispatch ? { state: "skipped", summary: "Not needed" } : closed ? { state: "skipped", summary: "Not needed (case closed)" } : { state: "todo", summary: "Not reached" }));
  else {
    const n = analysisNode("reassessment", rv);
    const rr = reviewsOf(rv.version).at(-1);
    if (rv.completedAt !== null) {
      n.detail.unshift(`Round 1 result (kept): ${first.result.headline}`);
      if (decisionPending(rv.version)) Object.assign(n, { state: "human", since: rv.completedAt, waitingFor: "base staff", summary: `${rv.result.headline} · awaiting decision` });
      else if (rr) {
        Object.assign(n, { summary: `${DECIDED[rr.decision]} · ${inSentence(rv.result.headline)}`, at: rr.at });
        n.detail.push(`${hhmm(rr.at)} · ${rr.reviewer}: ${DECIDED[rr.decision]} — ${rr.reason}`);
        n.messages = statusMsgs.filter((m) => (m.envelope.payload as ReassessmentPayload).evaluationVersion === rv.version);
      }
    }
    nodes.push(n);
  }

  // ---- Closure: case closed (base decision) ≠ closing notice delivered (HUD receipt) ----
  const closeReview = c.reviews.filter((r) => r.decision === "close").at(-1) ?? null;
  const closeMsg = statusMsgs.filter((m) => (m.envelope.payload as ReassessmentPayload).caseStatus === "closed").at(-1) ?? null;
  const noticeState: NoticeDelivery = !closeMsg ? "none" : closeMsg.delivery === "failed" ? "failed" : closeMsg.delivery === "queued" ? "sending" : closeMsg.hudReceivedAt ? "received" : "sent";
  const closure: Closure = {
    caseClosed: closed && closeReview ? { at: closeReview.at, by: closeReview.reviewer, reason: closeReview.reason } : null,
    notice: { state: noticeState, at: closeMsg ? (closeMsg.hudReceivedAt ?? closeMsg.adapterAt) : null, text: closeMsg ? ((closeMsg.envelope.payload as ReassessmentPayload).summary ?? null) : null },
  };
  if (closeMsg?.adapterAt && closeMsg.delivery === "sent") events.push({ key: `${c.caseId}:close-notice:sent`, from: idx("reassessment"), to: idx("hud"), kind: "send", at: closeMsg.adapterAt });
  if (closeMsg?.hudReceivedAt) events.push({ key: `${c.caseId}:close-notice:received`, from: idx("hud"), to: idx("reassessment"), kind: "feedback", at: closeMsg.hudReceivedAt });

  const open = nodes.find((n) => n.state === "running" || n.state === "human" || n.state === "waiting" || n.state === "stopped" || n.state === "failed");
  return { nodes, closure, current: open?.id ?? null, events };
}
