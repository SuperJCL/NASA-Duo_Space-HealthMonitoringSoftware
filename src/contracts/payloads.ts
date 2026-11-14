// MyoMars shared contracts v1: message payloads (Zod; the JSON Schemas in contracts/schema are
// generated from these). Erasable TypeScript only, relative imports with ".ts": Node 22 runs this
// file directly (relay, test clients) and Next.js bundles it (station).
//
// EVERYTHING carried by these messages is SIMULATED demo data. Not medical data.
//
// Migration from the station draft (myomars.station/v0-draft, on branch feat/myomars-station):
// the v0 payloads are kept field for field. Additions are optional or new message types:
// Observation.deviceId and Observation.imu (optional), retest.completed (new),
// station.audit.assessment / station.audit.review (new), and Zod schemas for the station payloads
// that were TypeScript types only.

import { z } from "zod";

export const Id = z.string().min(1).max(200);
export const Iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 date-time");

export const Protocol = z
  .object({
    id: Id,
    label: z.string().min(1).max(200),
    /** Target effort as % of maximum voluntary contraction. */
    targetPctMvc: z.number().min(0).max(100),
    posture: z.enum(["standing", "kneeling", "seated"]),
    glove: z.enum(["eva-glove", "none"]),
  })
  .strict();
export type Protocol = z.infer<typeof Protocol>;

/** IMU summary for the same window (simulated). Optional in v1: the station does not use it yet. */
export const ImuSummary = z
  .object({
    accelRmsG: z.number().min(0),
    gyroRmsDps: z.number().min(0),
    /** Share of the window flagged as large movement (0–100). */
    movementPct: z.number().min(0).max(100),
  })
  .strict();

export const Observation = z
  .object({
    observationId: Id,
    astronautId: Id,
    /** Acquisition time of the window (kept as sent, also after offline recovery). */
    capturedAt: Iso,
    deviceId: Id.optional(),
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
    /** sEMG window features; null when feature extraction failed upstream. */
    features: z
      .object({
        medianFreqHz: z.number().nullable(),
        rmsPctMvc: z.number().nullable(),
        /** Simulated grip-force reading taken with the protocol (not derived from sEMG). */
        gripForceN: z.number().nullable(),
      })
      .strict()
      .nullable(),
    imu: ImuSummary.optional(),
  })
  .strict();
export type Observation = z.infer<typeof Observation>;

export const ScenarioStart = z
  .object({
    scenarioId: Id,
    astronaut: z.object({ id: Id, callsign: z.string().min(1).max(100) }).strict(),
    task: z.object({ id: Id, title: z.string().min(1).max(200), targetId: Id.nullable() }).strict(),
  })
  .strict();
export type ScenarioStart = z.infer<typeof ScenarioStart>;

export const ScenarioReset = z.object({}).strict();

/** HUD device receipt: the message reached the HUD device (NOT that the astronaut saw or accepted it). */
export const HudReceived = z.object({ messageId: Id }).strict();
/** The astronaut explicitly acknowledged the message on the HUD. */
export const HudAck = z.object({ messageId: Id, note: z.string().max(500).optional() }).strict();
/** The astronaut deferred the message (with a reason). */
export const HudDefer = z.object({ messageId: Id, reason: z.string().min(1).max(500) }).strict();
/**
 * PROPOSED EXTENSION (pending team confirmation): the astronaut reports the retest as performed.
 * Optional — retest.result alone is a complete result submission.
 */
export const RetestCompleted = z.object({ completedAt: Iso, note: z.string().max(500).optional() }).strict();
/** Retest measurement data (from the sensor simulator or the HUD). */
export const RetestResult = z.object({ observation: Observation }).strict();

// ---------- Station → HUD / Trigger (published only after a human decision, except receipts) ----------

export const NoticePayload = z
  .object({
    noticeId: Id,
    text: z.string().min(1).max(1000),
    basis: z.array(z.string().max(500)).max(10),
    evaluationVersion: z.number().int().positive(),
    reviewedBy: z.string().min(1).max(100),
    reviewReason: z.string().min(1).max(1000),
    simulated: z.literal(true),
  })
  .strict();
export type NoticePayload = z.infer<typeof NoticePayload>;

export const RetestRequestPayload = z
  .object({
    retestId: Id,
    protocol: Protocol,
    instructions: z.string().min(1).max(1000),
    evaluationVersion: z.number().int().positive(),
    reviewedBy: z.string().min(1).max(100),
    simulated: z.literal(true),
  })
  .strict();
export type RetestRequestPayload = z.infer<typeof RetestRequestPayload>;

export const ReceiptPayload = z
  .object({
    receivedEventId: Id,
    receivedType: z.string().min(1).max(100),
    status: z.enum(["accepted", "duplicate", "rejected"]),
    reason: z.string().max(500).nullable(),
  })
  .strict();
export type ReceiptPayload = z.infer<typeof ReceiptPayload>;

export const ReassessmentPayload = z
  .object({
    evaluationVersion: z.number().int().positive(),
    outcome: z.string().min(1).max(100),
    summary: z.string().min(1).max(500),
    reviewDecision: z.string().min(1).max(50),
    caseStatus: z.string().min(1).max(50),
    simulated: z.literal(true),
  })
  .strict();
export type ReassessmentPayload = z.infer<typeof ReassessmentPayload>;

/** Audit record of a completed simulated assessment (traceability only; NOT an action for the HUD). */
export const AuditAssessment = z
  .object({
    evaluationVersion: z.number().int().positive(),
    trigger: z.enum(["observation", "retest"]),
    sourceEventId: Id,
    inputKey: z.string().min(1).max(5000),
    outcome: z.string().min(1).max(100),
    headline: z.string().min(1).max(500),
    candidateKind: z.enum(["record-only", "retest", "notice-and-retest"]).nullable(),
    simulated: z.literal(true),
  })
  .strict();

/** Audit record of a human review decision (traceability only; NOT an action for the HUD). */
export const AuditReview = z
  .object({
    evaluationVersion: z.number().int().positive(),
    decision: z.enum(["approve", "reject", "hold", "close", "keep-open"]),
    reason: z.string().min(1).max(1000),
    reviewer: z.string().min(1).max(100),
    decidedAt: Iso,
    caseStatus: z.string().min(1).max(50),
    dispatchedEventIds: z.array(Id).max(10),
  })
  .strict();
