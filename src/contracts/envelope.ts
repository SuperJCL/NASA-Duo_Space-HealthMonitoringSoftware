// MyoMars shared contracts v1: the message envelope, the event types, and who may send what.
// Language-neutral form: contracts/schema/*.schema.json (generated) and docs/myomars/CONTRACTS.md.

import { z } from "zod";
import {
  AuditAssessment,
  AuditReview,
  EvaEnded,
  HudAck,
  HudDefer,
  HudReceived,
  Id,
  Iso,
  NoticePayload,
  Observation,
  ReassessmentPayload,
  ReceiptPayload,
  RetestCompleted,
  RetestRequestPayload,
  RetestResult,
  ScenarioReset,
  ScenarioStart,
} from "./payloads.ts";

export const SCHEMA = "myomars/v1";
/** The v0 station draft this version replaces (see docs/myomars/PROTOCOL.md, "Migration"). */
export const PREVIOUS_SCHEMA = "myomars.station/v0-draft";

export const ROLES = ["trigger", "hud", "station", "observer"] as const;
export type Role = (typeof ROLES)[number];
/** Roles that may publish events (observer is read-only). */
export const PUBLISHER_ROLES = ["trigger", "hud", "station"] as const;
export type PublisherRole = (typeof PUBLISHER_ROLES)[number];

export const SessionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lower-case letters, digits and '-', at most 40");

/**
 * core: derived from the station's v0 draft, which the station already handles.
 * proposed-extension: new in v1 and PENDING TEAM CONFIRMATION; nobody has to implement it yet.
 */
export type RuleStatus = "core" | "proposed-extension";
type Rule = { roles: readonly PublisherRole[]; caseId: boolean; retestId: boolean; status: RuleStatus; payload: z.ZodType };
/**
 * Every event type: who may publish it (checked by the relay against the authenticated role, never
 * against the envelope's `source`), whether it needs a caseId / retestId, and its payload schema.
 */
export const EVENT_RULES = {
  // v1.1 (additive): the station may also start a run, when base staff explicitly start the (simulated) EVA.
  "scenario.start": { roles: ["trigger", "station"], caseId: false, retestId: false, status: "core", payload: ScenarioStart },
  "scenario.reset": { roles: ["trigger"], caseId: false, retestId: false, status: "core", payload: ScenarioReset },
  "observation.submitted": { roles: ["trigger"], caseId: true, retestId: false, status: "core", payload: Observation },
  "hud.received": { roles: ["hud"], caseId: true, retestId: false, status: "core", payload: HudReceived },
  "hud.ack": { roles: ["hud"], caseId: true, retestId: false, status: "core", payload: HudAck },
  "hud.defer": { roles: ["hud"], caseId: true, retestId: false, status: "core", payload: HudDefer },
  // Optional: retest.result alone completes a retest submission; this only adds "astronaut reports done".
  "retest.completed": { roles: ["hud"], caseId: true, retestId: true, status: "proposed-extension", payload: RetestCompleted },
  "retest.result": { roles: ["trigger", "hud"], caseId: true, retestId: true, status: "core", payload: RetestResult },
  "station.notice.approved": { roles: ["station"], caseId: true, retestId: false, status: "core", payload: NoticePayload },
  "station.retest.requested": { roles: ["station"], caseId: true, retestId: true, status: "core", payload: RetestRequestPayload },
  "station.receipt": { roles: ["station"], caseId: true, retestId: false, status: "core", payload: ReceiptPayload },
  "station.reassessment": { roles: ["station"], caseId: true, retestId: false, status: "core", payload: ReassessmentPayload },
  // Station traceability records: HUD and Trigger simply ignore them.
  "station.audit.assessment": { roles: ["station"], caseId: true, retestId: false, status: "proposed-extension", payload: AuditAssessment },
  "station.audit.review": { roles: ["station"], caseId: true, retestId: false, status: "proposed-extension", payload: AuditReview },
  // Mission phase: the EVA ended; the run and its health events stay open (HUD and Trigger may ignore it).
  "station.eva.ended": { roles: ["station"], caseId: false, retestId: false, status: "proposed-extension", payload: EvaEnded },
} as const satisfies Record<string, Rule>;
export type EventType = keyof typeof EVENT_RULES;
export const EVENT_TYPES = Object.keys(EVENT_RULES) as EventType[];

