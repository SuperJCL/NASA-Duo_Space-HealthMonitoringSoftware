"use client";

import { useState } from "react";
import { allowedDecisions, caseMessages, latest, messageKind, nextOwner, stageView, statusNoticeText, workbenchStage, type Case, type Decision, type OutMessage, type StationState } from "@/lib/station/station";
import type { NoticePayload, ReassessmentPayload, RetestRequestPayload } from "@/lib/station/protocol";
import { flowSteps } from "@/lib/station/views";
import type { StationApi } from "./useStation";
import { DECISION_TEXT, Label, OUT_TEXT, stageTitle, time } from "./ui";

const STEP_STYLE = {
  done: "border-[var(--mg-ok)] text-[var(--mg-ok)]",
  current: "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] font-semibold text-[var(--mg-text)]",
  todo: "border-[var(--mg-line)] text-[var(--mg-faint)]",
  skipped: "border-dashed border-[var(--mg-line)] text-[var(--mg-faint)] line-through",
} as const;

/** The six demo steps of the selected event (or "waiting for an observation"). */
function FlowStepper({ c }: { c: Case | null }) {
  return (
    <ol className="flex flex-wrap gap-1" aria-label="处理流程" data-testid="station-flow">
      {flowSteps(c).map((s, i) => (
        <li key={s.id} aria-current={s.state === "current" ? "step" : undefined} className={`rounded-md border px-1.5 py-0.5 text-[11px] ${STEP_STYLE[s.state]}`} data-step={s.id} data-state={s.state} title={s.state === "skipped" ? "此事件未经过这一步" : undefined}>
          {`${s.state === "done" ? "✓" : i + 1} ${s.label}`}
        </li>
      ))}
    </ol>
  );
}

/**
 * Right column: only what the base staff must handle NOW for the selected event, switched by its
 * stage (review → dispatched → reassessing → reassessed → decided / closed).
 */
export function ActionPanel({ c, state, api, mock }: { c: Case | null; state: StationState; api: StationApi; mock: boolean }) {
  if (!c) {
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="station-action" data-stage="none">
        <FlowStepper c={null} />
        <div>
          <Label>{"当前处理"}</Label>
          <p className="text-[17px] font-semibold" data-testid="station-stage-title">
            {state.run ? "等待观测" : "等待场景开始"}
          </p>
          <p className="mt-1 text-[13px] text-[var(--mg-dim)]">{state.run ? "此阶段无需操作。收到标准化模拟测量后，基站会自动开始模拟分析。" : "此阶段无需操作。Trigger 接入前，可在地址后加 ?dev=1 打开开发测试入口。"}</p>
        </div>
      </div>
    );
  }
  const stage = workbenchStage(c);
  const ev = latest(c);
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="station-action" data-stage={stage}>
      <FlowStepper c={c} />
      <div>
        <Label>{"当前处理"}</Label>
        <p className="text-[17px] font-semibold" data-testid="station-stage-title">
          {stageTitle(c, stage)}
        </p>
        <p className="text-[13px] text-[var(--mg-coral)]">{nextOwner(c)}</p>
      </div>
      {stage === "analysing" || stage === "reassessing" ? <Progress c={c} state={state} /> : null}
      {stage === "review" || stage === "reassessed" ? <ReviewCard key={`${c.caseId}-${ev.version}-${c.phase}`} c={c} api={api} /> : null}
      {stage === "dispatched" ? <Dispatched c={c} state={state} api={api} mock={mock} /> : null}
      {stage === "decided" ? <Decided c={c} state={state} api={api} mock={mock} /> : null}
      {stage === "closed" ? <Closed c={c} state={state} api={api} mock={mock} /> : null}
    </div>
  );
}

