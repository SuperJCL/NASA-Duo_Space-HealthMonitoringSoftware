// MyoMars Mars Base: MISSION & CREW panel view model (pure, render-neutral, tested).
//
// The right-hand panel of the Mission Map: the mission context and what is KNOWN about each crew
// member. Every line is read from recorded state. Nothing unknown is filled in: there is no vital
// sign source and no position source in this demo, and a device or HUD link nobody reported stays
// "unknown". Data age is display only: no business step and no health statement depends on it.
// Terrain, routes and planning scores never enter this view.

import { type Case, type StationState } from "./station";
import type { CrewCardView } from "./crew";
import { eventChain } from "./event-chain";
import type { Tone } from "./views";

/** Inbound message types that come from the HUD (receipts, crew replies, retest). */
export const HUD_TYPES = ["hud.received", "hud.ack", "hud.defer", "retest.completed", "retest.result"] as const;
const HUD_WORD: Record<(typeof HUD_TYPES)[number], string> = {
  "hud.received": "Received by HUD",
  "hud.ack": "Acknowledged by Crew",
  "hud.defer": "Deferred by the crew",
  "retest.completed": "Crew reports the retest done",
  "retest.result": "Retest result returned",
};

export type Freshness = "fresh" | "aging" | "stale" | "none";
/** Display thresholds for the age of the latest measurement (minutes). Presentation only. */
export const FRESH_MIN = 5;
export const STALE_MIN = 30;

export type CaseLine = { caseId: string; text: string; tone: Tone; needsBase: boolean; waitingFor: string | null; since: string | null };

export type CrewLine = {
  astronautId: string;
  callsign: string;
  /** Device connection as reported by device status messages (local extension), else unknown. */
  device: { state: "connected" | "disconnected" | "unknown"; text: string };
  /** The last message the HUD sent for this person's cases (a fact), or none yet. */
  hud: { at: string | null; text: string };
  /** The latest measurement: when it was taken, how old it is, and whether it was usable. */
  data: { at: string | null; validity: CrewCardView["data"]["validity"]; text: string; summary: string; ageMin: number | null; freshness: Freshness };
  openCases: CaseLine[];
  needsBase: number;
  unread: number;
};

export type MissionCrewView = {
  crew: CrewLine[];
  totals: { cases: number; open: number; closed: number; needsBase: number };
};

const ageMinutes = (iso: string | null, now: number) => (iso && now ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000)) : null);
export const freshnessOf = (ageMin: number | null): Freshness => (ageMin === null ? "none" : ageMin <= FRESH_MIN ? "fresh" : ageMin <= STALE_MIN ? "aging" : "stale");
export const ageText = (ageMin: number | null) => (ageMin === null ? "–" : ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin} min ago` : `${Math.floor(ageMin / 60)} h ${String(ageMin % 60).padStart(2, "0")} min ago`);

/** Latest observation capture time over a person's cases (the measurement itself, not its arrival). */
function latestMeasurement(cases: Case[]): string | null {
  let at: string | null = null;
  for (const c of cases) for (const e of c.evaluations) if (e.observation && (!at || e.observation.capturedAt > at)) at = e.observation.capturedAt;
  return at;
}

export function missionCrewView(s: StationState, cards: CrewCardView[], { mock, now }: { mock: boolean; now: number }): MissionCrewView {
  const crew = cards.map((card): CrewLine => {
    const own = s.caseOrder.map((id) => s.cases[id]).filter((c) => c.astronautId === card.astronautId);
    const ids = new Set(own.map((c) => c.caseId));
    const lastHud = s.timeline.filter((t) => t.kind === "in" && t.caseId && ids.has(t.caseId) && (HUD_TYPES as readonly string[]).includes(t.type ?? "")).at(-1);
    const measuredAt = latestMeasurement(own);
    const ageMin = ageMinutes(measuredAt, now);
    const openCases = own
      .filter((c) => c.phase !== "closed")
      .map((c): CaseLine => {
        const summary = card.cases.find((x) => x.caseId === c.caseId);
        const chain = eventChain(s, c, { mock });
        const cur = chain.nodes.find((n) => n.id === chain.current) ?? null;
        return { caseId: c.caseId, text: summary?.text ?? "–", tone: summary?.tone ?? "neutral", needsBase: summary?.needsBase ?? false, waitingFor: cur?.waitingFor ?? null, since: cur?.since ?? null };
      });
    return {
      astronautId: card.astronautId,
      callsign: card.callsign,
      device: card.connection,
      hud: lastHud ? { at: lastHud.at, text: HUD_WORD[lastHud.type as (typeof HUD_TYPES)[number]] } : { at: null, text: mock ? "No HUD in the local simulation" : "No HUD message yet" },
      data: { at: measuredAt, validity: card.data.validity, text: card.data.text, summary: card.data.summary, ageMin, freshness: freshnessOf(ageMin) },
      openCases,
      needsBase: card.needsBase,
      unread: card.unread,
    };
  });
  const all = s.caseOrder.map((id) => s.cases[id]);
  const open = all.filter((c) => c.phase !== "closed").length;
  return { crew, totals: { cases: all.length, open, closed: all.length - open, needsBase: crew.reduce((n, c) => n + c.needsBase, 0) } };
}
