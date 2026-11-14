"use client";

import { useState } from "react";
import { FEATURES, type FeatureComparison } from "@/lib/station/analysis";
import { caseMessages, latest, messageKind, nextOwner, stageView, type Case, type Evaluation, type StationState, type TimelineEntry } from "@/lib/station/station";
import { alertNote, caseStatus, comparisonView, evaluationStatus, keyBasis, summaryHeadline } from "@/lib/station/views";
import { Fold, Label, StatusChip, time } from "./ui";

const STAGE = {
  waiting: { icon: "○", cls: "text-[var(--mg-faint)]", text: "等待" },
  running: { icon: "◐", cls: "text-[var(--mg-cyan)]", text: "执行中" },
  done: { icon: "✓", cls: "text-[var(--mg-ok)]", text: "完成" },
  blocked: { icon: "■", cls: "text-[var(--mg-caution)]", text: "阻断" },
  failed: { icon: "✕", cls: "text-[#ff8f8f]", text: "失败" },
  skipped: { icon: "–", cls: "text-[var(--mg-faint)]", text: "未执行" },
} as const;
const fmtZ = (z: number | null) => (z === null ? "–" : `${z > 0 ? "+" : ""}${z.toFixed(2)}`);
const POSTURE = { standing: "站姿", kneeling: "跪姿", seated: "坐姿" } as const;

/**
 * Centre, top: case status and latest evaluation (two separate indicators), the one-line
 * summary, the key basis and who acts next. Always on the first screen.
 */
export function CaseSummary({ c }: { c: Case }) {
  const ev = latest(c);
  const done = ev.completedAt !== null;
  const status = caseStatus(c);
  const result = evaluationStatus(ev);
  const note = alertNote(c);
  return (
    <section className="mg-glass flex flex-col gap-2 p-4" aria-labelledby="station-what" data-testid="station-headline">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={status.tone} testId="station-case-status">{`事件状态：${status.label}`}</StatusChip>
        <StatusChip tone={result.tone} testId="station-eval-status">{result.label}</StatusChip>
      </div>
      <div>
        <p className="text-[12px] text-[var(--mg-faint)]">{"发生了什么"}</p>
        <h2 id="station-what" className="text-[19px] font-semibold leading-snug" data-testid="station-what">
          {summaryHeadline(c)}
        </h2>
        {note ? (
          <p className="mt-0.5 text-[13px] text-[#ff8f8f]" data-testid="station-alert-note">
            {note}
          </p>
        ) : null}
      </div>
      <div>
        <p className="text-[12px] text-[var(--mg-faint)]">{"关键依据"}</p>
        {done ? (
          <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-[var(--mg-dim)]" data-testid="station-basis">
            {keyBasis(ev.result).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--mg-dim)]">{"分析完成后显示。"}</p>
        )}
      </div>
      <p className="text-[13px]">
        <span className="text-[var(--mg-faint)]">{"下一步："}</span>
        <span className="font-medium text-[var(--mg-coral)]" data-testid="station-next">
          {nextOwner(c)}
        </span>
      </p>
    </section>
  );
}

