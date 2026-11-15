// MyoMars base station: the FLOW view of one case (pure, render-neutral, tested).
//
// It turns the recorded case state (station.ts) into rows of nodes:
//   analysis round (data received → quality → context & comparability → baseline comparison →
//   recommendation) → review and dispatch (approval → sent → HUD receipt → astronaut
//   confirmation → retest result) → next analysis round → human handling (close / keep watching),
//   with each status notification on its own "delivery" lane.
//
// Every node state comes ONLY from recorded business state: analysis progress, messages,
// receipts, feedback, decisions. Nothing is inferred from time or from an animation, so a node
// that waits for the HUD stays "waiting" until a real (or simulated, in the local demo) message
// arrives. Earlier rounds are kept; a re-evaluation adds a row and never overwrites one.

import { FEATURES, inSentence, type Evidence, type FeatureKey } from "./analysis";
import { allowedDecisions, caseMessages, isActionable, latest, messageKind, stageView, workbenchStage, type Case, type Decision, type Evaluation, type OutMessage, type Review, type StationState } from "./station";
import { alertNote, comparisonView, keyBasis } from "./views";

/**
 * done: finished · running: the station is processing · human: waiting for base staff ·
 * waiting: waiting for another party (HUD, astronaut, Trigger) · stopped: halted, with a reason ·
 * todo: not reached yet · skipped: not executed (an earlier step stopped or the case was closed).
 */
export type NodeState = "done" | "running" | "human" | "waiting" | "stopped" | "todo" | "skipped";
export type Owner = "System" | "Base staff" | "HUD" | "Crew" | "Data source" | "None";

export type IndicatorView = {
  key: FeatureKey;
  label: string;
  unit: string;
  source: string;
  mean: number;
  sd: number;
  /** Earlier measurement (only when both measurements are comparable). */
  before: { version: number; value: number; z: number; flagged: boolean } | null;
  after: { version: number; value: number; z: number; flagged: boolean };
};

export type NodeAction =
  /** Decisions offered at this node; `primary` is the main button (null: only secondary options). */
  | { kind: "decide"; options: Decision[]; primary: Decision | null }
  /** Failed messages that can be sent again with the same eventId. */
  | { kind: "resend"; eventIds: string[] };

export type FlowNode = {
  id: string;
  label: string;
  state: NodeState;
  /** Who has to act while the flow is at this node. */
  owner: Owner;
  at: string | null;
  /** One line shown on the node itself. */
  summary: string;
  input: string[];
  result: string | null;
  next: string | null;
  /** Why the flow waits or stopped here (null when it does not). */
  reason: string | null;
  evidence: Evidence[];
  indicators: IndicatorView[];
  /** Relation between the original measurement and the retest (re-evaluation only). */
  relation: string | null;
  messages: OutMessage[];
  action: NodeAction | null;
  /** When the flow reached this node (set for the open node: waiting / human / running / stopped). */
  since: string | null;
};
export type FlowRow = { id: string; title: string; lane: "main" | "notice"; nodes: FlowNode[] };
export type FlowView = {
  rows: FlowRow[];
  current: { rowId: string; node: FlowNode } | null;
  /** The three facts shown above the canvas. */
  where: string;
  why: string;
  who: Owner;
  /** The case is closed (handling finished) — independent of notification delivery. */
  finished: boolean;
  /** Status-notification delivery still pending (shown separately from `finished`). */
  noticePending: string | null;
};

export const hhmmss = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(11, 19) + " UTC" : "–");
const POSTURE = { standing: "standing", kneeling: "kneeling", seated: "seated" } as const;

function node(p: Partial<FlowNode> & Pick<FlowNode, "id" | "label" | "state" | "owner" | "summary">): FlowNode {
  return { at: null, input: [], result: null, next: null, reason: null, evidence: [], indicators: [], relation: null, messages: [], action: null, since: null, ...p };
}

