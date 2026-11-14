// Mock base station for HUD joint testing.
// Implements the SRS v0.1 draft API (see contract/draft-v0.1.md) with zero dependencies.
// It stands in for the shared base until the real contract and service are delivered.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = '0.1-draft';
const CREW = 'A-02';
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'contract/samples/retest-result.sample.json'), 'utf8'));
const REASSESS_MS = Number(process.env.REASSESS_MS || 3500);
// auto patrol monitoring
const WALK_SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'contract/samples/walking-segment.sample.json'), 'utf8'));
const BASELINE = { baselineId: 'BL-WALK-A02-v3', condition: { task: 'EVA patrol', load: 'standard suit', terrain: 'flat regolith' } };
const MIN_SEG_SEC = Number(process.env.MIN_SEG_SEC || 4);            // shorter segments fail the quality check
const SEG_TRIGGER = Number(process.env.SEG_TRIGGER || 3);            // comparable segments needed before a trend call
const REVIEW_MS = Number(process.env.REVIEW_MS || 2500);             // mock medical reviewer approves after this delay
let gen = 0;                                                         // invalidates timers across /mock/reset

let db;
const sockets = new Set();
function reset() {
  db = { cursor: 0, events: [], alerts: {}, retests: {}, receipts: {}, acks: {}, responses: {}, uploads: {}, audit: [], segments: [], pendingReview: null };
  gen++;
}
reset();

const now = () => new Date().toISOString();
const audit = (actor, action, object, result, extra) => db.audit.push({ at: now(), actor, action, object, result, ...extra });

function publish(type, payload) {
  const ev = { schemaVersion: SCHEMA, messageId: 'evt-' + crypto.randomUUID(), type, cursor: ++db.cursor, crewId: CREW, issuedAt: now(), simulated: true, payload: structuredClone(payload) };
  db.events.push(ev);
  for (const s of sockets) wsSend(s, ev);
  return ev;
}
function bumpRetest(id, patch) {
  const r = db.retests[id];
  Object.assign(r, patch, { version: r.version + 1 });
  return publish('retest.requested', r);
}
function bumpAlert(id, patch) {
  const a = db.alerts[id];
  Object.assign(a, patch, { version: a.version + 1, reviewedAt: now() });
  return publish('alert.updated', a);
}

/* ---------------- base-station (mock operator) actions ---------------- */
function approve(by = 'medical-reviewer') {
  if (db.alerts['ALT-001']) return { status: 409, body: { error: 'already-approved' } };
  const used = db.segments.filter(x => x.comparable);
  const dataTime = used.length ? used.at(-1).endedAt : new Date(Date.now() - 4 * 60 * 1000).toISOString();
  db.alerts['ALT-001'] = {
    alertId: 'ALT-001', version: 1, status: 'published', levelLabel: 'Review',
    title: 'Left quadriceps deviates from walking baseline',
    reason: (used.length ? `${used.length} quality-checked walking segments under matching EVA conditions` : 'Recent walking segments')
      + ' show left-quadriceps EMG below your personal walking baseline. Reviewed by base medical staff.',
    nextAction: 'Return to the habitat and complete standardized retest RT-P1 v1.',
    finding: 'Left quadriceps EMG deviates from personal baseline', dataTime, reviewedAt: now(), templateVersion: 'T-03 v1',
    basis: { baselineId: BASELINE.baselineId, condition: BASELINE.condition, segments: used.map(x => x.segmentId) }
  };
  db.retests['RT-001'] = {
    retestId: 'RT-001', alertId: 'ALT-001', round: 1, version: 1, status: 'requested', setting: 'in-habitat',
    protocol: { id: 'RT-P1', version: '1' }, bodySite: 'Left quadriceps', action: 'Slow standing knee bend × 3',
    durationSec: 20, validUntil: new Date(Date.now() + 2 * 3600e3).toISOString()
  };
  db.pendingReview = null;
  audit(by, 'approve', 'ALT-001', 'published');
  publish('alert.updated', db.alerts['ALT-001']);
  publish('retest.requested', db.retests['RT-001']);
  return { status: 200, body: { ok: true } };
}
function closeCase() {
  const a = db.alerts['ALT-001'];
  if (!a || a.status !== 'reassessed') return { status: 409, body: { error: 'not-reassessed' } };
  audit('medical-reviewer', 'close', 'ALT-001', 'closed');
  bumpAlert('ALT-001', { status: 'closed', nextAction: 'No action needed. Case closed by base medical review.' });
  return { status: 200, body: { ok: true } };
}

