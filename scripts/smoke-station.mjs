#!/usr/bin/env node
/**
 * Browser smoke test for the MyoMars base station (/), a health-event workbench, in standalone
 * mode (local mock adapter).
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-station.mjs
 *   SHOT_DIR=/some/dir ...   also saves the three acceptance screenshots (1440×900)
 *
 * Uses the hidden development entry (/?dev=1) to inject Trigger / HUD events. It verifies the
 * station alone; it does NOT verify any link with the real Trigger or HUD.
 */
import { chromium } from "playwright";

const ORIGIN = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? null;
const VIEW = { width: 1440, height: 900 };
const failures = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures.push(msg);
};
const text = async (l) => ((await l.textContent().catch(() => null)) ?? "").trim();
const attr = (p, id, a) => p.getByTestId(id).getAttribute(a);
const waitStage = (p, stage, timeout = 15_000) => p.waitForFunction((st) => document.querySelector('[data-testid="station-case"]')?.getAttribute("data-stage") === st, stage, { timeout });
/** The six-step flow at the top of the right column: "waiting=current,analysing=todo,…". */
const flow = async (p) => (await p.locator('[data-testid="station-flow"] li').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-step")}=${e.getAttribute("data-state")}`))).join(",");
const STAGE_REASSESSED = "重评完成 · 等待人工处理";
const FLOW = ["waiting", "analysing", "review", "dispatched", "retest", "done"];
/** Expected flow string: steps before `current` done (except `skipped`), `current` as given, the rest todo. */
const expectFlow = (current, currentState = "current", skipped = []) => {
  const ci = FLOW.indexOf(current);
  return FLOW.map((s, i) => `${s}=${i === ci ? currentState : i > ci ? "todo" : skipped.includes(s) ? "skipped" : "done"}`).join(",");
};
/** No leftover pending-review prompt: no candidate card, no decision buttons, no confirm button. */
const noPendingPrompt = async (p) => (await p.getByTestId("station-candidate").count()) === 0 && (await p.locator('[data-testid^="station-decide-"]').count()) === 0 && (await p.getByTestId("station-review-confirm").count()) === 0;
const stageStatuses = (p) => p.locator('[data-testid="station-stages"] li').evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
/** Messages for the HUD (station.audit.* traceability records excluded). */
const outbox = async (p) => (await allOutbox(p)).filter((m) => !m.type.startsWith("station.audit."));
const allOutbox = (p) => p.locator('[data-testid="station-outbox"] li').evaluateAll((els) => els.map((e) => ({ type: e.getAttribute("data-type"), delivery: e.getAttribute("data-delivery"), hud: e.getAttribute("data-hud-received"), feedback: e.getAttribute("data-feedback") })));
/** Fully inside the 1440×900 viewport without scrolling anything. */
const onFirstScreen = async (p, id) => {
  const b = await p.getByTestId(id).first().boundingBox();
  return !!b && b.y >= 0 && b.y + b.height <= VIEW.height && b.x >= 0 && b.x + b.width <= VIEW.width;
};
async function decide(p, decision, reason = "已核对证据与局限（测试）") {
  await p.getByTestId(`station-decide-${decision}`).first().click();
  await p.getByTestId("station-review-reason").first().fill(reason);
  await p.getByTestId("station-review-confirm").first().click();
  await p.waitForTimeout(200);
}
const dev = (p, id) => p.getByTestId(id).click();
/** Screenshot without the dev-only overlay (it is not part of the station). */
async function shot(p, name) {
  if (!SHOT_DIR) return;
  await p.addStyleTag({ content: '[data-testid="station-dev"]{visibility:hidden!important}' });
  await p.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  await p.addStyleTag({ content: '[data-testid="station-dev"]{visibility:visible!important}' });
}

const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SHOT_DIR ? 2 : 1 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  // ---------- Entry ----------
  await p.goto(ORIGIN + "/", { waitUntil: "domcontentloaded" });
  await p.getByTestId("station").waitFor();
  check((await p.title()) === "MyoMars · 火星基站", "/ is the MyoMars base station");
  check((await text(p.getByTestId("station-sim-pill"))) === "模拟数据 / 模拟分析", "header always shows 模拟数据 / 模拟分析");
  check(/独立演示/.test(await text(p.getByTestId("station-link"))) && (await attr(p, "station", "data-link-mode")) === "standalone-mock", "link status says standalone demo (mock adapter)");
  check((await p.getByTestId("mars-map").count()) === 0 && (await p.getByTestId("mg-mode-route").count()) === 0, "no map and no EVA route tab on the station");
  check((await p.getByTestId("station-dev").count()) === 0, "development entry hidden without ?dev=1");
  check(/等待场景开始/.test(await text(p.getByTestId("station-empty"))), "empty state before any scenario event");
  check((await flow(p)) === expectFlow("waiting") && (await text(p.getByTestId("station-stage-title"))) === "等待场景开始", "flow: before the scenario, step 1 current and nothing to do");

  // ---------- Normal fixture ----------
  await p.goto(ORIGIN + "/?dev=1", { waitUntil: "domcontentloaded" });
  await p.getByTestId("station-dev").waitFor();
  await dev(p, "dev-start");
  check(/EV1/.test(await text(p.getByTestId("station-crew"))), "astronaut shown after scenario.start");
  // ① 等待观测
  check((await flow(p)) === expectFlow("waiting") && (await text(p.getByTestId("station-stage-title"))) === "等待观测" && /无需操作/.test(await text(p.getByTestId("station-action"))), "① 等待观测: current step, no action needed");
  check(/本地 mock 适配层/.test(await text(p.getByTestId("station-empty"))), "waiting: centre says what is happening and where input comes from (local mock)");
  for (const id of ["station-empty", "station-flow", "station-stage-title"]) check(await onFirstScreen(p, id), `waiting, 1440×900 first screen: ${id} visible`);
  await dev(p, "dev-obs-normal");
  await p.waitForTimeout(250);
  const early = await stageStatuses(p);
  check(early[0] === "running" && early.slice(1).every((x) => x === "waiting"), `analysis stages paced: ${early.join(",")}`);
  check(/正在模拟分析/.test(await text(p.getByTestId("station-what"))) && (await attr(p, "station-action", "data-stage")) === "analysing", "right panel shows analysis in progress, nothing to do");
  check(/EVA 采样作业 · 第 95 分钟/.test(await text(p.getByTestId("station-task"))), "neutral task context: EVA 采样作业 · 第 95 分钟");
  // ② 分析中
  check((await flow(p)) === expectFlow("analysing"), "② 分析中: current step");
  for (const id of ["station-what", "station-flow", "station-progress"]) check(await onFirstScreen(p, id), `analysing, first screen: ${id} visible`);
  check((await p.locator('[data-testid^="station-decide-"]').count()) === 0, "analysing: no decision possible before the analysis completes");
  await waitStage(p, "review");
  check((await flow(p)) === expectFlow("review"), "③ 待审核 (normal): current step");
  check((await stageStatuses(p)).every((x) => x === "done"), "normal: all four stages done");
  check(/在个体基线范围内/.test(await text(p.getByTestId("station-what"))), "normal: within the individual baseline");
  check((await attr(p, "station-candidate", "data-kind")) === "record-only" && (await p.getByTestId("station-outgoing-none").count()) === 1, "normal: record-only candidate, nothing would be sent");
  check((await p.getByTestId("station-decide-approve").count()) === 0, "nothing to approve for a record-only candidate");
  await decide(p, "close", "结果正常，关闭（测试）");
  check((await attr(p, "station-case", "data-stage")) === "closed" && (await outbox(p)).length === 0, "normal: closed by a human; nothing sent to the HUD");
  check((await allOutbox(p)).map((m) => m.type).join(",") === "station.audit.assessment,station.audit.review", "normal: the assessment and the decision are kept as audit records");
  check((await p.getByTestId("station-candidate").count()) === 0 && /结果正常，关闭（测试）/.test(await text(p.getByTestId("station-closed"))), "closed: shows outcome and reason, no leftover pending prompt");
  check((await flow(p)) === expectFlow("done", "done", ["dispatched", "retest"]), `closed without dispatch: dispatch and retest steps marked skipped (${await flow(p)})`);
  check((await noPendingPrompt(p)) && (await p.locator('[data-testid="station-review-history"] li').count()) === 1, "normal closed: no pending prompt; history has the one close decision");

  // ---------- Acquisition anomaly ----------
  await dev(p, "dev-start");
  await dev(p, "dev-obs-acquisition");
  await waitStage(p, "review");
  check((await stageStatuses(p)).join(",") === "blocked,skipped,skipped,skipped", "acquisition: blocked at the quality check, later stages not run");
  check(/采集质量不合格/.test(await text(p.getByTestId("station-what"))) && (await p.getByTestId("station-baseline-table").count()) === 0, "acquisition: no physiological inference, no comparison");
  check((await attr(p, "station-candidate", "data-kind")) === "retest", "acquisition: re-acquisition candidate");

  // ---------- Not comparable ----------
  await dev(p, "dev-start");
  await dev(p, "dev-obs-not-comparable");
  await waitStage(p, "review");
  check((await stageStatuses(p)).join(",") === "done,blocked,skipped,skipped", "not comparable: blocked at comparability");
  check(/不可比/.test(await text(p.getByTestId("station-comparability"))), "comparability explained");
  check(/不能据此得出肌肉功能下降的结论/.test(await text(p.getByTestId("station-conclusion-text"))), "no muscle-decline conclusion when not comparable");

  // ---------- Comparable change: review ----------
  await dev(p, "dev-start");
  await dev(p, "dev-obs-change");
  await dev(p, "dev-duplicate"); // same observation again (same eventId)
  await waitStage(p, "review");
  check((await attr(p, "station-case", "data-version")) === "1", "duplicate observation did not create a second evaluation");
  check((await attr(p, "station-case", "data-alert")) === "alert" && /超出个体基线波动/.test(await text(p.getByTestId("station-what"))), "change: alert and headline");
  check((await p.locator('[data-testid="station-baseline-table"] tr[data-flagged="true"]').count()) >= 2, "change: ≥ 2 features flagged against the baseline");
  check(/基地提示（模拟）/.test(await text(p.getByTestId("station-outgoing-notice"))) && /标准协议/.test(await text(p.getByTestId("station-outgoing-retest"))), "review shows the actual notice and retest text that would be sent");
  check((await flow(p)) === expectFlow("review") && (await text(p.getByTestId("station-stage-title"))) === "待审核", "③ 待审核: current step");
  for (const id of ["station-flow", "station-what", "station-basis", "station-outgoing", "station-decide-approve", "station-review-reason", "station-review-confirm"]) check(await onFirstScreen(p, id), `review stage, 1440×900 first screen: ${id} visible without scrolling`);
  check((await outbox(p)).length === 0 && (await allOutbox(p)).every((m) => m.type === "station.audit.assessment"), "nothing for the HUD before human approval (only the assessment audit record)");
  await dev(p, "station-dev-toggle");
  await shot(p, "1-review");
  await dev(p, "station-dev-toggle");
  await p.getByTestId("station-decide-approve").click();
  await p.getByTestId("station-review-confirm").click();
  check(/理由/.test(await text(p.getByTestId("station-review-error"))), "approval without a reason is refused");
  await p.getByTestId("station-review-reason").fill("多项特征同向偏离，按标准协议复测（测试）");
  await p.getByTestId("station-review-confirm").click();
  await waitStage(p, "dispatched");
  await p.waitForTimeout(200);

  // ---------- Dispatched: adapter / HUD receipt / astronaut confirmation kept apart ----------
  let ob = await outbox(p);
  check(ob.length === 2 && ob[0].type === "station.notice.approved" && ob[1].type === "station.retest.requested" && ob.every((m) => m.delivery === "sent"), "approval published notice + retest task to the adapter");
  const step = (msg, s) => p.locator(`[data-testid="station-dispatch-${msg}"] [data-testid="step-${s}"]`).getAttribute("data-ok");
  check((await step("notice", "adapter")) === "yes" && (await step("notice", "hud")) === "pending" && (await step("notice", "crew")) === "pending", "after hand-off: adapter ✓, HUD receipt and crew confirmation still pending (not filled in)");
  check((await p.getByTestId("station-decide-approve").count()) === 0, "no second approval possible");
  check((await flow(p)) === expectFlow("dispatched"), "④ 已派发等待反馈: current step");
  await dev(p, "dev-hud-received");
  await p.waitForTimeout(200);
  check((await step("notice", "hud")) === "yes" && (await step("retest", "hud")) === "yes" && (await step("notice", "crew")) === "pending", "HUD receipt recorded separately from astronaut confirmation");
  for (const id of ["station-what", "station-dispatch-notice", "station-dispatch-retest"]) check(await onFirstScreen(p, id), `dispatched stage, first screen: ${id} visible`);
  await dev(p, "station-dev-toggle");
  await shot(p, "2-dispatched");
  await dev(p, "station-dev-toggle");
  await dev(p, "dev-hud-defer");
  await p.waitForTimeout(200);
  check((await attr(p, "station-case", "data-phase")) === "deferred" && (await step("retest", "crew")) === "no", "astronaut deferral shown; back to base staff");
  await dev(p, "dev-hud-ack");
  await p.waitForTimeout(200);
  check((await step("notice", "crew")) === "yes" && (await step("retest", "crew")) === "yes" && (await attr(p, "station-case", "data-phase")) === "awaiting-retest", "astronaut confirmation recorded; waiting for the retest");
  await dev(p, "dev-retest-completed"); // optional proposed extension: astronaut reports the retest done
  await p.waitForTimeout(200);
  check((await attr(p, "station-retest-list", "data-status")) === "completed" && (await attr(p, "station-case", "data-version")) === "1" && (await attr(p, "station-case", "data-stage")) === "dispatched", "retest.completed (optional): shown as reported done, still waiting for the data, no re-evaluation");
  check((await attr(p, "station-case", "data-alert")) === "alert", "retest.completed alone does not clear the alert");

  // ---------- Retest → reassessment ----------
  await dev(p, "dev-retest-normal");
  await p.waitForTimeout(150);
  check((await attr(p, "station-action", "data-stage")) === "reassessing" && /已发出接收回执/.test(await text(p.getByTestId("station-progress"))), "result received: receipt sent, re-evaluation progress shown");
  check((await flow(p)) === expectFlow("retest"), "⑤ 复测与重评 (re-evaluating): current step");
  await waitStage(p, "reassessed");
  check((await flow(p)) === expectFlow("retest") && (await text(p.getByTestId("station-stage-title"))) === STAGE_REASSESSED, "⑤ 复测与重评 (re-evaluation done, waiting for a human): current step");
  check((await attr(p, "station-case", "data-version")) === "2" && /复测 case-change-rt1/.test(await text(p.getByTestId("station-versions"))), "re-evaluation v2 linked to retest case-change-rt1");
  check((await attr(p, "station-baseline", "data-view")) === "paired", "both measurements comparable: v1 and v2 side by side");
  check(/单次正常结果不能证明已经恢复/.test(await text(p.getByTestId("station-reassessed-note"))) && (await attr(p, "station-case", "data-alert")) === "alert", "single normal retest is not recovery; alert not cleared automatically");
  for (const id of ["station-what", "station-reassessed-note", "station-decide-close", "station-decide-keep-open", "station-review-confirm"]) check(await onFirstScreen(p, id), `reassessed stage, first screen: ${id} visible`);
  await dev(p, "station-dev-toggle");
  await shot(p, "3-reassessed");
  await dev(p, "station-dev-toggle");
  const receiptsBefore = (await outbox(p)).filter((m) => m.type === "station.receipt").length;
  await dev(p, "dev-duplicate"); // the same retest result again
  await p.waitForTimeout(300);
  check((await attr(p, "station-case", "data-version")) === "2" && (await outbox(p)).filter((m) => m.type === "station.receipt").length === receiptsBefore + 1, "duplicate retest result: no new evaluation, a (duplicate) receipt");
  await decide(p, "close", "复测回到基线，结合值班评估关闭（测试）");
  ob = await outbox(p);
  check(ob.some((m) => m.type === "station.reassessment") && (await attr(p, "station-case", "data-stage")) === "closed" && (await attr(p, "station-case", "data-alert")) === "none", "human close sends the reassessment and clears the alert");
  // ⑥ 人工处理完成
  check((await flow(p)) === expectFlow("done", "done"), `⑥ 人工处理完成: every step done (${await flow(p)})`);
  check(await noPendingPrompt(p), "closed: no leftover pending-review prompt or decision buttons");
  check((await p.locator('[data-testid="station-review-history"] li').count()) === 2 && /不会再向 HUD 发送消息/.test(await text(p.getByTestId("station-closed"))), "closed: history lists approve + close; says nothing more goes to the HUD");
  check((await attr(p, "station-case-tab-case-change", "data-stage")) === "closed", "left event list shows the event as closed");
  const sentAfterClose = (await outbox(p)).length;
  await dev(p, "dev-hud-defer"); // a late HUD deferral after the human closed the event
  await p.waitForTimeout(200);
  check((await outbox(p)).length === sentAfterClose && (await attr(p, "station-case", "data-stage")) === "closed", "a late HUD deferral after closing sends nothing and does not reopen the event");

  // ---------- Non-comparable retest: no side-by-side values ----------
  await dev(p, "dev-start");
  await dev(p, "dev-obs-change");
  await waitStage(p, "review");
  await decide(p, "approve", "复测（测试）");
  await waitStage(p, "dispatched");
  await dev(p, "dev-retest-invalid");
  await waitStage(p, "reassessed");
  check((await attr(p, "station-baseline", "data-view")) === "separate" && /不计算变化幅度/.test(await text(p.getByTestId("station-separate"))), "invalid retest: v1 and v2 described separately, no change size");
  check((await attr(p, "station-case", "data-alert")) === "alert", "invalid retest does not clear the alert");

  // ---------- Reset during analysis; late events from the old run ----------
  await dev(p, "dev-start");
  await dev(p, "dev-obs-change");
  await p.waitForTimeout(400);
  await dev(p, "dev-reset");
  await p.waitForTimeout(200);
  check((await p.getByTestId("station-empty").count()) === 1, "reset clears the run (analysis cancelled)");
  await dev(p, "dev-start");
  await dev(p, "dev-late");
  await p.waitForTimeout(5000); // longer than a full analysis
  check((await p.getByTestId("station-case").count()) === 0 && /已重置的上一轮/.test(await text(p.getByTestId("station-timeline"))), "late observation from the old run ignored; old timers did nothing");

  // ---------- Delivery failure ----------
  await dev(p, "dev-obs-acquisition");
  await waitStage(p, "review");
  await dev(p, "dev-fail-next");
  await decide(p, "approve", "重新采集（测试）");
  await p.waitForTimeout(300);
  check((await p.locator('[data-testid="station-dispatch-retest"] [data-testid="step-adapter"]').getAttribute("data-ok")) === "no", "delivery failure shown at the adapter step");
  await p.locator('[data-testid^="station-resend-"]').first().click();
  await p.waitForTimeout(300);
  check((await p.locator('[data-testid="station-dispatch-retest"] [data-testid="step-adapter"]').getAttribute("data-ok")) === "yes", "resent with the same eventId");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  // ---------- Phone ----------
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOT_DIR ? 2 : 1 });
  await mp.goto(ORIGIN + "/?dev=1", { waitUntil: "domcontentloaded" });
  await dev(mp, "dev-start");
  await dev(mp, "dev-obs-change");
  await dev(mp, "station-dev-toggle");
  await waitStage(mp, "review");
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, `phone: no horizontal scroll (${overflow}px)`);
  const order = await mp.evaluate(() => ["station-left", "station-headline", "station-action", "station-analysis"].map((id) => Math.round(document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().top)));
  check(order[1] < order[2] && order[2] < order[3], `phone: summary, then the action, then the analysis (${order.join(" < ")})`);
} finally {
  await browser.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) process.exit(1);
