#!/usr/bin/env node
/**
 * Browser smoke test for MDI 2.0 Mission Glass, the default entry point (/).
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-mission-glass.mjs
 *
 * Each PASS/FAIL line is one check. The main app's smoke test is separate
 * (scripts/smoke-test.mjs).
 */
import { chromium } from "playwright";

const ORIGIN = process.env.BASE_URL ?? "http://localhost:3000";
const BASE_URL = ORIGIN + "/";
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

// MAP-1 helpers: map view geometry from the exposed extent (Mars degrees, linear).
const TARGETS = { "sim-target-a": { east: -110, north: 120 }, "sim-target-b": { east: 70, north: 95 }, "sim-target-c": { east: 130, north: -45 } };
const M_LON = MPD * Math.cos((LEFROY[1] * Math.PI) / 180); // metres per degree of longitude at Lefroy Bay
const TASK_OF = { "sim-target-a": "task-standoff-survey", "sim-target-b": "task-abrasion-proximity", "sim-target-c": "task-core-for-earth" };
async function viewOf(page) {
  const map = page.getByTestId("mars-map");
  const [w, s, e, n] = ((await map.getAttribute("data-view-extent")) ?? "").split(",").map(Number);
  const box = await map.boundingBox();
  return { width: e - w, px: ([lon, lat]) => [box.x + ((lon - w) / (e - w)) * box.width, box.y + ((n - lat) / (n - s)) * box.height], box };
}
async function waitStill(page) {
  // The extent attribute only changes at the end of a move, so first outlast the 280 ms focus transition.
  await page.waitForTimeout(450);
  let prev = "";
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(120);
    const cur = (await page.getByTestId("mars-map").getAttribute("data-view-extent")) ?? "";
    if (cur && cur === prev) return;
    prev = cur;
  }
}
const markersOf = async (page) => JSON.parse((await page.getByTestId("mars-map").getAttribute("data-sim-markers")) || "[]");
const markerMap = async (page) => Object.fromEntries((await markersOf(page)).map((m) => [m.id, m]));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="mars-map"]')?.getAttribute("data-view-extent"), undefined, { timeout: 15_000 });
  await settle(page, 800);

  // ── MAP-0: entry point and routing ──
  check((await page.getByTestId("mission-glass").count()) === 1 && (await page.title()) === "Mission Glass · MDI 2.0", "MAP-0: Mission Glass is the default entry point (/)");
  {
    const res = await fetch(ORIGIN + "/mission-glass", { redirect: "manual" });
    check(res.status === 307 && new URL(res.headers.get("location"), ORIGIN).pathname === "/", `MAP-0: the old /mission-glass route redirects to / (${res.status} → ${res.headers.get("location")})`);
    const research = await fetch(ORIGIN + "/research");
    check(research.status === 200 && (await page.getByTestId("mg-link-research").getAttribute("href")) === "/research", "MAP-0: the research workspace is reachable at /research and linked from Mission Glass");
  }

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
  await waitStill(page); // MAP-1: selecting a card now moves the map to its target
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
  {
    // The HUD map is loaded lazily (client-only OpenLayers), so wait for its canvas instead of checking at once.
    const t0 = Date.now();
    const shown = await page.getByTestId("mg-minimap").locator("canvas").first().waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    check(shown, `MG-2: map opens on demand (canvas after ${Date.now() - t0} ms)`);
  }
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
  check(/Abrade and analyse a rock · 40 pts/.test(await text(page.getByTestId("mg-replan-suggested"))) && /Dropped by this replan \(kept in the plan, can be undone\): Collect a core sample/.test(await text(page.getByTestId("mg-replan-dropped"))) && /provisional, not scientifically validated/.test(await text(page.getByTestId("mg-option-suggested"))), "MG-3: suggested option (provisional engine order) shows what would be dropped");
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
  check(/Plan updated: 1 action\(s\) dropped by replan\. Completed steps are kept/.test(await text(page.getByTestId("mg-notice-text"))) && (await page.getByTestId("mg-undo-replan").isVisible()) && /50/.test(await text(page.getByTestId("mg-effort-left"))), "MG-3: the change is announced with Undo (nothing discarded silently)");
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

  // ── MAP-1: interactive spatial decision map (fresh page) ──
  {
    const mp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const merr = [];
    mp.on("pageerror", (e) => merr.push(String(e)));
    await mp.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await mp.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
    await mp.waitForFunction(() => (document.querySelector('[data-testid="mars-map"]')?.getAttribute("data-sim-markers") ?? "[]") !== "[]", undefined, { timeout: 15_000 });
    await waitStill(mp);
    const map = mp.getByTestId("mars-map");
    const cardRank = async () => Object.fromEntries(await mp.locator("[data-testid^='mg-card-']").evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid").replace("mg-card-", ""), e.getAttribute("data-rank")])));
    const consistent = async () => {
      const m = await markersOf(mp);
      const ranks = await cardRank();
      const chips = Object.fromEntries(await mp.getByTestId("mg-target-list").locator("button").evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid").replace("mg-target-", ""), [e.getAttribute("data-badge"), e.getAttribute("data-tone")]])));
      return m.length === 3 && m.every((x) => chips[x.id]?.[0] === x.badge && chips[x.id]?.[1] === x.tone && (x.badge === "✓" || (ranks[TASK_OF[x.id]] || "–") === x.badge));
    };

    let mk = await markerMap(mp);
    check(JSON.stringify(Object.values(mk).map((x) => [x.id, x.badge, x.tone])) === JSON.stringify([["sim-target-a", "3", "candidate"], ["sim-target-b", "1", "candidate"], ["sim-target-c", "2", "candidate"]]) && (await consistent()), "MAP-1: each target shows its provisional rank, matching the engine's card ranks");
    check((await markersOf(mp)).every((x) => x.id.startsWith("sim-")) && /Number: provisional priority \(existing engine, not validated\)/.test(await text(mp.getByTestId("mg-legend"))) && /provisional priority/.test((await map.getAttribute("aria-label")) ?? ""), "MAP-1: ranks only on simulated targets, labelled provisional (legend and map name)");
    check((await mp.getByTestId("mg-target-sim-target-b").getAttribute("aria-label")) === "Target B: Abrade and analyse a rock. Provisional priority #1. Not in the plan.", "MAP-1: keyboard target buttons have descriptive accessible names");

    // Card → target: select, focus (centred in the visible map area), summary.
    await mp.getByTestId("mg-card-task-core-for-earth").getByTestId("mg-select").click();
    await waitStill(mp);
    let v = await viewOf(mp);
    let [x, y] = v.px(targetLonLat(TARGETS["sim-target-c"]));
    const vis = { x: (440 + (1440 - 472)) / 2, y: v.box.y + (64 + (v.box.height - 16)) / 2 };
    check((await map.getAttribute("data-selected-id")) === "sim-target-c" && (await mp.getByTestId("mg-target-sim-target-c").getAttribute("aria-pressed")) === "true" && Math.abs(x - vis.x) < 30 && Math.abs(y - vis.y) < 30, `MAP-1: clicking a card selects and focuses its target in the visible map area (target at ${Math.round(x)},${Math.round(y)}; expected ≈ ${Math.round(vis.x)},${Math.round(vis.y)})`);
    check(/Collect a core sample/.test(await text(mp.getByTestId("mg-summary-title"))) && (await text(mp.getByTestId("mg-summary-priority"))) === "Provisional priority #2 · not validated · 55 pts" && (await text(mp.getByTestId("mg-summary-state"))) === "Fits: 55 pts, leaving 45 pts." && /SIM · Target C · scenario-defined position/.test(await text(mp.getByTestId("mg-target-summary"))), "MAP-1: concise target summary (scenario-defined, provisional, feasibility)");
    mk = await markerMap(mp);
    check(mk["sim-target-c"].selected && !mk["sim-target-a"].selected && !mk["sim-target-b"].selected, "MAP-1: only the selected target is drawn selected");
    const w0 = v.width;

    // Useful scale: focusing undoes excessive zoom-out or zoom-in.
    for (let n = 0; n < 3; n++) await mp.locator(".ol-zoom-out").click();
    await waitStill(mp);
    const wOut = (await viewOf(mp)).width;
    await mp.getByTestId("mg-target-sim-target-a").click();
    await waitStill(mp);
    const wA = (await viewOf(mp)).width;
    for (let n = 0; n < 4; n++) await mp.locator(".ol-zoom-in").click();
    await waitStill(mp);
    const wIn = (await viewOf(mp)).width;
    await mp.getByTestId("mg-target-sim-target-b").click();
    await waitStill(mp);
    const wB = (await viewOf(mp)).width;
    // The focus zoom is clamped to [overview − 0.5, overview + 1] zoom levels: widths within a factor 2^1.5 ≈ 2.83.
    check(wA < wOut / 2 && wB > wIn * 1.2 && wA / wB <= 2.9 && wA / w0 < 2 && w0 / wB < 2.1, `MAP-1: focusing keeps a useful scale (view width ${Math.round(w0 * M_LON)} m; after zoom-out ${Math.round(wOut * M_LON)} → ${Math.round(wA * M_LON)} m; after zoom-in ${Math.round(wIn * M_LON)} → ${Math.round(wB * M_LON)} m)`);

    // Keyboard alternative.
    await mp.getByTestId("mg-target-sim-target-a").focus();
    await mp.keyboard.press("Enter");
    await settle(mp);
    const okA = (await map.getAttribute("data-selected-id")) === "sim-target-a" && (await mp.getByTestId("mg-card-task-standoff-survey").getAttribute("data-selected")) === "true";
    await mp.keyboard.press("Shift+Tab");
    await mp.keyboard.press(" ");
    await settle(mp);
    const focusedId = await mp.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    check(okA && /Survey the outcrops|Abrade|Collect/.test(await text(mp.getByTestId("mg-summary-title"))) && (await map.getAttribute("data-selected-id")) === focusedId?.replace("mg-target-", ""), `MAP-1: target buttons work with Enter, Space and Tab (now ${focusedId})`);

    // Map → task.
    await waitStill(mp);
    await clickLonLat(mp, targetLonLat(TARGETS["sim-target-c"]));
    check((await mp.getByTestId("mg-card-task-core-for-earth").getAttribute("data-selected")) === "true" && (await mp.getByTestId("mg-target-sim-target-c").getAttribute("aria-pressed")) === "true" && /Collect a core sample/.test(await text(mp.getByTestId("mg-summary-title"))), "MAP-1: clicking a target on the map selects its task, button and summary");

    // Optional Level 2 / Level 3 from the summary; the summary closes.
    await mp.getByTestId("mg-summary-details").click();
    await settle(mp);
    check((await mp.getByTestId("mg-card-task-core-for-earth").getByTestId("mg-expand").getAttribute("aria-expanded")) === "true", "MAP-1: summary → Details opens the card's Level 2");
    await mp.getByTestId("mg-summary-evidence").click();
    await settle(mp);
    const sheetOpen = await mp.getByTestId("mg-evidence-sheet").isVisible();
    await mp.keyboard.press("Escape");
    await mp.getByTestId("mg-summary-close").click();
    check(sheetOpen && (await mp.getByTestId("mg-target-summary").count()) === 0 && (await map.getAttribute("data-selected-id")) === "sim-target-c", "MAP-1: summary → Evidence opens Level 3; the summary closes and the selection stays");

    // Resource change updates markers consistently.
    await mp.getByLabel("Simulated effort budget").fill("50");
    await settle(mp);
    mk = await markerMap(mp);
    check(mk["sim-target-c"].tone === "infeasible" && mk["sim-target-c"].badge === "–" && mk["sim-target-c"].status === "not feasible" && mk["sim-target-a"].badge === "1" && mk["sim-target-b"].badge === "2" && (await consistent()), "MAP-1: budget 50: coring's target turns not feasible and ranks update, matching the cards");
    await mp.getByLabel("Simulated effort budget").fill("100");
    await settle(mp);

    // Plan states on the map.
    await mp.getByTestId("mg-use-suggested").click();
    await settle(mp);
    mk = await markerMap(mp);
    const added = mk["sim-target-b"].tone === "added" && mk["sim-target-c"].tone === "added" && mk["sim-target-a"].tone === "candidate";
    await mp.getByTestId("mg-review-plan").click();
    await mp.getByTestId("mg-create-plan").click();
    await settle(mp);
    mk = await markerMap(mp);
    check(added && mk["sim-target-b"].tone === "planned" && mk["sim-target-c"].tone === "planned" && (await mp.getByTestId("mg-plan-locked").count()) === 3, "MAP-1: markers show added, then planned; cards are read-only once the plan exists");
    await mp.getByTestId("mg-start-eva").click();
    await settle(mp, 800);
    await mp.getByTestId("mg-start").click();
    await mp.getByTestId("mg-toggle-map").click();
    await mp.waitForFunction(() => (document.querySelector('[data-testid="mars-map"]')?.getAttribute("data-sim-markers") ?? "[]") !== "[]", undefined, { timeout: 15_000 });
    mk = await markerMap(mp);
    const activeOk = mk["sim-target-b"].tone === "active" && mk["sim-target-b"].status === "in progress" && mk["sim-target-b"].selected;
    for (let n = 0; n < 4; n++) await mp.getByTestId("mg-complete-step").click();
    await settle(mp);
    mk = await markerMap(mp);
    const doneOk = mk["sim-target-b"].tone === "done" && mk["sim-target-b"].badge === "✓";
    check(activeOk && doneOk, "MAP-1: the EVA map shows the active target, then done (shared mission state)");
    await mp.getByTestId("mg-toggle-scenario").click();
    await mp.getByTestId("mg-event-effort-cut").click();
    await settle(mp);
    await mp.getByTestId("mg-accept-replan").click();
    await mp.getByTestId("mg-mode-planning").click();
    await mp.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
    await mp.waitForFunction(() => (document.querySelector('[data-testid="mars-map"]')?.getAttribute("data-sim-markers") ?? "[]") !== "[]", undefined, { timeout: 15_000 });
    await settle(mp, 600);
    mk = await markerMap(mp);
    const panel = await text(mp.getByTestId("mg-cards"));
    check(mk["sim-target-b"].tone === "done" && mk["sim-target-c"].tone === "skipped" && mk["sim-target-a"].tone === "infeasible" && (await consistent()), "MAP-1: after replanning, the completed target stays done and dropped work shows skipped");
    check(/Done \(simulated\)\. Its effort is committed\./.test(panel) && /Dropped by replanning\./.test(panel) && /Not feasible: needs 15 pts, 10 pts available\./.test(panel) && !/-\d+ pts/.test(panel) && !/over budget/.test(panel), "MAP-1: planning cards agree with the map after replanning (no stale draft arithmetic)");
    check(merr.length === 0, `MAP-1: no page errors${merr.length ? ` (${merr[0]})` : ""}`);
    await mp.close();
  }

  // ── EVA-1: individual step management (fresh page) ──
  {
    const ep = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const eerr = [];
    ep.on("pageerror", (e) => eerr.push(String(e)));
    await ep.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await ep.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
    await settle(ep, 600);
    await ep.getByTestId("mg-use-suggested").click(); // abrasion + coring, 95 of 100
    await ep.getByTestId("mg-review-plan").click();
    await ep.getByTestId("mg-create-plan").click();
    await ep.getByTestId("mg-start-eva").click();
    await settle(ep, 800);
    await ep.getByTestId("mg-start").click();
    await settle(ep);
    const states = () => ep.getByTestId("mg-steps").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
    const focusedId = () => ep.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.id);

    // Complete with the keyboard (focus is on the primary action).
    await ep.keyboard.press("Enter");
    await settle(ep);
    check(JSON.stringify(await states()) === JSON.stringify(["done", "current", "todo", "todo"]) && (await text(ep.getByTestId("mg-step-counts"))) === "1 done · 3 to do" && (await text(ep.getByTestId("mg-notice-text"))) === "Step 1 marked done." && (await ep.getByTestId("mg-undo-step").isVisible()), "EVA-1: a step is marked done (keyboard), with progress counts and Undo");

    // Skip a step with a recorded reason, keyboard only.
    await ep.getByTestId("mg-more").focus();
    await ep.keyboard.press("Enter");
    await ep.keyboard.press("Tab");
    const onSkipItem = (await focusedId()) === "mg-skip-step";
    await ep.keyboard.press("Enter");
    await settle(ep);
    const inputFocused = (await focusedId()) === "mg-step-input";
    await ep.keyboard.press("Enter"); // empty reason: refused
    await settle(ep, 150);
    const refused = (await ep.getByTestId("mg-form-skip-step").isVisible()) && (await ep.getByTestId("mg-form-submit").isDisabled()) && JSON.stringify(await states()) === JSON.stringify(["done", "current", "todo", "todo"]);
    await ep.keyboard.type("Dust on the target (simulated)");
    await ep.keyboard.press("Enter");
    await settle(ep);
    check(onSkipItem && inputFocused && refused, "EVA-1: skipping a step asks for a reason (keyboard: More → Skip step → reason); an empty reason is refused");
    check(JSON.stringify(await states()) === JSON.stringify(["done", "skipped", "current", "todo"]) && /Step 3 of 4/.test(await text(ep.getByTestId("mg-step-label"))) && (await text(ep.getByTestId("mg-step-counts"))) === "1 done · 1 skipped · 2 to do" && (await focusedId()) === "mg-complete-step", "EVA-1: the skipped step is recorded; the current step moves on; focus returns to the primary action");
    await ep.getByTestId("mg-toggle-steps").click();
    check(/Skip reason: Dust on the target \(simulated\)/.test(await text(ep.getByTestId("mg-step-row-1"))) && /needs a separate planning confirmation; the HUD cannot edit the procedure/.test(await text(ep.getByTestId("mg-procedure-lock"))), "EVA-1: the steps panel shows the reason; the procedure cannot be edited in the HUD");

    // Pause and resume.
    await ep.getByTestId("mg-pause").click();
    await settle(ep);
    const pausedOk =
      (await text(ep.getByTestId("mg-resume"))) === "Resume step 3" &&
      (await ep.getByTestId("mg-complete-step").count()) === 0 &&
      /paused/.test(await text(ep.getByTestId("mg-step-label"))) &&
      (await ep.getByTestId("mg-step-done-2").isDisabled()) &&
      /paused/.test(await text(ep.getByTestId("mg-plan-timeline"))) &&
      (await focusedId()) === "mg-resume";
    await ep.keyboard.press("Enter");
    await settle(ep);
    check(pausedOk && (await text(ep.getByTestId("mg-complete-step"))) === "Complete step 3", "EVA-1: pause blocks step changes and shows clearly; Resume (keyboard) continues");

    // Observation note on a step.
    await ep.getByTestId("mg-step-note-btn-2").click();
    await ep.getByTestId("mg-step-input").fill("Fine laminations visible (simulated)");
    await ep.getByTestId("mg-form-submit").click();
    await settle(ep);
    check(/Your note \(simulated\): Fine laminations visible \(simulated\)/.test(await text(ep.getByTestId("mg-step-note-2"))) && /Fine laminations/.test(await text(ep.getByTestId("mg-current-note"))) && /Note saved on step 3/.test(await text(ep.getByTestId("mg-notice-text"))), "EVA-1: an optional observation note is saved on the step and shown");

    // A single step out of order, then Undo.
    await ep.getByTestId("mg-step-done-3").click();
    await settle(ep);
    const ooo = JSON.stringify(await states()) === JSON.stringify(["done", "skipped", "current", "done"]) && (await text(ep.getByTestId("mg-complete-step"))) === "Finish action" && (await ep.getByTestId("mg-next-step").count()) === 0;
    await ep.getByTestId("mg-undo-step").click();
    await settle(ep);
    check(ooo && JSON.stringify(await states()) === JSON.stringify(["done", "skipped", "current", "todo"]) && (await text(ep.getByTestId("mg-notice-text"))) === "Undone: Step 4 marked done." && (await text(ep.getByTestId("mg-complete-step"))) === "Complete step 3", "EVA-1: any single step can be marked done; Undo reverts an accidental change");

    // Replanning regression: step records, the note and progress survive; drop vs skip stay distinct.
    await ep.getByTestId("mg-toggle-scenario").click();
    await ep.getByTestId("mg-event-effort-cut").click();
    await settle(ep);
    const impact0 = await text(ep.getByTestId("mg-replan-impact").locator("li").first());
    await ep.getByTestId("mg-accept-replan").click();
    await settle(ep);
    await ep.getByTestId("mg-toggle-steps").click();
    const tl = await ep.getByTestId("mg-plan-timeline").locator("li").evaluateAll((els) => els.map((e) => [e.getAttribute("data-status"), e.getAttribute("data-drop")]));
    check(/In progress, 1 of 4 steps done, 1 skipped; those steps are kept\./.test(impact0) && JSON.stringify(await states()) === JSON.stringify(["done", "skipped", "current", "todo"]) && /Fine laminations/.test(await text(ep.getByTestId("mg-step-note-2"))), "EVA-1: a replan explains and keeps the in-progress steps, reasons and notes");
    check(JSON.stringify(tl) === JSON.stringify([["active", ""], ["skipped", "replan"]]) && /dropped by replan/.test(await text(ep.getByTestId("mg-plan-timeline"))) && (await ep.getByTestId("mg-undo-step").count()) === 0 && (await ep.getByTestId("mg-undo-replan").isVisible()), "EVA-1: the replan-dropped action is labelled as such; step Undo gives way to replan Undo");

    // Committed vs estimated effort, with Undo of a completion.
    const before = [await text(ep.getByTestId("mg-effort-left")), await text(ep.getByTestId("mg-plan-need"))];
    await ep.getByTestId("mg-complete-step").click();
    await ep.getByTestId("mg-complete-step").click(); // Finish action
    await settle(ep);
    const after = [await text(ep.getByTestId("mg-effort-left")), await text(ep.getByTestId("mg-plan-need")), await text(ep.getByTestId("mg-effort-note"))];
    await ep.getByTestId("mg-undo-step").click();
    await settle(ep);
    const undone = [await text(ep.getByTestId("mg-effort-left")), await text(ep.getByTestId("mg-plan-need"))];
    check(
      JSON.stringify(before) === JSON.stringify(["50", "40"]) &&
        after[0] === "10" &&
        after[1] === "0" &&
        /Committed so far: 40 of 50/.test(after[2]) &&
        JSON.stringify(undone) === JSON.stringify(["50", "40"]),
      `EVA-1: finishing the action commits its effort; undoing it restores committed vs estimated (${before} → ${after.slice(0, 2)} → ${undone})`,
    );

    // A manual skip of the whole action, with a reason.
    await ep.getByTestId("mg-more").click();
    await ep.getByTestId("mg-skip").click();
    await ep.getByTestId("mg-step-input").fill("Changed priorities (simulated)");
    await ep.getByTestId("mg-form-submit").click();
    await settle(ep);
    check(/Plan complete: 0 done, 1 skipped, 1 dropped by replan/.test(await text(ep.getByTestId("mg-eva-progress"))) && /skipped by you/.test(await text(ep.getByTestId("mg-plan-timeline"))) && /dropped by replan/.test(await text(ep.getByTestId("mg-plan-timeline"))), "EVA-1: a manual skip and a replan drop are distinguished");
    await ep.getByTestId("mg-mode-planning").click();
    await ep.waitForFunction(() => (document.querySelector('[data-testid="mars-map"]')?.getAttribute("data-sim-markers") ?? "[]") !== "[]", undefined, { timeout: 15_000 });
    const mk = await markerMap(ep);
    check(mk["sim-target-b"].status === "skipped" && mk["sim-target-c"].status === "dropped by replan" && /Skipped by you: Changed priorities \(simulated\)/.test(await ep.getByTestId("mg-target-sim-target-b").getAttribute("aria-label")), "EVA-1: the map and planning share the distinction (skipped by you vs dropped by replan)");
    check(eerr.length === 0, `EVA-1: no page errors${eerr.length ? ` (${eerr[0]})` : ""}`);
    await ep.close();
  }

  // ── EVA-1.1: P0 fixes — details collapse and step correction (fresh page) ──
  {
    const fp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const ferr = [];
    fp.on("pageerror", (e) => ferr.push(String(e)));
    await fp.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await fp.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 20_000 });
    await settle(fp, 600);
    await fp.getByTestId("mg-use-suggested").click();
    await fp.getByTestId("mg-review-plan").click();
    await fp.getByTestId("mg-create-plan").click();
    await settle(fp);
    const fid = () => fp.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    // The Steps panel offers an action picker only when more than one action has steps.
    const pickSteps = async (taskId) => {
      const b = fp.getByTestId(`mg-steps-of-${taskId}`);
      if (await b.count()) await b.click();
    };
    const card = fp.getByTestId("mg-card-task-abrasion-proximity");
    const cardState = async () => [await card.getByTestId("mg-expand").getAttribute("aria-expanded"), (await text(card.getByTestId("mg-expand"))).trim()];

    // 1. Details opens and closes repeatedly (card toggle, bottom collapse, keyboard, map summary).
    const cycles = [];
    for (let n = 0; n < 3; n++) {
      await card.getByTestId("mg-expand").click();
      cycles.push((await cardState()).join("|"));
      await card.getByTestId("mg-expand").click();
      cycles.push((await cardState()).join("|"));
    }
    await card.getByTestId("mg-expand").click();
    await card.getByTestId("mg-collapse-details").click();
    const bottomCollapse = (await cardState())[0] === "false" && (await fid()) === "mg-expand";
    await card.getByTestId("mg-expand").focus();
    await fp.keyboard.press("Enter");
    const kOpen = (await cardState())[0];
    await fp.keyboard.press("Space");
    const kClose = (await cardState())[0];
    check(
      JSON.stringify(cycles) === JSON.stringify(["true|Hide details", "false|Details", "true|Hide details", "false|Details", "true|Hide details", "false|Details"]) && bottomCollapse && kOpen === "true" && kClose === "false",
      "EVA-1.1: card Details opens and closes repeatedly; the expanded details have their own collapse control; keyboard works",
    );
    await fp.getByTestId("mg-target-sim-target-b").click();
    await settle(fp, 500);
    const sum = [];
    for (let n = 0; n < 2; n++) {
      await fp.getByTestId("mg-summary-details").click();
      sum.push(`${await fp.getByTestId("mg-summary-details").getAttribute("aria-expanded")}|${await text(fp.getByTestId("mg-summary-details"))}|${(await cardState())[0]}`);
      await fp.getByTestId("mg-summary-details").click();
      sum.push(`${await fp.getByTestId("mg-summary-details").getAttribute("aria-expanded")}|${await text(fp.getByTestId("mg-summary-details"))}|${(await cardState())[0]}`);
    }
    check(JSON.stringify(sum) === JSON.stringify(["true|Hide details|true", "false|Details|false", "true|Hide details|true", "false|Details|false"]) && /Plan created · 2 action\(s\)/.test(await text(fp.getByTestId("mg-plan-bar"))) && (await text(fp.getByTestId("mg-budget"))) === "100 pts", `EVA-1.1: the map summary's Details now toggles (was open-only); plan and budget unchanged (${sum.join(", ")})`);

    // EVA panels: each has its own Collapse; repeated cycles; focus returns to the toggle.
    await fp.getByTestId("mg-start-eva").click();
    await settle(fp, 800);
    await fp.getByTestId("mg-start").click();
    await fp.keyboard.press("Enter"); // step 1 done
    await settle(fp);
    const snapshot = async () => [await text(fp.getByTestId("mg-step-label")), await text(fp.getByTestId("mg-step-counts")), await text(fp.getByTestId("mg-effort-left")), await text(fp.getByTestId("mg-plan-need")), await text(fp.getByTestId("mg-plan-timeline"))].join(" / ");
    const before = await snapshot();
    let panelsOk = true;
    for (const id of ["steps", "map", "caveats", "scenario", "log"]) {
      for (let n = 0; n < 3; n++) {
        await fp.getByTestId(`mg-toggle-${id}`).click();
        const opened = (await fp.getByTestId(`mg-toggle-${id}`).getAttribute("aria-expanded")) === "true";
        await fp.getByTestId("mg-panel-collapse").click();
        const closed = (await fp.getByTestId(`mg-toggle-${id}`).getAttribute("aria-expanded")) === "false" && (await fp.getByTestId("mg-panel-collapse").count()) === 0;
        if (!opened || !closed || (await fid()) !== `mg-toggle-${id}`) panelsOk = false;
      }
    }
    await fp.getByTestId("mg-more").click();
    await fp.getByTestId("mg-open-steps").click();
    const allOpen = (await fp.getByTestId("mg-toggle-steps").getAttribute("aria-expanded")) === "true";
    await fp.getByTestId("mg-more").click();
    const label = await text(fp.getByTestId("mg-open-steps"));
    await fp.getByTestId("mg-open-steps").click();
    const allClosed = (await fp.getByTestId("mg-toggle-steps").getAttribute("aria-expanded")) === "false";
    check(panelsOk && allOpen && label === "Hide all steps" && allClosed, "EVA-1.1: every EVA panel collapses from inside (×3 each, focus back on its toggle); More → All steps toggles");
    // Evidence sheet: header toggle is no longer covered; Escape works with focus outside; focus returns.
    const sheet = fp.getByTestId("mg-evidence-sheet");
    await fp.getByTestId("mg-open-evidence").click();
    const s1 = await sheet.isVisible();
    await fp.getByTestId("mg-open-evidence").click({ timeout: 3000 });
    const s2 = await sheet.isVisible();
    await fp.getByTestId("mg-more").click();
    await fp.getByText("Why this action? (evidence)").click();
    const s3 = await sheet.isVisible();
    await fp.mouse.click(300, 820); // outside the sheet
    await fp.keyboard.press("Escape");
    await settle(fp, 150);
    check(s1 && !s2 && s3 && !(await sheet.isVisible()) && (await fid()) === "mg-complete-step", "EVA-1.1: the Evidence sheet closes from its header toggle and with Escape from anywhere; focus returns to the primary action");
    check((await snapshot()) === before, `EVA-1.1: opening and closing panels changes no action, step, effort or plan (${before})`);

    // 2. Complete step 2, then reopen step 2 (Steps panel, with confirmation; Escape cancels).
    const states = () => fp.getByTestId("mg-steps").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
    await fp.getByTestId("mg-complete-step").click();
    await fp.getByTestId("mg-toggle-steps").click();
    await fp.getByTestId("mg-step-reopen-1").click();
    const fx1 = await text(fp.getByTestId("mg-reopen-effects"));
    const headingFocused = (await fp.evaluate(() => document.activeElement?.id)) === "mg-reopen-title";
    await fp.keyboard.press("Escape");
    const cancelled = (await fp.getByTestId("mg-reopen-confirm").count()) === 0 && JSON.stringify(await states()) === JSON.stringify(["done", "done", "current", "todo"]);
    await fp.getByTestId("mg-step-reopen-1").click();
    await fp.getByTestId("mg-reopen-yes").click();
    await settle(fp);
    check(
      /Step 2 becomes not done again\./.test(fx1) && /The current step becomes step 2\./.test(fx1) && headingFocused && cancelled && JSON.stringify(await states()) === JSON.stringify(["done", "current", "todo", "todo"]) && (await text(fp.getByTestId("mg-step-counts"))) === "1 done · 3 to do" && (await text(fp.getByTestId("mg-notice-text"))) === "Step 2 reopened.",
      "EVA-1.1: complete step 2, then reopen it: explained and confirmed (Escape cancels); step 2 is current again",
    );

    // 3. Complete steps 2 and 3, then reopen step 2 via read-only navigation (keyboard).
    await fp.getByTestId("mg-complete-step").click();
    await fp.getByTestId("mg-step-note-btn-1").click();
    await fp.getByTestId("mg-step-input").fill("Laminations (simulated)");
    await fp.getByTestId("mg-form-submit").click();
    await fp.getByTestId("mg-complete-step").click();
    await settle(fp);
    const s3a = JSON.stringify(await states());
    await fp.getByTestId("mg-view-prev").focus();
    await fp.keyboard.press("Enter");
    await fp.keyboard.press("Enter");
    await settle(fp, 150);
    const viewingLabel = await text(fp.getByTestId("mg-step-label"));
    const viewOnly = JSON.stringify(await states()) === s3a && /Viewing only: this does not change step 2/.test(await text(fp.getByTestId("mg-viewing"))) && (await text(fp.getByTestId("mg-back-current"))) === "Back to current step (4)";
    await fp.getByTestId("mg-reopen-viewed").click();
    await fp.getByTestId("mg-reopen-yes").focus();
    await fp.keyboard.press("Enter");
    await settle(fp);
    check(s3a === JSON.stringify(["done", "done", "done", "current"]) && viewingLabel === "Viewing step 2 of 4 · done" && viewOnly, "EVA-1.1: navigating to a previous step is read-only (clearly labelled) and distinct from reopening");
    check(
      JSON.stringify(await states()) === JSON.stringify(["done", "current", "done", "todo"]) && /Laminations \(simulated\)/.test(await text(fp.getByTestId("mg-current-note"))) && /Then: Analyse chemistry and mineralogy/.test(await text(fp.getByTestId("mg-next-step"))) && (await text(fp.getByTestId("mg-step-counts"))) === "2 done · 2 to do",
      "EVA-1.1: complete steps 2 and 3, reopen step 2 (keyboard): step 3 stays done; the note is kept; progress is consistent",
    );

    // 4–6. Reopen the final step after completion: plan change explained; effort released, then committed once.
    await fp.getByTestId("mg-complete-step").click(); // step 2
    await fp.getByTestId("mg-complete-step").click(); // step 4: action done
    await settle(fp);
    const done = [await text(fp.getByTestId("mg-effort-left")), await text(fp.getByTestId("mg-plan-need")), await text(fp.getByTestId("mg-effort-note"))];
    await pickSteps("task-abrasion-proximity");
    await fp.getByTestId("mg-step-reopen-3").click();
    const fx4 = await text(fp.getByTestId("mg-reopen-confirm"));
    await fp.getByTestId("mg-reopen-yes").click();
    await settle(fp);
    const reopened = [await text(fp.getByTestId("mg-effort-left")), await text(fp.getByTestId("mg-plan-need")), await text(fp.getByTestId("mg-effort-note")), await text(fp.locator("#mg-current-title")), await text(fp.getByTestId("mg-step-label")), await text(fp.getByTestId("mg-complete-step"))];
    check(
      done[0] === "60" && done[1] === "55" && /Committed so far: 40 of 100/.test(done[2]) &&
        /This changes your confirmed plan and committed effort\./.test(fx4) && /committed effort goes from 40 to 0 pts, and the remaining plan's estimate from 55 to 95 pts/.test(fx4),
      "EVA-1.1: reopening a completed action's final step explains the plan and effort change before confirmation",
    );
    await fp.getByTestId("mg-complete-step").click(); // finish again
    await settle(fp);
    const again = [await text(fp.getByTestId("mg-effort-left")), await text(fp.getByTestId("mg-plan-need")), await text(fp.getByTestId("mg-effort-note"))];
    check(
      reopened[0] === "100" && reopened[1] === "95" && /Committed so far: 0 of 100/.test(reopened[2]) && reopened[3] === "Abrade and analyse a rock" && reopened[4] === "Step 4 of 4" && reopened[5] === "Finish action" &&
        again[0] === "60" && again[1] === "55" && /Committed so far: 40 of 100/.test(again[2]),
      `EVA-1.1: committed vs estimated stays consistent: ${done.slice(0, 2)} → reopen ${reopened.slice(0, 2)} → finish again ${again.slice(0, 2)} (no double charge, no wrong refund)`,
    );

    // 7. Undo and replanning.
    await pickSteps("task-abrasion-proximity");
    await fp.getByTestId("mg-step-reopen-3").click();
    await fp.getByTestId("mg-reopen-yes").click();
    await fp.getByTestId("mg-undo-step").click();
    await settle(fp);
    const undoOk = (await text(fp.getByTestId("mg-effort-left"))) === "60" && (await text(fp.locator("#mg-current-title"))) === "Collect a core sample";
    await fp.getByTestId("mg-start").click();
    await fp.getByTestId("mg-toggle-scenario").click();
    await fp.getByTestId("mg-event-effort-cut").click();
    await settle(fp);
    await fp.getByTestId("mg-accept-replan").click(); // nothing fits the 10 pts left: coring dropped
    await settle(fp);
    await fp.getByTestId("mg-toggle-steps").click();
    await fp.getByTestId("mg-step-reopen-3").click();
    const fx7 = await text(fp.getByTestId("mg-reopen-effects"));
    await fp.getByTestId("mg-reopen-yes").click();
    await settle(fp);
    const tl = await fp.getByTestId("mg-plan-timeline").locator("li").evaluateAll((els) => els.map((e) => [e.getAttribute("data-status"), e.getAttribute("data-drop")]));
    check(undoOk && /Earlier replanning decisions are not changed: dropped actions stay dropped\./.test(fx7) && JSON.stringify(tl) === JSON.stringify([["active", ""], ["skipped", "replan"]]) && (await text(fp.getByTestId("mg-effort-left"))) === "50" && (await text(fp.getByTestId("mg-plan-need"))) === "40", "EVA-1.1: Undo reverts a reopen; after a replan, reopening keeps the dropped action dropped and reconciles effort");
    check(ferr.length === 0, `EVA-1.1: no page errors${ferr.length ? ` (${ferr[0]})` : ""}`);
    await fp.close();
  }

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
  await tp.getByTestId("mg-target-sim-target-c").click();
  await settle(tp, 400);
  await translate(tp);
  await tp.getByTestId("mg-summary-details").click();
  await tp.getByTestId("mg-summary-close").click();
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
  await tp.getByTestId("mg-pause").click();
  await translate(tp);
  await tp.getByTestId("mg-resume").click();
  await tp.getByTestId("mg-toggle-steps").click();
  await tp.getByTestId("mg-step-note-btn-1").click();
  await tp.getByTestId("mg-step-input").fill("Translated note test");
  await tp.getByTestId("mg-form-submit").click();
  await translate(tp);
  await tp.getByTestId("mg-complete-step").click();
  await tp.getByTestId("mg-undo-step").click();
  await tp.getByTestId("mg-complete-step").click();
  // EVA-1.1 controls under translation: collapse, view, reopen with confirmation, evidence toggle.
  await tp.getByTestId("mg-step-reopen-0").click();
  await translate(tp);
  await tp.getByTestId("mg-reopen-yes").click();
  await tp.getByTestId("mg-complete-step").click();
  await tp.getByTestId("mg-view-prev").click();
  await translate(tp);
  await tp.getByTestId("mg-back-current").click();
  await tp.getByTestId("mg-panel-collapse").click();
  await tp.getByTestId("mg-open-evidence").click();
  await translate(tp);
  await tp.getByTestId("mg-open-evidence").click();
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
  check(terr.length === 0 && (await tp.getByTestId("mg-plan-timeline").count()) === 1, `[translated] planning, map targets and summary, EVA steps (pause, note, undo, reopen, view, collapse) and replanning (keep, review, accept, undo) without page errors${terr.length ? ` (${terr[0]})` : ""}`);
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
  await rm.getByTestId("mg-review-back").click();
  await waitStill(rm);
  const before = await rm.getByTestId("mars-map").getAttribute("data-view-extent");
  await rm.getByTestId("mg-target-sim-target-a").click();
  await rm.waitForTimeout(150); // well under the 280 ms focus transition
  const rv = await viewOf(rm);
  const [rx] = rv.px(targetLonLat(TARGETS["sim-target-a"]));
  check((await rm.getByTestId("mars-map").getAttribute("data-motion")) === "reduced" && (await rm.getByTestId("mars-map").getAttribute("data-view-extent")) !== before && Math.abs(rx - (440 + 968) / 2) < 30, `MAP-1 reduced motion: the map focuses a target without a transition (target x ${Math.round(rx)})`);
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
  {
    const mapBox = await phone.getByTestId("mars-map").boundingBox();
    const list = await phone.getByTestId("mg-target-list").boundingBox();
    const y0 = await phone.evaluate(() => window.scrollY);
    await phone.getByTestId("mg-target-sim-target-b").tap().catch(() => phone.getByTestId("mg-target-sim-target-b").click());
    await settle(phone, 700);
    const sum = await phone.getByTestId("mg-target-summary").boundingBox();
    const y1 = await phone.evaluate(() => window.scrollY);
    check(list && list.y >= mapBox.y && list.x + list.width <= 390 && sum && sum.y >= mapBox.y + mapBox.height - 1 && y1 === y0 && (await hOverflow()) <= 0 && (await phone.getByTestId("mars-map").getAttribute("data-selected-id")) === "sim-target-b", `MAP-1 narrow screen: target buttons sit on the map; the summary opens below it without covering it or scrolling the page (scroll ${y0} → ${y1})`);
    await phone.getByTestId("mg-summary-close").click();
  }
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
  {
    await settle(phone, 300);
    const primaryAndPause = (await phoneIn(phone.getByTestId("mg-complete-step"))) && (await phoneIn(phone.getByTestId("mg-pause")));
    await phone.getByTestId("mg-more").click();
    await phone.getByTestId("mg-skip-step").click();
    await settle(phone, 300);
    const formBox = await phone.getByTestId("mg-form-skip-step").boundingBox();
    const formFits = Boolean(formBox && formBox.x >= 0 && formBox.x + formBox.width <= 390) && (await hOverflow()) <= 0;
    await phone.getByTestId("mg-form-cancel").click();
    await phone.getByTestId("mg-toggle-steps").click();
    await settle(phone, 300);
    const panelBox = await phone.getByTestId("mg-steps-panel").boundingBox();
    const panelFits = Boolean(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 390) && (await hOverflow()) <= 0;
    await phone.getByTestId("mg-toggle-steps").click();
    check(primaryAndPause && formFits && panelFits, "EVA-1 narrow screen: primary and Pause on screen; skip form and steps panel fit without horizontal overflow");
    // EVA-1.1 on a phone: reopen with confirmation, panel collapse.
    await phone.getByTestId("mg-complete-step").click();
    await phone.getByTestId("mg-toggle-steps").click();
    await phone.getByTestId("mg-step-reopen-0").tap().catch(() => phone.getByTestId("mg-step-reopen-0").click());
    await settle(phone, 300);
    const cBox = await phone.getByTestId("mg-reopen-confirm").boundingBox();
    const confirmFits = Boolean(cBox && cBox.x >= 0 && cBox.x + cBox.width <= 390) && (await hOverflow()) <= 0;
    await phone.getByTestId("mg-reopen-yes").click();
    await settle(phone, 300);
    const reopenedOnPhone = /Step 1 of 4/.test(await text(phone.getByTestId("mg-step-label")));
    await phone.getByTestId("mg-panel-collapse").click();
    check(confirmFits && reopenedOnPhone && (await phone.getByTestId("mg-toggle-steps").getAttribute("aria-expanded")) === "false", "EVA-1.1 narrow screen: reopen confirmation fits; the step reopens; the panel collapses from inside");
  }
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
  check(JSON.stringify(ptl) === JSON.stringify(["done", "skipped"]) && /Plan complete: 1 done, 1 dropped by replan/.test(await text(phone.getByTestId("mg-eva-progress"))) && /Remaining work ended/.test(await text(phone.getByTestId("mg-notice-text"))) && perr.length === 0, "MG-3: ending the remaining work keeps the completed action and marks the rest dropped by replan");
  await phone.close();
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} of ${checks} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll Mission Glass checks passed: ${checks} checks`);