/* ---------------- crew-facing API ---------------- */
function receipt(messageId, body) {
  const ev = db.events.find(e => e.messageId === messageId);
  if (!ev) return { status: 404, body: { error: 'unknown-message' } };
  if (body.crewId !== CREW) return { status: 403, body: { error: 'forbidden' } };
  const first = db.receipts[messageId];
  if (!first) { db.receipts[messageId] = { receivedAt: body.receivedAt || now(), recordedAt: now(), count: 1 }; audit('hud-device', 'receipt', messageId, 'recorded'); }
  else first.count++;
  return { status: 200, body: { status: 'recorded', messageId, firstRecordedAt: db.receipts[messageId].recordedAt, duplicate: !!first } };
}
function ack(alertId, body) {
  const a = db.alerts[alertId];
  if (!a) return { status: 404, body: { error: 'unknown-alert' } };
  if (!body.requestId || !Number.isInteger(body.alertVersion) || body.alertVersion < 1 || body.alertVersion > a.version)
    return { status: 400, body: { error: 'invalid', current: a } };
  const key = alertId + '@' + body.alertVersion;
  if (!db.acks[key]) { db.acks[key] = { alertId, alertVersion: body.alertVersion, ackedAt: now(), by: 'crew:' + CREW, requestId: body.requestId, count: 1 }; audit('crew', 'ack', key, 'acknowledged'); }
  else db.acks[key].count++;
  const r = db.acks[key];
  return { status: 200, body: { status: 'acknowledged', alertId, alertVersion: r.alertVersion, ackedAt: r.ackedAt } };
}
const ALLOWED = { accept: ['requested', 'deferred', 'aborted'], defer: ['requested', 'accepted'], abort: ['accepted'] };
function respond(retestId, body) {
  const r = db.retests[retestId];
  if (!r) return { status: 404, body: { error: 'unknown-retest' } };
  if (body.requestId && db.responses[body.requestId]) return db.responses[body.requestId];   // idempotent replay
  let res;
  if (!ALLOWED[body.action]) res = { status: 400, body: { error: 'invalid-action', current: r } };
  else if (body.round !== r.round) res = { status: 409, body: { error: 'round-mismatch', current: r } };
  else if (!ALLOWED[body.action].includes(r.status)) res = { status: 409, body: { error: 'state-conflict', current: r } };
  else if (body.action === 'defer' && !(body.reason || '').trim()) res = { status: 400, body: { error: 'reason-required', current: r } };
  else {
    const patch = body.action === 'accept' ? { status: 'accepted' }
      : body.action === 'defer' ? { status: 'deferred', deferReason: body.reason.trim() }
      : { status: 'aborted', abortReason: (body.reason || 'Aborted by astronaut').trim() };
    bumpRetest(retestId, patch);
    audit('crew', body.action, retestId + '#' + r.round, r.status, { reason: body.reason || null });
    res = { status: 200, body: { status: 'ok', retest: structuredClone(r) } };
  }
  if (body.requestId) db.responses[body.requestId] = res;
  return res;
}
function segment(msg) {                    // auto patrol monitoring: one walking segment from the local device
  const p = msg.payload;
  const units = Object.fromEntries(WALK_SAMPLE.metrics.map(m => [m.name, m.unit]));
  let error = null;
  if (p.simulated !== true) error = 'simulated-flag-required';
  else if (typeof p.segmentId !== 'string' || typeof p.durationSec !== 'number' || !p.condition) error = 'invalid-segment';
  else if (p.sampleId !== WALK_SAMPLE.sampleId) error = 'unknown-sample';
  else if (!Array.isArray(p.metrics) || p.metrics.some(m => units[m.name] !== m.unit)) error = 'unit-mismatch';
  const quality = error ? null : p.durationSec >= MIN_SEG_SEC ? 'valid' : 'too-short';
  const c = BASELINE.condition, comparable = quality === 'valid' && p.condition.task === c.task && p.condition.load === c.load && p.condition.terrain === c.terrain;
  const ack = { schemaVersion: SCHEMA, type: 'telemetry.ack', ackFor: msg.messageId, kind: 'walking-segment', segmentId: p.segmentId,
    status: error ? 'rejected' : 'persisted', error, quality, comparable, receivedAt: now() };
  db.uploads[msg.messageId] = { ack, payload: p };
  if (!error) {
    db.segments.push({ segmentId: p.segmentId, startedAt: p.startedAt, endedAt: p.endedAt, durationSec: p.durationSec, quality, comparable, receivedAt: ack.receivedAt });
    audit('analysis', 'segment', p.segmentId, quality + (comparable ? ' · comparable' : ' · not used'));
    const n = db.segments.filter(x => x.comparable).length;
    if (n >= SEG_TRIGGER && !db.alerts['ALT-001'] && !db.pendingReview) {
      db.pendingReview = { createdAt: now(), segments: n };
      audit('analysis', 'deviation-detected', 'left quadriceps', 'pending medical review', { segments: n, baseline: BASELINE.baselineId });
      const g = gen; setTimeout(() => { if (g === gen && db.pendingReview) approve('medical-reviewer (mock auto)'); }, REVIEW_MS);
    }
  } else audit('hud-device', 'segment', p.segmentId || '?', 'rejected', { error });
  return ack;
}
function upload(msg) {
  const p = msg.payload || {};
  if (db.uploads[msg.messageId]) return db.uploads[msg.messageId].ack;          // duplicate upload -> same ack
  if (p.kind === 'walking-segment') return segment(msg);
  const r = db.retests[p.retestId];
  const units = Object.fromEntries(SAMPLE.metrics.map(m => [m.name, m.unit]));
  let error = null;
  if (!r) error = 'unknown-retest';
  else if (p.alertId !== r.alertId) error = 'case-mismatch';
  else if (p.round !== r.round) error = 'round-mismatch';
  else if (r.status !== 'accepted') error = 'state-conflict:' + r.status;
  else if (p.simulated !== true) error = 'simulated-flag-required';
  else if (p.sampleId !== SAMPLE.sampleId) error = 'unknown-sample';
  else if (!Array.isArray(p.metrics) || p.metrics.some(m => units[m.name] !== m.unit)) error = 'unit-mismatch';
  const ack = { schemaVersion: SCHEMA, type: 'telemetry.ack', ackFor: msg.messageId, status: error ? 'rejected' : 'persisted', error, receivedAt: now(), retestId: p.retestId, round: p.round };
  db.uploads[msg.messageId] = { ack, payload: p };
  audit('hud-device', 'retest-result', (p.retestId || '?') + '#' + p.round, ack.status, { error });
  if (!error) {
    const sessionId = p.sessionId;
    bumpRetest(p.retestId, { status: 'received', resultSessionId: sessionId });
    const g = gen;
    setTimeout(() => {
      if (g !== gen) return;
      bumpRetest(p.retestId, { status: 'reassessing' });
      setTimeout(() => {
        if (g !== gen) return;
        bumpAlert(r.alertId, {
          status: 'reassessed', title: 'Retest shift reduced · attention maintained',
          reason: `Retest result linked to ${r.alertId} round ${r.round} (${r.retestId}); shift is smaller than the previous capture.`,
          nextAction: 'No action needed. Base medical reviewers will decide whether to close.',
          finding: 'Retest shift reduced · pending medical review', disposition: 'Attention maintained; pending review to close',
          basedOn: { retestId: r.retestId, round: r.round, resultSessionId: sessionId }
        });
        bumpRetest(p.retestId, { status: 'completed' });
      }, REASSESS_MS);
    }, 800);
  }
  return ack;
}

