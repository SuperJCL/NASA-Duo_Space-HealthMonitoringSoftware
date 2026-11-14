// Minimal Node client for the MyoMars relay (used by the test clients and the automated tests).
// Teammates may copy it as a reference implementation of the protocol: login → cookie, publish
// with x-myomars-client, SSE with a resumable cursor (Last-Event-ID). Node 22+, no dependencies.

import { randomUUID } from "node:crypto";
import { SCHEMA, type Delivered, type Envelope, type EventType, type PublisherRole } from "../../src/contracts/envelope.ts";
import { API_BASE, CLIENT_HEADER, INSTANCE_HEADER, SESSION_COOKIE, type ControlEvent } from "../../src/contracts/api.ts";

export type HttpResult<T = unknown> = { status: number; body: T };

export class RelayClient {
  readonly base: string;
  readonly name: string;
  cookie: string | null = null;
  role: string | null = null;
  sessionId = "demo";
  clientId: string | null = null;
  instanceId: string | null = null;

  constructor(base: string, name = "myomars-tool") {
    this.base = base.replace(/\/$/, "");
    this.name = name;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { [CLIENT_HEADER]: this.name, ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.instanceId ? { [INSTANCE_HEADER]: this.instanceId } : {}), ...extra };
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<HttpResult<T>> {
    const res = await fetch(`${this.base}${API_BASE}${path}`, {
      method,
      headers: this.headers({ ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra }),
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  async login(role: string, accessCode: string, sessionId = "demo"): Promise<HttpResult> {
    const res = await fetch(`${this.base}${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", [CLIENT_HEADER]: this.name },
      body: JSON.stringify({ role, accessCode, sessionId, clientName: this.name }),
    });
    const body = await res.json();
    if (res.ok) {
      const set = res.headers.get("set-cookie") ?? "";
      const m = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(set);
      this.cookie = m ? `${SESSION_COOKIE}=${m[1]}` : null;
      this.role = role;
      this.sessionId = sessionId;
      this.clientId = (body as { clientId: string }).clientId;
    }
    return { status: res.status, body };
  }

  envelope(type: EventType, fields: { runId: string; caseId?: string | null; retestId?: string | null; payload: unknown; eventId?: string; occurredAt?: string }): Envelope {
    return {
      schema: SCHEMA,
      eventId: fields.eventId ?? randomUUID(),
      sessionId: this.sessionId,
      runId: fields.runId,
      caseId: fields.caseId ?? null,
      ...(fields.retestId ? { retestId: fields.retestId } : {}),
      sentAt: new Date().toISOString(),
      ...(fields.occurredAt ? { occurredAt: fields.occurredAt } : {}),
      source: (this.role ?? "trigger") as PublisherRole,
      type,
      payload: fields.payload,
    };
  }

  publish(env: Envelope | unknown) {
    return this.request<{ accepted?: boolean; duplicate?: boolean; seq?: number; error?: { code: string; message: string } }>("POST", `/sessions/${this.sessionId}/events`, env);
  }

  /**
   * Open the SSE stream. `after` is the last seq already handled (0 = everything still buffered).
   * Reconnects automatically with Last-Event-ID unless `reconnect` is false.
   */
  stream(opts: { after?: number; onEvent: (d: Delivered) => void; onControl?: (c: ControlEvent) => void; onState?: (s: "open" | "closed" | "error", info?: string) => void; reconnect?: boolean }) {
    let lastId = opts.after ?? 0;
    let stopped = false;
    let controller: AbortController | null = null;
    const run = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const res = await fetch(`${this.base}${API_BASE}/sessions/${this.sessionId}/stream?after=${lastId}`, { headers: this.headers({ accept: "text/event-stream", ...(lastId ? { "last-event-id": String(lastId) } : {}) }), signal: controller.signal });
          if (!res.ok || !res.body) {
            opts.onState?.("error", `HTTP ${res.status}: ${await res.text()}`);
            if (res.status === 401 || res.status === 403 || opts.reconnect === false) return;
          } else {
            opts.onState?.("open");
            const decoder = new TextDecoder();
            let buf = "";
            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
              buf += decoder.decode(chunk, { stream: true });
              let i: number;
              while ((i = buf.indexOf("\n\n")) >= 0) {
                const block = buf.slice(0, i);
                buf = buf.slice(i + 2);
                let event = "message";
                let data = "";
                let id: string | null = null;
                for (const line of block.split("\n")) {
                  if (line.startsWith(":")) continue;
                  const [k, ...rest] = line.split(":");
                  const v = rest.join(":").replace(/^ /, "");
                  if (k === "event") event = v;
                  else if (k === "data") data += (data ? "\n" : "") + v;
                  else if (k === "id") id = v;
                }
                if (!data) continue;
                if (event === "envelope") {
                  const d = JSON.parse(data) as Delivered;
                  if (id) lastId = Number(id);
                  opts.onEvent(d);
                } else if (event === "control") opts.onControl?.(JSON.parse(data) as ControlEvent);
              }
            }
            opts.onState?.("closed");
          }
        } catch (e) {
          if (stopped) return;
          opts.onState?.("error", (e as Error).message);
        }
        if (stopped || opts.reconnect === false) return;
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    const done = run();
    return {
      close: () => {
        stopped = true;
        controller?.abort();
        return done;
      },
      get lastId() {
        return lastId;
      },
    };
  }
}

/** Wait until `pred` holds (polling), or throw after `ms`. */
export async function until(pred: () => boolean, ms = 3000, what = "condition") {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
