// MyoMars base station: the case state machine. Pure and deterministic: `step(state, action)`
// returns the next state plus EFFECTS (messages to send, analysis ticks to schedule, timers to
// cancel); the React hook executes them. Rules enforced here:
// - every inbound event is processed once (deduplicated by eventId);
// - events from an old scenario run, or late analysis ticks, are ignored;
// - the simulated analysis only produces a CANDIDATE; nothing reaches the HUD without a human
//   "approve" with a recorded reason;
// - a retest result must match a retest this case requested; duplicates make no new evaluation;
// - alerts are never lowered by a result, a data failure or an analysis failure: only a human
//   "close" clears them, and a single normal retest does not close a case by itself.

import { analyse, STAGES, type AnalysisResult, type Baseline, type Candidate } from "./analysis";
import {
  parseInbound,
  SCHEMA,
  type Envelope,
  type InboundType,
  type NoticePayload,
  type Observation,
  type OutboundType,
  type ReassessmentPayload,
  type ReceiptPayload,
  type RetestRequestPayload,
  type ScenarioStart,
} from "./protocol";

export type LinkMode = "standalone-mock" | "same-browser" | "cross-device";

export type Phase = "analysing" | "awaiting-review" | "on-hold" | "awaiting-hud" | "awaiting-retest" | "deferred" | "rejected" | "monitoring" | "closed";
export type Decision = "approve" | "reject" | "hold" | "close" | "keep-open";
export type AlertLevel = "none" | "watch" | "alert";

export type Evaluation = {
  version: number;
  trigger: "observation" | "retest";
  sourceEventId: string;
  retestId: string | null;
  observation: Observation;
  result: AnalysisResult;
  /** Stages revealed so far (the result is already fixed; only its display is paced). */
  revealed: number;
  startedAt: string;
  completedAt: string | null;
};

export type OutMessage = {
  eventId: string;
  type: OutboundType;
  caseId: string | null;
  retestId: string | null;
  envelope: Envelope;
  /** Handed to the adapter (NOT received by the HUD). */
  delivery: "queued" | "sent" | "failed";
  deliveryNote: string | null;
  adapterAt: string | null;
  /** HUD device receipt (hud.received); null until a real receipt arrives. */
  hudReceivedAt: string | null;
  /** Astronaut feedback (notice and retest messages only); "none" until a real hud.ack / hud.defer arrives. */
  feedback: "none" | "acknowledged" | "deferred";
  feedbackNote: string | null;
  feedbackAt: string | null;
};

export type Retest = {
  retestId: string;
  requestEventId: string;
  requestedFromVersion: number;
  status: "requested" | "acknowledged" | "deferred" | "result-received";
  resultEventId: string | null;
  resultVersion: number | null;
};

export type Review = { version: number; decision: Decision; reason: string; reviewer: string; at: string };

export type Case = {
  caseId: string;
  astronautId: string;
  openedAt: string;
  phase: Phase;
  alert: { level: AlertLevel; reason: string; since: string | null };
  evaluations: Evaluation[];
  reviews: Review[];
  retests: Retest[];
};

export type TimelineEntry = { at: string; kind: "in" | "out" | "system" | "review" | "ignored"; text: string; caseId: string | null; eventId: string | null };

export type StationState = {
  run: { runId: string; scenarioId: string; astronaut: ScenarioStart["astronaut"]; task: ScenarioStart["task"]; startedAt: string } | null;
  endedRuns: string[];
  seen: Record<string, true>;
  cases: Record<string, Case>;
  caseOrder: string[];
  outbox: OutMessage[];
  outSeq: number;
  timeline: TimelineEntry[];
  baselines: readonly Baseline[];
};

export type Action =
  | { type: "inbound"; raw: unknown; at: string }
  | { type: "stage-tick"; runId: string; caseId: string; version: number; at: string }
  | { type: "review"; caseId: string; version: number; decision: Decision; reason: string; reviewer: string; at: string }
  | { type: "delivery"; eventId: string; ok: boolean; note: string | null; at: string }
  | { type: "resend"; eventId: string; at: string };

