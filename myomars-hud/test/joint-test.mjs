// Joint test: HUD base client (hud/base-client.js) against the mock base (server/mock-base.mjs).
// Run: node test/joint-test.mjs     (Node ≥ 22: global fetch + WebSocket)
process.env.REASSESS_MS = '600';
process.env.REVIEW_MS = '300';
const { start } = await import('../server/mock-base.mjs');
await import('../hud/base-client.js');
const { createBaseClient, memoryStorage } = globalThis.MyoMarsBaseClient;
import fs from 'node:fs';

const server = await start(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const SAMPLE = JSON.parse(fs.readFileSync(new URL('../contract/samples/retest-result.sample.json', import.meta.url)));
const WALK = JSON.parse(fs.readFileSync(new URL('../contract/samples/walking-segment.sample.json', import.meta.url)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40); } return false; }
const post = (p, b = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const state = () => fetch(BASE + '/mock/state').then(r => r.json());
const storage = memoryStorage();                       // shared across client instances = same browser localStorage
const mk = () => createBaseClient({ baseUrl: BASE, crewId: 'A-02', storage });

console.log('\n== A. 审核前 / 批准后送达 ==');
let c = mk(); await c.start();
await until(() => c.state.conn === 'online');
check('A1 连接基站成功', c.state.conn === 'online');
check('A2 基站未批准时 HUD 无任何健康内容', Object.keys(c.state.alerts).length === 0 && Object.keys(c.state.retests).length === 0);
await post('/mock/approve');
await until(() => c.activeCase().retest);
let { alert, retest } = c.activeCase();
check('A3 批准后 HUD 收到告警与复测任务', alert?.alertId === 'ALT-001' && retest?.retestId === 'RT-001', `alert v${alert?.version}, retest ${retest?.status}`);
await until(async () => Object.keys((await state()).receipts).length === 2);
let s = await state();
check('A4 两条消息均自动回传端侧接收回执', Object.keys(s.receipts).length === 2 && c.receiptState(alert.messageId) === 'confirmed');
check('A5 接收回执不等于人员确认（基站尚无确认记录）', Object.keys(s.acks).length === 0);

console.log('\n== B. 人员确认 / 暂缓 ==');
let r = await c.ack('ALT-001'); s = await state();
check('B1 点击确认后单独回传人员确认', r.ok && s.acks['ALT-001@1'] && c.ackState(c.activeCase().alert).status === 'confirmed');
check('B2 确认收到不改变任务/案例状态', s.alerts['ALT-001'].status === 'published' && s.retests['RT-001'].status === 'requested');
r = await c.respond('RT-001', 'defer', '');
check('B3 暂缓缺少原因时被拒绝，HUD 不显示成功', !r.ok && r.error === 'reason-required');
r = await c.respond('RT-001', 'defer', '巡检任务进行中'); s = await state();
check('B4 暂缓与原因回到正确案例', r.ok && s.retests['RT-001'].status === 'deferred' && s.retests['RT-001'].deferReason === '巡检任务进行中' && s.retests['RT-001'].alertId === 'ALT-001');
r = await c.respond('RT-001', 'accept');
check('B5 进入获准复测任务（accept）', r.ok && c.activeCase().retest.status === 'accepted');

console.log('\n== C. 刷新恢复 / 重复消息 ==');
c.stop(); c = mk(); await c.start(); await until(() => c.state.conn === 'online');
({ alert, retest } = c.activeCase());
check('C1 刷新后恢复当前任务与确认状态', retest?.status === 'accepted' && c.ackState(alert)?.status === 'confirmed', `retest ${retest?.status}, ack ${c.ackState(alert)?.status}`);
const before = Object.keys(c.state.retests).length, dupBefore = c.state.duplicates;
await post('/mock/duplicate'); await post('/mock/duplicate'); await sleep(200);
check('C2 重复投递不产生重复任务', Object.keys(c.state.retests).length === before && c.state.duplicates >= dupBefore + 2, `duplicates ignored: ${c.state.duplicates - dupBefore}`);

console.log('\n== D. 断线提交 / 重连补传 ==');
c.disconnect();
r = c.submitResult('RT-001', SAMPLE); s = await state();
check('D1 离线时结果标记为待提交，不显示成功', r.pending && c.resultStatus(c.activeCase().retest) === 'pending' && Object.keys(s.uploads).length === 0);
c.stop(); c = mk(); await c.start();                     // refresh while the result is still queued
check('D2 刷新后待提交结果仍在本地队列', c.state.outbox.length === 1);
await until(() => c.resultStatus(c.activeCase().retest) && c.resultStatus(c.activeCase().retest) !== 'pending');
s = await state(); const up = Object.values(s.uploads)[0];
check('D3 重连后自动补传并收到服务回执', ['persisted', 'received', 'reassessing', 'completed'].includes(c.resultStatus(c.activeCase().retest)) && c.state.outbox.length === 0);
check('D4 结果关联原案例、轮次与 retestId，且标注 simulated', up?.payload.alertId === 'ALT-001' && up?.payload.round === 1 && up?.payload.retestId === 'RT-001' && up?.payload.simulated === true, JSON.stringify({ alertId: up?.payload.alertId, round: up?.payload.round, retestId: up?.payload.retestId, sampleId: up?.payload.sampleId }));
check('D5 同一结果只入库一次', Object.keys(s.uploads).length === 1);
await until(() => c.activeCase().retest.status === 'reassessing' || c.activeCase().retest.status === 'completed');
check('D6 显示等待重评', ['reassessing', 'completed'].includes(c.resultStatus(c.activeCase().retest)));
await until(() => c.activeCase().alert.version === 2);
({ alert, retest } = c.activeCase());
check('D7 重评结果送达原告警（v2），任务完成但案例未关闭', alert.version === 2 && alert.status === 'reassessed' && retest.status === 'completed' && alert.basedOn?.retestId === 'RT-001');
check('D8 新版本告警需重新人员确认', c.ackState(alert) === null);
await c.ack('ALT-001');
await post('/mock/close'); await until(() => c.state.alerts['ALT-001'].status === 'closed');
check('D9 案例只在基站关闭后显示已关闭', c.state.alerts['ALT-001'].status === 'closed');

console.log('\n== E. 中止 / 拒绝 / 无服务回执 ==');
await post('/mock/reset'); c.stop(); c = mk(); await c.start(); await until(() => c.state.conn === 'online');
check('E1 基站重置后本地旧案例被清空', Object.keys(c.state.alerts).length === 0);
await post('/mock/approve'); await until(() => c.activeCase().retest);
await c.respond('RT-001', 'accept');
r = await c.respond('RT-001', 'abort', '宇航员中止');
check('E2 中止复测回到基站', r.ok && c.activeCase().retest.status === 'aborted');
r = await c.respond('RT-001', 'accept');
check('E3 中止后可重新开始（同一 round）', r.ok && c.activeCase().retest.status === 'accepted' && c.activeCase().retest.round === 1);
const bad = { ...SAMPLE, metrics: SAMPLE.metrics.map(m => m.name === 'knee_flexion_peak' ? { ...m, unit: 'rad' } : m) };
c.submitResult('RT-001', bad);
await until(() => c.resultStatus(c.activeCase().retest) === 'rejected');
check('E4 单位与协议不一致的结果被拒绝，HUD 显示拒绝而非成功', c.resultStatus(c.activeCase().retest) === 'rejected');
c.submitResult('RT-001', SAMPLE);
await until(() => ['persisted', 'received', 'reassessing', 'completed'].includes(c.resultStatus(c.activeCase().retest)));
check('E5 改用协议样例重新提交成功', ['persisted', 'received', 'reassessing', 'completed'].includes(c.resultStatus(c.activeCase().retest)));
const offline = createBaseClient({ baseUrl: 'http://127.0.0.1:1', crewId: 'A-02', storage: memoryStorage(), WS: null });
await offline.start(); offline.state.alerts.X = { alertId: 'X', version: 1 };
r = await offline.ack('X');
check('E6 服务不可达时确认显示失败，不显示成功', !r.ok && offline.ackState(offline.state.alerts.X).status === 'failed');
offline.stop();

console.log('\n== F. 自动巡检监测 ==');
await post('/mock/reset'); c.stop(); c = mk(); await c.start(); await until(() => c.state.conn === 'online');
const COND = { task: 'EVA patrol', load: 'standard suit', terrain: 'flat regolith' };
const seg = (id, sec, cond = COND) => ({ segmentId: id, startedAt: new Date(Date.now() - sec * 1000).toISOString(), endedAt: new Date().toISOString(), durationSec: sec, steps: Math.round(sec * 3.4), cadenceSpm: 102, condition: cond });
c.submitSegment(seg('S1', 6), WALK); c.submitSegment(seg('S1', 6), WALK);
await until(() => c.monitorState().uploaded === 1); s = await state();
check('F1 片段自动上传并收到服务回执；同一片段只入库一次', c.monitorState().uploaded === 1 && s.segments.length === 1);
c.submitSegment(seg('S2', 3), WALK); c.submitSegment(seg('S3', 6, { ...COND, terrain: 'rocky slope' }), WALK);
await until(() => c.monitorState().uploaded === 3); s = await state();
check('F2 质量不合格或条件不可比的片段不计入趋势', s.segments.filter(x => x.comparable).length === 1 && s.segments.find(x => x.segmentId === 'S2').quality === 'too-short' && !s.segments.find(x => x.segmentId === 'S3').comparable);
c.submitSegment(seg('S4', 6), { ...WALK, metrics: WALK.metrics.map(m => ({ ...m, unit: 'mV' })) });
await until(() => c.state.segments.S4?.status === 'rejected');
check('F3 单位与协议不一致的片段被拒绝', c.state.segments.S4.status === 'rejected' && c.state.segments.S4.error === 'unit-mismatch');
c.disconnect(); c.submitSegment(seg('S5', 6), WALK); c.submitSegment(seg('S6', 6), WALK);
check('F4 断链时片段在本地排队（待上传）', c.monitorState().pending === 2 && c.state.outbox.length === 2);
check('F5 少于触发数量时基站不发布任何内容', Object.keys(c.state.alerts).length === 0);
await c.reconnect();
await until(() => c.monitorState().pending === 0 && c.monitorState().uploaded === 5);
check('F6 恢复后自动补传', c.monitorState().uploaded === 5 && c.state.outbox.length === 0);
await until(() => c.activeCase().retest, 3000);
({ alert, retest } = c.activeCase()); s = await state();
check('F7 可比片段达到阈值 → 基站复核批准 → 下发回舱复测任务', alert?.basis?.segments?.length === 3 && retest?.setting === 'in-habitat' && retest?.bodySite === 'Left quadriceps' && s.audit.some(x => x.action === 'deviation-detected'));
check('F8 复测任务需宇航员确认后才开始', retest.status === 'requested');

c.stop(); server.close();
const failed = results.filter(x => !x.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
fs.mkdirSync(new URL('../test/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../test/joint-test-result.json', import.meta.url), JSON.stringify({ runAt: new Date().toISOString(), node: process.version, base: 'mock (SRS v0.1 draft)', results }, null, 2));
process.exit(failed.length ? 1 : 0);
