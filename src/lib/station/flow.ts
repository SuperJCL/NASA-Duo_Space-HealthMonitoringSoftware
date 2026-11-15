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

import { FEATURES, type Evidence, type FeatureKey } from "./analysis";
import { allowedDecisions, caseMessages, isActionable, latest, messageKind, stageView, workbenchStage, type Case, type Decision, type Evaluation, type OutMessage, type Review, type StationState } from "./station";
import { alertNote, comparisonView, keyBasis } from "./views";

/**
 * done: finished · running: the station is processing · human: waiting for base staff ·
 * waiting: waiting for another party (HUD, astronaut, Trigger) · stopped: halted, with a reason ·
 * todo: not reached yet · skipped: not executed (an earlier step stopped or the case was closed).
 */
export type NodeState = "done" | "running" | "human" | "waiting" | "stopped" | "todo" | "skipped";
export type Owner = "系统" | "基地人员" | "HUD" | "宇航员" | "Trigger" | "无";

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
const POSTURE = { standing: "站姿", kneeling: "跪姿", seated: "坐姿" } as const;

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

const STAGE_LABEL = { quality: "信号质量", context: "情境与可比性", features: "指标比较", recommendation: "建议候选" } as const;
const REPORT_LABEL = { quality: "报告核查", context: "传感器数据", features: "指标比较", recommendation: "建议候选" } as const;
const NEXT_LABEL = { quality: "情境与可比性检查", context: "与个体基线比较指标", features: "生成建议候选", recommendation: "" } as const;

