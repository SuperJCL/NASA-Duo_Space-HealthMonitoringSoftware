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

  // ── MG-2: EVA glance ──
  const inView = async (loc, h = 900) => {
    const b = await loc.boundingBox();
    return Boolean(b && b.y >= 0 && b.y + b.height <= h);
  };
  check(/SIMULATED EVA · training prototype, not flight software or real telemetry/.test(await text(page.getByTestId("mg-eva-label"))), "MG-2: HUD says simulated training prototype, not flight software or telemetry");
  check(/Abrade and analyse a rock/.test(await text(page.locator("#mg-current-title"))) && /Priority #1 · provisional, not validated/.test(await text(page.getByTestId("mg-uncertainty"))), "MG-2: current action with its provisional priority (uncertainty shown)");
  check((await text(page.getByTestId("mg-start"))) === "Start action" && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "mg-start", "MG-2: one primary next action, focused on entry");
  check((await page.getByTestId("mg-current").locator("button.bg-\\[var\\(--mg-coral\\)\\]").count()) === 1, "MG-2: exactly one primary button in the HUD");
  check((await page.getByTestId("mg-minimap").count()) === 0 && (await page.getByTestId("mg-scenario-controls").count()) === 0 && (await page.getByTestId("mg-warnings").count()) === 0 && !(await page.getByTestId("mg-skip").isVisible()), "MG-2: map, caveats, scenario controls and skip sit behind optional controls");
  check(/100/.test(await text(page.getByTestId("mg-effort-left"))) && /95/.test(await text(page.getByTestId("mg-plan-need"))) && /Committed so far: 0 of 100/.test(await text(page.getByTestId("mg-effort-note"))), "MG-2: essential constraints (available, this action, plan left; committed vs estimates)");
  await page.keyboard.press("Enter"); // keyboard: start the action from the focused primary button
  await settle(page);
  check((await text(page.getByTestId("mg-current-step"))) === "Reach target B (simulated)" && /Action 1 of 2 · Step 1 of 4/.test(await text(page.getByTestId("mg-eva-progress"))), "MG-2: keyboard Enter starts the action; current step is shown");
  await page.keyboard.press("Enter");
  await settle(page);
  const states = await page.getByTestId("mg-steps").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  check(JSON.stringify(states) === JSON.stringify(["done", "current", "todo", "todo"]) && (await text(page.getByTestId("mg-current-step"))) === "Document the natural surface", `MG-2: completed and pending steps update (${states.join(",")})`);
  check((await text(page.getByTestId("mg-complete-step"))) === "Complete step 2" && /Then: Abrade a small patch/.test(await text(page.getByTestId("mg-next-step"))), "MG-2: the primary button names the step; the next step is previewed");
  const stepSize = await page.getByTestId("mg-current-step").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const btnBox = await page.getByTestId("mg-complete-step").boundingBox();
  check(stepSize >= 32 && (btnBox?.height ?? 0) >= 56, `MG-2: large step text (${stepSize}px) and a large primary control (${Math.round(btnBox?.height ?? 0)}px)`);
  check((await inView(page.getByTestId("mg-current-step"))) && (await inView(page.getByTestId("mg-complete-step"))) && (await inView(page.getByTestId("mg-constraints"))), "MG-2: step, primary action and constraints are visible without scrolling at 1440×900");
  check((await page.getByTestId("mg-plan-timeline").locator('[data-status="active"]').count()) === 1 && (await page.getByTestId("mg-back-planning").isVisible()), "MG-2: brief progress and a clear route back to Planning");
  await page.getByTestId("mg-toggle-map").click();
  check(await page.getByTestId("mg-minimap").locator("canvas").first().isVisible(), "MG-2: map opens on demand");
  await page.getByTestId("mg-toggle-caveats").click();
  check((await page.getByTestId("mg-warnings").locator("li").count()) === 3 && (await page.getByTestId("mg-minimap").count()) === 0, "MG-2: caveats open on demand (one optional panel at a time)");
  await page.getByTestId("mg-more").click();
  check(await page.getByTestId("mg-skip").isVisible(), "MG-2: skip is available under More");
  await page.getByTestId("mg-more").click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle(page, 400);
  check((await inView(page.getByTestId("mg-current-step"), 800)) && (await inView(page.getByTestId("mg-complete-step"), 800)), "MG-2: still no scrolling needed for the primary view at 1280×800");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page, 300);

  // ── MG-3: replanning (constraint changed → impact → compare → confirm or retain) ──
  await page.getByTestId("mg-toggle-scenario").click();
  await page.getByTestId("mg-event-effort-cut").click();
  await settle(page);
  const replan = page.getByTestId("mg-replan");
  check((await replan.isVisible()) && (await inView(page.getByTestId("mg-replan-trigger"))) && (await inView(page.getByTestId("mg-accept-replan"))) && (await inView(page.getByTestId("mg-keep-plan"))), "MG-3: the alert is immediately visible; both decisions are on screen (not below the fold)");
  check((await page.evaluate(() => document.activeElement?.id)) === "mg-replan-title" && (await replan.getAttribute("role")) === "alertdialog", "MG-3: focus moves to the replanning alert dialog");
  check(/Available effort drops to 50 points/.test(await text(page.getByTestId("mg-replan-trigger"))) && /Your plan no longer fits/.test(await text(page.locator("#mg-replan-title"))), "MG-3: states which constraint changed");
  check((await text(page.getByTestId("mg-replan-committed"))) === "0 pts" && (await text(page.getByTestId("mg-replan-available"))) === "50 pts" && (await text(page.getByTestId("mg-replan-need"))) === "95 pts" && /estimated/.test(await text(page.getByTestId("mg-replan-resources"))), "MG-3: committed effort is distinguished from the estimated remaining need");
  const impact = await page.getByTestId("mg-replan-impact").locator("li").evaluateAll((els) => els.map((e) => [e.getAttribute("data-verdict"), e.textContent]));
  check(impact.length === 2 && impact[0][0] === "fits" && /Abrade and analyse a rock/.test(impact[0][1]) && /In progress, 1 of 4 steps done; those steps are kept/.test(impact[0][1]) && impact[1][0] === "too-large" && /Collect a core sample/.test(impact[1][1]) && /Needs 55 pts, more than the 50 pts now available/.test(impact[1][1]), "MG-3: names each affected action with a plain-language feasibility change");
  check(/Abrade and analyse a rock · 40 pts/.test(await text(page.getByTestId("mg-replan-suggested"))) && /Marked skipped \(kept in the plan, can be undone\): Collect a core sample/.test(await text(page.getByTestId("mg-replan-dropped"))) && /provisional, not scientifically validated/.test(await text(page.getByTestId("mg-option-suggested"))), "MG-3: suggested option (provisional engine order) shows what would be skipped");
  check(/Infeasible: needs 95 pts, 45 more than available/.test(await text(page.getByTestId("mg-current-feasibility"))) && (await text(page.getByTestId("mg-keep-plan"))) === "Keep current plan anyway", "MG-3: keeping the current plan is labelled infeasible");
  await page.keyboard.press("Escape");
  for (let n = 0; n < 4; n++) await page.keyboard.press("Tab");
  check((await replan.isVisible()) && (await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="mg-replan"]')))), "MG-3: Escape does not dismiss the decision; Tab stays inside the dialog");
  // Retain the infeasible plan.
  await page.getByTestId("mg-keep-plan").click();
  await settle(page);
  let tl = await page.getByTestId("mg-plan-timeline").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check((await replan.count()) === 0 && JSON.stringify(tl) === JSON.stringify(["active", "planned"]) && /You kept a plan that exceeds the available effort by 45 pts/.test(await text(page.getByTestId("mg-retained-warning"))), "MG-3: keeping an infeasible plan changes nothing and raises an explicit warning");
  check((await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "mg-complete-step" && (await inView(page.getByTestId("mg-complete-step"))), "MG-3: focus returns to the primary action, still on screen");
  await page.getByTestId("mg-review-replan").click();
  await settle(page);
  check(await replan.isVisible(), "MG-3: the replanning decision can be reviewed again from the warning");
  // Accept the suggestion: remaining work only; completed steps kept.
  await page.getByTestId("mg-accept-replan").click();
  await settle(page);
  tl = await page.getByTestId("mg-plan-timeline").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(JSON.stringify(tl) === JSON.stringify(["active", "skipped"]) && (await text(page.getByTestId("mg-current-step"))) === "Document the natural surface" && /Step 2 of 4/.test(await text(page.getByTestId("mg-eva-progress"))) && (await page.getByTestId("mg-retained-warning").count()) === 0, "MG-3: accepting replans only remaining work; the in-progress steps are kept");
  check(/Plan updated: 1 action\(s\) skipped\. Completed steps are kept/.test(await text(page.getByTestId("mg-notice-text"))) && (await page.getByTestId("mg-undo-replan").isVisible()) && /50/.test(await text(page.getByTestId("mg-effort-left"))), "MG-3: the change is announced with Undo (nothing discarded silently)");
  await page.getByTestId("mg-undo-replan").click();
  await settle(page);
  tl = await page.getByTestId("mg-plan-timeline").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(JSON.stringify(tl) === JSON.stringify(["active", "planned"]) && /previous plan is restored/.test(await text(page.getByTestId("mg-notice-text"))) && (await page.getByTestId("mg-retained-warning").isVisible()), "MG-3: Undo restores the previous plan, and its infeasibility is flagged again");
  await page.getByTestId("mg-review-replan").click();
  await page.getByTestId("mg-accept-replan").click();
  await settle(page);
  await page.getByTestId("mg-event-effort-restored").click();
  await settle(page);
  check((await replan.count()) === 0 && /Your plan still fits: 40 of 100 pts needed/.test(await text(page.getByTestId("mg-notice-text"))), "MG-3: no prompt when the remaining plan still fits, and the user is told so");
  await page.getByTestId("mg-dismiss-notice").click();
  check((await page.getByTestId("mg-notice").count()) === 0, "MG-3: the message can be dismissed");
  for (let n = 0; n < 3; n++) await page.getByTestId("mg-complete-step").click();
  await settle(page);
  check(/60/.test(await text(page.getByTestId("mg-effort-left"))) && /Plan complete/.test(await text(page.getByTestId("mg-eva-progress"))) && (await page.getByTestId("mg-finish-plan").isVisible()), "completing the action commits its effort; the plan completes");

  // ── State shared with Planning ──
  await page.getByTestId("mg-mode-planning").click();
  await settle(page, 1000);
  check(/Plan created/.test(await text(page.getByTestId("mg-plan-bar"))), "Planning and EVA share one mission state");

  const body = await text(page.locator("body"));
  check(!/\bsafe route\b|real astronaut telemetry|validated ranking/i.test(body) && !/\b(live|real) telemetry\b/i.test(body.replace(/not real telemetry/g, "")), "no safe-route, real-telemetry or validated-ranking claims");
  check(errors.length === 0, `no page errors${errors.length ? ` (${errors[0]})` : ""}`);

  // ── Translation regression (UX-0 rule) ──
  const translate = (pg) =>
    pg.evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() && !n.parentElement?.closest("script, style, font") ? 1 : 3) });
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
  const tp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const terr = [];
  tp.on("pageerror", (e) => terr.push(String(e)));
  await tp.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await tp.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
  await settle(tp, 800);
  await translate(tp);
  await tp.getByLabel("Simulated effort budget").fill("50");
  await tp.getByTestId("mg-card-task-abrasion-proximity").getByTestId("mg-expand").click();
  await tp.getByLabel("Simulated effort budget").fill("100");
  await tp.getByTestId("mg-use-suggested").click();
  await tp.getByTestId("mg-review-plan").click();
  await translate(tp);
  await tp.getByTestId("mg-create-plan").click();
  await tp.getByTestId("mg-start-eva").click();
  await settle(tp, 800);
  await translate(tp);
  await tp.getByTestId("mg-start").click();
  await tp.getByTestId("mg-complete-step").click();
  await tp.getByTestId("mg-toggle-scenario").click();
  await tp.getByTestId("mg-event-effort-cut").click();
  await settle(tp);
  await translate(tp);
  await tp.getByTestId("mg-keep-plan").click();
  await settle(tp);
  await translate(tp);
  await tp.getByTestId("mg-review-replan").click();
  await tp.getByTestId("mg-accept-replan").click();
  await settle(tp);
  await translate(tp);
  await tp.getByTestId("mg-undo-replan").click();
  await tp.getByTestId("mg-event-effort-restored").click();
  await tp.getByTestId("mg-toggle-map").click();
  await settle(tp);
  check(terr.length === 0 && (await tp.getByTestId("mg-plan-timeline").count()) === 1, `[translated] planning, EVA and replanning (keep, review, accept, undo) without page errors${terr.length ? ` (${terr[0]})` : ""}`);
  await tp.close();

  // ── Reduced motion ──
  const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await rm.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await rm.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
  await settle(rm, 600);
  await rm.getByTestId("mg-use-suggested").click();
  await rm.getByTestId("mg-review-plan").click();
  const motion = await rm.evaluate(() => ({
    rise: [...document.querySelectorAll(".mission-glass .mg-rise")].map((e) => getComputedStyle(e).animationName),
    transitions: [...document.querySelectorAll('.mission-glass [data-testid^="mg-card-"], .mission-glass [data-testid="mg-detail"]')].map((e) => getComputedStyle(e).transitionDuration),
  }));
  check(motion.rise.length > 0 && motion.rise.every((n) => n === "none") && motion.transitions.length > 0 && motion.transitions.every((d) => d.split(",").every((x) => parseFloat(x) === 0)), `reduced motion: no entry animations (${motion.rise.length}) and no transitions (${motion.transitions.length})`);
  await rm.close();

  // ── Narrow screen, and the MG-3 no-feasible-alternative state ──
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const perr = [];
  phone.on("pageerror", (e) => perr.push(String(e)));
  await phone.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await phone.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
  await settle(phone, 600);
  const hOverflow = () => phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const overflow = await hOverflow();
  const mapY = (await phone.getByTestId("mars-map").boundingBox())?.y ?? 9999;
  const panelY = (await phone.getByTestId("mg-planning").boundingBox())?.y ?? -1;
  check(overflow <= 0 && mapY < panelY, `narrow screen: no horizontal overflow (${overflow}px), map above the planning panel`);
  await phone.getByTestId("mg-use-suggested").click(); // abrasion + coring, 95 of 100
  await phone.getByTestId("mg-review-plan").click();
  await phone.getByTestId("mg-create-plan").click();
  await phone.getByTestId("mg-start-eva").click();
  await settle(phone, 600);
  const phoneIn = async (loc) => {
    const b = await loc.boundingBox();
    return Boolean(b && b.y >= 0 && b.y + b.height <= 844 && b.x >= 0 && b.x + b.width <= 390);
  };
  check((await phoneIn(phone.getByTestId("mg-current-step"))) && (await phoneIn(phone.getByTestId("mg-start"))) && (await hOverflow()) <= 0, "narrow screen: EVA step and primary action fit the phone viewport");
  await phone.getByTestId("mg-start").click();
  for (let n = 0; n < 4; n++) await phone.getByTestId("mg-complete-step").click(); // abrasion done: 40 committed
  await phone.getByTestId("mg-toggle-scenario").click();
  await phone.getByTestId("mg-event-effort-cut").click();
  await settle(phone);
  check(/No remaining action fits/.test(await text(phone.locator("#mg-replan-title"))) && /None of the remaining actions fits the 10 pts available/.test(await text(phone.getByTestId("mg-no-feasible"))), "MG-3: no-feasible-alternative state is stated plainly");
  const verdicts = await phone.getByTestId("mg-replan-impact").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-verdict")));
  check((await text(phone.getByTestId("mg-replan-committed"))) === "40 pts" && (await text(phone.getByTestId("mg-replan-available"))) === "10 pts" && JSON.stringify(verdicts) === JSON.stringify(["kept-done", "too-large"]), "MG-3: completed work is committed and kept; the remaining action is too large");
  check((await phoneIn(phone.getByTestId("mg-accept-replan"))) && (await phoneIn(phone.getByTestId("mg-keep-plan"))) && (await hOverflow()) <= 0 && (await text(phone.getByTestId("mg-accept-replan"))) === "End remaining work", "narrow screen: the replanning decision is on screen without horizontal overflow");
  await phone.getByTestId("mg-accept-replan").click();
  await settle(phone);
  const ptl = await phone.getByTestId("mg-plan-timeline").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(JSON.stringify(ptl) === JSON.stringify(["done", "skipped"]) && /Plan complete: 1 done, 1 skipped/.test(await text(phone.getByTestId("mg-eva-progress"))) && /Remaining work ended/.test(await text(phone.getByTestId("mg-notice-text"))) && perr.length === 0, "MG-3: ending the remaining work keeps the completed action and marks the rest skipped");
  await phone.close();
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} of ${checks} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll Mission Glass checks passed: ${checks} checks`);