function indicators(ev: Evaluation, before: Evaluation | null): IndicatorView[] {
  return ev.result.comparisons
    .filter((x) => x.current !== null && x.z !== null)
    .map((x) => {
      const b = before?.result.comparisons.find((y) => y.key === x.key);
      return {
        key: x.key,
        label: FEATURES[x.key].label,
        unit: FEATURES[x.key].unit,
        source: FEATURES[x.key].source,
        mean: x.mean,
        sd: x.sd,
        before: b && b.current !== null && b.z !== null && before ? { version: before.version, value: b.current, z: b.z, flagged: b.flagged } : null,
        after: { version: ev.version, value: x.current!, z: x.z!, flagged: x.flagged },
      };
    });
}

const STAGE_LABEL = { quality: "Signal Quality", context: "Comparability", features: "Comparison", recommendation: "Recommendation" } as const;
const REPORT_LABEL = { quality: "Report check", context: "Sensor data", features: "Comparison", recommendation: "Recommendation" } as const;
const NEXT_LABEL = { quality: "Comparability check", context: "Compare indicators with the individual baseline", features: "Prepare a candidate for base review", recommendation: "" } as const;

/** A report-check round: report received → report check → sensor data (limits) → no comparison → candidate. */
function reportRow(ev: Evaluation): FlowRow {
  const r = ev.report!;
  const stages = stageView(ev);
  const nodes: FlowNode[] = [
    node({
      id: `v${ev.version}:receive`,
      label: "Report Received",
      state: "done",
      owner: "Crew",
      at: ev.startedAt,
      summary: `Astronaut report · ${hhmmss(r.reportedAt).slice(0, 5)}`,
      input: [`Content: "${r.text}"`, `Request: ${r.request ?? "none"}`, "Source: HUD (local simulated extension, not a shared-contract message)"],
      result: "Received; the report check starts automatically (a self-report is not a diagnosis)",
      next: "Report check",
    }),
  ];
  stages.forEach((st, i) => {
    const res = ev.result.stages[i];
    const id = st.id as keyof typeof REPORT_LABEL;
    const state: NodeState = st.status === "running" ? "running" : st.status === "waiting" ? "todo" : st.status === "done" ? "done" : st.status === "skipped" ? "skipped" : "stopped";
    const shown = state === "done" || state === "stopped";
    nodes.push(
      node({
        id: `v${ev.version}:${id}`,
        label: REPORT_LABEL[id],
        state,
        owner: "System",
        at: shown ? ev.completedAt : null,
        summary: state === "running" ? "Processing…" : state === "todo" ? "Not reached" : id === "quality" ? "Self-report recorded, no diagnosis" : id === "context" ? (state === "done" ? "Recent valid measurement (reference only)" : "No valid sensor data") : id === "features" ? "Not compared: a report is not a measurement" : (ev.result.candidate?.title ?? "No candidate"),
        input: state === "todo" ? [] : res.evidence.map((e) => `${e.label}: ${e.value}`),
        result: shown ? (id === "recommendation" ? `Candidate (not published): ${ev.result.candidate?.title ?? "none"}. ${ev.result.candidate?.rationale ?? ""}` : res.summary) : state === "skipped" ? res.summary : null,
        next: shown ? (id === "recommendation" ? "Awaiting Base Review (nothing is published before approval)" : id === "quality" ? "Look at this astronaut's sensor data" : "A candidate is still prepared: a report is never ignored for lack of sensor data") : null,
        reason: state === "stopped" ? res.summary : null,
        evidence: res.evidence,
      }),
    );
  });
  return { id: `v${ev.version}:analysis`, title: `Check round ${ev.version} · astronaut report (v${ev.version})`, lane: "main", nodes };
}

