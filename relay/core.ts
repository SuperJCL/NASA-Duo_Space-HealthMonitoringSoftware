// MyoMars relay CORE: the session rules of the local relay, without any transport (no Node APIs).
//
// Used by the Node relay (relay.ts: HTTP + SSE, optional JSONL persistence) and by the in-browser
// demo bus (src/lib/demo/browser-relay.ts: the same rules inside one browser tab). The rules are
// the relay's, unchanged: contract validation (envelope, per-type rules, payload), publisher role per
// event type, one station window holds the publishing lease, same eventId + same content =
// duplicate (no second delivery), different content = 409, messages for an ended run = 409
// stale-run, other runs = 409 unknown-run. It never analyses data and never approves anything.

import { EVENT_RULES, parseEnvelope, PUBLISHER_ROLES, type EventType, type PublisherRole } from "../src/contracts/envelope.ts";

export type Delivered = Record<string, unknown> & { eventId: string; runId: string; type: EventType; seq: number; receivedAt: string; sender: { role: PublisherRole; clientId: string } };
export type Reply = { status: number; body: Record<string, unknown> };
type Session = {
  id: string;
  seq: number;
  events: Delivered[];
  byId: Map<string, { canon: string; seq: number; receivedAt: string }>;
  activeRun: string | null;
  ended: Set<string>;
  listeners: Set<(d: Delivered) => void>;
  lease: { holder: string; expiresAt: number } | null;
};

/** Stable JSON (sorted keys) for "same eventId, same content" checks. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export type RelayCoreOptions = {
  leaseMs?: number;
  /** Called once when a session is first used: restore persisted records with `restore`. */
  onCreate?: (sid: string, restore: (d: Delivered, canon: string) => void) => void;
  /** Called after a new event is stored (e.g. to persist it). */
  onRecord?: (sid: string, d: Delivered, canon: string) => void;
  log?: (line: string) => void;
  now?: () => number;
};

export function createRelayCore(opts: RelayCoreOptions = {}) {
  const leaseMs = opts.leaseMs ?? 15_000;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => Date.now());
  const sessions = new Map<string, Session>();

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
  const session = (sid: string): Session => {
    const s = sessions.get(sid);
    if (s) return s;
    const fresh: Session = { id: sid, seq: 0, events: [], byId: new Map(), activeRun: null, ended: new Set(), listeners: new Set(), lease: null };
    sessions.set(sid, fresh);
    opts.onCreate?.(sid, (d, canon) => record(fresh, d, canon));
    return fresh;
  };
  const leaseHolder = (s: Session) => (s.lease && s.lease.expiresAt > now() ? s.lease.holder : null);

  return {
    /** Validate, authorise (declared role), sequence, store, forward. */
    publish(sid: string, raw: unknown, role: string, clientId: string): Reply {
      if (!(PUBLISHER_ROLES as readonly string[]).includes(role)) return { status: 403, body: { error: "unknown-role", detail: `role must be one of ${PUBLISHER_ROLES.join(", ")}` } };
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
      const d = { ...(raw as object), seq: s.seq + 1, receivedAt: new Date(now()).toISOString(), sender: { role: role as PublisherRole, clientId } } as Delivered;
      record(s, d, canon);
      opts.onRecord?.(sid, d, canon);
      for (const l of [...s.listeners]) l(d);
      log(`${sid} #${d.seq} ${role}/${clientId} ${env.type} ${env.caseId ?? ""}`);
      return { status: 200, body: { seq: d.seq, receivedAt: d.receivedAt, duplicate: false } };
    },
    /** Delivered history after `after`. */
    history(sid: string, after = 0) {
      const s = session(sid);
      return { events: s.events.filter((e) => e.seq > after), lastSeq: s.seq, activeRun: s.activeRun };
    },
    /** Events after `after`, then every new one, in order. Returns the unsubscribe function. */
    subscribe(sid: string, after: number, listener: (d: Delivered) => void) {
      const s = session(sid);
      for (const d of s.events) if (d.seq > after) listener(d);
      s.listeners.add(listener);
      return () => void s.listeners.delete(listener);
    },
    claimLease(sid: string, clientId: string): Reply {
      const s = session(sid);
      const holder = leaseHolder(s);
      if (holder && holder !== clientId) return { status: 409, body: { error: "lease-held", holder, expiresAt: new Date(s.lease!.expiresAt).toISOString(), granted: false } };
      s.lease = { holder: clientId, expiresAt: now() + leaseMs };
      return { status: 200, body: { holder: clientId, expiresAt: new Date(s.lease.expiresAt).toISOString(), granted: true, leaseMs } };
    },
    releaseLease(sid: string, clientId: string | null): Reply {
      const s = session(sid);
      if (s.lease && s.lease.holder === clientId) s.lease = null;
      return { status: 200, body: { released: true } };
    },
    sessions: () => [...sessions.values()].map((s) => ({ id: s.id, lastSeq: s.seq, activeRun: s.activeRun, stationLease: leaseHolder(s) })),
    /** A session's delivered events (tests, ops). */
    events: (sid: string) => session(sid).events.slice(),
    /** Forget a session and detach its listeners (the browser demo's Reset). */
    drop(sid: string) {
      const s = sessions.get(sid);
      if (s) s.listeners.clear();
      sessions.delete(sid);
    },
  };
}
export type RelayCore = ReturnType<typeof createRelayCore>;
