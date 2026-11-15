// MyoMars base station: COMMUNICATION STREAM of one case (pure, render-neutral, tested).
//
// A structured, time-ordered list, not a chat: the astronaut's report, internal analysis summaries
// (base only, never sent), base decisions (records), action messages (notice, retest task) with
// their separate delivery statuses, HUD receipts, astronaut feedback, retest results and status
// notifications. Statuses only change when the matching message arrived; nothing is inferred.

import { caseMessages, messageKind, type Case, type OutMessage, type StationState } from "./station";
import { hhmmss } from "./flow";

export type CommKind = "report" | "analysis" | "decision" | "action" | "receipt" | "feedback" | "result" | "status";
export const COMM_BADGE: Record<CommKind, string> = {
  report: "Astronaut report · simulated",
  analysis: "Analysis summary · base only, not sent",
  decision: "Base record · not sent",
  action: "Action message · base → crew",
  receipt: "Device receipt",
  feedback: "Crew feedback",
  result: "Retest result · simulated",
  status: "Status notice · not an action",
};
export type CommLine = { label: string; value: string; state: "done" | "pending" | "failed" | "local" };
export type CommItem = { id: string; at: string; kind: CommKind; title: string; text: string; lines: CommLine[] };

const DECISION = { approve: "approve and dispatch", reject: "reject the candidate", close: "close the case", "keep-open": "Continue Monitoring" } as const;

function deliveryLines(m: OutMessage, mock: boolean): CommLine[] {
  const lines: CommLine[] = [
    { label: "Sent by the base", value: m.delivery === "failed" ? `send failed: ${m.deliveryNote ?? ""}` : m.delivery === "queued" ? "sending" : mock ? `local simulation only · ${hhmmss(m.adapterAt)}` : hhmmss(m.adapterAt), state: m.delivery === "failed" ? "failed" : m.delivery === "queued" ? "pending" : mock ? "local" : "done" },
    { label: "Received by HUD", value: m.hudReceivedAt ? hhmmss(m.hudReceivedAt) : "no receipt yet", state: m.hudReceivedAt ? "done" : "pending" },
  ];
  if (messageKind(m.type) === "action") lines.push({ label: "Acknowledged by Crew", value: m.feedback === "acknowledged" ? hhmmss(m.feedbackAt) : m.feedback === "deferred" ? `deferred · ${hhmmss(m.feedbackAt)}` : "no feedback yet", state: m.feedback === "acknowledged" ? "done" : m.feedback === "deferred" ? "failed" : "pending" });
  return lines;
}
const text = (m: OutMessage) => {
  const p = m.envelope.payload as { text?: string; instructions?: string; summary?: string };
  return p.text ?? p.instructions ?? p.summary ?? "";
};
const TITLE: Partial<Record<OutMessage["type"], string>> = { "station.notice.approved": "Base-reviewed notice", "station.retest.requested": "Retest task" };

export function commStream(s: StationState, c: Case, { mock }: { mock: boolean }): CommItem[] {
  const items: CommItem[] = [];
  for (const ev of c.evaluations) {
    if (ev.trigger === "report" && ev.report) items.push({ id: `${ev.version}:report`, at: ev.startedAt, kind: "report", title: "Astronaut report", text: `"${ev.report.text}"${ev.report.request ? `\nRequest: ${ev.report.request}` : ""}`, lines: [] });
    else if (ev.trigger === "retest") items.push({ id: `${ev.version}:result`, at: ev.startedAt, kind: "result", title: "Retest result received", text: `Standardised simulated measurement · data time ${hhmmss(ev.observation?.capturedAt ?? null)}; receipt sent, analysis round ${ev.version} started.`, lines: [] });
    else items.push({ id: `${ev.version}:obs`, at: ev.startedAt, kind: "analysis", title: "Device observation received", text: `Standardised simulated measurement · data time ${hhmmss(ev.observation?.capturedAt ?? null)}; simulated analysis started automatically.`, lines: [] });
    if (ev.completedAt) {
      items.push({
        id: `${ev.version}:done`,
        at: ev.completedAt,
        kind: "analysis",
        title: `${ev.trigger === "report" ? "Check" : "Analysis"} round ${ev.version}: result`,
        text: `${ev.result.headline}${ev.result.candidate ? `\nCandidate (not sent): ${ev.result.candidate.title}` : ""}`,
        lines: [],
      });
    }
  }
  c.reviews.forEach((r, i) => items.push({ id: `review:${i}`, at: r.at, kind: "decision", title: `Base decision: ${DECISION[r.decision]} (v${r.version})`, text: `${r.reviewer}: ${r.reason}`, lines: [] }));
  for (const m of caseMessages(s, c.caseId)) {
    const kind = messageKind(m.type);
    if (kind === "action") items.push({ id: m.eventId, at: m.envelope.sentAt, kind: "action", title: TITLE[m.type] ?? "Action message", text: text(m), lines: deliveryLines(m, mock) });
    else if (kind === "status") {
      const st = (m.envelope.payload as { caseStatus?: string }).caseStatus;
      items.push({ id: m.eventId, at: m.envelope.sentAt, kind: "status", title: `Status notice: ${st === "closed" ? "Case Closed" : st === "monitoring" ? "Continue Monitoring" : (st ?? "")}`, text: text(m), lines: deliveryLines(m, mock).slice(0, 2) });
    } else continue;
    if (m.hudReceivedAt) items.push({ id: `${m.eventId}:recv`, at: m.hudReceivedAt, kind: "receipt", title: `Received by HUD: ${kind === "status" ? "status notice" : (TITLE[m.type] ?? "")}`, text: "The device received it (not a crew acknowledgement)", lines: [] });
    if (m.feedbackAt && m.feedback !== "none") items.push({ id: `${m.eventId}:fb`, at: m.feedbackAt, kind: "feedback", title: m.feedback === "acknowledged" ? `Acknowledged by Crew: ${TITLE[m.type] ?? ""}` : `Deferred by the crew: ${TITLE[m.type] ?? ""}`, text: m.feedbackNote ?? (m.feedback === "acknowledged" ? "Acknowledged on the HUD" : ""), lines: [] });
  }
  for (const r of c.retests) if (r.completedAt) items.push({ id: `${r.retestId}:completed`, at: r.completedAt, kind: "feedback", title: "Crew reports the retest done", text: "Waiting for the retest data (optional extension message)", lines: [] });
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
