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
// Proposed extensions (contract/extensions/*.json): additive event types validated exactly like core ones.
for (const f of fs.readdirSync(path.join(ROOT, 'contract/extensions')).filter(x => x.endsWith('.json'))) {
  const x = JSON.parse(fs.readFileSync(path.join(ROOT, 'contract/extensions', f), 'utf8'));
  for (const sc of [CONTRACT.envelope, CONTRACT.delivered]) sc.properties.type.enum = [...sc.properties.type.enum, x.type];
  CONTRACT.rules[x.type] = { ...x.rule, payloadSchema: 'contract/extensions/' + f };
  CONTRACT.payloads[x.type] = x.payloadSchema;
}

const REASSESS_MS = Number(process.env.REASSESS_MS || 1200);   // demo pacing
const REVIEW_MS = Number(process.env.REVIEW_MS || 800);       // mock medical reviewer approves after this delay (demo pacing)
const SEG_TRIGGER = Number(process.env.SEG_TRIGGER || 3);      // comparable walking observations before a trend call
const MIN_SEG_S = Number(process.env.MIN_SEG_SEC || 2.5);      // quality rule (demo only, not a clinical threshold)
const BASELINE = { baselineId: 'bl-walk-a02-v3', protocolId: 'walk-auto-v1', taskId: 'eva-patrol', glove: 'eva-glove', medianFreqHz: 84, rmsPctMvc: 15 };
const SENSOR_TRIGGER = Number(process.env.SENSOR_TRIGGER || 2);   // consecutive corrupted segments before a sensor-fault notice
const VERIFY_NEEDED = 2;                                          // valid segments after reconnection to verify the patch
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
    const pattern = comparable ? classify(o.features) : null;           // physiological reading only on valid, comparable data
    c.observations.push({ observationId: o.observationId, capturedAt: o.capturedAt, durationS: o.signal.durationS, quality: q, comparable, pattern, seq: d.seq });
    audit(s, 'analysis', 'observation', o.observationId, q + (comparable ? ' · comparable · ' + pattern : ' · not used'));
    if (c.done || c.pending) return;
    const obs = c.observations, recent = n => obs.slice(-n);
    // Scenario 3 — sensor malfunction: corrupted signal → technical notice, never a muscle finding
    if (!c.sensor && obs.length >= SENSOR_TRIGGER && recent(SENSOR_TRIGGER).every(x => x.quality === 'poor-signal')) return queueReview(sessionId, s, c, 'sensor', g);
    if (c.sensor && !c.sensor.closed) {
      const after = obs.filter(x => x.seq > c.sensor.seq && x.quality === 'valid');
      if (after.length >= VERIFY_NEEDED) closeSensor(sessionId, s, c);
      return;
    }
    if (c.notice) return;
    const comp = obs.filter(x => x.comparable);
    if (comp.length < SEG_TRIGGER) return;
    const last = comp.slice(-SEG_TRIGGER);
    if (last.every(x => x.pattern === 'fatigue-pattern')) return queueReview(sessionId, s, c, 'fatigue', g);     // Scenario 2
    if (last.every(x => x.pattern === 'within-baseline') && !c.ok) return queueReview(sessionId, s, c, 'ok', g);   // Scenario 1
    return;
  }
  if (d.type === 'retest.result') {
    const c = s.station.cases[d.caseId], o = d.payload.observation;
    let status = 'accepted', reason = null;
    if (!c || !c.request || c.request.retestId !== d.retestId) { status = 'rejected'; reason = 'no open retest request for this retestId'; }
    else if (c.medical && c.medical.pending) { status = 'rejected'; reason = 'medical review pending: retest not permitted yet'; }
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
  if (d.type === 'hud.symptoms') {                       // proposed extension: symptom assessment after a fatigue notice
    const c = s.station.cases[d.caseId], p = d.payload, base = { runId: d.runId, caseId: d.caseId };
    let status = 'accepted', reason = null;
    const coherent = p.noneReported ? p.symptoms.length === 0 : p.symptoms.length > 0 && new Set(p.symptoms).size === p.symptoms.length;
    if (!c || !c.notice || p.messageId !== c.notice.eventId) { status = 'rejected'; reason = 'no open fatigue notice for this messageId'; }
    else if (!coherent) { status = 'rejected'; reason = 'select symptoms or "none of the above", not both'; }
    else if (c.symptoms) { status = 'duplicate'; reason = 'assessment already received'; }
    if (status === 'accepted') {
      c.symptoms = { symptoms: p.symptoms, none: p.noneReported, eventId: d.eventId };
      if (!p.noneReported) {
        // DEMO RULE (deterministic, not a clinical threshold): any reported symptom → crew medical review before a retest
        c.medical = { pending: true };
        audit(s, 'routing', 'medical-review', d.caseId, 'required (demo rule)', { symptoms: p.symptoms.join(', ') });
        c.medical.notice = stationPublish(sessionId, base, 'station.notice.approved', {
          noticeId: d.caseId + '-mr1',
          text: 'Symptoms reported. Await instructions from the crew medical team before starting a muscle retest.',
          basis: ['Reported: ' + p.symptoms.join(', ') + '.', 'Demo rule: any reported symptom routes the case to crew medical review (not a clinical threshold).'],
          evaluationVersion: 1, reviewedBy: 'Base duty officer (mock)', reviewReason: 'Medical review required before any muscle retest.', simulated: true
        });
        reason = 'medical review required (demo rule: any reported symptom)';
      } else reason = 'no symptoms reported; retest may proceed when the base permits';
    }
    stationPublish(sessionId, base, 'station.receipt', { receivedEventId: d.eventId, receivedType: 'hud.symptoms', status, reason });
    audit(s, 'station', 'symptoms', d.caseId, status, reason ? { reason } : undefined);
    return;
  }
  if (d.type === 'hud.ack' || d.type === 'hud.defer' || d.type === 'hud.received')
    audit(s, 'hud', d.type, d.payload.messageId, d.type === 'hud.defer' ? 'deferred' : 'recorded', d.type === 'hud.defer' ? { reason: d.payload.reason } : undefined);
}
function classify(f) {
  if (!f || f.medianFreqHz == null || f.rmsPctMvc == null) return 'unknown';
  return f.medianFreqHz < BASELINE.medianFreqHz * 0.92 && f.rmsPctMvc > BASELINE.rmsPctMvc * 1.1 ? 'fatigue-pattern' : 'within-baseline';
}
function queueReview(sessionId, s, c, kind, g) {
  c.pending = { kind, since: now() };
  audit(s, 'analysis', kind === 'sensor' ? 'sensor-fault-candidate' : kind === 'fatigue' ? 'deviation-candidate' : 'within-baseline-candidate', c.caseId, 'pending human review', { baseline: BASELINE.baselineId });
  setTimeout(() => { if (g === gen && c.pending) approveCase(sessionId, c.caseId, REVIEWER + ' (auto)'); }, REVIEW_MS);
}
// Notice kinds are told apart by noticeId suffix (-n = health review, -ok = within baseline, -sensor = sensor fault):
// contracts v1 notices have no category field (gap V1-11).
function approveCase(sessionId, caseId, by = REVIEWER) {
  const s = sess(sessionId);
  const c = caseId ? s.station.cases[caseId] : Object.values(s.station.cases).at(-1);
  if (!c) return { status: 409, body: { error: 'no-case', detail: 'no observations received yet' } };
  if (!s.activeRun) return { status: 409, body: { error: 'no-active-run' } };
  const kind = c.pending ? c.pending.kind : 'fatigue';
  if ((kind === 'fatigue' && c.notice) || (kind === 'ok' && c.ok) || (kind === 'sensor' && c.sensor))
    return { status: 409, body: { error: 'already-approved', hint: c.medical && c.medical.pending
      ? 'Medical review is pending: use "Crew medical: clear retest" instead.'
      : 'The station already published this notice; nothing to approve.' } };
  const used = c.observations.filter(x => x.comparable), base = { runId: s.activeRun, caseId: c.caseId };
  const lastObs = c.observations.at(-1);
  const occ = lastObs ? { occurredAt: lastObs.capturedAt } : {};
  c.pending = null;
  if (kind === 'sensor') {
    const bad = c.observations.filter(x => x.quality === 'poor-signal').length;
    audit(s, by, 'approve', c.caseId, 'sensor-fault notice published', { corrupted: bad });
    const m = stationPublish(sessionId, base, 'station.notice.approved', {
      noticeId: c.caseId + '-sensor1',
      text: 'Base notice: the patch signal is corrupted (high electrode impedance, dropouts, saturation). This is a sensor issue, not a muscle finding. Reconnect the patch and verify the signal.',
      basis: [bad + ' consecutive segments failed the signal-quality rules; they were not used for any muscle assessment.'],
      evaluationVersion: 1, reviewedBy: by, reviewReason: 'Sensor fault: signal quality failed in consecutive segments; reconnect and verify. No physiological assessment made.', simulated: true
    }, occ);
    c.sensor = { seq: s.seq, eventId: m.eventId, closed: false }; c.version = 1; c.status = 'sensor-fault';
    return { status: 200, body: { ok: true, kind } };
  }
  if (kind === 'ok') {
    audit(s, by, 'approve', c.caseId, 'within-baseline notice published', { comparable: used.length });
    stationPublish(sessionId, base, 'station.notice.approved', {
      noticeId: c.caseId + '-ok1',
      text: 'Base check: left-quadriceps walking signals are within your personal baseline. Continue the patrol.',
      basis: [used.length + ' walking segments passed the demo quality rules under matching EVA patrol conditions.', 'Compared with personal walking baseline ' + BASELINE.baselineId + '.'],
      evaluationVersion: 1, reviewedBy: by, reviewReason: 'Within personal baseline; continue the patrol.', simulated: true
    }, occ);
    c.ok = true; c.version = 1; c.status = 'normal';
    return { status: 200, body: { ok: true, kind } };
  }
  c.version = 1; c.status = 'retest-requested';
  audit(s, by, 'approve', c.caseId, 'fatigue notice + retest published', { comparable: used.length });
  c.notice = stationPublish(sessionId, base, 'station.notice.approved', {
    noticeId: c.caseId + '-n1',
    text: 'Base notice: left-quadriceps EMG during walking shows a fatigue pattern (lower median frequency, higher activation) against your personal walking baseline. Rest, then complete one standard retest; report any discomfort.',
    basis: [used.length + ' walking segments passed the demo quality rules under matching EVA patrol conditions.', 'Compared with personal walking baseline ' + BASELINE.baselineId + '.'],
    evaluationVersion: 1, reviewedBy: by, reviewReason: 'Muscle fatigue suspected across comparable walking segments; rest and retest.', simulated: true
  }, occ);
  c.request = { retestId: c.caseId + '-rt1', protocol: RETEST_PROTOCOL };
  stationPublish(sessionId, base, 'station.retest.requested', { retestId: c.request.retestId, protocol: RETEST_PROTOCOL,
    instructions: 'Rest for 10 minutes, then perform the standard knee-bend retest once.', evaluationVersion: 1, reviewedBy: by, simulated: true },
    { retestId: c.request.retestId });
  return { status: 200, body: { ok: true, caseId: c.caseId, kind } };
}
function closeSensor(sessionId, s, c) {
  c.sensor.closed = true; c.version = 2; c.status = 'closed'; c.done = true;
  audit(s, REVIEWER, 'reassessment', c.caseId, 'sensor verified · closed');
  stationPublish(sessionId, { runId: s.activeRun, caseId: c.caseId }, 'station.reassessment', { evaluationVersion: 2, outcome: 'signal-restored',
    summary: 'Patch reconnected and signal verified. No muscle finding was made from the faulty data.', reviewDecision: 'close', caseStatus: 'closed', simulated: true });
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
      if (p === '/mock/medical-clear') {                       // crew medical team (human) clears the retest
        const c = Object.values(s.station.cases).find(x => x.medical && x.medical.pending);
        if (!c) return send(res, { status: 409, body: { error: 'no-medical-review-pending' } });
        c.medical.pending = false; audit(s, 'crew medical team (mock)', 'medical-clear', c.caseId, 'retest permitted');
        stationPublish(sid, { runId: s.activeRun, caseId: c.caseId }, 'station.notice.approved', { noticeId: c.caseId + '-mrc1',
          text: 'Crew medical team: you may perform the standard retest when ready.', basis: ['Reviewed the reported symptoms.'],
          evaluationVersion: 1, reviewedBy: 'Crew medical team (mock)', reviewReason: 'Retest permitted after medical review.', simulated: true });
        return send(res, { status: 200, body: { ok: true } });
      }
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
