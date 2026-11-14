// HUD ↔ base-station client (DOM-free; runs in the browser and in Node ≥ 22).
// Classic script (no import/export) so hud.html also works when opened by double-click (file://).
// Browser: <script src="hud/base-client.js"> → window.MyoMarsBaseClient. Node: await import(...) → globalThis.MyoMarsBaseClient.
// Message shapes follow contract/draft-v0.1.md (SRS v0.1 draft). Swap the mapping here when the
// shared base delivers its final contract; the HUD page only uses the API returned below.

(function () {
const SCHEMA = '0.1-draft';
const KNOWN = new Set(['alert.updated', 'retest.requested']);
const SERVER_RESULT = { received: 'received', reassessing: 'reassessing', completed: 'completed' };

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const uid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));

function createBaseClient({ baseUrl, crewId, storage = memoryStorage(), onChange = () => {}, log = () => {},
  WS = globalThis.WebSocket, fetchImpl = (...a) => globalThis.fetch(...a), key = 'myomars.hud.v1' }) {

  const empty = () => ({ conn: 'idle', lastSync: null, cursor: 0, alerts: {}, alertHistory: {}, retests: {}, seen: [],
    receipts: {}, acks: {}, outbox: [], uploads: {}, segments: {}, lastSegmentAck: null, invalid: 0, duplicates: 0, stale: false });
  let st = empty(), ws = null, manual = false, retryMs = 1000, retryTimer = null, started = false;

  /* ---------- persistence (restore on first open / refresh / reconnect) ---------- */
  function load() {
    try { const s = JSON.parse(storage.getItem(key) || 'null'); if (s) st = { ...empty(), ...s, conn: 'idle', stale: true }; } catch { st = empty(); }
    for (const k in st.receipts) if (st.receipts[k] === 'sending') st.receipts[k] = 'failed';
    for (const k in st.acks) if (st.acks[k].status === 'pending') st.acks[k] = { status: 'failed', error: 'interrupted' };
  }
  function save() {
    const { conn, stale, ...keep } = st; keep.seen = keep.seen.slice(-500);
    try { storage.setItem(key, JSON.stringify(keep)); } catch { /* storage full or blocked: keep running in memory */ }
  }
  const emit = () => { save(); onChange(st); };

  /* ---------- HTTP helper: success only on a real service response ---------- */
  async function call(method, path, body) {
    try {
      const r = await fetchImpl(baseUrl + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      let data = null; try { data = await r.json(); } catch { data = null; }
      return { ok: r.ok, status: r.status, data };
    } catch (e) { return { ok: false, status: 0, data: null, error: 'network' }; }
  }

  /* ---------- inbound events ---------- */
  function valid(ev) {
    if (!ev || typeof ev !== 'object') return false;
    if (typeof ev.schemaVersion !== 'string' || ev.schemaVersion !== SCHEMA) return false;
    if (typeof ev.messageId !== 'string' || !KNOWN.has(ev.type) || ev.crewId !== crewId || !Number.isInteger(ev.cursor)) return false;
    const p = ev.payload; if (!p || typeof p !== 'object' || !Number.isInteger(p.version)) return false;
    return ev.type === 'alert.updated' ? typeof p.alertId === 'string'
      : typeof p.retestId === 'string' && typeof p.alertId === 'string' && Number.isInteger(p.round);
  }
  function upsertRetest(p) {
    const cur = st.retests[p.retestId];
    if (!cur || p.version > cur.version) { st.retests[p.retestId] = { ...p }; return true; }
    return false;
  }
  function apply(ev) {
    if (!valid(ev)) { st.invalid++; log('Ignored invalid message ' + (ev && ev.messageId || '?'), 'warn'); return false; }
    st.cursor = Math.max(st.cursor, ev.cursor); st.lastSync = new Date().toISOString(); st.stale = false;
    if (st.seen.includes(ev.messageId)) {                  // duplicate delivery: no new task, but make sure a receipt exists
      st.duplicates++; if (st.receipts[ev.messageId] !== 'confirmed') sendReceipt(ev.messageId);
      return false;
    }
    st.seen.push(ev.messageId);
    const p = ev.payload;
    if (ev.type === 'alert.updated') {
      const cur = st.alerts[p.alertId];
      if (!cur || p.version > cur.version) st.alerts[p.alertId] = { ...p, issuedAt: ev.issuedAt, messageId: ev.messageId };
      const h = st.alertHistory[p.alertId] || (st.alertHistory[p.alertId] = []);
      if (!h.some(x => x.version === p.version)) { h.push({ version: p.version, finding: p.finding, title: p.title, status: p.status }); h.sort((a, b) => a.version - b.version); }
    } else upsertRetest({ ...p, issuedAt: ev.issuedAt });
    sendReceipt(ev.messageId);                             // automatic device-side receipt (GAP-01)
    return true;
  }

  /* ---------- device receipt (GAP-01: draft has none; isolated here) ---------- */
  async function sendReceipt(messageId) {
    const s = st.receipts[messageId];
    if (s === 'confirmed' || s === 'sending') return;
    st.receipts[messageId] = 'sending'; emit();
    const r = await call('POST', '/v1/deliveries/' + encodeURIComponent(messageId) + '/receipt', { crewId, receivedAt: new Date().toISOString() });
    st.receipts[messageId] = r.ok ? 'confirmed' : 'failed';
    if (r.ok) log('Device receipt sent ' + messageId.slice(0, 12)); else log('Receipt not confirmed by base; will retry', 'warn');
    emit();
  }
  function retryReceipts() { for (const m of st.seen) if (st.receipts[m] === 'failed' || !st.receipts[m]) sendReceipt(m); }

  /* ---------- outbound actions ---------- */
  async function ack(alertId) {                           // human confirmation; separate from the receipt
    const a = st.alerts[alertId]; if (!a) return { ok: false, error: 'unknown-alert' };
    const k = alertId + '@' + a.version, cur = st.acks[k];
    if (cur && (cur.status === 'confirmed' || cur.status === 'pending')) return { ok: cur.status === 'confirmed' };
    st.acks[k] = { status: 'pending' }; emit();
    const r = await call('POST', '/v1/alerts/' + encodeURIComponent(alertId) + '/ack', { requestId: 'ack-' + crewId + '-' + k, alertVersion: a.version });
    st.acks[k] = r.ok ? { status: 'confirmed', ackedAt: r.data.ackedAt } : { status: 'failed', error: r.data?.error || 'no-service-receipt' };
    log(r.ok ? 'Acknowledgement sent ' + k : 'Acknowledgement failed (no base receipt)', r.ok ? '' : 'warn'); emit();
    return { ok: r.ok, error: st.acks[k].error };
  }
  async function respond(retestId, action, reason) {      // accept | defer | abort
    const rt = st.retests[retestId]; if (!rt) return { ok: false, error: 'unknown-retest' };
    const r = await call('POST', '/v1/retests/' + encodeURIComponent(retestId) + '/responses', { requestId: 'rsp-' + uid(), action, reason: reason || undefined, round: rt.round });
    if (r.data?.retest) upsertRetest(r.data.retest);
    else if (r.data?.current) upsertRetest(r.data.current);
    log(r.ok ? `Retest ${action} confirmed by base` : `Retest ${action} failed: ${r.data?.error || r.error || r.status}`, r.ok ? '' : 'warn');
    emit();
    return { ok: r.ok, error: r.ok ? null : (r.data?.error || r.error || 'http-' + r.status) };
  }
  function submitResult(retestId, sample) {                // queues until telemetry.ack arrives
    const rt = st.retests[retestId]; if (!rt) return { ok: false, error: 'unknown-retest' };
    if (!sample || sample.simulated !== true || !Array.isArray(sample.metrics)) return { ok: false, error: 'sample-not-simulated' };
    const k = retestId + '#' + rt.round, cur = st.uploads[k];
    if (cur && cur.status !== 'rejected') return { ok: true, pending: cur.status === 'pending' };
    const messageId = 'res-' + retestId + '-r' + rt.round + '-' + uid().slice(0, 8);
    const payload = { retestId, alertId: rt.alertId, round: rt.round, sessionId: 'S-' + uid().slice(0, 8), simulated: true,
      sampleId: sample.sampleId, protocol: sample.protocol, metrics: sample.metrics.map(({ name, value, unit }) => ({ name, value, unit })) };
    st.outbox.push({ messageId, type: 'telemetry.window', payload });
    st.uploads[k] = { status: 'pending', messageId, sessionId: payload.sessionId, queuedAt: new Date().toISOString() };
    log('Retest result queued ' + messageId); emit(); flush();
    return { ok: true, pending: true, messageId };
  }
  // auto patrol monitoring: walking segments detected by the local device, queued until telemetry.ack
  const MAX_SEG_OUTBOX = 200;
  function submitSegment(seg, sample) {
    if (!seg || typeof seg.segmentId !== 'string') return { ok: false, error: 'invalid-segment' };
    if (!sample || sample.simulated !== true || !Array.isArray(sample.metrics)) return { ok: false, error: 'sample-not-simulated' };
    if (st.segments[seg.segmentId]) return { ok: true, duplicate: true };
    const messageId = 'seg-' + seg.segmentId;
    const payload = { kind: 'walking-segment', ...seg, simulated: true, sampleId: sample.sampleId, protocol: sample.protocol,
      metrics: sample.metrics.map(({ name, value, unit }) => ({ name, value, unit })) };
    st.outbox.push({ messageId, type: 'telemetry.window', payload });
    const segs = st.outbox.filter(m => m.payload.kind === 'walking-segment');      // bounded queue: drop oldest segments, never retest results
    if (segs.length > MAX_SEG_OUTBOX) { const drop = segs[0].messageId; st.outbox = st.outbox.filter(m => m.messageId !== drop); st.segments[drop.slice(4)] = { status: 'dropped' }; log('Outbox full; oldest segment dropped', 'warn'); }
    st.segments[seg.segmentId] = { status: 'pending', queuedAt: new Date().toISOString(), durationSec: seg.durationSec };
    const ids = Object.keys(st.segments); if (ids.length > 300) for (const k of ids.slice(0, ids.length - 300)) delete st.segments[k];
    log('Walking segment queued ' + seg.segmentId + ' (' + seg.durationSec + ' s)'); emit(); flush();
    return { ok: true, pending: true, messageId };
  }
  function flush() {
    if (!ws || ws.readyState !== 1) return;
    for (const m of st.outbox) ws.send(JSON.stringify({ schemaVersion: SCHEMA, messageId: m.messageId, type: m.type, crewId, sentAt: new Date().toISOString(), simulated: true, payload: m.payload }));
  }
  function onTelemetryAck(a) {
    if (a.kind === 'walking-segment' || String(a.ackFor).startsWith('seg-')) {
      const id = a.segmentId || String(a.ackFor).slice(4);
      st.segments[id] = { ...(st.segments[id] || {}), status: a.status === 'persisted' ? 'persisted' : 'rejected', quality: a.quality || null, comparable: !!a.comparable, error: a.error || null, ackAt: a.receivedAt };
      st.outbox = st.outbox.filter(m => m.messageId !== a.ackFor);
      if (a.status === 'persisted') st.lastSegmentAck = a.receivedAt;
      emit(); return;
    }
    const k = Object.keys(st.uploads).find(x => st.uploads[x].messageId === a.ackFor); if (!k) return;
    st.uploads[k] = { ...st.uploads[k], status: a.status === 'persisted' ? 'persisted' : 'rejected', error: a.error || null, ackAt: a.receivedAt };
    st.outbox = st.outbox.filter(m => m.messageId !== a.ackFor);
    log(a.status === 'persisted' ? 'Base received retest result' : 'Retest result rejected: ' + a.error, a.status === 'persisted' ? '' : 'warn'); emit();
  }

  /* ---------- connection ---------- */
  async function resync() {                               // full replay from cursor 0 rebuilds current state
    const r = await call('GET', '/v1/events?after=0&crewId=' + encodeURIComponent(crewId));
    if (!r.ok) return false;
    if (r.data.cursor < st.cursor) { const c = st.conn; st = empty(); st.conn = c; log('Base event stream reset; local cache cleared', 'warn'); }
    for (const ev of r.data.events) apply(ev);
    st.lastSync = new Date().toISOString(); st.stale = false; retryReceipts(); emit();
    return true;
  }
  function connect() {
    if (manual || !WS) return;
    clearTimeout(retryTimer);
    try { ws = new WS(baseUrl.replace(/^http/, 'ws') + '/v1/stream?crewId=' + encodeURIComponent(crewId) + '&after=' + st.cursor); }
    catch { return schedule(); }
    ws.onopen = () => { st.conn = 'online'; retryMs = 1000; log('Base link connected'); emit(); flush(); };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)); } catch { st.invalid++; return; }
      if (m && m.type === 'telemetry.ack') return onTelemetryAck(m);
      if (apply(m)) emit(); else emit();
    };
    ws.onclose = () => { ws = null; if (manual) return; st.conn = 'reconnecting'; emit(); schedule(); };
    ws.onerror = () => {};
  }
  function schedule() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(async () => { await resync(); connect(); }, retryMs);
    retryMs = Math.min(5000, retryMs * 1.6);
  }

  const api = {
    get state() { return st; },
    async start() {
      if (started) return; started = true; load(); st.conn = 'connecting'; emit();
      const ok = await resync(); if (!ok) { st.conn = 'reconnecting'; emit(); }
      connect(); if (!ok) schedule();
    },
    disconnect() { manual = true; clearTimeout(retryTimer); if (ws) ws.close(); ws = null; st.conn = 'offline'; log('Base link disconnected manually', 'warn'); emit(); },
    async reconnect() { manual = false; st.conn = 'connecting'; emit(); await resync(); connect(); },
    stop() { manual = true; clearTimeout(retryTimer); if (ws) ws.close(); ws = null; },
    ack, respond, submitResult, submitSegment,
    monitorState() {
      const v = Object.values(st.segments);
      return { pending: v.filter(x => x.status === 'pending').length, uploaded: v.filter(x => x.status === 'persisted').length, lastAckAt: st.lastSegmentAck };
    },
    activeCase() {
      const alerts = Object.values(st.alerts).sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
      const alert = alerts.find(a => a.status !== 'closed') || alerts[0] || null;
      const retest = alert ? Object.values(st.retests).filter(r => r.alertId === alert.alertId).sort((a, b) => b.round - a.round || b.version - a.version)[0] || null : null;
      return { alert, retest };
    },
    ackState(alert) { return alert ? st.acks[alert.alertId + '@' + alert.version] || null : null; },
    receiptState(messageId) { return st.receipts[messageId] || null; },
    resultStatus(rt) {                                     // pending → persisted → received → reassessing → completed
      if (!rt) return null;
      if (SERVER_RESULT[rt.status]) return SERVER_RESULT[rt.status];
      const u = st.uploads[rt.retestId + '#' + rt.round];
      return u ? u.status : null;
    },
    upload(rt) { return rt ? st.uploads[rt.retestId + '#' + rt.round] || null : null; },
    clearLocal() { storage.removeItem(key); }
  };
  return api;
}
globalThis.MyoMarsBaseClient = { SCHEMA, memoryStorage, createBaseClient };
})();
