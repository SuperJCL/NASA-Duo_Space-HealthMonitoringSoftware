// MyoMars base station: CREW OVERVIEW view model (pure, render-neutral, tested).
//
// One card per crew member of the run. Device connection, data validity and event status are
// three SEPARATE statements: no combined "health light". Without valid data the card says the
// state cannot be assessed, never that it is normal. Unread counts come from accepted inbound
// messages after the base last viewed the case (duplicates are never accepted, re-renders never
// count), so they cannot grow on their own.

import { latest, type Case, type StationState, type TimelineEntry } from "./station";
import { buildFlow, hhmmss, type Owner } from "./flow";
import type { Tone } from "./views";

/** Inbound messages that count as "new for the base" (device receipts do not). */
export const UNREAD_TYPES = ["observation.submitted", "local.hud.report", "hud.ack", "hud.defer", "retest.completed", "retest.result"] as const;
const isUnreadType = (t: string | undefined) => !!t && (UNREAD_TYPES as readonly string[]).includes(t);

export const UNREAD_TEXT: Record<(typeof UNREAD_TYPES)[number], string> = {
  "observation.submitted": "Device observation received, being checked",
  "local.hud.report": "Astronaut report",
  "hud.ack": "Acknowledged by Crew",
  "hud.defer": "Deferred by the crew",
  "retest.completed": "Crew reports the retest done",
  "retest.result": "Retest result returned",
};

export type CaseSummary = {
  caseId: string;
  source: "Device observation" | "HUD report";
  /** Short status of the event for the card ("需要基地审核", "等待宇航员确认", ...). */
  text: string;
  tone: Tone;
  owner: Owner;
  closed: boolean;
  needsBase: boolean;
};

export type CrewCardView = {
  astronautId: string;
  callsign: string;
  task: string;
  evaStartedAt: string | null;
  connection: { state: "connected" | "disconnected" | "unknown"; text: string };
  data: { validity: "valid" | "invalid" | "checking" | "none"; text: string; summary: string };
  /** The event to show on the card (needs the base first, then the latest open one, else the latest). */
  event: CaseSummary | null;
  cases: CaseSummary[];
  openCases: number;
  needsBase: number;
  unread: number;
  /** Latest accepted inbound message for this astronaut (drives the one-off card pulse). */
  latestInbound: TimelineEntry | null;
};

export function unreadEntries(s: StationState, c: Case): TimelineEntry[] {
  return s.timeline.filter((t) => t.caseId === c.caseId && t.kind === "in" && isUnreadType(t.type) && (!c.viewedAt || t.at > c.viewedAt));
}

export function caseSummary(s: StationState, c: Case, mock: boolean): CaseSummary {
  const f = buildFlow(s, c, { mock });
  const n = f.current?.node;
  const ev = latest(c);
  const source = c.evaluations[0]?.trigger === "report" ? "HUD report" : "Device observation";
  let text: string;
  let tone: Tone = "neutral";
  if (f.finished) text = "Handled (Case Closed)";
  else if (!n) text = "–";
  else if (n.state === "running") {
    text = ev.trigger === "report" ? "Astronaut report received, being checked" : ev.version > 1 ? "Retest result returned, re-evaluating" : "Device observation received, being checked";
    tone = "caution";
  } else if (n.state === "human") {
    // A normal result with no alert still needs a human to record / close it, but it is not an alarm.
    const calm = c.alert.level === "none" && ev.result.outcome === "within-baseline";
    text = n.label === "Awaiting Base Review" ? "Awaiting Base Review" : n.label === "Continue Monitoring" ? "Continue Monitoring (case open)" : calm ? "Within Reference Range · awaiting base record" : ev.version > 1 ? "Retest returned, awaiting base decision" : "Awaiting base decision";
    tone = calm ? "ok" : "alert";
  } else if (n.state === "stopped") {
    text = n.label === "Acknowledged by Crew" ? "Deferred by the crew" : n.label === "Retest sent" ? "Send failed: resend needed" : `Stopped at: ${n.label}`;
    tone = "alert";
  } else if (n.state === "waiting") {
    text = `Waiting: ${n.label}`;
    tone = "caution";
  } else text = n.label;
  return { caseId: c.caseId, source, text, tone, owner: f.who, closed: f.finished, needsBase: !f.finished && f.who === "Base staff" };
}

