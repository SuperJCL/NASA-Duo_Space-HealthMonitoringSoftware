#!/usr/bin/env node
/**
 * Browser smoke test for the MDI 2.0 Mission Glass prototype (/mission-glass).
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-mission-glass.mjs
 *
 * Each PASS/FAIL line is one check. The main app's smoke test is separate
 * (scripts/smoke-test.mjs).
 */
import { chromium } from "playwright";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000") + "/mission-glass";
const failures = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures.push(msg);
};
const text = async (l) => ((await l.textContent().catch(() => null)) ?? "").trim();
const settle = (p, ms = 300) => p.waitForTimeout(ms);

// Scenario-defined target positions, recomputed independently from the scenario file.
const R = 3396190;
const MPD = (2 * Math.PI * R) / 360;
const LEFROY = [77.34704595, 18.48867278]; // PDS vol. 4 (verified site, convention inferred)
const targetLonLat = ({ east, north }) => [LEFROY[0] + east / (MPD * Math.cos((LEFROY[1] * Math.PI) / 180)), LEFROY[1] + north / MPD];

async function clickLonLat(page, [lon, lat]) {
  const map = page.getByTestId("mars-map");
  const [w, s, e, n] = ((await map.getAttribute("data-view-extent")) ?? "").split(",").map(Number);
  const box = await map.boundingBox();
  await page.mouse.click(box.x + ((lon - w) / (e - w)) * box.width, box.y + ((n - lat) / (n - s)) * box.height);
  await settle(page, 700); // OpenLayers waits ~250 ms to rule out a double click
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="mars-map"]')?.getAttribute("data-view-extent"), undefined, { timeout: 15_000 });
  await settle(page, 800);

  // ── Planning: Level 1 ──
  check(/Simulated scenario/.test(await text(page.getByTestId("mg-sim-pill"))), "the simulated scenario is labelled in the top bar");
  const cards = page.locator("[data-testid^='mg-card-']");
  const order = await cards.evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid").replace("mg-card-", ""), e.getAttribute("data-rank")]));
  check(JSON.stringify(order) === JSON.stringify([["task-abrasion-proximity", "1"], ["task-core-for-earth", "2"], ["task-standoff-survey", "3"]]), `three scenario actions, ranked by the existing engine (got ${JSON.stringify(order)})`);
  const first = page.getByTestId("mg-card-task-abrasion-proximity");
  check((await text(first.getByTestId("mg-rationale"))) === "Covers 2 of 3 open questions · adds close-up rover evidence" && (await text(first.getByTestId("mg-cost"))) === "40 pts", "MG-1: Level 1 shows a one-line rationale and the cost");
  check((await text(first.getByTestId("mg-status"))) === "Fits: 40 pts, leaving 60 pts.", "MG-1: Level 1 states feasibility in plain language");
  check(/Priorities are provisional: existing MDI engine, not scientifically validated/.test(await text(page.getByTestId("mg-ranking-note"))) && /50 relationships await expert review/.test(await text(page.getByTestId("mg-ranking-note"))), "MG-1: provisional priorities are stated once, at the top");
  const primaries = await page.getByTestId("mg-planning").locator("button.bg-\\[var\\(--mg-coral\\)\\]").count();
  check(primaries === 1, `MG-1: one primary (filled) button in the planning panel (got ${primaries})`);
  check((await page.getByTestId("mg-review-plan").isDisabled()) && /Your plan is empty/.test(await text(page.getByTestId("mg-plan-summary"))) && /1 Compare/.test(await text(page.getByTestId("mg-flow"))), "MG-1: empty plan: review disabled; the flow shows step 1");
  check(/Simulated target \(scenario-defined position\)/.test(await text(page.getByTestId("mg-legend"))) && /Verified NASA\/PDS data/.test(await text(page.getByTestId("mg-legend"))), "legend separates verified data from simulated targets");

  // ── Map ↔ card synchronisation ──
  await clickLonLat(page, targetLonLat({ east: -110, north: 120 })); // target A (survey)
  check((await page.getByTestId("mg-card-task-standoff-survey").getAttribute("data-selected")) === "true", "clicking a simulated target on the map selects its task card");
  await first.getByTestId("mg-select").click();
  await settle(page);
  check((await first.getAttribute("data-selected")) === "true" && (await page.getByTestId("mg-card-task-standoff-survey").getAttribute("data-selected")) === "false", "selecting a card moves the selection (map highlights its target)");
  await clickLonLat(page, LEFROY);
  check(/Lefroy Bay/.test(await text(page.getByTestId("mg-verified-pick"))) && /Verified feature/.test(await text(page.getByTestId("mg-verified-pick"))), "clicking the verified Lefroy Bay site shows it as a verified feature, not a target");

  // ── Level 2 ──
  await first.getByTestId("mg-expand").click();
  await settle(page);
  const detail = first.getByTestId("mg-detail");
  check((await first.getByTestId("mg-expand").getAttribute("aria-expanded")) === "true" && (await detail.getAttribute("aria-hidden")) === "false", "Level 2 details expand");
  const d = await text(detail);
  check(/Target B: scenario-defined position, 118 m straight-line from the verified Lefroy Bay site\. No route or safety assessment\./.test(d), "Level 2: target is scenario-defined; no route or safety claim");
  check(/Stays #1 in 6 of 6 runs/.test(d) && /at least 40 points/.test(d) && /await expert review/.test(d), "Level 2: priority conditions (stability, budget, pending review)");
  check(/PIXL, SHERLOC, WATSON/.test(d), "Level 2: equipment");

  // ── Level 3 ──
  await first.getByTestId("mg-evidence").click();
  await settle(page);
  const sheet = page.getByTestId("mg-evidence-sheet");
  check(await sheet.isVisible(), "Level 3 evidence sheet opens");
  check(/not evaluated/.test(await text(page.getByTestId("mg-engine-notes"))), "Level 3: engine reasons, including criteria not evaluated");
  check(/Question stated in the source:/.test(await text(page.getByTestId("mg-gap-links"))) && /awaiting expert review/.test(await text(page.getByTestId("mg-gap-links"))), "Level 3: source quotations and review status for each open question");
  check(/Silica fills the spaces between the grains/.test(await text(page.getByTestId("mg-verified-context"))) && /p\. 26-1/.test(await text(page.getByTestId("mg-verified-context"))), "Level 3: verified Lefroy Bay context with PDS page");
  check(/reviewed ranking is unavailable/.test(await text(page.getByTestId("mg-review-status"))), "Level 3: review status says the reviewed ranking is unavailable");
  await page.keyboard.press("Escape");
  check(!(await sheet.isVisible()), "Escape closes the evidence sheet");

  // ── MG-1: resources and feasibility ──
  await page.getByLabel("Simulated effort budget").fill("50");
  await settle(page);
  const order50 = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("mg-card-", "")));
  const core = page.getByTestId("mg-card-task-core-for-earth");
  check(order50[0] === "task-standoff-survey" && (await text(core.getByTestId("mg-status"))) === "Not possible: needs 55 pts, but the whole budget is 50 pts.", "MG-1: budget 50: engine re-ranks; coring explains why it is not possible");
  check(await core.getByTestId("mg-plan-toggle").isDisabled(), "MG-1: an infeasible action cannot be added");
  await page.getByLabel("Simulated effort budget").fill("100");
  await settle(page);

  // ── MG-1: compare → add → review → create ──
  await first.getByTestId("mg-plan-toggle").click();
  check((await first.getAttribute("data-addable")) === "in-plan" && /In your plan · 60 pts left/.test(await text(first.getByTestId("mg-status"))), "MG-1: adding updates the card and the remaining effort");
  check(/2 Add/.test(await text(page.locator('[data-testid="mg-flow"] [aria-current="step"]'))), "MG-1: the flow indicator moves to step 2");
  // Keyboard: focus the coring toggle and press Enter.
  await core.getByTestId("mg-plan-toggle").focus();
  await page.keyboard.press("Enter");
  check((await core.getAttribute("data-addable")) === "in-plan", "MG-1: keyboard Enter adds an action");
  const survey = page.getByTestId("mg-card-task-standoff-survey");
  check((await text(survey.getByTestId("mg-status"))) === "Doesn't fit your plan: needs 15 pts, only 5 pts left. Remove an action or raise the budget." && (await survey.getByTestId("mg-plan-toggle").isDisabled()), "MG-1: explains why an action no longer fits the plan");
  check(/Your plan · 2 action\(s\)/.test(await text(page.getByTestId("mg-plan-summary"))) && /95 of 100 pts/.test(await text(page.getByTestId("mg-draft-cost"))) && (await page.getByTestId("mg-plan-meter").locator("span").count()) === 2, "MG-1: plan bar summarises actions and effort");
  await page.getByTestId("mg-review-plan").click();
  await settle(page);
  const review = page.getByTestId("mg-review");
  check(await review.isVisible(), "MG-1: Review opens a plan summary before confirmation");
  check((await page.evaluate(() => document.activeElement?.id)) === "mg-review-title", "MG-1: focus moves to the review heading");
  check(/Uses 95 of 100 simulated points · 5 left/.test(await text(page.getByTestId("mg-review-total"))) && /executes nothing/.test(await text(review)) && /not scientifically validated/.test(await text(review)), "MG-1: summary shows total, remaining effort and caveats");
  await page.getByRole("button", { name: "Move Collect a core sample up" }).click();
  check(/^1\.Collect a core sample/.test((await text(page.getByTestId("mg-review-list"))).replace(/\s+/g, "")) || /1\.\s*Collect a core sample/.test(await text(page.getByTestId("mg-review-list"))), "MG-1: the order can be changed in review");
  await page.getByRole("button", { name: "Move Collect a core sample down" }).click();
  await page.keyboard.press("Escape");
  check(!(await review.isVisible()) && (await page.getByTestId("mg-review-plan").isEnabled()), "MG-1: Escape returns to the actions without losing the draft");
  await page.getByTestId("mg-review-plan").click();
  await page.getByTestId("mg-create-plan").click();
  await settle(page);
  check(/Plan created · 2 action\(s\)/.test(await text(page.getByTestId("mg-plan-bar"))) && /Abrade and analyse a rock → Collect a core sample/.test(await text(page.getByTestId("mg-plan-bar"))), "MG-1: a simulated plan is created and summarised");
  check(await page.getByLabel("Simulated effort budget").isDisabled(), "MG-1: the budget is locked while a plan exists (constraint changes come from scenario events)");
  await page.getByTestId("mg-start-eva").click();
  await settle(page, 1200);

  // ── EVA HUD ──
  check(/SIMULATED EVA · not real telemetry/.test(await text(page.getByTestId("mg-eva"))), "EVA HUD is labelled simulated, not real telemetry");
  check(/Abrade and analyse a rock/.test(await text(page.getByTestId("mg-current"))) && /Provisional priority #1/.test(await text(page.getByTestId("mg-current-why"))), "EVA shows the current planned task and why it is first");
  check(/100 \/ 100 pts/.test(await text(page.getByTestId("mg-effort-left"))) && (await page.getByTestId("mg-warnings").locator("li").count()) >= 3, "EVA shows constraints and warnings");
  check(await page.getByTestId("mg-minimap").locator("canvas").first().isVisible(), "EVA has minimal map access");
  await page.getByTestId("mg-start").click();
  await page.getByTestId("mg-complete-step").click();
  await settle(page);
  const states = await page.getByTestId("mg-steps").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  check(JSON.stringify(states) === JSON.stringify(["done", "current", "todo", "todo"]), `simulated task state updates step by step (${states.join(",")})`);
  check((await page.getByTestId("mg-plan-timeline").locator('[data-status="active"]').count()) === 1, "the plan timeline shows the active task");

  // ── Replanning ──
  await page.getByTestId("mg-event-effort-cut").click();
  await settle(page);
  const replan = page.getByTestId("mg-replan");
  check(await replan.isVisible(), "a constraint change raises a replanning prompt");
  check(/needs 95 points, but only 50 simulated points are left/.test(await text(replan)) && /Abrade and analyse a rock/.test(await text(page.getByTestId("mg-replan-suggested"))), "the prompt explains why and suggests a plan in the engine's order");
  check((await page.evaluate(() => document.activeElement?.id)) === "mg-replan-title", "focus moves to the replanning prompt");
  await page.getByTestId("mg-accept-replan").click();
  await settle(page);
  const timeline = await page.getByTestId("mg-plan-timeline").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(JSON.stringify(timeline) === JSON.stringify(["active", "skipped"]) && /50 \/ 50 pts/.test(await text(page.getByTestId("mg-effort-left"))), "accepting the replan skips coring; the user stays in control");
  await page.getByTestId("mg-event-effort-restored").click();
  await settle(page);
  check((await replan.count()) === 0, "no prompt when the remaining plan still fits in the engine's order");
  for (let n = 0; n < 3; n++) await page.getByTestId("mg-complete-step").click();
  await settle(page);
  check(/60 \/ 100 pts/.test(await text(page.getByTestId("mg-effort-left"))) && /Plan complete/.test(await text(page.getByTestId("mg-eva-progress"))), "completing the task consumes its simulated effort");

  // ── State shared with Planning ──
  await page.getByTestId("mg-mode-planning").click();
  await settle(page, 1000);
  check(/Plan created/.test(await text(page.getByTestId("mg-plan-bar"))), "Planning and EVA share one mission state");

  const body = await text(page.locator("body"));
  check(!/\bsafe route\b|real astronaut telemetry|validated ranking/i.test(body) && !/\b(live|real) telemetry\b/i.test(body.replace(/not real telemetry/g, "")), "no safe-route, real-telemetry or validated-ranking claims");
  check(errors.length === 0, `no page errors${errors.length ? ` (${errors[0]})` : ""}`);

  // ── Translation regression (UX-0 rule) ──
  const tp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const terr = [];
  tp.on("pageerror", (e) => terr.push(String(e)));
  await tp.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await tp.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
  await settle(tp, 800);
  await tp.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() && !n.parentElement?.closest("script, style") ? 1 : 3) });
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      const o = document.createElement("font");
      const i = document.createElement("font");
      i.textContent = n.nodeValue;
      o.appendChild(i);
      n.parentNode.replaceChild(o, n);
    }
  });
  await tp.getByLabel("Simulated effort budget").fill("50");
  await tp.getByTestId("mg-card-task-abrasion-proximity").getByTestId("mg-expand").click();
  await tp.getByTestId("mg-use-suggested").click();
  await tp.getByTestId("mg-review-plan").click();
  await tp.getByTestId("mg-create-plan").click();
  await tp.getByTestId("mg-start-eva").click();
  await settle(tp, 800);
  await tp.getByTestId("mg-start").click();
  await tp.getByTestId("mg-complete-step").click();
  await tp.getByTestId("mg-event-effort-restored").click();
  await settle(tp);
  check(terr.length === 0, `[translated] planning, plan creation and EVA updates without page errors${terr.length ? ` (${terr[0]})` : ""}`);
  await tp.close();

  // ── Narrow screen ──
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await phone.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
  await settle(phone, 600);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const mapY = (await phone.getByTestId("mars-map").boundingBox())?.y ?? 9999;
  const panelY = (await phone.getByTestId("mg-planning").boundingBox())?.y ?? -1;
  check(overflow <= 0 && mapY < panelY, `narrow screen: no horizontal overflow (${overflow}px), map above the planning panel`);
  await phone.close();
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} of ${checks} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll Mission Glass checks passed: ${checks} checks`);
