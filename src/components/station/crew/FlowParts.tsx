"use client";

// Building blocks of the Health Monitoring overlay: the full data-flow view (canvas + later rows),
// node details, the indicator chart, the communication list and the inline review form.
// Rendering only: every state comes from the station (src/lib/station/), nothing here decides.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { COMM_BADGE, type CommItem } from "@/lib/station/comms";
import { hhmmss, type FlowNode, type FlowRow, type FlowView, type IndicatorView, type NodeState } from "@/lib/station/flow";
import { latest, statusNoticeText, type Case, type Decision } from "@/lib/station/station";
import { businessProgress, canvasPlan, shortCallsign, type CanvasNodeId } from "@/lib/station/canvas";
import { elapsed, prefersReducedMotion, useOnceAnimation } from "./motion";
import { FlowCanvas } from "./FlowCanvas";

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
export const STATE_ICON: Record<NodeState | "replay", string> = { done: "✓", running: "◐", human: "●", waiting: "◷", stopped: "■", todo: "○", skipped: "–", replay: "▸" };
export const STATE_WORD: Record<NodeState, string> = { done: "Done", running: "Processing", human: "Base decision needed", waiting: "Waiting for a reply", stopped: "Stopped here", todo: "Not reached", skipped: "Not run" };

/** Editable reason templates per decision (the reviewer can change or replace them). */
export const REASONS: Record<Decision, string[]> = {
  approve: ["Several indicators shifted together: confirm with a standard-protocol retest", "Signal quality problem: measure again", "Answer the astronaut's report and schedule a standard measurement"],
  reject: ["Evidence insufficient: do not dispatch now", "Handled separately on site"],
  close: ["Retest Within Reference Range; closed after the duty review", "Result Within Reference Range; recorded and closed"],
  "keep-open": ["Retest Within Reference Range, but keep monitoring", "Wait for more data before deciding"],
};
export const DECISION_WORD: Record<Decision, string> = { approve: "Approve and dispatch", reject: "Reject candidate", close: "Close case", "keep-open": "Continue Monitoring" };
export const DECIDED: Record<Decision, string> = { approve: "Approved and dispatched", reject: "Candidate rejected", close: "Case Closed", "keep-open": "Continue Monitoring" };

/** Label of the main button for a decision on this case. */
export function primaryLabel(d: Decision, c: Case): string {
  const ev = latest(c);
  if (d !== "approve") return DECISION_WORD[d];
  if (ev.trigger === "report") return "Approve: reply and schedule a measurement";
  if (ev.version > 1) return "Approve another retest";
  return ev.result.outcome === "quality-blocked" ? "Approve the remeasurement" : "Approve and send the retest";
}

/** What a decision does once confirmed (shown in the review form). */
export const CONDITIONS: Record<Decision, string> = {
  approve: "The HUD shows the messages; the crew acknowledges, then follows the standard protocol. Receipt, acknowledgement and retest result update only when the HUD reports them, never from elapsed time.",
  reject: "Nothing is published or sent. The case stays open and the alert stays; close it or Continue Monitoring later.",
  close: "The case closes and the alert clears. Only a status notice is published, no action message. Late replies are recorded but never reopen the case.",
  "keep-open": "The case stays open and the alert stays. Only a status notice is published, no action message. It can be closed at any time.",
};

/** The messages a decision sends to the HUD, as their actual text (empty: nothing is sent). */
export function outgoingFor(c: Case, decision: Decision): { actions: { title: string; text: string }[]; status: string | null } {
  const cand = latest(c).result.candidate;
  const actions =
    decision === "approve" && cand && cand.kind !== "record-only"
      ? [...(cand.kind === "notice-and-retest" ? [{ title: "Notice", text: cand.notice.text }] : []), { title: "Retest task", text: cand.retest.instructions }]
      : [];
  return { actions, status: statusNoticeText(c, decision) };
}

/**
 * The full data-flow view of one case: the canvas of a measurement round (default: the latest),
 * then the rest of the process (review, dispatch, HUD feedback, retest, handling) as rows.
 */