export type Effect = { kind: "send"; envelope: Envelope } | { kind: "schedule-tick"; runId: string; caseId: string; version: number } | { kind: "cancel-ticks" };

export type StepResult = { state: StationState; effects: Effect[]; error: string | null };

export function initialState(baselines: readonly Baseline[]): StationState {
  return { run: null, endedRuns: [], seen: {}, cases: {}, caseOrder: [], outbox: [], outSeq: 0, timeline: [], baselines };
}

const LEVEL: Record<AlertLevel, number> = { none: 0, watch: 1, alert: 2 };
export const latest = (c: Case) => c.evaluations[c.evaluations.length - 1];
/** Number of stages to reveal: up to and including the first stage that did not complete normally. */
export const stagesToReveal = (r: AnalysisResult) => {
  const i = r.stages.findIndex((s) => s.status !== "done");
  return i < 0 ? r.stages.length : i + 1;
};
export const isActionable = (c: Candidate | null) => !!c && (c.kind === "retest" || c.kind === "notice-and-retest");

/** Who has to act next on a case (shown on the station). */
export function nextOwner(c: Case): string {
  switch (c.phase) {
    case "analysing":
      return "模拟分析进行中（系统）";
    case "awaiting-hud":
      return "宇航员：等待 HUD 确认";
    case "awaiting-retest":
      return "宇航员：等待复测结果";
    case "closed":
      return "无：事件已由人工关闭";
    case "deferred":
      return "基地人员：宇航员已暂缓，需决定后续";
    default:
      return "基地人员：审核与决定";
  }
}

/**
 * The station's work stage for a case (what the base staff is looking at now):
 * analysing → review (v1) → dispatched → reassessing (result received) → reassessed (v ≥ 2) →
 * decided (rejected / kept under watch) → closed.
 */
export type WorkbenchStage = "analysing" | "review" | "dispatched" | "reassessing" | "reassessed" | "decided" | "closed";
export function workbenchStage(c: Case): WorkbenchStage {
  const v = latest(c)?.version ?? 1;
  switch (c.phase) {
    case "analysing":
      return v >= 2 ? "reassessing" : "analysing";
    case "awaiting-review":
    case "on-hold":
      return v >= 2 ? "reassessed" : "review";
    case "awaiting-hud":
    case "awaiting-retest":
    case "deferred":
      return "dispatched";
    case "rejected":
    case "monitoring":
      return "decided";
    case "closed":
      return "closed";
  }
}

/** Decisions a reviewer may take now on the latest evaluation. */
export function allowedDecisions(c: Case): Decision[] {
  const ev = latest(c);
  if (!ev || ev.completedAt === null) return [];
  const act = isActionable(ev.result.candidate);
  const noRepeatHold = (d: Decision[]) => (c.phase === "on-hold" ? d.filter((x) => x !== "hold") : d);
  switch (workbenchStage(c)) {
    case "review":
      return noRepeatHold(act ? ["approve", "reject", "hold"] : ["close", "keep-open", "hold"]);
    case "reassessed":
      return noRepeatHold(act ? ["approve", "close", "keep-open", "hold"] : ["close", "keep-open", "hold"]);
    case "dispatched":
      return ["close"];
    case "decided":
      return c.phase === "rejected" ? ["close", "keep-open"] : ["close"];
    default:
      return [];
  }
}

function noBaselineResult(o: Observation): AnalysisResult {
  return {
    inputKey: `no-baseline:${o.observationId}`,
    stages: [
      { id: "quality", status: "done", summary: "未评估信号细节（缺少基线时不作分析）。", evidence: [] },
      { id: "context", status: "failed", summary: `没有宇航员 ${o.astronautId} 的个体基线，无法比较。`, evidence: [] },
      { id: "features", status: "skipped", summary: "未执行", evidence: [] },
      { id: "recommendation", status: "skipped", summary: "未执行", evidence: [] },
    ],
    outcome: "analysis-failed",
    alert: "watch",
    headline: "分析失败：缺少个体基线",
    conclusion: "没有可用的个体基线，模拟分析无法进行；不会清除已有告警。",
    limitations: ["分析失败不等于结果正常。"],
    comparisons: [],
    candidate: null,
  };
}

