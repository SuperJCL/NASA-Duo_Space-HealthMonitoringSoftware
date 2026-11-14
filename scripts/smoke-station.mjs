#!/usr/bin/env node
/**
 * Browser smoke test for the MyoMars base station (/), standalone mode (local mock adapter).
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-station.mjs
 *   SHOT_DIR=/some/dir ...   also saves screenshots
 *
 * Uses the hidden development entry (/?dev=1) to inject Trigger / HUD events. It verifies the
 * station alone; it does NOT verify any link with the real Trigger or HUD.
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
const shot = async (p, name) => SHOT_DIR && (await p.screenshot({ path: `${SHOT_DIR}/${name}.png` }));
const attr = (p, id, a) => p.getByTestId(id).getAttribute(a);
const waitPhase = (p, phase, timeout = 15_000) => p.waitForFunction((ph) => document.querySelector('[data-testid="station-case"]')?.getAttribute("data-phase") === ph, phase, { timeout });
const stageStatuses = (p) => p.locator('[data-testid="station-stages"] li').evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
const outbox = (p) => p.locator('[data-testid="station-outbox"] li').evaluateAll((els) => els.map((e) => ({ type: e.getAttribute("data-type"), delivery: e.getAttribute("data-delivery"), feedback: e.getAttribute("data-feedback") })));
async function decide(p, decision, reason = "已核对证据与局限（测试）") {
  await p.getByTestId(`station-decide-${decision}`).click();
  await p.getByTestId("station-review-reason").fill(reason);
  await p.getByTestId("station-review-confirm").click();
  await p.waitForTimeout(200);
}
async function freshRun(p) {
  await p.getByTestId("dev-start").click();
  await p.waitForTimeout(100);
}

const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SHOT_DIR ? 2 : 1 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  // ---------- Entry without the dev panel ----------
  await p.goto(ORIGIN + "/", { waitUntil: "domcontentloaded" });
  await p.getByTestId("station").waitFor();
  check((await p.title()) === "MyoMars · 火星基站", "/ is the MyoMars base station");
  check((await text(p.getByTestId("station-sim-pill"))) === "模拟数据 / 模拟分析", "header always shows 模拟数据 / 模拟分析");
  check(/独立演示/.test(await text(p.getByTestId("station-link"))) && (await attr(p, "station", "data-link-mode")) === "standalone-mock", "link status says standalone demo (mock adapter)");
  check(/等待场景开始/.test(await text(p.getByTestId("station-empty"))), "empty state before any scenario event");
  check((await p.getByTestId("station-dev").count()) === 0, "development entry hidden without ?dev=1");
  check((await p.getByTestId("mg-mode-eva").count()) === 0, "no astronaut HUD view on the station");

  // ---------- Normal fixture ----------
  await p.goto(ORIGIN + "/?dev=1", { waitUntil: "domcontentloaded" });
  await p.getByTestId("station-dev").waitFor();
  await freshRun(p);
  check(/EV1/.test(await text(p.getByTestId("station-crew"))), "astronaut and current task shown after scenario.start");
  await p.getByTestId("dev-obs-normal").click();
  await p.waitForTimeout(300);
  const early = await stageStatuses(p);
  check(early[0] === "running" && early.slice(1).every((x) => x === "waiting"), `analysis stages paced: ${early.join(",")}`);
  check(/正在进行模拟分析/.test(await text(p.getByTestId("station-what"))), "headline says analysis is running");
  await waitPhase(p, "awaiting-review");
  check((await stageStatuses(p)).every((x) => x === "done"), "normal: all four stages done");
  check(/在个体基线范围内/.test(await text(p.getByTestId("station-what"))), "normal: within the individual baseline");
  check((await attr(p, "station-candidate", "data-kind")) === "record-only", "normal: record-only candidate");
  check(/基地人员/.test(await text(p.getByTestId("station-next"))), "next owner is base staff");
  check((await p.getByTestId("station-decide-approve").count()) === 0, "nothing to approve for a record-only candidate");
  await decide(p, "close", "结果正常，关闭（测试）");
  check((await attr(p, "station-case", "data-phase")) === "closed", "normal: closed by a human with a reason");
  check((await p.getByTestId("station-outbox").count()) === 0, "normal: nothing sent to the HUD");

  // ---------- Acquisition anomaly ----------
  await freshRun(p);
  await p.getByTestId("dev-obs-acquisition").click();
  await waitPhase(p, "awaiting-review");
  check((await stageStatuses(p)).join(",") === "blocked,skipped,skipped,skipped", "acquisition: blocked at the quality check, later stages not run");
  check(/采集质量不合格/.test(await text(p.getByTestId("station-what"))), "acquisition: no physiological inference");
  check((await p.getByTestId("station-baseline-table").count()) === 0, "acquisition: no baseline comparison table");
  check((await attr(p, "station-candidate", "data-kind")) === "retest", "acquisition: re-acquisition candidate");
  await shot(p, "station-acquisition");

  // ---------- Not comparable ----------
  await freshRun(p);
  await p.getByTestId("dev-obs-not-comparable").click();
  await waitPhase(p, "awaiting-review");
  check((await stageStatuses(p)).join(",") === "done,blocked,skipped,skipped", "not comparable: blocked at comparability");
  check(/不可比/.test(await text(p.getByTestId("station-comparability"))), "comparability explained");
  check(/不能据此得出肌肉功能下降的结论/.test(await text(p.getByTestId("station-conclusion-text"))), "no muscle-decline conclusion when not comparable");

  // ---------- Comparable change + retest loop ----------
  await freshRun(p);
  await p.getByTestId("dev-obs-change").click();
  await p.getByTestId("dev-duplicate").click(); // the same observation again (same eventId)
  await waitPhase(p, "awaiting-review");
  check((await attr(p, "station-case", "data-version")) === "1", "duplicate observation did not create a second evaluation");
  check((await attr(p, "station-case", "data-alert")) === "alert", "change: alert raised");
  check(/超出个体基线波动/.test(await text(p.getByTestId("station-what"))), "change: headline");
  check((await p.locator('[data-testid="station-baseline-table"] tr[data-flagged="true"]').count()) >= 2, "change: ≥ 2 features flagged against the baseline");
  check((await attr(p, "station-candidate", "data-kind")) === "notice-and-retest", "change: notice + retest candidate, pending review");
  check((await p.getByTestId("station-outbox").count()) === 0 && /mock 适配层已发出 0 条/.test(await text(p.getByTestId("station-dev"))), "nothing published before human approval");
  await shot(p, "station-review");
  await p.getByTestId("station-decide-approve").click();
  await p.getByTestId("station-review-confirm").click();
  check(/理由/.test(await text(p.getByTestId("station-review-error"))), "approval without a reason is refused");
  await p.getByTestId("station-review-reason").fill("多项特征同向偏离，安排标准复测（测试）");
  await p.getByTestId("station-review-confirm").click();
  await p.waitForTimeout(300);
  let ob = await outbox(p);
  check(ob.length === 2 && ob[0].type === "station.notice.approved" && ob[1].type === "station.retest.requested" && ob.every((m) => m.delivery === "sent"), "approval published notice + retest task through the adapter");
  check((await attr(p, "station-case", "data-phase")) === "awaiting-hud" && /等待 HUD 确认/.test(await text(p.getByTestId("station-next"))), "next owner: astronaut (waiting for HUD)");
  check((await p.getByTestId("station-decide-approve").count()) === 0, "no second approval possible");
  await p.getByTestId("dev-hud-defer").click();
  await p.waitForTimeout(200);
  check((await attr(p, "station-case", "data-phase")) === "deferred", "HUD defer shown; back to base staff");
  await p.getByTestId("dev-hud-ack").click();
  await p.waitForTimeout(200);
  ob = await outbox(p);
  check(ob[1].feedback === "acknowledged", "HUD acknowledgement recorded on the retest message");
  await p.getByTestId("dev-retest-normal").click();
  await p.waitForTimeout(200);
  ob = await outbox(p);
  check(ob.some((m) => m.type === "station.receipt"), "receipt sent for the retest result");
  check(/已收到结果 → v2/.test(await text(p.getByTestId("station-retest-list"))), "retest linked to evaluation v2");
  await waitPhase(p, "awaiting-review");
  check((await attr(p, "station-case", "data-version")) === "2", "re-evaluation v2 completed");
  check(/单次正常结果不能证明已经恢复/.test(await text(p.getByTestId("station-conclusion-text"))), "a single normal retest is not treated as recovery");
  check((await attr(p, "station-case", "data-alert")) === "alert", "alert not cleared automatically");
  const receiptsBefore = (await outbox(p)).filter((m) => m.type === "station.receipt").length;
  await p.getByTestId("dev-duplicate").click(); // same retest result again
  await p.waitForTimeout(300);
  check((await attr(p, "station-case", "data-version")) === "2", "duplicate retest result: no new evaluation");
  check((await outbox(p)).filter((m) => m.type === "station.receipt").length === receiptsBefore + 1, "duplicate retest result answered with a (duplicate) receipt");
  await decide(p, "close", "复测回到基线，结合值班评估关闭（测试）");
  ob = await outbox(p);
  check(ob.some((m) => m.type === "station.reassessment") && (await attr(p, "station-case", "data-phase")) === "closed" && (await attr(p, "station-case", "data-alert")) === "none", "human close sends the reassessment and clears the alert");
  await shot(p, "station-closed");

  // ---------- Reset during analysis; late events from the old run ----------
  await freshRun(p);
  await p.getByTestId("dev-obs-change").click();
  await p.waitForTimeout(400);
  await p.getByTestId("dev-reset").click();
  await p.waitForTimeout(200);
  check((await p.getByTestId("station-empty").count()) === 1, "reset clears the run (analysis cancelled)");
  await freshRun(p);
  await p.getByTestId("dev-late").click();
  await p.waitForTimeout(5000); // longer than a full analysis
  check((await p.getByTestId("station-case").count()) === 0 && /已重置的上一轮/.test(await text(p.getByTestId("station-timeline"))), "late observation from the old run ignored; old timers did nothing");

  // ---------- Delivery failure ----------
  await p.getByTestId("dev-obs-acquisition").click();
  await waitPhase(p, "awaiting-review");
  await p.getByTestId("dev-fail-next").click();
  await decide(p, "approve", "重新采集（测试）");
  await p.waitForTimeout(300);
  ob = await outbox(p);
  check(ob[0]?.delivery === "failed", "delivery failure is shown");
  await p.locator('[data-testid^="station-resend-"]').first().click();
  await p.waitForTimeout(300);
  check((await outbox(p))[0]?.delivery === "sent", "failed message resent with the same eventId");

  // ---------- EVA route tab (reused) ----------
  await p.getByTestId("mg-mode-route").click();
  await p.getByTestId("route-status").waitFor({ timeout: 30_000 });
  check((await text(p.getByTestId("station-sim-pill"))) === "模拟数据 / 模拟分析", "simulation label stays on the EVA route tab");
  await p.getByTestId("station-tab-station").click();
  check((await p.getByTestId("station-case").count()) === 1, "station state kept across tabs");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  // ---------- Phone ----------
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOT_DIR ? 2 : 1 });
  await mp.goto(ORIGIN + "/?dev=1", { waitUntil: "domcontentloaded" });
  await mp.getByTestId("station-dev-toggle").click(); // collapse the dev panel
  await mp.getByTestId("station-dev-toggle").click();
  await mp.getByTestId("dev-start").click();
  await mp.getByTestId("dev-obs-change").click();
  await mp.getByTestId("station-dev-toggle").click();
  await waitPhase(mp, "awaiting-review");
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, `phone: no horizontal scroll (${overflow}px)`);
  await mp.getByTestId("station-headline").scrollIntoViewIfNeeded();
  await shot(mp, "station-phone");
} finally {
  await browser.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) process.exit(1);