export function CanvasSection({ c, flow, callsign, now, onDecide, onResend }: { c: Case; flow: FlowView; callsign: string; now: number; onDecide: (d: Decision) => void; onResend: (eventId: string) => void }) {
  const rounds = c.evaluations.filter((e) => e.observation);
  const [picked, setPicked] = useState<number | null>(null);
  const ev = rounds.find((e) => e.version === picked) ?? rounds.at(-1);
  if (!ev) return <Track key={c.caseId} c={c} flow={flow} now={now} onDecide={onDecide} onResend={onResend} />;
  const isLatest = ev.version === latest(c).version;
  const pending = isLatest && flow.current && flow.current.node.state === "human" && !flow.finished ? flow.current : null;
  const decision = c.reviews.filter((r) => r.version === ev.version).at(-1);
  const review = pending ? { label: "Awaiting Base Review", outcome: "human" as const } : decision ? { label: DECIDED[decision.decision], outcome: "done" as const } : { label: "Awaiting Base Review", outcome: "human" as const };
  const steps = canvasPlan(ev, callsign, review) ?? [];
  const row = flow.rows.find((r) => r.id === `v${ev.version}:analysis`);
  const nodeFor = (id: CanvasNodeId): FlowNode | null => {
    const at = (suffix: string) => row?.nodes.find((n) => n.id === `v${ev.version}:${suffix}`) ?? null;
    if (id === "receive" || id === "quality" || id === "context" || id === "features") return at(id);
    if (id === "branch") return at("recommendation");
    if (id === "review") return pending ? pending.node : at("recommendation");
    return null;
  };
  // Rows below the canvas: everything except the measurement rounds (drawn above) and this round's pending decision.
  const later = { ...flow, rows: flow.rows.filter((r) => !(r.id.endsWith(":analysis") && c.evaluations.find((e) => `v${e.version}:analysis` === r.id)?.observation) && r.id !== pending?.rowId) };
  const laterCurrent = later.rows.some((r) => r.id === flow.current?.rowId);
  return (
    <div className="flex flex-col gap-3">
      {rounds.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="canvas-rounds">
          <span className="text-[var(--mg-faint)]">{"Analysis round:"}</span>
          {rounds.map((e) => (
            <button key={e.version} type="button" aria-pressed={e.version === ev.version} onClick={() => setPicked(e.version)} className={`rounded-md border px-2 py-0.5 ${e.version === ev.version ? "border-[var(--mg-cyan)] text-[var(--mg-cyan)]" : "border-[var(--mg-line)]"}`} data-testid={`canvas-round-${e.version}`}>
              {`Round ${e.version} · ${e.trigger === "retest" ? "retest data" : "device data"}`}
            </button>
          ))}
        </div>
      ) : null}
      <FlowCanvas
        key={`${c.caseId}:${ev.version}`}
        steps={steps}
        progress={businessProgress(ev)}
        sourceLabel={`${shortCallsign(callsign)} device`}
        startAtEnd={ev.completedAt !== null}
        waitingText={null}
        renderDetail={(id) => {
          const n = nodeFor(id);
          return n ? <NodeDetail c={c} n={n} isCurrent={!!pending && id === "review"} now={now} onDecide={onDecide} onResend={onResend} onBack={null} /> : null;
        }}
      />
      {later.rows.length ? (
        <details open={laterCurrent} className="rounded-2xl border border-[var(--mg-line)] p-3" data-testid="later-flow">
          <summary className="cursor-pointer text-[13px] font-semibold">{"Later steps: review, dispatch, HUD feedback, retest and base handling"}</summary>
          <div className="mt-2">
            <Track key={c.caseId} c={c} flow={later} now={now} onDecide={onDecide} onResend={onResend} />
          </div>
        </details>
      ) : null}
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
      <span className="text-[12px] font-semibold">{`${STATE_ICON[visual]} ${n.label}`}</span>
      <span className="line-clamp-2 text-[11px] leading-snug opacity-90">{visual === "replay" ? "Replaying…" : n.summary}</span>
    </button>
  );
}