export function crewCards(s: StationState, { mock }: { mock: boolean }): CrewCardView[] {
  const ids = [...Object.keys(s.crew)];
  for (const id of s.caseOrder) if (!ids.includes(s.cases[id].astronautId)) ids.push(s.cases[id].astronautId);
  return ids.map((astronautId) => {
    const m = s.crew[astronautId];
    const own = s.caseOrder.map((id) => s.cases[id]).filter((c) => c.astronautId === astronautId);
    const summaries = own.map((c) => caseSummary(s, c, mock));
    const open = summaries.filter((x) => !x.closed);
    const event = open.find((x) => x.needsBase) ?? open.at(-1) ?? summaries.at(-1) ?? null;
    const measured = own
      .flatMap((c) => c.evaluations)
      .filter((e) => e.observation)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .at(-1);
    let data: CrewCardView["data"];
    if (!measured) data = { validity: "none", text: "No measurement yet", summary: "Unable to Assess (no valid data)" };
    else if (measured.completedAt === null) data = { validity: "checking", text: `${hhmmss(measured.observation!.capturedAt).slice(0, 5)} · checking`, summary: "Data received, checking quality and comparability" };
    else if (["quality-blocked", "not-comparable", "result-incomplete", "analysis-failed"].includes(measured.result.outcome))
      data = { validity: "invalid", text: `${hhmmss(measured.observation!.capturedAt).slice(0, 5)} · not usable`, summary: `Unable to Assess: ${measured.result.headline}` };
    else data = { validity: "valid", text: `${hhmmss(measured.observation!.capturedAt).slice(0, 5)} · valid`, summary: measured.result.outcome === "within-baseline" ? "Latest measurement Within Reference Range" : measured.result.outcome === "single-feature" ? "One indicator outside the reference range (insufficient evidence)" : `${measured.result.comparisons.filter((x) => x.flagged).length} indicators outside the reference range` };
    const conn = m?.connection ?? "unknown";
    const inbound = s.timeline.filter((t) => t.kind === "in" && isUnreadType(t.type) && own.some((c) => c.caseId === t.caseId));
    return {
      astronautId,
      callsign: m?.callsign ?? astronautId,
      task: m?.task.title ?? "–",
      evaStartedAt: m?.evaStartedAt ?? null,
      connection: { state: conn, text: conn === "connected" ? `Connected${m?.connectionAt ? ` · ${hhmmss(m.connectionAt).slice(0, 5)}` : ""}` : conn === "disconnected" ? `Disconnected${m?.connectionAt ? ` since ${hhmmss(m.connectionAt).slice(0, 5)}` : ""}` : "Unknown (no device status message)" },
      data,
      event,
      cases: summaries,
      openCases: open.length,
      needsBase: open.filter((x) => x.needsBase).length,
      unread: own.reduce((n, c) => n + unreadEntries(s, c).length, 0),
      latestInbound: inbound.at(-1) ?? null,
    };
  });
}

export type Notice = { astronautId: string; callsign: string; caseId: string; text: string; at: string; count: number; eventId: string | null };

/** Clickable notifications: one per astronaut with unread messages (latest first). */
export function notifications(s: StationState, { mock }: { mock: boolean }): Notice[] {
  return crewCards(s, { mock })
    .filter((c) => c.unread > 0)
    .map((card) => {
      const own = s.caseOrder.map((id) => s.cases[id]).filter((c) => c.astronautId === card.astronautId);
      const entries = own.flatMap((c) => unreadEntries(s, c)).sort((a, b) => a.at.localeCompare(b.at));
      const last = entries.at(-1)!;
      // A new measurement / report shows the event's CURRENT status (it moves on while unread); feedback shows what arrived.
      const now = card.cases.find((x) => x.caseId === last.caseId);
      const text = (last.type === "observation.submitted" || last.type === "local.hud.report") && now ? now.text : UNREAD_TEXT[last.type as keyof typeof UNREAD_TEXT];
      return { astronautId: card.astronautId, callsign: card.callsign, caseId: last.caseId!, text, at: last.at, count: entries.length, eventId: last.eventId };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}
