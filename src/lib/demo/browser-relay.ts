// MyoMars BROWSER-DEMO transport: the relay's session rules (relay/core.ts, unchanged) running inside
// one browser tab, behind a fetch-compatible function that speaks the relay's HTTP API.
//
// The station's RelayStationAdapter and the HUD's base-client already take a `fetchImpl`, so both
// ends keep their own logic (contracts, validation, eventId de-duplication, runId isolation,
// case / retest links, lease) and only the transport changes: no relay process, no port 8787, no
// server, no shared memory between visitors. Every page load (and every Reset) gets its own session.
//
// The base URL uses a non-network scheme ("browser-demo://local") on purpose: if any code ever handed
// such a URL to the real fetch, the browser would refuse it at once instead of contacting a host.

import { createRelayCore, type Delivered, type RelayCore } from "../../../relay/core.ts";
import { SessionId } from "@/contracts/envelope";

export const DEMO_BASE = "browser-demo://local";
export type DemoFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type BrowserRelay = { core: RelayCore; fetch: DemoFetch; newSessionId: () => string };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export function createBrowserRelay(opts: { leaseMs?: number } = {}): BrowserRelay {
  const core = createRelayCore({ leaseMs: opts.leaseMs ?? 15_000 });
  const fetchImpl: DemoFetch = async (input, init = {}) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.protocol !== "browser-demo:") throw new TypeError(`browser-demo bus: refusing a ${url.protocol} request`);
    const m = /^\/v1\/sessions\/([^/]+)\/(events|stream|station-lease)$/.exec(url.pathname);
    if (!m) return json(404, { error: "not-found" });
    const sid = decodeURIComponent(m[1]);
    if (!SessionId.safeParse(sid).success) return json(400, { error: "invalid-session" });
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const body = () => {
      try {
        return init.body ? JSON.parse(String(init.body)) : {};
      } catch {
        return undefined;
      }
    };
    if (m[2] === "events" && method === "POST") {
      const raw = body();
      if (raw === undefined) return json(400, { error: "invalid-json" });
      const r = core.publish(sid, raw, headers.get("x-myomars-role") ?? "", (headers.get("x-myomars-client") ?? "").slice(0, 100) || "anonymous");
      return json(r.status, r.body);
    }
    if (m[2] === "events" && method === "GET") return json(200, core.history(sid, Number(url.searchParams.get("after") ?? 0) || 0));
    if (m[2] === "stream" && method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      const enc = new TextEncoder();
      let off: (() => void) | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(`: myomars browser-demo bus · session ${sid}\n\n`));
          off = core.subscribe(sid, after, (d: Delivered) => {
            try {
              c.enqueue(enc.encode(`id: ${d.seq}\ndata: ${JSON.stringify(d)}\n\n`));
            } catch {
              off?.();
            }
          });
          init.signal?.addEventListener("abort", () => {
            off?.();
            try {
              c.error(new DOMException("aborted", "AbortError"));
            } catch {
              /* already closed */
            }
          });
        },
        cancel() {
          off?.();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (m[2] === "station-lease" && method === "POST") {
      const b = body() as { clientId?: unknown } | undefined;
      const clientId = b && typeof b.clientId === "string" && b.clientId ? b.clientId.slice(0, 100) : null;
      if (!clientId) return json(400, { error: "clientId-required" });
      const r = core.claimLease(sid, clientId);
      return json(r.status, r.body);
    }
    if (m[2] === "station-lease" && method === "DELETE") {
      const r = core.releaseLease(sid, url.searchParams.get("clientId"));
      return json(r.status, r.body);
    }
    return json(405, { error: "method-not-allowed" });
  };
  const newSessionId = () => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { core, fetch: fetchImpl, newSessionId };
}

/** The run that is currently active on a session (for the demo controls), from the delivered events only. */
export function activeRunOf(core: RelayCore, sid: string): { runId: string; astronaut: { id: string; callsign: string }; task: { id: string; title: string; targetId?: string | null } } | null {
  const h = core.history(sid, 0);
  if (!h.activeRun) return null;
  const start = [...h.events].reverse().find((e) => e.type === "scenario.start" && e.runId === h.activeRun);
  const p = start?.payload as { astronaut?: { id: string; callsign: string }; task?: { id: string; title: string; targetId?: string | null } } | undefined;
  return p?.astronaut && p.task ? { runId: h.activeRun, astronaut: p.astronaut, task: p.task } : null;
}
