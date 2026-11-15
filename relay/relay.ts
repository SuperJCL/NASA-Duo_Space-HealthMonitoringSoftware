// MyoMars local relay (integration): HTTP publish + Server-Sent Events between the Trigger, the HUD
// and the Mars Station, on the shared message contracts v1 (src/contracts).
//
// API shape follows what the HUD client calls today (myomars-hud/hud/base-client.js on
// feat/myomars-hud, reference only until the HUD version is locked):
//   POST   /v1/sessions/:sid/events            publish one envelope (x-myomars-role, x-myomars-client)
//   GET    /v1/sessions/:sid/events?after=n   delivered history { events, lastSeq }
//   GET    /v1/sessions/:sid/stream?after=n   SSE; id = seq; Last-Event-ID resumes
//   POST   /v1/sessions/:sid/station-lease    { clientId } — one station window publishes at a time
//   DELETE /v1/sessions/:sid/station-lease?clientId=…
//   GET    /v1/health
// Rules: contract validation (envelope, per-type rules, payload), publisher role per event type,
// same eventId + same content = duplicate (no second delivery), different content = 409, messages
// for an ended run = 409 stale-run, other runs = 409 unknown-run. It never analyses data and never
// approves anything; the station's human review stays in the station. Roles are declared by header
// (local / LAN development only — no authentication yet).
//
// Selectively reuses ideas from the paused F2 work (feat/myomars-foundation 8f13fdf): body limit,
// origin check, fixed-window rate limit, static serving. Not its cookie login or /api/v1 routes.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { EVENT_RULES, parseEnvelope, PUBLISHER_ROLES, SessionId, type EventType, type PublisherRole } from "../src/contracts/envelope.ts";

export const RELAY_VERSION = "0.2.0-integration";

export type RelayOptions = {
  /** Directory served at / (e.g. the HUD folder), or null. */
  staticDir?: string | null;
  /** Append-only JSONL persistence directory, or null for memory only. */
  dataDir?: string | null;
  /** Extra allowed browser origins (same-host origins on any port are always allowed). */
  allowedOrigins?: string[];
  leaseMs?: number;
  publishPerMinute?: number;
  log?: (line: string) => void;
};

type Delivered = Record<string, unknown> & { eventId: string; runId: string; type: EventType; seq: number; receivedAt: string; sender: { role: PublisherRole; clientId: string } };
type Session = {
  id: string;
  seq: number;
  events: Delivered[];
  byId: Map<string, { canon: string; seq: number; receivedAt: string }>;
  activeRun: string | null;
  ended: Set<string>;
  streams: Set<ServerResponse>;
  lease: { holder: string; expiresAt: number } | null;
};

const ROLE_HEADER = "x-myomars-role";
const CLIENT_HEADER = "x-myomars-client";
const MAX_BODY = 64 * 1024;
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".md": "text/markdown; charset=utf-8" };

