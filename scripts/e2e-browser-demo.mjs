#!/usr/bin/env node
/**
 * Online browser-based demo (/demo), with NO relay running: the Base and the HUD (same-origin iframe)
 * exchange messages through the in-browser bus only.
 *
 *   npm run dev   (or npm run build && npm start)            — the web app only
 *   DEMO=http://127.0.0.1:3000/demo node scripts/e2e-browser-demo.mjs
 *
 * Checks: full loop (task → EVA → sample → analysis → human approval → HUD ack / task / retest →
 * re-evaluation → human close → HUD closing notice and history); tab switches keep state and never
 * send again; two resets do not leak messages into the new session; two visitors are isolated; a HUD
 * that never loaded gives no receipt; the loop still completes when map tiles, terrain and the HUD
 * 3D scene fail; no request to a relay port (8787/8788); main actions visible at 1440×900 / 1920×1080.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const DEMO = process.env.DEMO ?? "http://127.0.0.1:3000/demo";
const ORIGIN = new URL(DEMO).origin;
let pass = 0;
let fail = 0;
const check = (ok, what, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
};
const b = await chromium.launch();

async function openDemo({ w = 1440, h = 900, block = [] } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const requests = [];
  ctx.on("request", (r) => requests.push(r.url()));
  for (const pattern of block) await ctx.route(pattern, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(DEMO, { waitUntil: "domcontentloaded" });
  await p.waitForSelector('[data-testid="crew-station"]', { timeout: 90000 });
  await p.waitForSelector('[data-testid="station-link"][data-conn="online"]', { timeout: 30000 });
  return { ctx, p, requests, errors };
}
const events = (p) => p.evaluate(() => window.__myomarsDemo.events());
const phaseIs = (p, ph, t = 60000) => p.waitForFunction((x) => document.querySelector('[data-testid="decision-panel"]')?.dataset.phase === x, ph, { timeout: t });
const hud = (p) => p.frameLocator('[data-testid="demo-view-hud"]');
const hudEval = async (p, fn) => (await p.$('[data-testid="demo-view-hud"]').then((h) => h.contentFrame())).evaluate(fn);

async function startEva(p) {
  await p.getByTestId("mg-target-sim-target-b").click({ timeout: 90000 });
  await p.getByTestId("prep-summary").click();
  await p.getByTestId("eva-start-confirm").click();
  await p.waitForFunction(() => document.querySelector('[data-testid="crew-station"]')?.dataset.phase === "eva-active", null, { timeout: 20000 });
}
async function loadSample(p) {
  await p.getByTestId("demo-controls").locator("summary").click();
  await p.getByTestId("demo-load-sample").click();
  check(!(await p.getByTestId("demo-controls").evaluate((d) => d.open)), "Demo controls close after loading the sample");
}
async function approve(p) {
  await phaseIs(p, "review");
  await p.getByTestId("decide-approve").click();
  await p.getByTestId("reason-template").first().click();
  await p.getByTestId("confirm-submit").click();
}
async function hudLoop(p) {
  await p.getByTestId("demo-tab-hud").click();
  const H = hud(p);
  const join = H.locator("#bJoin");
  if (await join.count()) await join.click();
  await p.waitForFunction(() => { const f = document.querySelector('[data-testid="demo-view-hud"]'); const a = f?.contentWindow?.__hud?.client.activeCase(); return a && a.alert && a.retest; }, null, { timeout: 30000 });
  await H.locator("#bAck").click();
  await H.locator("#bView").first().click();
  await H.locator("#bGo").click();
  await H.locator("#bSubmit").waitFor({ timeout: 30000 });
  await H.locator("#bSubmit").click();
}

// ---------- 1. full loop, tab switching, no duplicates, no relay ----------
{
  const { ctx, p, requests, errors } = await openDemo();
  check(await p.getByTestId("demo-label-browser").isVisible() && /Simulated data \/ Simulated analysis/.test(await p.getByTestId("demo-label-sim").innerText()), "labels: Browser-based demo · Simulated data / Simulated analysis");
  check((await p.getByTestId("live-demo").getAttribute("data-view")) === "base", "default view is the Mars Base");
  await startEva(p);
  await p.waitForFunction(() => document.querySelector('[data-testid="live-demo"]')?.dataset.hudLinked === "1", null, { timeout: 20000 });
  check(true, "HUD page linked to the parent through the MessageChannel handshake");
  await loadSample(p);
  await approve(p);
  await p.waitForFunction(() => Number(document.querySelector('[data-testid="demo-tab-hud"]')?.dataset.badge ?? 0) > 0, null, { timeout: 20000 });
  check(true, "HUD tab shows a new-task badge after the approval (no automatic switch)", await p.getByTestId("demo-badge-hud").innerText());
  check((await p.getByTestId("live-demo").getAttribute("data-view")) === "base", "the view did not switch by itself");
  // HUD hidden while messages arrive: its 3D scene renders nothing; shown again: the canvas fits the view
  const frames = () => hudEval(p, () => window.__hudScene?.frames ?? -1);
  const f0 = await frames();
  await p.waitForTimeout(2500);
  const f1 = await frames();
  check(f0 >= 0 && f1 === f0, "hidden HUD: the 3D scene renders no frames", `${f0} → ${f1}`);
  await p.getByTestId("demo-tab-hud").click();
  await p.waitForTimeout(900);
  const fit = await hudEval(p, () => { const c = document.getElementById("scene3d"); return c ? { cw: c.clientWidth, ch: c.clientHeight, iw: innerWidth, ih: innerHeight, w: c.width } : null; });
  check(!!fit && fit.cw === fit.iw && fit.ch === fit.ih && fit.w > 0, "HUD shown: the 3D canvas is resized to the view", JSON.stringify(fit));
  check((await frames()) > f1, "HUD shown: the scene draws again");
  await p.getByTestId("demo-tab-base").click();
  const before = await events(p);
  // switch back and forth: no new messages, state kept
  for (let i = 0; i < 3; i++) {
    await p.getByTestId("demo-tab-hud").click();
    await p.waitForTimeout(400);
    await p.getByTestId("demo-tab-base").click();
    await p.waitForTimeout(400);
  }
  const after = await events(p);
  const receipts = (ev) => ev.filter((e) => e.type === "hud.received").length;
  check(after.filter((e) => e.role === "station").length === before.filter((e) => e.role === "station").length, "tab switches send nothing from the Base", `${before.length} → ${after.length} events`);
  check(new Set(after.map((e) => e.eventId)).size === after.length, "no duplicate eventId in the session");
  check((await p.getByTestId("decision-panel").getAttribute("data-phase")) !== "review", "Base state kept across switches (approval still recorded)");
  check(receipts(after) >= 1, "HUD receipts come from the HUD page itself (hud.received published by role hud)", `${receipts(after)} receipts`);
  await hudLoop(p);
  await p.getByTestId("demo-tab-base").click();
  await phaseIs(p, "reassessed", 60000);
  check(true, "Base re-evaluated after the HUD retest submission (round 1 kept)");
  await p.getByTestId("decide-close").click();
  await p.getByTestId("reason-template").first().click();
  await p.getByTestId("confirm-submit").click();
  await p.waitForFunction(() => { const f = document.querySelector('[data-testid="demo-view-hud"]'); return f?.contentWindow?.__hud?.client.activeCase().alert?.status === "closed"; }, null, { timeout: 20000 });
  await p.getByTestId("demo-tab-hud").click();
  await p.waitForTimeout(800);
  const hudText = await hud(p).locator("body").innerText();
  check(/CASE CLOSED/i.test(hudText) && /history/i.test(hudText), "HUD shows the closing notice and the task as history");
  const types = (await events(p)).map((e) => e.type);
  check(["scenario.start", "observation.submitted", "station.notice.approved", "station.retest.requested", "hud.received", "hud.ack", "retest.result", "station.reassessment"].every((t) => types.includes(t)), "every step went through the in-browser bus", types.join(","));
  const bad = requests.filter((u) => /:(8787|8788)\b/.test(u) || (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u) && !u.startsWith(ORIGIN)));
  check(bad.length === 0, "no request to a relay port or another local service", bad.slice(0, 3).join(" "));
  check(requests.some((u) => u.startsWith(`${ORIGIN}/hud/hud.html`)), "the HUD page is served by the same site");
  check(errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));
  // ---------- 2. reset twice: nothing from the old rounds leaks ----------
  for (let round = 1; round <= 2; round++) {
    const oldSid = await p.getByTestId("live-demo").getAttribute("data-session");
    await p.getByTestId("demo-controls").locator("summary").click();
    await p.getByTestId("demo-reset").click();
    await p.waitForFunction((s) => document.querySelector('[data-testid="live-demo"]')?.dataset.session !== s, oldSid);
    await p.waitForSelector('[data-testid="station-link"][data-conn="online"]', { timeout: 30000 });
    const ev0 = await events(p);
    check(ev0.length === 0 && (await p.getByTestId("crew-station").getAttribute("data-phase")) === "preparing", `reset ${round}: new empty session, Base back to preparation`);
    await p.waitForTimeout(2500);
    await startEva(p);
    await loadSample(p);
    await phaseIs(p, "review");
    const ev = await events(p);
    const runs = new Set(ev.map((e) => e.runId));
    check(runs.size === 1 && ev.filter((e) => e.type === "observation.submitted").length === 1, `reset ${round}: only this round's run and one observation`, `${ev.length} events, runs ${[...runs].join(",")}`);
  }
  await ctx.close();
}

// ---------- 3. two visitors at once are isolated ----------
{
  const a = await openDemo();
  const c = await openDemo();
  await startEva(a.p);
  await c.p.waitForTimeout(1500);
  const ea = await events(a.p);
  const ec = await events(c.p);
  check(ea.length >= 1 && ec.length === 0, "two browser sessions: an EVA in one does not appear in the other", `${ea.length} vs ${ec.length}`);
  check((await a.p.getByTestId("live-demo").getAttribute("data-session")) !== (await c.p.getByTestId("live-demo").getAttribute("data-session")), "each visitor has its own session id");
  await a.ctx.close();
  await c.ctx.close();
}

// ---------- 4. HUD never loads: no receipt is invented ----------
{
  const { ctx, p } = await openDemo({ block: ["**/hud/hud.html**"] });
  await startEva(p);
  await loadSample(p);
  await approve(p);
  await p.waitForTimeout(6000);
  const ev = await events(p);
  check(!ev.some((e) => e.role === "hud" || e.role === "device"), "HUD page not loaded: no receipt or reply on the bus");
  const hudStep = await p.getByTestId("step-hud").getAttribute("data-state").catch(() => null);
  check(hudStep === "waiting", "Base shows the HUD step waiting (not received)", String(hudStep));
  await ctx.close();
}

