// HUD ↔ relay client for MyoMars shared message contracts v1 (schema "myomars/v1").
// DOM-free classic script: works in the browser (also from file://) and in Node ≥ 22.
// Browser: <script src="hud/base-client.js"> → window.MyoMarsBaseClient. Node: await import(...) → globalThis.MyoMarsBaseClient.
//
// Roles in this demo (contracts/schema/event-rules.json):
//   hud     — hud.received (automatic device receipt), hud.ack (astronaut), hud.defer (astronaut + reason), retest.result
//   trigger — the simulated patch/local device inside the HUD page: scenario.start and observation.submitted
//             (walking segments). The contract only lets the Trigger publish observations.
// Transport: relay intent "HTTP publish + Server-Sent Events" (see server/mock-base.mjs); the real relay is not published yet.
(function () {
  const SCHEMA = 'myomars/v1';
  const HANDLED = new Set(['station.notice.approved', 'station.retest.requested', 'station.receipt', 'station.reassessment']);
  const uid = () => (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)));
  function memoryStorage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }

  function createBaseClient({ baseUrl, sessionId = 'demo', hudClientId = 'hud-a02', deviceClientId = 'patch-sim-01',
    storage = memoryStorage(), onChange = () => {}, log = () => {}, fetchImpl = (...a) => globalThis.fetch(...a), key = 'myomars.hud.v1.' }) {

    const K = key + sessionId;
    const empty = () => ({ conn: 'idle', lastSync: null, lastSeq: 0, events: [], outbox: [], rejected: [], publishAcks: {}, invalid: 0, duplicates: 0, stale: false });
    let st = empty(), manual = false, abort = null, retryMs = 1000, retryTimer = null, flushing = false, started = false, seenIds = new Set();

    /* ---------- persistence: outbox + last snapshot (relay history is the source of truth) ---------- */
    function load() {
      try { const s = JSON.parse(storage.getItem(K) || 'null'); if (s) st = { ...empty(), ...s, conn: 'idle', stale: true }; } catch { st = empty(); }
      seenIds = new Set(st.events.map(e => e.eventId));
    }
    function save() {
      const { conn, stale, ...keep } = st; keep.events = keep.events.slice(-600);
      const ids = Object.keys(keep.publishAcks); if (ids.length > 600) for (const k of ids.slice(0, ids.length - 600)) delete keep.publishAcks[k];
      try { storage.setItem(K, JSON.stringify(keep)); } catch { /* storage blocked: keep running in memory */ }
    }
    const emit = () => { save(); onChange(st); };

    /* ---------- inbound (delivered envelopes) ---------- */
    function validDelivered(d) {
      return d && d.schema === SCHEMA && typeof d.eventId === 'string' && Number.isInteger(d.seq) && d.sessionId === sessionId
        && typeof d.type === 'string' && d.payload && typeof d.payload === 'object' && d.sender && typeof d.runId === 'string';
    }
    function apply(d) {
      if (!validDelivered(d)) { st.invalid++; log('Ignored invalid message', 'warn'); return false; }
      if (seenIds.has(d.eventId)) { st.duplicates++; return false; }        // duplicate delivery → no new task
      seenIds.add(d.eventId); st.events.push(d); st.lastSeq = Math.max(st.lastSeq, d.seq);
      st.lastSync = new Date().toISOString(); st.stale = false;
      return true;
    }

    /* ---------- derived view of the current run ---------- */
    function currentRun() {
      let run = null;
      for (const e of st.events) {
        if (e.type === 'scenario.start') run = { runId: e.runId, scenarioId: e.payload.scenarioId, astronaut: e.payload.astronaut, task: e.payload.task, startedAt: e.sentAt };
        else if (e.type === 'scenario.reset' && run && e.runId === run.runId) run = null;
      }
      if (!run || st.outbox.some(m => m.env.type === 'scenario.reset' && m.env.runId === run.runId)) {
        const o = st.outbox.filter(m => m.env.type === 'scenario.start').at(-1);
        run = o ? { runId: o.env.runId, scenarioId: o.env.payload.scenarioId, astronaut: o.env.payload.astronaut, task: o.env.payload.task, pending: true } : null;
      }
      return run;
    }
    const inRun = run => (run ? st.events.filter(e => e.runId === run.runId) : []);
    function hudSent(run, type, messageId) {
      const del = inRun(run).find(e => e.type === type && e.payload.messageId === messageId);
      if (del) return { state: 'confirmed', env: del };
      const ob = st.outbox.find(m => m.env.type === type && m.env.payload.messageId === messageId);
      if (ob) return { state: 'pending', env: ob.env };
      const rj = st.rejected.filter(m => m.env.type === type && m.env.payload.messageId === messageId).at(-1);
      return rj ? { state: 'failed', env: rj.env, error: rj.error } : null;
    }
    function resultFor(run, retestId) {
      const del = inRun(run).filter(e => e.type === 'retest.result' && e.retestId === retestId && e.sender.clientId === hudClientId).at(-1);
      if (del) return { eventId: del.eventId, state: 'published', env: del };
      const ob = st.outbox.find(m => m.env.type === 'retest.result' && m.env.retestId === retestId);
      if (ob) return { eventId: ob.env.eventId, state: 'queued', env: ob.env };
      return null;
    }

    function view() {
      const run = currentRun(), evs = inRun(run);
      const station = evs.filter(e => HANDLED.has(e.type));                  // station.audit.* and unknown types are ignored
      if (!run || !station.length) return { run, alert: null, retest: null, medical: null, symptoms: null, recoveryDefer: null };
      const caseId = station.at(-1).caseId, sc = station.filter(e => e.caseId === caseId);
      const notices = sc.filter(e => e.type === 'station.notice.approved');
      const MR = /-mr\d+$/, MRC = /-mrc\d+$/;                          // medical review / clearance notices (noticeId suffix, gap V1-11)
      const notice = notices.filter(e => !MR.test(e.payload.noticeId) && !MRC.test(e.payload.noticeId)).at(-1) || null;
      const mr = notices.filter(e => MR.test(e.payload.noticeId)).at(-1) || null, mrc = notices.filter(e => MRC.test(e.payload.noticeId)).at(-1) || null;
      const reass = sc.filter(e => e.type === 'station.reassessment').sort((a, b) => a.payload.evaluationVersion - b.payload.evaluationVersion);
      const lastR = reass.at(-1) || null, req = sc.filter(e => e.type === 'station.retest.requested').at(-1) || null;
      let alert = null;
      if (notice || lastR) {
        const latest = lastR || notice, closed = !!lastR && lastR.payload.caseStatus === 'closed';
        // notice kind by noticeId suffix (contracts v1 has no category field — gap V1-11)
        const kind = !notice ? 'review' : /-sensor\d+$/.test(notice.payload.noticeId) ? 'sensor' : /-ok\d+$/.test(notice.payload.noticeId) ? 'ok' : 'review';
        alert = { alertId: caseId, caseId, kind, noticeId: notice ? notice.payload.noticeId : null, noticeMessageId: notice ? notice.eventId : null, messageId: latest.eventId, version: latest.payload.evaluationVersion,
          status: closed ? 'closed' : lastR ? 'reassessed' : 'published', levelLabel: lastR ? 'Reassessment' : 'Notice',
          title: lastR ? lastR.payload.summary : notice.payload.reviewReason,
          reason: notice ? notice.payload.text : lastR.payload.summary,
          nextAction: lastR ? 'Decision: ' + lastR.payload.reviewDecision + ' · case ' + lastR.payload.caseStatus : (req ? req.payload.instructions : '—'),
          basis: notice ? notice.payload.basis : [], reviewedBy: notice ? notice.payload.reviewedBy : null,
          dataTime: (notice && notice.occurredAt) || latest.sentAt, issuedAt: latest.sentAt, disposition: lastR ? lastR.payload.summary : null,
          finding: lastR ? lastR.payload.summary : notice.payload.reviewReason,
          history: [notice && { version: notice.payload.evaluationVersion, finding: notice.payload.reviewReason }, ...reass.map(r => ({ version: r.payload.evaluationVersion, finding: r.payload.summary }))].filter(Boolean) };
      }
      let retest = null;
      if (req) {
        const p = req.payload, label = p.protocol.label, parts = label.split(' · ');
        const result = resultFor(run, p.retestId);
        const receipt = result && evs.find(e => e.type === 'station.receipt' && e.payload.receivedEventId === result.eventId);
        const defers = evs.filter(e => e.type === 'hud.defer' && e.payload.messageId === req.eventId);
        const ack = hudSent(run, 'hud.ack', req.eventId);
        const reassAfter = receipt && receipt.payload.status === 'accepted' && reass.some(r => r.seq > receipt.seq);
        let status = 'requested';
        if (reassAfter) status = 'completed';
        else if (receipt) status = receipt.payload.status === 'rejected' ? 'rejected' : 'reassessing';
        else if (result) status = 'submitted';
        else if (ack && (!defers.length || (ack.env.seq || Infinity) > defers.at(-1).seq)) status = 'accepted';
        else if (defers.length) status = 'deferred';
        const m = /-rt(\d+)$/.exec(p.retestId);
        retest = { retestId: p.retestId, alertId: caseId, caseId, messageId: req.eventId, round: m ? +m[1] : 1, version: p.evaluationVersion,
          status, protocol: p.protocol, bodySite: parts.length > 1 ? parts[0] : label, action: parts.length > 1 ? parts.slice(1).join(' · ') : label,
          instructions: p.instructions, reviewedBy: p.reviewedBy, deferReason: defers.length ? defers.at(-1).payload.reason : null,
          inHabitat: /habitat/i.test(p.instructions), receipt: receipt ? { ...receipt.payload, at: receipt.sentAt } : null, issuedAt: req.sentAt };
      }
      // Scenario 2 follow-up: medical review, symptom assessment (proposed extension hud.symptoms), recovery deferral
      const medical = mr ? { messageId: mr.eventId, caseId, text: mr.payload.text, basis: mr.payload.basis, at: mr.sentAt,
        cleared: !!(mrc && mrc.seq > mr.seq), clearText: mrc ? mrc.payload.text : null, clearMessageId: mrc ? mrc.eventId : null } : null;
      let symptoms = null;
      if (notice) {
        const del = evs.filter(e => e.type === 'hud.symptoms' && e.payload.messageId === notice.eventId).at(-1);
        const ob = st.outbox.find(m => m.env.type === 'hud.symptoms' && m.env.payload.messageId === notice.eventId);
        const rj = st.rejected.filter(m => m.env.type === 'hud.symptoms' && m.env.payload.messageId === notice.eventId).at(-1);
        const env = del || (ob && ob.env) || (rj && rj.env);
        if (env) {
          const rc = del && evs.find(e => e.type === 'station.receipt' && e.payload.receivedEventId === del.eventId);
          symptoms = { eventId: env.eventId, symptoms: env.payload.symptoms, noneReported: env.payload.noneReported,
            state: rc ? rc.payload.status : del ? 'submitted' : ob ? 'queued' : 'failed', reason: rc ? rc.payload.reason : rj ? rj.error : null };
        }
      }
      const rd = notice ? evs.filter(e => e.type === 'hud.defer' && e.payload.messageId === notice.eventId).at(-1) : null;
      const recoveryDefer = rd ? { reason: rd.payload.reason, seq: rd.seq } : null;
      return { run, alert, retest, medical, symptoms, recoveryDefer };
    }

    /* ---------- automatic device receipts (hud.received) for every handled station message ---------- */
    function autoReceipts() {
      const run = currentRun(); if (!run || run.pending) return;
      for (const e of inRun(run)) if (HANDLED.has(e.type) && !hudSent(run, 'hud.received', e.eventId))
        enqueue(envelope('hud', 'hud.received', { messageId: e.eventId }, { runId: run.runId, caseId: e.caseId, eventId: 'hud-rcv-' + e.eventId }), 'hud', true);
      emit(); flush();
    }

    /* ---------- outbound ---------- */
    function envelope(source, type, payload, { runId, caseId = null, retestId, eventId, occurredAt }) {
      const env = { schema: SCHEMA, eventId: eventId || (source === 'hud' ? 'hud-' : 'trg-') + uid(), sessionId, runId, caseId,
        sentAt: new Date().toISOString(), source, type, payload };
      if (retestId) env.retestId = retestId;
      if (occurredAt) env.occurredAt = occurredAt;
      return env;
    }
    function enqueue(env, role, quiet) {
      if (st.outbox.some(m => m.env.eventId === env.eventId)) return;
      st.outbox.push({ env, role, clientId: role === 'hud' ? hudClientId : deviceClientId, queuedAt: new Date().toISOString() });
      if (!quiet) { emit(); flush(); }
    }
    async function flush() {
      if (flushing || manual) return; flushing = true;
      try {
        while (st.outbox.length && !manual) {
          const m = st.outbox[0];
          let r;
          try {
            const res = await fetchImpl(baseUrl + '/v1/sessions/' + sessionId + '/events', { method: 'POST',
              headers: { 'content-type': 'application/json', 'x-myomars-role': m.role, 'x-myomars-client': m.clientId }, body: JSON.stringify(m.env) });
            r = { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
          } catch { r = { ok: false, status: 0 }; }
          if (r.ok) {                                                        // relay persisted it (seq): the only "success"
            st.outbox.shift(); st.publishAcks[m.env.eventId] = { seq: r.data.seq, receivedAt: r.data.receivedAt, duplicate: !!r.data.duplicate };
            st.lastSync = r.data.receivedAt; emit(); continue;
          }
          if (r.status === 0 || r.status >= 500) { if (st.conn === 'online') { st.conn = 'reconnecting'; emit(); } schedule(); break; }
          st.outbox.shift();                                                 // 4xx: contract or state error, never retried blindly
          const err = (r.data && (r.data.error + (r.data.details ? ': ' + r.data.details.join('; ') : ''))) || 'http-' + r.status;
          if (r.data && r.data.error === 'eventId-conflict' && m.env.type === 'hud.received') { emit(); continue; }
          st.rejected.push({ env: m.env, error: err, at: new Date().toISOString() }); st.rejected = st.rejected.slice(-50);
          log('Relay rejected ' + m.env.type + ': ' + err, 'warn'); emit();
        }
      } finally { flushing = false; }
    }

    /* ---------- relay connection: history replay + SSE stream ---------- */
    async function resync() {
      let r;
      try { const res = await fetchImpl(baseUrl + '/v1/sessions/' + sessionId + '/events?after=0'); if (!res.ok) return false; r = await res.json(); }
      catch { return false; }
      if (st.events.length && (r.lastSeq < st.lastSeq || !r.events.some(e => e.eventId === st.events[0].eventId))) {
        st.outbox = []; st.rejected = []; log('Relay history was reset; local snapshot cleared', 'warn');
      }
      st.events = []; seenIds = new Set();
      for (const d of r.events) apply(d);
      st.lastSeq = r.lastSeq; st.lastSync = new Date().toISOString(); st.stale = false;
      autoReceipts();
      return true;
    }
    async function stream() {
      if (manual) return;
      clearTimeout(retryTimer);
      if (abort) abort.abort();
      abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const my = abort;
      try {
        const res = await fetchImpl(baseUrl + '/v1/sessions/' + sessionId + '/stream?after=' + st.lastSeq, { headers: { accept: 'text/event-stream' }, signal: my && my.signal });
        if (!res.ok || !res.body) throw new Error('stream ' + res.status);
        st.conn = 'online'; retryMs = 1000; log('Relay stream connected'); emit(); flush();
        const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            let d; try { d = JSON.parse(data); } catch { st.invalid++; continue; }
            if (apply(d)) autoReceipts(); else emit();
          }
        }
      } catch (e) { /* aborted or network error */ }
      if (manual || my !== abort) return;
      st.conn = 'reconnecting'; emit(); schedule();
    }
    function schedule() {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(async () => { if (manual) return; if (await resync()) { flush(); stream(); } else schedule(); }, retryMs);
      retryMs = Math.min(5000, retryMs * 1.6);
    }

    /* ---------- actions ---------- */
    function ensureRun({ scenarioId = 'myomars-patrol', astronaut = { id: 'a-02', callsign: 'A-02' }, task = { id: 'eva-patrol', title: 'EVA patrol', targetId: null } } = {}) {
      const run = currentRun();
      if (run && run.scenarioId === scenarioId) return run.runId;
      if (run && !run.pending) enqueue(envelope('trigger', 'scenario.reset', {}, { runId: run.runId }), 'trigger');   // switching scenario ends the old run
      const runId = 'run-' + Date.now().toString(36);
      enqueue(envelope('trigger', 'scenario.start', { scenarioId, astronaut, task }, { runId }), 'trigger');
      log('Local device started run ' + runId); return runId;
    }
    function submitObservation(seg, sample) {                     // walking segment → observation.submitted (Trigger role)
      const run = currentRun(); if (!run) return { ok: false, error: 'no-run' };
      if (!sample || !sample.protocol || !sample.signal) return { ok: false, error: 'sample-missing' };
      const obsId = 'obs-' + String(seg.segmentId || uid()).toLowerCase();
      if (st.outbox.some(m => m.env.payload.observationId === obsId) || inRun(run).some(e => e.payload && e.payload.observationId === obsId)) return { ok: true, duplicate: true };
      const payload = { observationId: obsId, astronautId: run.astronaut.id, capturedAt: seg.startedAt, deviceId: deviceClientId,
        protocol: sample.protocol, context: { taskId: run.task.id, phase: 'eva', minutesIntoEva: seg.minutesIntoEva ?? null },
        signal: { ...sample.signal, durationS: seg.durationSec }, features: sample.features };
      if (sample.imu) payload.imu = sample.imu;
      enqueue(envelope('trigger', 'observation.submitted', payload, { runId: run.runId, caseId: run.runId + '-lq', occurredAt: seg.startedAt }), 'trigger');
      return { ok: true, pending: true };
    }
    async function waitPublished(eventId, ms = 8000) {
      const t = Date.now();
      for (;;) {
        if (st.publishAcks[eventId]) return { ok: true };
        const rj = st.rejected.find(m => m.env.eventId === eventId); if (rj) return { ok: false, error: rj.error };
        if (!st.outbox.some(m => m.env.eventId === eventId)) return { ok: false, error: 'lost' };
        if (manual || st.conn === 'reconnecting' || st.conn === 'offline') return { ok: false, error: 'network', queued: true };
        if (Date.now() - t > ms) return { ok: false, error: 'timeout', queued: true };
        await new Promise(r => setTimeout(r, 40));
      }
    }
    async function ack(alertIdOrMessageId) {                      // astronaut acknowledgement, separate from hud.received
      const v = view(), run = v.run;
      const target = v.alert && (v.alert.alertId === alertIdOrMessageId || v.alert.messageId === alertIdOrMessageId) ? v.alert
        : v.retest && v.retest.messageId === alertIdOrMessageId ? v.retest
        : v.medical && v.medical.messageId === alertIdOrMessageId ? v.medical
        : v.alert && v.alert.noticeMessageId === alertIdOrMessageId ? { messageId: v.alert.noticeMessageId, caseId: v.alert.caseId } : null;
      if (!target || !run) return { ok: false, error: 'unknown-message' };
      const prev = hudSent(run, 'hud.ack', target.messageId);
      if (prev && prev.state === 'confirmed') return { ok: true };
      if (prev && prev.state === 'pending') return waitPublished(prev.env.eventId);
      const env = envelope('hud', 'hud.ack', { messageId: target.messageId }, { runId: run.runId, caseId: target.caseId,
        eventId: 'hud-ack-' + target.messageId + (prev ? '-' + uid().slice(0, 6) : '') });
      enqueue(env, 'hud'); log('Acknowledgement queued');
      return waitPublished(env.eventId);
    }
    async function respond(retestId, action, reason) {           // accept → hud.ack on the request; defer → hud.defer; abort → local only
      const v = view(); if (!v.retest || v.retest.retestId !== retestId) return { ok: false, error: 'unknown-retest' };
      if (action === 'abort') return { ok: true, local: true };     // contracts v1 has no abort event (gap)
      if (action === 'accept') return ack(v.retest.messageId);
      if (action === 'defer') {
        if (!(reason || '').trim()) return { ok: false, error: 'reason-required' };
        const env = envelope('hud', 'hud.defer', { messageId: v.retest.messageId, reason: reason.trim() }, { runId: v.run.runId, caseId: v.retest.caseId });
        enqueue(env, 'hud'); return waitPublished(env.eventId);
      }
      return { ok: false, error: 'invalid-action' };
    }
    function submitSymptoms({ symptoms = [], noneReported = false } = {}) {   // hud.symptoms (proposed extension) → acknowledged by station.receipt
      const v = view(); if (!v.alert || !v.alert.noticeMessageId || v.alert.kind !== 'review') return { ok: false, error: 'no-fatigue-notice' };
      if (noneReported ? symptoms.length : !symptoms.length) return { ok: false, error: 'selection-required' };
      if (v.symptoms && v.symptoms.state !== 'failed' && v.symptoms.state !== 'rejected') return { ok: true, duplicate: true };
      enqueue(envelope('hud', 'hud.symptoms', { messageId: v.alert.noticeMessageId, symptoms: [...symptoms], noneReported: !!noneReported, assessedAt: new Date().toISOString() },
        { runId: v.run.runId, caseId: v.alert.caseId }), 'hud');
      log('Symptom assessment queued'); return { ok: true, pending: true };
    }
    async function deferNotice(reason) {                           // recovery cannot start safely → hud.defer on the fatigue notice
      const v = view(); if (!v.alert || !v.alert.noticeMessageId) return { ok: false, error: 'unknown-message' };
      if (!(reason || '').trim()) return { ok: false, error: 'reason-required' };
      const env = envelope('hud', 'hud.defer', { messageId: v.alert.noticeMessageId, reason: reason.trim() }, { runId: v.run.runId, caseId: v.alert.caseId });
      enqueue(env, 'hud'); return waitPublished(env.eventId);
    }
    function submitResult(retestId, sample) {                     // retest.result (HUD role): complete on its own
      const v = view(), rt = v.retest; if (!rt || rt.retestId !== retestId) return { ok: false, error: 'unknown-retest' };
      if (!sample || !sample.signal || !sample.features) return { ok: false, error: 'sample-missing' };
      const prev = resultFor(v.run, retestId);
      if (prev && rt.status !== 'rejected') return { ok: true, pending: prev.state === 'queued' };
      const now = new Date().toISOString();
      const observation = { observationId: 'obs-' + retestId + '-' + uid().slice(0, 8), astronautId: v.run.astronaut.id, capturedAt: now, deviceId: deviceClientId,
        protocol: rt.protocol, context: { taskId: v.run.task.id, phase: 'retest', minutesIntoEva: null }, signal: sample.signal, features: sample.features };
      if (sample.imu) observation.imu = sample.imu;
      enqueue(envelope('hud', 'retest.result', { observation }, { runId: v.run.runId, caseId: rt.caseId, retestId, occurredAt: now }), 'hud');
      log('Retest result queued for ' + retestId);
      return { ok: true, pending: true };
    }

    return {
      get state() { return st; },
      async start() {
        if (started) return; started = true; load(); st.conn = 'connecting'; emit();
        if (!(await resync())) { st.conn = 'reconnecting'; emit(); schedule(); return; }
        flush(); stream();
      },
      disconnect() { manual = true; clearTimeout(retryTimer); if (abort) abort.abort(); st.conn = 'offline'; log('Relay disconnected manually', 'warn'); emit(); },
      async reconnect() { manual = false; st.conn = 'connecting'; emit(); if (await resync()) { flush(); stream(); } else { st.conn = 'reconnecting'; emit(); schedule(); } },
      stop() { manual = true; clearTimeout(retryTimer); if (abort) abort.abort(); },
      ensureRun, submitObservation, ack, respond, submitResult, submitSymptoms, deferNotice,
      activeCase() { const v = view(); return { alert: v.alert, retest: v.retest, run: v.run, medical: v.medical, symptoms: v.symptoms, recoveryDefer: v.recoveryDefer }; },
      ackState(target) {
        if (!target) return null; const h = hudSent(currentRun(), 'hud.ack', target.messageId);
        return h ? { status: h.state, error: h.error } : null;
      },
      receiptState(messageId) { const h = hudSent(currentRun(), 'hud.received', messageId); return h ? (h.state === 'pending' ? 'sending' : h.state) : null; },
      resultStatus(rt) { return rt ? ({ submitted: 'pending', reassessing: 'reassessing', completed: 'completed', rejected: 'rejected' }[rt.status] || null) : null; },
      upload(rt) {
        if (!rt) return null; const r = resultFor(currentRun(), rt.retestId); if (!r) return null;
        return { status: r.state, eventId: r.eventId, ackAt: rt.receipt ? rt.receipt.at : null, error: rt.receipt ? rt.receipt.reason : null };
      },
      monitorState() {
        const mine = inRun(currentRun()).filter(e => e.type === 'observation.submitted' && e.sender.clientId === deviceClientId);
        return { uploaded: mine.length, pending: st.outbox.filter(m => m.env.type === 'observation.submitted').length, lastAckAt: mine.length ? mine.at(-1).receivedAt : null };
      },
      clearLocal() { storage.removeItem(K); }
    };
  }

  globalThis.MyoMarsBaseClient = { SCHEMA, memoryStorage, createBaseClient };
})();