/** One analysis round: data received → four simulated analysis steps. */
function analysisRow(c: Case, ev: Evaluation): FlowRow {
  if (!ev.observation) return reportRow(ev);
  const o = ev.observation;
  const p = o.protocol;
  const retest = ev.trigger === "retest";
  const nodes: FlowNode[] = [
    node({
      id: `v${ev.version}:receive`,
      label: "Data Received",
      state: "done",
      owner: "Data source",
      at: ev.startedAt,
      summary: `${retest ? "Retest data" : "Measurement"} · ${hhmmss(o.capturedAt).slice(0, 5)}`,
      input: [
        `Source: ${retest ? "retest result (simulated)" : "data replay (simulated sample)"}`,
        `Standardised simulated measurement: ${p.label} · ${POSTURE[p.posture]} · ${p.glove === "eva-glove" ? "EVA glove" : "no glove"}`,
        `Data time ${hhmmss(o.capturedAt)}${o.context.minutesIntoEva !== null ? ` · EVA minute ${o.context.minutesIntoEva}` : ""}`,
        "Content: signal-quality parameters + 3 summary indicators (no raw sEMG waveform)",
      ],
      result: retest ? "Received and acknowledged with a receipt; the second simulated analysis starts automatically" : "Received; the simulated analysis starts automatically",
      next: "Signal Quality",
    }),
  ];
  const stages = stageView(ev);
  const before = ev.version > 1 ? (c.evaluations.find((e) => e.version === (c.retests.find((r) => r.retestId === ev.retestId)?.requestedFromVersion ?? ev.version - 1)) ?? null) : null;
  stages.forEach((st, i) => {
    const r = ev.result.stages[i];
    const id = st.id as keyof typeof STAGE_LABEL;
    const state: NodeState = st.status === "running" ? "running" : st.status === "waiting" ? "todo" : st.status === "done" ? "done" : st.status === "skipped" ? "skipped" : "stopped";
    const failed = r.evidence.filter((e) => e.ok === false).map((e) => e.label);
    const input =
      id === "features"
        ? ["3 summary indicators: sEMG median frequency and sEMG RMS amplitude (sEMG), grip force (grip meter, independent reading)", "Compared with: this astronaut's individual baseline (same standard protocol)"]
        : id === "recommendation"
          ? ["Results of the previous steps", "Candidate templates of the demo rules"]
          : r.evidence.map((e) => `${e.label}: ${e.value}${e.note ? ` (${e.note})` : ""}`);
    let summary = "Not reached";
    if (state === "running") summary = "Processing…";
    else if (state === "skipped") summary = "Not run (an earlier step stopped)";
    else if (state === "done" || state === "stopped") {
      if (id === "quality") summary = state === "done" ? "Passed · 6 parameters within limits" : `Failed: ${failed.map(inSentence).join(", ")}`;
      else if (id === "context") summary = state === "done" ? "Conditions match: comparable" : `Not comparable: ${failed.map(inSentence).join(", ")} differ`;
      else if (id === "features") summary = state === "stopped" ? (ev.result.outcome === "result-incomplete" ? "Incomplete Results: not compared" : "Features missing: not compared") : ev.result.outcome === "change-beyond-baseline" ? `${ev.result.comparisons.filter((x) => x.flagged).length} indicators outside the reference range` : ev.result.outcome === "single-feature" ? "1 indicator outside the reference range" : "All Within Reference Range";
      else summary = ev.result.candidate?.title ?? "No candidate";
    }
    const actionable = isActionable(ev.result.candidate);
    nodes.push(
      node({
        id: `v${ev.version}:${id}`,
        label: STAGE_LABEL[id],
        state,
        owner: "System",
        at: state === "done" || state === "stopped" ? (ev.completedAt ?? null) : null,
        summary,
        input: state === "todo" ? [] : input,
        result: state === "done" || state === "stopped" ? (id === "recommendation" ? `Candidate (not published): ${ev.result.candidate?.title ?? "none"}. ${ev.result.candidate?.rationale ?? ""}` : r.summary) : null,
        next:
          state === "stopped"
            ? `Later steps stopped; ${ev.result.candidate ? `candidate "${ev.result.candidate.title}" prepared, Awaiting Base Review` : "awaiting base handling"}`
            : state === "done"
              ? id === "recommendation"
                ? actionable
                  ? "Awaiting Base Review (nothing is published before approval)"
                  : "Awaiting a base decision"
                : NEXT_LABEL[id]
              : null,
        reason: state === "stopped" ? r.summary : null,
        evidence: r.evidence,
        indicators: id === "features" && (state === "done" || state === "stopped") ? indicators(ev, before && comparisonView(c).kind === "paired" ? before : null) : [],
      }),
    );
  });
  return { id: `v${ev.version}:analysis`, title: `Analysis round ${ev.version} · ${retest ? "retest data" : "measurement"} (v${ev.version})`, lane: "main", nodes };
}

