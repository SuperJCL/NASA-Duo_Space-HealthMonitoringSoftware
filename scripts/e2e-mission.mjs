// MyoMars mission integration acceptance on the REAL station page (relay mode) + the HUD page:
// task preparation on the mission map (existing Mission Glass: 2D map, 3D terrain, task selection)
// → human "开始EVA" → health monitoring → map and health views share one mission context.
// The full health loop (approval → HUD → retest → re-evaluation → close) is scripts/e2e-two-end.mjs.
//
// Needs, on one machine, a FRESH relay session:
//   npm run relay -- --static myomars-hud      (relay on 8787, serves the HUD)
//   npm run dev  (or npm start after a build)   (station on 3000)
// Then: node scripts/e2e-mission.mjs      (STATION=…, RELAY=…, OUT=/dir for screenshots)
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const D = process.env.OUT ?? null;
if (D) mkdirSync(D, { recursive: true });
const RELAY = process.env.RELAY ?? "http://127.0.0.1:8787";
const ORIGIN = new URL(process.env.STATION ?? "http://localhost:3000/?relay=auto").origin;
const STATION = process.env.STATION ?? `${ORIGIN}/?relay=auto`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const log = (m) => console.log(`      ${m}`);
const history = async () => (await (await fetch(`${RELAY}/v1/sessions/demo/events?after=0`)).json());
const evs = async () => (await history()).events;
const starts = async () => (await evs()).filter((e) => e.type === "scenario.start");

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: D ? 2 : 1 });
const errs = [];
const watch = (n, pg) => {
  pg.on("pageerror", (e) => errs.push(`${n}: ${e}`));
  pg.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_ABORTED|ERR_FAILED|net::|ChunkLoadError|Loading chunk|Failed to fetch dynamically/.test(m.text()) && errs.push(`${n} console: ${m.text()}`));
};
const shot = async (pg, name) => D && pg.screenshot({ path: `${D}/${name}.png` });
const attr = (pg, name) => pg.getByTestId("crew-station").getAttribute(name);
const view = (pg) => attr(pg, "data-view");
const phase = (pg) => attr(pg, "data-phase");
const waitPhase = (pg, p) => pg.waitForFunction((x) => document.querySelector('[data-testid="crew-station"]')?.dataset.phase === x, p, { timeout: 20000 });
const closeOverlays = async (pg) => {
  if (await pg.getByTestId("person-panel").isVisible().catch(() => false)) {
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(300);
  }
  if (await pg.getByTestId("relay-dev-drawer").isVisible().catch(() => false)) await pg.getByTestId("relay-dev-close").click();
};
const replay = async (pg, sample, open) => {
  await closeOverlays(pg);
  await pg.getByTestId("demo-toggle").click();
  await pg.getByTestId("relay-dev-fixture").selectOption(sample);
  await pg.getByTestId(open ? "relay-dev-inject-open" : "relay-dev-inject").click();
  if (!open) await pg.getByTestId("relay-dev-close").click();
};

