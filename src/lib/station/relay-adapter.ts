// MyoMars base station: RELAY adapter (HTTP publish + Server-Sent Events) for the local relay
// (relay/relay.ts). It replaces the local mock: the station's business logic is unchanged.
//
// - History first (`GET …/events?after=`), delivered as one batch so the station restores its own
//   earlier messages instead of sending them again; then the live stream (`GET …/stream?after=`),
//   reconnecting with back-off and catching up from the last sequence number.
// - One station window publishes at a time (relay lease). Other windows are read-only mirrors:
//   their sends are discarded, never retried, and decisions are refused in the UI.
// - A send is "ok" only when the relay stored it (sequence number). Nothing here means that the
//   HUD received anything: that only comes back as hud.received.
// - Connection state is explicit: connecting / online / reconnecting / offline.

import { busName } from "./transport-words";
import type { DeliveryResult, StationAdapter } from "./adapter";
import type { Envelope } from "./protocol";

/** Live subscriptions per window id in this page (see the release in subscribe()). */
const LIVE = new Map<string, number>();
const RELEASE_DELAY_MS = 1000;

export type RelayConn = "connecting" | "online" | "reconnecting" | "offline";
export type RelayStatus = {
  baseUrl: string;
  sessionId: string;
  clientId: string;
  conn: RelayConn;
  /** pending: not known yet · holder: this window publishes · readonly: another station window does. */
  lease: "pending" | "holder" | "readonly";
  leaseHolder: string | null;
  lastSeq: number;
  lastError: string | null;
  since: string | null;
};
type Fetch = typeof fetch;

export class RelayStationAdapter implements StationAdapter {
  readonly mode = "relay" as const;
  readonly label: string;
  private status: RelayStatus;
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private leaseTimer: ReturnType<typeof setInterval> | null = null;
  private retryMs = 1000;
  private running = false;
  private readonly fetchImpl: Fetch;

  constructor({ baseUrl, sessionId, clientId, fetchImpl }: { baseUrl: string; sessionId: string; clientId?: string; fetchImpl?: Fetch }) {
    this.fetchImpl = fetchImpl ?? ((...a: Parameters<Fetch>) => fetch(...a));
    const id = clientId ?? `station-${Math.random().toString(36).slice(2, 8)}`;
    this.status = { baseUrl: baseUrl.replace(/\/$/, ""), sessionId, clientId: id, conn: "connecting", lease: "pending", leaseHolder: null, lastSeq: 0, lastError: null, since: null };
    this.label = this.status.baseUrl.startsWith("browser-demo:") ? `In-browser bus (this tab) · session ${sessionId}` : `Relay ${this.status.baseUrl} · session ${sessionId}`;
  }

  subscribeStatus = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getStatus = () => this.status;
  private set(p: Partial<RelayStatus>) {
    this.status = { ...this.status, ...p };
    for (const l of this.listeners) l();
  }
  private url(path: string) {
    return `${this.status.baseUrl}/v1/sessions/${encodeURIComponent(this.status.sessionId)}${path}`;
  }

  subscribe(onInbound: (raw: unknown) => void, onHistory?: (raws: unknown[]) => void) {
    this.running = true;
    const id = this.status.clientId;
    LIVE.set(id, (LIVE.get(id) ?? 0) + 1);
    void this.lease();
    this.leaseTimer = setInterval(() => void this.lease(), 5000);
    void this.connect(onInbound, onHistory ?? ((raws) => raws.forEach(onInbound)));
    return () => {
      this.running = false;
      this.abort?.abort();
      if (this.retryTimer) clearTimeout(this.retryTimer);
      if (this.leaseTimer) clearInterval(this.leaseTimer);
      LIVE.set(id, Math.max(0, (LIVE.get(id) ?? 1) - 1));
      // Release the lease only if this page no longer has a live subscription for this window id.
      // React development mode unsubscribes and resubscribes at once; an immediate release could reach
      // the relay after the renewed claim and hand the lease to another station window.
      setTimeout(() => {
        if (!LIVE.get(id)) void this.fetchImpl(this.url(`/station-lease?clientId=${encodeURIComponent(id)}`), { method: "DELETE" }).catch(() => undefined);
      }, RELEASE_DELAY_MS);
    };
  }