/** Rows of the flow: finished rows fold into one sentence; the current row shows its nodes and the open node's detail. */
export function Track({ c, flow, now, onDecide, onResend }: { c: Case; flow: FlowView; now: number; onDecide: (d: Decision) => void; onResend: (eventId: string) => void }) {
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
  const waitingNotice = notice?.nodes.find((n) => n.state === "waiting");
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
                  {expanded ? "Collapse" : "Expand"}
                </button>
              ) : null}
              {canReplay ? (
                <button type="button" className="ml-auto text-[12px] text-[var(--mg-cyan)] underline" onClick={() => setReplay(replaying ? null : { rowId: row.id, step: 0, total: row.nodes.length })} data-testid={`row-replay-${row.id}`}>
                  {replaying ? "Stop replay" : "Replay the analysis"}
                </button>
              ) : null}
            </div>
            {replaying ? <p className="mt-1 text-[11px] text-[var(--mg-cyan)]" data-testid="replay-note">{"Replay: display only. Nothing is re-analysed, published or changed."}</p> : null}
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
          {waitingNotice ? <p className="mt-1 text-[12px] text-[var(--mg-dim)]">{`Waiting for: HUD · since ${hhmmss(waitingNotice.since)} · ${elapsed(waitingNotice.since, now)}`}</p> : null}
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

/** After closing: one summary of the whole handling. */
function ProcessSummary({ c, flow }: { c: Case; flow: FlowView }) {
  const close = c.reviews.filter((r) => r.decision === "close").at(-1);
  return (
    <section className="rounded-2xl border border-[var(--mg-ok)] bg-[rgba(132,216,166,0.06)] p-3" data-testid="process-summary">
      <p className="text-[14px] font-semibold text-[var(--mg-ok)]">{"✓ Handling complete: Case Closed by base staff"}</p>
      <ul className="mt-1 space-y-0.5 text-[12px] text-[var(--mg-dim)]">
        {c.evaluations.map((e) => (
          <li key={e.version}>{`v${e.version} (${e.trigger === "report" ? "astronaut report" : e.trigger === "retest" ? "retest" : "device observation"}): ${e.result.headline}`}</li>
        ))}
        {c.reviews.map((r, i) => (
          <li key={i}>{`${hhmmss(r.at)} · ${r.reviewer}: ${DECISION_WORD[r.decision]} (v${r.version}) — ${r.reason}`}</li>
        ))}
        {close ? <li>{`Alert cleared by ${close.reviewer}.`}</li> : null}
        <li>{flow.noticePending ? `Status notice: ${flow.noticePending} (recorded apart from the handling)` : "Status notice: Received by HUD"}</li>
      </ul>
    </section>
  );
}