// ---------- open the station: preparation phase, map by default ----------
const st = await ctx.newPage();
watch("station", st);
const mapRequests = [];
st.on("response", (r) => {
  const u = r.url();
  if (/\/terrain\//.test(u) || /tile|wmts|trek|arcgis|\.png|\.jpg/i.test(u)) mapRequests.push({ u, s: r.status() });
});
await st.goto(STATION, { waitUntil: "domcontentloaded" });
await st.waitForSelector('[data-testid="station-lease"][data-lease="holder"]', { timeout: 40000 });
await st.waitForSelector('[data-testid="mission-glass"]', { timeout: 60000 });
check("preparation: the mission map is the default view and nothing has started", (await view(st)) === "map" && (await phase(st)) === "preparing" && (await starts()).length === 0, `${await view(st)} / ${await phase(st)}`);

// ---------- 1. 2D and 3D open; task selection works; resources load ----------
await st.waitForSelector(".ol-viewport canvas", { timeout: 30000 });
check("2D map renders (OpenLayers canvas) with the simulated targets", (await st.locator(".ol-viewport canvas").count()) > 0 && (await st.getByTestId("mg-target-list").isVisible()));
await st.getByTestId("mg-view-3d").click();
await st.waitForSelector('[data-testid="mg-terrain"] canvas', { timeout: 60000 });
await st.waitForTimeout(2500);
const fallback3d = await st.getByTestId("mg-terrain-fallback").isVisible().catch(() => false);
const terrainOk = mapRequests.filter((r) => /\/terrain\//.test(r.u));
check("3D terrain renders from the verified CTX assets (no fallback)", !fallback3d && terrainOk.length > 0 && terrainOk.every((r) => r.s < 400), `${terrainOk.length} terrain assets, statuses ${[...new Set(terrainOk.map((r) => r.s))].join(",")}`);
await shot(st, "m1-3d-terrain");
await st.getByTestId("mg-view-2d").click();
await st.getByTestId("mg-target-sim-target-b").click();
await st.getByTestId("mg-target-sim-target-a").click();
await st.waitForTimeout(500);
const prepTask = await st.getByTestId("prep-task").getAttribute("data-task");
check("task selection on the map feeds the preparation (Target A → task-standoff-survey)", prepTask === "task-standoff-survey", await st.getByTestId("prep-task").innerText());

// ---------- 2. selecting, 2D/3D, view switches never start a run ----------
await st.getByTestId("view-health").click();
await st.getByTestId("view-map").click();
await st.getByTestId("mg-view-3d").click();
await st.waitForTimeout(800);
await st.getByTestId("mg-view-2d").click();
await st.getByTestId("prep-summary").click();
await st.waitForSelector('[data-testid="eva-start-dialog"]');
const summary = await st.getByTestId("eva-start-dialog").innerText();
await shot(st, "m2-summary");
await st.getByRole("button", { name: "取消" }).click();
check("selecting tasks, 2D/3D, switching views and opening the summary start nothing", (await starts()).length === 0 && (await phase(st)) === "preparing");
check("summary: task, simulated target, astronaut, health conditions unknown, not a real EVA", /Survey the outcrops/.test(summary) && /模拟目标/.test(summary) && /A-02/.test(summary) && /负荷、姿势、设备条件：保持未知/.test(summary) && /不代表宇航员真实出舱/.test(summary) && /不把地形、路线或任务评分转换成疲劳或健康风险/.test(summary));

// ---------- HUD joins; 3. one human start → one run → health view for the right person ----------
const hud = await ctx.newPage();
watch("hud", hud);
await hud.goto(`${RELAY}/`, { waitUntil: "load" });
await hud.locator("#bJoin").click();
await hud.waitForFunction(() => window.__hud?.client.state.conn === "online", null, { timeout: 15000 });
check("HUD waits for the base to start the EVA", /waiting for the base to start the EVA/.test(await hud.evaluate(() => document.getElementById("status").innerText)));
await st.bringToFront();
await st.getByTestId("prep-summary").click();
await st.getByTestId("eva-start-confirm").click();
await st.getByTestId("eva-start-confirm").click().catch(() => {}); // a double click must not start twice
await waitPhase(st, "eva-active");
await st.waitForTimeout(1500);
const s1 = await starts();
const run1 = s1[0]?.runId;
check("human start: exactly one scenario.start, published by the station", s1.length === 1 && s1[0].sender.role === "station" && s1[0].payload.task.id === "task-standoff-survey" && s1[0].payload.astronaut.id === "a-02", `${s1.length} start(s) · ${run1}`);
check("after the start: health monitoring shows this EVA's astronaut card", (await view(st)) === "health" && (await st.locator('[data-crew-card="a-02"]').innerText()).includes("Survey the outcrops"), await st.getByTestId("mission-task").innerText());
await hud.waitForFunction((r) => window.__hud.client.activeCase().run?.runId === r, run1, { timeout: 15000 });
check("the HUD joined the same run", true, run1);
await shot(st, "m3-health-after-start");

// ---------- events while on the map: no forced switch; the map shows them and jumps to them ----------
await st.getByTestId("view-map").click();
await replay(st, "change", false);
await st.waitForFunction(() => Number(document.querySelector('[data-testid="mission-pending"]')?.dataset.count ?? 0) > 0, null, { timeout: 40000 });
check("a new health event does not take the user away from the map", (await view(st)) === "map");
check("the map view shows the pending health event", await st.getByTestId("map-pending-a-02").isVisible(), await st.getByTestId("map-pending-a-02").innerText());
await shot(st, "m4-map-pending");
await st.getByTestId("map-pending-a-02").click();
await st.waitForSelector('[data-testid="person-panel"]');
check("clicking it opens health monitoring at that person's event", (await view(st)) === "health" && (await st.getByTestId("person-panel").getAttribute("data-astronaut")) === "a-02");

// ---------- 5. switching views keeps evaluations, receipts and drafts; nothing repeats ----------
await st.waitForFunction(() => document.querySelector('[data-testid="flow-canvas"]')?.dataset.phase === "end", null, { timeout: 40000 });
await st.getByTestId("canvas-node-review").click();
await st.getByTestId("decide-approve").click();
const DRAFT = "草稿：多项指标同向偏离，待值班长确认后批准";
await st.getByTestId("confirm-reason").fill(DRAFT);
await st.getByTestId("confirm-cancel").click();
const evalBefore = await st.getByTestId("panel-eval-status").textContent();
const seqBefore = (await history()).lastSeq;
await closeOverlays(st);
await st.getByTestId("view-map").click();
await st.waitForTimeout(1000);
await st.getByTestId("view-health").click();
await st.locator('[data-crew-card="a-02"]').click();
await st.getByTestId("canvas-node-review").click().catch(() => {});
await st.getByTestId("decide-approve").click();
const draftAfter = await st.getByTestId("confirm-reason").inputValue();
check("map ↔ health: the evaluation, the draft and the relay log are unchanged", draftAfter === DRAFT && (await st.getByTestId("panel-eval-status").textContent()) === evalBefore && (await history()).lastSeq === seqBefore, `draft "${draftAfter.slice(0, 12)}…" · lastSeq ${seqBefore} → ${(await history()).lastSeq}`);
await st.getByTestId("confirm-submit").click();
await hud.waitForFunction(() => !!window.__hud.client.activeCase().retest, null, { timeout: 15000 });
check("the approval still reaches the real HUD", true);

// ---------- 6. refresh restores the mission phase and the events; no second start ----------
const seqR = (await history()).lastSeq;
await st.reload({ waitUntil: "domcontentloaded" });
await st.waitForSelector('[data-testid="station-lease"][data-lease="holder"]', { timeout: 40000 });
await waitPhase(st, "eva-active");
await st.waitForTimeout(2000);
check("station refresh: EVA still running, same task, no new start, nothing re-sent", (await starts()).length === 1 && (await history()).lastSeq === seqR && /Survey the outcrops/.test(await st.getByTestId("mission-task").innerText()), `phase ${await phase(st)} · view ${await view(st)} · lastSeq ${seqR} → ${(await history()).lastSeq}`);
await hud.reload({ waitUntil: "load" });
await hud.locator("#bJoin").click();
await hud.waitForFunction((r) => window.__hud?.client.state.conn === "online" && window.__hud.client.activeCase().run?.runId === r && !!window.__hud.client.activeCase().retest, run1, { timeout: 15000 });
check("HUD refresh: same run and task restored", (await starts()).length === 1);

// ---------- 7. map resources fail: the map says so, health monitoring keeps working ----------
const fail = (r) => r.abort();
await st.route("**/_next/static/chunks/**", fail);
await st.route("**/terrain/**", fail);
await st.getByTestId("view-map").click(); // first map open on this page load: its code must be fetched now
await st.waitForSelector('[data-testid="mission-map-error"], [data-testid="mission-glass"]', { timeout: 30000 });
const mapFailed = await st.getByTestId("mission-map-error").isVisible().catch(() => false);
await shot(st, "m5-map-failed");
await st.getByTestId("view-health").click();
await replay(st, "grip-missing", true);
await st.waitForFunction(() => /结果不完整/.test(document.querySelector('[data-testid="panel-eval-status"]')?.textContent ?? ""), null, { timeout: 40000 });
check("map code/resources blocked: the map view reports it; health monitoring still analyses new data", mapFailed && (await st.getByTestId("panel-eval-status").textContent()).includes("结果不完整"));
await st.unroute("**/_next/static/chunks/**", fail);
await st.unroute("**/terrain/**", fail);
await closeOverlays(st);
await st.getByTestId("view-map").click();
await st.getByTestId("mission-map-retry").click();
await st.waitForSelector('[data-testid="mission-glass"]', { timeout: 60000 });
check("after the network recovers, the map loads again on retry", true);

// ---------- 9. a second station window mirrors the mission and cannot act ----------
const st2 = await ctx.newPage();
watch("station-2", st2);
await st2.goto(STATION, { waitUntil: "domcontentloaded" });
await st2.waitForSelector('[data-testid="station-lease"][data-lease="readonly"]', { timeout: 40000 });
await waitPhase(st2, "eva-active");
check("second station window: read-only mirror of the running EVA; it cannot end it", (await st2.getByTestId("eva-end-open").isDisabled()) && /Survey the outcrops/.test(await st2.getByTestId("mission-task").innerText()));

// ---------- 8. ending the EVA keeps unhandled health events ----------
await st.bringToFront();
const openBefore = (await st.locator('[data-crew-card="a-02"]').innerText()).replace(/\n/g, " ");
await closeOverlays(st);
await st.getByTestId("eva-end-open").click();
const endText = await st.getByTestId("eva-end-dialog").innerText();
await st.getByTestId("eva-end-confirm").click();
await waitPhase(st, "eva-ended");
await st.waitForTimeout(1200);
const list = await evs();
const ended = list.filter((e) => e.type === "station.eva.ended");
const closes = list.filter((e) => e.type === "station.reassessment" && e.payload.caseStatus === "closed");
check("end EVA: one station.eva.ended; no event closed; the dialog says so", ended.length === 1 && closes.length === 0 && /尚未关闭/.test(endText) && /不表示宇航员健康正常/.test(endText), `${ended.length} end · ${closes.length} closes`);
await st.getByTestId("view-health").click();
const cardAfter = (await st.locator('[data-crew-card="a-02"]').innerText()).replace(/\n/g, " ");
check("after the end: the person's events and history are still shown", /未关闭事件 [1-9]/.test(cardAfter), cardAfter.slice(0, 120));
await st.getByTestId("view-map").click();
await st.waitForTimeout(500);
check("a new EVA is refused while those events are open", (await st.getByTestId("prep-blocked").isVisible()) && (await st.getByTestId("prep-summary").isDisabled()));
await shot(st, "m6-ended-blocked");
await waitPhase(st2, "eva-ended");
check("the mirror window shows the ended EVA too", true);
log(`card before end: ${openBefore.slice(0, 100)}…`);

// ---------- 10. research and kept pages are still reachable ----------
for (const [path, marker] of [["/legacy/mission-glass", "mission-glass"], ["/research", null], ["/legacy/workbench", null]]) {
  const pg = await ctx.newPage();
  const res = await pg.goto(ORIGIN + path, { waitUntil: "domcontentloaded" });
  const ok = res.status() === 200 && (!marker || (await pg.waitForSelector(`[data-testid="${marker}"]`, { timeout: 60000 }).then(() => true, () => false)));
  check(`kept page reachable: ${path}`, ok, `${res.status()}`);
  await pg.close();
}

check("no page errors", errs.length === 0, errs.join(" | ").slice(0, 400));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
await b.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