/* ---------------- minimal WebSocket server (RFC 6455, text frames) ---------------- */
function wsSend(sock, obj) {
  if (sock.destroyed) return;
  const data = Buffer.from(JSON.stringify(obj));
  let head;
  if (data.length < 126) head = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  sock.write(Buffer.concat([head, data]));
}
function onUpgrade(req, sock) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/v1/stream' || url.searchParams.get('crewId') !== CREW) { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sockets.add(sock);
  const after = Number(url.searchParams.get('after') || 0);
  for (const ev of db.events) if (ev.cursor > after) wsSend(sock, ev);   // catch-up from acknowledged cursor
  let buf = Buffer.alloc(0);
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 0x0f, masked = buf[1] & 0x80; let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len; if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const m = buf.subarray(off, off + 4); payload = Buffer.from(payload.map((b, i) => b ^ m[i % 4])); }
      buf = buf.subarray(need);
      if (op === 8) { sock.end(Buffer.from([0x88, 0])); sockets.delete(sock); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op !== 1) continue;
      let msg; try { msg = JSON.parse(payload.toString()); } catch { continue; }
      if (msg.type === 'telemetry.window' && msg.messageId) wsSend(sock, upload(msg));
    }
  });
  const drop = () => sockets.delete(sock);
  sock.on('close', drop); sock.on('error', drop);
}

