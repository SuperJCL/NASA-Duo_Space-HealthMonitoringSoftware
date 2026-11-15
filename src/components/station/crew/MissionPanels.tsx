"use client";

import type { ReactNode } from "react";
import type { CrewCardView } from "@/lib/station/crew";
import { CONDITION_NOTES, MISSION_CREW, PHASE_LABEL, runTask, type MissionDef, type MissionPhase, type MissionTask } from "@/lib/station/mission";
import type { StationState } from "@/lib/station/station";

export type StationView = "map" | "health";
const hhmm = (iso: string | null | undefined) => (iso ? `${new Date(iso).toISOString().slice(11, 16)} UTC` : "–");

/** Cards with a health event waiting for base staff (what "待处理" counts). */
export const pendingCards = (cards: CrewCardView[]) => cards.filter((c) => c.needsBase > 0 && c.event);

/** Mission context row of the station header: always visible, in both views. */
export function MissionBar({ def, state, phase, view, onView, cards, onJump, onEndEva, canAct }: {
  def: MissionDef | null;
  state: StationState;
  phase: MissionPhase;
  view: StationView;
  onView: (v: StationView) => void;
  cards: CrewCardView[];
  onJump: (astronautId: string, caseId: string) => void;
  onEndEva: () => void;
  canAct: boolean;
}) {
  const run = state.run;
  const task = runTask(def, state);
  const pending = pendingCards(cards);
  const pendingCount = pending.reduce((n, c) => n + c.needsBase, 0);
  const tab = (v: StationView, label: string) => (
    <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => onView(v)} className={`min-h-9 rounded-lg px-3 text-[13px] ${view === v ? "bg-[var(--mg-surface)] font-semibold text-[var(--mg-text)]" : "text-[var(--mg-dim)] hover:text-[var(--mg-text)]"}`} data-testid={`view-${v}`}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--mg-line)] px-5 py-2 text-[13px]" data-testid="mission-bar">
      <div role="tablist" aria-label="基站视图" className="flex rounded-xl border border-[var(--mg-line)] p-0.5">
        {tab("map", "任务地图")}
        {tab("health", "健康监测")}
      </div>
      <span data-testid="mission-name">{`任务：${def?.title ?? "未加载"}（模拟）`}</span>
      <span className={`rounded-full border px-2.5 py-0.5 ${phase === "eva-active" ? "border-[var(--mg-ok)] text-[var(--mg-ok)]" : "border-[var(--mg-line-strong)] text-[var(--mg-dim)]"}`} data-testid="mission-phase" data-phase={phase}>
        {PHASE_LABEL[phase]}
      </span>
      <span className="text-[var(--mg-dim)]" data-testid="mission-task">
        {run ? `EVA 任务：${run.task.title}${task ? ` → ${task.targetName}` : ""} · 执行：${run.astronaut.callsign}` : "尚未开始 EVA"}
      </span>
      <button
        type="button"
        disabled={!pending.length}
        onClick={() => pending[0]?.event && onJump(pending[0].astronautId, pending[0].event.caseId)}
        className={`rounded-full border px-2.5 py-0.5 ${pendingCount ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] font-semibold text-[var(--mg-text)]" : "border-[var(--mg-line)] text-[var(--mg-dim)]"}`}
        title={pendingCount ? "打开第一个需要基地处理的健康事件" : undefined}
        data-testid="mission-pending"
        data-count={pendingCount}
      >
        {`待处理健康事件 ${pendingCount}`}
      </button>
      {phase === "eva-active" ? (
        <button type="button" disabled={!canAct} onClick={onEndEva} className="ml-auto min-h-8 rounded-lg border border-[var(--mg-line-strong)] px-3 disabled:opacity-40" data-testid="eva-end-open">
          {"结束 EVA"}
        </button>
      ) : null}
    </div>
  );
}

