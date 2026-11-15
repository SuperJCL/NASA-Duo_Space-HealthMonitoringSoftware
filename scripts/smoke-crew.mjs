#!/usr/bin/env node
/**
 * Browser acceptance run for the MyoMars Mars Base (/), standalone (local mock): the Mission Map as
 * background, the Health Monitoring overlay, the explicit local simulated demo (three simulated crew).
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-crew.mjs
 *   SHOT_DIR=/some/dir ...   also saves the acceptance screenshots (1440×900 @2x):
 *     1-overlay-analysing, 2-review, 3-waiting-feedback, 4-complete
 *
 * It drives the page like a person (overlay, crew chips, decision area, the labelled local demo drawer).
 * It verifies the station alone (standalone mock); it does NOT verify any link with the real HUD or data source.
 */
import { chromium } from "playwright";

const ORIGIN = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? null;
const VIEW = { width: 1440, height: 900 };
const ANALYSIS = 4 * 2600 + 600; // the station paces the simulated analysis at 2.6 s per stage
const failures = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures.push(msg);
};
const text = async (l) => ((await l.first().textContent().catch(() => null)) ?? "").trim();
const tid = (p, id) => p.getByTestId(id);
const attr = (p, id, a) => tid(p, id).first().getAttribute(a);
const onScreen = async (p, id) => {
  const b = await tid(p, id).first().boundingBox();
  return !!b && b.y >= 0 && b.y + b.height <= VIEW.height && b.x >= 0 && b.x + b.width <= VIEW.width;
};
// The decision area states where the flow is, who acts next, and its phase.
const phase = (p) => attr(p, "decision-panel", "data-phase");
const where = (p) => attr(p, "decision-panel", "data-where");
const who = (p) => attr(p, "decision-panel", "data-who");
const person = (p) => attr(p, "health-overlay", "data-astronaut");
const overlay = (p) => attr(p, "crew-station", "data-overlay");
const waitPhase = (p, ph, timeout = 30_000) => p.waitForFunction((x) => document.querySelector('[data-testid="decision-panel"]')?.dataset.phase === x, ph, { timeout });
const waitWhere = (p, re, timeout = 15_000) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid="decision-panel"]')?.dataset.where ?? ""), re.source, { timeout });
async function drawer(p, fn) {
  if (!(await tid(p, "demo-drawer").count())) await tid(p, "demo-toggle").evaluate((el) => el.click());
  await fn();
  // A start collapses the drawer into the compact bar by itself.
  if (await tid(p, "demo-drawer").count()) await tid(p, "demo-close").click();
}
async function launch(p, astronaut, scenario) {
  await drawer(p, async () => {
    await tid(p, "demo-astronaut").selectOption(astronaut);
    await tid(p, "demo-scenario").selectOption(scenario);
    await tid(p, "demo-launch").click();
  });
}
const hud = (p, kind) => drawer(p, () => tid(p, `demo-hud-${kind}`).click());
const select = async (p, id) => {
  await tid(p, `crew-card-${id}`).click();
  await p.waitForTimeout(250);
};
async function decide(p, decision, reason) {
  await tid(p, `decide-${decision}`).click();
  if (reason === null) await tid(p, "reason-template").first().click();
  else await tid(p, "confirm-reason").fill(reason);
  await tid(p, "confirm-submit").click();
  await p.waitForTimeout(250);
}
async function shot(p, name) {
  if (!SHOT_DIR) return;
  await p.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SHOT_DIR ? 2 : 1 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::/.test(m.text()) && errors.push(m.text()));

  // ---------- Entry ----------
  await p.goto(ORIGIN + "/", { waitUntil: "domcontentloaded" });
  await tid(p, "crew-station").waitFor();
  check((await p.title()) === "MyoMars · Mars Base", "/ is the MyoMars Mars Base");
  check((await text(tid(p, "station-sim-pill"))) === "Simulated Data · Simulated Analysis" && /Local simulation · no real HUD or data source/.test(await text(tid(p, "station-link"))), "header: Simulated Data · Simulated Analysis, local simulation without a real HUD");
  await p.waitForSelector('[data-testid="mission-glass"]', { timeout: 60_000 });
  check((await overlay(p)) === "open" && (await tid(p, "map-view").count()) === 1, "the Mission Map is the background; the standalone demo opens Health Monitoring over it");
  check((await tid(p, "crew-empty").count()) === 1 && (await tid(p, "station-dev").count()) === 0 && (await tid(p, "demo-drawer").count()) === 0, "empty overlay; dev entry and demo drawer hidden by default");
  await tid(p, "demo-toggle").click();
  check(/Local simulated demo/.test(await attr(p, "demo-drawer", "aria-label")) && !(await tid(p, "demo-auto").isChecked()), "demo drawer labelled local simulation; auto HUD feedback off by default");
  await tid(p, "demo-close").click();

  // ---------- New device observation: the overlay shows the first crew member; analysis runs on its own ----------
  await launch(p, "ev1", "change");
  check((await p.locator("[data-crew-card]").count()) === 3, "three simulated crew members (explicit local demo roster only)");
  await p.waitForTimeout(1700);
  check((await person(p)) === "ev1" && (await phase(p)) === "analysing" && (await who(p)) === "System", "EV1's case analyses by itself: decision area says the system acts, no action needed");
  check(/Single observation · no earlier data, no trend/.test(await text(tid(p, "obs-history"))) && /Simulated sample/.test(await text(tid(p, "obs-summary"))), "observation: one simulated sample, no invented history or trend");
  check((await attr(p, "crew-card-ev1", "data-unread")) === "0", "the case shown in the open overlay is marked viewed by the base (unread 0)");
  check((await tid(p, "chain-marker").count()) === 1 && ["running", "done"].includes(await attr(p, "chain-0", "data-state")), "compact chain follows the station's steps (with a data marker element)");
  await shot(p, "1-overlay-analysing");
  await waitPhase(p, "review");
  check((await who(p)) === "Base staff" && /Awaiting Base Review/.test(await where(p)), "stops at Awaiting Base Review; base staff act next");
  check((await attr(p, "chain-4", "data-state")) === "human" && (await tid(p, "chain-branch").count()) === 0, "normal path: the chain stops at Base Review; no failure branch");
  for (const id of ["decision-conclusion", "decision-evidence", "decision-outgoing", "decide-approve", "compact-chain"]) check(await onScreen(p, id), `review at 1440×900 without page scroll: ${id} visible`);
  check(await p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), "the page itself does not scroll");
  check((await p.locator('[data-testid="indicator-chart"] [data-testid^="indicator-"]').count()) === 3 && /grip meter/.test(await text(tid(p, "indicator-gripForceN"))) && /no raw sEMG waveform/.test(await text(tid(p, "indicator-chart"))), "summary indicators only; grip from the grip meter; no fake waveform");
  check((await p.locator('[data-testid="outgoing-action"]').count()) === 2 && /Draft only: nothing is sent before you confirm/.test(await text(tid(p, "decision-outgoing"))), "the actual notice and retest text are previewed as a draft");
  check((await p.locator('[data-testid="comm-action"]').count()) === 0 && /not sent/.test(await text(tid(p, "comm-list"))), "nothing sent before approval; the analysis is marked not sent");
  await shot(p, "2-review");

  // ---------- Collapse / reopen keeps the review form and the draft ----------
  await tid(p, "decide-approve").click();
  await tid(p, "confirm-reason").fill("Draft: to be completed");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  check((await overlay(p)) === "map" || (await overlay(p)) === "collapsed", "Esc collapses the overlay");
  check((await p.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "overlay-toggle", "focus returns to the Health Monitoring toggle");
  check(Number(await attr(p, "mission-pending", "data-count")) === 1, "collapsing does not change the case (still 1 to review)");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(300);
  check((await overlay(p)) === "open" && (await tid(p, "confirm-dialog").isVisible()) && (await tid(p, "confirm-reason").inputValue()) === "Draft: to be completed", "keyboard Enter reopens; the open review form and its draft are kept");
  check(/Retest task/.test(await text(tid(p, "decision-outgoing"))) && /Notice/.test(await text(tid(p, "decision-outgoing"))) && (await tid(p, "confirm-conditions").count()) === 1 && /Base duty officer/.test(await text(tid(p, "confirm-dialog"))), "review form: actual content, execution conditions and the demo reviewer");
  await tid(p, "confirm-cancel").click();
  await tid(p, "decide-approve").click();
  check((await tid(p, "confirm-reason").inputValue()) === "Draft: to be completed", "unsent draft kept across cancel");
  await tid(p, "confirm-reason").fill("");
  await tid(p, "confirm-submit").click();
  check(/reason/i.test(await text(tid(p, "confirm-error"))) && (await p.locator('[data-testid="comm-action"]').count()) === 0, "no reason → refused, nothing published");
  await tid(p, "reason-template").first().click();
  await tid(p, "confirm-submit").click();
  await p.waitForTimeout(300);

  // ---------- Waiting for feedback: only real (simulated) replies move it ----------
  check((await p.locator('[data-testid="comm-action"]').count()) === 2 && /Received by HUD/.test(await where(p)) && (await who(p)) === "HUD", "approved: 2 action messages; waits for the HUD receipt");
  check(/local sim/.test(await text(tid(p, "track-sent"))) && (await attr(p, "track-hud", "data-state")) === "pending" && /since/.test(await text(tid(p, "current-waiting"))), "hand-off shown as local simulation; no receipt shown; waiting says whom and since when");
  await shot(p, "3-waiting-feedback");
  await p.waitForTimeout(4000);
  check(/Received by HUD/.test(await where(p)), "no receipt is inferred from time (auto feedback off)");
  await hud(p, "received");
  check(/Acknowledged by Crew/.test(await where(p)) && (await p.locator('[data-testid="comm-receipt"]').count()) === 2, "simulated HUD receipt recorded; next: crew acknowledgement");
  await hud(p, "defer");
  check((await phase(p)) === "deferred" && (await who(p)) === "Base staff" && /Deferred by the crew/.test(await text(tid(p, "decision-panel"))), "deferral stops the flow with the reason, back to base staff");
  await hud(p, "ack");
  check(/Awaiting retest result/.test(await where(p)), "acknowledgement recorded; waiting for the retest result");

  // Another astronaut's message while EV1 is handled: notify only.
  await launch(p, "ev2", "normal");
  await p.waitForTimeout(1800);
  check((await person(p)) === "ev1" && (await tid(p, "panel-notice-ev2").count()) === 1, "EV2's new message only notifies inside the overlay (no focus or person switch)");

  await hud(p, "retest-normal");
  await p.waitForTimeout(300);
  check((await phase(p)) === "analysing" && /Round 1 result \(kept unchanged\)/.test(await text(tid(p, "decision-panel"))), "retest result starts round 2 automatically; round 1 kept");
  await waitPhase(p, "reassessed");
  check(/original alert is still open/.test(await text(tid(p, "decision-first-result"))) && /v2 · retest/.test(await text(tid(p, "panel-eval-status"))) && /Within Reference Range/.test(await text(tid(p, "decision-conclusion"))) && /Alert open/.test(await text(tid(p, "panel-case-status"))), "re-evaluation: in range, original alert still open, shown as two statuses");
  check((await attr(p, "indicator-chart", "data-paired")) === "yes" && (await p.locator('[data-testid="indicator-chart"] span[title^="v1"]').count()) === 3, "v1 and v2 side by side only because both are comparable");

  // Full flow inside the overlay: visual replay only.
  const commBefore = await p.locator('[data-testid="comm-list"] li').count();
  await tid(p, "full-flow-open").click();
  await tid(p, "flow-canvas").waitFor();
  await tid(p, "canvas-speed").selectOption("2");
  await tid(p, "canvas-replay").click();
  check((await attr(p, "flow-canvas", "data-mode")) === "replay" && /Visual replay/.test(await text(tid(p, "canvas-mode"))), "full flow: visual replay is labelled (no re-analysis, no message)");
  await tid(p, "canvas-pause").click();
  const pausedAt = await attr(p, "flow-canvas", "data-step");
  await p.waitForTimeout(1600);
  check((await attr(p, "flow-canvas", "data-step")) === pausedAt, "replay can be paused");
  await tid(p, "canvas-pause").click();
  await tid(p, "full-flow-back").click();
  await p.waitForTimeout(250);
  check((await p.locator('[data-testid="comm-list"] li').count()) === commBefore && (await phase(p)) === "reassessed", "full flow and Back publish nothing and change no state");

  // ---------- Close: status notice, delivery tracked separately ----------
  await tid(p, "decide-close").click();
  check(/Case Closed by base staff/.test(await text(tid(p, "outgoing-status"))) && (await p.locator('[data-testid="outgoing-action"]').count()) === 0, "close: the status-notice text is shown before confirming; no action message");
  await tid(p, "reason-template").first().click();
  await tid(p, "confirm-submit").click();
  await p.waitForTimeout(300);
  check((await phase(p)) === "closed" && (await who(p)) === "None" && /Case Closed does not mean the astronaut is healthy/.test(await text(tid(p, "decision-closed"))), "closed: handling complete, nothing left to do, no health claim");
  check(/awaiting the HUD receipt/.test(await text(tid(p, "panel-notice-pending"))) && (await p.locator('[data-testid="comm-status"]').count()) === 1, "case closed, notice delivery still pending — recorded apart");
  await hud(p, "received");
  check(/Received by HUD/.test(await text(tid(p, "panel-notice-pending"))), "notice receipt recorded");
  await shot(p, "4-complete");
  check((await attr(p, "crew-card-ev1", "data-needs-base")) === "no" && (await attr(p, "crew-card-ev2", "data-needs-base")) === "yes", "crew chips updated: EV1 nothing to review; EV2 has a case for base staff");

  // ---------- Continue Monitoring is not the end ----------
  await tid(p, "panel-notice-ev2").click().catch(async () => select(p, "ev2"));
  await p.waitForTimeout(250);
  check((await person(p)) === "ev2" && /Within Reference Range/.test(await text(tid(p, "decision-conclusion"))), "the notification opens that astronaut (normal measurement, calm)");
  await decide(p, "keep-open", null);
  check((await phase(p)) === "monitoring" && /Decision recorded: Continue Monitoring/.test(await text(tid(p, "decision-monitoring"))) && (await tid(p, "decide-close").count()) === 1 && (await tid(p, "process-summary").count()) === 0, "Continue Monitoring: case stays open, only Close case remains (quiet), no completion");

  // ---------- Exceptions stop where they happen ----------
  await launch(p, "ev3", "acquisition");
  await p.waitForTimeout(1700 + ANALYSIS);
  await select(p, "ev3");
  check((await attr(p, "chain-1", "data-state")) === "stopped" && (await attr(p, "chain-2", "data-state")) === "skipped" && (await tid(p, "chain-branch").count()) === 1 && /Unable to Assess/.test(await text(tid(p, "decision-conclusion"))), "quality failure: stops at Signal Quality, branch to remeasure, later steps not run");
  await tid(p, "full-flow-open").click();
  await tid(p, "flow-canvas").waitFor();
  await p.waitForFunction(() => document.querySelector('[data-testid="flow-canvas"]')?.dataset.phase === "end", null, { timeout: 30_000 });
  check((await attr(p, "canvas-node-quality", "data-state")) === "stopped" && (await attr(p, "canvas-node-branch", "data-state")) === "done" && (await attr(p, "canvas-node-context", "data-state")) === "skipped", "full flow: Signal Quality stopped, the check-device / remeasure branch taken, normal downstream not run");
  check((await attr(p, "canvas-edge-b-quality", "data-state")) === "done" && (await attr(p, "canvas-edge-e-context", "data-state")) === "skipped", "the failure edge is the one used; the normal edge is marked not run");
  await tid(p, "full-flow-back").click();
  await launch(p, "ev2", "report");
  await p.waitForTimeout(1700 + ANALYSIS);
  await select(p, "ev2");
  const reportCase = (await tid(p, "panel-case-switch").locator("button").last().getAttribute("data-testid"))?.replace("panel-case-", "");
  if (reportCase) await tid(p, `panel-case-${reportCase}`).click();
  await p.waitForTimeout(250);
  check((await tid(p, "panel-case-switch").count()) === 1 && /Astronaut report/.test(await text(tid(p, "obs-summary"))), "HUD report: its own case (switcher), shown as the astronaut's own words");
  check((await phase(p)) === "review" && /Approve: reply and schedule a measurement/.test(await text(tid(p, "decide-approve"))), "HUD report: base decides whether to reply and request a standardised measurement");
  check((await p.locator('[data-testid="comm-report"]').count()) === 1, "report shown in the message stream");

  // ---------- English only ----------
  const cjk = (await p.evaluate(() => document.body.innerText)).match(/[一-鿿]/g) ?? [];
  check(cjk.length === 0, `no Chinese text on the page${cjk.length ? `: ${cjk.slice(0, 10).join("")}` : ""}`);

  // ---------- Reset ----------
  await drawer(p, () => tid(p, "demo-reset").click());
  await p.waitForTimeout(6000);
  check((await tid(p, "crew-empty").count()) === 1, "reset ends the run; nothing continues afterwards");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  // ---------- Send failure (advanced dev entry) ----------
  const d = await browser.newPage({ viewport: VIEW });
  await d.goto(ORIGIN + "/?dev=1", { waitUntil: "domcontentloaded" });
  await tid(d, "crew-station").waitFor();
  await launch(d, "ev1", "change");
  await d.waitForTimeout(1700 + ANALYSIS);
  await tid(d, "dev-fail-next").evaluate((el) => el.click());
  await tid(d, "station-dev-toggle").evaluate((el) => el.click()); // collapse the debug overlay
  await waitPhase(d, "review");
  await decide(d, "approve", null);
  check((await phase(d)) === "failed" && (await tid(d, "action-resend").count()) === 1, "send failure stops the flow with Resend");
  await tid(d, "action-resend").click();
  await d.waitForTimeout(250);
  check(/Received by HUD/.test(await where(d)), "resent; waiting for the HUD again");

  // ---------- Reduced motion: same results, no animations ----------
  const ctx = await browser.newContext({ viewport: VIEW, reducedMotion: "reduce" });
  const r = await ctx.newPage();
  await r.goto(ORIGIN + "/", { waitUntil: "domcontentloaded" });
  await tid(r, "crew-station").waitFor();
  await launch(r, "ev1", "change");
  await r.waitForTimeout(1700);
  await waitPhase(r, "review");
  await decide(r, "approve", null);
  check(/Received by HUD/.test(await where(r)) && (await r.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)) === 0, "reduced motion: same flow, no running animations");
  await ctx.close();

  // ---------- Phone ----------
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(ORIGIN + "/", { waitUntil: "domcontentloaded" });
  await tid(m, "crew-station").waitFor();
  await launch(m, "ev1", "change");
  await m.waitForTimeout(1700);
  check((await tid(m, "decision-panel").isVisible()) && (await tid(m, "obs-summary").count()) === 1, "phone: one column, decision area first");
  check((await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, "phone: no horizontal scroll");
} finally {
  await browser.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) process.exit(1);
