// MyoMars TWO-END acceptance on the REAL pages: Mars Station (relay mode) + HUD (integration mode),
// through the local relay. Observations come from the data replay module (SIMULATED samples, not the
// health-data teammate's data). Covers: observation → analysis → human approval → HUD receipt and
// astronaut confirmation → retest result → re-evaluation → human close / keep watching → HUD final
// status; refresh recovery, duplicates, old-run isolation, multiple station windows, missing grip.
//
// Needs, on one machine:
//   npm run relay -- --static myomars-hud          (relay on 8787, serves the HUD; fresh session)
//   npm run dev  (or npm start after a build)       (station on 3000)
// Then:  node scripts/e2e-two-end.mjs
//   STATION=http://localhost:3000/?relay=auto  RELAY=http://127.0.0.1:8787  OUT=/dir (screenshots)
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const D = process.env.OUT ?? null;
if (D) mkdirSync(D, { recursive: true });
const RELAY = process.env.RELAY ?? "http://127.0.0.1:8787";
const STATION = process.env.STATION ?? "http://localhost:3000/?relay=auto";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const log = (m) => console.log(`      ${m}`);
const history = async () => (await (await fetch(`${RELAY}/v1/sessions/demo/events?after=0`)).json());
const openDrawer = async (pg) => { if (await pg.getByTestId("person-panel").isVisible().catch(() => false)) { await pg.keyboard.press("Escape"); await pg.waitForTimeout(300); } if (!(await pg.getByTestId("relay-dev-drawer").isVisible().catch(() => false))) await pg.getByTestId("demo-toggle").click(); };
const evs = async () => (await history()).events;
const byRole = (list, role) => list.filter((e) => e.sender.role === role);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const errs = [];
const watch = (n, pg) => {
  pg.on("pageerror", (e) => errs.push(`${n}: ${e}`));
  pg.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_ABORTED|net::/.test(m.text()) && errs.push(`${n} console: ${m.text()}`));
};

// ---------- station + HUD online ----------
const st = await ctx.newPage();
watch("station", st);
await st.goto(STATION, { waitUntil: "domcontentloaded" });
await st.waitForSelector('[data-testid="station-link"][data-conn="online"]', { timeout: 30000 });
await st.waitForSelector('[data-testid="station-lease"][data-lease="holder"]', { timeout: 15000 });
check("station online and lease holder", true, await st.getByTestId("integration-banner").textContent());

const hud = await ctx.newPage();
watch("hud", hud);
await hud.goto(`${RELAY}/`, { waitUntil: "load" });
check("relay root opens the HUD in integration mode", hud.url().endsWith("/hud.html?mode=integration"), hud.url());
await hud.locator("#bJoin").click();
await hud.waitForFunction(() => window.__hud?.client.state.conn === "online", null, { timeout: 15000 });
const hudText = () => hud.evaluate(() => document.body.innerText);
const hudStatus = () => hud.evaluate(() => document.getElementById("status").innerText + " | " + document.getElementById("level").innerText);

// ---------- run started by the data replay (station dev entry) ----------
await openDrawer(st);
await st.getByTestId("relay-dev-start").click();
await hud.waitForFunction(() => !!window.__hud.client.activeCase().run, null, { timeout: 15000 });
const run1 = await hud.evaluate(() => window.__hud.client.activeCase().run.runId);
check("HUD joined the run started by the data replay", /^run-rp-/.test(run1), `${run1} · ${await hud.evaluate(() => document.getElementById("scnName").innerText)}`);
log(`station drawer checklist: ${(await st.getByTestId("relay-dev-check").innerText()).replace(/\n/g, " / ").slice(0, 300)}…`);
if (D) await st.screenshot({ path: `${D}/1-station-replay-drawer.png` });

