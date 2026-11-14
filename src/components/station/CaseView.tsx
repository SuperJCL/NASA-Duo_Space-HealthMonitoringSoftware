"use client";

import { useState } from "react";
import { FEATURES, type FeatureComparison } from "@/lib/station/analysis";
import { latest, nextOwner, stageView, workbenchStage, type Case, type Evaluation, type StationState, type TimelineEntry } from "@/lib/station/station";
import { comparisonView, keyBasis } from "@/lib/station/views";
import { AlertBadge, Fold, Label, OUT_TEXT, STAGE_TEXT, time } from "./ui";

const STAGE = {
  waiting: { icon: "○", cls: "text-[var(--mg-faint)]", text: "等待" },
  running: { icon: "◐", cls: "text-[var(--mg-cyan)]", text: "执行中" },
  done: { icon: "✓", cls: "text-[var(--mg-ok)]", text: "完成" },
  blocked: { icon: "■", cls: "text-[var(--mg-caution)]", text: "阻断" },
  failed: { icon: "✕", cls: "text-[#ff8f8f]", text: "失败" },
  skipped: { icon: "–", cls: "text-[var(--mg-faint)]", text: "未执行" },
} as const;
const fmtZ = (z: number | null) => (z === null ? "–" : `${z > 0 ? "+" : ""}${z.toFixed(2)}`);