/* ---------------- HTTP ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };   // lets a double-clicked hud.html (file://) reach the base
function send(res, { status, body }) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS }); res.end(JSON.stringify(body)); }
async function readJson(req) { let s = ''; for await (const c of req) s += c; try { return s ? JSON.parse(s) : {}; } catch { return null; } }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname; let m;
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  try {
    if (req.method === 'GET' && p === '/v1/events') {
      if (url.searchParams.get('crewId') !== CREW) return send(res, { status: 403, body: { error: 'forbidden' } });
      const after = Number(url.searchParams.get('after') || 0);
      return send(res, { status: 200, body: { events: db.events.filter(e => e.cursor > after), cursor: db.cursor } });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body === null) return send(res, { status: 400, body: { error: 'bad-json' } });
      if ((m = p.match(/^\/v1\/deliveries\/([^/]+)\/receipt$/))) return send(res, receipt(decodeURIComponent(m[1]), body));
      if ((m = p.match(/^\/v1\/alerts\/([^/]+)\/ack$/))) return send(res, ack(decodeURIComponent(m[1]), body));
      if ((m = p.match(/^\/v1\/retests\/([^/]+)\/responses$/))) return send(res, respond(decodeURIComponent(m[1]), body));
      if (p === '/mock/approve') return send(res, approve());
      if (p === '/mock/close') return send(res, closeCase());
      if (p === '/mock/duplicate') { const ev = db.events.at(-1); if (ev) for (const s of sockets) wsSend(s, ev); return send(res, { status: 200, body: { resent: ev?.messageId || null } }); }
      if (p === '/mock/drop') { const n = sockets.size; for (const s of sockets) s.destroy(); sockets.clear(); return send(res, { status: 200, body: { dropped: n } }); }
      if (p === '/mock/reset') { reset(); for (const s of sockets) s.destroy(); sockets.clear(); return send(res, { status: 200, body: { ok: true } }); }
      return send(res, { status: 404, body: { error: 'not-found' } });
    }
    if (p === '/mock/state') return send(res, { status: 200, body: { ...db, sockets: sockets.size } });
    // static files
    let file = p === '/' ? '/hud.html' : p === '/mock' ? '/server/console.html' : decodeURIComponent(p);
    const fp = path.join(ROOT, path.normalize(file));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res, { status: 404, body: { error: 'not-found' } });
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store', ...CORS });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { send(res, { status: 500, body: { error: String(e) } }); }
});
server.on('upgrade', onUpgrade);

export function start(port = Number(process.env.PORT || 8787)) {
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().then(s => {
    const { port } = s.address();
    console.log(`MyoMars mock base (SRS v0.1 draft) on http://127.0.0.1:${port}`);
    console.log(`  HUD:      http://127.0.0.1:${port}/hud.html`);
    console.log(`  Base console: http://127.0.0.1:${port}/mock`);
  });
}