  /** History (catch-up), then the live stream; on any failure: reconnect with back-off. */
  private async connect(onInbound: (raw: unknown) => void, onHistory: (raws: unknown[]) => void) {
    if (!this.running) return;
    try {
      const h = await this.fetchImpl(this.url(`/events?after=${this.status.lastSeq}`), { cache: "no-store" });
      if (!h.ok) throw new Error(`history ${h.status}`);
      const body = (await h.json()) as { events: { seq: number }[]; lastSeq: number };
      if (body.lastSeq < this.status.lastSeq) this.set({ lastError: "The relay history is shorter than this window's record (the relay was restarted or cleared): reload the page" });
      if (body.events.length) {
        this.set({ lastSeq: Math.max(this.status.lastSeq, ...body.events.map((e) => e.seq)) });
        onHistory(body.events);
      }
      this.abort = new AbortController();
      const res = await this.fetchImpl(this.url(`/stream?after=${this.status.lastSeq}`), { headers: { accept: "text/event-stream" }, signal: this.abort.signal, cache: "no-store" });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      this.retryMs = 1000;
      this.set({ conn: "online", lastError: null, since: new Date().toISOString() });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          try {
            const d = JSON.parse(data) as { seq?: number };
            if (typeof d.seq === "number") this.set({ lastSeq: Math.max(this.status.lastSeq, d.seq) });
            onInbound(d);
          } catch {
            this.set({ lastError: "Received a message that could not be parsed (ignored)" });
          }
        }
      }
      throw new Error("stream closed");
    } catch (e) {
      if (!this.running) return;
      this.set({ conn: this.status.conn === "connecting" ? "offline" : "reconnecting", lastError: e instanceof Error ? e.message : String(e) });
      this.retryTimer = setTimeout(() => void this.connect(onInbound, onHistory), this.retryMs);
      this.retryMs = Math.min(5000, Math.round(this.retryMs * 1.6));
    }
  }

  /** Station lease: renew every 5 s; another live holder makes this window a read-only mirror. */
  private async lease() {
    if (!this.running) return;
    try {
      const r = await this.fetchImpl(this.url("/station-lease"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: this.status.clientId }) });
      const b = (await r.json().catch(() => ({}))) as { holder?: string };
      this.set(r.ok ? { lease: "holder", leaseHolder: this.status.clientId } : { lease: "readonly", leaseHolder: b.holder ?? null });
    } catch {
      /* connection state is reported by the stream */
    }
  }

  private async post(role: "station" | "trigger", clientId: string, envelope: Envelope): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    try {
      const r = await this.fetchImpl(this.url("/events"), { method: "POST", headers: { "content-type": "application/json", "x-myomars-role": role, "x-myomars-client": clientId }, body: JSON.stringify(envelope) });
      return { ok: r.ok, status: r.status, body: ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
    } catch {
      return { ok: false, status: 0, body: {} };
    }
  }

  async send(envelope: Envelope): Promise<DeliveryResult> {
    if (this.status.lease === "readonly") return { ok: false, discard: true, note: "Read-only window: another base window sends" };
    const r = await this.post("station", this.status.clientId, envelope);
    if (r.ok) return { ok: true, note: `Accepted by the ${busName()} (seq ${r.body.seq}${r.body.duplicate ? ", duplicate, not delivered again" : ""}); not a HUD receipt` };
    if (r.status === 0) return { ok: false, note: `Not connected to the ${busName()} (can be resent)` };
    if (r.body.error === "not-lease-holder") {
      this.set({ lease: "readonly", leaseHolder: String(r.body.holder ?? "") || null });
      return { ok: false, discard: true, note: "Read-only window: another base window sends" };
    }
    return { ok: false, note: `Refused by the ${busName()}: ${String(r.body.error ?? r.status)}${r.body.detail ? ` (${String(r.body.detail)})` : ""}` };
  }

  /**
   * DEV ONLY: the data replay module (src/lib/replay) publishing through this page, as the data
   * producer (contract role "trigger", client "<station client>-replay"). Simulated samples only.
   */
  async publishAsReplay(envelope: Envelope): Promise<{ ok: boolean; note: string; seq?: number }> {
    const r = await this.post("trigger", `${this.status.clientId}-replay`, envelope);
    return r.ok ? { ok: true, seq: Number(r.body.seq), note: `Accepted by the ${busName()} (seq ${r.body.seq}${r.body.duplicate ? ", duplicate, not delivered again" : ""}) · simulated sample` } : { ok: false, note: r.status === 0 ? `Not connected to the ${busName()}` : `Refused by the ${busName()}: ${String(r.body.error ?? r.status)}${r.body.detail ? ` (${String(r.body.detail)})` : ""}` };
  }
}