/** Centre, top: what happened, the key basis and who acts next. Always on the first screen. */
export function CaseSummary({ c }: { c: Case }) {
  const ev = latest(c);
  const done = ev.completedAt !== null;
  return (
    <section className="mg-glass flex flex-col gap-2 p-4" aria-labelledby="station-what" data-testid="station-headline">
      <div className="flex flex-wrap items-center gap-2">
        <AlertBadge level={c.alert.level} testId="station-alert" />
        <span className="text-[12px] text-[var(--mg-faint)]">{`${c.caseId} · 第 ${ev.version} 版评估 · ${STAGE_TEXT[workbenchStage(c)]}`}</span>
      </div>
      <div>
        <p className="text-[12px] text-[var(--mg-faint)]">{"发生了什么"}</p>
        <h2 id="station-what" className="text-[19px] font-semibold leading-snug" data-testid="station-what">
          {done ? ev.result.headline : ev.version > 1 ? "收到复测结果，正在重新评估…" : "收到模拟观测，正在模拟分析…"}
        </h2>
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

function StageBar({ ev }: { ev: Evaluation }) {
  const stages = stageView(ev);
  const firstIssue = stages.findIndex((s) => s.status === "blocked" || s.status === "failed");
  const [open, setOpen] = useState<number | null>(null);
  const shown = open ?? (ev.completedAt ? (firstIssue >= 0 ? firstIssue : 2) : null);
  const result = ev.result.stages[shown ?? 0];
  return (
    <section aria-labelledby="station-analysis-title" data-testid="station-analysis">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="station-analysis-title" className="text-[13px] font-semibold">{`模拟分析 · v${ev.version}`}</h3>
        <span className="text-[11px] text-[var(--mg-faint)]">{"确定性规则模拟，未调用模型"}</span>
      </div>
      <ol className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="station-stages">
        {stages.map((st, i) => (
          <li key={st.id} data-stage={st.id} data-status={st.status}>
            <button
              type="button"
              aria-expanded={shown === i}
              disabled={!st.summary}
              onClick={() => setOpen(shown === i ? -1 : i)}
              className={`flex h-full w-full flex-col items-start rounded-lg border p-2 text-left text-[12px] ${shown === i ? "border-[var(--mg-coral)]" : "border-[var(--mg-line)]"} disabled:cursor-default`}
              data-testid={`station-stage-${st.id}`}
            >
              <span className={`font-semibold ${STAGE[st.status].cls} ${st.status === "running" ? "animate-pulse" : ""}`}>{`${STAGE[st.status].icon} ${STAGE[st.status].text}`}</span>
              <span className="mt-0.5 font-medium text-[var(--mg-text)]">{`${i + 1}. ${st.label}`}</span>
            </button>
          </li>
        ))}
      </ol>
      {shown !== null && shown >= 0 && stages[shown].summary ? (
        <div className="mt-2 rounded-lg bg-[rgba(255,255,255,0.03)] p-2.5 text-[12px]" data-testid="station-stage-detail">
          <p className="text-[13px]">{stages[shown].summary}</p>
          {result.evidence.length ? (
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

function Comparison({ c }: { c: Case }) {
  const view = comparisonView(c);
  const ev = latest(c);
  const o = ev.observation;
  return (
    <section aria-labelledby="station-baseline-title" data-testid="station-baseline" data-view={view.kind}>
      <h3 id="station-baseline-title" className="text-[13px] font-semibold">{"观测与个体基线比较"}</h3>
      <p className="mt-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="station-observation-meta">
        {`${o.observationId} · 数据时间 ${time(o.capturedAt)} · ${o.protocol.label} · ${ev.result.stages[0].status === "done" ? "信号质量合格" : ev.result.stages[0].status === "blocked" ? "信号质量不合格" : "质量未评估"}`}
      </p>
      {ev.completedAt === null ? (
        <p className="mt-1 text-[12px] text-[var(--mg-faint)]">{"分析完成后显示比较。"}</p>
      ) : view.kind === "single" ? (
        ev.result.comparisons.length ? (
          <table className="mt-1.5 w-full text-left text-[12px]" data-testid="station-baseline-table">
            <thead className="text-[var(--mg-faint)]">
              <tr>
                <th className="font-normal">{"特征"}</th>
                <th className="font-normal">{"个体基线"}</th>
                <th className="font-normal">{`本次 v${ev.version}`}</th>
                <th className="font-normal" />
              </tr>
            </thead>
            <tbody>
              {ev.result.comparisons.map((x) => (
                <tr key={x.key} className={x.flagged ? "text-[var(--mg-caution)]" : "text-[var(--mg-dim)]"} data-flagged={x.flagged}>
                  <td>{`${FEATURES[x.key].label} (${FEATURES[x.key].unit})`}</td>
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
                <th className="font-normal">{"特征"}</th>
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
                  <td>{`${FEATURES[before.key].label} (${FEATURES[before.key].unit})`}</td>
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
          <p>{`v${view.before.version} 原始观测：${view.before.result.headline}`}</p>
          <p>{`v${view.after.version} 复测：${view.after.result.headline}`}</p>
          <p className="text-[var(--mg-caution)]">{view.why}</p>
        </div>
      )}
      <p className="mt-1 text-[11px] text-[var(--mg-faint)]">{"个体基线为演示数据（同一宇航员、同一标准协议 6 次记录，模拟）；±2 SD 为演示阈值。"}</p>
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

/** Centre, below the summary: analysis steps, comparison, conclusion; technical detail folded. */
export function CaseDetails({ c, state }: { c: Case; state: StationState }) {
  const ev = latest(c);
  const msgs = state.outbox.filter((m) => m.caseId === c.caseId);
  return (
    <div className="flex flex-col gap-4">
      <StageBar key={`${c.caseId}-${ev.version}`} ev={ev} />
      <Comparison c={c} />
      {ev.completedAt ? (
        <section aria-labelledby="station-conclusion-title" data-testid="station-conclusion">
          <h3 id="station-conclusion-title" className="text-[13px] font-semibold">{"结论与局限"}</h3>
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
        <Label>{"次级信息"}</Label>
        <Fold title="技术字段（观测原始字段）" testId="station-tech">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--mg-dim)]">{JSON.stringify({ observation: ev.observation, sourceEventId: ev.sourceEventId, inputKey: ev.result.inputKey }, null, 1)}</pre>
        </Fold>
        <Fold title={`消息记录（${msgs.length}）`} testId="station-messages">
          {msgs.length ? (
            <ul className="space-y-1 text-[12px]" data-testid="station-outbox">
              {msgs.map((m) => (
                <li key={m.eventId} className="text-[var(--mg-dim)]" data-type={m.type} data-delivery={m.delivery} data-hud-received={m.hudReceivedAt ? "yes" : "no"} data-feedback={m.feedback}>
                  {`${time(m.envelope.sentAt)} · ${OUT_TEXT[m.type]} · ${m.eventId} · 适配层：${{ queued: "发送中", sent: "已交给", failed: "失败" }[m.delivery]} · HUD 接收：${m.hudReceivedAt ? time(m.hudReceivedAt) : "未收到回执"}${m.type === "station.notice.approved" || m.type === "station.retest.requested" ? ` · 宇航员：${{ none: "未反馈", acknowledged: "已确认", deferred: "暂缓" }[m.feedback]}` : ""}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--mg-faint)]">{"尚未发出消息。"}</p>
          )}
        </Fold>
        <Fold title="事件时间线" testId="station-timeline-section">
          <Timeline entries={state.timeline.filter((t) => t.caseId === c.caseId || t.caseId === null)} />
        </Fold>
        {c.evaluations.length > 1 ? (
          <Fold title={`评估版本（${c.evaluations.length}）`} testId="station-versions">
            <ol className="space-y-0.5 text-[12px] text-[var(--mg-dim)]">
              {c.evaluations.map((e) => (
                <li key={e.version}>{`v${e.version} · ${e.trigger === "retest" ? `复测 ${e.retestId}` : "观测"} · ${e.completedAt ? e.result.headline : "分析中"}`}</li>
              ))}
            </ol>
          </Fold>
        ) : null}
      </div>
    </div>
  );
}
