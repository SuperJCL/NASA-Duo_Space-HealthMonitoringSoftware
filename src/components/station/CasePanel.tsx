"use client";

import { useState } from "react";
import { FEATURES } from "@/lib/station/analysis";
import { allowedDecisions, latest, nextOwner, stageView, type Case, type Decision, type OutMessage, type StationState, type TimelineEntry } from "@/lib/station/station";
import type { StationApi } from "./useStation";

const ALERT = {
  none: { text: "无告警", cls: "border-[var(--mg-line-strong)] text-[var(--mg-dim)]" },
  watch: { text: "关注", cls: "border-[var(--mg-caution)] text-[var(--mg-caution)]" },
  alert: { text: "告警", cls: "border-[#ff6b6b] text-[#ff8f8f]" },
} as const;
const STAGE = {
  waiting: { icon: "○", cls: "text-[var(--mg-faint)]", text: "等待" },
  running: { icon: "◐", cls: "text-[var(--mg-cyan)]", text: "执行中" },
  done: { icon: "✓", cls: "text-[var(--mg-ok)]", text: "完成" },
  blocked: { icon: "⛔", cls: "text-[var(--mg-caution)]", text: "阻断" },
  failed: { icon: "✕", cls: "text-[#ff8f8f]", text: "失败" },
  skipped: { icon: "–", cls: "text-[var(--mg-faint)]", text: "未执行" },
} as const;
const PHASE_TEXT: Record<Case["phase"], string> = {
  analysing: "模拟分析中",
  "awaiting-review": "待人工审核",
  "on-hold": "保留复核",
  "awaiting-hud": "已派发，等待 HUD 确认",
  "awaiting-retest": "等待复测结果",
  deferred: "宇航员暂缓",
  rejected: "候选已驳回",
  monitoring: "保留观察",
  closed: "已关闭",
};
const DECISION_TEXT: Record<Decision, string> = { approve: "批准并派发", reject: "驳回", hold: "保留复核", close: "关闭事件", "keep-open": "保留事件继续观察" };
const OUT_TEXT: Record<OutMessage["type"], string> = {
  "station.notice.approved": "已审核提示 → HUD",
  "station.retest.requested": "复测任务 → HUD",
  "station.receipt": "结果接收回执",
  "station.reassessment": "重评结果",
};
const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(11, 19) + " UTC";
};

function Section({ title, children, testId, open = true }: { title: string; children: React.ReactNode; testId: string; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-[var(--mg-line)] p-3" data-testid={testId}>
      <summary className="cursor-pointer list-none text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--mg-faint)] group-open:mb-2">{title}</summary>
      {children}
    </details>
  );
}

