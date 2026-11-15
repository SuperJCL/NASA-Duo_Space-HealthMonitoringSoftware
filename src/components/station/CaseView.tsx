"use client";

import { useState } from "react";
import { FEATURES, type FeatureComparison } from "@/lib/station/analysis";
import { caseMessages, latest, messageKind, nextOwner, stageView, type Case, type Evaluation, type StationState, type TimelineEntry } from "@/lib/station/station";
import { alertNote, caseStatus, comparisonView, evaluationStatus, keyBasis, summaryHeadline } from "@/lib/station/views";
import { Fold, Label, StatusChip, time } from "./ui";

const STAGE = {
  waiting: { icon: "○", cls: "text-[var(--mg-faint)]", text: "Waiting" },
  running: { icon: "◐", cls: "text-[var(--mg-cyan)]", text: "Running" },
  done: { icon: "✓", cls: "text-[var(--mg-ok)]", text: "Done" },
  blocked: { icon: "■", cls: "text-[var(--mg-caution)]", text: "Blocked" },
  failed: { icon: "✕", cls: "text-[#ff8f8f]", text: "Failed" },
  skipped: { icon: "–", cls: "text-[var(--mg-faint)]", text: "Not run" },
} as const;
const fmtZ = (z: number | null) => (z === null ? "–" : `${z > 0 ? "+" : ""}${z.toFixed(2)}`);
const POSTURE = { standing: "standing", kneeling: "kneeling", seated: "seated" } as const;

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
        <StatusChip tone={status.tone} testId="station-case-status">{`Case status: ${status.label}`}</StatusChip>
        <StatusChip tone={result.tone} testId="station-eval-status">{result.label}</StatusChip>
      </div>
      <div>
        <p className="text-[12px] text-[var(--mg-faint)]">{"What happened"}</p>
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
        <p className="text-[12px] text-[var(--mg-faint)]">{"Key basis"}</p>
        {done ? (
          <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-[var(--mg-dim)]" data-testid="station-basis">
            {keyBasis(ev.result).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--mg-dim)]">{"Shown once the analysis completes."}</p>
        )}
      </div>
      <p className="text-[13px]">
        <span className="text-[var(--mg-faint)]">{"Next: "}</span>
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
        <h3 id="station-analysis-title" className="text-[13px] font-semibold">{`Simulated Analysis steps · v${ev.version}`}</h3>
        <span className="text-[11px] text-[var(--mg-faint)]">{"Deterministic rule simulation, no model called · click a step for details"}</span>
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
            <p className="mt-1 text-[var(--mg-dim)]">{"For the values, see the “Measurement vs individual baseline” table below."}</p>
          ) : result.evidence.length ? (
            <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-[var(--mg-dim)] sm:grid-cols-2">
              {result.evidence.map((e) => (
                <li key={e.label} className={e.ok === false ? "text-[var(--mg-caution)]" : ""}>{`${e.ok === null ? "·" : e.ok ? "✓" : "✕"} ${e.label}: ${e.value}${e.note ? ` (${e.note})` : ""}`}</li>
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
  if (!o) {
    return (
      <section aria-labelledby="station-baseline-title" data-testid="station-baseline" data-view="report">
        <h3 id="station-baseline-title" className="text-[13px] font-semibold">{"Measurement vs individual baseline"}</h3>
        <p className="mt-0.5 text-[12px] text-[var(--mg-dim)]">{"This round is an astronaut-report check: there is no new measurement, so no indicators are compared."}</p>
      </section>
    );
  }
  const p = o.protocol;
  return (
    <section aria-labelledby="station-baseline-title" data-testid="station-baseline" data-view={view.kind}>
      <h3 id="station-baseline-title" className="text-[13px] font-semibold">{"Measurement vs individual baseline"}</h3>
      <p className="mt-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="station-observation-meta">
        {`Standardised simulated measurement (single, fixed protocol): ${p.label} · ${POSTURE[p.posture]} · ${p.glove === "eva-glove" ? "EVA glove" : "no glove"}${o.context.minutesIntoEva !== null ? ` · taken at EVA minute ${o.context.minutesIntoEva}` : ""} · data time ${time(o.capturedAt)} · ${ev.result.stages[0].status === "done" ? "signal quality passed" : ev.result.stages[0].status === "blocked" ? "signal quality failed" : "quality not assessed"}`}
      </p>
      {ev.completedAt === null ? (
        <p className="mt-1 text-[12px] text-[var(--mg-faint)]">{"The comparison is shown once the analysis completes."}</p>
      ) : view.kind === "single" ? (
        ev.result.comparisons.length ? (
          <table className="mt-1.5 w-full text-left text-[12px]" data-testid="station-baseline-table">
            <thead className="text-[var(--mg-faint)]">
              <tr>
                <th className="font-normal">{"Indicator · source"}</th>
                <th className="font-normal">{"Individual baseline"}</th>
                <th className="font-normal">{`Current v${ev.version}`}</th>
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
            {`Not compared: ${ev.result.stages.find((s) => s.status === "blocked" || s.status === "failed")?.summary ?? ""}`}
          </p>
        )
      ) : view.kind === "paired" ? (
        <>
          <table className="mt-1.5 w-full text-left text-[12px]" data-testid="station-baseline-table">
            <thead className="text-[var(--mg-faint)]">
              <tr>
                <th className="font-normal">{"Indicator · source"}</th>
                <th className="font-normal">{"Individual baseline"}</th>
                <th className="font-normal">{`v${view.before.version} original`}</th>
                <th className="font-normal" />
                <th className="font-normal">{`v${view.after.version} retest`}</th>
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
          <p className="mt-1 text-[11px] text-[var(--mg-faint)]">{"Both measurements meet the quality and comparability conditions, so they are shown side by side; no “improvement” is computed."}</p>
        </>
      ) : (
        <div className="mt-1.5 flex flex-col gap-1 text-[12px]" data-testid="station-separate">
          <p>{`v${view.before.version} original measurement: ${view.before.result.headline}`}</p>
          <p>{`v${view.after.version} retest: ${view.after.result.headline}`}</p>
          <p className="text-[var(--mg-caution)]">{view.why}</p>
        </div>
      )}
      <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--mg-faint)]">
        <li>{"Reference range = individual baseline mean ± 2 SD (demo threshold); the individual baseline is 6 recordings of the same astronaut with the same standard protocol (simulated). ⚑ = outside the reference range."}</li>
        <li data-testid="station-grip-note">{"Grip force comes from a grip-meter reading under the same protocol (an independent simulated measurement); it is not derived from sEMG."}</li>
      </ul>
    </section>
  );
}

export function Timeline({ entries }: { entries: readonly TimelineEntry[] }) {
  const KIND = { in: "In", out: "Out", system: "System", review: "Review", ignored: "Ignored" } as const;
  if (!entries.length) return <p className="text-[12px] text-[var(--mg-faint)]">{"No entries yet."}</p>;
  return (
    <ol className="space-y-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="station-timeline">
      {[...entries].reverse().map((t, i) => (
        <li key={i} className={t.kind === "ignored" ? "text-[var(--mg-faint)]" : ""} data-kind={t.kind}>
          <span className="mr-1 inline-block w-14 text-[var(--mg-faint)]">{KIND[t.kind]}</span>
          {`${time(t.at)} · ${t.text}`}
        </li>
      ))}
    </ol>
  );
}

const KIND_TEXT = { action: "Action message", status: "Status notice", receipt: "Receipt", audit: "Audit record (not sent to the HUD)" } as const;

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
          <h3 id="station-conclusion-title" className="text-[13px] font-semibold">{"Interpretation and limitations"}</h3>
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
        <Label>{"Details on demand"}</Label>
        <Fold title="Handling record and timeline" testId="station-timeline-section">
          <Timeline entries={state.timeline.filter((t) => t.caseId === c.caseId || t.caseId === null)} />
        </Fold>
        {c.evaluations.length > 1 ? (
          <Fold title={`Evaluation versions (${c.evaluations.length})`} testId="station-versions">
            <ol className="space-y-0.5 text-[12px] text-[var(--mg-dim)]">
              {c.evaluations.map((e) => (
                <li key={e.version}>{`v${e.version} · ${e.trigger === "retest" ? "Retest" : "Measurement"} · ${e.completedAt ? e.result.headline : "analysing"}`}</li>
              ))}
            </ol>
          </Fold>
        ) : null}
        <Fold title="Technical details (message types, IDs, transport)" testId="station-tech">
          <div className="flex flex-col gap-2 text-[12px] text-[var(--mg-dim)]">
            <p data-testid="station-tech-ids">{`caseId ${c.caseId} · run ${state.run?.runId ?? "–"} · scenario ${state.run?.scenarioId ?? "–"} · astronaut ${c.astronautId} · evaluations ${c.evaluations.map((e) => `v${e.version}←${e.sourceEventId}${e.retestId ? ` (${e.retestId})` : ""}`).join(", ")}`}</p>
            <p>{`Transport: ${mock ? "local mock adapter (standalone demo, no network, not connected to Trigger / HUD)" : "adapter"}. “Handed to the adapter” only means it was handed over; it does not mean the HUD received it.`}</p>
            {msgs.length ? (
              <ul className="space-y-1" data-testid="station-outbox">
                {msgs.map((m) => (
                  <li key={m.eventId} className={messageKind(m.type) === "audit" ? "text-[var(--mg-faint)]" : ""} data-type={m.type} data-kind={messageKind(m.type)} data-delivery={m.delivery} data-hud-received={m.hudReceivedAt ? "yes" : "no"} data-feedback={m.feedback}>
                    {`${time(m.envelope.sentAt)} · ${KIND_TEXT[messageKind(m.type)]} · ${m.type} · ${m.eventId}${m.retestId ? ` · ${m.retestId}` : ""}`}
                    {messageKind(m.type) === "audit"
                      ? ""
                      : ` · adapter: ${{ queued: "handing over", sent: "handed over", failed: "failed" }[m.delivery]} · HUD receipt: ${m.hudReceivedAt ? time(m.hudReceivedAt) : "none yet"}${messageKind(m.type) === "action" ? ` · crew: ${{ none: "no feedback yet", acknowledged: "acknowledged", deferred: "deferred" }[m.feedback]}` : ""}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[var(--mg-faint)]">{"No messages sent yet."}</p>
            )}
            <details>
              <summary className="cursor-pointer">{`v${ev.version} raw measurement fields`}</summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify({ observation: ev.observation, sourceEventId: ev.sourceEventId, inputKey: ev.result.inputKey }, null, 1)}</pre>
            </details>
          </div>
        </Fold>
      </div>
    </div>
  );
}