// ---------- 5. map tiles, terrain and the HUD 3D scene fail: the loop still completes ----------
{
  const { ctx, p } = await openDemo({ w: 1920, h: 1080, block: ["**/trek.nasa.gov/**", "**/terrain/**", "**/hud/scene/mars-scene.js"] });
  await startEva(p);
  await loadSample(p);
  await approve(p);
  const visible = async (id) => { const r = await p.getByTestId(id).boundingBox(); return !!r && r.y >= 0 && r.y + r.height <= 1080; };
  await hudLoop(p);
  const scene = await hudEval(p, () => document.documentElement.dataset.scene);
  check(scene === "fallback", "HUD 3D scene unavailable → image fallback", scene);
  await p.getByTestId("demo-tab-base").click();
  await phaseIs(p, "reassessed", 60000);
  check(await visible("decide-close"), "1920×1080: Close case visible without scrolling");
  await p.getByTestId("decide-close").click();
  await p.getByTestId("reason-template").first().click();
  await p.getByTestId("confirm-submit").click();
  await p.waitForFunction(() => document.querySelector('[data-testid="demo-view-hud"]')?.contentWindow?.__hud?.client.activeCase().alert?.status === "closed", null, { timeout: 20000 });
  check(true, "loop completed with map, terrain and HUD 3D assets blocked");
  await ctx.close();
}

// ---------- 6. 1440×900: main actions visible ----------
{
  const { ctx, p } = await openDemo({ w: 1440, h: 900 });
  const inView = async (loc) => { const r = await loc.boundingBox(); return !!r && r.y >= 0 && r.y + r.height <= 900 && r.x >= 0 && r.x + r.width <= 1440; };
  check(await inView(p.getByTestId("prep-summary")) && await inView(p.getByTestId("demo-tab-hud")), "1440×900: start button and tabs visible");
  await startEva(p);
  await loadSample(p);
  await phaseIs(p, "review");
  check(await inView(p.getByTestId("decide-approve")), "1440×900: Approve visible without scrolling");
  const scroll = await p.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
  check(scroll <= 1, "1440×900: no page scroll", String(scroll));
  await ctx.close();
}

await b.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
