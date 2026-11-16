"use client";

import { useState } from "react";
import { intakeCheck, observationEnvelope, REPLAY_SAMPLES, sampleById, type CheckStatus } from "@/lib/replay/replay";
import type { RelayStationAdapter } from "@/lib/station/relay-adapter";
import type { StationState } from "@/lib/station/station";

const MARK: Record<CheckStatus, { t: string; c: string }> = {
  ok: { t: "✓", c: "text-[var(--mg-dim)]" },
  assumed: { t: "Assumed", c: "text-[var(--mg-caution)]" },
  missing: { t: "Missing", c: "text-[var(--mg-caution)]" },
  blocked: { t: "Blocked", c: "text-[var(--mg-coral)]" },
};

/**
 * DEV ENTRY in relay mode: the station page as one entry point of the DATA REPLAY module
 * (src/lib/replay; the other is `npm run replay`). It starts a run and publishes stored SIMULATED
 * samples as the data producer (contract role "trigger", client "-replay"). No product page, no HUD
 * feedback: receipts and confirmations only come from the real HUD page.
 */
export function RelayDevDrawer({ relay, state, onClose, onOpenPerson, browserDemo = false, contained = false }: { relay: RelayStationAdapter; state: StationState; onClose: () => void; onOpenPerson: (astronautId: string) => void; browserDemo?: boolean; contained?: boolean }) {
  const [sampleId, setSampleId] = useState(REPLAY_SAMPLES[0].id);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = state.run;
  const sample = sampleById(sampleId) ?? REPLAY_SAMPLES[0];
  const runInfo = run ? { runId: run.runId, astronaut: run.astronaut, task: run.task } : null;
  const check = intakeCheck(sample, runInfo, "");
  const go = async (fn: () => Promise<{ note: string }>) => {
    setBusy(true);
    setNote((await fn()).note);
    setBusy(false);
  };
  // The note says WHICH action happened and what comes next (a run start and a replay are different steps).
  const inject = (open: boolean) =>
    go(async () => {
      if (!runInfo || !check.publishable) return { note: "Cannot replay: see the checklist" };
      if (open) onOpenPerson(runInfo.astronaut.id);
      const r = await relay.publishAsReplay(observationEnvelope(state.sessionId, runInfo, sample, Date.now()));
      return { note: r.ok ? `Replayed sample "${sample.label}" (seq ${r.seq}) · simulated sample. The base is analysing; in about 10 s it stops at Awaiting Base Review.` : r.note };
    });
  const btn = "min-h-8 rounded-lg border px-2.5 text-[12px] disabled:opacity-40";
  return (
    <aside className={`${contained ? "absolute max-w-[calc(100%-1.5rem)]" : "fixed max-w-[calc(100vw-1.5rem)]"} bottom-3 right-3 top-3 z-50 flex w-[24rem] flex-col gap-3 overflow-y-auto rounded-2xl border-2 border-dashed border-[#d678ff] bg-[rgba(11,17,28,0.97)] p-4 text-[12px] shadow-2xl`} aria-label="Dev entry (data replay)" data-testid="relay-dev-drawer">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[14px] font-semibold text-[#e3a6ff]">{"Dev entry · data replay (simulated samples)"}</p>
          <p className="text-[11px] text-[var(--mg-dim)]">
            {browserDemo
              ? "Publishes stored simulated samples to the in-browser bus as the data producer (contract role trigger), the same data replay as Demo controls → Load sample. Not a teammate's health data."
              : "Publishes stored simulated samples to the relay as the data producer (contract role trigger). Not a teammate's health data; the command line npm run replay is the same module."}
          </p>
        </div>
        <button type="button" onClick={onClose} className="underline" data-testid="relay-dev-close">
          {"Hide"}
        </button>
      </div>
      <ol className="list-decimal space-y-0.5 rounded-lg border border-[var(--mg-line)] py-2 pl-6 pr-2 text-[11px] text-[var(--mg-dim)]" data-testid="relay-dev-steps">
        <li>
          {browserDemo
            ? "In the Mission Map, choose a task and an astronaut and confirm Start EVA; in the Astronaut HUD tab, click Enter HUD (it then only shows that it is connected; no messages yet is expected)."
            : "In the Mission Map, choose a task and an astronaut and confirm Start EVA; on the HUD page, click Enter HUD to join (the HUD then only shows that it is connected; no messages yet is expected)."}
        </li>
        <li>{"Choose a sample and replay it: the base analyses for about 10 s and stops at Awaiting Base Review."}</li>
        <li>{"Open the A-02 panel and click Awaiting Base Review → Approve and enter a reason. Only after approval does the HUD receive the notice and the retest task."}</li>
        <li>{"HUD: Acknowledge → View task → Start retest → Submit once the capture ends."}</li>
        <li>{"After the base re-evaluates: Close case or Continue Monitoring → the HUD shows the final status."}</li>
      </ol>
      {run ? (
        <p className="text-[var(--mg-text)]" data-testid="relay-dev-run">{`Current run: ${run.astronaut.callsign} · ${run.task.title} (run ${run.runId})`}</p>
      ) : (
        <p className="text-[var(--mg-caution)]" data-testid="relay-dev-norun">{"No EVA in progress. A replay only sends observations and does not start a run: confirm Start EVA in the Mission Map."}</p>
      )}
      {run?.evaEndedAt ? <p className="text-[11px] text-[var(--mg-caution)]">{"This EVA has ended: replay is still possible, e.g. a post-EVA measurement (the data still goes through the base analysis)."}</p> : null}
      <label className="flex min-w-0 items-center gap-2">
        {"Sample"}
        <select value={sampleId} onChange={(e) => setSampleId(e.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1" data-testid="relay-dev-fixture">
          {REPLAY_SAMPLES.map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.label} · ${s.observation.protocol.label}`}
            </option>
          ))}
        </select>
      </label>
      <ul className="grid gap-1 rounded-lg border border-[var(--mg-line)] p-2 text-[11px]" data-testid="relay-dev-check">
        <li className="text-[var(--mg-dim)]">{`Source: ${sample.source.label}`}</li>
        {check.items
          .filter((i) => i.item !== "Source")
          .map((i) => (
            <li key={i.item} className="flex gap-2" data-status={i.status}>
              <span className={`w-14 shrink-0 ${MARK[i.status].c}`}>{MARK[i.status].t}</span>
              <span className="min-w-0 break-words">
                <b className="font-medium">{i.item}</b>
                {`: ${i.detail}`}
              </span>
            </li>
          ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={!run || busy || !check.publishable} onClick={() => void inject(true)} className={`${btn} border-[#d678ff] text-[#e3a6ff]`} data-testid="relay-dev-inject-open">
          {"Replay and open Health Monitoring"}
        </button>
        <button type="button" disabled={!run || busy || !check.publishable} onClick={() => void inject(false)} className={`${btn} border-[var(--mg-line-strong)]`} data-testid="relay-dev-inject">
          {"Replay only"}
        </button>
      </div>
      {note ? (
        <p className="text-[var(--mg-cyan)]" data-testid="relay-dev-note">
          {note}
        </p>
      ) : null}
      <p className="text-[11px] text-[var(--mg-faint)]">
        {browserDemo
          ? "There is no automatic or simulated HUD feedback: HUD receipts, crew acknowledgements and retest results come only from the Astronaut HUD tab."
          : "In integration mode there is no automatic or manual simulated HUD feedback: HUD receipts, crew acknowledgements and retest results come only from the real HUD page."}
      </p>
    </aside>
  );
}
