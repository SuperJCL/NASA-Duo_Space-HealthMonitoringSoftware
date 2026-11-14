// Mock relay + mock Mars Station for HUD integration on MyoMars shared message contracts v1.
//
// The contracts (contracts-v1/, vendored from repo main) define messages only; the real relay
// ("HTTP publish plus Server-Sent Events") is not published yet. This mock implements that intent:
//   POST /v1/sessions/:sessionId/events        publish one envelope (headers x-myomars-role, x-myomars-client)
//   GET  /v1/sessions/:sessionId/events?after=n history of delivered envelopes (+ seq, receivedAt, sender)
//   GET  /v1/sessions/:sessionId/stream?after=n Server-Sent Events, id = seq (Last-Event-ID supported)
// Every publish is checked against the contract JSON Schemas and event-rules.json (role, caseId, retestId).
// The mock station reacts only to delivered messages and publishes station.* through the same relay.
// Zero dependencies. All data is SIMULATED.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import(pathToFileURL(path.join(ROOT, 'hud/contract-v1.js')).href);
const C = globalThis.MyoMarsContract;
const SD = path.join(ROOT, 'contracts-v1/schema');
const J = f => JSON.parse(fs.readFileSync(path.join(SD, f), 'utf8'));
const RULES = J('event-rules.json');
export const CONTRACT = { envelope: J('envelope.schema.json'), delivered: J('delivered.schema.json'), rules: RULES,
  payloads: Object.fromEntries(Object.entries(RULES).map(([t, r]) => [t, J(r.payloadSchema)])) };

const REASSESS_MS = Number(process.env.REASSESS_MS || 3500);
const REVIEW_MS = Number(process.env.REVIEW_MS || 2500);      // mock medical reviewer approves after this delay
const SEG_TRIGGER = Number(process.env.SEG_TRIGGER || 3);      // comparable walking observations before a trend call
const MIN_SEG_S = Number(process.env.MIN_SEG_SEC || 4);        // quality rule (demo only, not a clinical threshold)
const BASELINE = { baselineId: 'bl-walk-a02-v3', protocolId: 'walk-auto-v1', taskId: 'eva-patrol', glove: 'eva-glove' };
const RETEST_PROTOCOL = { id: 'std-knee-bend-3', label: 'Left quadriceps · slow standing knee bend × 3', targetPctMvc: 30, posture: 'standing', glove: 'none' };
const REVIEWER = 'Base medical reviewer (mock)';

/* ======================= relay ======================= */
const sessions = new Map();
let gen = 0;
function sess(id) {
  if (!sessions.has(id)) sessions.set(id, { seq: 0, events: [], byId: new Map(), activeRun: null, ended: new Set(), clients: new Set(), station: newStation() });
  return sessions.get(id);
}
const now = () => new Date().toISOString();

function publish(sessionId, msg, role, clientId) {
  const s = sess(sessionId);
  if (!['trigger', 'hud', 'station'].includes(role)) return { status: 403, body: { error: 'unknown-role' } };
  if (msg && msg.sessionId !== sessionId) return { status: 400, body: { error: 'session-mismatch' } };
  const errs = C.checkMessage(CONTRACT, msg, { role });
  if (errs.length) return { status: 400, body: { error: 'invalid', details: errs.slice(0, 8) } };
  const prev = s.byId.get(msg.eventId);
  if (prev) return prev.canon === C.canonical(msg)
    ? { status: 200, body: { seq: prev.seq, receivedAt: prev.receivedAt, duplicate: true } }
    : { status: 409, body: { error: 'eventId-conflict', detail: 'same eventId with different content' } };
  if (s.ended.has(msg.runId)) return { status: 409, body: { error: 'stale-run' } };
  if (msg.type === 'scenario.start') { if (s.activeRun && s.activeRun !== msg.runId) s.ended.add(s.activeRun); s.activeRun = msg.runId; }
  else if (msg.runId !== s.activeRun) return { status: 409, body: { error: 'unknown-run' } };
  const d = { ...msg, seq: ++s.seq, receivedAt: now(), sender: { role, clientId: clientId || role } };
  s.events.push(d); s.byId.set(msg.eventId, { canon: C.canonical(msg), seq: d.seq, receivedAt: d.receivedAt });
  if (msg.type === 'scenario.reset') { s.ended.add(msg.runId); s.activeRun = null; }
  for (const c of s.clients) sseSend(c, d);
  setImmediate(() => stationOnEvent(sessionId, d));
  return { status: 200, body: { seq: d.seq, receivedAt: d.receivedAt, duplicate: false } };
}
function sseSend(res, d) { res.write('id: ' + d.seq + '\ndata: ' + JSON.stringify(d) + '\n\n'); }