/** A report-check round: report received → report check → sensor data (limits) → no comparison → candidate. */
function reportRow(ev: Evaluation): FlowRow {
  const r = ev.report!;
  const stages = stageView(ev);
  const nodes: FlowNode[] = [
    node({
      id: `v${ev.version}:receive`,
      label: "报告接收",
      state: "done",
      owner: "宇航员",
      at: ev.startedAt,
      summary: `宇航员主动报告 · ${hhmmss(r.reportedAt).slice(0, 5)}`,
      input: [`内容：“${r.text}”`, `请求：${r.request ?? "无"}`, "来源：HUD（本地模拟扩展，不是共享契约消息）"],
      result: "已接收，自动开始报告核查（自述不是诊断）",
      next: "报告核查",
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
        owner: "系统",
        at: shown ? ev.completedAt : null,
        summary: state === "running" ? "处理中…" : state === "todo" ? "未到达" : id === "quality" ? "自述已记录，不作诊断" : id === "context" ? (state === "done" ? "有近期有效测量（仅参考）" : "无有效传感器数据") : id === "features" ? "未比较：报告不是测量" : (ev.result.candidate?.title ?? "无建议"),
        input: state === "todo" ? [] : res.evidence.map((e) => `${e.label}：${e.value}`),
        result: shown ? (id === "recommendation" ? `候选（未发布）：${ev.result.candidate?.title ?? "无"}。${ev.result.candidate?.rationale ?? ""}` : res.summary) : state === "skipped" ? res.summary : null,
        next: shown ? (id === "recommendation" ? "等待基地批准（建议在批准前不会发布）" : id === "quality" ? "查看该宇航员的传感器数据" : "仍生成建议候选：报告不会因缺少传感器数据被忽略") : null,
        reason: state === "stopped" ? res.summary : null,
        evidence: res.evidence,
      }),
    );
  });
  return { id: `v${ev.version}:analysis`, title: `第 ${ev.version} 轮核查 · 宇航员报告（v${ev.version}）`, lane: "main", nodes };
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
      label: "数据接收",
      state: "done",
      owner: "Trigger",
      at: ev.startedAt,
      summary: `${retest ? "复测数据" : "测量数据"} · ${hhmmss(o.capturedAt).slice(0, 5)}`,
      input: [
        `来源：${retest ? "复测结果（模拟）" : "Trigger（模拟）"}`,
        `标准化模拟测量：${p.label} · ${POSTURE[p.posture]} · ${p.glove === "eva-glove" ? "EVA 手套" : "不戴手套"}`,
        `数据时间 ${hhmmss(o.capturedAt)}${o.context.minutesIntoEva !== null ? ` · EVA 第 ${o.context.minutesIntoEva} 分钟` : ""}`,
        "内容：信号质量参数 + 3 项汇总指标（不是原始肌电波形）",
      ],
      result: retest ? "已接收并发出接收回执，自动开始第二轮模拟分析" : "已接收，自动开始模拟分析",
      next: "质量检查",
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
        ? ["3 项汇总指标：肌电中位频率、肌电幅值 RMS（sEMG）与握力（握力计，独立测量）", "比较对象：该宇航员的个体基线（同一标准协议）"]
        : id === "recommendation"
          ? ["前面各步骤的结果", "演示规则的建议模板"]
          : r.evidence.map((e) => `${e.label}：${e.value}${e.note ? `（${e.note}）` : ""}`);
    let summary = "未到达";
    if (state === "running") summary = "处理中…";
    else if (state === "skipped") summary = "未执行（前一步已停止）";
    else if (state === "done" || state === "stopped") {
      if (id === "quality") summary = state === "done" ? "合格 · 6 项参数在阈值内" : `不合格：${failed.join("、")}`;
      else if (id === "context") summary = state === "done" ? "条件一致，可比较" : `不可比：${failed.join("、")}不同`;
      else if (id === "features") summary = state === "stopped" ? "特征缺失，无法比较" : ev.result.outcome === "change-beyond-baseline" ? `${ev.result.comparisons.filter((x) => x.flagged).length} 项超出参考范围` : ev.result.outcome === "single-feature" ? "仅 1 项超出参考范围" : "均在参考范围内";
      else summary = ev.result.candidate?.title ?? "无建议";
    }
    const actionable = isActionable(ev.result.candidate);
    nodes.push(
      node({
        id: `v${ev.version}:${id}`,
        label: STAGE_LABEL[id],
        state,
        owner: "系统",
        at: state === "done" || state === "stopped" ? (ev.completedAt ?? null) : null,
        summary,
        input: state === "todo" ? [] : input,
        result: state === "done" || state === "stopped" ? (id === "recommendation" ? `候选（未发布）：${ev.result.candidate?.title ?? "无"}。${ev.result.candidate?.rationale ?? ""}` : r.summary) : null,
        next:
          state === "stopped"
            ? `停止后续分析；${ev.result.candidate ? `生成建议“${ev.result.candidate.title}”，等待基地审核` : "等待基地处理"}`
            : state === "done"
              ? id === "recommendation"
                ? actionable
                  ? "等待基地批准（建议在批准前不会发布）"
                  : "等待人工处理"
                : NEXT_LABEL[id]
              : null,
        reason: state === "stopped" ? r.summary : null,
        evidence: r.evidence,
        indicators: id === "features" && (state === "done" || state === "stopped") ? indicators(ev, before && comparisonView(c).kind === "paired" ? before : null) : [],
      }),
    );
  });
  return { id: `v${ev.version}:analysis`, title: `第 ${ev.version} 轮分析 · ${retest ? "复测数据" : "测量数据"}（v${ev.version}）`, lane: "main", nodes };
}

const DECISION_LABEL: Record<Decision, string> = { approve: "基地批准", reject: "驳回建议", close: "关闭事件", "keep-open": "继续关注" };

function reviewNode(ev: Evaluation, r: Review, i: number): FlowNode {
  return node({
    id: `v${ev.version}:review-${i}`,
    label: DECISION_LABEL[r.decision],
    state: "done",
    owner: "基地人员",
    at: r.at,
    summary: `${r.reviewer} · ${hhmmss(r.at).slice(0, 5)}`,
    input: ev.result.candidate ? [`建议：${ev.result.candidate.title}`, ev.result.candidate.rationale] : [],
    result: `理由：${r.reason}`,
    next: { approve: "派发提示与复测任务", reject: "等待人工处理（关闭或继续关注）", close: "处理完成：事件关闭", "keep-open": "事件继续关注，未结束" }[r.decision],
  });
}

