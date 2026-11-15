#!/usr/bin/env node
/**
 * The HUD's own effects survive the shared Base/HUD design language (owner decision 2026-11-15):
 * integration mode keeps the cyan text glow, the status-badge glow and red blink, the
 * continuous base-marker ping, the queued-packet blink, the edge hint, the mini-map with position
 * and speed, and (on the panorama fallback) the waypoint markers and the base distance. Reduced
 * motion still stops the animations.
 *
 *   node relay/server.ts --static myomars-hud --host 127.0.0.1    (relay on 8787)
 *   node scripts/hud-effects-check.mjs                             (RELAY=http://127.0.0.1:8787)
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RELAY = process.env.RELAY ?? "http://127.0.0.1:8787";
let pass = 0;
let fail = 0;
const check = (ok, what, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
};
const b = await chromium.launch();
async function open(query, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const p = await ctx.newPage();
  await p.goto(`${RELAY}/hud.html?mode=integration${query}`, { waitUntil: "load" });
  await p.locator("#bJoin").click();
  await p.waitForFunction(() => window.__hud?.client.state.conn === "online", null, { timeout: 15000 });
  await p.waitForFunction(() => ["webgl", "fallback"].includes(document.documentElement.dataset.scene), null, { timeout: 20000 });
  await p.waitForTimeout(600);
  return { ctx, p };
}
// Computed style of a probe element with the given classes, placed where the real one lives.
const probe = (p, parentSel, html) =>
  p.evaluate(
    ([parentSel, html]) => {
      const host = document.querySelector(parentSel) ?? document.body;
      const t = document.createElement("div");
      t.innerHTML = html;
      const el = t.firstElementChild;
      host.appendChild(el);
      const target = el.querySelector("[data-probe]") ?? el;
      const cs = getComputedStyle(target);
      const r = { animationName: cs.animationName, iter: cs.animationIterationCount, boxShadow: cs.boxShadow, textShadow: cs.textShadow };
      el.remove();
      return r;
    },
    [parentSel, html],
  );

// ---- default (3D scene) ----
{
  const { ctx, p } = await open("");
  const scene = await p.evaluate(() => document.documentElement.dataset.scene);
  const lvl = await probe(p, "#hud", '<span class="lvl red">ALERT</span>');
  check(lvl.animationName === "blink" && lvl.iter === "infinite" && lvl.boxShadow !== "none", "status badge (red): glow and blink kept", JSON.stringify(lvl));
  const amber = await probe(p, "#hud", '<span class="lvl amber">NOTICE</span>');
  check(amber.boxShadow !== "none", "status badge (amber): glow kept", amber.boxShadow);
  const ring = await probe(p, "#hud", '<div class="wm base busy"><div class="box">x</div><div class="ring" data-probe></div></div>');
  check(ring.animationName === "ping" && ring.iter === "infinite", "base-marker ping: continuous (not 2 pulses)", JSON.stringify(ring));
  const pk = await probe(p, "#hud", '<div class="pk cached"></div>');
  check(pk.animationName === "blink" && pk.iter === "infinite", "queued packet: blink kept", JSON.stringify(pk));
  const box = await p.evaluate(() => getComputedStyle(document.querySelector("#wmBase .box")).textShadow);
  check(box !== "none", "marker labels: HUD text glow kept", box);
  const radar = await p.evaluate(() => ["radar", "posVal", "speed"].map((id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : "missing"; }));
  check(radar.every((d) => d !== "none" && d !== "missing"), "mini-map, position and speed readouts shown", radar.join(", "));
  if (scene === "webgl") {
    const wp = await p.evaluate(() => getComputedStyle(document.getElementById("wmPoint")).display);
    const sub = await p.evaluate(() => document.getElementById("wmBaseSub").textContent);
    check(wp === "none" && !/km/.test(sub), "3D scene: panorama waypoints and the panorama distance stay off (no 3D placement exists)", `${wp} · "${sub}"`);
  } else check(true, `scene is ${scene} (no WebGL here): 3D-only check skipped`);
  await ctx.close();
}
// ---- panorama fallback ----
{
  const { ctx, p } = await open("&scene=off");
  const wp = await p.evaluate(() => ["wmPoint", "wmRidge", "wmRover"].map((id) => getComputedStyle(document.getElementById(id)).display));
  check(wp.every((d) => d !== "none"), "panorama fallback: original waypoint markers shown", wp.join(", "));
  await p.waitForTimeout(800);
  const sub = await p.evaluate(() => document.getElementById("wmBaseSub").textContent);
  check(/km/.test(sub), "panorama fallback: base marker keeps its distance", sub);
  await ctx.close();
}
// ---- reduced motion ----
{
  const { ctx, p } = await open("", { reducedMotion: "reduce" });
  const lvl = await probe(p, "#hud", '<span class="lvl red">ALERT</span>');
  const ring = await probe(p, "#hud", '<div class="wm base busy"><div class="box">x</div><div class="ring" data-probe></div></div>');
  check(lvl.animationName === "none" && ring.animationName === "none", "reduced motion: blink and ping stop", `${lvl.animationName} / ${ring.animationName}`);
  await ctx.close();
}
await b.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
