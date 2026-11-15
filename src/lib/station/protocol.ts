// MyoMars base station: message envelope and payloads.
//
// Since 2026-11-14 the station uses the SHARED contracts v1 (src/contracts, docs/myomars/PROTOCOL.md).
// This module keeps the names the station code already used and adds the station's view:
// which types it receives and which it sends. Everything carried here is SIMULATED data.
//
// Migration from myomars.station/v0-draft: schema "myomars/v1"; new required `sessionId`;
// relay-added `seq`, `receivedAt`, `sender` on delivery; new types retest.completed,
// station.audit.assessment, station.audit.review; optional Observation.deviceId / imu.

import { EVENT_RULES, parseIncoming, SCHEMA, type Envelope as SharedEnvelope, type EventType } from "@/contracts/envelope.ts";
export { EvaEnded, HudAck, HudDefer, HudReceived, Observation, Protocol, RetestCompleted, RetestResult, ScenarioStart } from "@/contracts/payloads.ts";
export type { NoticePayload, ReassessmentPayload, ReceiptPayload, RetestRequestPayload } from "@/contracts/payloads.ts";
export { SCHEMA };

export const INBOUND_TYPES = ["scenario.start", "scenario.reset", "observation.submitted", "hud.received", "hud.ack", "hud.defer", "retest.completed", "retest.result"] as const satisfies readonly EventType[];
// scenario.start: base staff explicitly start the (simulated) EVA; station.eva.ended: they end it (mission phase only).
export const OUTBOUND_TYPES = ["station.notice.approved", "station.retest.requested", "station.receipt", "station.reassessment", "station.audit.assessment", "station.audit.review", "scenario.start", "station.eva.ended"] as const satisfies readonly EventType[];
export type InboundType = (typeof INBOUND_TYPES)[number];
export type OutboundType = (typeof OUTBOUND_TYPES)[number];

export type Envelope = SharedEnvelope;
/** Relay fields on a delivered envelope (absent in mock mode). */
export type DeliveryMeta = { seq?: number; receivedAt?: string; sender?: { role: string; clientId: string } };

export type InboundParse =
  | { ok: true; envelope: Envelope & DeliveryMeta; payload: unknown }
  | { ok: false; error: string; eventId: string | null };

/** Validate an inbound envelope (delivered by the relay, or injected in mock mode). Station-originated types are rejected here. */
export function parseInbound(raw: unknown): InboundParse {
  const r = parseIncoming(raw);
  if (!r.ok) return { ok: false, error: `${r.code === "invalid_payload" ? "invalid payload" : "invalid envelope"}: ${r.message}`, eventId: r.eventId };
  if (!(INBOUND_TYPES as readonly string[]).includes(r.value.type)) return { ok: false, error: `not an inbound type: ${r.value.type}`, eventId: r.value.eventId };
  return { ok: true, envelope: r.value, payload: r.payload };
}

export const isInboundType = (t: string): t is InboundType => (INBOUND_TYPES as readonly string[]).includes(t);
export { EVENT_RULES, parseIncoming };
