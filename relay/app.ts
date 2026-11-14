// MyoMars relay: validates, authorises, sequences, stores and forwards messages between the
// Trigger, the HUD and the Mars Station; HTTP to publish, Server-Sent Events to receive. It never
// analyses data and never approves anything: the station's human review stays in the station.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { EVENT_RULES, isStationEvent, parseEnvelope, SCHEMA, SessionId, type Delivered, type PublisherRole, type Role } from "../src/contracts/envelope.ts";
import { API_BASE, CLIENT_HEADER, INSTANCE_HEADER, LeaseRequest, LoginRequest, SESSION_COOKIE, StationSnapshot, type ControlEvent, type ErrorCode } from "../src/contracts/api.ts";
import { Auth, type Principal } from "./auth.ts";
import { contentHash, Store, type Session } from "./store.ts";
import { serveStatic } from "./static.ts";
import type { RelayConfig } from "./config.ts";

export const RELAY_VERSION = "0.1.0";

class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;
  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type SseClient = { res: ServerResponse; sessionId: string; principal: Principal; heartbeat: ReturnType<typeof setInterval> };

/** Fixed-window rate limiter keyed by client id or IP. */
class Limiter {
  private hits = new Map<string, { n: number; t: number }>();
  private readonly perMinute: number;
  constructor(perMinute: number) {
    this.perMinute = perMinute;
  }
  take(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || now - h.t > 60_000) {
      this.hits.set(key, { n: 1, t: now });
      return true;
    }
    h.n += 1;
    return h.n <= this.perMinute;
  }
}

const cookieOf = (req: IncomingMessage, name: string) => {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
};

