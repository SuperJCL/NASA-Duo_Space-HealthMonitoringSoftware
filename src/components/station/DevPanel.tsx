"use client";

import { useRef, useState } from "react";
import { inboundEnvelope, type MockStationAdapter } from "@/lib/station/adapter";
import { DEMO_START, FIXTURES, RETEST_FIXTURES, type FixtureId, type RetestFixtureId } from "@/lib/station/fixtures";
import type { Envelope } from "@/lib/station/protocol";
import { caseMessages, type StationState } from "@/lib/station/station";

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
    setNote(`Injected ${env.type} · ${env.eventId}`);
  };
  const activeCase = caseId ? state.cases[caseId] : null;
  const current = caseMessages(state, caseId);
  const latestHudMessage = (type?: string) => [...current].reverse().find((m) => (type ? m.type === type : m.type === "station.notice.approved" || m.type === "station.retest.requested"));
  // Notice / retest messages of the latest dispatch (highest evaluation version) for the current case.
  const dispatchMsgs = current.filter((m) => m.type === "station.notice.approved" || m.type === "station.retest.requested");
  const lastVersion = Math.max(0, ...dispatchMsgs.map((m) => (m.envelope.payload as { evaluationVersion: number }).evaluationVersion));
  const hudMessages = dispatchMsgs.filter((m) => (m.envelope.payload as { evaluationVersion: number }).evaluationVersion === lastVersion);
  // A device receipt can be simulated for the latest action messages AND for status notifications.
  const receivable = [...hudMessages, ...current.filter((m) => m.type === "station.reassessment")];
  const openRetest = activeCase?.retests.find((r) => r.status !== "result-received") ?? activeCase?.retests.at(-1);
  const btn = "min-h-8 rounded-lg border border-[var(--mg-line-strong)] px-2 text-[12px] disabled:opacity-40";

  return (
    <aside className="fixed bottom-3 left-3 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-dashed border-[#d678ff] bg-[rgba(11,17,28,0.96)] p-3 text-[12px] shadow-2xl" aria-label="Development test entry" data-testid="station-dev">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-[#d678ff]">{"Development test entry · for verifying the base only (not the Trigger / HUD)"}</p>
        <button type="button" onClick={() => setOpen((o) => !o)} className="underline" data-testid="station-dev-toggle">
          {open ? "Collapse" : "Expand"}
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
              {"Start scenario"}
            </button>
            <button type="button" className={btn} disabled={!runId} onClick={() => runId && inject(inboundEnvelope("scenario.reset", { runId, payload: {} }))} data-testid="dev-reset">
              {"Reset scenario"}
            </button>
            <button type="button" className={btn} disabled={!last} onClick={() => last && inject(last)} data-testid="dev-duplicate">
              {"Repeat last (same eventId)"}
            </button>
          </div>
          <p className="text-[var(--mg-faint)]">{"① Trigger: inject a standardised simulated measurement (each button opens a new case)"}</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FIXTURES) as FixtureId[]).map((k) => (
              <button key={k} type="button" className={btn} disabled={!runId} onClick={() => runId && inject(inboundEnvelope("observation.submitted", { runId, caseId: FIXTURES[k].caseId, payload: FIXTURES[k].observation }))} data-testid={`dev-obs-${k}`}>
                {FIXTURES[k].label}
              </button>
            ))}
            <button type="button" className={btn} disabled={!prevRunId} onClick={() => prevRunId && inject(inboundEnvelope("observation.submitted", { runId: prevRunId, caseId: FIXTURES.change.caseId, payload: FIXTURES.change.observation }))} data-testid="dev-late">
              {"Late observation from the previous run"}
            </button>
          </div>
          <p className="text-[var(--mg-faint)]">{`② HUD replies (current case ${caseId ?? "none"}; approve in the right column first; receipts also apply to status notices)`}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={btn}
              disabled={!runId || !receivable.some((m) => !m.hudReceivedAt)}
              onClick={() => {
                if (!runId || !caseId) return;
                for (const m of receivable.filter((x) => !x.hudReceivedAt)) inject(inboundEnvelope("hud.received", { runId, caseId, payload: { messageId: m.eventId } }));
              }}
              data-testid="dev-hud-received"
            >
              {"HUD receipt"}
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
              {"Crew acknowledges"}
            </button>
            <button type="button" className={btn} disabled={!runId || !latestHudMessage()} onClick={() => runId && caseId && inject(inboundEnvelope("hud.defer", { runId, caseId, payload: { messageId: latestHudMessage()!.eventId, reason: "Busy with the task, will handle it later (simulated)" } }))} data-testid="dev-hud-defer">
              {"Crew defers"}
            </button>
          </div>
          <p className="text-[var(--mg-faint)]">{`③ Retest replies${openRetest ? ` (${openRetest.retestId})` : " (available once a retest is approved)"}`}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={btn}
              disabled={!runId || !openRetest || openRetest.status === "result-received"}
              onClick={() => runId && caseId && openRetest && inject(inboundEnvelope("retest.completed", { runId, caseId, retestId: openRetest.retestId, payload: { completedAt: new Date().toISOString() } }))}
              data-testid="dev-retest-completed"
              title="Proposed extension (optional): the astronaut reports the retest done; the data arrive separately in retest.result"
            >
              {"Crew completes retest (optional)"}
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
                setNote("The next send will simulate a failure");
              }}
              data-testid="dev-fail-next"
            >
              {"Fail the next send"}
            </button>
            <span className="text-[var(--mg-faint)]" data-testid="dev-note">
              {note}
            </span>
          </div>
          <details>
            <summary className="cursor-pointer text-[var(--mg-dim)]">{`Sent by the mock adapter: ${adapter.sent.length}`}</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--mg-dim)]" data-testid="dev-sent">
              {JSON.stringify(adapter.sent.slice(-4), null, 1)}
            </pre>
          </details>
        </div>
      ) : null}
    </aside>
  );
}
