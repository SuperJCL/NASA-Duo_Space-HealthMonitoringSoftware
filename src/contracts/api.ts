// MyoMars shared contracts v1: relay HTTP API request / response bodies and the error format.
// Base path /api/v1. Same-origin deployment; authentication is an HttpOnly session cookie obtained
// from POST /api/v1/auth/login (demo access protection only, not an account system).

import { z } from "zod";
import { Delivered, ROLES, SessionId } from "./envelope.ts";
import { Id, Iso } from "./payloads.ts";

export const API_BASE = "/api/v1";
export const SESSION_COOKIE = "myomars_session";
/** Every side-effect request must carry this header (CSRF guard; browsers cannot add it cross-site without CORS approval). */
export const CLIENT_HEADER = "x-myomars-client";
/** Per-page instance id of a station page (lease / single-handler checks). */
export const INSTANCE_HEADER = "x-myomars-instance";

export const ERROR_CODES = [
  "invalid_json",
  "invalid_envelope",
  "invalid_payload",
  "invalid_request",
  "unauthenticated",
  "bad_credentials",
  "forbidden_role",
  "session_mismatch",
  "origin_not_allowed",
  "missing_client_header",
  "not_found",
  "method_not_allowed",
  "duplicate_conflict",
  "no_active_run",
  "stale_run",
  "unknown_run",
  "run_exists",
  "not_lease_holder",
  "snapshot_conflict",
  "payload_too_large",
  "rate_limited",
  "too_many_connections",
  "too_many_sessions",
  "storage_full",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Every error response: HTTP status + this body. */
export const ErrorBody = z
  .object({
    error: z
      .object({
        code: z.enum(ERROR_CODES),
        message: z.string(),
        details: z.unknown().optional(),
        requestId: z.string(),
      })
      .strict(),
  })
  .strict();
export type ErrorBody = z.infer<typeof ErrorBody>;

export const LoginRequest = z
  .object({
    role: z.enum(ROLES),
    accessCode: z.string().min(1).max(200),
    sessionId: SessionId.default("demo"),
    clientName: z.string().min(1).max(60).optional(),
  })
  .strict();
export const LoginResponse = z.object({ role: z.enum(ROLES), sessionId: SessionId, clientId: Id, expiresAt: Iso }).strict();
export type LoginResponse = z.infer<typeof LoginResponse>;

/** POST /sessions/{sessionId}/events → 202 (new) or 200 (duplicate of an identical earlier message). */
export const PublishResponse = z.object({ accepted: z.literal(true), duplicate: z.boolean(), seq: z.number().int().positive(), receivedAt: Iso }).strict();
export type PublishResponse = z.infer<typeof PublishResponse>;

export const Lease = z.object({ instanceId: Id, clientId: Id, acquiredAt: Iso, expiresAt: Iso }).strict();
export const LeaseRequest = z.object({ instanceId: Id }).strict();
/** The caller holds the lease (holder) or not (read-only). */
export const LeaseResponse = z.object({ holder: z.boolean(), lease: Lease.nullable(), ttlMs: z.number().int().positive() }).strict();
export type LeaseResponse = z.infer<typeof LeaseResponse>;

/**
 * Station snapshot: the AUTHORITATIVE station state (analysis results, review decisions, retest
 * tasks, outbox), saved by the lease holder before it dispatches anything. `cursor` is the last
 * relay seq applied to `state`; `rev` only goes up (an older rev is refused).
 */
export const StationSnapshot = z
  .object({
    schema: z.literal("myomars/station-snapshot/v1"),
    sessionId: SessionId,
    runId: Id.nullable(),
    cursor: z.number().int().min(0),
    rev: z.number().int().positive(),
    savedAt: Iso,
    instanceId: Id,
    state: z.unknown(),
  })
  .strict();
export type StationSnapshot = z.infer<typeof StationSnapshot>;

export const SessionState = z
  .object({
    sessionId: SessionId,
    currentRunId: Id.nullable(),
    endedRunIds: z.array(Id),
    lastSeq: z.number().int().min(0),
    /** Oldest seq still available for SSE resume / history; older cursors must restore from a snapshot. */
    bufferFloorSeq: z.number().int().min(0),
    lease: Lease.nullable(),
    snapshot: z.object({ rev: z.number().int(), cursor: z.number().int(), savedAt: Iso, runId: Id.nullable() }).strict().nullable(),
  })
  .strict();
export type SessionState = z.infer<typeof SessionState>;

export const HistoryResponse = z.object({ events: z.array(Delivered), lastSeq: z.number().int().min(0), bufferFloorSeq: z.number().int().min(0), complete: z.boolean() }).strict();

export const Health = z
  .object({
    ok: z.literal(true),
    service: z.literal("myomars-relay"),
    version: z.string(),
    schema: z.string(),
    uptimeS: z.number(),
    sessions: z.number().int(),
    sseClients: z.number().int(),
    limits: z.record(z.string(), z.number()),
  })
  .strict();

/** SSE control events (no `id:` line, so they never move the resume cursor). */
export const ControlEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hello"), sessionId: SessionId, lastSeq: z.number().int(), bufferFloorSeq: z.number().int(), currentRunId: Id.nullable() }).strict(),
  z.object({ kind: z.literal("resync"), reason: z.literal("cursor_too_old"), requestedAfter: z.number().int(), bufferFloorSeq: z.number().int(), lastSeq: z.number().int() }).strict(),
  z.object({ kind: z.literal("lease"), lease: Lease.nullable() }).strict(),
  z.object({ kind: z.literal("snapshot"), rev: z.number().int(), cursor: z.number().int(), savedAt: Iso }).strict(),
]);
export type ControlEvent = z.infer<typeof ControlEvent>;