const DECISION_LABEL: Record<Decision, string> = { approve: "Approved by base", reject: "Candidate rejected", close: "Case Closed", "keep-open": "Continue Monitoring" };

function reviewNode(ev: Evaluation, r: Review, i: number): FlowNode {
  return node({
    id: `v${ev.version}:review-${i}`,
    label: DECISION_LABEL[r.decision],
    state: "done",
    owner: "Base staff",
    at: r.at,
    summary: `${r.reviewer} · ${hhmmss(r.at).slice(0, 5)}`,
    input: ev.result.candidate ? [`Candidate: ${ev.result.candidate.title}`, ev.result.candidate.rationale] : [],
    result: `Reason: ${r.reason}`,
    next: { approve: "Dispatch the notice and the retest task", reject: "Awaiting a base decision (close or Continue Monitoring)", close: "Handling complete: Case Closed", "keep-open": "Continue Monitoring: the case stays open" }[r.decision],
  });
}

/** The node where base staff must decide now (latest evaluation, case not closed). */
function pendingDecision(c: Case, ev: Evaluation, stopReason: string | null): FlowNode {
  const options = allowedDecisions(c);
  const stage = workbenchStage(c);
  const cand = ev.result.candidate;
  const actionable = isActionable(cand);
  const view = comparisonView(c);
  const relation = ev.version > 1 ? (view.kind === "paired" ? `The original measurement v${view.before.version} and the retest v${view.after.version} both passed quality and comparability: shown side by side; no "improvement" is computed.` : view.kind === "separate" ? view.why : null) : null;
  let label = actionable ? "Awaiting Base Review" : "Awaiting base decision";
  let reason: string;
  let next: string;
  if (c.phase === "monitoring") {
    label = "Continue Monitoring";
    reason = "Decided: Continue Monitoring. The case stays open and the alert stays; it can be closed at any time.";
    next = "Close the case (clears the alert)";
  } else if (c.phase === "rejected") {
    label = "Awaiting base decision";
    reason = "The candidate was rejected and nothing was sent; the case is still open.";
    next = "Close the case, or Continue Monitoring";
  } else if (stage === "reassessed") {
    reason = ev.result.outcome === "within-baseline" ? "The retest is Within Reference Range, but one retest in range does not show recovery; the original alert is still open and needs a base decision." : `Re-evaluation: ${ev.result.headline}; needs a base decision.`;
    next = actionable ? "Approve another retest, close the case, or Continue Monitoring" : "Close the case (clears the alert), or Continue Monitoring (alert stays)";
  } else if (actionable) {
    reason = stopReason ? `${stopReason} Base staff review the candidate: ${cand!.title}.` : "The simulated analysis prepared a candidate; base staff must approve it before anything is published.";
    next = "After approval it is dispatched to the HUD; it can also be rejected";
  } else {
    reason = "The result is Within Reference Range; base staff close the case or Continue Monitoring.";
    next = "Close the case, or Continue Monitoring";
  }
  const primary: Decision | null = options.includes("approve") ? "approve" : options.includes("close") ? "close" : null;
  return node({
    id: `v${ev.version}:pending-${c.reviews.length}`,
    label,
    state: "human",
    owner: "Base staff",
    summary: c.phase === "monitoring" ? "Case open · alert stays" : (cand?.title ?? "Needs a base decision"),
    input: [`This round: ${ev.result.headline}`, ...(cand ? [`Candidate (not published): ${cand.title}`, cand.rationale] : [])],
    result: ev.version > 1 ? alertNote(c) : `Key evidence: ${keyBasis(ev.result).map((b) => b.replace(/\.$/, "")).join("; ")}.`,
    next,
    reason,
    relation,
    // The main evidence stays beside the decision: v1 alone, or v1 → v2 when both are comparable.
    indicators: ev.version > 1 ? (view.kind === "paired" ? indicators(view.after, view.before) : []) : indicators(ev, null),
    action: { kind: "decide", options, primary },
  });
}

