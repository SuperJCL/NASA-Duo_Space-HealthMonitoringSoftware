"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { commStream, COMM_BADGE, type CommItem } from "@/lib/station/comms";
import { crewCards, unreadEntries, type Notice } from "@/lib/station/crew";
import { buildFlow, hhmmss, type FlowNode, type FlowRow, type FlowView, type IndicatorView, type NodeState } from "@/lib/station/flow";
import { latest, statusNoticeText, type Case, type Decision, type StationState } from "@/lib/station/station";
import { caseStatus, evaluationStatus } from "@/lib/station/views";
import type { StationApi } from "../useStation";
import { elapsed, duration, prefersReducedMotion, useNow, useOnceAnimation, usePageVisible } from "./motion";
import { NotificationBar, TONE_BORDER, TONE_TEXT } from "./Overview";

type Props = {
  state: StationState;
  api: StationApi;
  mock: boolean;
  astronautId: string;
  caseId: string | null;
  onSelectCase: (caseId: string) => void;
  onClose: () => void;
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  others: Notice[];
  onSwitch: (astronautId: string, caseId: string) => void;
  reviewer: string;
};

const STATE_STYLE: Record<NodeState | "replay", string> = {
  done: "border-[var(--mg-line-strong)] text-[var(--mg-dim)]",
  running: "border-[var(--mg-cyan)] bg-[var(--mg-cyan-soft)] text-[var(--mg-text)]",
  human: "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] text-[var(--mg-text)]",
  waiting: "border-dashed border-[var(--mg-cyan)] text-[var(--mg-text)]",
  stopped: "border-[var(--mg-caution)] bg-[rgba(241,200,120,0.1)] text-[var(--mg-text)]",
  todo: "border-[var(--mg-line)] text-[var(--mg-faint)]",
  skipped: "border-dashed border-[var(--mg-line)] text-[var(--mg-faint)]",
  replay: "border-[var(--mg-cyan)] bg-[var(--mg-cyan-soft)] text-[var(--mg-text)]",
};
const STATE_ICON: Record<NodeState | "replay", string> = { done: "✓", running: "◐", human: "●", waiting: "◷", stopped: "■", todo: "○", skipped: "–", replay: "▸" };
const STATE_WORD: Record<NodeState, string> = { done: "已完成", running: "处理中", human: "需要基地决定", waiting: "等待回传", stopped: "停在这里", todo: "未到达", skipped: "未执行" };

const REASONS: Record<Decision, string[]> = {
  approve: ["多项指标同向偏离，按标准协议复测确认", "数据质量问题，重新采集", "回复宇航员报告，安排一次标准化测量"],
  reject: ["证据不足，暂不派发", "现场已另行处理"],
  close: ["复测回到参考范围，结合值班评估关闭", "结果在参考范围内，记录后关闭"],
  "keep-open": ["复测正常但需继续观察", "等待更多数据后再决定"],
};
const DECISION_WORD: Record<Decision, string> = { approve: "批准并派发", reject: "驳回建议", close: "关闭事件", "keep-open": "继续关注" };

function primaryLabel(d: Decision, c: Case): string {
  const ev = latest(c);
  if (d !== "approve") return DECISION_WORD[d];
  if (ev.trigger === "report") return "查看并回复、安排测量";
  if (ev.version > 1) return "查看并再次派发复测";
  return ev.result.outcome === "quality-blocked" ? "查看并派发重新采集" : "查看并派发复测";
}

