// Checks of the astronaut HUD's illustrative 3D Mars scene (integration mode) on the REAL page, served by the local
// relay. Only the relay is needed (the Base is not):
//   npm run relay -- --static myomars-hud          (serves the HUD on 8787)
//   node scripts/hud-scene-check.mjs
//   RELAY=http://127.0.0.1:8787   OUT=/dir (screenshots)   PERF=0 (skip the performance measurements)
// Prints PASS / FAIL per check, PERF lines (they describe THIS machine's browser, e.g. headless Chromium with the
// SwiftShader software renderer, not any user's hardware) and a total. Exit code 1 if a check fails.
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const RELAY = process.env.RELAY ?? "http://127.0.0.1:8787";
const OUT = process.env.OUT ?? null;
const PERF = process.env.PERF !== "0";
const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), "..", "myomars-hud/scene/mars-scene.js");
if (OUT) mkdirSync(OUT, { recursive: true });
const hudUrl = (q = "") => `${RELAY}/hud.html?mode=integration${q}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const perf = (line) => console.log(`PERF  ${line}`);

const browser = await chromium.launch();
const env = await (async () => {
  const p = await browser.newPage();
  const r = await p.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return { gl: gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : "none", cores: navigator.hardwareConcurrency };
  });
  await p.close();
  return r;
})();
console.log(`      browser: Chromium ${browser.version()} (headless) · WebGL renderer: ${env.gl} · ${env.cores} logical cores`);

const opened = [];
/** Close the pages of earlier checks: each idle HUD page still composites its own HUD at 60 fps, which would skew timings. */
async function closeAll() {
  while (opened.length) await opened.pop().close().catch(() => {});
}
async function open(q = "", { init = null, reducedMotion = "no-preference", viewport = { width: 1440, height: 900 }, route = null } = {}) {
  await closeAll();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion });
  opened.push(ctx);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_ABORTED|net::/.test(m.text()) && errs.push(m.text()));
  if (route) await page.route(route.pattern, route.handler);
  await page.goto(hudUrl(q), { waitUntil: "load" });
  await page.waitForFunction(() => ["webgl", "fallback"].includes(document.documentElement.dataset.scene), null, { timeout: 30000 });
  return { ctx, page, errs };
}
const join2 = async (page) => {
  await page.locator("#bJoin").click();
  await page.waitForFunction(() => window.__hud?.client.state.conn === "online", null, { timeout: 15000 });
};
const ds = (page) => page.evaluate(() => ({ ...document.documentElement.dataset }));
const view = (page) => page.evaluate(() => window.__hudScene.view());
const frames = (page) => page.evaluate(() => window.__hudScene.frames);
const frame2 = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const close = (a, b) => Math.abs(a - b) < 0.05;
async function dragAt(page, x, y, dx, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}
const centerOf = async (page, sel) => {
  const b = await page.locator(sel).boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};
/** Text contrast against the brightest pixel behind each panel (panel text hidden for the measurement). */
async function panelContrast(page, sels) {
  await page.addStyleTag({ content: ".__measure * { visibility: hidden !important; }" });
  const rects = [];
  for (const s of sels) {
    if (!(await page.locator(s).isVisible())) continue;
    const b = await page.locator(s).boundingBox();
    rects.push({ s, x: Math.round(b.x + 6), y: Math.round(b.y + 6), w: Math.round(b.width - 12), h: Math.round(b.height - 12) });
  }
  await page.evaluate((ss) => ss.forEach((s) => document.querySelector(s)?.classList.add("__measure")), sels);
  await page.waitForTimeout(100);
  const png = (await page.screenshot()).toString("base64");
  await page.evaluate((ss) => ss.forEach((s) => document.querySelector(s)?.classList.remove("__measure")), sels);
  return page.evaluate(async ({ png, rects }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const lum = (r, gg, b) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
    };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const TEXT = lum(0xea, 0xf1, 0xf9), DIM = lum(0xa3, 0xb3, 0xc8);
    return rects.map(({ s, x, y, w, h }) => {
      const d = g.getImageData(x, y, w, h).data;
      const ls = [];
      for (let i = 0; i < d.length; i += 4) ls.push(lum(d[i], d[i + 1], d[i + 2]));
      ls.sort((a, b) => a - b);
      const p99 = ls[Math.floor(ls.length * 0.99)];
      return { s, bgLum: +p99.toFixed(3), text: +ratio(TEXT, p99).toFixed(1), dim: +ratio(DIM, p99).toFixed(1) };
    });
  }, { png, rects });
}

// ---------------------------------------------------------------- default: WebGL scene
{
  const { page, errs } = await open();
  const d = await ds(page);
  check("default: the 3D scene draws (data-scene=webgl) at an auto quality level", d.scene === "webgl" && ["low", "standard"].includes(d.quality), `quality ${d.quality} · ${await page.evaluate(() => window.__hudScene.api.renderer)}`);
  await join2(page);
  check("Enter HUD joins the relay with the scene on (#bJoin → online)", true);
  const cap = await page.locator("#sceneCaption").innerText();
  check("caption: \"Illustrative Mars scene · not a reconstruction of the task site\" is shown", cap === "Illustrative Mars scene · not a reconstruction of the task site" && (await page.locator("#sceneCaption").isVisible()));
  await page.waitForTimeout(400);
  const f0 = await frames(page);
  await page.waitForTimeout(1500);
  const f1 = await frames(page);
  const v0 = await view(page);
  check("idle: no frames rendered while nothing changes (no idle loop, no auto-rotation)", f1 === f0 && v0.atDefault, `frames ${f0} → ${f1} over 1.5 s`);
  if (OUT) await page.screenshot({ path: `${OUT}/check-default.png` });

  // drag on empty scene area
  const hit = await page.evaluate(() => document.elementFromPoint(720, 600)?.id);
  await dragAt(page, 720, 600, 180, 50);
  const v1 = await view(page);
  check("drag on empty scene area turns the view (yaw and pitch change)", hit === "scene3d" && !close(v1.yaw, 0) && !close(v1.pitch, v0.pitch), `element ${hit} · yaw ${v1.yaw.toFixed(1)}° pitch ${v1.pitch.toFixed(1)}°`);
  await dragAt(page, 720, 600, -2500, -900);
  const vc = await view(page);
  check("look-around is clamped (yaw ±35°, pitch −16…+7°)", close(Math.abs(vc.yaw), 35) && vc.pitch >= -16.001 && vc.pitch <= 7.001, `yaw ${vc.yaw.toFixed(1)}° pitch ${vc.pitch.toFixed(1)}°`);
  await page.locator("#bResetView").click();
  await page.waitForTimeout(800);
  const v2 = await view(page);
  check("Reset view returns to the default view", v2.atDefault, `yaw ${v2.yaw.toFixed(2)}° pitch ${v2.pitch.toFixed(2)}°`);

  // pointerdown on HUD panels and buttons never starts a drag
  const before = await view(page);
  const fBefore = await frames(page);
  for (const sel of ["#right", "#topL", "#bottom", "#demo summary", "#bResetView"]) {
    const [x, y] = await centerOf(page, sel);
    await page.mouse.move(x, y);
    await page.mouse.down();
    const dragging = await page.evaluate(() => document.getElementById("scene3d").classList.contains("drag") || document.body.classList.contains("grabbing"));
    await page.mouse.move(x - 220, y + 90, { steps: 6 });
    await page.mouse.up();
    if (dragging) before.dragged = sel;
  }
  if (await page.locator("#demo").evaluate((e) => e.open)) await page.locator("#demo summary").click();
  await page.waitForTimeout(200);
  const after = await view(page);
  check("pointerdown on HUD panels / buttons (Base messages, top bar, data link, tools, Reset view) does not start a drag", !before.dragged && close(after.yaw, before.yaw) && close(after.pitch, before.pitch),
    `${before.dragged ? `drag started on ${before.dragged}` : "no drag"} · frames ${fBefore} → ${await frames(page)}`);

  // markers and label cards
  await page.locator("#wmTask .box").click();
  const card = await page.locator("#wmTask .mcard").innerText().catch(() => "");
  check("clicking the task marker shows its label card (task context only, simulated position, no numbers)", /Task target|EVA/.test(card) && /Simulated position/.test(card) && !/\d/.test(card), card.replace(/\n/g, " / "));
  await page.keyboard.press("Escape");
  const closedByEsc = (await page.locator("#wmTask .mcard").count()) === 0;
  await page.locator("#wmBase .box").click();
  const bcard = await page.locator("#wmBase .mcard").innerText().catch(() => "");
  await page.mouse.click(720, 640); // a tap on empty scene area closes it
  await page.waitForTimeout(150);
  check("base marker card opens; Esc and a tap on the scene close the cards", closedByEsc && /Mars Base/.test(bcard) && !/\d/.test(bcard) && (await page.locator(".mcard").count()) === 0, bcard.replace(/\n/g, " / "));

  // keyboard look (focus on the page, not on a control)
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  const vk = await view(page);
  check("arrow keys look around when no control has focus", close(vk.yaw, 3), `yaw ${vk.yaw.toFixed(1)}°`);

  // Locate base (edge hint) turns the view to the base marker
  await dragAt(page, 720, 600, 2500, 0);
  await page.waitForSelector("#bLocate", { timeout: 3000 }).catch(() => {});
  const hasLocate = (await page.locator("#bLocate").count()) > 0;
  if (hasLocate) await page.locator("#bLocate").click();
  await page.waitForTimeout(900);
  const vl = await view(page);
  const baseYaw = await page.evaluate(() => window.__hudScene.api.markerYaw("base"));
  check("\"Locate base\" appears when the base is out of view and turns the view to it", hasLocate && Math.abs(vl.yaw - baseYaw) < 0.2, `yaw ${vl.yaw.toFixed(1)}° (base ${baseYaw.toFixed(1)}°)`);

  // hidden page: no frames at all
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const h0 = await frames(page);
  await page.evaluate(() => window.__hudScene.api.setView(-20, 0));
  await page.setViewportSize({ width: 1300, height: 820 });
  await dragAt(page, 700, 600, 120, 0);
  await page.waitForTimeout(700);
  const h1 = await frames(page);
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(400);
  const h2 = await frames(page);
  check("page hidden: no frames render (view change, resize, drag); visible again: it renders", h1 === h0 && h2 > h1, `frames ${h0} → ${h1} while hidden → ${h2} when visible`);
  await page.setViewportSize({ width: 1440, height: 900 });

  // quality control in the tools panel
  await page.locator("#demo summary").click();
  await page.locator("#sceneQuality").selectOption("standard");
  await page.waitForFunction(() => document.documentElement.dataset.quality === "standard", null, { timeout: 15000 });
  const st = await page.locator("#sceneState").innerText();
  await page.locator("#sceneQuality").selectOption("auto");
  await page.waitForTimeout(300);
  check("the Quality control (Link & scene tools) switches the level in place", (await ds(page)).scene === "webgl" && /Standard/.test(st), st);
  await page.locator("#demo summary").click();

  // readability: text contrast over the scene behind each panel, at the default view and looking up
  await page.locator("#bResetView").click();
  await page.waitForTimeout(800);
  const panels = ["#topL", "#topR", "#right", "#bottom", "#demo"];
  const c1 = await panelContrast(page, panels);
  await page.evaluate(() => window.__hudScene.api.setView(-30, 7));
  await page.waitForTimeout(500);
  const c2 = await panelContrast(page, panels);
  const all = [...c1, ...c2];
  const worst = all.reduce((a, b) => (b.text < a.text ? b : a));
  const worstDim = all.reduce((a, b) => (b.dim < a.dim ? b : a));
  check("panels stay readable over the scene: body text ≥ 7:1, secondary text ≥ 4.5:1 against the brightest pixel behind each panel", worst.text >= 7 && worstDim.dim >= 4.5,
    `worst ${worst.s} ${worst.text}:1 (text), ${worstDim.s} ${worstDim.dim}:1 (secondary)`);
  await page.evaluate(() => window.__hudScene.api.setView(0, -3.5));
  check("no page errors with the scene on", errs.length === 0, errs.join(" | "));
}

// ---------------------------------------------------------------- quality override
for (const q of ["low", "high"]) {
  const { page } = await open(`&quality=${q}`);
  const d = await ds(page);
  check(`?quality=${q} selects that level`, d.scene === "webgl" && d.quality === q, `data-quality ${d.quality}`);
  if (OUT && q === "low") {
    await join2(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/check-quality-low.png` });
  }
}