const delivery = (msgs: OutMessage[], mock: boolean): Pick<FlowNode, "state" | "summary" | "reason" | "result" | "action" | "owner" | "at"> => {
  const failed = msgs.filter((m) => m.delivery === "failed");
  if (failed.length) return { state: "stopped", owner: "Base staff", summary: `Send failed ${failed.length}/${msgs.length}`, reason: `Send failed: ${failed[0].deliveryNote ?? "unknown reason"}. Base staff resend (same message).`, result: null, action: { kind: "resend", eventIds: failed.map((m) => m.eventId) }, at: null };
  if (msgs.some((m) => m.delivery === "queued")) return { state: "running", owner: "System", summary: "Sending…", reason: null, result: null, action: null, at: null };
  return {
    state: "done",
    owner: "System",
    summary: mock ? `${msgs.length} sent · local simulation only` : `${msgs.length} sent`,
    reason: null,
    result: mock ? "Handed to the local simulated channel: the base sent it; not a HUD receipt." : "Accepted by the relay: not a HUD receipt.",
    action: null,
    at: msgs.map((m) => m.adapterAt ?? "").sort().at(-1) || null,
  };
};

const MSG_TITLE = (m: OutMessage) => (m.type === "station.notice.approved" ? "Notice (action)" : m.type === "station.retest.requested" ? "Retest task (action)" : "Status notice");
const msgText = (m: OutMessage) => {
  const p = m.envelope.payload as { text?: string; instructions?: string; summary?: string };
  return p.text ?? p.instructions ?? p.summary ?? "";
};