export function CasePanel({ api, selectedId, onSelect }: { api: StationApi; selectedId: string | null; onSelect: (id: string) => void }) {
  const { state } = api;
  const ids = state.caseOrder;
  const c = (selectedId && state.cases[selectedId]) || (ids.length ? state.cases[ids[ids.length - 1]] : null);
  if (!state.run) {
    return (
      <div className="p-5" data-testid="station-empty">
        <h2 className="text-[17px] font-semibold">{"等待场景开始"}</h2>
        <p className="mt-1 text-[14px] text-[var(--mg-dim)]">{"基站尚未收到场景开始事件。Trigger 接入前，可在地址后加 ?dev=1 打开开发测试入口注入模拟事件。"}</p>
        <Timeline entries={state.timeline} />
      </div>
    );
  }
  if (!c) {
    return (
      <div className="p-5" data-testid="station-empty">
        <h2 className="text-[17px] font-semibold">{"场景进行中，等待模拟观测"}</h2>
        <p className="mt-1 text-[14px] text-[var(--mg-dim)]">{`运行 ${state.run.runId} · 尚无观测事件`}</p>
        <Timeline entries={state.timeline} />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4 text-[14px]" data-testid="station-case" data-case={c.caseId} data-phase={c.phase} data-alert={c.alert.level} data-version={latest(c).version}>
      {ids.length > 1 ? (
        <div role="tablist" aria-label="事件" className="flex flex-wrap gap-1.5">
          {ids.map((id) => {
            const x = state.cases[id];
            return (
              <button key={id} type="button" role="tab" aria-selected={id === c.caseId} onClick={() => onSelect(id)} className={`min-h-8 rounded-lg border px-2 text-[12px] ${id === c.caseId ? "border-[var(--mg-coral)] text-[var(--mg-text)]" : "border-[var(--mg-line)] text-[var(--mg-dim)]"}`} data-testid={`station-case-tab-${id}`}>
                {`${id} · ${PHASE_TEXT[x.phase]}`}
              </button>
            );
          })}
        </div>
      ) : null}
      <Headline c={c} />
      <ObservationSection c={c} />
      <BaselineSection c={c} />
      <AnalysisSection c={c} />
      <ConclusionSection c={c} />
      <ReviewSection key={`${c.caseId}-${latest(c).version}-${c.phase}`} c={c} api={api} />
      <RetestSection c={c} state={state} api={api} />
      <VersionsSection c={c} />
      <Section title="事件时间线" testId="station-timeline-section">
        <Timeline entries={state.timeline.filter((t) => t.caseId === c.caseId || t.caseId === null)} />
      </Section>
    </div>
  );
}

function Headline({ c }: { c: Case }) {
  const ev = latest(c);
  const done = ev.completedAt !== null;
  const basis = done ? ev.result.stages.filter((s) => s.status !== "skipped").map((s) => s.summary) : [];
  return (
    <section className="mg-glass flex flex-col gap-2 p-4" aria-labelledby="station-what" data-testid="station-headline">
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[12px] font-semibold ${ALERT[c.alert.level].cls}`} data-testid="station-alert">
          {ALERT[c.alert.level].text}
        </span>
        <span className="text-[12px] text-[var(--mg-faint)]">{`${c.caseId} · 第 ${ev.version} 版评估 · ${PHASE_TEXT[c.phase]}`}</span>
      </div>
      <div>
        <p className="text-[12px] text-[var(--mg-faint)]">{"发生了什么"}</p>
        <h2 id="station-what" className="text-[18px] font-semibold leading-snug" data-testid="station-what">
          {done ? ev.result.headline : "正在进行模拟分析…"}
        </h2>
      </div>
      <div>
        <p className="text-[12px] text-[var(--mg-faint)]">{"依据是什么"}</p>
        {basis.length ? (
          <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-[var(--mg-dim)]" data-testid="station-basis">
            {basis.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--mg-dim)]">{"分析完成后显示。"}</p>
        )}
      </div>
      <div>
        <p className="text-[12px] text-[var(--mg-faint)]">{"下一步需要谁处理"}</p>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-[var(--mg-coral)]" data-testid="station-next">
            {nextOwner(c)}
          </p>
          {allowedDecisions(c).length ? (
            <button
              type="button"
              onClick={() => {
                const el = document.querySelector<HTMLDetailsElement>('[data-testid="station-review"]');
                if (el) {
                  el.open = true;
                  el.scrollIntoView({ block: "start", behavior: "smooth" });
                }
              }}
              className="min-h-8 rounded-lg border border-[var(--mg-coral)] px-2.5 text-[12px] text-[var(--mg-coral)]"
              data-testid="station-goto-review"
            >
              {"前往人工审核 ↓"}
            </button>
          ) : null}
        </div>
      </div>
      {c.alert.level !== "none" ? <p className="text-[12px] text-[var(--mg-faint)]">{`告警只在人工关闭时解除（自 ${c.alert.since ? time(c.alert.since) : "–"}）：${c.alert.reason}`}</p> : null}
    </section>
  );
}

function ObservationSection({ c }: { c: Case }) {
  const ev = latest(c);
  const o = ev.observation;
  const q = ev.result.stages[0];
  return (
    <Section title="最新模拟观测与信号质量" testId="station-observation">
      <p className="text-[13px]" data-testid="station-observation-meta">
        {`${o.observationId} · 数据时间 ${time(o.capturedAt)} · 接收 ${time(ev.startedAt)} · ${ev.trigger === "retest" ? `复测（${ev.retestId}）` : "观测"}`}
      </p>
      <p className="text-[12px] text-[var(--mg-dim)]">{`协议：${o.protocol.label} · 阶段 ${o.context.phase}${o.context.minutesIntoEva !== null ? ` · EVA 第 ${o.context.minutesIntoEva} 分钟` : ""}`}</p>
      {q.evidence.length ? (
        <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px]" data-testid="station-signal">
          {q.evidence.map((e) => (
            <li key={e.label} className={e.ok === false ? "text-[var(--mg-caution)]" : "text-[var(--mg-dim)]"}>
              {`${e.ok === false ? "✕" : "✓"} ${e.label} ${e.value}`}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function BaselineSection({ c }: { c: Case }) {
  const ev = latest(c);
  const ctx = ev.result.stages[1];
  const revealedCtx = ev.completedAt !== null || ev.revealed > 1;
  const revealedFeat = ev.completedAt !== null || ev.revealed > 2;
  return (
    <Section title="个体基线比较" testId="station-baseline">
      {revealedCtx ? (
        <p className={`text-[13px] ${ctx.status === "done" ? "text-[var(--mg-dim)]" : "text-[var(--mg-caution)]"}`} data-testid="station-comparability">
          {`可比性：${ctx.summary}`}
        </p>
      ) : (
        <p className="text-[13px] text-[var(--mg-faint)]">{"等待情境与可比性检查…"}</p>
      )}
      {revealedFeat && ev.result.comparisons.length ? (
        <table className="mt-2 w-full text-left text-[12px]" data-testid="station-baseline-table">
          <thead className="text-[var(--mg-faint)]">
            <tr>
              <th className="font-normal">{"特征"}</th>
              <th className="font-normal">{"个体基线"}</th>
              <th className="font-normal">{"本次"}</th>
              <th className="font-normal">{"z"}</th>
            </tr>
          </thead>
          <tbody>
            {ev.result.comparisons.map((x) => (
              <tr key={x.key} className={x.flagged ? "text-[var(--mg-caution)]" : "text-[var(--mg-dim)]"} data-flagged={x.flagged}>
                <td>{`${FEATURES[x.key].label} (${FEATURES[x.key].unit})`}</td>
                <td>{`${x.mean} ± ${x.sd}`}</td>
                <td>{x.current}</td>
                <td>{`${x.z?.toFixed(2)}${x.flagged ? " ⚑" : ""}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : revealedFeat ? (
        <p className="mt-1 text-[12px] text-[var(--mg-dim)]">{"未进行特征比较（见上方原因）。"}</p>
      ) : null}
      <p className="mt-1.5 text-[11px] text-[var(--mg-faint)]">{"基线为演示数据：同一宇航员、同一标准协议的 6 次记录（模拟）。阈值 ±2 SD 为演示规则。"}</p>
    </Section>
  );
}

