// MyoMars base station: message envelope and payloads.
//
// STATUS: PROPOSAL (docs/station-integration.md). No team protocol existed when this was written
// (2026-11-14); these names and fields are the base station's suggestion for the Trigger and HUD
// teammates to review, NOT an agreed team standard. Everything carried here is SIMULATED data.
//
// Every message is one envelope: unique event id, scenario run id, case id (null for scenario
// control), retest id (retest messages), send time, source, type and payload.

import { z } from "zod";

export const SCHEMA = "myomars.station/v0-draft";

export const INBOUND_TYPES = ["scenario.start", "scenario.reset", "observation.submitted", "hud.received", "hud.ack", "hud.defer", "retest.result"] as const;
export const OUTBOUND_TYPES = ["station.notice.approved", "station.retest.requested", "station.receipt", "station.reassessment"] as const;
export type InboundType = (typeof INBOUND_TYPES)[number];
export type OutboundType = (typeof OUTBOUND_TYPES)[number];

const Id = z.string().min(1).max(200);
const Iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 date-time");

export const Envelope = z
  .object({
    schema: z.literal(SCHEMA),
    eventId: Id,
    runId: Id,
    caseId: Id.nullable(),
    retestId: Id.nullable().optional(),
    sentAt: Iso,
    source: z.enum(["trigger", "hud", "station"]),
    type: z.enum([...INBOUND_TYPES, ...OUTBOUND_TYPES]),
    payload: z.unknown(),
  })
  .strict();
export type Envelope = z.infer<typeof Envelope>;

// ---------- Inbound payloads (from Trigger and HUD) ----------

export const Protocol = z
  .object({
    id: Id,
    label: z.string().min(1),
    /** Target effort as % of maximum voluntary contraction. */
    targetPctMvc: z.number().min(0).max(100),
    posture: z.enum(["standing", "kneeling", "seated"]),
    glove: z.enum(["eva-glove", "none"]),
  })
  .strict();
export type Protocol = z.infer<typeof Protocol>;

export const Observation = z
  .object({
    observationId: Id,
    astronautId: Id,
    capturedAt: Iso,
    protocol: Protocol,
    context: z
      .object({
        taskId: Id.nullable(),
        phase: z.enum(["pre-eva", "eva", "post-eva", "retest"]),
        minutesIntoEva: z.number().min(0).nullable(),
      })
      .strict(),
    signal: z
      .object({
        sampleRateHz: z.number().positive(),
        durationS: z.number().min(0),
        electrodeImpedanceKOhm: z.number().min(0),
        saturationPct: z.number().min(0).max(100),
        motionArtifactPct: z.number().min(0).max(100),
        dropoutPct: z.number().min(0).max(100),
      })
      .strict(),
    /** Extracted features; null when feature extraction failed upstream. */
    features: z
      .object({
        medianFreqHz: z.number().nullable(),
        rmsPctMvc: z.number().nullable(),
        gripForceN: z.number().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type Observation = z.infer<typeof Observation>;

export const ScenarioStart = z
  .object({
    scenarioId: Id,
    astronaut: z.object({ id: Id, callsign: z.string().min(1) }).strict(),
    task: z.object({ id: Id, title: z.string().min(1), targetId: Id.nullable() }).strict(),
  })
  .strict();
export type ScenarioStart = z.infer<typeof ScenarioStart>;

/** HUD device-level receipt: the message reached the HUD (not that the astronaut saw or accepted it). */
export const HudReceived = z.object({ messageId: Id }).strict();
/** The astronaut confirmed the message on the HUD. */
export const HudAck = z.object({ messageId: Id, note: z.string().max(500).optional() }).strict();
export const HudDefer = z.object({ messageId: Id, reason: z.string().min(1).max(500) }).strict();
export const RetestResult = z.object({ observation: Observation }).strict();

export const INBOUND_PAYLOADS = {
  "scenario.start": ScenarioStart,
  "scenario.reset": z.object({}).strict(),
  "observation.submitted": Observation,
  "hud.received": HudReceived,
  "hud.ack": HudAck,
  "hud.defer": HudDefer,
  "retest.result": RetestResult,
} as const;

// ---------- Outbound payloads (station → HUD / Trigger) ----------

export type NoticePayload = {
  noticeId: string;
  text: string;
  basis: string[];
  evaluationVersion: number;
  reviewedBy: string;
  reviewReason: string;
  simulated: true;
};
export type RetestRequestPayload = {
  retestId: string;
  protocol: Protocol;
  instructions: string;
  evaluationVersion: number;
  reviewedBy: string;
  simulated: true;
};
export type ReceiptPayload = {
  receivedEventId: string;
  receivedType: InboundType;
  status: "accepted" | "duplicate" | "rejected";
  reason: string | null;
};
export type ReassessmentPayload = {
  evaluationVersion: number;
  outcome: string;
  summary: string;
  reviewDecision: string;
  caseStatus: string;
  simulated: true;
};

export type InboundParse =
  | { ok: true; envelope: Envelope; payload: unknown }
  | { ok: false; error: string; eventId: string | null };

/** Validate an inbound envelope and its payload. Station-originated types are rejected here. */
export function parseInbound(raw: unknown): InboundParse {
  const env = Envelope.safeParse(raw);
  const eventId = typeof raw === "object" && raw && "eventId" in raw && typeof (raw as { eventId: unknown }).eventId === "string" ? (raw as { eventId: string }).eventId : null;
  if (!env.success) return { ok: false, error: `invalid envelope: ${z.prettifyError(env.error)}`, eventId };
  const e = env.data;
  if (!(INBOUND_TYPES as readonly string[]).includes(e.type)) return { ok: false, error: `not an inbound type: ${e.type}`, eventId: e.eventId };
  const schema = INBOUND_PAYLOADS[e.type as InboundType];
  const p = schema.safeParse(e.payload);
  if (!p.success) return { ok: false, error: `invalid ${e.type} payload: ${z.prettifyError(p.error)}`, eventId: e.eventId };
  if ((e.type === "observation.submitted" || e.type === "retest.result" || e.type === "hud.received" || e.type === "hud.ack" || e.type === "hud.defer") && !e.caseId) return { ok: false, error: `${e.type} needs a caseId`, eventId: e.eventId };
  if (e.type === "retest.result" && !e.retestId) return { ok: false, error: "retest.result needs a retestId", eventId: e.eventId };
  return { ok: true, envelope: e, payload: p.data };
}
