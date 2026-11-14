#!/usr/bin/env node
/**
 * Browser acceptance run for the MyoMars base station crew overview (/), standalone (local mock).
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-crew.mjs
 *   SHOT_DIR=/some/dir ...   also saves the four acceptance screenshots (1440×900 @2x):
 *     1-home-alert, 2-analysis-running, 3-waiting-feedback, 4-complete
 *
 * It drives the page like a person (cards, panel, confirmation, the labelled local demo drawer).
 * It verifies the station alone; it does NOT verify any link with the real Trigger or HUD.
 */
import { chromium } from "playwright";

const ORIGIN = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? null;
const VIEW = { width: 1440, height: 900 };
const ANALYSIS = 4 * 1100 + 400;
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
const fact = (p, k) => text(tid(p, `panel-fact-${k}`));
const waitFact = (p, k, re, timeout = 15_000) => p.waitForFunction(([id, src]) => new RegExp(src).test(document.querySelector(`[data-testid="${id}"]`)?.textContent ?? ""), [`panel-fact-${k}`, re.source], { timeout });
async function drawer(p, fn) {
  if (!(await tid(p, "demo-drawer").count())) await tid(p, "demo-toggle").evaluate((el) => el.click());
  await fn();
  await tid(p, "demo-close").click();
}
async function launch(p, astronaut, scenario) {
  await drawer(p, async () => {
    await tid(p, "demo-astronaut").selectOption(astronaut);
    await tid(p, "demo-scenario").selectOption(scenario);
    await tid(p, "demo-launch").click();
  });
}
const hud = (p, kind) => drawer(p, () => tid(p, `demo-hud-${kind}`).click());
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
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  // ---------- Entry ----------
  await p.goto(ORIGIN + "/", { waitUntil: "networkidle" });
  check((await p.title()) === "MyoMars · 火星基站", "/ is the MyoMars base station");
  check((await text(tid(p, "station-sim-pill"))) === "模拟数据 / 模拟分析" && /未连接真实 Trigger \/ HUD/.test(await text(tid(p, "station-link"))), "header: 模拟数据 / 模拟分析 and 未连接真实 Trigger / HUD");
  check((await p.getByTestId("mars-map").count()) === 0 && (await p.getByTestId("mg-mode-route").count()) === 0, "no map and no EVA route entry on the home page");
  check((await tid(p, "crew-empty").count()) === 1 && (await tid(p, "station-dev").count()) === 0 && (await tid(p, "demo-drawer").count()) === 0, "empty overview; dev entry and demo drawer hidden by default");
  await tid(p, "demo-toggle").click();
  check(/本地模拟演示/.test(await text(tid(p, "demo-drawer"))) && !(await tid(p, "demo-auto").isChecked()), "demo drawer labelled local simulation; auto HUD feedback off by default");
  await tid(p, "demo-close").click();

  // ---------- New device observation → card alert (no auto open) ----------
  await launch(p, "ev1", "change");
  check((await p.locator("[data-crew-card]").count()) === 3, "three simulated crew cards");
  check((await attr(p, "crew-card-ev2", "data-validity")) === "none" && /无法评估/.test(await text(tid(p, "crew-card-ev2").getByTestId("crew-card-data"))), "no data → 无法评估 (never shown as healthy)");
  check((await attr(p, "crew-card-ev2", "data-connection")) === "connected", "device connection shown separately from data validity");
  await p.waitForTimeout(1700);
  check((await attr(p, "crew-card-ev1", "data-unread")) === "1" && /收到设备观测，正在核查/.test(await text(tid(p, "crew-card-ev1").getByTestId("crew-card-event"))), "EV1 card: 收到设备观测，正在核查, 1 unread");
  check((await tid(p, "crew-notice-ev1").count()) === 1 && (await tid(p, "person-panel").count()) === 0, "clickable top notification; the panel does not open by itself");
  await shot(p, "1-home-alert");
  await tid(p, "demo-toggle").click();
  await tid(p, "demo-close").click();
  check((await attr(p, "crew-card-ev1", "data-unread")) === "1", "unread count unchanged by re-rendering");

  // ---------- Panel: analysis runs on its own ----------
  await tid(p, "crew-card-ev1").click();
  await p.waitForTimeout(250);
  check((await tid(p, "person-panel").count()) === 1 && (await p.evaluate(() => !!document.activeElement?.closest('[data-testid="person-panel"]'))), "card opens the person panel; focus moves into it");
  check((await fact(p, "who")) === "系统" && (await p.locator('[data-testid^="node-v1:"][data-state="running"]').count()) === 1, "analysis in progress: one running node, handled by the system");
  check((await attr(p, "crew-card-ev1", "data-unread")) === "0", "opening the event marks it viewed by the base (unread 0)");
  await shot(p, "2-analysis-running");
  await waitFact(p, "who", /基地人员/);
  check((await fact(p, "where")) === "审核与派发 · 等待基地批准" && /发布前必须由基地人员批准/.test(await fact(p, "why")), "stops at 等待基地批准 with the reason");
  for (const id of ["panel-facts", "indicator-chart", "decide-approve"]) check(await onScreen(p, id), `review, 1440×900 first screen: ${id} visible`);
  check((await p.locator('[data-testid="indicator-chart"] [data-testid^="indicator-"]').count()) === 3 && /握力计/.test(await text(tid(p, "indicator-gripForceN"))) && /没有原始肌电波形/.test(await text(tid(p, "indicator-chart"))), "summary indicators only; grip from the grip meter; no fake waveform");
  check((await p.locator('[data-testid="comm-action"]').count()) === 0 && /未发送/.test(await text(tid(p, "comm-list"))), "nothing sent before approval; analysis marked 未发送");

  // ---------- Collapse / reopen / drafts ----------
  await tid(p, "decide-approve").click();
  await tid(p, "confirm-reason").fill("草稿：待补充");
  await tid(p, "confirm-cancel").click();
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
  check((await tid(p, "person-panel").count()) === 0 && (await p.evaluate(() => document.activeElement?.getAttribute("data-crew-card"))) === "ev1", "Esc collapses the panel; focus returns to the EV1 card");
  check(/需要基地审核/.test(await text(tid(p, "crew-card-ev1").getByTestId("crew-card-event"))), "collapsing does not change the case (still 需要基地审核)");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(250);
  check((await fact(p, "where")) === "审核与派发 · 等待基地批准", "keyboard Enter reopens; flow restored");
  await tid(p, "decide-approve").click();
  check((await tid(p, "confirm-reason").inputValue()) === "草稿：待补充", "unsent draft kept across cancel and collapse");
  check(/将发送给 HUD 的行动消息（2 条/.test(await text(tid(p, "confirm-content"))) && /执行条件/.test(await text(tid(p, "confirm-dialog"))) && /审核人：基地值班员/.test(await text(tid(p, "confirm-dialog"))), "confirmation shows the actual content, execution conditions and the demo reviewer");
  await tid(p, "confirm-reason").fill("");
  await tid(p, "confirm-submit").click();
  check(/理由/.test(await text(tid(p, "confirm-error"))) && (await p.locator('[data-testid="comm-action"]').count()) === 0, "no reason → refused, nothing published");
  await tid(p, "reason-template").first().click();
  await tid(p, "confirm-submit").click();
  await p.waitForTimeout(300);

  // ---------- Waiting for feedback: only real (simulated) replies move it ----------
  check((await p.locator('[data-testid="comm-action"]').count()) === 2 && (await fact(p, "where")) === "审核与派发 · HUD 接收" && (await fact(p, "who")) === "HUD", "approved: 2 action messages; waits for the HUD receipt");
  check(/仅本地模拟/.test(await text(tid(p, "comm-action"))) && /已等待/.test(await text(tid(p, "current-waiting"))), "hand-off shown as 仅本地模拟; waiting shows whom, since when, how long");
  await shot(p, "3-waiting-feedback");
  await p.waitForTimeout(4000);
  check((await fact(p, "where")) === "审核与派发 · HUD 接收", "no receipt is inferred from time (auto feedback off)");
  await hud(p, "received");
  check((await fact(p, "where")) === "审核与派发 · 宇航员确认" && (await p.locator('[data-testid="comm-receipt"]').count()) === 2, "simulated HUD receipt recorded; next: astronaut confirmation");
  await hud(p, "defer");
  check((await fact(p, "who")) === "基地人员" && /宇航员暂缓/.test(await fact(p, "why")), "deferral stops the flow with the reason, back to base staff");
  await hud(p, "ack");
  check((await fact(p, "where")) === "审核与派发 · 等待复测结果", "confirmation recorded; waiting for the retest result");

  // Another astronaut's message while EV1 is handled: notify only.
  await launch(p, "ev2", "normal");
  await p.waitForTimeout(1800);
  check((await attr(p, "person-panel", "data-astronaut")) === "ev1" && (await tid(p, "panel-notice-ev2").count()) === 1, "EV2's new message only notifies inside EV1's panel (no focus or panel switch)");

  await hud(p, "retest-normal");
  await p.waitForTimeout(300);
  check((await fact(p, "who")) === "系统" && (await p.locator('[data-testid="row-v1:analysis"]').count()) === 1 && (await p.locator('[data-testid="row-v2:analysis"]').count()) === 1, "retest result starts round 2 automatically; round 1 kept");
  await waitFact(p, "who", /基地人员/);
  check(/原告警未关闭/.test(await fact(p, "why")) && /最新评估 v2（复测）：在参考范围内/.test(await text(tid(p, "panel-eval-status"))) && /告警未关闭/.test(await text(tid(p, "panel-case-status"))), "re-evaluation: in range, original alert still open, shown as two statuses");
  check(/都满足质量与可比条件/.test(await text(tid(p, "node-relation"))) && (await p.locator('[data-testid="indicator-chart"] span[title^="v1"]').count()) === 3, "applicability shown; v1 and v2 side by side only because both are comparable");

  // Replay: visual only.
  const commBefore = await p.locator('[data-testid="comm-list"] li').count();
  await tid(p, "row-replay-v1:analysis").click();
  check((await tid(p, "replay-note").count()) === 1, "replay of round 1 is labelled visual-only");
  await p.waitForTimeout(1600);
  check((await p.locator('[data-testid="comm-list"] li').count()) === commBefore && /等待人工处理/.test(await fact(p, "where")), "replay publishes nothing and changes no state");
  await tid(p, "row-replay-v1:analysis").click(); // stop the replay
  check((await tid(p, "replay-note").count()) === 0, "replay can be stopped");

  // ---------- Close: status notification, delivery tracked separately ----------
  await tid(p, "decide-close").click();
  check(/此事件已由基地人员关闭/.test(await text(tid(p, "confirm-content"))) && /不是行动/.test(await text(tid(p, "confirm-content"))), "close: the status notification text shown before confirming");
  await tid(p, "reason-template").first().click();
  await tid(p, "confirm-submit").click();
  await p.waitForTimeout(300);
  check((await tid(p, "process-summary").count()) === 1 && (await fact(p, "who")) === "无需处理", "closed: one expandable process summary; nothing left to do");
  check(/等待 HUD 接收回执/.test(await text(tid(p, "panel-notice-pending"))) && (await p.locator('[data-testid="comm-status"]').count()) === 1, "case closed, notification delivery still pending — recorded apart");
  await hud(p, "received");
  check((await tid(p, "panel-notice-pending").count()) === 0, "notification receipt recorded");
  await shot(p, "4-complete");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
  check(/已处理（事件关闭）/.test(await text(tid(p, "crew-card-ev1").getByTestId("crew-card-event"))) && (await attr(p, "crew-card-ev1", "data-needs-base")) === "no", "home card updated: EV1 已处理");
  check(/测量正常 · 待确认记录/.test(await text(tid(p, "crew-card-ev2").getByTestId("crew-card-event"))) && (await attr(p, "crew-card-ev2", "data-needs-base")) === "no", "EV2 normal measurement: calm status, not an alarm");

  // ---------- Keep watching is not the end ----------
  await tid(p, "crew-notice-ev2").click();
  await p.waitForTimeout(250);
  check((await attr(p, "person-panel", "data-astronaut")) === "ev2", "notification opens that astronaut's panel");
  await decide(p, "keep-open", null);
  check(/继续关注中/.test(await fact(p, "where")) && (await tid(p, "process-summary").count()) === 0 && (await tid(p, "decide-close").count()) === 1, "继续关注: case stays open, only 关闭事件 remains, no completion summary");
  await p.keyboard.press("Escape");

  // ---------- Exceptions stop where they happen ----------
  await launch(p, "ev3", "acquisition");
  await p.waitForTimeout(1700 + ANALYSIS);
  check((await attr(p, "crew-card-ev3", "data-validity")) === "invalid" && /无法评估/.test(await text(tid(p, "crew-card-ev3").getByTestId("crew-card-data"))), "EV3 invalid data: 数据不可用 · 无法评估");
  await tid(p, "crew-card-ev3").click();
  check((await attr(p, "node-v1:quality", "data-state")) === "stopped" && /信号质量不合格/.test(await fact(p, "why")), "quality failure stops at 信号质量 with the reason");
  await p.keyboard.press("Escape");
  await launch(p, "ev2", "report");
  await p.waitForTimeout(1700 + ANALYSIS);
  await tid(p, "crew-notice-ev2").click();
  await p.waitForTimeout(250);
  check((await tid(p, "panel-case-switch").count()) === 1 && /宇航员主动报告.*不作诊断.*仅参考/.test(await text(tid(p, "row-summary-v1:analysis"))), "HUD report: own event (switcher), checked, not a diagnosis; EV2's earlier valid measurement only as reference");
  check((await fact(p, "where")) === "审核与派发 · 等待基地批准" && (await text(tid(p, "decide-approve"))) === "查看并回复、安排测量", "HUD report: base decides whether to reply and request a standardised measurement");
  check((await p.locator('[data-testid="comm-report"]').count()) === 1, "report shown in the message stream");
  await p.keyboard.press("Escape");

  // ---------- Reset ----------
  await drawer(p, () => tid(p, "demo-reset").click());
  await p.waitForTimeout(6000);
  check((await tid(p, "crew-empty").count()) === 1, "reset ends the run; nothing continues afterwards");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  // ---------- Send failure (advanced dev entry) ----------
  const d = await browser.newPage({ viewport: VIEW });
  await d.goto(ORIGIN + "/?dev=1", { waitUntil: "networkidle" });
  await launch(d, "ev1", "change");
  await d.waitForTimeout(1700 + ANALYSIS);
  await tid(d, "crew-card-ev1").click();
  await tid(d, "dev-fail-next").evaluate((el) => el.click());
  await tid(d, "station-dev-toggle").evaluate((el) => el.click()); // collapse the debug overlay
  await decide(d, "approve", null);
  check((await attr(d, "node-v1:send", "data-state")) === "stopped" && (await tid(d, "action-resend").count()) === 1, "send failure stops at 复测已发出 with 重发");
  await tid(d, "action-resend").click();
  await d.waitForTimeout(250);
  check((await fact(d, "where")) === "审核与派发 · HUD 接收", "resent; waiting for the HUD again");

  // ---------- Reduced motion: same results, no animations ----------
  const ctx = await browser.newContext({ viewport: VIEW, reducedMotion: "reduce" });
  const r = await ctx.newPage();
  await r.goto(ORIGIN + "/", { waitUntil: "networkidle" });
  await launch(r, "ev1", "change");
  await r.waitForTimeout(1700);
  await tid(r, "crew-card-ev1").click();
  await waitFact(r, "who", /基地人员/);
  await decide(r, "approve", null);
  check((await fact(r, "where")) === "审核与派发 · HUD 接收" && (await r.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)) === 0, "reduced motion: same flow, no running animations");
  await ctx.close();

  // ---------- Phone ----------
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(ORIGIN + "/", { waitUntil: "networkidle" });
  await launch(m, "ev1", "change");
  await m.waitForTimeout(1700);
  await tid(m, "crew-card-ev1").click();
  await tid(m, "panel-tab-comms").click();
  check(await tid(m, "comm-list").isVisible(), "phone: 分析 / 通信 tabs instead of squeezed columns");
  check((await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, "phone: no horizontal scroll");
} finally {
  await browser.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) process.exit(1);