function AnalysisSection({ c }: { c: Case }) {
  const ev = latest(c);
  const stages = stageView(ev);
  return (
    <Section title="模拟分析进度（确定性规则，非真实模型）" testId="station-analysis">
      <ol className="flex flex-col gap-1.5" data-testid="station-stages">
        {stages.map((st, i) => (
          <li key={st.id} className="flex gap-2" data-stage={st.id} data-status={st.status}>
            <span aria-hidden className={`w-5 shrink-0 text-center ${STAGE[st.status].cls} ${st.status === "running" ? "animate-pulse" : ""}`}>
              {STAGE[st.status].icon}
            </span>
            <div className="min-w-0">
              <p className="text-[13px]">
                <span className="font-medium">{`${i + 1}. ${st.label}`}</span>
                <span className={`ml-2 text-[12px] ${STAGE[st.status].cls}`}>{STAGE[st.status].text}</span>
              </p>
              {st.summary ? <p className="text-[12px] text-[var(--mg-dim)]">{st.summary}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function ConclusionSection({ c }: { c: Case }) {
  const ev = latest(c);
  if (ev.completedAt === null) return null;
  const r = ev.result;
  return (
    <Section title="分析结论、证据、局限与建议候选" testId="station-conclusion">
      <p className="text-[14px]" data-testid="station-conclusion-text">
        {r.conclusion}
      </p>
      <details className="mt-2" data-testid="station-evidence">
        <summary className="cursor-pointer text-[13px] text-[var(--mg-text)] underline underline-offset-2">{"展开结构化证据"}</summary>
        {r.stages
          .filter((s) => s.evidence.length)
          .map((s) => (
            <div key={s.id} className="mt-1.5">
              <p className="text-[12px] font-medium">{s.id}</p>
              <ul className="text-[12px] text-[var(--mg-dim)]">
                {s.evidence.map((e) => (
                  <li key={e.label}>{`${e.ok === null ? "·" : e.ok ? "✓" : "✕"} ${e.label}：${e.value}${e.note ? `（${e.note}）` : ""}`}</li>
                ))}
              </ul>
            </div>
          ))}
      </details>
      <p className="mt-2 text-[12px] text-[var(--mg-faint)]">{"局限"}</p>
      <ul className="list-disc pl-4 text-[12px] text-[var(--mg-dim)]">
        {r.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {r.candidate ? (
        <div className="mt-2 rounded-lg border border-dashed border-[var(--mg-coral)] p-2.5" data-testid="station-candidate" data-kind={r.candidate.kind}>
          <p className="text-[12px] font-semibold text-[var(--mg-coral)]">{"建议候选 · 待人工审核，未发布"}</p>
          <p className="font-medium">{r.candidate.title}</p>
          <p className="text-[12px] text-[var(--mg-dim)]">{r.candidate.rationale}</p>
          {r.candidate.kind === "notice-and-retest" ? <p className="mt-1 text-[12px]">{`提示草稿：${r.candidate.notice.text}`}</p> : null}
          {r.candidate.kind !== "record-only" ? <p className="mt-1 text-[12px]">{`复测任务草稿：${r.candidate.retest.instructions}`}</p> : null}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-[var(--mg-caution)]">{"没有建议候选（分析未完成）。"}</p>
      )}
    </Section>
  );
}

function ReviewSection({ c, api }: { c: Case; api: StationApi }) {
  const ev = latest(c);
  const options = allowedDecisions(c);
  const [choice, setChoice] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [reviewer, setReviewer] = useState("基地值班员");
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="人工审核" testId="station-review">
      {options.length === 0 ? (
        <p className="text-[13px] text-[var(--mg-dim)]">{c.phase === "analysing" ? "分析完成后才能审核。" : "当前没有需要审核的内容。"}</p>
      ) : (
        <>
          <p className="text-[12px] text-[var(--mg-dim)]">{`审核第 ${ev.version} 版评估。批准后才会通过适配层向 HUD 发布；驳回或保留不会发送任何内容。`}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="审核决定">
            {options.map((d) => (
              <button key={d} type="button" aria-pressed={choice === d} onClick={() => setChoice(d)} className={`min-h-9 rounded-lg border px-3 text-[13px] ${choice === d ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)]" : "border-[var(--mg-line-strong)]"}`} data-testid={`station-decide-${d}`}>
                {DECISION_TEXT[d]}
              </button>
            ))}
          </div>
          {choice ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <label className="flex flex-col gap-0.5 text-[12px]">
                {"审核理由（必填）"}
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1 text-[13px]" data-testid="station-review-reason" />
              </label>
              <label className="flex flex-col gap-0.5 text-[12px]">
                {"审核人"}
                <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1 text-[13px]" data-testid="station-reviewer" />
              </label>
              <button
                type="button"
                onClick={() => {
                  const err = api.review(c.caseId, ev.version, choice, reason, reviewer);
                  setError(err);
                }}
                className="min-h-10 rounded-xl bg-[var(--mg-coral)] px-4 text-[14px] font-semibold text-[#1a0f0c]"
                data-testid="station-review-confirm"
              >
                {`确认：${DECISION_TEXT[choice]}`}
              </button>
              {error ? (
                <p role="alert" className="text-[12px] text-[var(--mg-caution)]" data-testid="station-review-error">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {c.reviews.length ? (
        <ul className="mt-2 space-y-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="station-review-history">
          {c.reviews.map((r, i) => (
            <li key={i}>{`v${r.version} · ${DECISION_TEXT[r.decision]} · ${r.reviewer} · ${time(r.at)} · ${r.reason}`}</li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function RetestSection({ c, state, api }: { c: Case; state: StationState; api: StationApi }) {
  const msgs = state.outbox.filter((m) => m.caseId === c.caseId);
  return (
    <Section title="派发消息与复测任务" testId="station-retests">
      {msgs.length === 0 && c.retests.length === 0 ? <p className="text-[13px] text-[var(--mg-dim)]">{"尚未派发任何消息。"}</p> : null}
      {c.retests.length ? (
        <ul className="space-y-0.5 text-[13px]" data-testid="station-retest-list">
          {c.retests.map((r) => (
            <li key={r.retestId} data-retest={r.retestId} data-status={r.status}>
              {`${r.retestId} · 来自 v${r.requestedFromVersion} · ${{ requested: "已请求", acknowledged: "HUD 已确认", deferred: "HUD 暂缓", "result-received": `已收到结果 → v${r.resultVersion}` }[r.status]}`}
            </li>
          ))}
        </ul>
      ) : null}
      {msgs.length ? (
        <ul className="mt-1.5 space-y-1 text-[12px]" data-testid="station-outbox">
          {msgs.map((m) => (
            <li key={m.eventId} className="rounded-lg border border-[var(--mg-line)] px-2 py-1" data-type={m.type} data-delivery={m.delivery} data-feedback={m.feedback}>
              <span className="font-medium">{OUT_TEXT[m.type]}</span>
              <span className="text-[var(--mg-faint)]">{` · ${m.eventId}`}</span>
              <span className={m.delivery === "failed" ? "text-[var(--mg-caution)]" : "text-[var(--mg-dim)]"}>{` · ${{ queued: "发送中", sent: "已交给适配层", failed: "发送失败" }[m.delivery]}`}</span>
              {m.type === "station.notice.approved" || m.type === "station.retest.requested" ? (
                <span className={m.feedback === "none" ? "text-[var(--mg-faint)]" : "text-[var(--mg-ok)]"}>{` · ${{ none: "未收到 HUD 回传", acknowledged: "HUD 已确认", deferred: `HUD 暂缓：${m.feedbackNote ?? ""}` }[m.feedback]}`}</span>
              ) : null}
              {m.delivery === "failed" ? (
                <button type="button" onClick={() => api.resend(m.eventId)} className="ml-2 underline" data-testid={`station-resend-${m.eventId}`}>
                  {"重发"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function VersionsSection({ c }: { c: Case }) {
  if (c.evaluations.length < 2) return null;
  return (
    <Section title="评估版本" testId="station-versions" open={false}>
      <ol className="space-y-0.5 text-[12px] text-[var(--mg-dim)]">
        {c.evaluations.map((e) => (
          <li key={e.version}>{`v${e.version} · ${e.trigger === "retest" ? `复测 ${e.retestId}` : "观测"} · ${e.completedAt ? e.result.headline : "分析中"}`}</li>
        ))}
      </ol>
    </Section>
  );
}

const KIND = { in: "收", out: "发", system: "系", review: "审", ignored: "略" } as const;
export function Timeline({ entries }: { entries: readonly TimelineEntry[] }) {
  if (!entries.length) return <p className="mt-2 text-[12px] text-[var(--mg-faint)]">{"暂无事件。"}</p>;
  return (
    <ol className="mt-1 space-y-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="station-timeline">
      {[...entries]
        .reverse()
        .slice(0, 30)
        .map((t, i) => (
          <li key={i} className={t.kind === "ignored" ? "text-[var(--mg-faint)]" : ""} data-kind={t.kind}>
            <span className="mr-1 inline-block w-4 text-center text-[var(--mg-faint)]">{KIND[t.kind]}</span>
            {`${time(t.at)} · ${t.text}`}
          </li>
        ))}
    </ol>
  );
}