/* ======================= mock station ======================= */
function newStation() { return { cases: {}, audit: [] }; }
function stationCase(s, caseId) {
  return s.station.cases[caseId] || (s.station.cases[caseId] = { caseId, observations: [], pending: null, notice: null, request: null, results: new Set(), version: 0, status: 'monitoring' });
}
function audit(s, actor, action, object, result, extra) { s.station.audit.push({ at: now(), actor, action, object, result, ...extra }); }
function stationPublish(sessionId, base, type, payload, extra = {}) {
  const msg = { schema: C.SCHEMA, eventId: 'stn-' + crypto.randomUUID(), sessionId, runId: base.runId, caseId: base.caseId,
    sentAt: now(), source: 'station', type, payload, ...extra };
  const r = publish(sessionId, msg, 'station', 'mock-station');
  if (r.status !== 200) console.error('station publish failed', type, r.body);
  return msg;
}
function quality(sig) {
  if (sig.durationS < MIN_SEG_S) return 'too-short';
  if (sig.dropoutPct > 5 || sig.electrodeImpedanceKOhm > 40 || sig.saturationPct > 2) return 'poor-signal';
  return 'valid';
}
function stationOnEvent(sessionId, d) {
  const s = sess(sessionId), g = gen;
  if (d.sender.role === 'station') return;
  if (d.type === 'scenario.reset') { s.station = newStation(); return; }
  if (d.type === 'observation.submitted') {
    const c = stationCase(s, d.caseId), o = d.payload;
    const q = quality(o.signal);
    const comparable = q === 'valid' && o.protocol.id === BASELINE.protocolId && o.context.taskId === BASELINE.taskId
      && o.protocol.glove === BASELINE.glove && o.context.phase === 'eva';
    c.observations.push({ observationId: o.observationId, capturedAt: o.capturedAt, durationS: o.signal.durationS, quality: q, comparable, seq: d.seq });
    audit(s, 'analysis', 'observation', o.observationId, q + (comparable ? ' · comparable' : ' · not used'));
    const n = c.observations.filter(x => x.comparable).length;
    if (n >= SEG_TRIGGER && !c.notice && !c.pending) {
      c.pending = { since: now(), n };
      audit(s, 'analysis', 'deviation-candidate', d.caseId, 'pending human review', { comparable: n, baseline: BASELINE.baselineId });
      setTimeout(() => { if (g === gen && c.pending) approveCase(sessionId, d.caseId, REVIEWER + ' (auto)'); }, REVIEW_MS);
    }
    return;
  }
  if (d.type === 'retest.result') {
    const c = s.station.cases[d.caseId], o = d.payload.observation;
    let status = 'accepted', reason = null;
    if (!c || !c.request || c.request.retestId !== d.retestId) { status = 'rejected'; reason = 'no open retest request for this retestId'; }
    else if (o.protocol.id !== c.request.protocol.id) { status = 'rejected'; reason = 'protocol does not match the requested retest'; }
    else if (o.context.phase !== 'retest') { status = 'rejected'; reason = 'context.phase must be retest'; }
    else if (c.results.has(o.observationId)) { status = 'duplicate'; reason = 'observation already received'; }
    const base = { runId: d.runId, caseId: d.caseId };
    stationPublish(sessionId, base, 'station.receipt', { receivedEventId: d.eventId, receivedType: 'retest.result', status, reason });
    audit(s, 'station', 'receipt', d.retestId, status, reason ? { reason } : undefined);
    if (status === 'accepted') {
      c.results.add(o.observationId);
      setTimeout(() => {
        if (g !== gen) return;
        c.version = Math.max(c.version, 1) + 1; c.status = 'under-watch';
        audit(s, REVIEWER, 'reassessment', d.caseId, 'keep-watch', { version: c.version });
        stationPublish(sessionId, base, 'station.reassessment', { evaluationVersion: c.version, outcome: 'shift-reduced',
          summary: 'Retest shift is smaller than in the walking segments; keep under watch.', reviewDecision: 'keep-watch', caseStatus: 'under-watch', simulated: true });
      }, REASSESS_MS);
    }
    return;
  }
  if (d.type === 'hud.ack' || d.type === 'hud.defer' || d.type === 'hud.received')
    audit(s, 'hud', d.type, d.payload.messageId, d.type === 'hud.defer' ? 'deferred' : 'recorded', d.type === 'hud.defer' ? { reason: d.payload.reason } : undefined);
}
function approveCase(sessionId, caseId, by = REVIEWER) {
  const s = sess(sessionId);
  const c = caseId ? s.station.cases[caseId] : Object.values(s.station.cases).at(-1);
  if (!c) return { status: 409, body: { error: 'no-case', detail: 'no observations received yet' } };
  if (c.notice) return { status: 409, body: { error: 'already-approved' } };
  if (!s.activeRun) return { status: 409, body: { error: 'no-active-run' } };
  const used = c.observations.filter(x => x.comparable);
  const base = { runId: s.activeRun, caseId: c.caseId };
  c.pending = null; c.version = 1; c.status = 'retest-requested';
  audit(s, by, 'approve', c.caseId, 'notice + retest published', { comparable: used.length });
  c.notice = stationPublish(sessionId, base, 'station.notice.approved', {
    noticeId: c.caseId + '-n1',
    text: 'Base notice: left-quadriceps EMG during walking differs from your personal walking baseline. Return to the habitat and complete one standard retest; report any discomfort.',
    basis: [used.length + ' walking segments passed the demo quality rules under matching EVA patrol conditions.', 'Compared with personal walking baseline ' + BASELINE.baselineId + '.'],
    evaluationVersion: 1, reviewedBy: by, reviewReason: 'Consistent left-quadriceps deviation across comparable walking segments; schedule a standard retest.', simulated: true
  }, used.length ? { occurredAt: used.at(-1).capturedAt } : {});
  c.request = { retestId: c.caseId + '-rt1', protocol: RETEST_PROTOCOL };
  stationPublish(sessionId, base, 'station.retest.requested', { retestId: c.request.retestId, protocol: RETEST_PROTOCOL,
    instructions: 'Return to the habitat, rest 2 minutes, then perform the standard knee-bend retest once.', evaluationVersion: 1, reviewedBy: by, simulated: true },
    { retestId: c.request.retestId });
  return { status: 200, body: { ok: true, caseId: c.caseId } };
}
function closeCase(sessionId) {
  const s = sess(sessionId), c = Object.values(s.station.cases).find(x => x.status === 'under-watch');
  if (!c) return { status: 409, body: { error: 'nothing-to-close', detail: 'needs a reassessed case under watch' } };
  c.version += 1; c.status = 'closed';
  audit(s, REVIEWER, 'close', c.caseId, 'closed', { version: c.version });
  stationPublish(sessionId, { runId: s.activeRun, caseId: c.caseId }, 'station.reassessment', { evaluationVersion: c.version, outcome: 'within-baseline',
    summary: 'Reviewed after retest: within personal baseline. Case closed.', reviewDecision: 'close', caseStatus: 'closed', simulated: true });
  return { status: 200, body: { ok: true } };
}

