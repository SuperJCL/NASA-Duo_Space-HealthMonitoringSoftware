// Joint test: HUD client (hud/base-client.js) ↔ mock relay + station (server/mock-base.mjs) on contracts myomars/v1.
// Every message in the relay history is validated against contracts-v1/schema (delivered envelope, payload, event-rules).
// Run: node test/joint-test.mjs     (Node ≥ 22)
process.env.REASSESS_MS = '500';
process.env.REVIEW_MS = '300';
import fs from 'node:fs';
const { start, stop, CONTRACT } = await import('../server/mock-base.mjs');
await import('../hud/base-client.js');
const { createBaseClient, memoryStorage } = globalThis.MyoMarsBaseClient;
const C = globalThis.MyoMarsContract;

const server = await start(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const sample = n => JSON.parse(fs.readFileSync(new URL('../contract/samples/' + n + '.sample.json', import.meta.url)));
const WALK = sample('walking-fatigue'), NORMAL = sample('walking-normal'), FAULT = sample('walking-sensor-fault');
const RETEST = JSON.parse(fs.readFileSync(new URL('../contract/samples/retest-result.sample.json', import.meta.url)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(30); } return false; }
const post = p => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
const state = () => fetch(BASE + '/mock/state').then(r => r.json());
const raw = (env, role) => fetch(BASE + '/v1/sessions/demo/events', { method: 'POST', headers: { 'content-type': 'application/json', 'x-myomars-role': role, 'x-myomars-client': 'test' }, body: JSON.stringify(env) }).then(async r => ({ status: r.status, body: await r.json() }));
const storage = memoryStorage();
const mk = () => createBaseClient({ baseUrl: BASE, storage });
const seg = (n, sec) => ({ segmentId: 'seg-' + n, startedAt: new Date(Date.now() - sec * 1000).toISOString(), durationSec: sec });
const ofType = (s, t) => s.events.filter(e => e.type === t);

console.log('\n== A. Connect and start a run (Scenario 2 · muscle fatigue) ==');
let c = mk(); await c.start();
await until(() => c.state.conn === 'online');
check('A1 SSE stream connected', c.state.conn === 'online');
check('A2 no health content before the station publishes', !c.activeCase().alert && !c.activeCase().retest);
const runId = c.ensureRun({ scenarioId: 'myomars-fatigue' });
await until(() => c.activeCase().run && !c.activeCase().run.pending);
let s = await state();
check('A3 local device (Trigger role) published scenario.start', s.activeRun === runId && ofType(s, 'scenario.start')[0]?.sender.role === 'trigger');

console.log('\n== B. Fatigue pattern → AMBER notice + rest-and-retest ==');
c.submitObservation(seg(0, 3), WALK);
for (let i = 1; i <= 3; i++) c.submitObservation(seg(i, 6), WALK);
c.submitObservation(seg(1, 6), WALK);                          // same segment again → not re-sent
await until(() => c.monitorState().uploaded === 4);
s = await state();
const cs = s.cases[0];
check('B1 walking segments published as observation.submitted (Trigger) and counted once', ofType(s, 'observation.submitted').length === 4 && c.monitorState().uploaded === 4);
check('B2 station uses only quality-checked, comparable segments', cs.observations.filter(o => o.comparable).length === 3 && cs.observations[0].quality === 'too-short', cs.observations.map(o => o.quality + (o.comparable ? '/c' : '')).join(', '));
await until(() => c.activeCase().retest);
let { alert, retest } = c.activeCase(); s = await state();
check('B3 HUD receives station.notice.approved + station.retest.requested only after human approval', alert?.status === 'published' && retest?.status === 'requested' && s.audit.some(a => a.action === 'approve') && s.audit.findIndex(a => a.action === 'deviation-candidate') < s.audit.findIndex(a => a.action === 'approve'), retest?.retestId);
check('B4 fatigue notice + retest: site and "rest, then retest" come from station content', alert.kind === 'review' && retest.bodySite === 'Left quadriceps' && /^Rest/.test(retest.instructions));
await until(async () => ofType(await state(), 'hud.received').length === 2);
s = await state();
const notice = ofType(s, 'station.notice.approved')[0], req = ofType(s, 'station.retest.requested')[0];
check('B5 automatic hud.received for each station message (messageId = its eventId)', ofType(s, 'hud.received').map(e => e.payload.messageId).sort().join() === [notice.eventId, req.eventId].sort().join());
check('B6 device receipt is not an acknowledgement (no hud.ack yet)', ofType(s, 'hud.ack').length === 0);

console.log('\n== C. Acknowledge / defer / accept ==');
let r = await c.ack(alert.alertId); s = await state();
check('C1 astronaut acknowledgement sent separately as hud.ack', r.ok && ofType(s, 'hud.ack').length === 1 && ofType(s, 'hud.ack')[0].payload.messageId === notice.eventId);
check('C2 acknowledging does not complete the task', c.activeCase().retest.status === 'requested');
r = await c.respond(retest.retestId, 'defer', '  ');
check('C3 defer without a reason is refused locally, nothing published', !r.ok && r.error === 'reason-required' && ofType(await state(), 'hud.defer').length === 0);
r = await c.respond(retest.retestId, 'defer', 'Patrol task in progress'); s = await state();
const df = ofType(s, 'hud.defer')[0];
check('C4 hud.defer with reason goes to the right case and request', r.ok && df.payload.messageId === req.eventId && df.caseId === req.caseId && c.activeCase().retest.status === 'deferred');
r = await c.respond(retest.retestId, 'accept');
check('C5 starting the retest sends hud.ack for the request', r.ok && c.activeCase().retest.status === 'accepted');

console.log('\n== D. Reload / duplicates ==');
c.stop(); c = mk(); await c.start(); await until(() => c.state.conn === 'online');
({ alert, retest } = c.activeCase());
check('D1 reload restores the current task and acknowledgement from relay history', retest?.status === 'accepted' && c.ackState(alert)?.status === 'confirmed');
const dupBefore = c.state.duplicates; await post('/mock/duplicate'); await post('/mock/duplicate'); await sleep(150);
check('D2 duplicate deliveries create no new task', c.state.duplicates >= dupBefore + 2 && c.activeCase().retest.retestId === retest.retestId);
check('D3 no extra receipts after reload or duplicates', ofType(await state(), 'hud.received').length === 2);

console.log('\n== E. Retest result offline → resend → receipt → reassessment ==');
c.disconnect();
r = c.submitResult(retest.retestId, RETEST); c.submitObservation(seg(9, 6), WALK);
check('E1 offline: result and segment wait in the outbox; status stays "pending", never done', r.pending && c.resultStatus(c.activeCase().retest) === 'pending' && c.state.outbox.length === 2 && ofType(await state(), 'retest.result').length === 0);
c.stop(); c = mk(); await c.start();
await until(() => ['reassessing', 'completed'].includes(c.resultStatus(c.activeCase().retest)));
s = await state();
const rr = ofType(s, 'retest.result')[0], rc = ofType(s, 'station.receipt')[0];
check('E2 outbox survived the reload and was resent', !!rr && c.state.outbox.length === 0);
check('E3 retest.result carries caseId + retestId and the requested protocol', rr.caseId === req.caseId && rr.retestId === req.retestId && rr.payload.observation.protocol.id === req.payload.protocol.id && rr.payload.observation.context.phase === 'retest');
check('E4 station.receipt accepted → HUD shows received / awaiting reassessment', rc.payload.status === 'accepted' && rc.payload.receivedEventId === rr.eventId);
check('E5 result stored once despite resend', ofType(s, 'retest.result').length === 1);
await until(() => c.activeCase().retest.status === 'completed');
({ alert, retest } = c.activeCase());
check('E6 station.reassessment v2 updates the original case; not closed', retest.status === 'completed' && alert.version === 2 && alert.status === 'reassessed');
check('E7 new version needs a new acknowledgement', c.ackState(alert) === null);
await until(() => c.monitorState().uploaded === 5);
check('E8 segment queued offline was resent', c.monitorState().uploaded === 5);
await c.ack(alert.alertId);
await post('/mock/close'); await until(() => c.activeCase().alert.status === 'closed');
check('E9 only the station closes the case', c.activeCase().alert.status === 'closed' && c.activeCase().alert.version === 3);

console.log('\n== F. Contract conformance ==');
s = await state();
const bad = s.events.map(d => [d.type, C.checkMessage(CONTRACT, d, { delivered: true, role: d.sender.role })]).filter(([, e]) => e.length);
check('F1 every delivered message passes delivered.schema + payload schema + event-rules', bad.length === 0, s.events.length + ' messages' + (bad.length ? ' · ' + JSON.stringify(bad[0]) : ''));
check('F2 eventIds are unique', new Set(s.events.map(e => e.eventId)).size === s.events.length);
const base = { schema: 'myomars/v1', sessionId: 'demo', runId, sentAt: new Date().toISOString(), source: 'hud' };
r = await raw({ ...base, eventId: 'x1', caseId: null, type: 'hud.ack', payload: { messageId: notice.eventId } }, 'hud');
check('F3 relay rejects a message that breaks the rules (hud.ack without caseId)', r.status === 400);
r = await raw({ ...base, eventId: 'x2', caseId: req.caseId, type: 'observation.submitted', payload: ofType(s, 'observation.submitted')[0].payload }, 'hud');
check('F4 relay rejects a HUD publishing observations (Trigger only)', r.status === 400 && /may not publish/.test(JSON.stringify(r.body)));
const first = { ...ofType(s, 'hud.ack')[0] }; delete first.seq; delete first.receivedAt; delete first.sender;
r = await raw({ ...first, payload: { messageId: 'different' } }, 'hud');
check('F5 same eventId with different content is refused', r.status === 409 && r.body.error === 'eventId-conflict');
r = await raw(first, 'hud');
check('F6 identical resend is accepted as duplicate', r.status === 200 && r.body.duplicate === true);
await post('/mock/reset-run');
r = await raw({ ...base, eventId: 'x3', caseId: req.caseId, type: 'hud.ack', payload: { messageId: notice.eventId } }, 'hud');
check('F7 messages for an ended run are stale', r.status === 409 && r.body.error === 'stale-run');
await until(() => !c.activeCase().run);
check('F8 HUD drops the case when the run is reset', !c.activeCase().alert && !c.activeCase().retest);

console.log('\n== G. No service, no success ==');
const off = createBaseClient({ baseUrl: 'http://127.0.0.1:1', storage: memoryStorage() });
await off.start(); off.ensureRun(); await sleep(100);
check('G1 relay unreachable: run start stays queued, nothing shown as done', off.state.outbox.length === 1 && off.state.conn === 'reconnecting');
off.stop();

console.log('\n== H. Scenario 1 · normal  /  Scenario 3 · sensor malfunction ==');
await post('/mock/reset');
const st2 = memoryStorage(), c2 = createBaseClient({ baseUrl: BASE, storage: st2 }); await c2.start(); await until(() => c2.state.conn === 'online');
const runN = c2.ensureRun({ scenarioId: 'myomars-normal' });
for (let i = 0; i < 3; i++) c2.submitObservation(seg('n' + i, 6), NORMAL);
await until(() => c2.activeCase().alert);
s = await state();
check('H1 normal data → GREEN "within baseline" notice, no retest, no fatigue', c2.activeCase().alert?.kind === 'ok' && !c2.activeCase().retest && ofType(s, 'station.retest.requested').length === 0 && /continue the patrol/i.test(c2.activeCase().alert.reason));
const runS = c2.ensureRun({ scenarioId: 'myomars-sensor-fault' });
await until(async () => (await state()).activeRun === runS);
s = await state();
check('H2 switching scenario resets the old run (scenario.reset) and starts a new one', s.endedRuns.includes(runN) && runS !== runN && !c2.activeCase().alert);
c2.submitObservation(seg('f1', 6), FAULT); c2.submitObservation(seg('f2', 6), FAULT);
await until(() => c2.activeCase().alert);
s = await state();
const sc = s.cases.find(x => x.caseId === runS + '-lq');
check('H3 corrupted patch data → RED sensor-fault notice; no retest request', c2.activeCase().alert?.kind === 'sensor' && !c2.activeCase().retest && /not a muscle finding/.test(c2.activeCase().alert.reason));
check('H4 corrupted segments are never read as fatigue (quality failed, no pattern)', sc.observations.every(o => o.quality === 'poor-signal' && o.pattern === null) && !s.audit.some(a => a.action === 'deviation-candidate'));
c2.submitObservation(seg('v1', 5), NORMAL); c2.submitObservation(seg('v2', 5), NORMAL);
await until(() => c2.activeCase().alert?.status === 'closed');
s = await state();
const last = ofType(s, 'station.reassessment').at(-1);
check('H5 after reconnection, valid segments verify the patch → case closed (signal restored)', c2.activeCase().alert.status === 'closed' && last.payload.outcome === 'signal-restored' && last.payload.reviewDecision === 'close');
const bad2 = s.events.filter(d => C.checkMessage(CONTRACT, d, { delivered: true, role: d.sender.role }).length);
check('H6 all scenario messages conform to contracts v1', bad2.length === 0, s.events.length + ' messages');
c2.stop();

c.stop(); await stop();
const failed = results.filter(x => !x.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
fs.writeFileSync(new URL('./joint-test-result.json', import.meta.url), JSON.stringify({ runAt: new Date().toISOString(), node: process.version, contract: 'myomars/v1 (contracts-v1 @ ' + fs.readFileSync(new URL('../contracts-v1/SOURCE_COMMIT', import.meta.url), 'utf8').trim() + ')', relay: 'mock', results }, null, 2));
process.exit(failed.length ? 1 : 0);