/** The four simulated analysis steps; a step's detail opens only on demand. */
function StageBar({ ev }: { ev: Evaluation }) {
  const stages = stageView(ev);
  const [open, setOpen] = useState<number | null>(null);
  const shown = open !== null && stages[open]?.summary ? open : null;
  const result = shown !== null ? ev.result.stages[shown] : null;
  return (
    <section aria-labelledby="station-analysis-title" data-testid="station-analysis">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="station-analysis-title" className="text-[13px] font-semibold">{`模拟分析步骤 · v${ev.version}`}</h3>
        <span className="text-[11px] text-[var(--mg-faint)]">{"确定性规则模拟，未调用模型 · 点击步骤查看细节"}</span>
      </div>
      <ol className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="station-stages">
        {stages.map((st, i) => (
          <li key={st.id} data-stage={st.id} data-status={st.status}>
            <button
              type="button"
              aria-expanded={shown === i}
              disabled={!st.summary}
              onClick={() => setOpen(shown === i ? null : i)}
              className={`flex h-full w-full flex-col items-start rounded-lg border p-2 text-left text-[12px] ${shown === i ? "border-[var(--mg-coral)]" : "border-[var(--mg-line)]"} disabled:cursor-default`}
              data-testid={`station-stage-${st.id}`}
            >
              <span className={`font-semibold ${STAGE[st.status].cls} ${st.status === "running" ? "animate-pulse" : ""}`}>{`${STAGE[st.status].icon} ${STAGE[st.status].text}`}</span>
              <span className="mt-0.5 font-medium text-[var(--mg-text)]">{`${i + 1}. ${st.label}`}</span>
            </button>
          </li>
        ))}
      </ol>
      {shown !== null && result ? (
        <div className="mt-2 rounded-lg bg-[rgba(255,255,255,0.03)] p-2.5 text-[12px]" data-testid="station-stage-detail">
          <p className="text-[13px]">{stages[shown].summary}</p>
          {result.id === "features" ? (
            <p className="mt-1 text-[var(--mg-dim)]">{"各项数值见下方“测量与个体基线比较”表。"}</p>
          ) : result.evidence.length ? (
            <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-[var(--mg-dim)] sm:grid-cols-2">
              {result.evidence.map((e) => (
                <li key={e.label} className={e.ok === false ? "text-[var(--mg-caution)]" : ""}>{`${e.ok === null ? "·" : e.ok ? "✓" : "✕"} ${e.label}：${e.value}${e.note ? `（${e.note}）` : ""}`}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Row({ cmp }: { cmp: FeatureComparison }) {
  return (
    <>
      <td>{cmp.current}</td>
      <td className="text-[var(--mg-faint)]">{`z ${fmtZ(cmp.z)}${cmp.flagged ? " ⚑" : ""}`}</td>
    </>
  );
}

const Indicator = ({ k }: { k: FeatureComparison["key"] }) => (
  <td>
    {`${FEATURES[k].label} (${FEATURES[k].unit})`}
    <span className="ml-1 text-[11px] text-[var(--mg-faint)]">{FEATURES[k].source}</span>
  </td>
);

function Comparison({ c }: { c: Case }) {
  const view = comparisonView(c);
  const ev = latest(c);
  const o = ev.observation;
  const p = o.protocol;
  return (
    <section aria-labelledby="station-baseline-title" data-testid="station-baseline" data-view={view.kind}>
      <h3 id="station-baseline-title" className="text-[13px] font-semibold">{"测量与个体基线比较"}</h3>
      <p className="mt-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="station-observation-meta">
        {`标准化模拟测量（单次，按固定协议）：${p.label} · ${POSTURE[p.posture]} · ${p.glove === "eva-glove" ? "EVA 手套" : "不戴手套"}${o.context.minutesIntoEva !== null ? ` · 测量时机：EVA 第 ${o.context.minutesIntoEva} 分钟` : ""} · 数据时间 ${time(o.capturedAt)} · ${ev.result.stages[0].status === "done" ? "信号质量合格" : ev.result.stages[0].status === "blocked" ? "信号质量不合格" : "质量未评估"}`}
      </p>
      {ev.completedAt === null ? (
        <p className="mt-1 text-[12px] text-[var(--mg-faint)]">{"分析完成后显示比较。"}</p>
      ) : view.kind === "single" ? (
        ev.result.comparisons.length ? (
          <table className="mt-1.5 w-full text-left text-[12px]" data-testid="station-baseline-table">
            <thead className="text-[var(--mg-faint)]">
              <tr>
                <th className="font-normal">{"指标 · 来源"}</th>
                <th className="font-normal">{"个体基线"}</th>
                <th className="font-normal">{`本次 v${ev.version}`}</th>
                <th className="font-normal" />
              </tr>
            </thead>
            <tbody>
              {ev.result.comparisons.map((x) => (
                <tr key={x.key} className={x.flagged ? "text-[var(--mg-caution)]" : "text-[var(--mg-dim)]"} data-flagged={x.flagged}>
                  <Indicator k={x.key} />
                  <td>{`${x.mean} ± ${x.sd}`}</td>
                  <Row cmp={x} />
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-1 text-[12px] text-[var(--mg-caution)]" data-testid="station-comparability">
            {`未比较：${ev.result.stages.find((s) => s.status === "blocked" || s.status === "failed")?.summary ?? ""}`}
          </p>
        )
      ) : view.kind === "paired" ? (
        <>
          <table className="mt-1.5 w-full text-left text-[12px]" data-testid="station-baseline-table">
            <thead className="text-[var(--mg-faint)]">
              <tr>
                <th className="font-normal">{"指标 · 来源"}</th>
                <th className="font-normal">{"个体基线"}</th>
                <th className="font-normal">{`v${view.before.version} 原始`}</th>
                <th className="font-normal" />
                <th className="font-normal">{`v${view.after.version} 复测`}</th>
                <th className="font-normal" />
              </tr>
            </thead>
            <tbody>
              {view.rows.map(({ before, after }) => (
                <tr key={before.key} className="text-[var(--mg-dim)]">
                  <Indicator k={before.key} />
                  <td>{`${before.mean} ± ${before.sd}`}</td>
                  <Row cmp={before} />
                  <Row cmp={after} />
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-[var(--mg-faint)]">{"两次测量都满足质量与可比条件，故并列显示；不计算“改善幅度”。"}</p>
        </>
      ) : (
        <div className="mt-1.5 flex flex-col gap-1 text-[12px]" data-testid="station-separate">
          <p>{`v${view.before.version} 原始测量：${view.before.result.headline}`}</p>
          <p>{`v${view.after.version} 复测：${view.after.result.headline}`}</p>
          <p className="text-[var(--mg-caution)]">{view.why}</p>
        </div>
      )}
      <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--mg-faint)]">
        <li>{"参考范围 = 个体基线均值 ± 2 SD（演示阈值）；个体基线为同一宇航员、同一标准协议 6 次记录（模拟）。⚑ = 超出参考范围。"}</li>
        <li data-testid="station-grip-note">{"握力来自同一协议下的握力计读数（独立模拟测量），不是由肌电推算。"}</li>
      </ul>
    </section>
  );
}

export function Timeline({ entries }: { entries: readonly TimelineEntry[] }) {
  const KIND = { in: "收", out: "发", system: "系", review: "审", ignored: "略" } as const;
  if (!entries.length) return <p className="text-[12px] text-[var(--mg-faint)]">{"暂无事件。"}</p>;
  return (
    <ol className="space-y-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="station-timeline">
      {[...entries].reverse().map((t, i) => (
        <li key={i} className={t.kind === "ignored" ? "text-[var(--mg-faint)]" : ""} data-kind={t.kind}>
          <span className="mr-1 inline-block w-4 text-center text-[var(--mg-faint)]">{KIND[t.kind]}</span>
          {`${time(t.at)} · ${t.text}`}
        </li>
      ))}
    </ol>
  );
}

const KIND_TEXT = { action: "行动消息", status: "状态通知", receipt: "接收回执", audit: "审计记录（不发给 HUD）" } as const;

/** Centre, below the summary: analysis steps, comparison, interpretation; history and technical detail folded. */
export function CaseDetails({ c, state, mock }: { c: Case; state: StationState; mock: boolean }) {
  const ev = latest(c);
  const msgs = caseMessages(state, c.caseId);
  return (
    <div className="flex flex-col gap-4">
      <StageBar key={`${c.caseId}-${ev.version}`} ev={ev} />
      <Comparison c={c} />
      {ev.completedAt ? (
        <section aria-labelledby="station-conclusion-title" data-testid="station-conclusion">
          <h3 id="station-conclusion-title" className="text-[13px] font-semibold">{"解读与局限"}</h3>
          <p className="mt-0.5 text-[13px]" data-testid="station-conclusion-text">
            {ev.result.conclusion}
          </p>
          <ul className="mt-1 list-disc pl-4 text-[12px] text-[var(--mg-faint)]">
            {ev.result.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label>{"按需展开"}</Label>
        <Fold title="处理记录与时间线" testId="station-timeline-section">
          <Timeline entries={state.timeline.filter((t) => t.caseId === c.caseId || t.caseId === null)} />
        </Fold>
        {c.evaluations.length > 1 ? (
          <Fold title={`评估版本（${c.evaluations.length}）`} testId="station-versions">
            <ol className="space-y-0.5 text-[12px] text-[var(--mg-dim)]">
              {c.evaluations.map((e) => (
                <li key={e.version}>{`v${e.version} · ${e.trigger === "retest" ? "复测" : "测量"} · ${e.completedAt ? e.result.headline : "分析中"}`}</li>
              ))}
            </ol>
          </Fold>
        ) : null}
        <Fold title="技术详情（消息类型、编号、传输）" testId="station-tech">
          <div className="flex flex-col gap-2 text-[12px] text-[var(--mg-dim)]">
            <p data-testid="station-tech-ids">{`caseId ${c.caseId} · 运行 ${state.run?.runId ?? "–"} · 场景 ${state.run?.scenarioId ?? "–"} · 宇航员 ${c.astronautId} · 评估 ${c.evaluations.map((e) => `v${e.version}←${e.sourceEventId}${e.retestId ? `（${e.retestId}）` : ""}`).join("，")}`}</p>
            <p>{`传输：${mock ? "本地 mock 适配层（独立演示，未经网络，未连接 Trigger / HUD）" : "适配层"}。“已交给适配层”只表示交出，不代表 HUD 已收到。`}</p>
            {msgs.length ? (
              <ul className="space-y-1" data-testid="station-outbox">
                {msgs.map((m) => (
                  <li key={m.eventId} className={messageKind(m.type) === "audit" ? "text-[var(--mg-faint)]" : ""} data-type={m.type} data-kind={messageKind(m.type)} data-delivery={m.delivery} data-hud-received={m.hudReceivedAt ? "yes" : "no"} data-feedback={m.feedback}>
                    {`${time(m.envelope.sentAt)} · ${KIND_TEXT[messageKind(m.type)]} · ${m.type} · ${m.eventId}${m.retestId ? ` · ${m.retestId}` : ""}`}
                    {messageKind(m.type) === "audit"
                      ? ""
                      : ` · 适配层：${{ queued: "交出中", sent: "已交出", failed: "失败" }[m.delivery]} · HUD 接收：${m.hudReceivedAt ? time(m.hudReceivedAt) : "未收到回执"}${messageKind(m.type) === "action" ? ` · 宇航员：${{ none: "未反馈", acknowledged: "已确认", deferred: "暂缓" }[m.feedback]}` : ""}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[var(--mg-faint)]">{"尚未发出消息。"}</p>
            )}
            <details>
              <summary className="cursor-pointer">{`v${ev.version} 测量原始字段`}</summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify({ observation: ev.observation, sourceEventId: ev.sourceEventId, inputKey: ev.result.inputKey }, null, 1)}</pre>
            </details>
          </div>
        </Fold>
      </div>
    </div>
  );
}
