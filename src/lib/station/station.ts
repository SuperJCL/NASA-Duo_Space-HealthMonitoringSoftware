// MyoMars base station: the case state machine. Pure and deterministic: `step(state, action)`
// returns the next state plus EFFECTS (messages to send, analysis ticks to schedule, timers to
// cancel); the React hook executes them. Rules enforced here:
// - every inbound event is processed once (deduplicated by eventId);
// - events from an old scenario run, or late analysis ticks, are ignored;
// - the simulated analysis only produces a CANDIDATE; nothing reaches the HUD without a human
//   "approve" with a recorded reason;
// - ACTION messages (notice, retest task) are sent only on "approve"; a human "close" or
//   "keep-open" publishes a STATUS notification (station.reassessment with caseStatus), never an
//   action, and the same case status is never published twice;
// - a retest result must match a retest this case requested; duplicates make no new evaluation;
// - alerts are never lowered by a result, a data failure or an analysis failure: only a human
//   "close" clears them, and a single normal retest does not close a case by itself.

import { analyse, analyseReport, STAGES, type AnalysisResult, type Baseline, type Candidate } from "./analysis";
import { isLocalType, parseLocal, type CrewMemberPayload, type HudReport } from "./local-protocol";
import {
  parseIncoming,
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

export type LinkMode = "standalone-mock" | "same-browser" | "cross-device" | "relay";

export type Phase = "analysing" | "awaiting-review" | "awaiting-hud" | "awaiting-retest" | "deferred" | "rejected" | "monitoring" | "closed";
const PHASES: readonly Phase[] = ["analysing", "awaiting-review", "awaiting-hud", "awaiting-retest", "deferred", "rejected", "monitoring", "closed"];
/**
 * Human decisions offered in this version. ("hold" from the v0 draft is not offered: it left the
 * event in the same pending state with no other effect, so it duplicated simply not deciding.)
 */
export type Decision = "approve" | "reject" | "close" | "keep-open";
export type AlertLevel = "none" | "watch" | "alert";

export type Evaluation = {
  version: number;
  /** report: the astronaut's own report (local mock extension); no measurement, no sEMG comparison. */
  trigger: "observation" | "retest" | "report";
  sourceEventId: string;
  retestId: string | null;
  observation: Observation | null;
  report: HudReport | null;
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
  /** The relay's sequence number for this message, once the relay echoed it back (relay mode only). */
  relaySeq: number | null;
  /** HUD device receipt (hud.received); null until a real receipt arrives. */
  hudReceivedAt: string | null;
  /** Astronaut feedback (notice and retest messages only); "none" until a real hud.ack / hud.defer arrives. */
  feedback: "none" | "acknowledged" | "deferred";
  feedbackNote: string | null;
  feedbackAt: string | null;
};

/**
 * What a station message is for the HUD:
 * - action: the astronaut is asked to do something (notice to acknowledge, retest to perform);
 * - status: information about the case status only (closed / kept under watch); nothing to do;
 * - receipt: the station received a retest result;
 * - audit: traceability record, not for the HUD (station.audit.*).
 */
export type MessageKind = "action" | "status" | "receipt" | "audit";
export function messageKind(type: string): MessageKind {
  if (type === "station.notice.approved" || type === "station.retest.requested") return "action";
  if (type === "station.reassessment") return "status";
  if (type === "station.receipt") return "receipt";
  return "audit";
}

/**
 * Station messages for a case IN THE CURRENT RUN. Demo case IDs repeat across runs and the outbox
 * keeps earlier runs' messages, so lookups by case must also match the run.
 */
export const caseMessages = (s: Pick<StationState, "outbox" | "run">, caseId: string | null): OutMessage[] => s.outbox.filter((m) => m.caseId === caseId && !!s.run && m.envelope.runId === s.run.runId);

/** Readable names of the station messages (event types stay in the technical details). */
export const OUT_LABEL: Record<OutboundType, string> = {
  "station.notice.approved": "提示（行动消息）",
  "station.retest.requested": "复测任务（行动消息）",
  "station.receipt": "复测结果接收回执",
  "station.reassessment": "状态通知",
  "station.audit.assessment": "审计：评估记录",
  "station.audit.review": "审计：审核记录",
};

export type Retest = {
  retestId: string;
  requestEventId: string;
  requestedFromVersion: number;
  /** completed: the astronaut reported the retest as performed (retest.completed); data still to come. */
  status: "requested" | "acknowledged" | "deferred" | "completed" | "result-received";
  completedAt: string | null;
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
  /** When base staff last viewed the case (station-internal; never an astronaut confirmation, never a close). */
  viewedAt: string | null;
};

/** One crew member of the run. Device connection is separate from data validity and from case status. */
export type CrewMember = {
  astronautId: string;
  callsign: string;
  task: { id: string; title: string };
  evaStartedAt: string | null;
  deviceId: string | null;
  connection: "connected" | "disconnected" | "unknown";
  connectionAt: string | null;
};

/** `type`: the inbound message type for kind "in" (used for unread counts). */
export type TimelineEntry = { at: string; kind: "in" | "out" | "system" | "review" | "ignored"; text: string; caseId: string | null; eventId: string | null; type?: string };

export type StationState = {
  /** Demo session this station works in (the relay's session; "local" in mock mode). */
  sessionId: string;
  /** Last relay sequence number applied (0 in mock mode). Events at or below it are already in this state. */
  cursor: number;
  run: { runId: string; scenarioId: string; astronaut: ScenarioStart["astronaut"]; task: ScenarioStart["task"]; startedAt: string } | null;
  /** Crew of the current run: the scenario's astronaut, plus the local roster when one was sent. */
  crew: Record<string, CrewMember>;
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
  /** `adopt`: receipts already published earlier (history replay), keyed by the event they answer. */
  | { type: "inbound"; raw: unknown; at: string; adopt?: Map<string, unknown> }
  /**
   * Relay history (first connection, reload, reconnection): processed in order. The station's own
   * earlier messages in it are restored, never sent again.
   */
  | { type: "history"; raws: unknown[]; at: string }
  /** A send this window must not make (read-only window): drop it from the outbox. */
  | { type: "discard"; eventId: string; at: string }
  | { type: "stage-tick"; runId: string; caseId: string; version: number; at: string }
  | { type: "review"; caseId: string; version: number; decision: Decision; reason: string; reviewer: string; at: string }
  | { type: "delivery"; eventId: string; ok: boolean; note: string | null; at: string }
  | { type: "resend"; eventId: string; at: string }
  /** Base staff opened the case: recorded for unread counts only (no message, no status change). */
  | { type: "view"; caseId: string; at: string };

export type Effect = { kind: "send"; envelope: Envelope } | { kind: "schedule-tick"; runId: string; caseId: string; version: number } | { kind: "cancel-ticks" };

export type StepResult = { state: StationState; effects: Effect[]; error: string | null };

export function initialState(baselines: readonly Baseline[], sessionId = "local"): StationState {
  return { sessionId, cursor: 0, run: null, crew: {}, endedRuns: [], seen: {}, cases: {}, caseOrder: [], outbox: [], outSeq: 0, timeline: [], baselines };
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
      return "无需处理：事件已由人工关闭";
    case "monitoring":
      return "基地人员：事件保留关注，可随时关闭";
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
  switch (workbenchStage(c)) {
    case "review":
      return act ? ["approve", "reject"] : ["close", "keep-open"];
    case "reassessed":
      return act ? ["approve", "close", "keep-open"] : ["close", "keep-open"];
    case "dispatched":
      return ["close"];
    case "decided":
      return c.phase === "rejected" ? ["close", "keep-open"] : ["close"];
    default:
      return [];
  }
}

/** Case status a decision leads to (approve: waiting for the HUD). */
const PHASE_AFTER: Record<Decision, Phase> = { approve: "awaiting-hud", reject: "rejected", close: "closed", "keep-open": "monitoring" };

/**
 * Text of the STATUS notification a decision publishes (null: the decision publishes none).
 * Shown to the reviewer before confirming, and sent unchanged as station.reassessment.summary.
 * close / keep-open: always (any evaluation version); approve: only for a re-evaluation (v ≥ 2),
 * next to the new action messages; reject: never.
 */
export function statusNoticeText(c: Case, decision: Decision): string | null {
  const ev = latest(c);
  if (!ev || ev.completedAt === null) return null;
  const result = `最新评估 v${ev.version}：${ev.result.headline}。`;
  const openRetest = c.retests.some((r) => r.status !== "result-received");
  switch (decision) {
    case "close":
      return `基地状态（模拟）：此事件已由基地人员关闭。${result}无需进一步操作。${openRetest ? "之前安排的复测无需再做。" : ""}`;
    case "keep-open":
      return `基地状态（模拟）：此事件保留关注，暂不关闭。${result}目前无需操作。`;
    case "approve":
      return ev.version >= 2 ? `基地状态（模拟）：已完成重评。${result}已安排新的复测，请查看复测任务。` : null;
    case "reject":
      return null;
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
  const log = (at: string, kind: TimelineEntry["kind"], text: string, caseId: string | null = null, eventId: string | null = null, type?: string) => s.timeline.push({ at, kind, text, caseId, eventId, ...(type ? { type } : {}) });
  const fail = (error: string): StepResult => ({ state, effects: [], error });

  const send = (at: string, type: OutboundType, caseId: string | null, retestId: string | null, payload: unknown) => {
    if (!s.run) return null;
    s.outSeq += 1;
    const eventId = `stn-${s.run.runId}-${String(s.outSeq).padStart(3, "0")}`;
    const envelope: Envelope = { schema: SCHEMA, eventId, sessionId: s.sessionId, runId: s.run.runId, caseId, retestId, sentAt: at, source: "station", type, payload };
    s.outbox.push({ eventId, type, caseId, retestId, envelope, delivery: "queued", deliveryNote: null, adapterAt: null, relaySeq: null, hudReceivedAt: null, feedback: "none", feedbackNote: null, feedbackAt: null });
    effects.push({ kind: "send", envelope });
    if (!type.startsWith("station.audit.")) log(at, "out", `发出${OUT_LABEL[type]}`, caseId, eventId);
    return eventId;
  };

  const startEvaluation = (at: string, c: Case, trigger: Evaluation["trigger"], sourceEventId: string, observation: Observation, retestId: string | null) => {
    const baseline = s.baselines.find((b) => b.astronautId === observation.astronautId);
    const result = baseline ? analyse(observation, baseline) : noBaselineResult(observation);
    const version = c.evaluations.length + 1;
    c.evaluations.push({ version, trigger, sourceEventId, retestId, observation, report: null, result, revealed: 0, startedAt: at, completedAt: null });
    c.phase = "analysing";
    log(at, "system", `开始第 ${version} 版模拟分析（${trigger === "retest" ? "复测结果" : "测量"}）`, c.caseId, sourceEventId);
    effects.push({ kind: "schedule-tick", runId: s.run!.runId, caseId: c.caseId, version });
  };

  /** Report check: uses the astronaut's latest completed measurement in this run, if any (never a new sEMG analysis). */
  const startReportEvaluation = (at: string, c: Case, sourceEventId: string, report: HudReport) => {
    const measured = s.caseOrder
      .flatMap((id) => s.cases[id].evaluations)
      .filter((e) => e.observation && e.observation.astronautId === report.astronautId && e.completedAt !== null)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .at(-1);
    const baseline = s.baselines.find((b) => b.astronautId === report.astronautId);
    const result = analyseReport(report, measured ? { observation: measured.observation!, result: measured.result, at: measured.observation!.capturedAt } : null, baseline?.protocol ?? null);
    const version = c.evaluations.length + 1;
    c.evaluations.push({ version, trigger: "report", sourceEventId, retestId: null, observation: null, report, result, revealed: 0, startedAt: at, completedAt: null });
    c.phase = "analysing";
    log(at, "system", `开始第 ${version} 版核查（宇航员报告）`, c.caseId, sourceEventId);
    effects.push({ kind: "schedule-tick", runId: s.run!.runId, caseId: c.caseId, version });
  };

  /** An evaluation's stages are all revealed: the case waits for a human (shared by ticks and history restore). */
  const completeEvaluation = (at: string, c: Case, ev: Evaluation) => {
    ev.revealed = ev.result.stages.length;
    ev.completedAt = at;
    c.phase = "awaiting-review";
    if (LEVEL[ev.result.alert] > LEVEL[c.alert.level]) c.alert = { level: ev.result.alert, reason: ev.result.headline, since: at };
    log(at, "system", `第 ${ev.version} 版模拟分析完成：${ev.result.headline}；生成待审候选`, c.caseId);
  };

  /**
   * A station message this window did not send (published before a reload, or by the station window
   * holding the relay lease): restore it into the outbox and the case, never send it again.
   */
  const restoreOwn = (raw: unknown, at: string): StepResult => {
    const parsed = parseIncoming(raw);
    if (!parsed.ok) {
      log(at, "ignored", `拒收无效的基站消息记录：${parsed.message.split("\n")[0]}`, null, parsed.eventId);
      return { state: s, effects, error: null };
    }
    const env = parsed.value;
    if (env.sessionId !== s.sessionId || !s.run || env.runId !== s.run.runId || s.seen[env.eventId]) return { state: s, effects, error: null };
    s.seen[env.eventId] = true;
    const n = new RegExp(`^stn-${s.run.runId}-(\\d+)$`).exec(env.eventId);
    if (n) s.outSeq = Math.max(s.outSeq, Number(n[1]));
    const when = env.receivedAt ?? at;
    const seq = env.seq;
    const plain: Record<string, unknown> = { ...env };
    delete plain.seq;
    delete plain.receivedAt;
    delete plain.sender;
    const type = env.type as OutboundType;
    s.outbox.push({ eventId: env.eventId, type, caseId: env.caseId, retestId: env.retestId ?? null, envelope: plain as Envelope, delivery: "sent", deliveryNote: "通信服务记录（本窗口重载前或另一基站窗口发出）", adapterAt: when, relaySeq: seq ?? null, hudReceivedAt: null, feedback: "none", feedbackNote: null, feedbackAt: null });
    if (!type.startsWith("station.audit.")) log(when, "out", `发出${OUT_LABEL[type]}（恢复自通信服务记录）`, env.caseId, env.eventId);
    const c = env.caseId ? s.cases[env.caseId] : undefined;
    const p = parsed.payload as Record<string, unknown>;
    if (c && type === "station.audit.assessment") {
      const ev = c.evaluations.find((e) => e.version === p.evaluationVersion);
      if (ev && ev.completedAt === null) completeEvaluation(when, c, ev);
    } else if (c && type === "station.audit.review") {
      const decision = p.decision as Decision;
      if (!c.reviews.some((r) => r.version === p.evaluationVersion && r.at === p.decidedAt && r.decision === decision)) {
        c.reviews.push({ version: p.evaluationVersion as number, decision, reason: String(p.reason), reviewer: String(p.reviewer), at: String(p.decidedAt) });
        log(String(p.decidedAt), "review", `${p.reviewer} ${decision}（第 ${p.evaluationVersion} 版，恢复自通信服务记录）：${p.reason}`, c.caseId);
      }
      if (PHASES.includes(p.caseStatus as Phase)) c.phase = p.caseStatus as Phase;
      if (decision === "close") c.alert = { level: "none", reason: `由 ${p.reviewer} 人工关闭`, since: String(p.decidedAt) };
    } else if (c && type === "station.retest.requested" && !c.retests.some((r) => r.retestId === p.retestId)) {
      c.retests.push({ retestId: String(p.retestId), requestEventId: env.eventId, requestedFromVersion: p.evaluationVersion as number, status: "requested", completedAt: null, resultEventId: null, resultVersion: null });
    }
    return { state: s, effects, error: null };
  };

  switch (action.type) {
    case "history": {
      // Receipts already published for a retest result are adopted, not sent again.
      const adopt = new Map<string, unknown>();
      for (const raw of action.raws) {
        const r = raw as { type?: unknown; payload?: { receivedEventId?: unknown } };
        if (r && r.type === "station.receipt" && typeof r.payload?.receivedEventId === "string") adopt.set(r.payload.receivedEventId, raw);
      }
      let cur = state;
      const all: Effect[] = [];
      for (const raw of action.raws) {
        const at = (raw as { receivedAt?: unknown })?.receivedAt;
        const r = step(cur, { type: "inbound", raw, at: typeof at === "string" ? at : action.at, adopt });
        cur = r.state;
        all.push(...r.effects);
      }
      return { state: cur, effects: all, error: null };
    }

    case "discard": {
      const i = s.outbox.findIndex((m) => m.eventId === action.eventId && m.delivery === "queued");
      if (i < 0) return { state, effects: [], error: null };
      s.outbox.splice(i, 1);
      s.timeline = s.timeline.filter((t) => !(t.kind === "out" && t.eventId === action.eventId));
      return { state: s, effects, error: null };
    }

    case "inbound": {
      const at = action.at;
      const meta = (action.raw && typeof action.raw === "object" ? action.raw : {}) as { seq?: unknown; type?: unknown; eventId?: unknown; sessionId?: unknown };
      // Relay delivery order: an event at or below the cursor is already part of this state (resume / replay).
      if (typeof meta.seq === "number") {
        if (meta.seq <= s.cursor) return { state, effects: [], error: null };
        s.cursor = meta.seq;
      }
      // The station's own messages come back through the relay: this window's ones only get the relay's
      // sequence number; others (earlier session, other window) are restored, never re-sent.
      if (typeof meta.type === "string" && meta.type.startsWith("station.")) {
        const own = s.outbox.find((m) => m.eventId === meta.eventId);
        if (own) {
          if (typeof meta.seq === "number") own.relaySeq = meta.seq;
          return { state: s, effects, error: null };
        }
        return restoreOwn(action.raw, at);
      }
      if (typeof meta.sessionId === "string" && meta.sessionId !== s.sessionId) {
        log(at, "ignored", `来自其他演示会话 ${meta.sessionId}，已忽略`, null, typeof meta.eventId === "string" ? meta.eventId : null);
        return { state: s, effects, error: null };
      }
      // Local mock extensions (crew roster, device status, HUD report): NOT shared-contract messages.
      if (isLocalType(meta.type)) {
        const lp = parseLocal(action.raw);
        if (!lp.ok) {
          log(at, "ignored", `拒收无效本地消息：${lp.error.split("\n")[0]}`, null, lp.eventId);
          return { state: s, effects, error: lp.error };
        }
        const le = lp.envelope;
        if (s.seen[le.eventId]) {
          log(at, "ignored", `重复事件已忽略（${le.type}）`, le.caseId, le.eventId);
          return { state: s, effects, error: null };
        }
        s.seen[le.eventId] = true;
        if (!s.run || le.runId !== s.run.runId) {
          log(at, "ignored", `${le.type} 已忽略：${s.endedRuns.includes(le.runId) ? "来自已重置的上一轮场景" : "不属于当前场景运行"}`, le.caseId, le.eventId);
          return { state: s, effects, error: null };
        }
        if (le.type === "local.crew.roster") {
          for (const m of (lp.payload as { members: CrewMemberPayload[] }).members) {
            const prev = s.crew[m.astronautId];
            s.crew[m.astronautId] = { astronautId: m.astronautId, callsign: m.callsign, task: m.task, evaStartedAt: m.evaStartedAt, deviceId: m.deviceId, connection: prev?.connection ?? "unknown", connectionAt: prev?.connectionAt ?? null };
          }
          log(at, "in", `人员名单（本地模拟扩展）：${Object.keys(s.crew).length} 人`, null, le.eventId, le.type);
          return { state: s, effects, error: null };
        }
        if (le.type === "local.device.status") {
          const d = lp.payload as { astronautId: string; deviceId: string; connection: "connected" | "disconnected"; at: string };
          const m = s.crew[d.astronautId];
          if (!m) {
            log(at, "ignored", `设备状态已忽略：未知人员 ${d.astronautId}`, null, le.eventId);
            return { state: s, effects, error: null };
          }
          m.connection = d.connection;
          m.connectionAt = d.at;
          m.deviceId = d.deviceId;
          log(at, "in", `${m.callsign} 设备${d.connection === "connected" ? "已连接" : "断开"}`, null, le.eventId, le.type);
          return { state: s, effects, error: null };
        }
        // local.hud.report: a new event for that astronaut, checked like any input (never a diagnosis).
        const r = lp.payload as HudReport;
        const caseId = le.caseId!;
        if (s.cases[caseId]) {
          log(at, "ignored", "该报告对应的事件已存在，忽略", caseId, le.eventId);
          return { state: s, effects, error: null };
        }
        const c: Case = { caseId, astronautId: r.astronautId, openedAt: at, phase: "analysing", alert: { level: "none", reason: "", since: null }, evaluations: [], reviews: [], retests: [], viewedAt: null };
        s.cases[caseId] = c;
        s.caseOrder.push(caseId);
        log(at, "in", "收到宇航员主动报告（本地模拟扩展）", caseId, le.eventId, le.type);
        startReportEvaluation(at, c, le.eventId, r);
        return { state: s, effects, error: null };
      }

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
          log(at, "system", "新场景开始，结束上一轮");
        }
        const p = parsed.payload as ScenarioStart;
        s.run = { runId: env.runId, scenarioId: p.scenarioId, astronaut: p.astronaut, task: p.task, startedAt: at };
        s.crew = { [p.astronaut.id]: { astronautId: p.astronaut.id, callsign: p.astronaut.callsign, task: { id: p.task.id, title: p.task.title }, evaStartedAt: null, deviceId: null, connection: "unknown", connectionAt: null } };
        s.cases = {};
        s.caseOrder = [];
        log(at, "in", `场景开始：${p.astronaut.callsign} · ${p.task.title}`, null, env.eventId);
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
        log(at, "in", "场景重置：本轮结束，取消进行中的分析", null, env.eventId);
        s.run = null;
        s.crew = {};
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
          c = { caseId, astronautId: o.astronautId, openedAt: at, phase: "analysing", alert: { level: "none", reason: "", since: null }, evaluations: [], reviews: [], retests: [], viewedAt: null };
          s.cases[caseId] = c;
          s.caseOrder.push(caseId);
        }
        log(at, "in", "收到标准化模拟测量", caseId, env.eventId, type);
        startEvaluation(at, c, "observation", env.eventId, o, null);
        return { state: s, effects, error: null };
      }

      const c = s.cases[caseId];
      if (!c) {
        log(at, "ignored", `${type} 已忽略：未知案例 ${caseId}`, caseId, env.eventId);
        if (type === "retest.result") {
          const prior = action.adopt?.get(env.eventId);
          if (prior) restoreOwn(prior, at);
          else send(at, "station.receipt", caseId, env.retestId ?? null, { receivedEventId: env.eventId, receivedType: type, status: "rejected", reason: "unknown case" } satisfies ReceiptPayload);
        }
        return { state: s, effects, error: null };
      }

      if (type === "hud.received") {
        const p = parsed.payload as { messageId: string };
        const m = caseMessages(s, caseId).find((x) => x.eventId === p.messageId);
        if (!m) {
          log(at, "ignored", `hud.received 已忽略：没有对应的基站消息 ${p.messageId}`, caseId, env.eventId);
          return { state: s, effects, error: null };
        }
        if (!m.hudReceivedAt) m.hudReceivedAt = at;
        log(at, "in", `HUD 已接收：${OUT_LABEL[m.type]}`, caseId, env.eventId, type);
        return { state: s, effects, error: null };
      }

      if (type === "hud.ack" || type === "hud.defer") {
        const p = parsed.payload as { messageId: string; reason?: string; note?: string };
        const m = caseMessages(s, caseId).find((x) => x.eventId === p.messageId && messageKind(x.type) === "action");
        if (!m) {
          log(at, "ignored", `${type} 已忽略：没有对应的基站消息 ${p.messageId}`, caseId, env.eventId);
          return { state: s, effects, error: null };
        }
        m.feedback = type === "hud.ack" ? "acknowledged" : "deferred";
        m.feedbackNote = type === "hud.defer" ? (p.reason ?? null) : (p.note ?? null);
        m.feedbackAt = at;
        const rt = m.retestId ? c.retests.find((r) => r.retestId === m.retestId) : null;
        if (rt && rt.status !== "result-received" && rt.status !== "completed") rt.status = type === "hud.ack" ? "acknowledged" : "deferred";
        if (c.phase !== "closed" && c.phase !== "analysing" && c.phase !== "awaiting-review") {
          const open = c.retests.some((r) => r.status !== "result-received");
          c.phase = type === "hud.defer" ? "deferred" : open ? "awaiting-retest" : "monitoring";
        }
        log(at, "in", type === "hud.ack" ? `宇航员已确认：${OUT_LABEL[m.type]}` : `宇航员暂缓：${p.reason}`, caseId, env.eventId, type);
        return { state: s, effects, error: null };
      }

      if (type === "retest.completed") {
        const rid = env.retestId!;
        const r = c.retests.find((x) => x.retestId === rid);
        if (!r) {
          log(at, "ignored", `retest.completed 已忽略：未知复测任务 ${rid}`, caseId, env.eventId);
          return { state: s, effects, error: null };
        }
        if (r.status !== "result-received") {
          r.status = "completed";
          r.completedAt = (parsed.payload as { completedAt: string }).completedAt;
        }
        if (c.phase === "awaiting-hud" || c.phase === "deferred") c.phase = "awaiting-retest";
        log(at, "in", "宇航员报告已完成复测（等待复测数据）", caseId, env.eventId, type);
        return { state: s, effects, error: null };
      }

      // retest.result
      const retestId = env.retestId!;
      const rt = c.retests.find((r) => r.retestId === retestId);
      // History replay: a receipt published before (reload / other window) is adopted, never sent twice.
      const receipt = (status: ReceiptPayload["status"], reason: string | null) => {
        const prior = action.adopt?.get(env.eventId);
        if (prior) {
          restoreOwn(prior, at);
          return null;
        }
        return send(at, "station.receipt", caseId, retestId, { receivedEventId: env.eventId, receivedType: type, status, reason } satisfies ReceiptPayload);
      };
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
      log(at, "in", "收到复测结果（标准化模拟测量）", caseId, env.eventId, type);
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
      completeEvaluation(action.at, c, ev);
      // Traceability record of the completed assessment (NOT an action: the HUD ignores station.audit.*).
      // A report check has no contract representation (AuditAssessment.trigger has no "report"): timeline only.
      if (ev.trigger !== "report") send(action.at, "station.audit.assessment", c.caseId, null, {
        evaluationVersion: ev.version,
        trigger: ev.trigger,
        sourceEventId: ev.sourceEventId,
        inputKey: ev.result.inputKey.slice(0, 5000),
        outcome: ev.result.outcome,
        headline: ev.result.headline,
        candidateKind: ev.result.candidate?.kind ?? null,
        simulated: true,
      });
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
      const DECISION_TEXT: Record<Decision, string> = { approve: "批准", reject: "驳回", close: "关闭事件", "keep-open": "保留关注" };
      // Computed before the case changes, so it is exactly the text shown to the reviewer.
      const statusText = statusNoticeText(c, action.decision);
      log(at, "review", `${reviewer} ${DECISION_TEXT[action.decision]}（第 ${ev.version} 版）：${reason}`, c.caseId);
      if (action.decision === "approve" && cand && (cand.kind === "retest" || cand.kind === "notice-and-retest")) {
        if (cand.kind === "notice-and-retest") {
          send(at, "station.notice.approved", c.caseId, null, {
            noticeId: `${c.caseId}-n${ev.version}`,
            text: cand.notice.text,
            // Astronaut-facing evidence lines only: the internal workflow line ("生成待审候选…") and the
            // reviewer's own reason stay in the station (reviewReason is a contract field the HUD must not show).
            basis: ev.result.stages.filter((x) => x.status === "done" && x.id !== "recommendation").map((x) => x.summary),
            evaluationVersion: ev.version,
            reviewedBy: reviewer,
            reviewReason: reason,
            simulated: true,
          } satisfies NoticePayload);
        }
        const retestId = `${c.caseId}-rt${c.retests.length + 1}`;
        const reqId = send(at, "station.retest.requested", c.caseId, retestId, { retestId, protocol: cand.retest.protocol, instructions: cand.retest.instructions, evaluationVersion: ev.version, reviewedBy: reviewer, simulated: true } satisfies RetestRequestPayload);
        c.retests.push({ retestId, requestEventId: reqId!, requestedFromVersion: ev.version, status: "requested", completedAt: null, resultEventId: null, resultVersion: null });
      }
      c.phase = PHASE_AFTER[action.decision];
      if (action.decision === "close") c.alert = { level: "none", reason: `由 ${reviewer} 人工关闭`, since: at };
      // STATUS notification (not an action). Never the same case status twice for one evaluation.
      const published = caseMessages(s, c.caseId).some((m) => m.type === "station.reassessment" && (m.envelope.payload as ReassessmentPayload).evaluationVersion === ev.version && (m.envelope.payload as ReassessmentPayload).caseStatus === c.phase);
      if (statusText && !published) {
        send(at, "station.reassessment", c.caseId, ev.retestId, {
          evaluationVersion: ev.version,
          outcome: ev.result.outcome,
          summary: statusText,
          reviewDecision: action.decision,
          caseStatus: c.phase,
          simulated: true,
        } satisfies ReassessmentPayload);
      }
      // Traceability record of the human decision (NOT an action: the HUD ignores station.audit.*).
      send(at, "station.audit.review", c.caseId, null, {
        evaluationVersion: ev.version,
        decision: action.decision,
        reason,
        reviewer,
        decidedAt: at,
        caseStatus: c.phase,
        dispatchedEventIds: caseMessages(s, c.caseId).filter((m) => m.envelope.sentAt === at && !m.type.startsWith("station.audit.")).map((m) => m.eventId).slice(-10),
      });
      return { state: s, effects, error: null };
    }

    case "delivery": {
      const m = s.outbox.find((x) => x.eventId === action.eventId);
      if (!m) return { state, effects: [], error: null };
      m.delivery = action.ok ? "sent" : "failed";
      m.deliveryNote = action.note;
      m.adapterAt = action.ok ? action.at : null;
      if (!action.ok) log(action.at, "system", `发送失败：${OUT_LABEL[m.type]}（${action.note ?? "未知原因"}）`, m.caseId, m.eventId);
      return { state: s, effects, error: null };
    }

    case "view": {
      const c = s.cases[action.caseId];
      if (!c || c.viewedAt === action.at) return { state, effects: [], error: null };
      c.viewedAt = action.at;
      return { state: s, effects, error: null };
    }

    case "resend": {
      const m = s.outbox.find((x) => x.eventId === action.eventId);
      if (!m || m.delivery !== "failed") return fail("只有发送失败的消息可以重发");
      m.delivery = "queued";
      effects.push({ kind: "send", envelope: m.envelope });
      log(action.at, "out", `重发${OUT_LABEL[m.type]}（同一消息编号）`, m.caseId, m.eventId);
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
