// Page-level joint test: runs the real hud.html script (with a minimal DOM stub) against the mock base,
// clicking the same buttons a judge would and reading what the HUD renders.
// Run: node test/hud-page-test.mjs
process.env.REASSESS_MS = '600';
process.env.REVIEW_MS = '300';
import fs from 'node:fs';
const { start } = await import('../server/mock-base.mjs');
await import('../hud/base-client.js');
const { createBaseClient, memoryStorage } = globalThis.MyoMarsBaseClient;
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
    innerWidth: 1440, innerHeight: 900, addEventListener() {}, requestAnimationFrame() {}, performance, localStorage: storage, location: { origin: BASE, protocol: 'http:', reload() {} }, MyoMarsBaseClient: { createBaseClient },
    fetch: (u, o) => fetch(/^https?:/.test(u) ? u : BASE + '/' + u, o), setInterval: () => 0 };
  g.window = g;
  const fn = new Function(...Object.keys(g), js);
  fn(...Object.values(g));
  return g.window.__hud;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(40); } return false; }
const post = p => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
const state = () => fetch(BASE + '/mock/state').then(r => r.json());
const has = (id, btn) => els[id] && els[id].innerHTML.includes('id="' + btn + '"');
const text = id => (els[id]?.innerHTML || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const results = []; const check = (n, ok, d = '') => { results.push({ name: n, ok: !!ok, detail: d }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  — ' + d : '')); };

let hud = boot();
els.bStart.onclick();
await until(() => hud.client.state.conn === 'online');
check('P1 页面连接基站并显示连接状态', els.linkChip.innerHTML.includes('Online'), text('linkChip'));
check('P2 基站未发布时只显示自动监测与空告警', text('status').startsWith('Auto-monitoring · last sync') && text('alert') === 'No alerts published by base');
await until(() => hud.walkReady);
hud.emitSegment(3, 6);                                   // too short: base quality check should not use it
for (let i = 0; i < 3; i++) hud.emitSegment(6, 20);
await until(() => hud.client.monitorState().uploaded === 4);
let s0 = await state();
check('P2a 步行片段自动分段上传，基站做质量检查并只计入可比片段', s0.segments.length === 4 && s0.segments.filter(x => x.comparable).length === 3 && s0.segments[0].quality === 'too-short', s0.segments.map(x => x.quality + (x.comparable ? '/comparable' : '')).join(', '));
check('P2b 正常巡检显示「Auto-monitoring · 最近同步时间」', /^Auto-monitoring · last sync \d\d:\d\d:\d\d UTC$/.test(text('status')), text('status'));
await until(() => has('rcBody', 'bView'));
s0 = await state();
check('P2c 偏离经基站复核批准后才下发（审计可见）', s0.audit.some(x => x.action === 'deviation-detected') && s0.audit.some(x => x.action === 'approve' && x.object === 'ALT-001'));
check('P3 批准后告警卡显示原因 / 下一步 / 数据时间', /Reason.+Next.+Data time \d\d:\d\d:\d\d UTC/.test(text('alert')), text('alert').slice(0, 90) + '…');
check('P4 状态行显示「Base recommends in-habitat retest · Left quadriceps · View task」', text('status') === 'Base recommends in-habitat retest · Left quadriceps · View task' && has('status', 'bViewTask'), text('status'));
await until(() => text('alert').includes('sent ✓'));
check('P5 告警卡显示端侧接收回执已回传，人员确认按钮仍在', text('alert').includes('sent ✓') && has('alert', 'bAck'));
await hud.actAck(); let s = await state();
check('P6 点击「确认收到」后单独回传人员确认', text('alert').includes('Acknowledged v1 (not task completion)') && !!s.acks['ALT-001@1']);
els.bView.onclick();
check('P7 查看后出现「开始复测」「暂缓」', has('rcBody', 'bGo') && has('rcBody', 'bDefer'));
els.bDefer.onclick(); (els.deferReason ||= el('deferReason')).value = '';
await els.bDeferOk.onclick();
check('P8 未选原因时暂缓不生效并提示', text('rcBody').includes('Please choose a reason to defer') && (await state()).retests['RT-001'].status === 'requested');
els.deferReason.value = 'Patrol task in progress'; await els.bDeferOk.onclick(); s = await state();
check('P9 选择原因后暂缓回到基站', s.retests['RT-001'].status === 'deferred' && text('rcBody').includes('Defer reason: Patrol task in progress'));
await els.bGo.onclick();
check('P10 开始复测：基站 accept 后进入采集，出现「中止复测」', hud.S.phase === 'collecting' && has('rcBody', 'bAbort') && (await state()).retests['RT-001'].status === 'accepted');

console.log('— 刷新页面（采集中）');
hud.client.stop(); hud = boot(); els.bStart.onclick();
await until(() => hud.client.state.conn === 'online' && has('rcBody', 'bRecollect'));
check('P11 刷新后恢复当前任务（采集中断 → 重新采集）', has('rcBody', 'bRecollect') && text('alert').includes('Acknowledged v1'));
els.bRecollect.onclick();
await until(() => has('rcBody', 'bSubmit'), 8000);
check('P12 采集完成后显示待提交的模拟结果（含单位）', text('rcBody').includes('SIMULATED') && text('rcBody').includes('62 deg') && text('status') === 'Retest captured · result ready to submit');
els.bLink.onclick();                                   // go offline before submitting
await until(() => hud.client.state.conn === 'offline');
els.bSubmit.onclick();
hud.emitSegment(6, 20);                                  // walking continues while offline
check('P13 断链：显示「Recording locally · pending upload」，结果与片段只在本地排队', text('status').startsWith('Recording locally · pending upload') && text('rcBody').includes('offline, will submit when reconnected') && hud.client.state.outbox.length === 2, text('status'));
els.bLink.onclick();
await until(() => /Result received by base|Awaiting base reassessment|Final/.test(text('rcBody')));
await until(() => hud.client.monitorState().uploaded === 5);
check('P14 恢复连接后自动补传结果与片段，显示基站已接收 / 等待重评', /Result received by base|Awaiting base reassessment/.test(text('rcBody')) && hud.client.monitorState().uploaded === 5 && hud.client.state.outbox.length === 0, text('status'));
await until(() => text('rcBody').includes('Final'));
check('P15 重评送达：原告警更新为 v2，显示最终处理且案例未关闭', text('alert').includes('v2 · Reassessed') && text('rcBody').includes('does not close the case'));
check('P16 v2 需要重新人员确认', has('alert', 'bAck'));
await post('/mock/duplicate'); await post('/mock/duplicate'); await sleep(150);
check('P17 重复消息不产生重复任务', Object.keys(hud.client.state.retests).length === 1 && hud.client.state.duplicates >= 2);
await post('/mock/close'); await until(() => text('rcBody').includes('Case closed by base'));
check('P18 基站关闭案例后显示已关闭，自动监测继续', text('rcBody').includes('Case closed by base') && text('status').startsWith('Auto-monitoring'));
els.thigh.onclick();
check('P19 左腿小卡显示基站发布的前后结论', text('legCard').includes('Retest shift reduced') && text('legCard').includes('EMG deviates from personal baseline'));

hud.client.stop(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
fs.writeFileSync(new URL('./hud-page-test-result.json', import.meta.url), JSON.stringify({ runAt: new Date().toISOString(), node: process.version, base: 'mock (SRS v0.1 draft)', results }, null, 2));
process.exit(failed.length ? 1 : 0);
