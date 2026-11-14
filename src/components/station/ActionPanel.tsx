"use client";

import { useState } from "react";
import { allowedDecisions, latest, nextOwner, stageView, workbenchStage, type Case, type Decision, type OutMessage, type StationState } from "@/lib/station/station";
import type { NoticePayload, RetestRequestPayload } from "@/lib/station/protocol";
import { DECISION_TEXT, Label, OUT_TEXT, STAGE_TEXT, time } from "./ui";
import type { StationApi } from "./useStation";

/**
 * Right column: only what the base staff must handle NOW for the selected event, switched by its
 * stage (review → dispatched → reassessing → reassessed → decided / closed).
 */
export function ActionPanel({ c, state, api }: { c: Case | null; state: StationState; api: StationApi }) {
  if (!c) {
    return (
      <div className="p-4" data-testid="station-action" data-stage="none">
        <Label>{"当前处理"}</Label>
        <p className="mt-1 text-[14px] text-[var(--mg-dim)]">{state.run ? "暂无需要处理的事件。" : "等待场景开始。Trigger 接入前，可在地址后加 ?dev=1 打开开发测试入口。"}</p>
      </div>
    );
  }
  const stage = workbenchStage(c);
  const ev = latest(c);
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="station-action" data-stage={stage}>
      <div>
        <Label>{"当前处理"}</Label>
        <p className="text-[17px] font-semibold" data-testid="station-stage-title">
          {STAGE_TEXT[stage]}
        </p>
        <p className="text-[13px] text-[var(--mg-coral)]">{nextOwner(c)}</p>
      </div>
      {stage === "analysing" || stage === "reassessing" ? <Progress c={c} state={state} /> : null}
      {stage === "review" || stage === "reassessed" ? <ReviewCard key={`${c.caseId}-${ev.version}-${c.phase}`} c={c} api={api} /> : null}
      {stage === "dispatched" ? <Dispatched c={c} state={state} api={api} /> : null}
      {stage === "decided" ? <Decided c={c} api={api} /> : null}
      {stage === "closed" ? <Closed c={c} /> : null}
    </div>
  );
}