/** Approval → sent → HUD receipt → astronaut confirmation → retest result (one retest round). */
function dispatchRow(s: StationState, c: Case, ev: Evaluation, approve: Review | null, mock: boolean, pending: FlowNode | null): FlowRow {
  const nodes: FlowNode[] = [];
  const title = `Review and dispatch · retest ${c.retests.filter((r) => r.requestedFromVersion <= ev.version).length || c.retests.length + 1}`;
  if (pending) {
    nodes.push(pending);
    for (const [id, label] of [["send", "Retest sent"], ["hud", "Received by HUD"], ["crew", "Acknowledged by Crew"], ["result", "Awaiting retest result"]] as const) nodes.push(node({ id: `v${ev.version}:${id}`, label, state: "todo", owner: "None", summary: "Not reached" }));
    return { id: `v${ev.version}:dispatch`, title, lane: "main", nodes };
  }
  const msgs = caseMessages(s, c.caseId).filter((m) => messageKind(m.type) === "action" && (m.envelope.payload as { evaluationVersion?: number }).evaluationVersion === ev.version);
  const rt = c.retests.find((r) => r.requestedFromVersion === ev.version) ?? null;
  const closed = c.phase === "closed";
  const earlyClose = closed ? { kind: "decide" as const, options: [] as Decision[], primary: null } : workbenchStage(c) === "dispatched" ? { kind: "decide" as const, options: allowedDecisions(c), primary: null } : null;
  nodes.push(reviewNode(ev, approve!, 0));
  const send = delivery(msgs, mock);
  nodes.push(node({ id: `v${ev.version}:send`, label: "Retest sent", ...send, input: msgs.map((m) => `${MSG_TITLE(m)}: ${msgText(m)}`), next: send.state === "done" ? "Awaiting the HUD receipt" : null, messages: msgs }));
  const sent = send.state === "done";

  const received = msgs.filter((m) => m.hudReceivedAt).length;
  nodes.push(
    node({
      id: `v${ev.version}:hud`,
      label: "Received by HUD",
      state: !sent ? "todo" : received === msgs.length ? "done" : "waiting",
      owner: "HUD",
      at: received === msgs.length ? (msgs.map((m) => m.hudReceivedAt ?? "").sort().at(-1) ?? null) : null,
      summary: !sent ? "Not reached" : `Received ${received}/${msgs.length}`,
      input: msgs.map((m) => `${MSG_TITLE(m)}: ${m.hudReceivedAt ? `received ${hhmmss(m.hudReceivedAt)}` : "no receipt yet"}`),
      result: received === msgs.length ? "The HUD device received it (not a crew acknowledgement)" : null,
      next: "Awaiting the crew acknowledgement",
      reason: sent && received < msgs.length ? (closed ? "No receipt (Case Closed; no longer waiting)" : "Waiting for the HUD receipt (never inferred from time).") : null,
      messages: msgs,
    }),
  );

  const acked = msgs.filter((m) => m.feedback === "acknowledged").length;
  const deferred = msgs.find((m) => m.feedback === "deferred");
  nodes.push(
    node({
      id: `v${ev.version}:crew`,
      label: "Acknowledged by Crew",
      state: !sent ? "todo" : deferred ? "stopped" : acked === msgs.length ? "done" : "waiting",
      owner: deferred ? "Base staff" : "Crew",
      at: acked === msgs.length ? (msgs.map((m) => m.feedbackAt ?? "").sort().at(-1) ?? null) : null,
      summary: !sent ? "Not reached" : deferred ? "Deferred by the crew" : `Acknowledged ${acked}/${msgs.length}`,
      input: msgs.map((m) => `${MSG_TITLE(m)}: ${{ none: "no feedback", acknowledged: `acknowledged ${hhmmss(m.feedbackAt)}`, deferred: `deferred: ${m.feedbackNote ?? ""}` }[m.feedback]}`),
      result: acked === msgs.length ? "The crew acknowledged the notice and the retest task on the HUD" : null,
      next: deferred ? "Wait for the crew to acknowledge again; base staff may also close the case early" : "Waiting for the crew to retest with the standard protocol",
      reason: deferred ? `Deferred by the crew: ${deferred.feedbackNote ?? "no reason given"}. Wait for the crew to acknowledge again, or base staff close the case early.` : sent && acked < msgs.length && !closed ? "Waiting for the crew to acknowledge on the HUD (never inferred from time)." : null,
      messages: msgs,
    }),
  );

  const resultEv = rt?.resultVersion ? c.evaluations.find((e) => e.version === rt.resultVersion) : null;
  const receipt = resultEv ? caseMessages(s, c.caseId).find((m) => m.type === "station.receipt" && (m.envelope.payload as { receivedEventId?: string }).receivedEventId === resultEv.sourceEventId) : null;
  const resultState: NodeState = rt?.status === "result-received" ? "done" : closed ? "skipped" : !sent || deferred ? "todo" : "waiting";
  nodes.push(
    node({
      id: `v${ev.version}:result`,
      label: resultState === "done" ? "Retest result" : "Awaiting retest result",
      state: resultState,
      owner: rt?.status === "completed" ? "Data source" : "Crew",
      at: resultEv?.startedAt ?? null,
      summary: resultState === "done" ? `Received → analysis round ${rt!.resultVersion}` : resultState === "skipped" ? "Case Closed: no longer needed" : rt?.status === "completed" ? "Crew reports done; waiting for data" : resultState === "waiting" ? "Waiting for retest data" : "Not reached",
      input: rt ? [`Retest task: retest once with the standard protocol (${rt.status === "result-received" ? "done" : "in progress"})`, ...(rt.completedAt ? [`Crew reported done: ${hhmmss(rt.completedAt)} (optional extension message)`] : [])] : [],
      result: resultState === "done" ? `Retest data received; receipt ${receipt ? (receipt.delivery === "failed" ? "send failed" : "sent") : "not sent"}. The first evaluation is kept unchanged.` : null,
      next: resultState === "done" ? "The second simulated analysis starts automatically" : null,
      reason: resultState === "waiting" ? (rt?.status === "completed" ? "The crew reports the retest as done; waiting for the retest data." : "Waiting for the crew to retest with the standard protocol and send the result (never inferred from time).") : null,
    }),
  );
  // One open wait at a time: later nodes still waiting for their own reply show as not reached.
  let blocked = false;
  for (const n of nodes) {
    if (blocked && n.state === "waiting") n.state = "todo";
    if (n.state === "waiting" || n.state === "stopped") blocked = true;
  }
  // Early close is offered on the node the flow waits at.
  if (earlyClose && earlyClose.options.length) {
    const waitingNode = nodes.find((n) => n.state === "waiting" || n.state === "stopped");
    if (waitingNode && !waitingNode.action) waitingNode.action = earlyClose;
  }
  return { id: `v${ev.version}:dispatch`, title, lane: "main", nodes };
}

