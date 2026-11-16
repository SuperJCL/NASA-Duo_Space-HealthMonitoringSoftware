"use client";

import { busName } from "@/lib/station/transport-words";
import type { ReactNode } from "react";
import { CONDITION_NOTES, MISSION_CREW, PHASE_LABEL, runTask, type MissionDef, type MissionPhase, type MissionTask } from "@/lib/station/mission";
import { ageText, type CrewLine, type Freshness, type MissionCrewView } from "@/lib/station/mission-crew";
import type { StationState } from "@/lib/station/station";
import type { Tone } from "@/lib/station/views";

const hhmm = (iso: string | null | undefined) => (iso ? `${new Date(iso).toISOString().slice(11, 16)} UTC` : "–");
/** "12 min", "1 h 05 min" (design/DESIGN.md §2). */
const span = (fromIso: string | null | undefined, toMs: number) => {
  if (!fromIso || !toMs) return "–";
  const m = Math.max(0, Math.floor((toMs - Date.parse(fromIso)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};
const FRESH: Record<Freshness, { word: string; cls: string }> = {
  fresh: { word: "Fresh", cls: "border-[var(--mg-cyan)] text-[var(--mg-cyan)]" },
  aging: { word: "Aging", cls: "border-[var(--mg-line-strong)] text-[var(--mg-dim)]" },
  stale: { word: "Stale", cls: "border-[var(--mg-caution)] text-[var(--mg-caution)]" },
  none: { word: "No data", cls: "border-[var(--mg-line)] text-[var(--mg-faint)]" },
};
const TONE_ICON: Record<Tone, string> = { ok: "✓", caution: "…", alert: "!", neutral: "·" };
const TONE_TEXT: Record<Tone, string> = { ok: "text-[var(--mg-ok)]", caution: "text-[var(--mg-caution)]", alert: "text-[var(--mg-coral)]", neutral: "text-[var(--mg-dim)]" };
const PHASE_CHIP: Record<MissionPhase, string> = {
  preparing: "border-[var(--mg-line-strong)] text-[var(--mg-dim)]",
  starting: "border-[var(--mg-caution)] text-[var(--mg-caution)]",
  "eva-active": "border-[var(--mg-ok)] text-[var(--mg-ok)]",
  "eva-ended": "border-[var(--mg-line-strong)] text-[var(--mg-dim)]",
};

function Label({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--mg-dim)]">{children}</p>;
}
function Row({ k, children, testid }: { k: string; children: ReactNode; testid?: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-x-2 py-0.5" data-testid={testid}>
      <dt className="text-[var(--mg-dim)]">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * The right-hand panel of the Mission Map: mission context and crew status, by mission phase.
 * Preparing: task, astronaut, summary, start. EVA: task and time, crew cards (known facts only),
 * pending health cases and who they wait for, the way into Health Monitoring. Ended: summary,
 * open cases, continue handling. Planning scores live behind "Advanced planning".
 */
export function MissionCrewPanel({
  def,
  state,
  phase,
  view,
  selectedTask,
  pickTask,
  astronautId,
  setAstronautId,
  onSummary,
  onJump,
  canAct,
  mode,
  openCount,
  onResendStart,
  onAdvanced,
  now,
}: {
  def: MissionDef | null;
  state: StationState;
  phase: MissionPhase;
  view: MissionCrewView;
  selectedTask: MissionTask | null;
  pickTask: (taskId: string) => void;
  astronautId: string;
  setAstronautId: (id: string) => void;
  onSummary: () => void;
  onJump: (astronautId: string, caseId?: string) => void;
  canAct: boolean;
  mode: "relay" | "mock";
  openCount: number;
  onResendStart: (eventId: string) => void;
  onAdvanced: () => void;
  now: number;
}) {
  const run = state.run;
  const task = runTask(def, state);
  const startMsg = state.pendingStart ? state.outbox.find((m) => m.eventId === state.pendingStart!.eventId) : null;
  const blocked = phase === "eva-ended" && openCount > 0;

  const prep = (
    <div className="flex flex-col gap-3" data-testid="mission-prep">
      <div>
        <Label>{"① Task"}</Label>
        <div role="group" aria-label="EVA task" className="mt-1.5 flex flex-col gap-1.5">
          {(def?.tasks ?? []).map((t) => {
            const on = selectedTask?.taskId === t.taskId;
            return (
              <button
                key={t.taskId}
                type="button"
                aria-pressed={on}
                onClick={() => pickTask(t.taskId)}
                className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-1.5 text-left transition-colors duration-150 ${on ? "border-[var(--mg-cyan)] bg-[var(--mg-cyan-soft)]" : "border-[var(--mg-line)] hover:border-[var(--mg-line-strong)]"}`}
                data-testid={`prep-task-${t.taskId}`}
              >
                <span aria-hidden className={`inline-block size-3 shrink-0 rotate-45 border-2 ${on ? "border-[var(--mg-cyan)] bg-[var(--mg-cyan)]" : "border-dashed border-[var(--mg-coral)]"}`} />
                <span className="min-w-0">
                  <span className="block font-medium">{t.title}</span>
                  <span className="block text-[12px] text-[var(--mg-dim)]">{`${t.targetName} · simulated target`}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--mg-faint)]" data-testid="prep-task" data-task={selectedTask?.taskId ?? ""}>
          {selectedTask ? `Selected: ${selectedTask.title} → ${selectedTask.targetName}` : "Select a task here or a target on the map."}
        </p>
      </div>
      <div>
        <Label>{"② Astronaut"}</Label>
        {MISSION_CREW.length > 1 ? (
          <select value={astronautId} onChange={(e) => setAstronautId(e.target.value)} className="mt-1.5 w-full rounded-md border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1.5" data-testid="prep-astronaut">
            {MISSION_CREW.map((m) => (
              <option key={m.id} value={m.id}>{`${m.callsign} · ${m.hud}`}</option>
            ))}
          </select>
        ) : (
          <p className="mt-1.5 flex items-center gap-2 rounded-xl border border-[var(--mg-line)] px-3 py-2" data-testid="prep-astronaut" data-value={MISSION_CREW[0].id}>
            <b>{MISSION_CREW[0].callsign}</b>
            <span className="text-[12px] text-[var(--mg-dim)]">{MISSION_CREW[0].hud}</span>
          </p>
        )}
      </div>
      <div>
        <Label>{"③ Summary"}</Label>
        <ul className="mt-1.5 space-y-0.5 text-[12px] text-[var(--mg-dim)]">
          <li>{"Health data: simulated samples from the data replay."}</li>
          <li>{CONDITION_NOTES[0]}</li>
        </ul>
      </div>
      <button
        type="button"
        disabled={!selectedTask || !canAct || blocked || mode !== "relay"}
        onClick={onSummary}
        className="min-h-11 rounded-xl bg-[var(--mg-coral)] px-4 font-semibold text-[var(--mm-action-ink)] disabled:opacity-40"
        data-testid="prep-summary"
      >
        {phase === "eva-ended" ? "Review summary, start the next EVA" : "Review summary, start EVA"}
      </button>
      {mode !== "relay" ? <p className="text-[12px] text-[var(--mg-caution)]">{"Standalone demo: EVAs are not started here; runs come from the local simulated demo. Use the two-end mode (?relay=auto) for the full mission flow."}</p> : null}
      {!canAct && mode === "relay" ? <p className="text-[12px] text-[var(--mg-caution)]">{"Read-only window: another base window starts and ends EVAs."}</p> : null}
      {!selectedTask && canAct && mode === "relay" ? <p className="text-[12px] text-[var(--mg-faint)]">{"Choose a task first."}</p> : null}
      {blocked ? (
        <p className="text-[12px] text-[var(--mg-caution)]" data-testid="prep-blocked">
          {`The previous EVA still has ${openCount} open health case(s): handle them in Health Monitoring before starting a new EVA.`}
        </p>
      ) : null}
    </div>
  );

  let body: ReactNode;
  if (phase === "starting")
    body = (
      <div className="flex flex-col gap-2" data-testid="mission-starting">
        <p>{`Starting EVA: waiting for the ${busName()} to confirm. Health Monitoring opens once it is confirmed.`}</p>
        {startMsg && startMsg.delivery === "failed" ? (
          <p>
            <span className="text-[var(--mg-caution)]">{`Send failed: ${startMsg.deliveryNote ?? "unknown reason"}`}</span>
            <button type="button" onClick={() => onResendStart(startMsg.eventId)} className="ml-2 rounded border border-[var(--mg-line-strong)] px-2" data-testid="mission-start-resend">
              {"Resend (same message)"}
            </button>
          </p>
        ) : null}
      </div>
    );
  else if (phase === "eva-active" && run)
    body = (
      <div className="flex flex-col gap-4" data-testid="mission-active">
        <section>
          <Label>{"Task"}</Label>
          <p className="mt-1 text-[16px] font-semibold" data-testid="mc-task">{`${run.task.title}${task ? ` → ${task.targetName}` : ""}`}</p>
          <p className="text-[13px] text-[var(--mg-dim)]">
            {"Started "}
            <time className="mm-num">{hhmm(run.startedAt)}</time>
            {" · "}
            <span className="mm-num" data-testid="mc-elapsed">{span(run.startedAt, now)}</span>
            {" · simulated, not a real EVA"}
          </p>
        </section>
        <section className="flex flex-col gap-2">
          <Label>{"Crew"}</Label>
          {view.crew.length ? view.crew.map((c) => <CrewCard key={c.astronautId} c={c} targetName={task?.targetName ?? null} onJump={onJump} now={now} />) : <p className="text-[var(--mg-dim)]">{"Waiting for the crew of this EVA."}</p>}
        </section>
      </div>
    );
  else if (phase === "eva-ended" && run) {
    const openLines = view.crew.flatMap((c) => c.openCases.map((x) => ({ ...x, astronautId: c.astronautId, callsign: c.callsign })));
    body = (
      <div className="flex flex-col gap-4">
        <section data-testid="mission-ended">
          <Label>{"EVA summary"}</Label>
          <p className="mt-1 font-semibold">{`${run.task.title}${task ? ` → ${task.targetName}` : ""} · ${run.astronaut.callsign}`}</p>
          <p className="text-[13px] text-[var(--mg-dim)]">
            {`Simulated EVA · ${hhmm(run.startedAt)} → ${hhmm(run.evaEndedAt)} · ${run.evaEndedAt ? span(run.startedAt, Date.parse(run.evaEndedAt)) : "–"}`}
          </p>
          <p className="mt-1 text-[13px]" data-testid="mc-totals">{`Health cases: ${view.totals.cases} · open ${view.totals.open} · closed ${view.totals.closed}`}</p>
          <p className="text-[12px] text-[var(--mg-faint)]">{"Ending the EVA closes no case and says nothing about health."}</p>
        </section>
        {openLines.length ? (
          <section className="flex flex-col gap-1.5" data-testid="mc-open-cases">
            <Label>{"Open health cases"}</Label>
            {openLines.map((x) => (
              <button key={x.caseId} type="button" onClick={() => onJump(x.astronautId, x.caseId)} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] px-3 py-2 text-left text-[13px]" data-testid={`mc-continue-${x.caseId}`}>
                <span>
                  <b>{x.callsign}</b>
                  {` · ${x.text}`}
                  {x.waitingFor ? <span className="block text-[12px] text-[var(--mg-dim)]">{`Waiting for ${x.waitingFor}${x.since ? ` since ${hhmm(x.since)}` : ""}`}</span> : null}
                </span>
                <span className="shrink-0 font-semibold">{"Continue →"}</span>
              </button>
            ))}
          </section>
        ) : null}
        <section className="border-t border-[var(--mg-line)] pt-3">
          <p className="mb-2 font-semibold">{"Next EVA"}</p>
          {prep}
        </section>
      </div>
    );
  } else body = prep;

  return (
    <>
      <div className="border-b border-[var(--mg-line)] px-5 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="mission-crew-title" className="text-[18px] font-semibold">
            {"Mission & Crew"}
          </h2>
          <span className={`rounded-full border px-2.5 py-0.5 text-[12px] ${PHASE_CHIP[phase]}`} data-testid="mc-phase" data-phase={phase}>
            {PHASE_LABEL[phase]}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-[var(--mg-dim)]">{def?.title ?? "Mission not loaded"}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[14px]" data-testid="mission-strip">
        {body}
      </div>
      <div className="border-t border-[var(--mg-line)] px-5 py-2.5">
        <button type="button" onClick={onAdvanced} className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-[13px] text-[var(--mg-dim)] hover:text-[var(--mg-text)]" data-testid="advanced-planning-open">
          <span>
            <span className="font-semibold">{"Advanced planning"}</span>
            <span className="block text-[12px] text-[var(--mg-faint)]">{"Scenario priorities, effort budget, EVA route and steps · simulated, not health"}</span>
          </span>
          <span aria-hidden>{"→"}</span>
        </button>
      </div>
    </>
  );
}

function CrewCard({ c, targetName, onJump, now }: { c: CrewLine; targetName: string | null; onJump: (astronautId: string, caseId?: string) => void; now: number }) {
  const fresh = FRESH[c.data.freshness];
  const first = c.openCases.find((x) => x.needsBase) ?? null;
  return (
    <article className={`rounded-2xl border p-3 ${c.needsBase ? "border-[var(--mg-coral)]" : "border-[var(--mg-line-strong)]"}`} data-testid={`mc-crew-${c.astronautId}`}>
      <header className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2">
          <span aria-hidden className="inline-block size-2.5 rounded-full border-2 border-[#0e1520] bg-white outline-dashed outline-1 outline-offset-1 outline-white" />
          <b className="text-[16px]">{c.callsign}</b>
          <span className="text-[12px] text-[var(--mg-dim)]">{"Astronaut"}</span>
        </p>
        <span className="flex items-center gap-1.5">
          {c.unread ? (
            <span className="rounded-full border border-[var(--mg-cyan)] px-2 text-[11px] text-[var(--mg-cyan)]" data-testid={`mc-unread-${c.astronautId}`}>{`${c.unread} new`}</span>
          ) : null}
          {c.needsBase ? <span className="rounded-full border border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] px-2 text-[11px] font-semibold">{`! ${c.needsBase} to review`}</span> : null}
        </span>
      </header>
      <dl className="mt-2 text-[13px]">
        <Row k="Device link" testid={`mc-device-${c.astronautId}`}>
          <span className={c.device.state === "connected" ? "text-[var(--mg-ok)]" : c.device.state === "disconnected" ? "text-[var(--mg-caution)]" : "text-[var(--mg-dim)]"}>{c.device.text}</span>
        </Row>
        <Row k="HUD" testid={`mc-hud-${c.astronautId}`}>
          {c.hud.at ? (
            <>
              {`${c.hud.text} · `}
              <time className="mm-num">{hhmm(c.hud.at)}</time>
            </>
          ) : (
            <span className="text-[var(--mg-dim)]">{c.hud.text}</span>
          )}
        </Row>
        <Row k="Latest data" testid={`mc-data-${c.astronautId}`}>
          {c.data.at ? (
            <span className="flex flex-wrap items-center gap-x-1.5">
              <time className="mm-num">{hhmm(c.data.at)}</time>
              <span className="mm-num text-[var(--mg-dim)]">{`· ${ageText(c.data.ageMin)}`}</span>
              <span className={`rounded-full border px-1.5 text-[11px] ${fresh.cls}`} title="Age of the latest measurement (display only; nothing is inferred from it)" data-freshness={c.data.freshness}>
                {fresh.word}
              </span>
            </span>
          ) : (
            <span className="text-[var(--mg-dim)]">{"No measurement yet"}</span>
          )}
          <span className="block text-[12px] text-[var(--mg-dim)]">{c.data.summary}</span>
        </Row>
        <Row k="Vital signs">
          <span className="text-[var(--mg-dim)]">{"No source in this demo"}</span>
        </Row>
        <Row k="Position">
          <span className="text-[var(--mg-dim)]">{targetName ? `Simulated, near ${targetName} (not tracked)` : "Simulated (not tracked)"}</span>
        </Row>
      </dl>
      <div className="mt-2 flex flex-col gap-1.5">
        <Label>{"Health cases"}</Label>
        {c.openCases.length ? (
          c.openCases.map((x) => (
            <button
              key={x.caseId}
              type="button"
              onClick={() => onJump(c.astronautId, x.caseId)}
              className={`flex items-start justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-left text-[13px] ${x.needsBase ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)]" : "border-[var(--mg-line)]"}`}
              data-testid={x === first ? `map-pending-${c.astronautId}` : `mc-case-${x.caseId}`}
            >
              <span className="min-w-0">
                <span className={`font-semibold ${TONE_TEXT[x.tone]}`}>{`${TONE_ICON[x.tone]} ${x.text}`}</span>
                {x.waitingFor ? <span className="block text-[12px] text-[var(--mg-dim)]">{`Waiting for ${x.waitingFor}${x.since ? ` · since ${hhmm(x.since)} (${span(x.since, now)})` : ""}`}</span> : null}
              </span>
              <span className="shrink-0 text-[var(--mg-dim)]">{x.needsBase ? "Review →" : "View →"}</span>
            </button>
          ))
        ) : (
          <p className="text-[12px] text-[var(--mg-dim)]" data-testid="map-pending-none">{"No open health case"}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onJump(c.astronautId, first?.caseId)}
        className={`mt-3 min-h-10 w-full rounded-xl px-3 font-semibold ${c.needsBase ? "bg-[var(--mg-coral)] text-[var(--mm-action-ink)]" : "border border-[var(--mg-line-strong)]"}`}
        title="No live position source: the map marker is a simulated position near the task target"
        data-testid={`map-crew-${c.astronautId}`}
      >
        {`Open Health Monitoring · ${c.callsign}`}
      </button>
    </article>
  );
}
