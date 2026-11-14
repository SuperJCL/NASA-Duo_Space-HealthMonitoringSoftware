#!/usr/bin/env node
/**
 * Browser smoke test for the EVA route & scouting view of Mission Glass (/ → "EVA route").
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-eva-route.mjs
 *   SHOT_DIR=/some/dir ...   also saves screenshots there
 *
 * Checks, in the real app: 3D terrain with the route overlay, target selection, route
 * generation, the resource budget, the scouting loop (scout → observe → map update → re-plan →
 * approve), the 2D plan, the simulator truth toggle, and the route line in the EVA HUD.
 * Each PASS/FAIL line is one check.
 */
import { chromium } from "playwright";

const ORIGIN = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? null;
const failures = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures.push(msg);
};
const text = async (l) => ((await l.textContent().catch(() => null)) ?? "").trim();
const terrainState = async (p) => JSON.parse((await p.getByTestId("terrain-viewer").getAttribute("data-terrain-state")) || "{}");
const shot = async (p, name) => SHOT_DIR && (await p.screenshot({ path: `${SHOT_DIR}/${name}.png` }));
const phase = async (p) => p.getByTestId("route-status").getAttribute("data-phase");
const version = async (p) => Number(await p.getByTestId("route-status").getAttribute("data-version"));
const recommended = async (p) => p.getByTestId("route-options").getAttribute("data-recommended");

async function openRoute(p) {
  await p.goto(ORIGIN + (process.env.MG_PATH ?? "/legacy/mission-glass"), { waitUntil: "domcontentloaded" });
  await p.getByTestId("mg-mode-route").click();
  await p.getByTestId("route-status").waitFor({ timeout: 30_000 });
}