/** Human handling without (or after) a dispatch: decisions, the pending decision, the end node. */
function handlingRow(c: Case, ev: Evaluation, reviews: Review[], pending: FlowNode | null, offset: number): FlowRow {
  const nodes: FlowNode[] = reviews.map((r, i) => reviewNode(ev, r, offset + i));
  if (pending) nodes.push(pending);
  const close = reviews.find((r) => r.decision === "close");
  nodes.push(
    node({
      id: `v${ev.version}:end`,
      label: "Handling complete",
      state: close ? "done" : "todo",
      owner: "None",
      at: close?.at ?? null,
      summary: close ? "Case Closed · alert cleared by base staff" : "Not reached (case open)",
      result: close ? `Closed by ${close.reviewer}: ${close.reason}` : null,
      next: close ? "None (status-notice delivery is shown separately)" : null,
    }),
  );
  return { id: `v${ev.version}:handling`, title: "Base handling", lane: "main", nodes };
}

/** Status notifications (close / keep watching) and their delivery, kept apart from the handling. */
function noticeRow(s: StationState, c: Case, mock: boolean): FlowRow | null {
  const msgs = caseMessages(s, c.caseId).filter((m) => messageKind(m.type) === "status");
  if (!msgs.length) return null;
  const nodes: FlowNode[] = [];
  msgs.forEach((m, i) => {
    const caseStatus = (m.envelope.payload as { caseStatus?: string }).caseStatus;
    const what = caseStatus === "closed" ? "Case Closed" : caseStatus === "monitoring" ? "Continue Monitoring" : (caseStatus ?? "");
    const d = delivery([m], mock);
    nodes.push(node({ id: `n${i}:send`, label: `Status notice: ${what}`, ...d, summary: d.state === "done" ? (mock ? "Sent · local simulation only" : "Sent") : d.summary, input: [`Content: ${msgText(m)}`, "Type: status notice (case status only, not an action)"], next: d.state === "done" ? "Awaiting the HUD receipt" : null, messages: [m] }));
    nodes.push(
      node({
        id: `n${i}:hud`,
        label: "Received by HUD",
        state: d.state !== "done" ? "todo" : m.hudReceivedAt ? "done" : "waiting",
        owner: "HUD",
        at: m.hudReceivedAt,
        summary: d.state !== "done" ? "Not reached" : m.hudReceivedAt ? `Received ${hhmmss(m.hudReceivedAt).slice(0, 5)}` : "Awaiting receipt",
        reason: d.state === "done" && !m.hudReceivedAt ? "Waiting for the HUD receipt (never inferred from time)." : null,
        result: m.hudReceivedAt ? "The HUD device received the status notice" : null,
        messages: [m],
      }),
    );
  });
  return { id: "notice", title: "Status-notice delivery (separate from the handling)", lane: "notice", nodes };
}

