#!/usr/bin/env node
/**
 * Browser smoke test for the PREVIOUS MyoMars station workbench (/legacy/workbench), in standalone
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
/** The previous three-column workbench (the default entry / is now the crew overview: scripts/smoke-crew.mjs). */
const PAGE = "/legacy/workbench";
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
const STAGE_REASSESSED = "Re-evaluation done · awaiting base decision";
const FLOW = ["waiting", "analysing", "review", "dispatched", "retest", "done"];
/** Expected flow string: steps before `current` done (except `skipped`), `current` as given, the rest todo. */
const expectFlow = (current, currentState = "current", skipped = []) => {
  const ci = FLOW.indexOf(current);
  return FLOW.map((s, i) => `${s}=${i === ci ? currentState : i > ci ? "todo" : skipped.includes(s) ? "skipped" : "done"}`).join(",");
};
/** No leftover pending-review prompt: no candidate card, no decision buttons, no confirm button. */
const noPendingPrompt = async (p) => (await p.getByTestId("station-candidate").count()) === 0 && (await p.locator('[data-testid^="station-decide-"]').count()) === 0 && (await p.getByTestId("station-review-confirm").count()) === 0;
/** Main view (summary + right column) free of technical identifiers; those live in the technical details. */
const TECH = /station\.|case-|[Aa]dapter|eventId|run-|obs-/;
const noTechText = async (p) => !TECH.test(await text(p.getByTestId("station-headline"))) && !TECH.test(await text(p.getByTestId("station-action")));
/** Status notifications (case status for the HUD, not actions). */
const statusMsgs = async (p) => (await allOutbox(p)).filter((m) => m.kind === "status");
const stageStatuses = (p) => p.locator('[data-testid="station-stages"] li').evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
/** Messages for the HUD (station.audit.* traceability records excluded). */
const outbox = async (p) => (await allOutbox(p)).filter((m) => !m.type.startsWith("station.audit."));
const allOutbox = (p) => p.locator('[data-testid="station-outbox"] li').evaluateAll((els) => els.map((e) => ({ type: e.getAttribute("data-type"), kind: e.getAttribute("data-kind"), delivery: e.getAttribute("data-delivery"), hud: e.getAttribute("data-hud-received"), feedback: e.getAttribute("data-feedback") })));
/** Fully inside the 1440×900 viewport without scrolling anything. */
const onFirstScreen = async (p, id) => {
  const b = await p.getByTestId(id).first().boundingBox();
  return !!b && b.y >= 0 && b.y + b.height <= VIEW.height && b.x >= 0 && b.x + b.width <= VIEW.width;
};
async function decide(p, decision, reason = "Evidence and limitations checked (test)") {
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
  await p.goto(ORIGIN + PAGE, { waitUntil: "domcontentloaded" });
  await p.getByTestId("station").waitFor();
  check((await p.title()) === "MyoMars · Mars Base (legacy three-column workbench)", "/legacy/workbench is the previous station workbench");
  check((await text(p.getByTestId("station-sim-pill"))) === "Simulated Data / Simulated Analysis", "header always shows Simulated Data / Simulated Analysis");
  check(/Standalone demo/.test(await text(p.getByTestId("station-link"))) && (await attr(p, "station", "data-link-mode")) === "standalone-mock", "link status says standalone demo (mock adapter)");
  check((await p.getByTestId("mars-map").count()) === 0 && (await p.getByTestId("mg-mode-route").count()) === 0, "no map and no EVA route tab on the station");
  check((await p.getByTestId("station-dev").count()) === 0, "development entry hidden without ?dev=1");
  check(/Awaiting scenario start/.test(await text(p.getByTestId("station-empty"))), "empty state before any scenario event");
  check((await flow(p)) === expectFlow("waiting") && (await text(p.getByTestId("station-stage-title"))) === "Awaiting scenario start", "flow: before the scenario, step 1 current and nothing to do");

  // ---------- Normal fixture ----------
  await p.goto(ORIGIN + PAGE + "?dev=1", { waitUntil: "domcontentloaded" });
  await p.getByTestId("station-dev").waitFor();
  await dev(p, "dev-start");
  check(/EV1/.test(await text(p.getByTestId("station-crew"))), "astronaut shown after scenario.start");
  // ① Awaiting observation
  check((await flow(p)) === expectFlow("waiting") && (await text(p.getByTestId("station-stage-title"))) === "Awaiting observation" && /No action needed/.test(await text(p.getByTestId("station-action"))), "① Awaiting observation: current step, no action needed");
  check(/local simulation/.test(await text(p.getByTestId("station-empty"))), "waiting: centre says what is happening and where input comes from (local simulation)");
  check(/a standardised simulated measurement shows a change → base review → standardised retest → re-evaluation → base handling/.test(await text(p.getByTestId("station-demo-flow"))) && /not continuous sEMG monitoring during free activity/.test(await text(p.getByTestId("station-demo-flow"))), "demo positioned as standardised measurement → review → standard retest → re-evaluation → human handling (not continuous monitoring)");
  for (const id of ["station-empty", "station-flow", "station-stage-title"]) check(await onFirstScreen(p, id), `waiting, 1440×900 first screen: ${id} visible`);
  await dev(p, "dev-obs-normal");
  await p.waitForTimeout(250);
  const early = await stageStatuses(p);
  check(early[0] === "running" && early.slice(1).every((x) => x === "waiting"), `analysis stages paced: ${early.join(",")}`);
  check(/simulated analysis running/.test(await text(p.getByTestId("station-what"))) && (await attr(p, "station-action", "data-stage")) === "analysing", "right panel shows analysis in progress, nothing to do");
  check(/EVA sampling · minute 95/.test(await text(p.getByTestId("station-task"))), "neutral task context: EVA sampling · minute 95");
  // ② Analysing
  check((await flow(p)) === expectFlow("analysing"), "② Analysing: current step");
  for (const id of ["station-what", "station-flow", "station-progress"]) check(await onFirstScreen(p, id), `analysing, first screen: ${id} visible`);
  check((await p.locator('[data-testid^="station-decide-"]').count()) === 0, "analysing: no decision possible before the analysis completes");
  await waitStage(p, "review");
  check((await flow(p)) === expectFlow("review"), "③ Awaiting Base Review (normal): current step");
  check((await stageStatuses(p)).every((x) => x === "done"), "normal: all four stages done");
  check((await text(p.getByTestId("station-what"))) === "Measurement Within Reference Range · Awaiting Base Review", "normal: summary says the measurement is Within Reference Range, Awaiting Base Review");
  check((await p.getByTestId("station-stage-detail").count()) === 0, "analysis step details are collapsed by default (open on demand)");
  await p.getByTestId("station-stage-features").click();
  check(/For the values, see the .* table below/.test(await text(p.getByTestId("station-stage-detail"))) && !/Hz/.test(await text(p.getByTestId("station-stage-detail"))), "feature step detail points to the comparison table instead of repeating the numbers");
  await p.getByTestId("station-stage-features").click();
  check(/Standardised simulated measurement/.test(await text(p.getByTestId("station-observation-meta"))), "comparison describes the input as a standardised simulated measurement");
  check(/grip meter/.test(await text(p.locator('[data-testid="station-baseline-table"] tr', { hasText: "Grip force" }))) && /not derived from sEMG/.test(await text(p.getByTestId("station-grip-note"))), "grip force labelled as an independent grip-meter measurement, not derived from sEMG");
  check((await p.locator('[data-testid^="station-decide-hold"]').count()) === 0, "no separate hold-for-review decision offered");
  check((await attr(p, "station-candidate", "data-kind")) === "record-only" && (await p.getByTestId("station-outgoing-none").count()) === 1, "normal: record-only candidate, nothing would be sent");
  check((await p.getByTestId("station-decide-approve").count()) === 0, "nothing to approve for a record-only candidate");
  await p.getByTestId("station-decide-close").click();
  const normalPreview = await text(p.locator('[data-testid="station-outgoing-status"] p').nth(1));
  check(/Case Closed by base staff/.test(normalPreview) && (await outbox(p)).length === 0, "close: the status notification text is shown before confirming; nothing published yet");
  await p.getByTestId("station-review-reason").fill("Result Within Reference Range, closing (test)");
  await p.getByTestId("station-review-confirm").click();
  await p.waitForTimeout(200);
  check((await attr(p, "station-case", "data-stage")) === "closed" && (await outbox(p)).length === 1 && (await statusMsgs(p)).length === 1, "normal: closed by a human; exactly one STATUS notification for the HUD, no action");
  check((await allOutbox(p)).map((m) => m.type).join(",") === "station.audit.assessment,station.reassessment,station.audit.review", "normal: status notification plus the audit records of the assessment and the decision");
  check((await text(p.locator('[data-testid="station-status-message"] p').nth(1))) === normalPreview && (await attr(p, "station-status-message", "data-case-status")) === "closed", "the published status notification is exactly the previewed text (caseStatus closed)");
  check((await p.getByTestId("station-candidate").count()) === 0 && /Result Within Reference Range, closing \(test\)/.test(await text(p.getByTestId("station-closed"))), "closed: shows outcome and reason, no leftover pending prompt");
  check((await flow(p)) === expectFlow("done", "done", ["dispatched", "retest"]), `closed without dispatch: dispatch and retest steps marked skipped (${await flow(p)})`);
  check((await noPendingPrompt(p)) && (await p.locator('[data-testid="station-review-history"] li').count()) === 1, "normal closed: no pending prompt; history has the one close decision");

  // ---------- Acquisition anomaly ----------
  await dev(p, "dev-start");
  await dev(p, "dev-obs-acquisition");
  await waitStage(p, "review");
  check((await stageStatuses(p)).join(",") === "blocked,skipped,skipped,skipped", "acquisition: blocked at the quality check, later stages not run");
  check(/Signal quality failed: Unable to Assess/.test(await text(p.getByTestId("station-what"))) && (await p.getByTestId("station-baseline-table").count()) === 0, "acquisition: no physiological inference, no comparison");
  check((await attr(p, "station-candidate", "data-kind")) === "retest", "acquisition: re-acquisition candidate");

  // ---------- Not comparable ----------
  await dev(p, "dev-start");
  await dev(p, "dev-obs-not-comparable");
  await waitStage(p, "review");
  check((await stageStatuses(p)).join(",") === "done,blocked,skipped,skipped", "not comparable: blocked at comparability");
  check(/Not comparable with the individual baseline/.test(await text(p.getByTestId("station-comparability"))), "comparability explained");
  check(/no conclusion about muscle function can be drawn/.test(await text(p.getByTestId("station-conclusion-text"))), "no muscle-decline conclusion when not comparable");

  // ---------- Comparable change: review ----------
  await dev(p, "dev-start");
  await dev(p, "dev-obs-change");
  await dev(p, "dev-duplicate"); // same observation again (same eventId)
  await waitStage(p, "review");
  check((await attr(p, "station-case", "data-version")) === "1", "duplicate observation did not create a second evaluation");
  check((await attr(p, "station-case", "data-alert")) === "alert" && /beyond the individual baseline variation/.test(await text(p.getByTestId("station-what"))), "change: alert and headline");
  check((await p.locator('[data-testid="station-baseline-table"] tr[data-flagged="true"]').count()) >= 2, "change: ≥ 2 features flagged against the baseline");
  check(/Base notice \(simulated\)/.test(await text(p.getByTestId("station-outgoing-notice"))) && /standard protocol/.test(await text(p.getByTestId("station-outgoing-retest"))), "review shows the actual notice and retest text that would be sent");
  check((await flow(p)) === expectFlow("review") && (await text(p.getByTestId("station-stage-title"))) === "Awaiting Base Review", "③ Awaiting Base Review: current step");
  check(/Alert open · Awaiting Base Review/.test(await text(p.getByTestId("station-case-status"))) && /Latest evaluation v1: Beyond the individual baseline variation/.test(await text(p.getByTestId("station-eval-status"))), "review: case status and latest evaluation shown as two separate indicators");
  check(await noTechText(p), "review: no event types, IDs or adapter wording in the summary or the action column");
  for (const id of ["station-case-status", "station-eval-status", "station-flow", "station-what", "station-basis", "station-outgoing", "station-decide-approve", "station-review-reason", "station-review-confirm"]) check(await onFirstScreen(p, id), `review stage, 1440×900 first screen: ${id} visible without scrolling`);
  check((await outbox(p)).length === 0 && (await allOutbox(p)).every((m) => m.type === "station.audit.assessment"), "nothing for the HUD before human approval (only the assessment audit record)");
  await dev(p, "station-dev-toggle");
  await shot(p, "1-review");
  await dev(p, "station-dev-toggle");
  await p.getByTestId("station-decide-approve").click();
  await p.getByTestId("station-review-confirm").click();
  check(/reason/.test(await text(p.getByTestId("station-review-error"))), "approval without a reason is refused");
  await p.getByTestId("station-review-reason").fill("Several indicators shifted in the same direction; retest with the standard protocol (test)");
  await p.getByTestId("station-review-confirm").click();
  await waitStage(p, "dispatched");
  await p.waitForTimeout(200);

  // ---------- Dispatched: adapter / HUD receipt / astronaut confirmation kept apart ----------
  let ob = await outbox(p);
  check(ob.length === 2 && ob[0].type === "station.notice.approved" && ob[1].type === "station.retest.requested" && ob.every((m) => m.delivery === "sent"), "approval published notice + retest task to the adapter");
  const step = (msg, s) => p.locator(`[data-testid="station-dispatch-${msg}"] [data-testid="step-${s}"]`).getAttribute("data-ok");
  check((await step("notice", "adapter")) === "yes" && (await step("notice", "hud")) === "pending" && (await step("notice", "crew")) === "pending", "after hand-off: sent, HUD receipt and crew confirmation still pending (not filled in)");
  const adapterStep = p.locator('[data-testid="station-dispatch-notice"] [data-testid="step-adapter"]');
  check((await adapterStep.getAttribute("data-mock")) === "true" && /Local simulation only/.test(await text(adapterStep)) && !/✓/.test(await text(adapterStep)), "mock hand-off is shown as Local simulation only without a success tick (not a delivery)");
  check(await noTechText(p), "dispatched: no event types, IDs or adapter wording in the main view");
  check((await p.getByTestId("station-decide-approve").count()) === 0, "no second approval possible");
  check((await flow(p)) === expectFlow("dispatched"), "④ Dispatched, awaiting feedback: current step");
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
  check((await attr(p, "station-action", "data-stage")) === "reassessing" && /Retest result received, receipt sent;/.test(await text(p.getByTestId("station-progress"))), "result received: receipt sent, re-evaluation progress shown");
  check((await flow(p)) === expectFlow("retest"), "⑤ Retest and re-evaluation (re-evaluating): current step");
  await waitStage(p, "reassessed");
  check((await flow(p)) === expectFlow("retest") && (await text(p.getByTestId("station-stage-title"))) === STAGE_REASSESSED, "⑤ Retest and re-evaluation (re-evaluation done, waiting for a human): current step");
  check((await text(p.getByTestId("station-what"))) === "Retest Within Reference Range · awaiting base decision", "reassessed: summary reads Retest Within Reference Range · awaiting base decision");
  const caseChip = await text(p.getByTestId("station-case-status"));
  const evalChip = await text(p.getByTestId("station-eval-status"));
  check(/Alert open · awaiting base decision/.test(caseChip) && !/Reference Range/i.test(caseChip) && /Within Reference Range/.test(evalChip) && !/alert/i.test(evalChip) && (await attr(p, "station-eval-status", "data-tone")) === "ok", `case status and latest result kept apart: [${caseChip}] [${evalChip}]`);
  check(/The original alert is still open/.test(await text(p.getByTestId("station-alert-note"))), "reassessed: the original alert is explicitly still open");
  check(await noTechText(p), "reassessed: no event types, IDs or adapter wording in the main view");
  check((await attr(p, "station-case", "data-version")) === "2" && /v2 · Retest/.test(await text(p.getByTestId("station-versions"))) && /v2←.* \(case-change-rt1\)/.test(await text(p.getByTestId("station-tech-ids"))), "re-evaluation v2 linked to retest case-change-rt1 (ID in the technical details)");
  check((await attr(p, "station-baseline", "data-view")) === "paired", "both measurements comparable: v1 and v2 side by side");
  check(/one retest in range does not show recovery/.test(await text(p.getByTestId("station-alert-note"))) && /Close case \(clears the alert\) or Continue Monitoring \(keeps the alert\)/.test(await text(p.getByTestId("station-reassessed-note"))) && (await attr(p, "station-case", "data-alert")) === "alert", "a single retest in range is not recovery; alert not cleared automatically; the two choices explained");
  for (const id of ["station-case-status", "station-eval-status", "station-alert-note", "station-what", "station-reassessed-note", "station-decide-close", "station-decide-keep-open", "station-review-confirm"]) check(await onFirstScreen(p, id), `reassessed stage, first screen: ${id} visible`);
  await dev(p, "station-dev-toggle");
  await shot(p, "3-reassessed");
  await dev(p, "station-dev-toggle");
  const receiptsBefore = (await outbox(p)).filter((m) => m.type === "station.receipt").length;
  await dev(p, "dev-duplicate"); // the same retest result again
  await p.waitForTimeout(300);
  check((await attr(p, "station-case", "data-version")) === "2" && (await outbox(p)).filter((m) => m.type === "station.receipt").length === receiptsBefore + 1, "duplicate retest result: no new evaluation, a (duplicate) receipt");
  await p.getByTestId("station-decide-close").click();
  const closePreview = await text(p.locator('[data-testid="station-outgoing-status"] p').nth(1));
  check(/Case Closed by base staff/.test(closePreview) && /Latest evaluation v2: Retest Within Reference Range/.test(closePreview), "reassessed close: status notification previewed before confirming");
  await p.getByTestId("station-review-reason").fill("Retest Within Reference Range; closed with the duty assessment (test)");
  await p.getByTestId("station-review-confirm").click();
  await p.waitForTimeout(200);
  ob = await outbox(p);
  check(ob.some((m) => m.type === "station.reassessment") && (await attr(p, "station-case", "data-stage")) === "closed" && (await attr(p, "station-case", "data-alert")) === "none", "human close sends the reassessment and clears the alert");
  // ⑥ Base handling complete
  check((await flow(p)) === expectFlow("done", "done"), `⑥ Base handling complete: every step done (${await flow(p)})`);
  check(await noPendingPrompt(p), "closed: no leftover pending-review prompt or decision buttons");
  check((await p.locator('[data-testid="station-review-history"] li').count()) === 2 && /no new action messages will be sent/.test(await text(p.getByTestId("station-closed"))), "closed: history lists approve + close; no further action messages");
  check((await statusMsgs(p)).length === 1 && (await attr(p, "station-status-message", "data-case-status")) === "closed" && (await text(p.locator('[data-testid="station-status-message"] p').nth(1))) === closePreview, "closed: one status notification (caseStatus closed) published through the mock adapter, as previewed");
  check((await p.locator('[data-testid="station-status-message"] [data-testid="step-crew"]').count()) === 0 && (await p.locator('[data-testid="station-status-message"] [data-testid="step-hud"]').getAttribute("data-ok")) === "pending", "status notification: no astronaut confirmation step; HUD receipt pending until the HUD sends one");
  await dev(p, "dev-hud-received");
  await p.waitForTimeout(200);
  check((await p.locator('[data-testid="station-status-message"] [data-testid="step-hud"]').getAttribute("data-ok")) === "yes", "a HUD receipt for the status notification is recorded");
  await shot(p, "4-closed");
  check(await noTechText(p), "closed: no event types, IDs or adapter wording in the main view");
  check((await attr(p, "station-case-tab-case-change", "data-stage")) === "closed", "left event list shows the event as closed");
  const sentAfterClose = (await outbox(p)).length;
  await dev(p, "dev-hud-defer"); // a late HUD deferral after the human closed the event
  await p.waitForTimeout(200);
  check((await outbox(p)).length === sentAfterClose && (await statusMsgs(p)).length === 1 && (await attr(p, "station-case", "data-stage")) === "closed", "a late HUD deferral after closing sends nothing (no repeated status) and does not reopen the event");

  // ---------- Non-comparable retest: no side-by-side values ----------
  await dev(p, "dev-start");
  await dev(p, "dev-obs-change");
  await waitStage(p, "review");
  await decide(p, "approve", "Retest (test)");
  await waitStage(p, "dispatched");
  await dev(p, "dev-retest-invalid");
  await waitStage(p, "reassessed");
  check((await attr(p, "station-baseline", "data-view")) === "separate" && /no change is computed/.test(await text(p.getByTestId("station-separate"))), "invalid retest: v1 and v2 described separately, no change size");
  check((await attr(p, "station-case", "data-alert")) === "alert", "invalid retest does not clear the alert");
  // Continue Monitoring: a decision that keeps the case open (alert kept) and publishes a status notification.
  const actionsBefore = (await allOutbox(p)).filter((m) => m.kind === "action").length;
  await p.getByTestId("station-decide-keep-open").click();
  check(/Continue Monitoring; the case stays open/.test(await text(p.getByTestId("station-outgoing-status"))) && /the alert stays/.test(await text(p.getByTestId("station-decision-effect"))), "keep-open: effect and status notification previewed (alert kept, no action)");
  await p.getByTestId("station-review-reason").fill("Retest invalid; Continue Monitoring (test)");
  await p.getByTestId("station-review-confirm").click();
  await p.waitForTimeout(200);
  check((await attr(p, "station-case", "data-stage")) === "decided" && (await text(p.getByTestId("station-stage-title"))) === "Continue Monitoring · case still open" && (await attr(p, "station-case", "data-alert")) === "alert", "keep-open: case stays open with its alert; stage Continue Monitoring");
  check((await attr(p, "station-status-message", "data-case-status")) === "monitoring" && (await statusMsgs(p)).length === 1 && (await allOutbox(p)).filter((m) => m.kind === "action").length === actionsBefore, "keep-open: one status notification (caseStatus monitoring), no new action message");
  check((await p.locator('[data-testid^="station-decide-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))).join(",") === "station-decide-close", "keep-open: only Close case remains (keep-open cannot be repeated)");
  await decide(p, "close", "Closed after Continue Monitoring (test)");
  const kinds = (await statusMsgs(p)).length;
  check(kinds === 2 && (await attr(p, "station-status-message", "data-case-status")) === "closed" && (await attr(p, "station-case", "data-alert")) === "none", "keep-open then close: two distinct status notifications (monitoring, closed), alert cleared only by the close");

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
  check((await p.getByTestId("station-case").count()) === 0 && /from an earlier, ended run/.test(await text(p.getByTestId("station-timeline"))), "late observation from the old run ignored; old timers did nothing");

  // ---------- Delivery failure ----------
  await dev(p, "dev-obs-acquisition");
  await waitStage(p, "review");
  await dev(p, "dev-fail-next");
  await decide(p, "approve", "Re-acquire (test)");
  await p.waitForTimeout(300);
  check((await p.locator('[data-testid="station-dispatch-retest"] [data-testid="step-adapter"]').getAttribute("data-ok")) === "no", "delivery failure shown at the adapter step");
  await p.locator('[data-testid^="station-resend-"]').first().click();
  await p.waitForTimeout(300);
  check((await p.locator('[data-testid="station-dispatch-retest"] [data-testid="step-adapter"]').getAttribute("data-ok")) === "yes", "resent with the same eventId");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  // ---------- Phone ----------
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOT_DIR ? 2 : 1 });
  await mp.goto(ORIGIN + PAGE + "?dev=1", { waitUntil: "domcontentloaded" });
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