/** Stable JSON (sorted keys) for "same eventId, same content" checks. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export function createRelay(opts: RelayOptions = {}) {
  const leaseMs = opts.leaseMs ?? 15_000;
  const perMinute = opts.publishPerMinute ?? 600;
  const log = opts.log ?? (() => {});
  const sessions = new Map<string, Session>();
  const hits = new Map<string, { n: number; t: number }>();
  const dataDir = opts.dataDir ? resolve(opts.dataDir) : null;
  if (dataDir) mkdirSync(dataDir, { recursive: true });

  const fileOf = (sid: string) => join(dataDir!, `session-${sid}.jsonl`);
  const session = (sid: string): Session => {
    let s = sessions.get(sid);
    if (s) return s;
    s = { id: sid, seq: 0, events: [], byId: new Map(), activeRun: null, ended: new Set(), streams: new Set(), lease: null };
    sessions.set(sid, s);
    // Restore a persisted session (delivered order is the source of truth).
    if (dataDir && existsSync(fileOf(sid))) {
      for (const line of readFileSync(fileOf(sid), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as { d: Delivered; canon: string };
          record(s, rec.d, rec.canon);
        } catch {
          log(`skipped a corrupt line in ${fileOf(sid)}`);
        }
      }
      log(`session ${sid}: restored ${s.events.length} events (lastSeq ${s.seq})`);
    }
    return s;
  };
  function record(s: Session, d: Delivered, canon: string) {
    s.seq = Math.max(s.seq, d.seq);
    s.events.push(d);
    s.byId.set(d.eventId, { canon, seq: d.seq, receivedAt: d.receivedAt });
    if (d.type === "scenario.start") {
      if (s.activeRun && s.activeRun !== d.runId) s.ended.add(s.activeRun);
      s.activeRun = d.runId;
    } else if (d.type === "scenario.reset") {
      s.ended.add(d.runId);
      if (s.activeRun === d.runId) s.activeRun = null;
    }
  }

  const sameHost = (origin: string, req: IncomingMessage) => {
    try {
      const o = new URL(origin);
      const host = String(req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
      return o.hostname === host || (["localhost", "127.0.0.1", "::1"].includes(o.hostname) && ["localhost", "127.0.0.1", "::1"].includes(host));
    } catch {
      return false;
    }
  };
  const cors = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;
    if (!origin) return {};
    if (sameHost(origin, req) || (opts.allowedOrigins ?? []).includes(origin.replace(/\/$/, ""))) {
      return { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-headers": `content-type, ${ROLE_HEADER}, ${CLIENT_HEADER}, last-event-id`, "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" };
    }
    return {};
  };
  const json = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(req) });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((ok, fail) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          fail(Object.assign(new Error("payload-too-large"), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          ok(size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
        } catch {
          fail(Object.assign(new Error("invalid-json"), { status: 400 }));
        }
      });
      req.on("error", fail);
    });
  const limited = (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.t > 60_000) {
      hits.set(key, { n: 1, t: now });
      return false;
    }
    h.n += 1;
    return h.n > perMinute;
  };
  const leaseHolder = (s: Session) => (s.lease && s.lease.expiresAt > Date.now() ? s.lease.holder : null);

  /** Validate, authorise (declared role), sequence, store, forward. */
  function publish(sid: string, raw: unknown, role: string, clientId: string): { status: number; body: Record<string, unknown> } {
    if (!(PUBLISHER_ROLES as readonly string[]).includes(role)) return { status: 403, body: { error: "unknown-role", detail: `${ROLE_HEADER} must be one of ${PUBLISHER_ROLES.join(", ")}` } };
    const p = parseEnvelope(raw);
    if (!p.ok) return { status: 400, body: { error: "invalid", details: [p.message] } };
    const env = p.value;
    if (env.sessionId !== sid) return { status: 400, body: { error: "session-mismatch", detail: `envelope sessionId ${env.sessionId} ≠ ${sid}` } };
    const rule = EVENT_RULES[env.type];
    if (!(rule.roles as readonly string[]).includes(role)) return { status: 403, body: { error: "role-not-allowed", detail: `${env.type} may be published by ${rule.roles.join(", ")}, not ${role}` } };
    const s = session(sid);
    if (role === "station") {
      const holder = leaseHolder(s);
      if (holder && holder !== clientId) return { status: 409, body: { error: "not-lease-holder", holder } };
    }
    const canon = canonical(raw);
    const prev = s.byId.get(env.eventId);
    if (prev) return prev.canon === canon ? { status: 200, body: { seq: prev.seq, receivedAt: prev.receivedAt, duplicate: true } } : { status: 409, body: { error: "eventId-conflict", detail: "same eventId with different content" } };
    if (s.ended.has(env.runId)) return { status: 409, body: { error: "stale-run", detail: `run ${env.runId} has ended` } };
    if (env.type !== "scenario.start" && env.runId !== s.activeRun) return { status: 409, body: { error: "unknown-run", detail: `active run is ${s.activeRun ?? "none"}` } };
    const d = { ...(raw as object), seq: s.seq + 1, receivedAt: new Date().toISOString(), sender: { role: role as PublisherRole, clientId } } as Delivered;
    record(s, d, canon);
    if (dataDir) appendFileSync(fileOf(sid), JSON.stringify({ d, canon }) + "\n");
    for (const res of s.streams) res.write(`id: ${d.seq}\ndata: ${JSON.stringify(d)}\n\n`);
    log(`${sid} #${d.seq} ${role}/${clientId} ${env.type} ${env.caseId ?? ""}`);
    return { status: 200, body: { seq: d.seq, receivedAt: d.receivedAt, duplicate: false } };
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!opts.staticDir) return false;
    const root = resolve(opts.staticDir);
    const rel = normalize(decodeURIComponent(path === "/" ? "/hud.html" : path)).replace(/^([/\\])+/, "");
    const file = resolve(root, rel);
    if (!(file === root || file.startsWith(root + sep)) || /(^|[/\\])(server|test|node_modules)([/\\]|$)/.test(rel)) return false;
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
    return true;
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://relay.local");
    const path = url.pathname;
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors(req));
        return res.end();
      }
      if (path === "/v1/health") return json(req, res, 200, { ok: true, service: "myomars-relay", version: RELAY_VERSION, sessions: [...sessions.values()].map((s) => ({ id: s.id, lastSeq: s.seq, activeRun: s.activeRun, stationLease: leaseHolder(s) })) });
      const m = /^\/v1\/sessions\/([^/]+)\/(events|stream|station-lease)$/.exec(path);
      if (m) {
        const sid = decodeURIComponent(m[1]);
        if (!SessionId.safeParse(sid).success) return json(req, res, 400, { error: "invalid-session" });
        const s = session(sid);
        if (m[2] === "events" && req.method === "POST") {
          const clientId = String(req.headers[CLIENT_HEADER] ?? "").slice(0, 100) || "anonymous";
          if (limited(`${sid}:${clientId}`)) return json(req, res, 429, { error: "rate-limited" });
          const r = publish(sid, await readBody(req), String(req.headers[ROLE_HEADER] ?? ""), clientId);
          return json(req, res, r.status, r.body);
        }
        if (m[2] === "events" && req.method === "GET") {
          const after = Number(url.searchParams.get("after") ?? 0) || 0;
          return json(req, res, 200, { events: s.events.filter((e) => e.seq > after), lastSeq: s.seq, activeRun: s.activeRun });
        }
        if (m[2] === "stream" && req.method === "GET") {
          const after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0) || 0;
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no", ...cors(req) });
          res.write(`: myomars relay ${RELAY_VERSION} · session ${sid}\n\n`);
          for (const d of s.events) if (d.seq > after) res.write(`id: ${d.seq}\ndata: ${JSON.stringify(d)}\n\n`);
          s.streams.add(res);
          const ping = setInterval(() => res.write(`: ping\n\n`), 15_000);
          req.on("close", () => {
            clearInterval(ping);
            s.streams.delete(res);
          });
          return;
        }
        if (m[2] === "station-lease" && req.method === "POST") {
          const body = (await readBody(req)) as { clientId?: unknown };
          const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId.slice(0, 100) : null;
          if (!clientId) return json(req, res, 400, { error: "clientId-required" });
          const holder = leaseHolder(s);
          if (holder && holder !== clientId) return json(req, res, 409, { error: "lease-held", holder, expiresAt: new Date(s.lease!.expiresAt).toISOString(), granted: false });
          s.lease = { holder: clientId, expiresAt: Date.now() + leaseMs };
          return json(req, res, 200, { holder: clientId, expiresAt: new Date(s.lease.expiresAt).toISOString(), granted: true, leaseMs });
        }
        if (m[2] === "station-lease" && req.method === "DELETE") {
          if (s.lease && s.lease.holder === url.searchParams.get("clientId")) s.lease = null;
          return json(req, res, 200, { released: true });
        }
        return json(req, res, 405, { error: "method-not-allowed" });
      }
      if (req.method === "GET" && serveStatic(req, res, path)) return;
      return json(req, res, 404, { error: "not-found" });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return json(req, res, status, { error: e instanceof Error ? e.message : "error" });
    }
  };

  const server: Server = createServer((req, res) => void handler(req, res));
  return {
    server,
    listen: (port: number, host = "0.0.0.0") => new Promise<number>((ok) => server.listen(port, host, () => ok((server.address() as { port: number }).port))),
    close: () =>
      new Promise<void>((ok) => {
        for (const s of sessions.values()) for (const r of s.streams) r.end();
        server.close(() => ok());
        server.closeAllConnections();
      }),
    /** Test / ops helper: a session's delivered events. */
    events: (sid: string) => session(sid).events.slice(),
  };
}