/** Top of the map view: preparation (task → astronaut → summary → start) or the running / ended EVA. */
export function MissionStrip({ def, state, phase, selectedTask, astronautId, setAstronautId, onSummary, onJump, cards, canAct, mode, openCount, onResendStart }: {
  def: MissionDef | null;
  state: StationState;
  phase: MissionPhase;
  selectedTask: MissionTask | null;
  astronautId: string;
  setAstronautId: (id: string) => void;
  onSummary: () => void;
  onJump: (astronautId: string, caseId: string) => void;
  cards: CrewCardView[];
  canAct: boolean;
  mode: "relay" | "mock";
  openCount: number;
  onResendStart: (eventId: string) => void;
}) {
  const run = state.run;
  const runT = runTask(def, state);
  const pending = pendingCards(cards);
  const startMsg = state.pendingStart ? state.outbox.find((m) => m.eventId === state.pendingStart!.eventId) : null;
  const blocked = phase === "eva-ended" && openCount > 0;
  const prep = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="mission-prep">
      <span>
        <b className="mr-1 text-[var(--mg-coral)]">{"①"}</b>
        {selectedTask ? (
          <span data-testid="prep-task" data-task={selectedTask.taskId}>{`任务：${selectedTask.title} → ${selectedTask.targetName}（模拟目标，位置为场景设定）`}</span>
        ) : (
          <span className="text-[var(--mg-dim)]" data-testid="prep-task">{"在地图或右侧任务列表中选择一个任务"}</span>
        )}
      </span>
      <label className="flex items-center gap-1.5">
        <b className="text-[var(--mg-coral)]">{"②"}</b>
        {"执行宇航员"}
        <select value={astronautId} onChange={(e) => setAstronautId(e.target.value)} className="rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1" data-testid="prep-astronaut">
          {MISSION_CREW.map((m) => (
            <option key={m.id} value={m.id}>{`${m.callsign} · ${m.hud}`}</option>
          ))}
        </select>
      </label>
      <button type="button" disabled={!selectedTask || !canAct || blocked || mode !== "relay"} onClick={onSummary} className="min-h-9 rounded-lg bg-[var(--mg-coral)] px-3 font-semibold text-[#1a0f0c] disabled:opacity-40" data-testid="prep-summary">
        <b className="mr-1">{"③"}</b>
        {phase === "eva-ended" ? "查看任务摘要，开始下一次 EVA" : "查看任务摘要，开始 EVA"}
      </button>
      {mode !== "relay" ? <span className="text-[12px] text-[var(--mg-caution)]">{"独立演示模式不开始 EVA：EVA 运行由“本地模拟演示”启动。完整任务流程请使用联调模式（?relay=auto）。"}</span> : null}
      {!canAct && mode === "relay" ? <span className="text-[12px] text-[var(--mg-caution)]">{"只读窗口：另一基站窗口负责开始和结束 EVA。"}</span> : null}
      {blocked ? <span className="text-[12px] text-[var(--mg-caution)]" data-testid="prep-blocked">{`上一 EVA 还有 ${openCount} 个未关闭的健康事件：请先在健康监测中处理，再开始新的 EVA。`}</span> : null}
    </div>
  );
  let body: ReactNode;
  if (phase === "starting")
    body = (
      <p data-testid="mission-starting">
        {"正在开始 EVA：等待通信服务确认（确认后自动进入健康监测）。"}
        {startMsg && startMsg.delivery === "failed" ? (
          <>
            <span className="ml-2 text-[var(--mg-caution)]">{`发送失败：${startMsg.deliveryNote ?? "未知原因"}`}</span>
            <button type="button" onClick={() => onResendStart(startMsg.eventId)} className="ml-2 rounded border border-[var(--mg-line-strong)] px-2" data-testid="mission-start-resend">
              {"重发（同一消息）"}
            </button>
          </>
        ) : null}
      </p>
    );
  else if (phase === "eva-active" && run)
    body = (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="mission-active">
        <span>{`EVA 进行中（模拟，不代表真实出舱）：${run.task.title}${runT ? ` → ${runT.targetName}` : ""} · ${run.astronaut.callsign} · 开始于 ${hhmm(run.startedAt)}`}</span>
        {pending.length ? (
          pending.map((c) => (
            <button key={c.astronautId} type="button" onClick={() => onJump(c.astronautId, c.event!.caseId)} className="flex items-center gap-1.5 rounded-full border border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] px-3 py-1 text-[12px]" data-testid={`map-pending-${c.astronautId}`}>
              <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--mg-coral)]" />
              <b>{c.callsign}</b>
              <span>{c.event!.text}</span>
              <span className="text-[var(--mg-dim)]">{"→ 查看"}</span>
            </button>
          ))
        ) : (
          <span className="text-[var(--mg-dim)]" data-testid="map-pending-none">{"暂无需要基地处理的健康事件"}</span>
        )}
      </div>
    );
  else if (phase === "eva-ended" && run)
    body = (
      <div className="flex flex-col gap-2">
        <p data-testid="mission-ended">{`EVA 已结束（模拟）· ${run.task.title} · ${run.astronaut.callsign} · 结束于 ${hhmm(run.evaEndedAt)} · 未关闭的健康事件 ${openCount} 个（结束 EVA 不会关闭它们，也不表示健康正常）`}</p>
        {prep}
      </div>
    );
  else body = prep;
  return (
    <section aria-label="任务准备与 EVA 状态" className="border-b border-[var(--mg-line)] bg-[rgba(255,255,255,0.02)] px-5 py-2.5 text-[13px]" data-testid="mission-strip">
      {body}
    </section>
  );
}

