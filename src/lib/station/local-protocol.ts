// MyoMars base station: LOCAL MOCK EXTENSIONS. NOT part of the shared contracts v1.
//
// The shared contracts (src/contracts) have no message for a crew roster, a device connection
// status or an astronaut's own report from the HUD. The station needs them for the crew overview
// and the "HUD report" entry, so they exist here ONLY for the local demo, with their own schema tag
// ("myomars/v1-local") so they can never be mistaken for contract messages. Interface proposals for
// the team: docs/myomars/STATION-LOCAL-PROPOSALS.md. Nothing here changes a teammate's interface.
//
// All content is SIMULATED.

import { z } from "zod";
import { SessionId } from "@/contracts/envelope.ts";
import { Id, Iso } from "@/contracts/payloads.ts";

export const LOCAL_SCHEMA = "myomars/v1-local";
export const LOCAL_TYPES = ["local.crew.roster", "local.device.status", "local.hud.report"] as const;
export type LocalType = (typeof LOCAL_TYPES)[number];

export const CrewMemberPayload = z
  .object({
    astronautId: Id,
    callsign: z.string().min(1).max(100),
    task: z.object({ id: Id, title: z.string().min(1).max(200) }).strict(),
    /** Start of the current EVA (for the task duration shown on the card). */
    evaStartedAt: Iso,
    deviceId: Id,
  })
  .strict();
export type CrewMemberPayload = z.infer<typeof CrewMemberPayload>;

/** The crew of this run (replaces the roster for the run; scenario.start still names the lead astronaut). */
export const CrewRoster = z.object({ members: z.array(CrewMemberPayload).min(1).max(6) }).strict();
/** Connection of an astronaut's sensor device as seen by the transport (not data validity). */
export const DeviceStatus = z.object({ astronautId: Id, deviceId: Id, connection: z.enum(["connected", "disconnected"]), at: Iso }).strict();
/** The astronaut's own report from the HUD. A report is not a diagnosis and is never discarded because sensor data is missing. */
export const HudReport = z
  .object({
    reportId: Id,
    astronautId: Id,
    text: z.string().min(1).max(500),
    /** What the astronaut asks the base for (optional). */
    request: z.string().min(1).max(200).nullable(),
    reportedAt: Iso,
  })
  .strict();
export type HudReport = z.infer<typeof HudReport>;

const PAYLOADS = { "local.crew.roster": CrewRoster, "local.device.status": DeviceStatus, "local.hud.report": HudReport } as const;

export const LocalEnvelope = z
  .object({
    schema: z.literal(LOCAL_SCHEMA),
    eventId: Id,
    sessionId: SessionId,
    runId: Id,
    caseId: Id.nullable(),
    sentAt: Iso,
    source: z.enum(["trigger", "hud"]),
    type: z.enum(LOCAL_TYPES),
    payload: z.unknown(),
  })
  .strict();
export type LocalEnvelope = z.infer<typeof LocalEnvelope>;

export const isLocalType = (t: unknown): t is LocalType => typeof t === "string" && (LOCAL_TYPES as readonly string[]).includes(t);

export type LocalParse = { ok: true; envelope: LocalEnvelope; payload: unknown } | { ok: false; error: string; eventId: string | null };

export function parseLocal(raw: unknown): LocalParse {
  const eventId = raw && typeof raw === "object" && typeof (raw as { eventId?: unknown }).eventId === "string" ? (raw as { eventId: string }).eventId : null;
  const env = LocalEnvelope.safeParse(raw);
  if (!env.success) return { ok: false, error: `invalid local envelope: ${z.prettifyError(env.error)}`, eventId };
  if (env.data.type === "local.hud.report" && !env.data.caseId) return { ok: false, error: "local.hud.report needs a caseId", eventId };
  const p = PAYLOADS[env.data.type].safeParse(env.data.payload);
  if (!p.success) return { ok: false, error: `invalid local payload: ${env.data.type}: ${z.prettifyError(p.error)}`, eventId };
  return { ok: true, envelope: env.data, payload: p.data };
}

let localSeq = 0;
/** Build a local mock envelope (local demo only). */
export function localEnvelope(type: LocalType, { runId, caseId = null, payload, eventId, at, sessionId = "local" }: { runId: string; caseId?: string | null; payload: unknown; eventId?: string; at?: string; sessionId?: string }): LocalEnvelope {
  localSeq += 1;
  return { schema: LOCAL_SCHEMA, eventId: eventId ?? `local-${Date.now().toString(36)}-${localSeq}`, sessionId, runId, caseId, sentAt: at ?? new Date().toISOString(), source: type === "local.hud.report" ? "hud" : "trigger", type, payload };
}
