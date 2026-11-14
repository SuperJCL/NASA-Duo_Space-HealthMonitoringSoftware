// Relay storage: per demo session, the accepted events (append-only JSONL on disk, bounded ring
// buffer in memory), the eventId index for deduplication, the scenario run state, the station lease
// and the station snapshot. On restart everything except leases is rebuilt from disk, so dedup
// and sequence numbers survive a restart within the log retention window.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Delivered } from "../src/contracts/envelope.ts";
import type { StationSnapshot } from "../src/contracts/api.ts";

export type Lease = { instanceId: string; clientId: string; acquiredAt: string; expiresAt: string };
type SeenEntry = { seq: number; hash: string; receivedAt: string };
type SessionMeta = { lastSeq: number; currentRunId: string | null; endedRunIds: string[] };

/** Key-order-independent JSON (so a re-serialised identical message hashes the same). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}
export const contentHash = (v: unknown) => createHash("sha256").update(stableStringify(v)).digest("hex");

const day = (iso: string) => iso.slice(0, 10);
const atomicWrite = (file: string, data: string) => {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
};

export class Session {
  meta: SessionMeta = { lastSeq: 0, currentRunId: null, endedRunIds: [] };
  seen = new Map<string, SeenEntry>();
  buffer: Delivered[] = [];
  lease: Lease | null = null;
  snapshot: StationSnapshot | null = null;

  readonly id: string;
  private readonly dir: string;
  private readonly bufferLimit: number;

  constructor(id: string, dir: string, bufferLimit: number) {
    this.id = id;
    this.dir = dir;
    this.bufferLimit = bufferLimit;
  }

  get bufferFloorSeq() {
    return this.buffer.length ? this.buffer[0].seq : this.meta.lastSeq + 1;
  }

  load() {
    mkdirSync(this.dir, { recursive: true });
    const metaFile = join(this.dir, "session.json");
    if (existsSync(metaFile)) this.meta = JSON.parse(readFileSync(metaFile, "utf8")) as SessionMeta;
    for (const f of readdirSync(this.dir)
      .filter((x) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x))
      .sort()) {
      for (const line of readFileSync(join(this.dir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        let d: Delivered & { hash?: string };
        try {
          d = JSON.parse(line);
        } catch {
          continue; // a torn last line after a crash is skipped
        }
        const { hash, ...env } = d;
        this.seen.set(env.eventId, { seq: env.seq, hash: hash ?? "", receivedAt: env.receivedAt });
        this.meta.lastSeq = Math.max(this.meta.lastSeq, env.seq);
        this.pushBuffer(env as Delivered);
      }
    }
    const snapFile = join(this.dir, "station-snapshot.json");
    if (existsSync(snapFile)) this.snapshot = JSON.parse(readFileSync(snapFile, "utf8")) as StationSnapshot;
  }

  private pushBuffer(d: Delivered) {
    this.buffer.push(d);
    if (this.buffer.length > this.bufferLimit) this.buffer.splice(0, this.buffer.length - this.bufferLimit);
  }

  saveMeta() {
    atomicWrite(join(this.dir, "session.json"), JSON.stringify(this.meta));
  }

  /** Persist then index an accepted event (the caller has already checked rules and dedup). */
  append(d: Delivered, hash: string): number {
    const line = JSON.stringify({ ...d, hash }) + "\n";
    appendFileSync(join(this.dir, `events-${day(d.receivedAt)}.jsonl`), line);
    this.seen.set(d.eventId, { seq: d.seq, hash, receivedAt: d.receivedAt });
    this.pushBuffer(d);
    return Buffer.byteLength(line);
  }

  after(seq: number, limit = Infinity): Delivered[] {
    const out: Delivered[] = [];
    for (const d of this.buffer) {
      if (d.seq > seq) out.push(d);
      if (out.length >= limit) break;
    }
    return out;
  }

  saveSnapshot(s: StationSnapshot) {
    atomicWrite(join(this.dir, "station-snapshot.json"), JSON.stringify(s));
    this.snapshot = s;
  }

  /** Delete log files older than `days`; returns bytes removed. Dedup entries from removed files are forgotten. */
  prune(cutoffDay: string): number {
    let removed = 0;
    for (const f of readdirSync(this.dir)) {
      const m = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < cutoffDay) {
        removed += statSync(join(this.dir, f)).size;
        rmSync(join(this.dir, f));
      }
    }
    if (removed) this.reindexSeen();
    return removed;
  }

  logFiles() {
    return readdirSync(this.dir)
      .filter((x) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x))
      .map((f) => ({ file: join(this.dir, f), name: f, size: statSync(join(this.dir, f)).size }));
  }

  reindexSeen() {
    const keep = new Set<string>();
    for (const { file } of this.logFiles())
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          keep.add((JSON.parse(line) as Delivered).eventId);
        } catch {
          /* torn line */
        }
      }
    for (const id of [...this.seen.keys()]) if (!keep.has(id)) this.seen.delete(id);
  }
}

export class Store {
  sessions = new Map<string, Session>();
  totalLogBytes = 0;

  readonly dataDir: string;
  private readonly bufferLimit: number;
  private readonly logDays: number;
  private readonly logMaxBytes: number;

  constructor(dataDir: string, bufferLimit: number, logDays: number, logMaxBytes: number) {
    this.dataDir = dataDir;
    this.bufferLimit = bufferLimit;
    this.logDays = logDays;
    this.logMaxBytes = logMaxBytes;
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    for (const id of readdirSync(join(dataDir, "sessions"))) this.open(id);
    this.prune();
  }

  open(id: string): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = new Session(id, join(this.dataDir, "sessions", id), this.bufferLimit);
      s.load();
      this.sessions.set(id, s);
    }
    return s;
  }

  has(id: string) {
    return this.sessions.has(id);
  }

  noteAppended(bytes: number) {
    this.totalLogBytes += bytes;
    if (this.totalLogBytes > this.logMaxBytes) this.prune();
  }

  /** Retention: drop logs older than logDays, then the oldest days until under the size cap (never today's). */
  prune(now = new Date()) {
    const cutoff = new Date(now.getTime() - this.logDays * 86_400_000).toISOString().slice(0, 10);
    for (const s of this.sessions.values()) s.prune(cutoff);
    const today = now.toISOString().slice(0, 10);
    const all = () => [...this.sessions.values()].flatMap((s) => s.logFiles().map((f) => ({ ...f, session: s })));
    let files = all().sort((a, b) => a.name.localeCompare(b.name));
    let total = files.reduce((n, f) => n + f.size, 0);
    while (total > this.logMaxBytes && files.length && !files[0].name.includes(today)) {
      const f = files.shift()!;
      rmSync(f.file);
      total -= f.size;
      f.session.reindexSeen();
    }
    files = all();
    this.totalLogBytes = files.reduce((n, f) => n + f.size, 0);
  }
}
