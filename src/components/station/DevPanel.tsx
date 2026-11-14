"use client";

import { useRef, useState } from "react";
import { inboundEnvelope, type MockStationAdapter } from "@/lib/station/adapter";
import { DEMO_START, FIXTURES, RETEST_FIXTURES, type FixtureId, type RetestFixtureId } from "@/lib/station/fixtures";
import type { Envelope } from "@/lib/station/protocol";
import type { StationState } from "@/lib/station/station";

/**
 * DEVELOPMENT ONLY (shown with ?dev=1). Injects inbound events into the mock adapter as the Trigger
 * or the HUD would send them, to test the base station alone. It is not a Trigger or HUD page.
 */
export function DevPanel({ adapter, state, caseId }: { adapter: MockStationAdapter; state: StationState; caseId: string | null }) {
  const [open, setOpen] = useState(true);
  const runSeq = useRef(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [prevRunId, setPrevRunId] = useState<string | null>(null);
  const [last, setLast] = useState<Envelope | null>(null);
  const retestSeq = useRef(0);
  const [note, setNote] = useState("");

  const inject = (env: Envelope) => {
    setLast(env);
    adapter.inject(env);
    setNote(`已注入 ${env.type} · ${env.eventId}`);
  };
  const activeCase = caseId ? state.cases[caseId] : null;
  const latestHudMessage = (type?: string) => [...state.outbox].reverse().find((m) => m.caseId === caseId && (type ? m.type === type : m.type === "station.notice.approved" || m.type === "station.retest.requested"));
  // Notice / retest messages of the latest dispatch (highest evaluation version) for the current case.
  const dispatchMsgs = state.outbox.filter((m) => m.caseId === caseId && (m.type === "station.notice.approved" || m.type === "station.retest.requested"));
  const lastVersion = Math.max(0, ...dispatchMsgs.map((m) => (m.envelope.payload as { evaluationVersion: number }).evaluationVersion));
  const hudMessages = dispatchMsgs.filter((m) => (m.envelope.payload as { evaluationVersion: number }).evaluationVersion === lastVersion);
  const openRetest = activeCase?.retests.find((r) => r.status !== "result-received") ?? activeCase?.retests.at(-1);
  const btn = "min-h-8 rounded-lg border border-[var(--mg-line-strong)] px-2 text-[12px] disabled:opacity-40";

  return (
    <aside className="fixed bottom-3 left-3 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-dashed border-[#d678ff] bg-[rgba(11,17,28,0.96)] p-3 text-[12px] shadow-2xl" aria-label="开发测试入口" data-testid="station-dev">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-[#d678ff]">{"开发测试入口 · 仅用于验证基站（非 Trigger / HUD）"}</p>
        <button type="button" onClick={() => setOpen((o) => !o)} className="underline" data-testid="station-dev-toggle">
          {open ? "收起" : "展开"}
        </button>
      </div>
      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={btn}
              onClick={() => {
                runSeq.current += 1;
                const id = `run-${Date.now().toString(36)}-${runSeq.current}`;
                setPrevRunId(runId);
                setRunId(id);
                inject(inboundEnvelope("scenario.start", { runId: id, payload: DEMO_START }));
              }}
              data-testid="dev-start"
            >
              {"场景开始"}
            </button>
            <button type="button" className={btn} disabled={!runId} onClick={() => runId && inject(inboundEnvelope("scenario.reset", { runId, payload: {} }))} data-testid="dev-reset">
              {"场景重置"}
            </button>
            <button type="button" className={btn} disabled={!last} onClick={() => last && inject(last)} data-testid="dev-duplicate">
              {"重复上一条（同 eventId）"}
            </button>
          </div>
          <p className="text-[var(--mg-faint)]">{"Trigger：注入模拟观测"}</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FIXTURES) as FixtureId[]).map((k) => (
              <button key={k} type="button" className={btn} disabled={!runId} onClick={() => runId && inject(inboundEnvelope("observation.submitted", { runId, caseId: FIXTURES[k].caseId, payload: FIXTURES[k].observation }))} data-testid={`dev-obs-${k}`}>
                {FIXTURES[k].label}
              </button>
            ))}
            <button type="button" className={btn} disabled={!prevRunId} onClick={() => prevRunId && inject(inboundEnvelope("observation.submitted", { runId: prevRunId, caseId: FIXTURES.change.caseId, payload: FIXTURES.change.observation }))} data-testid="dev-late">
              {"上一轮迟到的观测"}
            </button>
          </div>
          <p className="text-[var(--mg-faint)]">{`HUD：回传（当前事件 ${caseId ?? "无"}）`}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={btn}
              disabled={!runId || !hudMessages.some((m) => !m.hudReceivedAt)}
              onClick={() => {
                if (!runId || !caseId) return;
                for (const m of hudMessages.filter((x) => !x.hudReceivedAt)) inject(inboundEnvelope("hud.received", { runId, caseId, payload: { messageId: m.eventId } }));
              }}
              data-testid="dev-hud-received"
            >
              {"HUD 接收回执"}
            </button>
            <button
              type="button"
              className={btn}
              disabled={!runId || !hudMessages.some((m) => m.feedback !== "acknowledged")}
              onClick={() => {
                if (!runId || !caseId) return;
                for (const m of hudMessages.filter((x) => x.feedback !== "acknowledged")) inject(inboundEnvelope("hud.ack", { runId, caseId, payload: { messageId: m.eventId } }));
              }}
              data-testid="dev-hud-ack"
            >
              {"宇航员确认"}
            </button>
            <button type="button" className={btn} disabled={!runId || !latestHudMessage()} onClick={() => runId && caseId && inject(inboundEnvelope("hud.defer", { runId, caseId, payload: { messageId: latestHudMessage()!.eventId, reason: "正在作业，稍后处理（模拟）" } }))} data-testid="dev-hud-defer">
              {"宇航员暂缓"}
            </button>
            {(Object.keys(RETEST_FIXTURES) as RetestFixtureId[]).map((k) => (
              <button
                key={k}
                type="button"
                className={btn}
                disabled={!runId || !openRetest}
                onClick={() => {
                  if (!runId || !caseId || !openRetest) return;
                  retestSeq.current += 1;
                  inject(inboundEnvelope("retest.result", { runId, caseId, retestId: openRetest.retestId, payload: { observation: RETEST_FIXTURES[k].observation(retestSeq.current) } }));
                }}
                data-testid={`dev-${k}`}
              >
                {RETEST_FIXTURES[k].label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={btn}
              onClick={() => {
                adapter.failNextSends(1);
                setNote("下一次发送将模拟失败");
              }}
              data-testid="dev-fail-next"
            >
              {"下一次发送失败"}
            </button>
            <span className="text-[var(--mg-faint)]" data-testid="dev-note">
              {note}
            </span>
          </div>
          <details>
            <summary className="cursor-pointer text-[var(--mg-dim)]">{`mock 适配层已发出 ${adapter.sent.length} 条`}</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--mg-dim)]" data-testid="dev-sent">
              {JSON.stringify(adapter.sent.slice(-4), null, 1)}
            </pre>
          </details>
        </div>
      ) : null}
    </aside>
  );
}