const browser = await chromium.launch();
try {
  // ---------- Desktop ----------
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SHOT_DIR ? 2 : 1 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await openRoute(p);
  check((await p.getByTestId("mg-mode-route").getAttribute("aria-selected")) === "true", "EVA route tab is selected");
  check((await p.getByTestId("mg-mode-planning").getAttribute("aria-selected")) === "false", "Mission planning tab is not selected while on the route view");

  // Terrain display with the overlay.
  await p.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="terrain-viewer"]')?.getAttribute("data-terrain-state") || "{}").loaded, undefined, { timeout: 30_000 });
  await p.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="terrain-viewer"]')?.getAttribute("data-terrain-state") || "{}").route?.labels?.length >= 1, undefined, { timeout: 15_000 });
  let st = await terrainState(p);
  check(st.loaded === true && st.exaggeration === 1, "3D terrain loaded from the verified DTM at 1× (true scale)");
  check(Boolean(st.route), "route overlay is passed to the 3D terrain");
  const paths = Object.fromEntries((st.route?.paths ?? []).map((x) => [x.id, x]));
  check(paths.known?.points > 20 && paths.known.dashed === false, `known route drawn solid on the terrain (${paths.known?.points} posts)`);
  check(paths.candidate?.points > 20 && paths.candidate.dashed === true && paths.candidate.tone === "candidate", "unconfirmed shortcut drawn dashed yellow");
  check(st.route.points.includes("route-base") && st.route.points.includes("route-rover"), "habitat and rover drawn on the terrain");
  check((await p.getByTestId("terrain-route-label-base").count()) === 1, "habitat label shown (SIM)");
  check(/simulated planning layer/.test(await text(p.getByTestId("terrain-model-note"))), "3D note says route lines are a simulated planning layer");
  check(!(await p.getByTestId("terrain-profile").isVisible()), "profile panel hidden in the route view");
  check(st.markers.some((m) => m.id === "sample-lefroy-bay" && m.kind === "verified"), "verified sample sites still shown");

  // Route generation and the resource budget (variant A).
  check((await phase(p)) === "planning", "starts in planning");
  const routes = await text(p.getByTestId("route-routes"));
  check(/Known route \d+\.\d+ km · shortest candidate \d+\.\d+ km \(\d+ m unobserved\)/.test(routes), `routes summarised: ${routes}`);
  const known = p.getByTestId("route-option-known");
  const knownText = await text(known);
  check(/Walk \d+\.\d+ km · EVA \d+\.\d+ h \(wait 0 min\) · O₂ 0\.\d+ kg used, 0\.\d+ kg left \(\d+ %\) · (go|caution)/.test(knownText), "known route has a crew time/O₂ budget");
  check((await known.getAttribute("data-feasible")) === "true", "known route is feasible");
  check((await p.getByTestId("route-option-continue").getAttribute("data-feasible")) === "false", "unconfirmed shortcut cannot be approved before scouting");
  check((await recommended(p)) === "scout", "A: scouting has the highest value");
  await shot(p, "route-desktop-planning");

  // Target selection: the select and a 3D label both change the primary target.
  const v0 = await version(p);
  await p.getByTestId("route-primary").selectOption("sim-target-b");
  await p.waitForFunction((v) => Number(document.querySelector('[data-testid="route-status"]')?.getAttribute("data-version")) > v, v0);
  st = await terrainState(p);
  check(st.selected === "sim-target-b", "primary target B selected (3D selection follows)");
  check((await p.getByTestId("route-alternative").inputValue()) === "sim-target-c", "alternative stays C");
  await p.getByTestId("terrain-label-sim-target-c").click();
  await p.waitForTimeout(400);
  check((await p.getByTestId("route-primary").inputValue()) === "sim-target-c", "clicking target C on the terrain makes it primary");
  check((await p.getByTestId("route-alternative").inputValue()) === "sim-target-b", "the targets swap so primary and alternative differ");
  await p.getByTestId("route-primary").selectOption("sim-target-a");
  await p.getByTestId("route-alternative").selectOption("sim-target-c");

  // Scouting closed loop (variant B): scout → rover moves → observations → map update → re-plan → approve.
  await p.getByTestId("route-variant-B").click();
  await p.waitForTimeout(300);
  check((await recommended(p)) === "scout", "B: same first decision as A (same knowledge)");
  const keyBefore = (await terrainState(p)).route.key;
  await p.getByTestId("route-choose-scout").click();
  check((await phase(p)) === "scouting", "rover sent: phase is scouting");
  await p.waitForTimeout(2500);
  const detail1 = await text(p.getByTestId("route-status-detail"));
  check(/rover \d+ % battery, (?!0\.00)\d+\.\d+ km driven/.test(detail1), `rover is driving in real time: ${detail1}`);
  await shot(p, "route-desktop-scouting");
  await p.getByTestId("route-skip").click();
  await p.waitForTimeout(500);
  check((await phase(p)) === "decision", "scouting finished: phase is decision");
  const detail2 = await text(p.getByTestId("route-status-detail"));
  const obs = Number(/(\d+) observation/.exec(detail2)?.[1] ?? 0);
  check(obs > 0, `observations recorded (${obs})`);
  check(/Crew waiting [1-9]\d* min/.test(detail2), "crew waiting time is accounted");
  check(/A crew route clearly shorter/.test(await text(p.getByTestId("route-scout-result"))), "scouting result explained");
  st = await terrainState(p);
  check(st.route.key !== keyBefore, "map updated (overlay re-tinted from the new observations)");
  check(st.route.paths.some((x) => x.id === "rover-track" && x.points > 2), "rover track drawn");
  check(/crew-blocked/.test(await text(p.getByTestId("route-log"))), "event log lists the observations");
  check((await recommended(p)) === "detour", "B: re-planning recommends the detour");
  const detourVal = Number(await p.getByTestId("route-option-detour").getAttribute("data-value"));
  const knownVal = Number(await p.getByTestId("route-option-known").getAttribute("data-value"));
  check(detourVal > knownVal, `detour (${detourVal}) beats the known route (${knownVal}) after the wait`);
  check(st.route.paths.some((x) => x.id === "preview" && x.tone === "recommended"), "recommended detour previewed in green");
  await shot(p, "route-desktop-decision");
  await p.getByTestId("route-choose-detour").click();
  await p.waitForTimeout(300);
  check((await phase(p)) === "approved", "detour approved");
  check(/Approved: detour → Target A · walk \d+\.\d+ km · EVA \d+\.\d+ h · O₂ margin \d+ % · return route/.test(await text(p.getByTestId("route-approved"))), "approved route shows its budget and return route");
  st = await terrainState(p);
  check(st.route.paths.some((x) => x.id === "approved") && st.route.paths.some((x) => x.id === "approved-return" && x.dashed), "approved outbound and return routes drawn");
  check((await p.getByTestId("route-choose-known").count()) === 0, "no further approval after a decision");

  // Simulator truth toggle, 2D plan.
  await p.getByTestId("route-truth").check();
  check(await p.getByTestId("route-truth-warning").isVisible(), "hidden-truth view is labelled as simulator only");
  await p.getByTestId("route-truth").uncheck();
  await p.getByTestId("route-view-2d").click();
  await p.getByTestId("route-plan-canvas").waitFor();
  const painted = await p.getByTestId("route-plan-canvas").evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 60) n++;
    return n;
  });
  check(painted > 100, "2D plan draws the orthoimage, tint and routes");
  await shot(p, "route-desktop-2d");

  // EVA HUD shows the approved route; the mission planning screen still works.
  await p.getByTestId("mg-mode-eva").click();
  check(/Route \(simulated\): detour → Target A · walk/.test(await text(p.getByTestId("mg-eva-route-status"))), "EVA HUD shows the approved route budget");
  await p.getByTestId("mg-mode-planning").click();
  check(await p.getByTestId("mg-planning").isVisible(), "Mission planning still opens");
  await p.getByTestId("mg-mode-route").click();
  check((await phase(p)) === "approved", "route state kept across tabs");

  // Variant C: scouting feasible but not worth it.
  await p.getByTestId("route-view-3d").click();
  await p.getByTestId("route-variant-C").click();
  await p.waitForTimeout(400);
  check((await p.getByTestId("route-option-scout").getAttribute("data-feasible")) === "true", "C: scouting is feasible");
  check((await recommended(p)) === "known", "C: the known route has the highest value (scouting too costly)");

  // A tighter EVA window is a hard limit.
  await p.getByTestId("route-assumptions").locator("summary").click();
  await p.getByTestId("route-input-evaMaxH").fill("1");
  await p.getByTestId("route-apply-assumptions").click();
  await p.waitForTimeout(300);
  check((await p.getByTestId("route-option-known").getAttribute("data-feasible")) === "false" && /exceeds the 1 h suit rating/.test(await text(p.getByTestId("route-option-known"))), "1 h EVA window makes the known route infeasible");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  // ---------- Phone ----------
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOT_DIR ? 2 : 1 });
  const mErrors = [];
  mp.on("pageerror", (e) => mErrors.push(String(e)));
  await openRoute(mp);
  await mp.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="terrain-viewer"]')?.getAttribute("data-terrain-state") || "{}").loaded, undefined, { timeout: 30_000 });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, `phone: no horizontal scroll (${overflow}px)`);
  await mp.getByTestId("route-choose-scout").scrollIntoViewIfNeeded();
  await mp.getByTestId("route-choose-scout").click();
  await mp.getByTestId("route-skip").click();
  await mp.waitForTimeout(400);
  check((await phase(mp)) === "decision" && (await recommended(mp)) === "continue", "phone: A scouting confirms the shortcut; continue recommended");
  await mp.getByTestId("route-status").scrollIntoViewIfNeeded();
  await shot(mp, "route-phone");
  check(mErrors.length === 0, `phone: no page errors${mErrors.length ? `: ${mErrors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) process.exit(1);
