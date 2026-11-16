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
import { SessionId } from "../src/contracts/envelope.ts";
import { canonical, createRelayCore, type Delivered } from "./core.ts";

export { canonical };
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

const ROLE_HEADER = "x-myomars-role";
const CLIENT_HEADER = "x-myomars-client";
const MAX_BODY = 64 * 1024;
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".md": "text/markdown; charset=utf-8" };

/** The relay over HTTP + SSE. The session rules live in core.ts (shared with the in-browser demo bus). */
export function createRelay(opts: RelayOptions = {}) {
  const perMinute = opts.publishPerMinute ?? 600;
  const log = opts.log ?? (() => {});
  const hits = new Map<string, { n: number; t: number }>();
  const dataDir = opts.dataDir ? resolve(opts.dataDir) : null;
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const fileOf = (sid: string) => join(dataDir!, `session-${sid}.jsonl`);
  const streams = new Set<ServerResponse>();
  const core = createRelayCore({
    leaseMs: opts.leaseMs,
    log,
    // Restore a persisted session (delivered order is the source of truth).
    onCreate: (sid, restore) => {
      if (!dataDir || !existsSync(fileOf(sid))) return;
      let n = 0;
      for (const line of readFileSync(fileOf(sid), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as { d: Delivered; canon: string };
          restore(rec.d, rec.canon);
          n++;
        } catch {
          log(`skipped a corrupt line in ${fileOf(sid)}`);
        }
      }
      log(`session ${sid}: restored ${n} events`);
    },
    onRecord: (sid, d, canon) => {
      if (dataDir) appendFileSync(fileOf(sid), JSON.stringify({ d, canon }) + "\n");
    },
  });

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
  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!opts.staticDir) return false;
    // "/" opens the HUD in integration mode (two-end run: the HUD publishes hud-role events only).
    if (path === "/") {
      res.writeHead(302, { location: "/hud.html?mode=integration", "cache-control": "no-store" });
      res.end();
      return true;
    }
    const root = resolve(opts.staticDir);
    const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, "");
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
      if (path === "/v1/health") return json(req, res, 200, { ok: true, service: "myomars-relay", version: RELAY_VERSION, sessions: core.sessions() });
      const m = /^\/v1\/sessions\/([^/]+)\/(events|stream|station-lease)$/.exec(path);
      if (m) {
        const sid = decodeURIComponent(m[1]);
        if (!SessionId.safeParse(sid).success) return json(req, res, 400, { error: "invalid-session" });
        if (m[2] === "events" && req.method === "POST") {
          const clientId = String(req.headers[CLIENT_HEADER] ?? "").slice(0, 100) || "anonymous";
          if (limited(`${sid}:${clientId}`)) return json(req, res, 429, { error: "rate-limited" });
          const r = core.publish(sid, await readBody(req), String(req.headers[ROLE_HEADER] ?? ""), clientId);
          return json(req, res, r.status, r.body);
        }
        if (m[2] === "events" && req.method === "GET") {
          const after = Number(url.searchParams.get("after") ?? 0) || 0;
          return json(req, res, 200, core.history(sid, after));
        }
        if (m[2] === "stream" && req.method === "GET") {
          const after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0) || 0;
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no", ...cors(req) });
          res.write(`: myomars relay ${RELAY_VERSION} · session ${sid}\n\n`);
          streams.add(res);
          const off = core.subscribe(sid, after, (d) => res.write(`id: ${d.seq}\ndata: ${JSON.stringify(d)}\n\n`));
          const ping = setInterval(() => res.write(`: ping\n\n`), 15_000);
          req.on("close", () => {
            clearInterval(ping);
            off();
            streams.delete(res);
          });
          return;
        }
        if (m[2] === "station-lease" && req.method === "POST") {
          const body = (await readBody(req)) as { clientId?: unknown };
          const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId.slice(0, 100) : null;
          if (!clientId) return json(req, res, 400, { error: "clientId-required" });
          const r = core.claimLease(sid, clientId);
          return json(req, res, r.status, r.body);
        }
        if (m[2] === "station-lease" && req.method === "DELETE") {
          const r = core.releaseLease(sid, url.searchParams.get("clientId"));
          return json(req, res, r.status, r.body);
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
        for (const r of streams) r.end();
        server.close(() => ok());
        server.closeAllConnections();
      }),
    /** Test / ops helper: a session's delivered events. */
    events: (sid: string) => core.events(sid),
  };
}
