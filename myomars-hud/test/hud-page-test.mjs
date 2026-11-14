// Page-level joint test on contracts myomars/v1: runs the real hud.html script (minimal DOM stub) against the
// mock relay + station, clicking what a judge would click and reading what the HUD renders.
// Run: node test/hud-page-test.mjs
process.env.REASSESS_MS = '600';
process.env.REVIEW_MS = '300';
import fs from 'node:fs';
const { start, stop, CONTRACT } = await import('../server/mock-base.mjs');
await import('../hud/base-client.js');
const { createBaseClient, memoryStorage } = globalThis.MyoMarsBaseClient;
const C = globalThis.MyoMarsContract;
const server = await start(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const html = fs.readFileSync(new URL('../hud.html', import.meta.url), 'utf8');
const js = html.match(/<script id="hud-main">([\s\S]*)<\/script>/)[1];

const els = {};
const el = id => ({ id, innerHTML: '', textContent: '', className: '', disabled: false, hidden: false, value: '', style: {}, dataset: {}, clientWidth: 500, width: 120, height: 120, firstChild: {},
  classList: { toggle() {}, add() {}, remove() {}, replace() {} }, querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), getContext: () => new Proxy({}, { get: () => () => {} }) });
const storage = memoryStorage();
function boot() {
  for (const k in els) delete els[k];
  const g = { document: { getElementById: id => els[id] || (els[id] = el(id)), createElement: () => el('x'), querySelector: () => null, body: el('body') },
    innerWidth: 1440, innerHeight: 900, addEventListener() {}, requestAnimationFrame() {}, performance, localStorage: storage,
    location: { origin: BASE, protocol: 'http:', reload() {} }, MyoMarsBaseClient: { createBaseClient },
    fetch: (u, o) => fetch(/^https?:/.test(u) ? u : BASE + '/' + u, o), setInterval: () => 0 };
  g.window = g;
  new Function(...Object.keys(g), js)(...Object.values(g));
  return g.window.__hud;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(40); } return false; }