// ---------- step 1: observation → analysis → human approval ----------
await st.getByTestId("relay-dev-fixture").selectOption("change");
await st.getByTestId("relay-dev-inject-open").click();
await st.waitForFunction(() => document.querySelector('[data-testid="flow-canvas"]')?.dataset.phase === "end", null, { timeout: 40000 });
check("station analysed the replayed observation and stopped at human review", true, await st.getByTestId("panel-eval-status").textContent());
if (D) await st.screenshot({ path: `${D}/2-station-review.png` });
await st.getByTestId("canvas-node-review").click();
await st.getByTestId("decide-approve").click();
await st.getByTestId("reason-template").first().click();
const reason1 = await st.getByTestId("confirm-reason").inputValue();
await st.getByTestId("confirm-submit").click();
await hud.waitForFunction(() => { const a = window.__hud.client.activeCase(); return a.alert && a.retest; }, null, { timeout: 15000 });
await hud.waitForTimeout(1200);
const t1 = await hudText();
const a1 = await hud.evaluate(() => window.__hud.client.activeCase());
check("HUD received the notice and the retest task", a1.alert && a1.retest, `${a1.alert.kind} · "${a1.alert.reason.slice(0, 30)}…" · ${a1.retest.protocol.label}`);
check("HUD infers no category (kind 'notice', no fatigue / sensor wording)", a1.alert.kind === "notice" && !/fatigue|疲劳|sensor fault/i.test(t1), await hudStatus());
check("HUD adds no actions (no habitat return, no recovery or symptom steps)", !/habitat|返回舱|Recovery Guidance|Symptom Check|Medical Review/i.test(t1));
check("HUD never shows the base's internal review reason", !t1.includes(reason1), `reason "${reason1.slice(0, 24)}…"`);
check("HUD shows the requested protocol, no invented body site", t1.includes("标准握持 40% MVC · 30 s") && !/quadriceps|Left thigh|knee bend/i.test(t1), (t1.match(/.{0,30}(quadriceps|Left thigh|knee bend).{0,30}/i) || [""])[0]);
if (D) await hud.screenshot({ path: `${D}/3-hud-notice.png` });
await st.waitForFunction(() => /宇航员确认/.test(document.querySelector('[data-testid="panel-fact-where"]')?.textContent ?? ""), null, { timeout: 15000 });
check("station shows HUD device receipts, still waiting for the astronaut", true, await st.getByTestId("panel-fact-where").textContent());

// ---------- HUD: astronaut confirmation, retest, result ----------
await hud.locator("#bAck").click();
await hud.locator("#bView").click();
await hud.locator("#bGo").click();
await hud.waitForSelector("#bSubmit", { timeout: 15000 });
await st.waitForFunction(() => /等待复测结果/.test(document.querySelector('[data-testid="panel-fact-where"]')?.textContent ?? ""), null, { timeout: 15000 });
check("station shows the astronaut's confirmation (hud.ack), separate from receipts", true, await st.getByTestId("panel-fact-where").textContent());
if (D) await hud.screenshot({ path: `${D}/4-hud-retest-captured.png` });
log(`HUD result card: ${(await hud.locator("#rcBody").innerText()).replace(/\n/g, " / ")}`);
await hud.locator("#bSubmit").click();
await hud.waitForTimeout(400);
const dupSubmit = await hud.evaluate(() => window.__hud.client.submitResult(window.__hud.client.activeCase().retest.retestId, { signal: {}, features: {} }));
await hud.waitForTimeout(800);
let list = await evs();
const results1 = list.filter((e) => e.type === "retest.result" && e.runId === run1);
check("HUD submitted exactly one retest.result (repeat submit ignored)", results1.length === 1 && dupSubmit.ok, JSON.stringify(dupSubmit));
const rr = results1[0];
check("retest result: requested protocol, shared simulated values, grip present", rr.payload.observation.protocol.id === "std-grip-40" && rr.payload.observation.features.gripForceN === 156, JSON.stringify(rr.payload.observation.features));
const repost = await fetch(`${RELAY}/v1/sessions/demo/events`, { method: "POST", headers: { "content-type": "application/json", "x-myomars-role": "hud", "x-myomars-client": "hud-a02" }, body: JSON.stringify(Object.fromEntries(Object.entries(rr).filter(([k]) => !["seq", "receivedAt", "sender"].includes(k)))) }).then((r) => r.json());
check("re-posting the same result is a relay duplicate (not delivered again)", repost.duplicate === true);
await st.waitForFunction(() => /复测/.test(document.querySelector('[data-testid="panel-eval-status"]')?.textContent ?? "") && !/分析中/.test(document.querySelector('[data-testid="panel-eval-status"]')?.textContent ?? ""), null, { timeout: 30000 });
list = await evs();
check("station re-evaluated (v2) and sent one receipt for the result", list.filter((e) => e.type === "station.receipt" && e.payload.receivedEventId === rr.eventId).length === 1, await st.getByTestId("panel-eval-status").textContent());