function Progress({ c, state }: { c: Case; state: StationState }) {
  const ev = latest(c);
  const receipt = ev.trigger === "retest" ? state.outbox.find((m) => m.type === "station.receipt" && m.caseId === c.caseId && (m.envelope.payload as { receivedEventId?: string }).receivedEventId === ev.sourceEventId) : null;
  return (
    <div className="flex flex-col gap-2" data-testid="station-progress">
      {ev.trigger === "retest" ? (
        <p className="text-[13px]">{`收到复测结果（${ev.retestId}），${receipt ? `已发出接收回执：${receipt.delivery === "sent" ? "已交给适配层" : receipt.delivery === "failed" ? "发送失败" : "发送中"}` : "未发出接收回执"}。`}</p>
      ) : (
        <p className="text-[13px]">{"收到模拟观测，模拟分析进行中；分析完成后才会生成待审候选。"}</p>
      )}
      <ol className="flex flex-col gap-1 text-[13px]">
        {stageView(ev).map((st) => (
          <li key={st.id} data-status={st.status} className={st.status === "running" ? "animate-pulse text-[var(--mg-cyan)]" : st.status === "waiting" ? "text-[var(--mg-faint)]" : ""}>
            {`${st.status === "done" ? "✓" : st.status === "running" ? "◐" : st.status === "waiting" ? "○" : st.status === "skipped" ? "–" : "■"} ${st.label}`}
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-[var(--mg-faint)]">{"此阶段无需操作。"}</p>
    </div>
  );
}

/** Choose a decision, give a reason and a reviewer, then confirm. */
function DecisionForm({ c, api, options, confirmLabel }: { c: Case; api: StationApi; options: Decision[]; confirmLabel?: (d: Decision) => string }) {
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
        {choice ? (confirmLabel?.(choice) ?? `确认：${DECISION_TEXT[choice]}`) : "先选择一个决定"}
      </button>
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--mg-caution)]" data-testid="station-review-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReviewCard({ c, api }: { c: Case; api: StationApi }) {
  const ev = latest(c);
  const cand = ev.result.candidate;
  const options = allowedDecisions(c);
  const sends = cand?.kind === "notice-and-retest" ? 2 : cand?.kind === "retest" ? 1 : 0;
  return (
    <div className="flex flex-col gap-3">
      {ev.version > 1 ? (
        <p className="text-[12px] text-[var(--mg-dim)]" data-testid="station-reassessed-note">
          {ev.result.outcome === "within-baseline" ? "复测回到个体基线范围。单次正常结果不能证明已经恢复：请决定关闭事件或保留关注。" : "请根据重评结果决定后续处理。"}
        </p>
      ) : null}
      {cand ? (
        <div className="rounded-xl border border-dashed border-[var(--mg-coral)] p-3" data-testid="station-candidate" data-kind={cand.kind}>
          <p className="text-[12px] font-semibold text-[var(--mg-coral)]">{"模拟分析的建议候选 · 未发布"}</p>
          <p className="font-medium">{cand.title}</p>
          <p className="text-[12px] text-[var(--mg-dim)]">{cand.rationale}</p>
          {sends ? (
            <div className="mt-2 flex flex-col gap-2" data-testid="station-outgoing">
              <p className="text-[12px] text-[var(--mg-faint)]">{`批准后将发送给 HUD 的实际内容（${sends} 条）：`}</p>
              {cand.kind === "notice-and-retest" ? (
                <div className="rounded-lg bg-[rgba(255,255,255,0.04)] p-2 text-[13px]" data-testid="station-outgoing-notice">
                  <p className="text-[11px] text-[var(--mg-faint)]">{"① 提示 · station.notice.approved"}</p>
                  <p>{cand.notice.text}</p>
                </div>
              ) : null}
              {cand.kind !== "record-only" ? (
                <div className="rounded-lg bg-[rgba(255,255,255,0.04)] p-2 text-[13px]" data-testid="station-outgoing-retest">
                  <p className="text-[11px] text-[var(--mg-faint)]">{`${cand.kind === "notice-and-retest" ? "②" : "①"} 复测任务 · station.retest.requested`}</p>
                  <p>{cand.retest.instructions}</p>
                  <p className="text-[11px] text-[var(--mg-faint)]">{`协议 ${cand.retest.protocol.id} · 附带评估版本 v${ev.version}、审核人和理由`}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-[12px]" data-testid="station-outgoing-none">
              {"不会向 HUD 发送任何内容。"}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-[var(--mg-caution)]">{"没有建议候选（分析未完成）；不会向 HUD 发送内容。"}</p>
      )}
      <DecisionForm c={c} api={api} options={options} confirmLabel={(d) => (d === "approve" ? `确认批准并发送 ${sends} 条消息` : `确认：${DECISION_TEXT[d]}`)} />
      <p className="text-[11px] text-[var(--mg-faint)]">{"驳回、保留复核、关闭或保留关注都不会向 HUD 发送行动。"}</p>
    </div>
  );
}

function Step({ ok, label, value, testId }: { ok: boolean | null; label: string; value: string; testId: string }) {
  return (
    <li className="flex gap-2 text-[12px]" data-testid={testId} data-ok={ok === null ? "pending" : ok ? "yes" : "no"}>
      <span aria-hidden className={`w-4 shrink-0 text-center ${ok === null ? "text-[var(--mg-faint)]" : ok ? "text-[var(--mg-ok)]" : "text-[var(--mg-caution)]"}`}>
        {ok === null ? "○" : ok ? "✓" : "!"}
      </span>
      <span className="text-[var(--mg-dim)]">{label}</span>
      <span className="ml-auto text-right">{value}</span>
    </li>
  );
}

function MessageStatus({ m, api }: { m: OutMessage; api: StationApi }) {
  const p = m.envelope.payload as Partial<NoticePayload & RetestRequestPayload>;
  return (
    <li className="rounded-xl border border-[var(--mg-line)] p-2.5" data-testid={`station-dispatch-${m.type === "station.notice.approved" ? "notice" : "retest"}`}>
      <p className="text-[13px] font-medium">{`${OUT_TEXT[m.type]}${m.retestId ? ` · ${m.retestId}` : ""}`}</p>
      <p className="mt-0.5 text-[12px] text-[var(--mg-dim)]">{p.text ?? p.instructions ?? ""}</p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        <Step ok={m.delivery === "sent" ? true : m.delivery === "failed" ? false : null} label="1 已交给适配层" value={m.delivery === "sent" ? time(m.adapterAt) : m.delivery === "failed" ? "发送失败" : "发送中"} testId="step-adapter" />
        <Step ok={m.hudReceivedAt ? true : null} label="2 HUD 端接收" value={m.hudReceivedAt ? time(m.hudReceivedAt) : "未收到接收回执"} testId="step-hud" />
        <Step ok={m.feedback === "acknowledged" ? true : m.feedback === "deferred" ? false : null} label="3 宇航员确认" value={m.feedback === "acknowledged" ? `已确认 ${time(m.feedbackAt)}` : m.feedback === "deferred" ? `暂缓：${m.feedbackNote ?? ""}` : "未反馈"} testId="step-crew" />
      </ul>
      {m.delivery === "failed" ? (
        <button type="button" onClick={() => api.resend(m.eventId)} className="mt-1.5 min-h-8 rounded-lg border border-[var(--mg-caution)] px-2 text-[12px] text-[var(--mg-caution)]" data-testid={`station-resend-${m.eventId}`}>
          {"用同一 eventId 重发"}
        </button>
      ) : null}
    </li>
  );
}

function Dispatched({ c, state, api }: { c: Case; state: StationState; api: StationApi }) {
  const lastApproval = [...c.reviews].reverse().find((r) => r.decision === "approve");
  const msgs = state.outbox.filter((m) => m.caseId === c.caseId && (m.type === "station.notice.approved" || m.type === "station.retest.requested") && m.envelope.payload && (m.envelope.payload as { evaluationVersion?: number }).evaluationVersion === lastApproval?.version);
  const rt = c.retests.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {lastApproval ? <p className="text-[12px] text-[var(--mg-dim)]">{`${lastApproval.reviewer} 于 ${time(lastApproval.at)} 批准（v${lastApproval.version}）：${lastApproval.reason}`}</p> : null}
      <ul className="flex flex-col gap-2">
        {msgs.map((m) => (
          <MessageStatus key={m.eventId} m={m} api={api} />
        ))}
      </ul>
      {rt ? (
        <p className="text-[13px]" data-testid="station-retest-list" data-status={rt.status}>
          {`复测任务 ${rt.retestId}：${{ requested: "已请求，等待结果", acknowledged: "宇航员已确认，等待结果", deferred: "宇航员暂缓", completed: "宇航员报告已完成，等待复测数据", "result-received": `已收到结果 → v${rt.resultVersion}` }[rt.status]}`}
        </p>
      ) : null}
      <p className="text-[11px] text-[var(--mg-faint)]">{"当前为独立演示：适配层是本地 mock，第 2、3 步只在收到真实回传时才会变为完成。"}</p>
      <details className="rounded-xl border border-[var(--mg-line)] px-3 py-2">
        <summary className="cursor-pointer text-[12px] text-[var(--mg-dim)]">{"其他操作"}</summary>
        <div className="mt-2">
          <DecisionForm c={c} api={api} options={allowedDecisions(c)} />
        </div>
      </details>
    </div>
  );
}

function Decided({ c, api }: { c: Case; api: StationApi }) {
  const last = c.reviews.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {last ? <p className="text-[13px]" data-testid="station-decision">{`${DECISION_TEXT[last.decision]} · ${last.reviewer} · ${time(last.at)}：${last.reason}`}</p> : null}
      <p className="text-[12px] text-[var(--mg-dim)]">{"事件仍未关闭，告警保持。可以在需要时关闭。"}</p>
      <DecisionForm c={c} api={api} options={allowedDecisions(c)} />
    </div>
  );
}

function Closed({ c }: { c: Case }) {
  const last = c.reviews.at(-1);
  const ev = latest(c);
  return (
    <div className="flex flex-col gap-2" data-testid="station-closed">
      <p className="text-[13px]" data-testid="station-decision">{last ? `由 ${last.reviewer} 于 ${time(last.at)} 关闭（v${last.version}）` : "已关闭"}</p>
      {last ? <p className="text-[13px]">{`理由：${last.reason}`}</p> : null}
      <p className="text-[12px] text-[var(--mg-dim)]">{`最终评估 v${ev.version}：${ev.result.headline}`}</p>
      <p className="text-[12px] text-[var(--mg-dim)]">{`处理记录：${c.reviews.length} 次审核，${c.retests.length} 个复测任务。`}</p>
    </div>
  );
}