const post = p => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
const state = () => fetch(BASE + '/mock/state').then(r => r.json());
const ofType = (s, t) => s.events.filter(e => e.type === t);
const has = (id, btn) => els[id] && els[id].innerHTML.includes('id="' + btn + '"');
const text = id => (els[id]?.innerHTML || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const results = []; const check = (n, ok, d = '') => { results.push({ name: n, ok: !!ok, detail: d }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); };

let hud = boot();
await until(() => hud.client.state.conn === 'online');
check('P1 page connects to the relay stream and shows link state', els.linkChip.innerHTML.includes('Online'), text('linkChip'));
els.bStart.onclick();
await until(async () => (await state()).activeRun);
check('P2 "Start patrol" starts a run (scenario.start from the local device)', ofType(await state(), 'scenario.start').length === 1);
check('P3 nothing published yet: auto-monitoring status, empty alert', text('status').startsWith('Auto-monitoring · last sync') && text('alert') === 'No alerts published by base');
await until(() => hud.walkReady);
hud.emitSegment(3, 6);
for (let i = 0; i < 3; i++) hud.emitSegment(6, 20);
await until(() => hud.client.monitorState().uploaded === 4);
let s = await state();
check('P4 walking segments become observation.submitted; station uses only valid comparable ones', ofType(s, 'observation.submitted').length === 4 && s.cases[0].observations.filter(o => o.comparable).length === 3);
check('P5 normal patrol shows "Auto-monitoring · last sync HH:MM:SS UTC"', /^Auto-monitoring · last sync \d\d:\d\d:\d\d UTC$/.test(text('status')), text('status'));
await until(() => has('rcBody', 'bView'));
check('P6 after human approval: "Base recommends in-habitat retest · Left quadriceps · View task"', text('status') === 'Base recommends in-habitat retest · Left quadriceps · View task' && has('status', 'bViewTask'), text('status'));
check('P7 alert card shows station reason, next step and data time', /Reason Base notice:.+Next Return to the habitat.+Data time \d\d:\d\d:\d\d UTC/.test(text('alert')), text('alert').slice(0, 100) + '…');
await until(() => text('alert').includes('Device receipt: sent ✓'));
check('P8 device receipt (hud.received) sent automatically; Acknowledge still offered', text('alert').includes('Device receipt: sent ✓') && has('alert', 'bAck') && ofType(await state(), 'hud.ack').length === 0);
await hud.actAck(); s = await state();
check('P9 Acknowledge publishes hud.ack for the notice', text('alert').includes('Acknowledged v1 (not task completion)') && ofType(s, 'hud.ack')[0].payload.messageId === ofType(s, 'station.notice.approved')[0].eventId);
els.bView.onclick();
check('P10 View task opens Start retest / Defer', has('rcBody', 'bGo') && has('rcBody', 'bDefer'));
els.bDefer.onclick(); (els.deferReason ||= el('deferReason')).value = '';
await els.bDeferOk.onclick();
check('P11 defer without a reason is blocked', text('rcBody').includes('Please choose a reason to defer') && ofType(await state(), 'hud.defer').length === 0);
els.deferReason.value = 'Patrol task in progress'; await els.bDeferOk.onclick(); s = await state();
check('P12 defer publishes hud.defer with the reason for the retest request', ofType(s, 'hud.defer')[0]?.payload.reason === 'Patrol task in progress' && text('rcBody').includes('Defer reason: Patrol task in progress'));
await els.bGo.onclick();
check('P13 Start retest: hud.ack on the request, capture begins, Abort offered', hud.S.phase === 'collecting' && has('rcBody', 'bAbort') && ofType(await state(), 'hud.ack').length === 2);
await els.bAbort.onclick();
check('P14 Abort is local only (no protocol event); card offers Restart', hud.S.phase !== 'collecting' && text('rcBody').includes('Aborted · can restart') && has('rcBody', 'bGo'));
await els.bGo.onclick();
check('P15 Restart begins a new capture without a second hud.ack', hud.S.phase === 'collecting' && ofType(await state(), 'hud.ack').length === 2);

console.log('— reload during capture');
hud.client.stop(); hud = boot();
await until(() => hud.client.state.conn === 'online' && has('rcBody', 'bRecollect'));
check('P16 reload restores the task (capture interrupted → capture again) and the acknowledgement', has('rcBody', 'bRecollect') && text('alert').includes('Acknowledged v1'));
els.bRecollect.onclick();
await until(() => has('rcBody', 'bSubmit'), 9000);
check('P17 captured result shown as SIMULATED with units, ready to submit', text('rcBody').includes('SIMULATED') && text('rcBody').includes('86 Hz') && text('status') === 'Retest captured · result ready to submit');
els.bLink.onclick(); await until(() => hud.client.state.conn === 'offline');
els.bSubmit.onclick(); hud.emitSegment(6, 20);
check('P18 offline: "Recording locally · pending upload", result and segment queued, nothing shown as received', text('status').startsWith('Recording locally · pending upload') && hud.client.state.outbox.length === 2 && text('rcBody').includes('offline, will submit when reconnected'), text('status'));
els.bLink.onclick();
await until(() => /Awaiting base reassessment|Final/.test(text('rcBody')));
check('P19 reconnect: resent; station.receipt accepted → awaiting reassessment', /Awaiting base reassessment|Final/.test(text('rcBody')) && hud.client.state.outbox.length === 0 && hud.client.monitorState().uploaded === 5, text('status'));
await until(() => text('rcBody').includes('Final'));
check('P20 station.reassessment v2 updates the original alert; case not closed', text('alert').includes('v2 · Reassessed') && text('rcBody').includes('does not close the case'));
check('P21 v2 needs a new acknowledgement', has('alert', 'bAck'));
await post('/mock/duplicate'); await post('/mock/duplicate'); await sleep(150);
check('P22 duplicate deliveries create no new task', hud.client.state.duplicates >= 2 && text('rcBody').includes('Final'));
await post('/mock/close'); await until(() => text('rcBody').includes('Case closed by base'));
check('P23 station closes the case; auto-monitoring continues', text('rcBody').includes('Case closed by base') && text('status').startsWith('Auto-monitoring'));
els.thigh.onclick();
check('P24 left-thigh card shows station findings before / after', text('legCard').includes('Consistent left-quadriceps deviation') && text('legCard').includes('within personal baseline'));
s = await state();
const bad = s.events.filter(d => C.checkMessage(CONTRACT, d, { delivered: true, role: d.sender.role }).length);
check('P25 every message the page sent or received conforms to contracts v1', bad.length === 0, s.events.length + ' messages');

hud.client.stop(); await stop();
const failed = results.filter(r => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
fs.writeFileSync(new URL('./hud-page-test-result.json', import.meta.url), JSON.stringify({ runAt: new Date().toISOString(), node: process.version, contract: 'myomars/v1', relay: 'mock', results }, null, 2));
process.exit(failed.length ? 1 : 0);