function Dialog({ title, children, onClose, testid }: { title: string; children: ReactNode; onClose: () => void; testid: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${testid}-title`} className="mg-glass flex max-h-[90dvh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-2xl p-5 text-[14px]" data-testid={testid}>
        <h2 id={`${testid}-title`} className="text-[17px] font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** "查看任务摘要" → the human confirmation that starts the simulated EVA (one scenario.start). */
export function StartEvaDialog({ def, task, astronautId, onConfirm, onCancel, error }: { def: MissionDef; task: MissionTask; astronautId: string; onConfirm: () => void; onCancel: () => void; error: string | null }) {
  const crew = MISSION_CREW.find((m) => m.id === astronautId);
  return (
    <Dialog title="任务摘要 · 确认开始 EVA（模拟）" onClose={onCancel} testid="eva-start-dialog">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-[var(--mg-dim)]">{"任务"}</dt>
        <dd>{`${def.title}（${def.id}）`}</dd>
        <dt className="text-[var(--mg-dim)]">{"EVA 任务"}</dt>
        <dd data-testid="eva-start-task">{`${task.title}（${task.taskId}）`}</dd>
        <dt className="text-[var(--mg-dim)]">{"目标"}</dt>
        <dd>{`${task.targetName}（模拟目标，位置为场景设定，不是验证过的露头）`}</dd>
        <dt className="text-[var(--mg-dim)]">{"执行宇航员"}</dt>
        <dd data-testid="eva-start-crew">{crew ? `${crew.callsign} · ${crew.hud}` : astronautId}</dd>
        <dt className="text-[var(--mg-dim)]">{"健康数据"}</dt>
        <dd>{"数据回放模块的模拟样例（不是队友的健康数据）。"}</dd>
      </dl>
      <div className="rounded-xl border border-[var(--mg-line)] p-3 text-[13px]" data-testid="eva-start-conditions">
        <p className="mb-1 font-semibold">{"健康测量条件"}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-[var(--mg-dim)]">
          {CONDITION_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
      <p className="text-[12px] text-[var(--mg-faint)]">{"这是模拟 EVA：确认后基站发布一次运行开始（scenario.start），HUD 加入该运行；不代表宇航员真实出舱。选择任务、打开地图或切换视图都不会开始 EVA。"}</p>
      {error ? (
        <p className="text-[var(--mg-caution)]" data-testid="eva-start-error">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3">
          {"取消"}
        </button>
        {/* A second click is refused by the station itself (one start per EVA). */}
        <button type="button" onClick={onConfirm} className="min-h-9 rounded-lg bg-[var(--mg-coral)] px-4 font-semibold text-[#1a0f0c]" data-testid="eva-start-confirm">
          {"确认开始 EVA"}
        </button>
      </div>
    </Dialog>
  );
}

/** "结束EVA": a mission phase change; it closes no health event and says nothing about health. */
export function EndEvaDialog({ openCount, onConfirm, onCancel, error }: { openCount: number; onConfirm: () => void; onCancel: () => void; error: string | null }) {
  return (
    <Dialog title="结束 EVA（模拟）" onClose={onCancel} testid="eva-end-dialog">
      <ul className="list-disc space-y-1 pl-5">
        <li data-testid="eva-end-open-count">{openCount ? `${openCount} 个健康事件尚未关闭：结束 EVA 不会关闭它们，之后仍可在健康监测中处理。` : "当前没有未关闭的健康事件。"}</li>
        <li>{"不删除任何记录；任务结束后仍可查看事件与处置结果。"}</li>
        <li>{"结束 EVA 不表示宇航员健康正常。"}</li>
      </ul>
      {error ? <p className="text-[var(--mg-caution)]">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3">
          {"取消"}
        </button>
        <button type="button" onClick={onConfirm} className="min-h-9 rounded-lg border border-[var(--mg-caution)] px-4 font-semibold text-[var(--mg-caution)]" data-testid="eva-end-confirm">
          {"确认结束 EVA"}
        </button>
      </div>
    </Dialog>
  );
}