// ---------- refresh recovery + multiple station windows ----------
const stationBefore = byRole(list, "station").length;
await st.reload({ waitUntil: "domcontentloaded" });
await st.waitForSelector('[data-testid="station-lease"][data-lease="holder"]', { timeout: 15000 });
await st.locator('[data-crew-card="a-02"]').click();
await st.waitForSelector('[data-testid="panel-eval-status"]', { timeout: 15000 });
await st.waitForTimeout(1500);
list = await evs();
check("station reload restores the case and re-sends nothing", byRole(list, "station").length === stationBefore, `${await st.getByTestId("panel-eval-status").textContent()} · station messages ${stationBefore} → ${byRole(list, "station").length}`);
const st2 = await ctx.newPage();
watch("station-2", st2);
await st2.goto(STATION, { waitUntil: "domcontentloaded" });
await st2.waitForSelector('[data-testid="station-lease"][data-lease="readonly"]', { timeout: 20000 });
check("second station window is a read-only mirror", true, await st2.getByTestId("station-lease").textContent());

// ---------- step 2: human close → HUD final status ----------
if (D) await st.screenshot({ path: `${D}/5-station-v2.png` });
if (!(await st.getByTestId("decide-close").isVisible().catch(() => false))) await st.getByTestId("canvas-node-review").click().catch(() => {});
await st.getByTestId("decide-close").click();
await st.getByTestId("reason-template").first().click();
const reason2 = await st.getByTestId("confirm-reason").inputValue();
await st.getByTestId("confirm-submit").click();
await hud.waitForFunction(() => window.__hud.client.activeCase().alert?.status === "closed", null, { timeout: 15000 });
await hud.waitForTimeout(800);
const t2 = await hudText();
check("HUD shows the final status from the base (case closed)", /Case closed by base/.test(await hudStatus()), await hudStatus());
check("HUD final view still hides internal reasons", !t2.includes(reason2) && !t2.includes(reason1));
if (D) await hud.screenshot({ path: `${D}/6-hud-closed.png` });
await hud.locator("#bAck").click();   // the astronaut acknowledges the final status update
await hud.waitForFunction(() => window.__hud.client.ackState(window.__hud.client.activeCase().alert)?.status === "confirmed", null, { timeout: 10000 });
check("astronaut acknowledged the final status (hud.ack accepted by relay and station)", true);
await st.waitForTimeout(1000);
list = await evs();
const st2Sent = list.filter((e) => e.sender.role === "station" && e.sender.clientId !== list.filter((x) => x.sender.role === "station")[0].sender.clientId);
check("only one station window ever published", st2Sent.length === 0, `${new Set(byRole(list, "station").map((e) => e.sender.clientId)).size} station client(s)`);
const hudBefore = byRole(list, "hud").length;
await hud.reload({ waitUntil: "load" });
await hud.locator("#bJoin").click().catch(() => {});
await hud.waitForFunction(() => window.__hud?.client.state.conn === "online" && window.__hud.client.activeCase().alert?.status === "closed", null, { timeout: 15000 });
await hud.waitForTimeout(800);
check("HUD reload restores the final status and sends nothing new", byRole(await evs(), "hud").length === hudBefore, await hudStatus());

// ---------- single observation source ----------
list = await evs();
const producers = new Set(list.filter((e) => e.type === "observation.submitted" || e.type === "scenario.start").map((e) => e.sender.clientId));
check("one data producer: every run start and observation came from the replay", [...producers].every((c) => c.endsWith("-replay")), [...producers].join(", "));
check("HUD published only hud-role events", byRole(list, "trigger").every((e) => e.sender.clientId.endsWith("-replay")) && list.filter((e) => e.sender.clientId === "hud-a02").every((e) => e.sender.role === "hud"));

// ---------- old-round isolation ----------
await openDrawer(st);
await st.getByTestId("relay-dev-start").click();
await hud.waitForFunction((r) => window.__hud.client.activeCase().run?.runId !== r, run1, { timeout: 15000 });
const run2 = await hud.evaluate(() => window.__hud.client.activeCase().run.runId);
const notice1 = list.find((e) => e.type === "station.notice.approved" && e.runId === run1);
const late = await fetch(`${RELAY}/v1/sessions/demo/events`, { method: "POST", headers: { "content-type": "application/json", "x-myomars-role": "hud", "x-myomars-client": "hud-a02" }, body: JSON.stringify({ schema: "myomars/v1", eventId: `late-ack-${Date.now()}`, sessionId: "demo", runId: run1, caseId: notice1.caseId, sentAt: new Date().toISOString(), source: "hud", type: "hud.ack", payload: { messageId: notice1.eventId } }) });
check("a late message for the old run is refused (stale-run)", late.status === 409 && (await late.json()).error === "stale-run");
const hudRun2 = await hud.evaluate(() => window.__hud.client.activeCase());
check("HUD shows the new run without the old case", hudRun2.run.runId === run2 && !hudRun2.alert && !hudRun2.retest, `${run2}`);
await st.waitForTimeout(800);
log(`station A-02 card in the new run: ${(await st.locator('[data-crew-card="a-02"]').innerText()).replace(/\n/g, " / ")}`);