/** Station events go out only from the single active station handler (lease holder). */
export const isStationEvent = (t: string) => t.startsWith("station.");
/** Audit events are traceability records; HUD and Trigger must not act on them. */
export const isAuditEvent = (t: string) => t.startsWith("station.audit.");

/** The envelope a client PUBLISHES (relay fields are not allowed here). */
export const Envelope = z
  .object({
    schema: z.literal(SCHEMA),
    /** Unique per message, chosen by the sender (UUID recommended). Re-sending the same message reuses it. */
    eventId: Id,
    sessionId: SessionId,
    /** Scenario run (set by scenario.start); a reset ends it and later messages for it are refused. */
    runId: Id,
    caseId: Id.nullable(),
    retestId: Id.nullable().optional(),
    /** When the sender sent (or first tried to send) the message. */
    sentAt: Iso,
    /** When the underlying thing happened (e.g. acquisition), kept through offline buffering. */
    occurredAt: Iso.optional(),
    /** Informational only: the relay checks the authenticated role instead. */
    source: z.enum(PUBLISHER_ROLES),
    type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
    payload: z.unknown(),
  })
  .strict();
export type Envelope = z.infer<typeof Envelope>;

export const Sender = z.object({ role: z.enum(PUBLISHER_ROLES), clientId: Id }).strict();

/** The envelope as DELIVERED by the relay (SSE, history): plus the relay's sequence, receive time and authenticated sender. */
export const Delivered = Envelope.extend({ seq: z.number().int().positive(), receivedAt: Iso, sender: Sender }).strict();
export type Delivered = z.infer<typeof Delivered>;

export type ParseResult<T> = { ok: true; value: T; payload: unknown } | { ok: false; code: "invalid_envelope" | "invalid_payload"; message: string; eventId: string | null };

const eventIdOf = (raw: unknown) => (raw && typeof raw === "object" && typeof (raw as { eventId?: unknown }).eventId === "string" ? (raw as { eventId: string }).eventId : null);

function checkRules(e: Envelope): string | null {
  const rule = EVENT_RULES[e.type];
  if (rule.caseId && !e.caseId) return `${e.type} needs a caseId`;
  if (rule.retestId && !e.retestId) return `${e.type} needs a retestId`;
  return null;
}

/** Validate an envelope as published by a client (envelope, per-type rules, payload). */
export function parseEnvelope(raw: unknown): ParseResult<Envelope> {
  const env = Envelope.safeParse(raw);
  if (!env.success) return { ok: false, code: "invalid_envelope", message: z.prettifyError(env.error), eventId: eventIdOf(raw) };
  const ruleError = checkRules(env.data);
  if (ruleError) return { ok: false, code: "invalid_envelope", message: ruleError, eventId: env.data.eventId };
  const p = EVENT_RULES[env.data.type].payload.safeParse(env.data.payload);
  if (!p.success) return { ok: false, code: "invalid_payload", message: `${env.data.type}: ${z.prettifyError(p.error)}`, eventId: env.data.eventId };
  return { ok: true, value: env.data, payload: p.data };
}

/** Validate an envelope as delivered by the relay, or (mock mode) as published. */
export function parseIncoming(raw: unknown): ParseResult<Envelope & Partial<Pick<Delivered, "seq" | "receivedAt" | "sender">>> {
  const schema = raw && typeof raw === "object" && "seq" in raw ? Delivered : Envelope;
  const env = schema.safeParse(raw);
  if (!env.success) return { ok: false, code: "invalid_envelope", message: z.prettifyError(env.error), eventId: eventIdOf(raw) };
  const ruleError = checkRules(env.data);
  if (ruleError) return { ok: false, code: "invalid_envelope", message: ruleError, eventId: env.data.eventId };
  const p = EVENT_RULES[env.data.type].payload.safeParse(env.data.payload);
  if (!p.success) return { ok: false, code: "invalid_payload", message: `${env.data.type}: ${z.prettifyError(p.error)}`, eventId: env.data.eventId };
  return { ok: true, value: env.data, payload: p.data };
}