export function step(state: StationState, action: Action): StepResult {
  const s: StationState = structuredClone(state);
  const effects: Effect[] = [];
  const log = (at: string, kind: TimelineEntry["kind"], text: string, caseId: string | null = null, eventId: string | null = null) => s.timeline.push({ at, kind, text, caseId, eventId });
  const fail = (error: string): StepResult => ({ state, effects: [], error });

  const send = (at: string, type: OutboundType, caseId: string | null, retestId: string | null, payload: unknown) => {
    if (!s.run) return null;
    s.outSeq += 1;
    const eventId = `stn-${s.run.runId}-${String(s.outSeq).padStart(3, "0")}`;
    const envelope: Envelope = { schema: SCHEMA, eventId, runId: s.run.runId, caseId, retestId, sentAt: at, source: "station", type, payload };
    s.outbox.push({ eventId, type, caseId, retestId, envelope, delivery: "queued", deliveryNote: null, adapterAt: null, hudReceivedAt: null, feedback: "none", feedbackNote: null, feedbackAt: null });
    effects.push({ kind: "send", envelope });
    log(at, "out", `发出 ${type}`, caseId, eventId);
    return eventId;
  };

  const startEvaluation = (at: string, c: Case, trigger: Evaluation["trigger"], sourceEventId: string, observation: Observation, retestId: string | null) => {
    const baseline = s.baselines.find((b) => b.astronautId === observation.astronautId);
    const result = baseline ? analyse(observation, baseline) : noBaselineResult(observation);
    const version = c.evaluations.length + 1;
    c.evaluations.push({ version, trigger, sourceEventId, retestId, observation, result, revealed: 0, startedAt: at, completedAt: null });
    c.phase = "analysing";
    log(at, "system", `开始第 ${version} 版模拟分析（${trigger === "retest" ? "复测结果" : "观测"}）`, c.caseId, sourceEventId);
    effects.push({ kind: "schedule-tick", runId: s.run!.runId, caseId: c.caseId, version });
  };

  switch (action.type) {
    case "inbound": {
      const at = action.at;
      const parsed = parseInbound(action.raw);
      if (!parsed.ok) {
        log(at, "ignored", `拒收无效消息：${parsed.error.split("\n")[0]}`, null, parsed.eventId);
        return { state: s, effects, error: parsed.error };
      }
      const env = parsed.envelope;
      const type = env.type as InboundType;
      if (s.seen[env.eventId]) {
        log(at, "ignored", `重复事件已忽略（${type}）`, env.caseId, env.eventId);
        if (type === "retest.result" && s.run?.runId === env.runId) {
          send(at, "station.receipt", env.caseId, env.retestId ?? null, { receivedEventId: env.eventId, receivedType: type, status: "duplicate", reason: "same eventId already processed" } satisfies ReceiptPayload);
        }
        return { state: s, effects, error: null };
      }
      s.seen[env.eventId] = true;

      if (type === "scenario.start") {
        if (s.run?.runId === env.runId) {
          log(at, "ignored", "该场景运行已开始，忽略重复开始", null, env.eventId);
          return { state: s, effects, error: null };
        }
        if (s.endedRuns.includes(env.runId)) {
          log(at, "ignored", `场景运行 ${env.runId} 已重置，忽略`, null, env.eventId);
          return { state: s, effects, error: null };
        }
        if (s.run) {
          s.endedRuns.push(s.run.runId);
          effects.push({ kind: "cancel-ticks" });
          log(at, "system", `新场景开始，结束上一轮 ${s.run.runId}`);
        }
        const p = parsed.payload as ScenarioStart;
        s.run = { runId: env.runId, scenarioId: p.scenarioId, astronaut: p.astronaut, task: p.task, startedAt: at };
        s.cases = {};
        s.caseOrder = [];
        log(at, "in", `场景开始：${p.scenarioId}（运行 ${env.runId}）`, null, env.eventId);
        return { state: s, effects, error: null };
      }

      // Every other event must belong to the active run.
      if (!s.run || env.runId !== s.run.runId) {
        const why = s.endedRuns.includes(env.runId) ? "来自已重置的上一轮场景" : s.run ? "不属于当前场景运行" : "当前没有进行中的场景";
        log(at, "ignored", `${type} 已忽略：${why}`, env.caseId, env.eventId);
        return { state: s, effects, error: null };
      }

      if (type === "scenario.reset") {
        s.endedRuns.push(s.run.runId);
        effects.push({ kind: "cancel-ticks" });
        log(at, "in", `场景重置：运行 ${s.run.runId} 结束，取消进行中的分析`, null, env.eventId);
        s.run = null;
        s.cases = {};
        s.caseOrder = [];
        return { state: s, effects, error: null };
      }

      const caseId = env.caseId!;
      if (type === "observation.submitted") {
        const o = parsed.payload as Observation;
        let c = s.cases[caseId];
        if (c?.phase === "closed") {
          log(at, "ignored", "事件已关闭，忽略新观测", caseId, env.eventId);
          return { state: s, effects, error: null };
        }
        if (!c) {
          c = { caseId, astronautId: o.astronautId, openedAt: at, phase: "analysing", alert: { level: "none", reason: "", since: null }, evaluations: [], reviews: [], retests: [] };
          s.cases[caseId] = c;
          s.caseOrder.push(caseId);
        }
        log(at, "in", `收到模拟观测 ${o.observationId}`, caseId, env.eventId);
        startEvaluation(at, c, "observation", env.eventId, o, null);
        return { state: s, effects, error: null };
      }

      const c = s.cases[caseId];
      if (!c) {
        log(at, "ignored", `${type} 已忽略：未知案例 ${caseId}`, caseId, env.eventId);
        if (type === "retest.result") send(at, "station.receipt", caseId, env.retestId ?? null, { receivedEventId: env.eventId, receivedType: type, status: "rejected", reason: "unknown case" } satisfies ReceiptPayload);
        return { state: s, effects, error: null };
      }

      if (type === "hud.received") {
        const p = parsed.payload as { messageId: string };
        const m = s.outbox.find((x) => x.eventId === p.messageId && x.caseId === caseId);
        if (!m) {
          log(at, "ignored", `hud.received 已忽略：没有对应的基站消息 ${p.messageId}`, caseId, env.eventId);
          return { state: s, effects, error: null };
        }
        if (!m.hudReceivedAt) m.hudReceivedAt = at;
        log(at, "in", `HUD 接收回执：${m.type}`, caseId, env.eventId);
        return { state: s, effects, error: null };
      }

      if (type === "hud.ack" || type === "hud.defer") {
        const p = parsed.payload as { messageId: string; reason?: string; note?: string };
        const m = s.outbox.find((x) => x.eventId === p.messageId && x.caseId === caseId && (x.type === "station.notice.approved" || x.type === "station.retest.requested"));
        if (!m) {
          log(at, "ignored", `${type} 已忽略：没有对应的基站消息 ${p.messageId}`, caseId, env.eventId);
          return { state: s, effects, error: null };
        }
        m.feedback = type === "hud.ack" ? "acknowledged" : "deferred";
        m.feedbackNote = type === "hud.defer" ? (p.reason ?? null) : (p.note ?? null);
        m.feedbackAt = at;
        const rt = m.retestId ? c.retests.find((r) => r.retestId === m.retestId) : null;
        if (rt && rt.status !== "result-received") rt.status = type === "hud.ack" ? "acknowledged" : "deferred";
        if (c.phase !== "closed" && c.phase !== "analysing" && c.phase !== "awaiting-review" && c.phase !== "on-hold") {
          const open = c.retests.some((r) => r.status !== "result-received");
          c.phase = type === "hud.defer" ? "deferred" : open ? "awaiting-retest" : "monitoring";
        }
        log(at, "in", type === "hud.ack" ? `HUD 已确认 ${m.type}` : `HUD 暂缓：${p.reason}`, caseId, env.eventId);
        return { state: s, effects, error: null };
      }

      // retest.result
      const retestId = env.retestId!;
      const rt = c.retests.find((r) => r.retestId === retestId);
      const receipt = (status: ReceiptPayload["status"], reason: string | null) => send(at, "station.receipt", caseId, retestId, { receivedEventId: env.eventId, receivedType: type, status, reason } satisfies ReceiptPayload);
      if (!rt) {
        log(at, "ignored", `复测结果已拒收：未知复测任务 ${retestId}`, caseId, env.eventId);
        receipt("rejected", "unknown retestId for this case");
        return { state: s, effects, error: null };
      }
      if (rt.status === "result-received") {
        log(at, "ignored", `复测 ${retestId} 已收到过结果，不再重复评估`, caseId, env.eventId);
        receipt("duplicate", "a result for this retest was already received");
        return { state: s, effects, error: null };
      }
      const o = (parsed.payload as { observation: Observation }).observation;
      if (o.astronautId !== c.astronautId) {
        log(at, "ignored", "复测结果已拒收：宇航员不匹配", caseId, env.eventId);
        receipt("rejected", "astronautId does not match the case");
        return { state: s, effects, error: null };
      }
      if (c.phase === "closed") {
        log(at, "ignored", "事件已关闭，复测结果仅记录", caseId, env.eventId);
        receipt("rejected", "case closed");
        return { state: s, effects, error: null };
      }
      rt.status = "result-received";
      rt.resultEventId = env.eventId;
      rt.resultVersion = c.evaluations.length + 1;
      log(at, "in", `收到复测结果 ${o.observationId}（${retestId}）`, caseId, env.eventId);
      receipt("accepted", null);
      startEvaluation(at, c, "retest", env.eventId, o, retestId);
      return { state: s, effects, error: null };
    }

    case "stage-tick": {
      const c = s.cases[action.caseId];
      const ev = c ? latest(c) : null;
      // Late ticks (old run, superseded version, finished evaluation) are ignored.
      if (!s.run || s.run.runId !== action.runId || !c || !ev || ev.version !== action.version || ev.completedAt !== null) return { state, effects: [], error: null };
      ev.revealed += 1;
      if (ev.revealed < stagesToReveal(ev.result)) {
        effects.push({ kind: "schedule-tick", runId: action.runId, caseId: c.caseId, version: ev.version });
        return { state: s, effects, error: null };
      }
      ev.revealed = ev.result.stages.length;
      ev.completedAt = action.at;
      c.phase = "awaiting-review";
      if (LEVEL[ev.result.alert] > LEVEL[c.alert.level]) c.alert = { level: ev.result.alert, reason: ev.result.headline, since: action.at };
      log(action.at, "system", `第 ${ev.version} 版模拟分析完成：${ev.result.headline}；生成待审候选`, c.caseId);
      return { state: s, effects, error: null };
    }

    case "review": {
      const c = s.cases[action.caseId];
      if (!s.run || !c) return fail("没有这个事件");
      const ev = latest(c);
      if (!ev || ev.version !== action.version) return fail("审核针对的不是最新版本评估，请刷新后再审核");
      if (!allowedDecisions(c).includes(action.decision)) return fail("当前状态不允许该操作");
      const reason = action.reason.trim();
      const reviewer = action.reviewer.trim();
      if (reason.length < 2) return fail("请填写审核理由");
      if (!reviewer) return fail("请填写审核人");
      c.reviews.push({ version: ev.version, decision: action.decision, reason, reviewer, at: action.at });
      const at = action.at;
      const cand = ev.result.candidate;
      const DECISION_TEXT: Record<Decision, string> = { approve: "批准", reject: "驳回", hold: "保留复核", close: "关闭事件", "keep-open": "保留事件继续观察" };
      log(at, "review", `${reviewer} ${DECISION_TEXT[action.decision]}（第 ${ev.version} 版）：${reason}`, c.caseId);
      if (action.decision === "approve" && cand && (cand.kind === "retest" || cand.kind === "notice-and-retest")) {
        if (cand.kind === "notice-and-retest") {
          send(at, "station.notice.approved", c.caseId, null, {
            noticeId: `${c.caseId}-n${ev.version}`,
            text: cand.notice.text,
            basis: ev.result.stages.filter((x) => x.status === "done").map((x) => x.summary),
            evaluationVersion: ev.version,
            reviewedBy: reviewer,
            reviewReason: reason,
            simulated: true,
          } satisfies NoticePayload);
        }
        const retestId = `${c.caseId}-rt${c.retests.length + 1}`;
        const reqId = send(at, "station.retest.requested", c.caseId, retestId, { retestId, protocol: cand.retest.protocol, instructions: cand.retest.instructions, evaluationVersion: ev.version, reviewedBy: reviewer, simulated: true } satisfies RetestRequestPayload);
        c.retests.push({ retestId, requestEventId: reqId!, requestedFromVersion: ev.version, status: "requested", resultEventId: null, resultVersion: null });
        c.phase = "awaiting-hud";
      } else if (action.decision === "reject") c.phase = "rejected";
      else if (action.decision === "hold") c.phase = "on-hold";
      else if (action.decision === "keep-open") c.phase = "monitoring";
      else if (action.decision === "close") {
        c.phase = "closed";
        c.alert = { level: "none", reason: `由 ${reviewer} 人工关闭`, since: at };
      }
      if (ev.version >= 2 && action.decision !== "hold") {
        send(at, "station.reassessment", c.caseId, ev.retestId, {
          evaluationVersion: ev.version,
          outcome: ev.result.outcome,
          summary: ev.result.headline,
          reviewDecision: action.decision,
          caseStatus: c.phase,
          simulated: true,
        } satisfies ReassessmentPayload);
      }
      return { state: s, effects, error: null };
    }

    case "delivery": {
      const m = s.outbox.find((x) => x.eventId === action.eventId);
      if (!m) return { state, effects: [], error: null };
      m.delivery = action.ok ? "sent" : "failed";
      m.deliveryNote = action.note;
      m.adapterAt = action.ok ? action.at : null;
      if (!action.ok) log(action.at, "system", `发送失败：${m.type}（${action.note ?? "未知原因"}）`, m.caseId, m.eventId);
      return { state: s, effects, error: null };
    }

    case "resend": {
      const m = s.outbox.find((x) => x.eventId === action.eventId);
      if (!m || m.delivery !== "failed") return fail("只有发送失败的消息可以重发");
      m.delivery = "queued";
      effects.push({ kind: "send", envelope: m.envelope });
      log(action.at, "out", `重发 ${m.type}（同一 eventId）`, m.caseId, m.eventId);
      return { state: s, effects, error: null };
    }
  }
}

/** Display status of each analysis stage of an evaluation. */
export function stageView(ev: Evaluation): { id: string; label: string; status: "waiting" | "running" | "done" | "blocked" | "failed" | "skipped"; summary: string | null }[] {
  return STAGES.map((st, i) => {
    const r = ev.result.stages[i];
    if (ev.completedAt !== null || i < ev.revealed) return { id: st.id, label: st.label, status: r.status, summary: r.summary };
    if (i === ev.revealed) return { id: st.id, label: st.label, status: "running", summary: null };
    return { id: st.id, label: st.label, status: "waiting", summary: null };
  });
}