/* ======================= HTTP ======================= */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-myomars-role, x-myomars-client, last-event-id' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css' };
function send(res, { status, body }) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS }); res.end(JSON.stringify(body)); }
async function readJson(req) { let t = ''; for await (const c of req) t += c; try { return t ? JSON.parse(t) : {}; } catch { return null; } }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname; let m;
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  try {
    if ((m = p.match(/^\/v1\/sessions\/([a-z0-9-]{1,40})\/(events|stream)$/))) {
      const sid = m[1], s = sess(sid);
      if (m[2] === 'events' && req.method === 'POST') {
        const body = await readJson(req);
        if (body === null) return send(res, { status: 400, body: { error: 'bad-json' } });
        return send(res, publish(sid, body, req.headers['x-myomars-role'], req.headers['x-myomars-client']));
      }
      const after = Number(url.searchParams.get('after') || req.headers['last-event-id'] || 0);
      if (m[2] === 'events') return send(res, { status: 200, body: { events: s.events.filter(e => e.seq > after), lastSeq: s.seq } });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...CORS });
      res.write(': myomars mock relay\n\n');
      for (const e of s.events) if (e.seq > after) sseSend(res, e);
      s.clients.add(res);
      const hb = setInterval(() => res.write(': hb\n\n'), 15000);
      req.on('close', () => { clearInterval(hb); s.clients.delete(res); });
      return;
    }
    const sid = url.searchParams.get('session') || 'demo';
    if (req.method === 'POST' && p.startsWith('/mock/')) {
      const s = sess(sid);
      if (p === '/mock/approve') return send(res, approveCase(sid));
      if (p === '/mock/close') return send(res, closeCase(sid));
      if (p === '/mock/duplicate') { const e = s.events.filter(x => x.source === 'station').at(-1); if (e) for (const c of s.clients) sseSend(c, e); return send(res, { status: 200, body: { resent: e?.eventId || null } }); }
      if (p === '/mock/drop') { const n = s.clients.size; for (const c of s.clients) c.destroy(); s.clients.clear(); return send(res, { status: 200, body: { dropped: n } }); }
      if (p === '/mock/start' || p === '/mock/reset-run') {       // console acting as the Trigger
        const type = p === '/mock/start' ? 'scenario.start' : 'scenario.reset';
        if (type === 'scenario.reset' && !s.activeRun) return send(res, { status: 409, body: { error: 'no-active-run' } });
        const runId = type === 'scenario.start' ? 'run-' + Date.now().toString(36) : s.activeRun;
        const payload = type === 'scenario.start' ? { scenarioId: 'myomars-patrol', astronaut: { id: 'a-02', callsign: 'A-02' }, task: { id: 'eva-patrol', title: 'EVA patrol', targetId: null } } : {};
        return send(res, publish(sid, { schema: C.SCHEMA, eventId: 'trg-' + crypto.randomUUID(), sessionId: sid, runId, caseId: null, sentAt: now(), source: 'trigger', type, payload }, 'trigger', 'mock-console'));
      }
      if (p === '/mock/reset') { for (const c of s.clients) c.destroy(); sessions.delete(sid); gen++; return send(res, { status: 200, body: { ok: true } }); }
      return send(res, { status: 404, body: { error: 'not-found' } });
    }
    if (p === '/mock/state') {
      const s = sess(sid);
      return send(res, { status: 200, body: { sessionId: sid, lastSeq: s.seq, activeRun: s.activeRun, endedRuns: [...s.ended], clients: s.clients.size, events: s.events,
        cases: Object.values(s.station.cases).map(c => ({ ...c, results: [...c.results], notice: c.notice ? c.notice.eventId : null })), audit: s.station.audit } });
    }
    const file = p === '/' ? '/hud.html' : p === '/mock' ? '/server/console.html' : decodeURIComponent(p);
    const fp = path.join(ROOT, path.normalize(file));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res, { status: 404, body: { error: 'not-found' } });
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store', ...CORS });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { send(res, { status: 500, body: { error: String(e) } }); }
});

export function start(port = Number(process.env.PORT || 8787)) {
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}
export function stop() { for (const s of sessions.values()) for (const c of s.clients) c.destroy(); return new Promise(r => { server.close(() => r()); server.closeAllConnections?.(); }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().then(s => {
    const { port } = s.address();
    console.log(`MyoMars mock relay + station (contracts myomars/v1) on http://127.0.0.1:${port}`);
    console.log(`  HUD:          http://127.0.0.1:${port}/hud.html`);
    console.log(`  Base console: http://127.0.0.1:${port}/mock`);
  });
}