/** Near-full-screen analysis and communication panel for one astronaut. Closing it changes nothing in the flow. */
export function PersonPanel(p: Props) {
  const { state, mock, astronautId } = p;
  const now = useNow();
  const visible = usePageVisible();
  const card = crewCards(state, { mock }).find((x) => x.astronautId === astronautId);
  const c = p.caseId ? state.cases[p.caseId] : null;
  const flow = c ? buildFlow(state, c, { mock }) : null;
  const [tab, setTab] = useState<"analysis" | "comms">("analysis");
  const [confirm, setConfirm] = useState<{ decision: Decision; trigger: HTMLElement | null } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Mark the shown case as viewed by the base (only while the page is visible). Never a confirmation or a close.
  const unread = c ? unreadEntries(state, c).length : 0;
  const caseId = c?.caseId ?? null;
  const { view } = p.api;
  useEffect(() => {
    if (caseId && visible && unread > 0) view(caseId);
  }, [caseId, visible, unread, view]);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  // Esc collapses the panel wherever focus is (e.g. after using the demo drawer); the confirmation handles its own Esc first.
  const { onClose } = p;
  const confirmOpen = confirm !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmOpen && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmOpen, onClose]);

  const source = c ? (c.evaluations[0]?.trigger === "report" ? "HUD 报告" : "设备观测") : "–";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="person-panel-title"
      className="fixed inset-2 z-40 flex flex-col overflow-hidden rounded-2xl border border-[var(--mg-line-strong)] bg-[var(--mg-bg)] shadow-2xl sm:inset-3"
      data-testid="person-panel"
      data-astronaut={astronautId}
      data-case={caseId ?? ""}
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--mg-line)] px-4 py-2.5">
        <div>
          <h2 id="person-panel-title" className="text-[18px] font-semibold">
            {card?.callsign ?? astronautId}
          </h2>
          <p className="text-[12px] text-[var(--mg-dim)]">{`${card?.task ?? "–"} · 任务时长 ${duration(card?.evaStartedAt ?? null, now)}`}</p>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <div>
            <dt className="text-[var(--mg-faint)]">{"设备连接"}</dt>
            <dd data-testid="panel-connection">{card?.connection.text ?? "–"}</dd>
          </div>
          <div>
            <dt className="text-[var(--mg-faint)]">{"异常来源"}</dt>
            <dd>{source}</dd>
          </div>
          <div>
            <dt className="text-[var(--mg-faint)]">{"当前阶段"}</dt>
            <dd className="font-medium" data-testid="panel-where">
              {flow?.where ?? "暂无事件"}
            </dd>
          </div>
        </dl>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {p.others.length ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--mg-faint)]">{"其他人员新消息（不打断当前处理）："}</span>
              <NotificationBar notes={p.others} onOpen={p.onSwitch} compact />
            </div>
          ) : null}
          <span className="rounded-full border border-[var(--mg-coral)] px-2 py-0.5 text-[11px] font-semibold text-[var(--mg-coral)]">{"模拟数据 / 模拟分析"}</span>
          <button ref={closeRef} type="button" onClick={p.onClose} className="min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3 text-[13px]" data-testid="panel-close">
            {"收起，返回总览（Esc）"}
          </button>
        </div>
      </header>

      {card && card.cases.length > 1 ? (
        <nav aria-label="该宇航员的事件" className="flex flex-wrap gap-1.5 border-b border-[var(--mg-line)] px-4 py-1.5" data-testid="panel-case-switch">
          {card.cases.map((x, i) => (
            <button key={x.caseId} type="button" aria-pressed={x.caseId === caseId} onClick={() => p.onSelectCase(x.caseId)} className={`rounded-lg border px-2 py-1 text-[12px] ${x.caseId === caseId ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)]" : "border-[var(--mg-line)]"}`} data-testid={`panel-case-${x.caseId}`}>
              {`事件 ${i + 1} · ${x.source} · ${x.text}`}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="flex gap-1 border-b border-[var(--mg-line)] px-4 py-1 lg:hidden" role="tablist" aria-label="面板内容">
        {(["analysis", "comms"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 text-[13px] ${tab === t ? "bg-[var(--mg-coral-soft)] font-semibold" : ""}`} data-testid={`panel-tab-${t}`}>
            {t === "analysis" ? "分析" : "通信"}
          </button>
        ))}
      </div>

      {c && flow ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section aria-label="数据与分析链路" className={`${tab === "comms" ? "hidden lg:flex" : "flex"} min-h-0 flex-col gap-3 overflow-y-auto p-4`} data-testid="panel-analysis">
            <Facts c={c} flow={flow} />
            <Track key={c.caseId} c={c} flow={flow} now={now} onDecide={(decision, trigger) => setConfirm({ decision, trigger })} onResend={p.api.resend} />
          </section>
          <section aria-label="通信与当前操作" className={`${tab === "analysis" ? "hidden lg:flex" : "flex"} min-h-0 flex-col gap-3 border-t border-[var(--mg-line)] p-4 lg:border-l lg:border-t-0`} data-testid="panel-comms">
            <CurrentCard flow={flow} now={now} />
            <CommList items={commStream(state, c, { mock })} />
          </section>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-[14px] text-[var(--mg-dim)]">{"该宇航员当前没有事件。设备观测或宇航员报告到达后，这里会自动显示分析与通信。"}</div>
      )}

      {confirm && c ? (
        <ConfirmDecision
          c={c}
          decision={confirm.decision}
          reviewer={p.reviewer}
          draft={p.drafts[`${c.caseId}:${confirm.decision}`] ?? ""}
          setDraft={(v) => p.setDraft(`${c.caseId}:${confirm.decision}`, v)}
          onCancel={() => {
            const t = confirm.trigger;
            setConfirm(null);
            t?.focus();
          }}
          onConfirm={(reason) => {
            const err = p.api.review(c.caseId, latest(c).version, confirm.decision, reason, p.reviewer);
            if (!err) {
              p.setDraft(`${c.caseId}:${confirm.decision}`, "");
              setConfirm(null);
              closeRef.current?.focus();
            }
            return err;
          }}
        />
      ) : null}
    </div>
  );
}

/** Where the data is, why it stopped there, who acts — plus case status and latest result, kept apart. */
function Facts({ c, flow }: { c: Case; flow: FlowView }) {
  const st = caseStatus(c);
  const ev = evaluationStatus(latest(c));
  return (
    <div className="flex flex-col gap-2" data-testid="panel-facts">
      <div className="grid gap-2 sm:grid-cols-[1.1fr_1.6fr_0.8fr]">
        {[
          ["数据到了哪一步", flow.where, "panel-fact-where"],
          ["为什么停在这里", flow.why, "panel-fact-why"],
          ["该由谁处理", flow.who === "无" ? "无需处理" : flow.who, "panel-fact-who"],
        ].map(([k, v, id]) => (
          <div key={id} className="rounded-xl border border-[var(--mg-line)] bg-[var(--mg-glass)] px-3 py-2">
            <p className="text-[11px] text-[var(--mg-faint)]">{k}</p>
            <p className={`text-[14px] font-semibold leading-snug ${id === "panel-fact-who" && flow.who === "基地人员" ? "text-[var(--mg-coral)]" : ""}`} data-testid={id}>
              {v}
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-[12px]">
        <span className={`rounded-md border px-2 py-0.5 ${TONE_BORDER[st.tone]} ${TONE_TEXT[st.tone]}`} data-testid="panel-case-status">{`事件状态：${st.label}`}</span>
        <span className={`rounded-md border px-2 py-0.5 ${TONE_BORDER[ev.tone]} ${TONE_TEXT[ev.tone]}`} data-testid="panel-eval-status">
          {ev.label}
        </span>
        {flow.noticePending ? (
          <span className="rounded-md border border-dashed border-[var(--mg-cyan)] px-2 py-0.5 text-[var(--mg-cyan)]" data-testid="panel-notice-pending">
            {flow.noticePending}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const LINE_FILL: Keyframe[] = [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }];
const LINE_OPTS: KeyframeAnimationOptions = { duration: 550, easing: "ease-out" };
const ARRIVE: Keyframe[] = [{ transform: "translateY(4px)", opacity: 0.4 }, { transform: "none", opacity: 1 }];
const ARRIVE_OPTS: KeyframeAnimationOptions = { duration: 450, easing: "ease-out" };

/** Connector into a node; the line fills once when the data reaches that node (presentation only). */
function Connector({ animKey, lit }: { animKey: string | null; lit: boolean }) {
  const ref = useOnceAnimation<HTMLSpanElement>(animKey, LINE_FILL, LINE_OPTS);
  return (
    <span aria-hidden className="relative mx-1 hidden h-0.5 w-5 shrink-0 self-center bg-[var(--mg-line)] sm:block">
      <span ref={ref} className={`absolute inset-0 origin-left ${lit ? "bg-[var(--mg-cyan)]" : "bg-transparent"}`} />
    </span>
  );
}

function NodeChip({ n, visual, active, current, animKey, onClick }: { n: FlowNode; visual: NodeState | "replay"; active: boolean; current: boolean; animKey: string | null; onClick: () => void }) {
  const ref = useOnceAnimation<HTMLButtonElement>(animKey, ARRIVE, ARRIVE_OPTS);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-current={current ? "step" : undefined}
      aria-pressed={active}
      className={`flex min-w-0 flex-1 flex-col items-start rounded-xl border px-2.5 py-1.5 text-left ${STATE_STYLE[visual]} ${active ? "ring-2 ring-[var(--mg-coral)] ring-offset-1 ring-offset-[var(--mg-bg)]" : ""}`}
      data-testid={`node-${n.id}`}
      data-state={n.state}
    >
      <span className={`text-[12px] font-semibold ${visual === "running" ? "animate-pulse" : ""}`}>{`${STATE_ICON[visual]} ${n.label}`}</span>
      <span className="line-clamp-2 text-[11px] leading-snug opacity-90">{visual === "replay" ? "回放中…" : n.summary}</span>
    </button>
  );
}

/** Rows of the flow: finished rows fold into one sentence; the current row shows its nodes and the open node's detail. */
function Track({ c, flow, now, onDecide, onResend }: { c: Case; flow: FlowView; now: number; onDecide: (d: Decision, trigger: HTMLElement) => void; onResend: (eventId: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ rowId: string; step: number; total: number } | null>(null);
  useEffect(() => {
    if (!replay) return;
    const t = setInterval(() => setReplay((r) => (r && r.step < r.total ? { ...r, step: r.step + 1 } : null)), prefersReducedMotion() ? 400 : 750);
    return () => clearInterval(t);
  }, [replay]);
  const main = flow.rows.filter((r) => r.lane === "main");
  const notice = flow.rows.find((r) => r.lane === "notice");
  return (
    <div className="flex flex-col gap-2" data-testid="panel-track">
      {flow.finished ? <ProcessSummary c={c} flow={flow} /> : null}
      {main.map((row) => {
        const isCurrent = !flow.finished && row.id === flow.current?.rowId;
        const replaying = replay?.rowId === row.id;
        // Rows that stopped somewhere stay open by default, so the stop and its reason remain visible.
        const stoppedHere = row.nodes.some((n) => n.state === "stopped");
        const expanded = isCurrent || (open[row.id] ?? stoppedHere) || replaying;
        const canReplay = row.id.endsWith(":analysis") && row.nodes.every((n) => n.state !== "running" && n.state !== "todo");
        return (
          <article key={row.id} className={`rounded-2xl border p-3 ${isCurrent ? "border-[var(--mg-coral)]/60 bg-[var(--mg-glass)]" : "border-[var(--mg-line)]"}`} data-testid={`row-${row.id}`} data-current={isCurrent ? "yes" : "no"}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold">{row.title}</h3>
              {!isCurrent ? (
                <button type="button" className="text-[12px] text-[var(--mg-dim)] underline" onClick={() => setOpen((o) => ({ ...o, [row.id]: !expanded }))} aria-expanded={expanded} data-testid={`row-toggle-${row.id}`}>
                  {expanded ? "收起" : "展开"}
                </button>
              ) : null}
              {canReplay ? (
                <button type="button" className="ml-auto text-[12px] text-[var(--mg-cyan)] underline" onClick={() => setReplay(replaying ? null : { rowId: row.id, step: 0, total: row.nodes.length })} data-testid={`row-replay-${row.id}`}>
                  {replaying ? "停止回放" : "回放分析过程"}
                </button>
              ) : null}
            </div>
            {replaying ? <p className="mt-1 text-[11px] text-[var(--mg-cyan)]" data-testid="replay-note">{"回放中：仅改变显示，不重新分析、不发布消息、不改变处理状态。"}</p> : null}
            {expanded ? (
              <>
                <ol className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-stretch sm:gap-0">
                  {row.nodes.map((n, i) => {
                    const isCur = isCurrent && flow.current?.node.id === n.id;
                    const visual: NodeState | "replay" = replaying ? (i < replay!.step ? "done" : i === replay!.step ? "replay" : "todo") : n.state;
                    const key = isCur ? `${c.caseId}:${n.id}:${n.state}` : null;
                    return (
                      <li key={n.id} className="flex min-w-0 flex-1 items-stretch">
                        {i > 0 ? <Connector animKey={key} lit={visual !== "todo" && visual !== "skipped"} /> : null}
                        <NodeChip n={n} visual={visual} active={(focus ?? flow.current?.node.id) === n.id && !replaying} current={isCur} animKey={key} onClick={() => setFocus(focus === n.id ? null : n.id)} />
                      </li>
                    );
                  })}
                </ol>
                {(() => {
                  const target = row.nodes.find((n) => n.id === (focus ?? (isCurrent ? flow.current?.node.id : null)));
                  return target && !replaying ? <NodeDetail c={c} n={target} isCurrent={isCurrent && flow.current?.node.id === target.id} now={now} onDecide={onDecide} onResend={onResend} onBack={focus ? () => setFocus(null) : null} /> : null;
                })()}
              </>
            ) : (
              <p className="mt-1 line-clamp-1 text-[12px] text-[var(--mg-dim)]" data-testid={`row-summary-${row.id}`}>
                {rowSentence(row)}
              </p>
            )}
          </article>
        );
      })}
      {notice ? (
        <article className="rounded-2xl border border-dashed border-[var(--mg-line-strong)] p-3" data-testid="row-notice">
          <h3 className="text-[13px] font-semibold">{notice.title}</h3>
          <ol className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:gap-0">
            {notice.nodes.map((n, i) => (
              <li key={n.id} className="flex min-w-0 flex-1 items-stretch">
                {i > 0 ? <Connector animKey={null} lit={n.state !== "todo"} /> : null}
                <NodeChip n={n} visual={n.state} active={false} current={false} animKey={null} onClick={() => undefined} />
              </li>
            ))}
          </ol>
          {notice.nodes.some((n) => n.state === "waiting") ? <p className="mt-1 text-[12px] text-[var(--mg-dim)]">{`等待对象：HUD · 自 ${hhmmss(notice.nodes.find((n) => n.state === "waiting")!.since)} · 已等待 ${elapsed(notice.nodes.find((n) => n.state === "waiting")!.since, now)}`}</p> : null}
        </article>
      ) : null}
    </div>
  );
}

const rowSentence = (row: FlowRow) =>
  row.nodes
    .filter((n) => n.state !== "todo")
    .map((n) => (n.state === "stopped" ? `■ ${n.summary}` : n.summary))
    .join(" → ");

/** After closing: one expandable summary of the whole handling. */
function ProcessSummary({ c, flow }: { c: Case; flow: FlowView }) {
  const close = c.reviews.filter((r) => r.decision === "close").at(-1);
  return (
    <section className="rounded-2xl border border-[var(--mg-ok)] bg-[rgba(132,216,166,0.06)] p-3" data-testid="process-summary">
      <p className="text-[14px] font-semibold text-[var(--mg-ok)]">{"✓ 处理完成：事件已由基地人员关闭"}</p>
      <ul className="mt-1 space-y-0.5 text-[12px] text-[var(--mg-dim)]">
        {c.evaluations.map((e) => (
          <li key={e.version}>{`v${e.version}（${e.trigger === "report" ? "宇航员报告" : e.trigger === "retest" ? "复测" : "设备观测"}）：${e.result.headline}`}</li>
        ))}
        {c.reviews.map((r, i) => (
          <li key={i}>{`${hhmmss(r.at)} · ${r.reviewer}：${DECISION_WORD[r.decision]}（v${r.version}）— ${r.reason}`}</li>
        ))}
        {close ? <li>{`告警由 ${close.reviewer} 人工解除。`}</li> : null}
        <li>{flow.noticePending ? `状态通知：${flow.noticePending}（与处理完成分开记录）` : "状态通知：HUD 已接收"}</li>
      </ul>
      <p className="mt-1 text-[11px] text-[var(--mg-faint)]">{"下面各轮可展开查看证据与回放。"}</p>
    </section>
  );
}

/** The open node: input → processing → output, evidence on demand, and the action beside it. */
function NodeDetail({ c, n, isCurrent, now, onDecide, onResend, onBack }: { c: Case; n: FlowNode; isCurrent: boolean; now: number; onDecide: (d: Decision, trigger: HTMLElement) => void; onResend: (eventId: string) => void; onBack: (() => void) | null }) {
  const action = isCurrent ? n.action : null;
  return (
    <section className="mt-2 rounded-xl border border-[var(--mg-line)] bg-[rgba(255,255,255,0.03)] p-3" data-testid="node-detail" data-node={n.id} data-state={n.state}>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-[14px] font-semibold">{n.label}</p>
        <span className="text-[12px] text-[var(--mg-dim)]">{isCurrent ? `当前 · ${STATE_WORD[n.state]}` : STATE_WORD[n.state]}</span>
        {n.at ? <span className="text-[11px] text-[var(--mg-faint)]">{hhmmss(n.at)}</span> : null}
        {onBack ? (
          <button type="button" className="ml-auto text-[12px] text-[var(--mg-dim)] underline" onClick={onBack}>
            {"回到当前节点"}
          </button>
        ) : null}
      </div>
      {n.reason && (n.state === "stopped" || n.state === "human" || n.state === "waiting") ? (
        <p className={`mt-1 text-[13px] ${n.state === "stopped" ? "text-[var(--mg-caution)]" : n.state === "human" ? "text-[var(--mg-coral)]" : "text-[var(--mg-cyan)]"}`} data-testid="node-reason">
          {n.reason}
        </p>
      ) : null}
      {n.state === "waiting" && isCurrent ? (
        <p className="mt-1 text-[12px] text-[var(--mg-dim)]" data-testid="node-waiting">{`等待对象：${n.owner} · 开始 ${hhmmss(n.since)} · 已等待 ${elapsed(n.since, now)}`}</p>
      ) : null}
      <div className="mt-2 grid gap-3 text-[12px] sm:grid-cols-3">
        <Col title="输入">{n.input.length ? <ul className="space-y-0.5">{n.input.map((x) => <li key={x}>{x}</li>)}</ul> : "–"}</Col>
        <Col title="处理摘要">{n.result ?? (n.state === "running" ? "处理中…" : "–")}</Col>
        <Col title="输出 / 下一步">{n.next ?? "–"}</Col>
      </div>
      {n.indicators.length ? <IndicatorChart items={n.indicators} /> : null}
      {n.relation ? (
        <p className="mt-2 rounded-lg border border-[var(--mg-line)] p-2 text-[12px]" data-testid="node-relation">
          {`原测量与复测的适用关系：${n.relation}`}
        </p>
      ) : null}
      {n.evidence.length && n.state !== "running" ? (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer text-[var(--mg-dim)]">{`查看证据（${n.evidence.length}）`}</summary>
          <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-[var(--mg-dim)] sm:grid-cols-2" data-testid="node-evidence">
            {n.evidence.map((e) => (
              <li key={e.label} className={e.ok === false ? "text-[var(--mg-caution)]" : ""}>{`${e.ok === null ? "·" : e.ok ? "✓" : "✕"} ${e.label}：${e.value}${e.note ? `（${e.note}）` : ""}`}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {action?.kind === "decide" && action.options.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--mg-line)] pt-3" data-testid="node-actions">
          {action.primary ? (
            <button id="panel-primary-action" type="button" onClick={(e) => onDecide(action.primary!, e.currentTarget)} className="min-h-10 rounded-xl bg-[var(--mg-coral)] px-4 text-[14px] font-semibold text-[#1a0f0c]" data-testid={`decide-${action.primary}`}>
              {primaryLabel(action.primary, c)}
            </button>
          ) : null}
          {action.options
            .filter((d) => d !== action.primary)
            .map((d) => (
              <button key={d} type="button" onClick={(e) => onDecide(d, e.currentTarget)} className="min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3 text-[13px]" data-testid={`decide-${d}`}>
                {action.primary ? DECISION_WORD[d] : `${DECISION_WORD[d]}…`}
              </button>
            ))}
          <span className="text-[11px] text-[var(--mg-faint)]">{action.primary === "approve" ? "建议仅基地可见，尚未发送。" : action.primary ? "只发布状态通知，不发送行动消息。" : ""}</span>
        </div>
      ) : null}
      {action?.kind === "resend" ? (
        <div className="mt-3 border-t border-[var(--mg-line)] pt-3">
          <button type="button" onClick={() => action.eventIds.forEach(onResend)} className="min-h-9 rounded-lg border border-[var(--mg-caution)] px-3 text-[13px] text-[var(--mg-caution)]" data-testid="action-resend">
            {"重发同一条消息"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Col({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-[var(--mg-faint)]">{title}</p>
      <div className="mt-0.5 text-[var(--mg-text)]">{children}</div>
    </div>
  );
}

/** Summary indicators only (never a raw sEMG waveform): reference band = individual baseline ± 2 SD. */
function IndicatorChart({ items }: { items: IndicatorView[] }) {
  const paired = items.some((i) => i.before);
  return (
    <div className="mt-3 flex flex-col gap-1.5" data-testid="indicator-chart">
      {items.map((i) => {
        const values = [i.mean - 4 * i.sd, i.mean + 4 * i.sd, i.after.value, ...(i.before ? [i.before.value] : [])];
        const lo = Math.min(...values);
        const hi = Math.max(...values);
        const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
        return (
          <div key={i.key} className="grid grid-cols-[8.5rem_minmax(0,1fr)_8.5rem] items-center gap-2 text-[12px]" data-testid={`indicator-${i.key}`}>
            <div>
              <p className="font-medium">{`${i.label}（${i.unit}）`}</p>
              <p className="text-[11px] text-[var(--mg-faint)]">{i.source}</p>
            </div>
            <div className="relative h-6" role="img" aria-label={`${i.label}：参考范围 ${i.mean - 2 * i.sd}–${i.mean + 2 * i.sd}${i.before ? `，v${i.before.version} ${i.before.value}` : ""}，v${i.after.version} ${i.after.value}`}>
              <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--mg-line-strong)]" />
              <span className="absolute bottom-1 top-1 rounded bg-[rgba(132,216,166,0.18)]" style={{ left: x(i.mean - 2 * i.sd), width: `calc(${x(i.mean + 2 * i.sd)} - ${x(i.mean - 2 * i.sd)})` }} />
              <span className="absolute bottom-0.5 top-0.5 w-px bg-[var(--mg-dim)]" style={{ left: x(i.mean) }} title={`个体基线均值 ${i.mean}`} />
              {i.before ? <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--mg-dim)] bg-[var(--mg-bg)]" style={{ left: x(i.before.value) }} title={`v${i.before.version}：${i.before.value}（z ${i.before.z}）`} /> : null}
              <span className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--mg-bg)] ${i.after.flagged ? "bg-[var(--mg-caution)]" : "bg-[var(--mg-text)]"}`} style={{ left: x(i.after.value) }} title={`v${i.after.version}：${i.after.value}（z ${i.after.z}）`} />
            </div>
            <p className="text-right tabular-nums">
              {i.before ? <span className="text-[var(--mg-dim)]">{`${i.before.value}${i.before.flagged ? " ⚑" : ""} → `}</span> : null}
              <span className={i.after.flagged ? "text-[var(--mg-caution)]" : ""}>{`${i.after.value}${i.after.flagged ? " ⚑" : ""}`}</span>
              <span className="ml-1 text-[11px] text-[var(--mg-faint)]">{`z ${i.after.z > 0 ? "+" : ""}${i.after.z.toFixed(2)}`}</span>
            </p>
          </div>
        );
      })}
      <p className="text-[11px] text-[var(--mg-faint)]">{`绿色区 = 参考范围（个体基线 ± 2 SD，演示阈值）· 竖线 = 基线均值 · ⚑ = 超出参考范围${paired ? " · ○ 原测量 → ● 复测（两次都可比时才并列，不计算改善幅度）" : ""} · 只有汇总指标，没有原始肌电波形。`}</p>
    </div>
  );
}

/** Right column, top: what is happening now, in words (waiting: whom, since when, how long). */
function CurrentCard({ flow, now }: { flow: FlowView; now: number }) {
  const n = flow.current?.node;
  let body: ReactNode;
  if (flow.finished) body = <p className="text-[14px] font-semibold text-[var(--mg-ok)]">{"处理完成：事件已关闭"}</p>;
  else if (!n) body = null;
  else if (n.state === "human" || n.state === "stopped")
    body = (
      <>
        <p className="text-[14px] font-semibold text-[var(--mg-coral)]">{n.state === "human" ? `需要你决定：${n.label}` : `停在：${n.label}`}</p>
        <button type="button" className="mt-1 text-[12px] text-[var(--mg-dim)] underline" onClick={() => document.getElementById("panel-primary-action")?.focus()}>
          {"操作在左侧当前节点旁 →"}
        </button>
      </>
    );
  else if (n.state === "waiting")
    body = (
      <>
        <p className="text-[14px] font-semibold text-[var(--mg-cyan)]">{`等待 ${n.owner}：${n.label}`}</p>
        <p className="text-[12px] text-[var(--mg-dim)]" data-testid="current-waiting">{`开始 ${hhmmss(n.since)} · 已等待 ${elapsed(n.since, now)} · 只在收到对应回传后更新`}</p>
      </>
    );
  else body = <p className="text-[14px] font-semibold text-[var(--mg-cyan)]">{"系统正在处理（模拟分析）· 无需操作"}</p>;
  return (
    <div className="rounded-xl border border-[var(--mg-line)] bg-[var(--mg-glass)] p-3" data-testid="panel-current">
      <p className="text-[11px] text-[var(--mg-faint)]">{"当前操作"}</p>
      {body}
      {flow.noticePending ? <p className="mt-1 text-[12px] text-[var(--mg-cyan)]">{`另：${flow.noticePending}`}</p> : null}
    </div>
  );
}

const KIND_STYLE: Record<CommItem["kind"], string> = {
  report: "border-[var(--mg-caution)]",
  analysis: "border-dashed border-[var(--mg-line-strong)]",
  decision: "border-[var(--mg-line)]",
  action: "border-[var(--mg-coral)]",
  receipt: "border-[var(--mg-line)]",
  feedback: "border-[var(--mg-cyan)]",
  result: "border-[var(--mg-cyan)]",
  status: "border-[var(--mg-ok)]",
};
const LINE_ICON = { done: "✓", pending: "○", failed: "!", local: "·" } as const;

/** Structured communication stream of the case (newest at the bottom). */
function CommList({ items }: { items: CommItem[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-[11px] text-[var(--mg-faint)]">{"通信与记录（本事件）· 内部分析默认不发送给 HUD"}</p>
      <ol ref={ref} className="mt-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1" data-testid="comm-list">
        {items.map((it) => (
          <li key={it.id} className={`rounded-xl border bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5 ${KIND_STYLE[it.kind]}`} data-kind={it.kind} data-testid={`comm-${it.kind}`}>
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-medium">{it.title}</span>
              <span className="ml-auto shrink-0 text-[11px] text-[var(--mg-faint)]">{hhmmss(it.at).slice(0, 8)}</span>
            </div>
            <p className="text-[10px] text-[var(--mg-faint)]">{COMM_BADGE[it.kind]}</p>
            {it.text ? <p className="whitespace-pre-line text-[12px] text-[var(--mg-dim)]">{it.text}</p> : null}
            {it.lines.length ? (
              <ul className="mt-1 space-y-0.5 text-[11px]">
                {it.lines.map((l) => (
                  <li key={l.label} className={`flex gap-1.5 ${l.state === "failed" ? "text-[var(--mg-caution)]" : l.state === "done" ? "text-[var(--mg-text)]" : "text-[var(--mg-faint)]"}`} data-line={l.label} data-state={l.state}>
                    <span aria-hidden className="w-3 text-center">{LINE_ICON[l.state]}</span>
                    <span>{l.label}</span>
                    <span className="ml-auto">{l.value}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

const CONDITIONS: Record<Decision, string> = {
  approve: "发布后由 HUD 显示；宇航员确认后按标准协议执行。基站只在收到 HUD 回传后更新接收、确认和复测结果，不按时间推断。",
  reject: "建议不发布，不发送任何消息；事件保持未关闭、告警保持，之后由基地人员关闭或继续关注。",
  close: "事件关闭、告警解除；只发布状态通知，不再发送行动消息。迟到的回传只记录，不会重新打开事件。",
  "keep-open": "事件保持未关闭、告警保持；只发布状态通知，不发送行动消息。之后可随时关闭。",
};

/** Compact confirmation: the actual content to send, the execution conditions and a reason (templates are editable). */
function ConfirmDecision({ c, decision, reviewer, draft, setDraft, onCancel, onConfirm }: { c: Case; decision: Decision; reviewer: string; draft: string; setDraft: (v: string) => void; onCancel: () => void; onConfirm: (reason: string) => string | null }) {
  const ev = latest(c);
  const cand = ev.result.candidate;
  const status = statusNoticeText(c, decision);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textRef.current?.focus();
  }, []);
  const outgoing: string[] = decision === "approve" && cand && cand.kind !== "record-only" ? [...(cand.kind === "notice-and-retest" ? [`① 提示：${cand.notice.text}`] : []), `${cand.kind === "notice-and-retest" ? "②" : "①"} 复测任务：${cand.retest.instructions}`] : [];
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(5,9,16,0.6)] p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-xl rounded-2xl border border-[var(--mg-line-strong)] bg-[var(--mg-bg-2)] p-4 shadow-2xl" data-testid="confirm-dialog" data-decision={decision}>
        <h3 id="confirm-title" className="text-[16px] font-semibold">{`确认：${primaryLabel(decision, c)}`}</h3>
        <div className="mt-2 rounded-xl border border-[var(--mg-line)] p-2.5 text-[13px]" data-testid="confirm-content">
          {outgoing.length ? (
            <>
              <p className="text-[11px] text-[var(--mg-faint)]">{`将发送给 HUD 的行动消息（${outgoing.length} 条，实际内容）`}</p>
              {outgoing.map((t) => (
                <p key={t} className="mt-1">
                  {t}
                </p>
              ))}
              {status ? <p className="mt-1 text-[12px] text-[var(--mg-dim)]">{`另发布状态通知：${status}`}</p> : null}
            </>
          ) : status ? (
            <>
              <p className="text-[11px] text-[var(--mg-faint)]">{"将发布的状态通知（仅告知事件状态，不是行动）"}</p>
              <p className="mt-1">{status}</p>
            </>
          ) : (
            <p>{"不发送任何消息。"}</p>
          )}
        </div>
        <p className="mt-2 text-[12px] text-[var(--mg-dim)]">
          <span className="text-[var(--mg-faint)]">{"执行条件："}</span>
          {CONDITIONS[decision]}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="常用理由（可编辑）">
          {REASONS[decision].map((r) => (
            <button key={r} type="button" onClick={() => setDraft(r)} className="rounded-full border border-[var(--mg-line-strong)] px-2 py-0.5 text-[12px]" data-testid="reason-template">
              {r}
            </button>
          ))}
        </div>
        <label className="mt-2 flex flex-col gap-1 text-[12px] text-[var(--mg-dim)]">
          {"理由（必填，记录在案；可选用上面的常用理由再修改）"}
          <textarea ref={textRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1 text-[13px] text-[var(--mg-text)]" data-testid="confirm-reason" />
        </label>
        <p className="mt-1 text-[12px] text-[var(--mg-faint)]">{`审核人：${reviewer}（当前演示身份）`}</p>
        {error ? (
          <p role="alert" className="mt-1 text-[12px] text-[var(--mg-caution)]" data-testid="confirm-error">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3 text-[13px]" data-testid="confirm-cancel">
            {"取消（草稿保留）"}
          </button>
          <button type="button" onClick={() => setError(onConfirm(draft))} className="min-h-9 rounded-lg bg-[var(--mg-coral)] px-4 text-[13px] font-semibold text-[#1a0f0c]" data-testid="confirm-submit">
            {decision === "approve" ? "确认并发布" : `确认${DECISION_WORD[decision]}`}
          </button>
        </div>
      </div>
    </div>
  );
}