/** The whole flow of one case. `mock`: the station runs on the local mock adapter. */
export function buildFlow(s: StationState, c: Case, { mock }: { mock: boolean }): FlowView {
  const rows: FlowRow[] = [];
  const last = latest(c);
  for (const ev of c.evaluations) {
    const row = analysisRow(c, ev);
    rows.push(row);
    if (ev.completedAt === null) break;
    const reviews = c.reviews.filter((r) => r.version === ev.version);
    const approveIdx = reviews.findIndex((r) => r.decision === "approve");
    const isLatest = ev.version === last.version;
    const stopped = row.nodes.find((n) => n.state === "stopped");
    const needsDecision = isLatest && c.phase !== "closed" && ["review", "reassessed", "decided"].includes(workbenchStage(c));
    if (approveIdx >= 0) {
      rows.push(dispatchRow(s, c, ev, reviews[approveIdx], mock, null));
      const after = reviews.slice(approveIdx + 1);
      if (after.length) rows.push(handlingRow(c, ev, after, null, approveIdx + 1));
    } else if (needsDecision && reviews.length === 0 && isActionable(ev.result.candidate)) {
      rows.push(dispatchRow(s, c, ev, null, mock, pendingDecision(c, ev, stopped?.reason ?? null)));
    } else {
      rows.push(handlingRow(c, ev, reviews, needsDecision ? pendingDecision(c, ev, stopped?.reason ?? null) : null, 0));
    }
  }
  const notice = noticeRow(s, c, mock);
  if (notice) rows.push(notice);
  // When did the flow reach each open node: the latest time recorded before it (same lane).
  for (const lane of ["main", "notice"] as const) {
    let lastAt: string | null = c.openedAt;
    for (const r of rows.filter((x) => x.lane === lane))
      for (const n of r.nodes) {
        if (n.state === "waiting" || n.state === "human" || n.state === "running" || n.state === "stopped") n.since = lastAt;
        if (n.at && (!lastAt || n.at > lastAt)) lastAt = n.at;
      }
  }

  const main = rows.filter((r) => r.lane === "main");
  const lastRow = main[main.length - 1];
  const open = lastRow.nodes.find((n) => n.state !== "done" && n.state !== "skipped");
  const finished = c.phase === "closed";
  const currentNode = open ?? lastRow.nodes[lastRow.nodes.length - 1];
  const why = finished
    ? "Handling complete: Case Closed by base staff."
    : currentNode.state === "running"
      ? currentNode.label === "Retest sent"
        ? "The base is sending the messages."
        : "Simulated analysis in progress (deterministic rules, no model called)."
      : (currentNode.reason ?? "Needs handling.");
  const lastNotice = notice?.nodes.filter((n) => n.id.endsWith(":hud")).at(-1);
  const lastNoticeSend = notice?.nodes.filter((n) => n.id.endsWith(":send")).at(-1);
  const noticePending = lastNoticeSend?.state === "stopped" ? "Status notice failed to send: resend it" : lastNotice && lastNotice.state !== "done" ? "Status notice sent; awaiting the HUD receipt" : null;
  return {
    rows,
    current: { rowId: lastRow.id, node: currentNode },
    where: finished ? "Base handling · Case Closed" : `${lastRow.title.split(" · ")[0]} · ${currentNode.label}`,
    why,
    who: finished ? "None" : currentNode.owner,
    finished,
    noticePending,
  };
}
