"use client";

import { useState } from "react";
import { allowedDecisions, caseMessages, latest, messageKind, nextOwner, stageView, statusNoticeText, workbenchStage, type Case, type Decision, type OutMessage, type StationState } from "@/lib/station/station";
import type { NoticePayload, ReassessmentPayload, RetestRequestPayload } from "@/lib/station/protocol";
import { flowSteps } from "@/lib/station/views";
import type { StationApi } from "./useStation";
import { DECISION_TEXT, Label, OUT_TEXT, stageTitle, time } from "./ui";

const STEP_STYLE = {
  done: "border-[var(--mg-ok)] text-[var(--mg-ok)]",
  current: "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)] font-semibold text-[var(--mg-text)]",
  todo: "border-[var(--mg-line)] text-[var(--mg-faint)]",
  skipped: "border-dashed border-[var(--mg-line)] text-[var(--mg-faint)] line-through",
} as const;

/** The six demo steps of the selected event (or "waiting for an observation"). */
function FlowStepper({ c }: { c: Case | null }) {
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Handling flow" data-testid="station-flow">
      {flowSteps(c).map((s, i) => (
        <li key={s.id} aria-current={s.state === "current" ? "step" : undefined} className={`rounded-md border px-1.5 py-0.5 text-[11px] ${STEP_STYLE[s.state]}`} data-step={s.id} data-state={s.state} title={s.state === "skipped" ? "This case did not go through this step" : undefined}>
          {`${s.state === "done" ? "✓" : i + 1} ${s.label}`}
        </li>
      ))}
    </ol>
  );
}

/**
 * Right column: only what the base staff must handle NOW for the selected event, switched by its
 * stage (review → dispatched → reassessing → reassessed → decided / closed).
 */
export function ActionPanel({ c, state, api, mock }: { c: Case | null; state: StationState; api: StationApi; mock: boolean }) {
  if (!c) {
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="station-action" data-stage="none">
        <FlowStepper c={null} />
        <div>
          <Label>{"Current action"}</Label>
          <p className="text-[17px] font-semibold" data-testid="station-stage-title">
            {state.run ? "Awaiting observation" : "Awaiting scenario start"}
          </p>
          <p className="mt-1 text-[13px] text-[var(--mg-dim)]">{state.run ? "No action needed at this stage. When a standardised simulated measurement arrives, the base starts the simulated analysis automatically." : "No action needed at this stage. Until the Trigger is connected, add ?dev=1 to the address to open the development test entry."}</p>
        </div>
      </div>
    );
  }
  const stage = workbenchStage(c);
  const ev = latest(c);
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="station-action" data-stage={stage}>
      <FlowStepper c={c} />
      <div>
        <Label>{"Current action"}</Label>
        <p className="text-[17px] font-semibold" data-testid="station-stage-title">
          {stageTitle(c, stage)}
        </p>
        <p className="text-[13px] text-[var(--mg-coral)]">{nextOwner(c)}</p>
      </div>
      {stage === "analysing" || stage === "reassessing" ? <Progress c={c} state={state} /> : null}
      {stage === "review" || stage === "reassessed" ? <ReviewCard key={`${c.caseId}-${ev.version}-${c.phase}`} c={c} api={api} /> : null}
      {stage === "dispatched" ? <Dispatched c={c} state={state} api={api} mock={mock} /> : null}
      {stage === "decided" ? <Decided c={c} state={state} api={api} mock={mock} /> : null}
      {stage === "closed" ? <Closed c={c} state={state} api={api} mock={mock} /> : null}
    </div>
  );
}

