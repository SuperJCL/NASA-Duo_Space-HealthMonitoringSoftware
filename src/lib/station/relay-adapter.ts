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

import type { DeliveryResult, StationAdapter } from "./adapter";
import type { Envelope } from "./protocol";

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
    this.label = `通信服务 ${this.status.baseUrl} · 会话 ${sessionId}`;
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
    void this.lease();
    this.leaseTimer = setInterval(() => void this.lease(), 5000);
    void this.connect(onInbound, onHistory ?? ((raws) => raws.forEach(onInbound)));
    return () => {
      this.running = false;
      this.abort?.abort();
      if (this.retryTimer) clearTimeout(this.retryTimer);
      if (this.leaseTimer) clearInterval(this.leaseTimer);
      void this.fetchImpl(this.url(`/station-lease?clientId=${encodeURIComponent(this.status.clientId)}`), { method: "DELETE" }).catch(() => undefined);
    };
  }

  /** History (catch-up), then the live stream; on any failure: reconnect with back-off. */
  private async connect(onInbound: (raw: unknown) => void, onHistory: (raws: unknown[]) => void) {
    if (!this.running) return;
    try {
      const h = await this.fetchImpl(this.url(`/events?after=${this.status.lastSeq}`), { cache: "no-store" });
      if (!h.ok) throw new Error(`history ${h.status}`);
      const body = (await h.json()) as { events: { seq: number }[]; lastSeq: number };
      if (body.lastSeq < this.status.lastSeq) this.set({ lastError: "通信服务的历史比本窗口记录的更短（服务已重启或清空），请刷新页面" });
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
            this.set({ lastError: "收到无法解析的消息（已忽略）" });
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
    if (this.status.lease === "readonly") return { ok: false, discard: true, note: "只读窗口：另一个基站窗口负责发送" };
    const r = await this.post("station", this.status.clientId, envelope);
    if (r.ok) return { ok: true, note: `通信服务已接收（seq ${r.body.seq}${r.body.duplicate ? "，重复提交，未再次投递" : ""}）；不代表 HUD 已收到` };
    if (r.status === 0) return { ok: false, note: "未连接通信服务（可重发）" };
    if (r.body.error === "not-lease-holder") {
      this.set({ lease: "readonly", leaseHolder: String(r.body.holder ?? "") || null });
      return { ok: false, discard: true, note: "只读窗口：另一个基站窗口负责发送" };
    }
    return { ok: false, note: `通信服务拒收：${String(r.body.error ?? r.status)}${r.body.detail ? `（${String(r.body.detail)}）` : ""}` };
  }

  /**
   * DEV ONLY: the data replay module (src/lib/replay) publishing through this page, as the data
   * producer (contract role "trigger", client "<station client>-replay"). Simulated samples only.
   */
  async publishAsReplay(envelope: Envelope): Promise<{ ok: boolean; note: string }> {
    const r = await this.post("trigger", `${this.status.clientId}-replay`, envelope);
    return r.ok ? { ok: true, note: `数据回放已发布（seq ${r.body.seq}${r.body.duplicate ? "，重复，未再次投递" : ""}）· 模拟样例` } : { ok: false, note: r.status === 0 ? "未连接通信服务" : `通信服务拒收：${String(r.body.error ?? r.status)}${r.body.detail ? `（${String(r.body.detail)}）` : ""}` };
  }
}