export function createRelay(config: RelayConfig) {
  const store = new Store(config.dataDir, config.limits.bufferEvents, config.log.days, config.log.maxMb * 1024 * 1024);
  const auth = new Auth(config.dataDir, config.accessCodes, config.sessionTtlMs);
  const sse = new Set<SseClient>();
  const publishLimit = new Limiter(config.limits.publishPerMinute);
  const loginLimit = new Limiter(config.limits.loginPerMinute);
  const started = Date.now();
  const pruneTimer = setInterval(() => store.prune(), 3_600_000);
  pruneTimer.unref();

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };

  /** Same-origin, or listed in MYOMARS_ALLOWED_ORIGINS (dev mode adds localhost:3000 and the relay port). */
  const originAllowed = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return { ok: true, cors: null as string | null };
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    try {
      if (new URL(origin).host === host) return { ok: true, cors: null };
    } catch {
      return { ok: false, cors: null };
    }
    const o = origin.replace(/\/$/, "");
    return config.allowedOrigins.includes(o) ? { ok: true, cors: o } : { ok: false, cors: null };
  };

  const corsHeaders = (origin: string | null): Record<string, string> =>
    origin ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : {};

  const readBody = (req: IncomingMessage, limit: number) =>
    new Promise<unknown>((resolve, reject) => {
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > limit) return reject(new HttpError(413, "payload_too_large", `body larger than ${limit} bytes`));
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, "payload_too_large", `body larger than ${limit} bytes`));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          resolve(size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
        } catch {
          reject(new HttpError(400, "invalid_json", "body is not valid JSON"));
        }
      });
      req.on("error", reject);
    });

  const principalOf = (req: IncomingMessage) => auth.verify(cookieOf(req, SESSION_COOKIE));
  const requireAuth = (req: IncomingMessage, sessionId?: string) => {
    const p = principalOf(req);
    if (!p) throw new HttpError(401, "unauthenticated", "log in first (POST /api/v1/auth/login)");
    if (sessionId !== undefined && p.sessionId !== sessionId) throw new HttpError(403, "session_mismatch", `logged in to session ${p.sessionId}, not ${sessionId}`);
    return p;
  };
  const requireRole = (p: Principal, roles: readonly Role[]) => {
    if (!roles.includes(p.role)) throw new HttpError(403, "forbidden_role", `role ${p.role} may not do this (allowed: ${roles.join(", ")})`);
  };
  const sessionFor = (id: string, create: boolean) => {
    if (!SessionId.safeParse(id).success) throw new HttpError(400, "invalid_request", "invalid session id");
    if (!store.has(id)) {
      if (!create) throw new HttpError(404, "not_found", `no session ${id}`);
      if (store.sessions.size >= config.limits.maxSessions) throw new HttpError(429, "too_many_sessions", `at most ${config.limits.maxSessions} sessions`);
    }
    return store.open(id);
  };

  const leaseValid = (s: Session) => (s.lease && Date.parse(s.lease.expiresAt) > Date.now() ? s.lease : null);
  const isHolder = (s: Session, p: Principal, req: IncomingMessage) => {
    const l = leaseValid(s);
    return !!l && l.clientId === p.clientId && l.instanceId === req.headers[INSTANCE_HEADER];
  };

  const writeEvent = (c: SseClient, d: Delivered) => c.res.write(`id: ${d.seq}\nevent: envelope\ndata: ${JSON.stringify(d)}\n\n`);
  const writeControl = (c: SseClient, e: ControlEvent) => c.res.write(`event: control\ndata: ${JSON.stringify(e)}\n\n`);
  const broadcast = (sessionId: string, d: Delivered) => {
    for (const c of sse) if (c.sessionId === sessionId) writeEvent(c, d);
  };
  const control = (sessionId: string, e: ControlEvent) => {
    for (const c of sse) if (c.sessionId === sessionId) writeControl(c, e);
  };

  // ---------------- handlers ----------------

  async function login(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>) {
    const ip = req.socket.remoteAddress ?? "?";
    if (!loginLimit.take(ip)) throw new HttpError(429, "rate_limited", "too many login attempts; wait a minute");
    const body = LoginRequest.safeParse(await readBody(req, 4096));
    if (!body.success) throw new HttpError(400, "invalid_request", "invalid login request", body.error.issues);
    const { role, accessCode, sessionId, clientName } = body.data;
    if (!auth.roleEnabled(role) || !auth.checkCode(role, accessCode)) throw new HttpError(403, "bad_credentials", "wrong access code for this role");
    sessionFor(sessionId, true);
    const { token, principal } = auth.issue(role, sessionId, clientName ?? null);
    const secure = config.cookieSecure === "always" || (config.cookieSecure === "auto" && (req.headers["x-forwarded-proto"] === "https" || ("encrypted" in req.socket && !!req.socket.encrypted)));
    const cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(config.sessionTtlMs / 1000)}${secure ? "; Secure" : ""}`;
    json(res, 200, { role: principal.role, sessionId: principal.sessionId, clientId: principal.clientId, expiresAt: principal.expiresAt }, { "set-cookie": cookie, ...cors });
  }

  async function publish(req: IncomingMessage, res: ServerResponse, sid: string, cors: Record<string, string>) {
    const p = requireAuth(req, sid);
    if (p.role === "observer") throw new HttpError(403, "forbidden_role", "observers cannot publish");
    if (!publishLimit.take(p.clientId)) throw new HttpError(429, "rate_limited", `at most ${config.limits.publishPerMinute} messages per minute per client`);
    const s = sessionFor(sid, false);
    const raw = await readBody(req, config.limits.maxBodyBytes);
    const parsed = parseEnvelope(raw);
    if (!parsed.ok) throw new HttpError(400, parsed.code, parsed.message);
    const env = parsed.value;
    const role = p.role as PublisherRole;
    if (!(EVENT_RULES[env.type].roles as readonly string[]).includes(role)) throw new HttpError(403, "forbidden_role", `role ${role} may not publish ${env.type}`);
    if (env.source !== role) throw new HttpError(403, "forbidden_role", `source "${env.source}" does not match your role "${role}"`);
    if (env.sessionId !== sid) throw new HttpError(403, "session_mismatch", "envelope sessionId differs from the URL");

    // Idempotency: same eventId + same content → the original result; same eventId + other content → conflict.
    const hash = contentHash(env);
    const seen = s.seen.get(env.eventId);
    if (seen) {
      if (seen.hash && seen.hash !== hash) throw new HttpError(409, "duplicate_conflict", `eventId ${env.eventId} was already used for a different message`);
      return json(res, 200, { accepted: true, duplicate: true, seq: seen.seq, receivedAt: seen.receivedAt }, cors);
    }

    // Scenario runs: a reset ends a run for good; messages for other runs are refused.
    const m = s.meta;
    if (env.type === "scenario.start") {
      if (m.endedRunIds.includes(env.runId)) throw new HttpError(409, "stale_run", `run ${env.runId} has ended`);
      if (m.currentRunId === env.runId) throw new HttpError(409, "run_exists", `run ${env.runId} already started`);
    } else if (m.currentRunId !== env.runId) {
      if (m.endedRunIds.includes(env.runId)) throw new HttpError(409, "stale_run", `run ${env.runId} has ended (reset or replaced)`);
      if (!m.currentRunId) throw new HttpError(409, "no_active_run", "no scenario run is active; send scenario.start first");
      throw new HttpError(409, "unknown_run", `run ${env.runId} is not the active run ${m.currentRunId}`);
    }
    if (isStationEvent(env.type) && !isHolder(s, p, req)) throw new HttpError(409, "not_lease_holder", "only the active station handler (lease holder) may publish station events");

    const d: Delivered = { ...env, seq: m.lastSeq + 1, receivedAt: new Date().toISOString(), sender: { role, clientId: p.clientId } };
    let bytes: number;
    try {
      bytes = s.append(d, hash);
    } catch (e) {
      throw new HttpError(503, "storage_full", `could not store the event: ${(e as Error).message}`);
    }
    m.lastSeq = d.seq;
    if (env.type === "scenario.start") {
      if (m.currentRunId) m.endedRunIds.push(m.currentRunId);
      m.currentRunId = env.runId;
    } else if (env.type === "scenario.reset") {
      m.endedRunIds.push(env.runId);
      m.currentRunId = null;
    }
    m.endedRunIds = m.endedRunIds.slice(-200);
    s.saveMeta();
    store.noteAppended(bytes);
    broadcast(sid, d);
    json(res, 202, { accepted: true, duplicate: false, seq: d.seq, receivedAt: d.receivedAt }, cors);
  }

  function stream(req: IncomingMessage, res: ServerResponse, sid: string, url: URL, cors: Record<string, string>) {
    const p = requireAuth(req, sid);
    const s = sessionFor(sid, false);
    const perSession = [...sse].filter((c) => c.sessionId === sid).length;
    if (sse.size >= config.limits.maxSseClients || perSession >= config.limits.maxSseClientsPerSession) throw new HttpError(429, "too_many_connections", "too many open event streams");
    const header = req.headers["last-event-id"];
    const after = Number(typeof header === "string" && header !== "" ? header : (url.searchParams.get("after") ?? "0"));
    if (!Number.isInteger(after) || after < 0) throw new HttpError(400, "invalid_request", "invalid cursor");
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", ...cors });
    res.write("retry: 3000\n\n");
    const client: SseClient = { res, sessionId: sid, principal: p, heartbeat: setInterval(() => res.write(`: ping ${Date.now()}\n\n`), config.heartbeatMs) };
    sse.add(client);
    writeControl(client, { kind: "hello", sessionId: sid, lastSeq: s.meta.lastSeq, bufferFloorSeq: s.bufferFloorSeq, currentRunId: s.meta.currentRunId });
    if (after < s.bufferFloorSeq - 1) writeControl(client, { kind: "resync", reason: "cursor_too_old", requestedAfter: after, bufferFloorSeq: s.bufferFloorSeq, lastSeq: s.meta.lastSeq });
    for (const d of s.after(after)) writeEvent(client, d);
    const lease = leaseValid(s);
    writeControl(client, { kind: "lease", lease });
    req.on("close", () => {
      clearInterval(client.heartbeat);
      sse.delete(client);
    });
  }

  async function lease(req: IncomingMessage, res: ServerResponse, sid: string, release: boolean, cors: Record<string, string>) {
    const p = requireAuth(req, sid);
    requireRole(p, ["station"]);
    const s = sessionFor(sid, false);
    const body = LeaseRequest.safeParse(await readBody(req, 1024));
    if (!body.success) throw new HttpError(400, "invalid_request", "invalid lease request", body.error.issues);
    const { instanceId } = body.data;
    const current = leaseValid(s);
    const mine = !!current && current.clientId === p.clientId && current.instanceId === instanceId;
    if (release) {
      if (mine) {
        s.lease = null;
        control(sid, { kind: "lease", lease: null });
      }
      return json(res, 200, { holder: false, lease: leaseValid(s), ttlMs: config.leaseTtlMs }, cors);
    }
    if (!current || mine) {
      const now = new Date();
      s.lease = { instanceId, clientId: p.clientId, acquiredAt: mine ? current!.acquiredAt : now.toISOString(), expiresAt: new Date(now.getTime() + config.leaseTtlMs).toISOString() };
      if (!mine) control(sid, { kind: "lease", lease: s.lease });
      return json(res, 200, { holder: true, lease: s.lease, ttlMs: config.leaseTtlMs }, cors);
    }
    json(res, 200, { holder: false, lease: current, ttlMs: config.leaseTtlMs }, cors);
  }

  async function putSnapshot(req: IncomingMessage, res: ServerResponse, sid: string, cors: Record<string, string>) {
    const p = requireAuth(req, sid);
    requireRole(p, ["station"]);
    const s = sessionFor(sid, false);
    if (!isHolder(s, p, req)) throw new HttpError(409, "not_lease_holder", "only the active station handler may save the station snapshot");
    const body = StationSnapshot.safeParse(await readBody(req, config.limits.maxSnapshotBytes));
    if (!body.success) throw new HttpError(400, "invalid_request", "invalid snapshot", body.error.issues);
    const snap = body.data;
    if (snap.sessionId !== sid) throw new HttpError(403, "session_mismatch", "snapshot sessionId differs from the URL");
    if (s.snapshot && snap.rev <= s.snapshot.rev) throw new HttpError(409, "snapshot_conflict", `snapshot rev ${snap.rev} is not newer than ${s.snapshot.rev}`);
    if (snap.cursor > s.meta.lastSeq) throw new HttpError(400, "invalid_request", "snapshot cursor is ahead of the relay");
    s.saveSnapshot(snap);
    control(sid, { kind: "snapshot", rev: snap.rev, cursor: snap.cursor, savedAt: snap.savedAt });
    json(res, 200, { saved: true, rev: snap.rev }, cors);
  }

  // ---------------- router ----------------

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const requestId = randomBytes(6).toString("hex");
    const url = new URL(req.url ?? "/", "http://relay.local");
    const path = url.pathname;
    const method = req.method ?? "GET";
    let cors: Record<string, string> = {};
    try {
      if (!path.startsWith(`${API_BASE}/`)) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method_not_allowed", "static files are read-only");
        if (config.webRoot && serveStatic(config.webRoot, path, req, res)) return;
        throw new HttpError(404, "not_found", "not found");
      }
      const origin = originAllowed(req);
      if (!origin.ok) throw new HttpError(403, "origin_not_allowed", `origin ${req.headers.origin} is not allowed`);
      cors = corsHeaders(origin.cors);
      if (method === "OPTIONS") {
        res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": `content-type, ${CLIENT_HEADER}, ${INSTANCE_HEADER}, last-event-id`, "access-control-max-age": "600" });
        return res.end();
      }
      if (method !== "GET" && method !== "HEAD" && !req.headers[CLIENT_HEADER]) throw new HttpError(403, "missing_client_header", `side-effect requests must send the ${CLIENT_HEADER} header`);
      const rel = path.slice(API_BASE.length);
      const seg = rel.split("/").filter(Boolean);

      if (method === "GET" && rel === "/health") {
        return json(res, 200, { ok: true, service: "myomars-relay", version: RELAY_VERSION, schema: SCHEMA, uptimeS: Math.round((Date.now() - started) / 1000), sessions: store.sessions.size, sseClients: sse.size, limits: { ...config.limits, logDays: config.log.days, logMaxMb: config.log.maxMb } }, cors);
      }
      if (rel === "/auth/login" && method === "POST") return await login(req, res, cors);
      if (rel === "/auth/logout" && method === "POST") {
        auth.revoke(cookieOf(req, SESSION_COOKIE));
        return json(res, 200, { ok: true }, { ...cors, "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
      }
      if (rel === "/auth/me" && method === "GET") {
        const p = requireAuth(req);
        return json(res, 200, { role: p.role, sessionId: p.sessionId, clientId: p.clientId, expiresAt: p.expiresAt }, cors);
      }
      if (seg[0] === "sessions" && seg[1]) {
        const sid = seg[1];
        const sub = seg.slice(2).join("/");
        if (sub === "events" && method === "POST") return await publish(req, res, sid, cors);
        if (sub === "events" && method === "GET") {
          requireAuth(req, sid);
          const s = sessionFor(sid, false);
          const after = Number(url.searchParams.get("after") ?? "0");
          const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "500")));
          if (!Number.isInteger(after) || after < 0) throw new HttpError(400, "invalid_request", "invalid cursor");
          const events = s.after(after, limit);
          return json(res, 200, { events, lastSeq: s.meta.lastSeq, bufferFloorSeq: s.bufferFloorSeq, complete: after >= s.bufferFloorSeq - 1 }, cors);
        }
        if (sub === "stream" && method === "GET") return stream(req, res, sid, url, cors);
        if (sub === "state" && method === "GET") {
          requireAuth(req, sid);
          const s = sessionFor(sid, false);
          const snap = s.snapshot;
          return json(res, 200, { sessionId: sid, currentRunId: s.meta.currentRunId, endedRunIds: s.meta.endedRunIds, lastSeq: s.meta.lastSeq, bufferFloorSeq: s.bufferFloorSeq, lease: leaseValid(s), snapshot: snap ? { rev: snap.rev, cursor: snap.cursor, savedAt: snap.savedAt, runId: snap.runId } : null }, cors);
        }
        if (sub === "station/lease" && method === "POST") return await lease(req, res, sid, false, cors);
        if (sub === "station/lease/release" && method === "POST") return await lease(req, res, sid, true, cors);
        if (sub === "station/snapshot" && method === "PUT") return await putSnapshot(req, res, sid, cors);
        if (sub === "station/snapshot" && method === "GET") {
          const p = requireAuth(req, sid);
          requireRole(p, ["station", "observer"]);
          const s = sessionFor(sid, false);
          if (!s.snapshot) throw new HttpError(404, "not_found", "no station snapshot yet");
          return json(res, 200, s.snapshot, cors);
        }
      }
      throw new HttpError(404, "not_found", `no route ${method} ${path}`);
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, "internal", "internal error");
      if (!(e instanceof HttpError)) console.error(`[relay] ${requestId} ${method} ${path}:`, e);
      if (!res.headersSent) json(res, err.status, { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}), requestId } }, cors);
      else res.end();
    } finally {
      if (process.env.MYOMARS_ACCESS_LOG === "1") console.log(`[relay] ${new Date().toISOString()} ${requestId} ${method} ${path} ${res.statusCode}`);
    }
  }

  const server: Server = createServer((req, res) => void handle(req, res));
  return {
    server,
    store,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(pruneTimer);
        for (const c of sse) {
          clearInterval(c.heartbeat);
          c.res.end();
        }
        sse.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