function Progress({ c, state }: { c: Case; state: StationState }) {
  const ev = latest(c);
  const stages = stageView(ev);
  const running = stages.findIndex((s) => s.status === "running");
  const receipt = ev.trigger === "retest" ? state.outbox.find((m) => m.type === "station.receipt" && m.caseId === c.caseId && (m.envelope.payload as { receivedEventId?: string }).receivedEventId === ev.sourceEventId) : null;
  return (
    <div className="flex flex-col gap-1" data-testid="station-progress">
      <p className="text-[13px]">
        {ev.trigger === "retest"
          ? `Retest result received, ${receipt ? (receipt.delivery === "failed" ? "receipt failed to send" : "receipt sent") : "receipt not sent"}; re-evaluating.`
          : "Standardised simulated measurement received; simulated analysis running. A candidate for base review is prepared only once it completes."}
      </p>
      <p className="text-[12px] text-[var(--mg-dim)]">{running >= 0 ? `Progress: step ${running + 1}/${stages.length} · ${stages[running].label} (details in the centre column)` : "Progress: finishing"}</p>
      <p className="text-[12px] text-[var(--mg-faint)]">{"No action needed at this stage."}</p>
    </div>
  );
}

/** What a decision does, shown before confirming: messages (action / status / none) and the resulting case status. */
function DecisionEffect({ c, decision, actionCount }: { c: Case; decision: Decision; actionCount: number }) {
  const status = statusNoticeText(c, decision);
  const effect: Record<Decision, string> = {
    approve: `Sends ${actionCount} action message${actionCount === 1 ? "" : "s"} (content shown above). The case moves to “Dispatched, awaiting feedback”; next, the crew acknowledges and retests.`,
    reject: "Sends no message. The case stays open and the alert stays; base staff then close the case or choose Continue Monitoring.",
    close: "The case closes and the alert clears; no action message is sent.",
    "keep-open": "The case stays open and the alert stays; no action message is sent. Base staff can close it at any time.",
  };
  return (
    <div className="rounded-lg border border-[var(--mg-line)] p-2 text-[12px]" data-testid="station-decision-effect" data-decision={decision}>
      <p className="text-[var(--mg-dim)]">{`What “${DECISION_TEXT[decision]}” does: ${effect[decision]}`}</p>
      {status ? (
        <div className="mt-1.5 rounded-md bg-[rgba(255,255,255,0.04)] p-2" data-testid="station-outgoing-status">
          <p className="text-[11px] text-[var(--mg-faint)]">{"Status notice to be published (only tells the HUD the case status; not an action):"}</p>
          <p className="text-[13px] text-[var(--mg-text)]">{status}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Choose a decision, see what it publishes, give a reason and a reviewer, then confirm. */
function DecisionForm({ c, api, options, actionCount = 0 }: { c: Case; api: StationApi; options: Decision[]; actionCount?: number }) {
  const ev = latest(c);
  const [choice, setChoice] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [reviewer, setReviewer] = useState("Base duty officer");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="station-review">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Review decision">
        {options.map((d) => (
          <button key={d} type="button" aria-pressed={choice === d} onClick={() => setChoice(d)} className={`min-h-9 rounded-lg border px-3 text-[13px] ${choice === d ? "border-[var(--mg-coral)] bg-[var(--mg-coral-soft)]" : "border-[var(--mg-line-strong)]"}`} data-testid={`station-decide-${d}`}>
            {DECISION_TEXT[d]}
          </button>
        ))}
      </div>
      {choice ? <DecisionEffect c={c} decision={choice} actionCount={actionCount} /> : null}
      <label className="flex flex-col gap-0.5 text-[12px] text-[var(--mg-dim)]">
        {"Reason (required, recorded with the decision)"}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1 text-[13px] text-[var(--mg-text)]" data-testid="station-review-reason" />
      </label>
      <label className="flex items-center gap-2 text-[12px] text-[var(--mg-dim)]">
        {"Reviewer"}
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--mg-line)] bg-[var(--mg-bg)] px-2 py-1 text-[13px] text-[var(--mg-text)]" data-testid="station-reviewer" />
      </label>
      <button
        type="button"
        disabled={!choice}
        onClick={() => choice && setError(api.review(c.caseId, ev.version, choice, reason, reviewer))}
        className="min-h-10 rounded-xl bg-[var(--mg-coral)] px-4 text-[14px] font-semibold text-[#1a0f0c] disabled:opacity-40"
        data-testid="station-review-confirm"
      >
        {choice ? (choice === "approve" ? `Confirm: approve and send ${actionCount} action message${actionCount === 1 ? "" : "s"}` : `Confirm: ${DECISION_TEXT[choice]}`) : "Choose a decision first"}
      </button>
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--mg-caution)]" data-testid="station-review-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const RULE = "Only “Approve and send” sends action messages to the HUD; Close case and Continue Monitoring only publish a status notice; Reject sends nothing.";

function ReviewCard({ c, api }: { c: Case; api: StationApi }) {
  const ev = latest(c);
  const cand = ev.result.candidate;
  const options = allowedDecisions(c);
  const sends = cand?.kind === "notice-and-retest" ? 2 : cand?.kind === "retest" ? 1 : 0;
  return (
    <div className="flex flex-col gap-3">
      {ev.version > 1 ? (
        <p className="text-[12px] text-[var(--mg-dim)]" data-testid="station-reassessed-note">
          {ev.result.outcome === "within-baseline"
            ? "Decide: Close case (clears the alert) or Continue Monitoring (keeps the alert)."
            : "Decide from the re-evaluation: approve another retest, Close case, or Continue Monitoring."}
        </p>
      ) : null}
      {cand ? (
        <div className="rounded-xl border border-dashed border-[var(--mg-coral)] p-3" data-testid="station-candidate" data-kind={cand.kind}>
          <p className="text-[12px] font-semibold text-[var(--mg-coral)]">{"Candidate suggested by the Simulated Analysis · not published"}</p>
          <p className="font-medium">{cand.title}</p>
          <p className="text-[12px] text-[var(--mg-dim)]">{cand.rationale}</p>
          {sends ? (
            <div className="mt-2 flex flex-col gap-2" data-testid="station-outgoing">
              <p className="text-[12px] text-[var(--mg-faint)]">{`Action message${sends === 1 ? "" : "s"} sent to the HUD on approval (${sends}, actual content):`}</p>
              {cand.kind === "notice-and-retest" ? (
                <div className="rounded-lg bg-[rgba(255,255,255,0.04)] p-2 text-[13px]" data-testid="station-outgoing-notice">
                  <p className="text-[11px] text-[var(--mg-faint)]">{"① Notice · crew acknowledgement required"}</p>
                  <p>{cand.notice.text}</p>
                </div>
              ) : null}
              {cand.kind !== "record-only" ? (
                <div className="rounded-lg bg-[rgba(255,255,255,0.04)] p-2 text-[13px]" data-testid="station-outgoing-retest">
                  <p className="text-[11px] text-[var(--mg-faint)]">{`${cand.kind === "notice-and-retest" ? "②" : "①"} Retest task · crew acknowledgement and completion required`}</p>
                  <p>{cand.retest.instructions}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-[12px]" data-testid="station-outgoing-none">
              {"Close case or Continue Monitoring publishes only one status notice; choose a decision to preview its full text."}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-[var(--mg-caution)]">{"No candidate (analysis incomplete); no action message is sent."}</p>
      )}
      <DecisionForm c={c} api={api} options={options} actionCount={sends} />
      <p className="text-[11px] text-[var(--mg-faint)]">{RULE}</p>
    </div>
  );
}

function Step({ ok, label, value, testId, neutral = false }: { ok: boolean | null; label: string; value: string; testId: string; neutral?: boolean }) {
  // `neutral`: a local mock hand-off is shown as done but NOT as a delivery success.
  const icon = ok === null ? "○" : ok ? (neutral ? "·" : "✓") : "!";
  const cls = ok === null || neutral ? "text-[var(--mg-faint)]" : ok ? "text-[var(--mg-ok)]" : "text-[var(--mg-caution)]";
  return (
    <li className="flex gap-2 text-[12px]" data-testid={testId} data-ok={ok === null ? "pending" : ok ? "yes" : "no"} data-mock={neutral ? "true" : undefined}>
      <span aria-hidden className={`w-4 shrink-0 text-center ${cls}`}>
        {icon}
      </span>
      <span className="text-[var(--mg-dim)]">{label}</span>
      <span className="ml-auto text-right">{value}</span>
    </li>
  );
}

/** One station message and its separate statuses: sent by the station, HUD receipt, astronaut confirmation (actions only). */
function MessageStatus({ m, api, mock, testId }: { m: OutMessage; api: StationApi; mock: boolean; testId: string }) {
  const p = m.envelope.payload as Partial<NoticePayload & RetestRequestPayload & ReassessmentPayload>;
  const action = messageKind(m.type) === "action";
  return (
    <li className="rounded-xl border border-[var(--mg-line)] p-2.5" data-testid={testId} data-case-status={p.caseStatus}>
      <p className="text-[13px] font-medium">{action ? OUT_TEXT[m.type] : "Status notice (information only, not an action)"}</p>
      <p className="mt-0.5 text-[12px] text-[var(--mg-dim)]">{p.text ?? p.instructions ?? p.summary ?? ""}</p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        <Step
          ok={m.delivery === "sent" ? true : m.delivery === "failed" ? false : null}
          neutral={mock && m.delivery === "sent"}
          label="1 Sent by the base"
          value={m.delivery === "failed" ? "Send failed" : m.delivery === "queued" ? "Sending…" : mock ? `Local simulation only · ${time(m.adapterAt)}` : time(m.adapterAt)}
          testId="step-adapter"
        />
        <Step ok={m.hudReceivedAt ? true : null} label="2 Received by HUD" value={m.hudReceivedAt ? time(m.hudReceivedAt) : "No receipt yet"} testId="step-hud" />
        {action ? <Step ok={m.feedback === "acknowledged" ? true : m.feedback === "deferred" ? false : null} label="3 Acknowledged by Crew" value={m.feedback === "acknowledged" ? `Acknowledged ${time(m.feedbackAt)}` : m.feedback === "deferred" ? `Deferred: ${m.feedbackNote ?? ""}` : "No feedback yet"} testId="step-crew" /> : null}
      </ul>
      {m.delivery === "failed" ? (
        <button type="button" onClick={() => api.resend(m.eventId)} className="mt-1.5 min-h-8 rounded-lg border border-[var(--mg-caution)] px-2 text-[12px] text-[var(--mg-caution)]" data-testid={`station-resend-${m.eventId}`}>
          {"Resend the same message"}
        </button>
      ) : null}
    </li>
  );
}

const MOCK_NOTE = "Demo mode: messages are only handed to the local simulated channel; that does not mean the HUD received them. Steps 2 and 3 update only when the HUD replies; they are never inferred.";

function Dispatched({ c, state, api, mock }: { c: Case; state: StationState; api: StationApi; mock: boolean }) {
  const lastApproval = [...c.reviews].reverse().find((r) => r.decision === "approve");
  const msgs = caseMessages(state, c.caseId).filter((m) => messageKind(m.type) === "action" && (m.envelope.payload as { evaluationVersion?: number }).evaluationVersion === lastApproval?.version);
  const rt = c.retests.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {lastApproval ? <p className="text-[12px] text-[var(--mg-dim)]">{`Approved by ${lastApproval.reviewer} at ${time(lastApproval.at)} (v${lastApproval.version}): ${lastApproval.reason}`}</p> : null}
      <ul className="flex flex-col gap-2">
        {msgs.map((m) => (
          <MessageStatus key={m.eventId} m={m} api={api} mock={mock} testId={`station-dispatch-${m.type === "station.notice.approved" ? "notice" : "retest"}`} />
        ))}
      </ul>
      {rt ? (
        <p className="text-[13px]" data-testid="station-retest-list" data-status={rt.status}>
          {`Retest task: ${{ requested: "requested, awaiting the result", acknowledged: "Acknowledged by Crew, awaiting the result", deferred: "deferred by the crew", completed: "the crew reports it done, awaiting the retest data", "result-received": `result received → v${rt.resultVersion}` }[rt.status]}`}
        </p>
      ) : null}
      {mock ? <p className="text-[11px] text-[var(--mg-faint)]">{MOCK_NOTE}</p> : null}
      <details className="rounded-xl border border-[var(--mg-line)] px-3 py-2">
        <summary className="cursor-pointer text-[12px] text-[var(--mg-dim)]">{"Other actions (close the case early)"}</summary>
        <div className="mt-2">
          <DecisionForm c={c} api={api} options={allowedDecisions(c)} />
        </div>
      </details>
    </div>
  );
}

/** The latest status notification published for the case (close / keep-open), with its delivery statuses. */
function StatusSent({ c, state, api, mock }: { c: Case; state: StationState; api: StationApi; mock: boolean }) {
  const m = [...caseMessages(state, c.caseId)].reverse().find((x) => messageKind(x.type) === "status");
  if (!m) return null;
  return (
    <ul className="flex flex-col gap-2" data-testid="station-status-sent">
      <MessageStatus m={m} api={api} mock={mock} testId="station-status-message" />
    </ul>
  );
}

function Decided({ c, state, api, mock }: { c: Case; state: StationState; api: StationApi; mock: boolean }) {
  const last = c.reviews.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {last ? <p className="text-[13px]" data-testid="station-decision">{`${DECISION_TEXT[last.decision]} · ${last.reviewer} · ${time(last.at)}: ${last.reason}`}</p> : null}
      {c.phase === "rejected" ? (
        <p className="text-[12px] text-[var(--mg-dim)]">{"Candidate rejected; no message was sent. The case is still open and the alert stays: Close case or choose Continue Monitoring."}</p>
      ) : (
        <>
          <p className="text-[12px] text-[var(--mg-dim)]">{"Continue Monitoring: the case stays open and the alert stays; a status notice (not an action) was published to the HUD. It can be closed at any time."}</p>
          <StatusSent c={c} state={state} api={api} mock={mock} />
        </>
      )}
      <DecisionForm c={c} api={api} options={allowedDecisions(c)} />
      <p className="text-[11px] text-[var(--mg-faint)]">{RULE}</p>
    </div>
  );
}

function Closed({ c, state, api, mock }: { c: Case; state: StationState; api: StationApi; mock: boolean }) {
  const last = c.reviews.at(-1);
  const ev = latest(c);
  return (
    <div className="flex flex-col gap-2" data-testid="station-closed">
      <p className="text-[13px] font-medium" data-testid="station-decision">{last ? `Closed by ${last.reviewer} at ${time(last.at)} (v${last.version})` : "Case Closed"}</p>
      {last ? <p className="text-[13px]">{`Reason: ${last.reason}`}</p> : null}
      <p className="text-[12px] text-[var(--mg-dim)]">{`Final evaluation v${ev.version}: ${ev.result.headline}`}</p>
      <StatusSent c={c} state={state} api={api} mock={mock} />
      <div>
        <p className="text-[12px] text-[var(--mg-faint)]">{`Handling record (${c.reviews.length} human decision${c.reviews.length === 1 ? "" : "s"}, ${c.retests.length} retest task${c.retests.length === 1 ? "" : "s"})`}</p>
        <ol className="mt-0.5 space-y-0.5 text-[12px] text-[var(--mg-dim)]" data-testid="station-review-history">
          {c.reviews.map((r, i) => (
            <li key={i}>{`v${r.version} · ${DECISION_TEXT[r.decision]} · ${r.reviewer} · ${time(r.at)}: ${r.reason}`}</li>
          ))}
        </ol>
      </div>
      <p className="text-[11px] text-[var(--mg-faint)]">{"Case Closed: nothing awaits review. A closing status notice (not an action) was published to the HUD; no new action messages will be sent."}</p>
      {mock ? <p className="text-[11px] text-[var(--mg-faint)]">{MOCK_NOTE}</p> : null}
    </div>
  );
}