function Progress({ c, state }: { c: Case; state: StationState }) {
  const ev = latest(c);
  const stages = stageView(ev);
  const running = stages.findIndex((s) => s.status === "running");
  const receipt = ev.trigger === "retest" ? state.outbox.find((m) => m.type === "station.receipt" && m.caseId === c.caseId && (m.envelope.payload as { receivedEventId?: string }).receivedEventId === ev.sourceEventId) : null;
  return (
    <div className="flex flex-col gap-1" data-testid="station-progress">
      <p className="text-[13px]">
        {ev.trigger === "retest"
          ? `已收到复测结果，${receipt ? (receipt.delivery === "failed" ? "接收回执发送失败" : "已发出接收回执") : "未发出接收回执"}；正在重新评估。`
          : "已收到标准化模拟测量，正在模拟分析；完成后才会生成待审候选。"}
      </p>
      <p className="text-[12px] text-[var(--mg-dim)]">{running >= 0 ? `进度：第 ${running + 1}/${stages.length} 步 · ${stages[running].label}（详情见中栏）` : "进度：收尾中"}</p>
      <p className="text-[12px] text-[var(--mg-faint)]">{"此阶段无需操作。"}</p>
    </div>
  );
}

/** What a decision does, shown before confirming: messages (action / status / none) and the resulting case status. */
function DecisionEffect({ c, decision, actionCount }: { c: Case; decision: Decision; actionCount: number }) {
  const status = statusNoticeText(c, decision);
  const effect: Record<Decision, string> = {
    approve: `发送 ${actionCount} 条行动消息（内容见上方）。事件进入“已派发等待反馈”，下一步由宇航员确认并复测。`,
    reject: "不发送任何消息。事件保持未关闭、告警保持；之后由基地人员关闭事件或保留关注。",
    close: "事件关闭，告警解除；不发送行动消息。",
    "keep-open": "事件不关闭，告警保持；不发送行动消息。之后由基地人员随时关闭。",
  };
  return (
    <div className="rounded-lg border border-[var(--mg-line)] p-2 text-[12px]" data-testid="station-decision-effect" data-decision={decision}>
      <p className="text-[var(--mg-dim)]">{`选择“${DECISION_TEXT[decision]}”后：${effect[decision]}`}</p>
      {status ? (
        <div className="mt-1.5 rounded-md bg-[rgba(255,255,255,0.04)] p-2" data-testid="station-outgoing-status">
          <p className="text-[11px] text-[var(--mg-faint)]">{"将发布的状态通知（仅告知 HUD 事件状态，不是行动）："}</p>
          <p className="text-[13px] text-[var(--mg-text)]">{status}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Choose a decision, see what it publishes, give a reason and a reviewer, then confirm. */
function DecisionForm({ c, api, options, actionCount = 0 }: { c: Case; api: StationApi; options: Decision[]; actionCount?: number }) {
  const ev = latest(c);
  const [choice, setChoice] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [reviewer, setReviewer] = useState("基地值班员");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="station-review">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="审核决定">
        {options.map((d) => (
          <button key={d} type="button" aria-pressed={choice === d} onClick={() => setChoice(d)} className={`min-h-9 rounded-lg border px-3 text-[13px] ${choice === d ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)]" : "border-[var(--mg-line-strong)]"}`} data-testid={`station-decide-${d}`}>
            {DECISION_TEXT[d]}
          </button>
        ))}
      </div>
      {choice ? <DecisionEffect c={c} decision={choice} actionCount={actionCount} /> : null}
      <label className="flex flex-col gap-0.5 text-[12px] text-[var(--mg-dim)]">
        {"理由（必填，记录在案）"}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1 text-[13px] text-[var(--mg-text)]" data-testid="station-review-reason" />
      </label>
      <label className="flex items-center gap-2 text-[12px] text-[var(--mg-dim)]">
        {"审核人"}
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1 text-[13px] text-[var(--mg-text)]" data-testid="station-reviewer" />
      </label>
      <button
        type="button"
        disabled={!choice}
        onClick={() => choice && setError(api.review(c.caseId, ev.version, choice, reason, reviewer))}
        className="min-h-10 rounded-xl bg-[var(--mg-coral)] px-4 text-[14px] font-semibold text-[#1a0f0c] disabled:opacity-40"
        data-testid="station-review-confirm"
      >
        {choice ? (choice === "approve" ? `确认批准并发送 ${actionCount} 条行动消息` : `确认：${DECISION_TEXT[choice]}`) : "先选择一个决定"}
      </button>
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--mg-caution)]" data-testid="station-review-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const RULE = "只有“批准并发送”会向 HUD 发送行动消息；关闭事件、保留关注只发布状态通知；驳回不发送任何消息。";

function ReviewCard({ c, api }: { c: Case; api: StationApi }) {
  const ev = latest(c);
  const cand = ev.result.candidate;
  const options = allowedDecisions(c);
  const sends = cand?.kind === "notice-and-retest" ? 2 : cand?.kind === "retest" ? 1 : 0;
  return (
    <div className="flex flex-col gap-3">
      {ev.version > 1 ? (
        <p className="text-[12px] text-[var(--mg-dim)]" data-testid="station-reassessed-note">
          {ev.result.outcome === "within-baseline"
            ? "请决定：关闭事件（告警解除），或保留关注（告警保持）。"
            : "请根据重评结果决定：再次批准复测，关闭事件，或保留关注。"}
        </p>
      ) : null}
      {cand ? (
        <div className="rounded-xl border border-dashed border-[var(--mg-coral)] p-3" data-testid="station-candidate" data-kind={cand.kind}>
          <p className="text-[12px] font-semibold text-[var(--mg-coral)]">{"模拟分析的建议候选 · 未发布"}</p>
          <p className="font-medium">{cand.title}</p>
          <p className="text-[12px] text-[var(--mg-dim)]">{cand.rationale}</p>
          {sends ? (
            <div className="mt-2 flex flex-col gap-2" data-testid="station-outgoing">
              <p className="text-[12px] text-[var(--mg-faint)]">{`批准后发送给 HUD 的行动消息（${sends} 条，实际内容）：`}</p>
              {cand.kind === "notice-and-retest" ? (
                <div className="rounded-lg bg-[rgba(255,255,255,0.04)] p-2 text-[13px]" data-testid="station-outgoing-notice">
                  <p className="text-[11px] text-[var(--mg-faint)]">{"① 提示 · 需宇航员确认"}</p>
                  <p>{cand.notice.text}</p>
                </div>
              ) : null}
              {cand.kind !== "record-only" ? (
                <div className="rounded-lg bg-[rgba(255,255,255,0.04)] p-2 text-[13px]" data-testid="station-outgoing-retest">
                  <p className="text-[11px] text-[var(--mg-faint)]">{`${cand.kind === "notice-and-retest" ? "②" : "①"} 复测任务 · 需宇航员确认并完成`}</p>
                  <p>{cand.retest.instructions}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-[12px]" data-testid="station-outgoing-none">
              {"关闭事件或保留关注时，只发布一条状态通知；选择决定后可预览全文。"}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-[var(--mg-caution)]">{"没有建议候选（分析未完成）；不发送行动消息。"}</p>
      )}
      <DecisionForm c={c} api={api} options={options} actionCount={sends} />
      <p className="text-[11px] text-[var(--mg-faint)]">{RULE}</p>
    </div>
  );
}

function Step({ ok, label, value, testId, neutral = false }: { ok: boolean | null; label: string; value: string; testId: string; neutral?: boolean }) {
  // `neutral`: a local mock hand-off is shown as done but NOT as a delivery success.
  const icon = ok === null ? "○" : ok ? (neutral ? "·" : "✓") : "!";
  const cls = ok === null || neutral ? "text-[var(--mg-faint)]" : ok ? "text-[var(--mg-ok)]" : "text-[var(--mg-caution)]";
  return (
    <li className="flex gap-2 text-[12px]" data-testid={testId} data-ok={ok === null ? "pending" : ok ? "yes" : "no"} data-mock={neutral ? "true" : undefined}>
      <span aria-hidden className={`w-4 shrink-0 text-center ${cls}`}>
        {icon}
      </span>
      <span className="text-[var(--mg-dim)]">{label}</span>
      <span className="ml-auto text-right">{value}</span>
    </li>
  );
}

/** One station message and its separate statuses: sent by the station, HUD receipt, astronaut confirmation (actions only). */
function MessageStatus({ m, api, mock, testId }: { m: OutMessage; api: StationApi; mock: boolean; testId: string }) {
  const p = m.envelope.payload as Partial<NoticePayload & RetestRequestPayload & ReassessmentPayload>;
  const action = messageKind(m.type) === "action";
  return (
    <li className="rounded-xl border border-[var(--mg-line)] p-2.5" data-testid={testId} data-case-status={p.caseStatus}>
      <p className="text-[13px] font-medium">{action ? OUT_TEXT[m.type] : "状态通知（仅告知，不是行动）"}</p>
      <p className="mt-0.5 text-[12px] text-[var(--mg-dim)]">{p.text ?? p.instructions ?? p.summary ?? ""}</p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        <Step
          ok={m.delivery === "sent" ? true : m.delivery === "failed" ? false : null}
          neutral={mock && m.delivery === "sent"}
          label="1 基站已发出"
          value={m.delivery === "failed" ? "发送失败" : m.delivery === "queued" ? "发出中" : mock ? `仅本地模拟 · ${time(m.adapterAt)}` : time(m.adapterAt)}
          testId="step-adapter"
        />
        <Step ok={m.hudReceivedAt ? true : null} label="2 HUD 已接收" value={m.hudReceivedAt ? time(m.hudReceivedAt) : "未收到接收回执"} testId="step-hud" />
        {action ? <Step ok={m.feedback === "acknowledged" ? true : m.feedback === "deferred" ? false : null} label="3 宇航员确认" value={m.feedback === "acknowledged" ? `已确认 ${time(m.feedbackAt)}` : m.feedback === "deferred" ? `暂缓：${m.feedbackNote ?? ""}` : "未反馈"} testId="step-crew" /> : null}
      </ul>
      {m.delivery === "failed" ? (
        <button type="button" onClick={() => api.resend(m.eventId)} className="mt-1.5 min-h-8 rounded-lg border border-[var(--mg-caution)] px-2 text-[12px] text-[var(--mg-caution)]" data-testid={`station-resend-${m.eventId}`}>
          {"重发同一条消息"}
        </button>
      ) : null}
    </li>
  );
}

const MOCK_NOTE = "演示模式：消息只交给本地模拟通道，不代表 HUD 已收到。第 2、3 步只在收到 HUD 回传后更新，不会自动推断。";

function Dispatched({ c, state, api, mock }: { c: Case; state: StationState; api: StationApi; mock: boolean }) {
  const lastApproval = [...c.reviews].reverse().find((r) => r.decision === "approve");
  const msgs = caseMessages(state, c.caseId).filter((m) => messageKind(m.type) === "action" && (m.envelope.payload as { evaluationVersion?: number }).evaluationVersion === lastApproval?.version);
  const rt = c.retests.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {lastApproval ? <p className="text-[12px] text-[var(--mg-dim)]">{`${lastApproval.reviewer} 于 ${time(lastApproval.at)} 批准（v${lastApproval.version}）：${lastApproval.reason}`}</p> : null}
      <ul className="flex flex-col gap-2">
        {msgs.map((m) => (
          <MessageStatus key={m.eventId} m={m} api={api} mock={mock} testId={`station-dispatch-${m.type === "station.notice.approved" ? "notice" : "retest"}`} />
        ))}
      </ul>
      {rt ? (
        <p className="text-[13px]" data-testid="station-retest-list" data-status={rt.status}>
          {`复测任务：${{ requested: "已请求，等待结果", acknowledged: "宇航员已确认，等待结果", deferred: "宇航员暂缓", completed: "宇航员报告已完成，等待复测数据", "result-received": `已收到结果 → v${rt.resultVersion}` }[rt.status]}`}
        </p>
      ) : null}
      {mock ? <p className="text-[11px] text-[var(--mg-faint)]">{MOCK_NOTE}</p> : null}
      <details className="rounded-xl border border-[var(--mg-line)] px-3 py-2">
        <summary className="cursor-pointer text-[12px] text-[var(--mg-dim)]">{"其他操作（提前关闭事件）"}</summary>
        <div className="mt-2">
          <DecisionForm c={c} api={api} options={allowedDecisions(c)} />
        </div>
      </details>
    </div>
  );
}

/** The latest status notification published for the case (close / keep-open), with its delivery statuses. */
function StatusSent({ c, state, api, mock }: { c: Case; state: StationState; api: StationApi; mock: boolean }) {
  const m = [...caseMessages(state, c.caseId)].reverse().find((x) => messageKind(x.type) === "status");
  if (!m) return null;
  return (
    <ul className="flex flex-col gap-2" data-testid="station-status-sent">
      <MessageStatus m={m} api={api} mock={mock} testId="station-status-message" />
    </ul>
  );
}

function Decided({ c, state, api, mock }: { c: Case; state: StationState; api: StationApi; mock: boolean }) {
  const last = c.reviews.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {last ? <p className="text-[13px]" data-testid="station-decision">{`${DECISION_TEXT[last.decision]} · ${last.reviewer} · ${time(last.at)}：${last.reason}`}</p> : null}
      {c.phase === "rejected" ? (
        <p className="text-[12px] text-[var(--mg-dim)]">{"候选已驳回，未发送任何消息。事件仍未关闭、告警保持：请关闭事件或保留关注。"}</p>
      ) : (
        <>
          <p className="text-[12px] text-[var(--mg-dim)]">{"保留关注：事件不关闭、告警保持，已向 HUD 发布状态通知（不是行动）。之后可随时关闭。"}</p>
          <StatusSent c={c} state={state} api={api} mock={mock} />
        </>
      )}
      <DecisionForm c={c} api={api} options={allowedDecisions(c)} />
      <p className="text-[11px] text-[var(--mg-faint)]">{RULE}</p>
    </div>
  );
}

function Closed({ c, state, api, mock }: { c: Case; state: StationState; api: StationApi; mock: boolean }) {
  const last = c.reviews.at(-1);
  const ev = latest(c);
  return (
    <div className="flex flex-col gap-2" data-testid="station-closed">
      <p className="text-[13px] font-medium" data-testid="station-decision">{last ? `由 ${last.reviewer} 于 ${time(last.at)} 关闭（v${last.version}）` : "已关闭"}</p>
      {last ? <p className="text-[13px]">{`理由：${last.reason}`}</p> : null}
      <p className="text-[12px] text-[var(--mg-dim)]">{`最终评估 v${ev.version}：${ev.result.headline}`}</p>
      <StatusSent c={c} state={state} api={api} mock={mock} />
      <div>
        <p className="text-[12px] text-[var(--mg-faint)]">{`处理记录（${c.reviews.length} 次人工决定，${c.retests.length} 个复测任务）`}</p>
        <ol className="mt-0.5 space-y-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="station-review-history">
          {c.reviews.map((r, i) => (
            <li key={i}>{`v${r.version} · ${DECISION_TEXT[r.decision]} · ${r.reviewer} · ${time(r.at)}：${r.reason}`}</li>
          ))}
        </ol>
      </div>
      <p className="text-[11px] text-[var(--mg-faint)]">{"事件已关闭：没有待审核内容。已向 HUD 发布关闭状态通知（不是行动），之后不再发送新的行动消息。"}</p>
      {mock ? <p className="text-[11px] text-[var(--mg-faint)]">{MOCK_NOTE}</p> : null}
    </div>
  );
}