/** One node: input → processing → output, evidence on demand, and the action beside it. */
export function NodeDetail({ c, n, isCurrent, now, onDecide, onResend, onBack }: { c: Case; n: FlowNode; isCurrent: boolean; now: number; onDecide: (d: Decision) => void; onResend: (eventId: string) => void; onBack: (() => void) | null }) {
  const action = isCurrent ? n.action : null;
  return (
    <section className="mt-2 rounded-xl border border-[var(--mg-line)] bg-[var(--mg-bg-2)] p-3" data-testid="node-detail" data-node={n.id} data-state={n.state}>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-[14px] font-semibold">{n.label}</p>
        <span className="text-[12px] text-[var(--mg-dim)]">{isCurrent ? `Current · ${STATE_WORD[n.state]}` : STATE_WORD[n.state]}</span>
        {n.at ? <span className="text-[11px] text-[var(--mg-faint)]">{hhmmss(n.at)}</span> : null}
        {onBack ? (
          <button type="button" className="ml-auto text-[12px] text-[var(--mg-dim)] underline" onClick={onBack}>
            {"Back to the current step"}
          </button>
        ) : null}
      </div>
      {n.reason && (n.state === "stopped" || n.state === "human" || n.state === "waiting") ? (
        <p className={`mt-1 text-[13px] ${n.state === "stopped" ? "text-[var(--mg-caution)]" : n.state === "human" ? "text-[var(--mg-coral)]" : "text-[var(--mg-cyan)]"}`} data-testid="node-reason">
          {n.reason}
        </p>
      ) : null}
      {n.state === "waiting" && isCurrent ? <p className="mt-1 text-[12px] text-[var(--mg-dim)]" data-testid="node-waiting">{`Waiting for: ${n.owner} · since ${hhmmss(n.since)} · ${elapsed(n.since, now)}`}</p> : null}
      <div className="mt-2 grid gap-3 text-[12px] sm:grid-cols-3">
        <Col title="Input">{n.input.length ? <ul className="space-y-0.5">{n.input.map((x) => <li key={x}>{x}</li>)}</ul> : "–"}</Col>
        <Col title="Processing">{n.result ?? (n.state === "running" ? "Processing…" : "–")}</Col>
        <Col title="Output / next">{n.next ?? "–"}</Col>
      </div>
      {n.indicators.length ? <IndicatorChart items={n.indicators} /> : null}
      {n.relation ? (
        <p className="mt-2 rounded-lg border border-[var(--mg-line)] p-2 text-[12px]" data-testid="node-relation">
          {`Original measurement and retest: ${n.relation}`}
        </p>
      ) : null}
      {n.evidence.length && n.state !== "running" ? (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer text-[var(--mg-dim)]">{`Evidence (${n.evidence.length})`}</summary>
          <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-[var(--mg-dim)] sm:grid-cols-2" data-testid="node-evidence">
            {n.evidence.map((e) => (
              <li key={e.label} className={e.ok === false ? "text-[var(--mg-caution)]" : ""}>{`${e.ok === null ? "·" : e.ok ? "✓" : "✕"} ${e.label}: ${e.value}${e.note ? ` (${e.note})` : ""}`}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {action?.kind === "decide" && action.options.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--mg-line)] pt-3" data-testid="node-actions">
          {action.options.map((d) => (
            <button key={d} type="button" onClick={() => onDecide(d)} className={d === action.primary ? "min-h-9 rounded-lg bg-[var(--mg-coral)] px-3 text-[13px] font-semibold text-[#1a0f0c]" : "min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3 text-[13px]"} data-testid={`node-decide-${d}`}>
              {d === action.primary ? primaryLabel(d, c) : DECISION_WORD[d]}
            </button>
          ))}
          <span className="text-[11px] text-[var(--mg-faint)]">{"Opens the review form in the decision panel."}</span>
        </div>
      ) : null}
      {action?.kind === "resend" ? (
        <div className="mt-3 border-t border-[var(--mg-line)] pt-3">
          <button type="button" onClick={() => action.eventIds.forEach(onResend)} className="min-h-9 rounded-lg border border-[var(--mg-caution)] px-3 text-[13px] text-[var(--mg-caution)]" data-testid="node-resend">
            {"Resend the same message"}
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
export function IndicatorChart({ items, compact = false }: { items: IndicatorView[]; compact?: boolean }) {
  const paired = items.some((i) => i.before);
  return (
    <div className={`${compact ? "" : "mt-3"} flex flex-col gap-1.5`} data-testid="indicator-chart" data-paired={paired ? "yes" : "no"}>
      {items.map((i) => {
        const values = [i.mean - 4 * i.sd, i.mean + 4 * i.sd, i.after.value, ...(i.before ? [i.before.value] : [])];
        const lo = Math.min(...values);
        const hi = Math.max(...values);
        const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
        const ref = `${+(i.mean - 2 * i.sd).toFixed(1)}–${+(i.mean + 2 * i.sd).toFixed(1)}`;
        return (
          <div key={i.key} className="grid grid-cols-[minmax(7.5rem,10rem)_minmax(0,1fr)_7.5rem] items-center gap-2 text-[12px]" data-testid={`indicator-${i.key}`}>
            <div className="min-w-0">
              <p className="font-medium leading-tight">{`${i.label} (${i.unit})`}</p>
              <p className="truncate text-[11px] text-[var(--mg-faint)]" title={i.source}>
                {i.source}
              </p>
            </div>
            <div className="relative h-6" role="img" aria-label={`${i.label}: reference range ${ref}${i.before ? `, v${i.before.version} ${i.before.value}` : ""}, v${i.after.version} ${i.after.value}`}>
              <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--mg-line-strong)]" />
              <span className="absolute bottom-1 top-1 rounded bg-[rgba(132,216,166,0.18)]" style={{ left: x(i.mean - 2 * i.sd), width: `calc(${x(i.mean + 2 * i.sd)} - ${x(i.mean - 2 * i.sd)})` }} />
              <span className="absolute bottom-0.5 top-0.5 w-px bg-[var(--mg-dim)]" style={{ left: x(i.mean) }} title={`Individual baseline mean ${i.mean}`} />
              {i.before ? <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--mg-dim)] bg-[var(--mg-bg)]" style={{ left: x(i.before.value) }} title={`v${i.before.version}: ${i.before.value} (z ${i.before.z})`} /> : null}
              <span className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--mg-bg)] ${i.after.flagged ? "bg-[var(--mg-caution)]" : "bg-[var(--mg-text)]"}`} style={{ left: x(i.after.value) }} title={`v${i.after.version}: ${i.after.value} (z ${i.after.z})`} />
            </div>
            <p className="text-right tabular-nums">
              {i.before ? <span className="text-[var(--mg-dim)]">{`${i.before.value}${i.before.flagged ? " ⚑" : ""} → `}</span> : null}
              <span className={i.after.flagged ? "text-[var(--mg-caution)]" : ""}>{`${i.after.value}${i.after.flagged ? " ⚑" : ""}`}</span>
              <span className="ml-1 text-[11px] text-[var(--mg-faint)]">{`z ${i.after.z > 0 ? "+" : ""}${i.after.z.toFixed(2)}`}</span>
            </p>
          </div>
        );
      })}
      <p className="text-[11px] text-[var(--mg-faint)]">{`Green band = reference range (individual baseline ± 2 SD, demo threshold) · line = baseline mean · ⚑ = outside the range${paired ? " · ○ original → ● retest (shown together only when both are comparable; no improvement is computed)" : ""} · summary indicators only, no raw sEMG waveform.`}</p>
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

/** Structured communication stream of the case (newest at the bottom; scrolls on its own). */
export function CommList({ items }: { items: CommItem[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);
  return (
    <ol ref={ref} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1" data-testid="comm-list">
      {items.map((it) => (
        <li key={it.id} className={`rounded-xl border bg-[var(--mg-bg)] px-2.5 py-1.5 ${KIND_STYLE[it.kind]}`} data-kind={it.kind} data-testid={`comm-${it.kind}`}>
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
  );
}

/**
 * Inline review form (inside the decision panel, no modal): selectable, editable reason templates and
 * the reason itself. The content that will be sent is shown above it in the panel. Cancel keeps the draft.
 */
export function ReviewForm({ c, decision, reviewer, draft, setDraft, onCancel, onConfirm }: { c: Case; decision: Decision; reviewer: string; draft: string; setDraft: (v: string) => void; onCancel: () => void; onConfirm: (reason: string) => string | null }) {
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <form
      className="flex flex-col gap-2"
      aria-labelledby="review-form-title"
      data-testid="confirm-dialog"
      data-decision={decision}
      onSubmit={(e) => {
        e.preventDefault();
        setError(onConfirm(draft));
      }}
    >
      <p id="review-form-title" className="text-[14px] font-semibold">{`Confirm: ${primaryLabel(decision, c)}`}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reason templates (editable)">
        {REASONS[decision].map((r) => (
          <button key={r} type="button" onClick={() => setDraft(r)} aria-pressed={draft === r} className={`rounded-full border px-2 py-0.5 text-left text-[12px] ${draft === r ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)]" : "border-[var(--mg-line-strong)]"}`} data-testid="reason-template">
            {r}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-[12px] text-[var(--mg-dim)]">
        {"Reason (required, recorded with the decision)"}
        <textarea ref={textRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1 text-[13px] text-[var(--mg-text)]" data-testid="confirm-reason" />
      </label>
      <p className="text-[11px] text-[var(--mg-faint)]">{`Reviewer: ${reviewer} (demo identity)`}</p>
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--mg-caution)]" data-testid="confirm-error">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-lg border border-[var(--mg-line-strong)] px-3 text-[13px]" data-testid="confirm-cancel">
          {"Cancel (draft kept)"}
        </button>
        <button type="submit" className="min-h-9 rounded-lg bg-[var(--mg-coral)] px-4 text-[13px] font-semibold text-[#1a0f0c]" data-testid="confirm-submit">
          {decision === "approve" ? "Confirm and publish" : `Confirm: ${DECISION_WORD[decision]}`}
        </button>
      </div>
    </form>
  );
}