// ---------------------------------------------------------------- fallbacks
{
  const { page, errs } = await open("&scene=off");
  const d = await ds(page);
  const pano = await page.evaluate(() => ({
    outer: getComputedStyle(document.getElementById("outer")).display,
    bg: getComputedStyle(document.querySelector("#tiles .tile")).backgroundImage,
    canvas: !!document.getElementById("scene3d"),
  }));
  await page.waitForFunction(() => performance.getEntriesByType("resource").some((e) => /mars-pano-360\.webp/.test(e.name)), null, { timeout: 10000 }).catch(() => {});
  const loaded = await page.evaluate(() => performance.getEntriesByType("resource").some((e) => /mars-pano-360\.webp/.test(e.name)));
  await join2(page);
  check("?scene=off: the panorama image is shown and the HUD joins (#bJoin → online)", d.scene === "fallback" && d.sceneReason === "off" && pano.outer !== "none" && /mars-pano-360/.test(pano.bg) && loaded && !pano.canvas,
    `outer ${pano.outer} · image loaded ${loaded}`);
  const st = await page.locator("#sceneState").textContent();
  check("fallback states its reason in the tools panel and keeps the caption", /Image fallback/.test(st) && (await page.locator("#sceneCaption").isVisible()), st);
  if (OUT) await page.screenshot({ path: `${OUT}/check-fallback.png` });
  check("no page errors in the fallback", errs.length === 0, errs.join(" | "));
}
{
  const noWebgl = () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/i.test(String(type))) return null;
      return orig.call(this, type, ...rest);
    };
  };
  const { page, errs } = await open("", { init: noWebgl });
  const d = await ds(page);
  await join2(page);
  check("WebGL unavailable (getContext → null): automatic image fallback, HUD fully operable", d.scene === "fallback" && d.sceneReason === "no-webgl" && (await page.evaluate(() => getComputedStyle(document.getElementById("outer")).display)) !== "none" && errs.length === 0,
    `reason ${d.sceneReason}${errs.length ? " · errors: " + errs.join(" | ") : ""}`);
}
{
  const { page } = await open("", { route: { pattern: "**/scene/mars-scene.js", handler: (r) => r.abort() } });
  const d = await ds(page);
  await join2(page);
  check("scene bundle fails to load: automatic image fallback, HUD joins", d.scene === "fallback" && d.sceneReason === "load-failed", `reason ${d.sceneReason}`);
}
{
  const { page, errs } = await open();
  await join2(page);
  await page.evaluate(() => document.getElementById("scene3d").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
  await page.waitForFunction(() => document.documentElement.dataset.scene === "fallback", null, { timeout: 5000 }).catch(() => {});
  const d = await ds(page);
  await page.locator("#bResetView").click();
  check("WebGL context lost: switches to the image fallback, canvas removed, controls still work", d.scene === "fallback" && d.sceneReason === "context-lost" && (await page.locator("#scene3d").count()) === 0 && errs.length === 0,
    `reason ${d.sceneReason}${errs.length ? " · errors: " + errs.join(" | ") : ""}`);
}

{
  // a shader that does not link on this GPU (simulated): no blank canvas, the image fallback instead
  const badLink = () => {
    const orig = WebGL2RenderingContext.prototype.getProgramParameter;
    WebGL2RenderingContext.prototype.getProgramParameter = function (program, pname) {
      return pname === this.LINK_STATUS ? false : orig.call(this, program, pname);
    };
  };
  const { page, errs } = await open("", { init: badLink });
  await page.waitForFunction(() => document.documentElement.dataset.scene === "fallback", null, { timeout: 5000 }).catch(() => {});
  const d = await ds(page);
  await join2(page);
  check("scene shader fails to compile/link: automatic image fallback, no canvas left over the image", d.scene === "fallback" && d.sceneReason === "shader-error" && (await page.locator("#scene3d").count()) === 0 && errs.length === 0,
    `reason ${d.sceneReason}${errs.length ? " · errors: " + errs.join(" | ") : ""}`);
}

// ---------------------------------------------------------------- reduced motion
{
  // Reset view after a drag; record the yaw of every rendered frame until it settles
  const resetPath = async (page) => {
    await join2(page);
    await dragAt(page, 720, 600, 300, 60);
    return page.evaluate(() => new Promise((res) => {
      const start = window.__hudScene.view().yaw, seen = [];
      let last = window.__hudScene.frames;
      document.getElementById("bResetView").click();
      const t0 = performance.now();
      const poll = () => {
        const f = window.__hudScene.frames;
        if (f !== last) seen.push(window.__hudScene.view().yaw);
        last = f;
        if (performance.now() - t0 < 1200) requestAnimationFrame(poll);
        else res({ start, seen, between: seen.filter((y) => Math.abs(y) > 0.01 && Math.abs(y - start) > 0.01).length, end: window.__hudScene.view() });
      };
      requestAnimationFrame(poll);
    }));
  };
  const normal = await resetPath((await open()).page);
  const media = await resetPath((await open("", { reducedMotion: "reduce" })).page);
  const attr = await resetPath((await open("", { init: () => document.addEventListener("DOMContentLoaded", () => (document.documentElement.dataset.motion = "reduced")) })).page);
  check("Reset view eases normally, and is instant under prefers-reduced-motion and <html data-motion=\"reduced\">",
    normal.between > 0 && normal.end.atDefault && media.between === 0 && media.end.atDefault && attr.between === 0 && attr.end.atDefault,
    `in-between frames: normal ${normal.between}, reduced (media) ${media.between}, reduced (attribute) ${attr.between}`);
  const anim = await (await open("", { reducedMotion: "reduce" })).page.evaluate(() => getComputedStyle(document.getElementById("rcard")).transitionDuration);
  check("reduced motion also stops the HUD's CSS transitions and animations in integration mode", /^0s/.test(anim), `#rcard transition-duration ${anim}`);
}

// ---------------------------------------------------------------- performance (this machine)
if (PERF) {
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  perf(`bundle myomars-hud/scene/mars-scene.js ${kb(statSync(BUNDLE).size)} (minified, no compression on the relay)`);
  const heap = async (page) => {
    const s = await page.context().newCDPSession(page);
    await s.send("HeapProfiler.collectGarbage");
    const h = await s.send("Runtime.getHeapUsage");
    return h; // usedSize = JS objects; backingStorageSize = ArrayBuffer stores (geometry built on the CPU)
  };
  {
    const { page } = await open("&scene=off");
    await join2(page);
    await page.waitForTimeout(500);
    const h = await heap(page);
    perf(`image fallback (scene=off): JS heap ${(h.usedSize / 1048576).toFixed(1)} MB + ${((h.backingStorageSize ?? 0) / 1048576).toFixed(1)} MB array buffers`);
  }
  for (const q of ["low", "standard", "high"]) {
    for (const vp of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const { page } = await open(`&quality=${q}`, { viewport: vp });
      await page.waitForFunction(() => window.__hudScene.api?.stats.firstFrameAt > 0, null, { timeout: 15000 });
      const s = await page.evaluate(() => {
        const a = window.__hudScene.api;
        return { first: a.stats.firstFrameAt, create: a.stats.createMs, build: a.stats.build.total, loaded: window.__hudScene.loadedAt, tex: a.stats.textureBytes, geo: a.stats.geometryBytes, tris: a.stats.triangles, pr: a.stats.pixelRatio, aa: a.stats.antialias };
      });
      await join2(page);
      await page.waitForTimeout(300);
      const gpu = await page.evaluate(() => window.__hudScene.api.profile(24));
      // a continuous pan, one view change per animation frame (what a drag does): interval between rendered frames
      const pan = await page.evaluate(() => new Promise((res) => {
        const a = window.__hudScene.api, t = [];
        let i = 0, last = a.frames;
        const f = (x) => {
          if (a.frames !== last) t.push(x);
          last = a.frames;
          a.setView(Math.sin(i++ / 5) * 20, -3.5);
          if (t.length < 40) requestAnimationFrame(f);
          else {
            const d = [];
            for (let k = 1; k < t.length; k++) d.push(t[k] - t[k - 1]);
            d.sort((p, q) => p - q);
            a.setView(0, -3.5);
            res({ median: d[d.length >> 1], p95: d[Math.floor(d.length * 0.95)] });
          }
        };
        requestAnimationFrame(f);
      }));
      // a real mouse drag: frame-to-frame interval of the frames the scene actually rendered
      await page.evaluate(() => {
        window.__ticks = [];
        let last = window.__hudScene.frames;
        const loop = (t) => {
          const f = window.__hudScene.frames;
          if (f !== last) window.__ticks.push(t);
          last = f;
          if (window.__ticks.length < 400) window.__tickRaf = requestAnimationFrame(loop);
        };
        window.__tickRaf = requestAnimationFrame(loop);
      });
      await page.mouse.move(700, 600);
      await page.mouse.down();
      for (let i = 1; i <= 60; i++) await page.mouse.move(700 + Math.sin(i / 6) * 260, 600 + Math.cos(i / 9) * 40);
      await page.mouse.up();
      const dragMs = await page.evaluate(() => {
        cancelAnimationFrame(window.__tickRaf);
        const t = window.__ticks, d = [];
        for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
        d.sort((a, b) => a - b);
        return { n: t.length, median: d[Math.floor(d.length / 2)] || 0, p95: d[Math.floor(d.length * 0.95)] || 0 };
      });
      const hp = await heap(page);
      perf(`${q.padEnd(8)} ${vp.width}×${vp.height} px ratio ${s.pr}${s.aa ? " MSAA" : ""} · first scene frame ${s.first.toFixed(0)} ms after navigation (bundle loaded at ${s.loaded.toFixed(0)} ms; create ${s.create.toFixed(0)} ms, of which world build ${s.build.toFixed(0)} ms) · render (synchronous, with readback) ${gpu.toFixed(1)} ms/frame · continuous pan: median ${pan.median.toFixed(1)} ms, p95 ${pan.p95.toFixed(1)} ms between rendered frames · Playwright mouse drag (input-paced): ${dragMs.n} frames, median ${dragMs.median.toFixed(1)} ms · JS heap ${(hp.usedSize / 1048576).toFixed(1)} MB + ${((hp.backingStorageSize ?? 0) / 1048576).toFixed(1)} MB array buffers · textures ≈ ${kb(s.tex)} · geometry ${kb(s.geo)} · ${s.tris} triangles`);
      if (OUT && vp.width === 1920 && q === "standard") await page.screenshot({ path: `${OUT}/check-standard-1920.png` });
    }
  }
}

await closeAll();
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