/** The node where base staff must decide now (latest evaluation, case not closed). */
function pendingDecision(c: Case, ev: Evaluation, stopReason: string | null): FlowNode {
  const options = allowedDecisions(c);
  const stage = workbenchStage(c);
  const cand = ev.result.candidate;
  const actionable = isActionable(cand);
  const view = comparisonView(c);
  const relation = ev.version > 1 ? (view.kind === "paired" ? `原测量 v${view.before.version} 与复测 v${view.after.version} 都满足质量与可比条件：可以并列查看，不计算“改善幅度”。` : view.kind === "separate" ? view.why : null) : null;
  let label = actionable ? "等待基地批准" : "等待人工处理";
  let reason: string;
  let next: string;
  if (c.phase === "monitoring") {
    label = "继续关注中";
    reason = "已决定继续关注：事件未结束、告警保持；可随时关闭。";
    next = "关闭事件（告警解除）";
  } else if (c.phase === "rejected") {
    label = "等待人工处理";
    reason = "建议已驳回，未发送任何消息；事件仍未关闭。";
    next = "关闭事件，或继续关注";
  } else if (stage === "reassessed") {
    reason = ev.result.outcome === "within-baseline" ? "复测在参考范围内，但单次正常复测不能证明已恢复；原告警未关闭，需要人工处理。" : `重评结果：${ev.result.headline}；需要人工处理。`;
    next = actionable ? "再次批准复测，关闭事件，或继续关注" : "关闭事件（告警解除），或继续关注（告警保持）";
  } else if (actionable) {
    reason = stopReason ? `${stopReason} 需要基地人员审核建议：${cand!.title}。` : "模拟分析生成了建议；发布前必须由基地人员批准。";
    next = "批准后派发给 HUD；也可以驳回";
  } else {
    reason = "结果在参考范围内；由基地人员关闭事件或继续关注。";
    next = "关闭事件，或继续关注";
  }
  const primary: Decision | null = options.includes("approve") ? "approve" : options.includes("close") ? "close" : null;
  return node({
    id: `v${ev.version}:pending-${c.reviews.length}`,
    label,
    state: "human",
    owner: "基地人员",
    summary: c.phase === "monitoring" ? "事件未结束 · 告警保持" : (cand?.title ?? "需要人工决定"),
    input: [`本轮结果：${ev.result.headline}`, ...(cand ? [`建议（未发布）：${cand.title}`, cand.rationale] : [])],
    result: ev.version > 1 ? alertNote(c) : `关键依据：${keyBasis(ev.result).map((b) => b.replace(/。$/, "")).join("；")}。`,
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
  if (failed.length) return { state: "stopped", owner: "基地人员", summary: `发送失败 ${failed.length}/${msgs.length}`, reason: `发送失败：${failed[0].deliveryNote ?? "未知原因"}。需要基地人员重发（同一条消息）。`, result: null, action: { kind: "resend", eventIds: failed.map((m) => m.eventId) }, at: null };
  if (msgs.some((m) => m.delivery === "queued")) return { state: "running", owner: "系统", summary: "发出中…", reason: null, result: null, action: null, at: null };
  return {
    state: "done",
    owner: "系统",
    summary: mock ? `已发出 ${msgs.length} 条 · 仅本地模拟` : `已发出 ${msgs.length} 条`,
    reason: null,
    result: mock ? "已交给本地模拟通道：只表示基站已发出，不代表 HUD 已收到。" : "已交给传输适配层：不代表 HUD 已收到。",
    action: null,
    at: msgs.map((m) => m.adapterAt ?? "").sort().at(-1) || null,
  };
};

const MSG_TITLE = (m: OutMessage) => (m.type === "station.notice.approved" ? "提示（行动消息）" : m.type === "station.retest.requested" ? "复测任务（行动消息）" : "状态通知");
const msgText = (m: OutMessage) => {
  const p = m.envelope.payload as { text?: string; instructions?: string; summary?: string };
  return p.text ?? p.instructions ?? p.summary ?? "";
};

/** Approval → sent → HUD receipt → astronaut confirmation → retest result (one retest round). */
function dispatchRow(s: StationState, c: Case, ev: Evaluation, approve: Review | null, mock: boolean, pending: FlowNode | null): FlowRow {
  const nodes: FlowNode[] = [];
  const title = `审核与派发 · 复测 ${c.retests.filter((r) => r.requestedFromVersion <= ev.version).length || c.retests.length + 1}`;
  if (pending) {
    nodes.push(pending);
    for (const [id, label] of [["send", "复测已发出"], ["hud", "HUD 接收"], ["crew", "宇航员确认"], ["result", "等待复测结果"]] as const) nodes.push(node({ id: `v${ev.version}:${id}`, label, state: "todo", owner: "无", summary: "未到达" }));
    return { id: `v${ev.version}:dispatch`, title, lane: "main", nodes };
  }
  const msgs = caseMessages(s, c.caseId).filter((m) => messageKind(m.type) === "action" && (m.envelope.payload as { evaluationVersion?: number }).evaluationVersion === ev.version);
  const rt = c.retests.find((r) => r.requestedFromVersion === ev.version) ?? null;
  const closed = c.phase === "closed";
  const earlyClose = closed ? { kind: "decide" as const, options: [] as Decision[], primary: null } : workbenchStage(c) === "dispatched" ? { kind: "decide" as const, options: allowedDecisions(c), primary: null } : null;
  nodes.push(reviewNode(ev, approve!, 0));
  const send = delivery(msgs, mock);
  nodes.push(node({ id: `v${ev.version}:send`, label: "复测已发出", ...send, input: msgs.map((m) => `${MSG_TITLE(m)}：${msgText(m)}`), next: send.state === "done" ? "等待 HUD 接收回执" : null, messages: msgs }));
  const sent = send.state === "done";

  const received = msgs.filter((m) => m.hudReceivedAt).length;
  nodes.push(
    node({
      id: `v${ev.version}:hud`,
      label: "HUD 接收",
      state: !sent ? "todo" : received === msgs.length ? "done" : "waiting",
      owner: "HUD",
      at: received === msgs.length ? (msgs.map((m) => m.hudReceivedAt ?? "").sort().at(-1) ?? null) : null,
      summary: !sent ? "未到达" : `已接收 ${received}/${msgs.length}`,
      input: msgs.map((m) => `${MSG_TITLE(m)}：${m.hudReceivedAt ? `已接收 ${hhmmss(m.hudReceivedAt)}` : "未收到接收回执"}`),
      result: received === msgs.length ? "HUD 设备已接收（不等于宇航员已确认）" : null,
      next: "等待宇航员确认",
      reason: sent && received < msgs.length ? (closed ? "未收到接收回执（事件已关闭，不再等待）" : "等待 HUD 发送接收回执（不会根据时间推断）。") : null,
      messages: msgs,
    }),
  );

  const acked = msgs.filter((m) => m.feedback === "acknowledged").length;
  const deferred = msgs.find((m) => m.feedback === "deferred");
  nodes.push(
    node({
      id: `v${ev.version}:crew`,
      label: "宇航员确认",
      state: !sent ? "todo" : deferred ? "stopped" : acked === msgs.length ? "done" : "waiting",
      owner: deferred ? "基地人员" : "宇航员",
      at: acked === msgs.length ? (msgs.map((m) => m.feedbackAt ?? "").sort().at(-1) ?? null) : null,
      summary: !sent ? "未到达" : deferred ? "宇航员暂缓" : `已确认 ${acked}/${msgs.length}`,
      input: msgs.map((m) => `${MSG_TITLE(m)}：${{ none: "未反馈", acknowledged: `已确认 ${hhmmss(m.feedbackAt)}`, deferred: `暂缓：${m.feedbackNote ?? ""}` }[m.feedback]}`),
      result: acked === msgs.length ? "宇航员已在 HUD 上确认提示与复测任务" : null,
      next: deferred ? "等待宇航员再次确认；基地人员也可以提前关闭事件" : "等待宇航员按标准协议复测",
      reason: deferred ? `宇航员暂缓：${deferred.feedbackNote ?? "未说明原因"}。可等待宇航员再次确认，或由基地人员提前关闭事件。` : sent && acked < msgs.length && !closed ? "等待宇航员在 HUD 上确认（不会根据时间推断）。" : null,
      messages: msgs,
    }),
  );

  const resultEv = rt?.resultVersion ? c.evaluations.find((e) => e.version === rt.resultVersion) : null;
  const receipt = resultEv ? caseMessages(s, c.caseId).find((m) => m.type === "station.receipt" && (m.envelope.payload as { receivedEventId?: string }).receivedEventId === resultEv.sourceEventId) : null;
  const resultState: NodeState = rt?.status === "result-received" ? "done" : closed ? "skipped" : !sent || deferred ? "todo" : "waiting";
  nodes.push(
    node({
      id: `v${ev.version}:result`,
      label: resultState === "done" ? "复测结果" : "等待复测结果",
      state: resultState,
      owner: rt?.status === "completed" ? "Trigger" : "宇航员",
      at: resultEv?.startedAt ?? null,
      summary: resultState === "done" ? `已接收 → 第 ${rt!.resultVersion} 轮分析` : resultState === "skipped" ? "事件已关闭，不再需要" : rt?.status === "completed" ? "宇航员报告已完成，等待数据" : resultState === "waiting" ? "等待复测数据" : "未到达",
      input: rt ? [`复测任务：按标准协议复测一次（${rt.status === "result-received" ? "已完成" : "进行中"}）`, ...(rt.completedAt ? [`宇航员报告完成：${hhmmss(rt.completedAt)}（可选扩展消息）`] : [])] : [],
      result: resultState === "done" ? `复测数据已接收；接收回执${receipt ? (receipt.delivery === "failed" ? "发送失败" : "已发出") : "未发出"}。第一轮评估保留不变。` : null,
      next: resultState === "done" ? "自动开始第二轮模拟分析" : null,
      reason: resultState === "waiting" ? (rt?.status === "completed" ? "宇航员报告已完成复测，等待复测数据回传。" : "等待宇航员按标准协议复测并回传结果（不会根据时间推断）。") : null,
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
      label: "处理完成",
      state: close ? "done" : "todo",
      owner: "无",
      at: close?.at ?? null,
      summary: close ? "事件已关闭 · 告警已人工解除" : "未到达（事件未关闭）",
      result: close ? `由 ${close.reviewer} 关闭：${close.reason}` : null,
      next: close ? "无（状态通知的送达见下方单独一行）" : null,
    }),
  );
  return { id: `v${ev.version}:handling`, title: "人工处理", lane: "main", nodes };
}

/** Status notifications (close / keep watching) and their delivery, kept apart from the handling. */
function noticeRow(s: StationState, c: Case, mock: boolean): FlowRow | null {
  const msgs = caseMessages(s, c.caseId).filter((m) => messageKind(m.type) === "status");
  if (!msgs.length) return null;
  const nodes: FlowNode[] = [];
  msgs.forEach((m, i) => {
    const caseStatus = (m.envelope.payload as { caseStatus?: string }).caseStatus;
    const what = caseStatus === "closed" ? "关闭" : caseStatus === "monitoring" ? "继续关注" : (caseStatus ?? "");
    const d = delivery([m], mock);
    nodes.push(node({ id: `n${i}:send`, label: `状态通知：${what}`, ...d, summary: d.state === "done" ? (mock ? "已发出 · 仅本地模拟" : "已发出") : d.summary, input: [`内容：${msgText(m)}`, "类型：状态通知（仅告知事件状态，不是行动）"], next: d.state === "done" ? "等待 HUD 接收回执" : null, messages: [m] }));
    nodes.push(
      node({
        id: `n${i}:hud`,
        label: "HUD 接收",
        state: d.state !== "done" ? "todo" : m.hudReceivedAt ? "done" : "waiting",
        owner: "HUD",
        at: m.hudReceivedAt,
        summary: d.state !== "done" ? "未到达" : m.hudReceivedAt ? `已接收 ${hhmmss(m.hudReceivedAt).slice(0, 5)}` : "等待接收回执",
        reason: d.state === "done" && !m.hudReceivedAt ? "等待 HUD 发送接收回执（不会根据时间推断）。" : null,
        result: m.hudReceivedAt ? "HUD 设备已接收状态通知" : null,
        messages: [m],
      }),
    );
  });
  return { id: "notice", title: "状态通知送达（与处理完成分开）", lane: "notice", nodes };
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
    ? "处理已完成：事件由基地人员关闭。"
    : currentNode.state === "running"
      ? currentNode.label === "复测已发出"
        ? "基站正在发出消息。"
        : "系统正在进行模拟分析（确定性规则，未调用模型）。"
      : (currentNode.reason ?? "需要处理。");
  const lastNotice = notice?.nodes.filter((n) => n.id.endsWith(":hud")).at(-1);
  const lastNoticeSend = notice?.nodes.filter((n) => n.id.endsWith(":send")).at(-1);
  const noticePending = lastNoticeSend?.state === "stopped" ? "状态通知发送失败，需要重发" : lastNotice && lastNotice.state !== "done" ? "状态通知已发出，等待 HUD 接收回执" : null;
  return {
    rows,
    current: { rowId: lastRow.id, node: currentNode },
    where: finished ? "人工处理 · 处理完成" : `${lastRow.title.split(" · ")[0]} · ${currentNode.label}`,
    why,
    who: finished ? "无" : currentNode.owner,
    finished,
    noticePending,
  };
}