// ---------- missing grip-meter reading (result completeness) ----------
await openDrawer(st);
await st.getByTestId("relay-dev-fixture").selectOption("grip-missing");
log(`checklist (grip-missing): ${(await st.getByTestId("relay-dev-check").innerText()).split("\n").filter((l) => /缺失|假设/.test(l)).join(" / ")}`);
await st.getByTestId("relay-dev-inject-open").click();
await st.waitForFunction(() => /结果不完整/.test(document.querySelector('[data-testid="panel-eval-status"]')?.textContent ?? ""), null, { timeout: 40000 });
list = await evs();
const gm = list.filter((e) => e.type === "observation.submitted" && e.runId === run2).at(-1);
check("missing grip: published as null, station reports an incomplete result", gm.payload.features.gripForceN === null, await st.getByTestId("panel-eval-status").textContent());
await st.waitForFunction(() => document.querySelector('[data-testid="flow-canvas"]')?.dataset.phase === "end", null, { timeout: 40000 });
if (D) await st.screenshot({ path: `${D}/7-station-incomplete.png` });

// ---------- keep watching path (retest still changed) ----------
await hud.goto(`${RELAY}/hud.html?mode=integration&retestSample=retest-changed`, { waitUntil: "load" });
await hud.locator("#bJoin").click();
await hud.waitForFunction(() => window.__hud?.client.state.conn === "online", null, { timeout: 15000 });
await openDrawer(st);
await st.getByTestId("relay-dev-fixture").selectOption("change");
await st.getByTestId("relay-dev-inject-open").click();
await st.waitForTimeout(800);
const case3 = (await evs()).filter((e) => e.type === "observation.submitted").at(-1).caseId;
await st.getByTestId(`panel-case-${case3}`).click();   // the open grip-missing case is shown first; pick the new one
await st.waitForFunction(() => /超出个体基线/.test(document.querySelector('[data-testid="panel-eval-status"]')?.textContent ?? ""), null, { timeout: 40000 });
await st.waitForFunction(() => document.querySelector('[data-testid="flow-canvas"]')?.dataset.phase === "end", null, { timeout: 40000 });
await st.getByTestId("canvas-node-review").click();
await st.getByTestId("decide-approve").click();
await st.getByTestId("reason-template").first().click();
await st.getByTestId("confirm-submit").click();
await hud.waitForFunction(() => window.__hud.client.activeCase().retest, null, { timeout: 15000 });
await hud.locator("#bAck").click();
await hud.locator("#bView").click();
await hud.locator("#bGo").click();
await hud.waitForSelector("#bSubmit", { timeout: 15000 });
await hud.locator("#bSubmit").click();
await st.waitForFunction(() => /复测仍超出|v2/.test(document.querySelector('[data-testid="panel-eval-status"]')?.textContent ?? "") && !/分析中/.test(document.querySelector('[data-testid="panel-eval-status"]')?.textContent ?? ""), null, { timeout: 40000 });
log(`station v2: ${await st.getByTestId("panel-eval-status").textContent()}`);
if (!(await st.getByTestId("decide-keep-open").isVisible().catch(() => false))) await st.getByTestId("canvas-node-review").click().catch(() => {});
await st.getByTestId("decide-keep-open").click();
await st.getByTestId("reason-template").first().click();
await st.getByTestId("confirm-submit").click();
await hud.waitForFunction(() => window.__hud.client.activeCase().alert?.status === "reassessed", null, { timeout: 15000 });
await hud.waitForTimeout(600);
check("keep watching: HUD shows the base's status update, case not closed", /Base update/.test(await hudStatus()), await hudStatus());
if (D) await hud.screenshot({ path: `${D}/8-hud-keep-open.png` });

list = await evs();
const hudRejected = await hud.evaluate(() => window.__hud.client.state.rejected.length + window.__hud.client.state.invalid);
check("no HUD message refused by the relay, no invalid deliveries", hudRejected === 0);
check("no page errors", errs.length === 0, errs.join(" | "));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed · relay events ${list.length}`);
await b.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
