#!/usr/bin/env node
/**
 * Browser smoke test for the app shell and the NASA Mars Trek map wiring.
 *
 * Usage (the app must already be running, e.g. `npm run build && npm start`):
 *   npm run smoke                       # BASE_URL defaults to http://localhost:3000
 *   SMOKE_LIVE=1 npm run smoke          # also require real NASA tiles to load
 *   SMOKE_SCREENSHOT=out.png npm run smoke   # also writes out-mobile.png
 *
 * What it checks:
 *   1. Page renders header, investigation panel and an OpenLayers canvas.
 *   2. The map requests Mars Trek tiles whose URLs match the expected WMTS
 *      REST pattern, with TileMatrix/row/col inside the documented grid.
 *   3. The tile-status badge reflects what actually happened:
 *        - SMOKE_LIVE=1: at least one tile loaded and none failed.
 *        - otherwise: only reports counts (in a sandbox without access to
 *          trek.nasa.gov every tile fails and the badge must say so).
 *
 * No tile responses are faked: requests go to the real network.
 */
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LIVE = process.env.SMOKE_LIVE === "1";
const SCREENSHOT = process.env.SMOKE_SCREENSHOT;

const HIRISE_ID = "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd";
const MOLA_ID = "Mars_MGS_MOLA_ClrShade_merge_global_463m";

const TILE_URL_RE =
  /^https:\/\/trek\.nasa\.gov\/tiles\/Mars\/EQ\/([^/]+)\/1\.0\.0\/default\/default028mm\/(\d+)\/(\d+)\/(\d+)\.(jpg|png)$/;

const failures = [];
const check = (condition, message) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${message}`);
  if (!condition) failures.push(message);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const tileRequests = [];
  page.on("request", (req) => {
    if (req.url().includes("trek.nasa.gov")) tileRequests.push(req.url());
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  check(
    (await page.getByRole("heading", { name: "Mars Discovery Intelligence" }).count()) === 1,
    "header renders",
  );
  check(
    (await page.locator("#workspace-heading").count()) === 1,
    "investigation workspace renders",
  );

  await page.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 15_000 });
  check(true, "OpenLayers canvas mounted");

  // Give tiles time to load or fail.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="tile-status"]');
      if (!el) return false;
      return Number(el.dataset.loaded) + Number(el.dataset.failed) >= 4;
    },
    undefined,
    { timeout: 30_000 },
  ).catch(() => {});

  check(tileRequests.length > 0, `map requested ${tileRequests.length} Trek tile URLs`);

  const badUrls = [];
  for (const url of tileRequests) {
    const m = TILE_URL_RE.exec(url);
    if (!m) {
      badUrls.push(url);
      continue;
    }
    const [z, row, col] = [m[2], m[3], m[4]].map(Number);
    // default028mm grid: 2^(z+1) columns x 2^z rows.
    if (col >= 2 ** (z + 1) || row >= 2 ** z) badUrls.push(url);
  }
  check(badUrls.length === 0, "all tile URLs match the WMTS REST pattern and grid bounds");
  if (badUrls.length) console.log("  e.g.", badUrls.slice(0, 3));
  if (tileRequests.length) console.log("  sample:", tileRequests[0]);

  const status = page.getByTestId("tile-status");
  const loaded = Number(await status.getAttribute("data-loaded"));
  const failed = Number(await status.getAttribute("data-failed"));
  const statusText = (await status.textContent())?.trim();
  console.log(`INFO  tile status: loaded=${loaded} failed=${failed} text="${statusText}"`);

  if (LIVE) {
    check(loaded > 0, "SMOKE_LIVE: real NASA tiles loaded");
    check(failed === 0, "SMOKE_LIVE: no tile errors");
  } else if (loaded === 0 && failed > 0) {
    check(
      /unavailable/i.test(statusText ?? ""),
      "badge reports NASA tiles unavailable when every tile fails",
    );
  }

  if (SCREENSHOT) {
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: SCREENSHOT });
    console.log(`INFO  desktop screenshot saved to ${SCREENSHOT}`);
  }

  // Pointer readout uses Mars lat/lon formatting.
  const box = await page.getByTestId("mars-map").boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const readout = await page
      .locator(".font-mono", { hasText: /° [NS], .*° [EW]$/ })
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => null);
    check(Boolean(readout), `pointer coordinate readout: ${readout ?? "(none)"}`);
  }

  const scale = await page.locator(".ol-scale-line-inner").textContent().catch(() => null);
  check(Boolean(scale), `scale line renders: ${scale ?? "(none)"}`);

  const unexpectedErrors = consoleErrors.filter(
    // Failed tile fetches surface as resource errors; they are covered above.
    (text) => !/Failed to load resource|ERR_TUNNEL|net::/i.test(text),
  );
  check(unexpectedErrors.length === 0, "no unexpected console errors");
  if (unexpectedErrors.length) console.log(unexpectedErrors);

  // UX-1: guided five-step workflow.
  await uxGuidedChecks(page);

  // Investigation workflow: snapshot → evidence → recommendation → reveal.
  const summary = page.getByTestId("snapshot-summary");
  const summaryAtDefault = (await summary.textContent())?.trim() ?? "";
  console.log(`INFO  ${summaryAtDefault}`);
  check(/withheld/.test(summaryAtDefault), "snapshot summary shows withheld later records");
  check((await page.getByText("Observed", { exact: false }).count()) > 0, "observations carry OBSERVED badges");
  check((await page.getByText("Simulated", { exact: false }).count()) > 0, "tasks/costs carry SIMULATED badges");
  const recommendation = page.getByTestId("recommendation");
  check((await recommendation.count()) === 1, "recommendation card renders");
  const topAtDefault = (await recommendation.locator("p.text-base").textContent())?.trim();
  console.log(`INFO  top task at default snapshot: ${topAtDefault}`);
  check((await page.getByTestId("comparison-table").locator("tbody tr").count()) > 0, "comparison table has ranked tasks");

  // M3: regional context, Not Evaluated criteria, curated links, constraints.
  const regionalSim = page.locator('[data-record-id="obs-upper-etched-unit-mapping"]');
  check(
    (await regionalSim.getAttribute("data-relevance")) === "regional-context",
    "SIM 3464 unit Nue is shown as regional context, not a margin-unit observation",
  );
  check(
    (await page.getByTestId("comparison-table").getByText("NE").count()) > 0,
    "comparison table shows Not Evaluated (NE) for unapproved curated criteria",
  );
  check(
    (await page.getByTestId("basis-hypothesis-discrimination").textContent())?.includes("Not in ranking basis") ?? false,
    "hypothesis discrimination is excluded from the ranking basis with a reason",
  );
  check(
    (await page.getByTestId("task-gap-links").first().getByText("AI draft · pending review").count()) > 0,
    "task-gap links show their rationale and pending-review status",
  );
  await goToStep(page, "decision");
  const budget = page.getByLabel("Investigation effort budget");
  await budget.fill("30");
  const infeasibleText = (await page.getByTestId("infeasible").textContent()) ?? "";
  check(/Needs 40 points of Investigation effort; simulated budget is 30/.test(infeasibleText), "lower budget excludes tasks with a stated reason");
  const topAt30 = (await page.getByTestId("top-task").textContent())?.trim();
  console.log(`INFO  top task with budget 30: ${topAt30}`);
  check(topAt30 === "Stand-off survey of margin outcrops", "re-ranking under the budget constraint is deterministic");
  await page.getByRole("button", { name: "Reset constraints" }).click();

  // RI-1: reviewed vs provisional rankings and the review registry.
  await goToStep(page, "result");
  const reviewedStatus = page.getByTestId("reviewed-status");
  check((await reviewedStatus.getAttribute("data-state")) === "unavailable", "reviewed ranking is unavailable (no relationships approved)");
  check(/Reviewed ranking unavailable/.test((await reviewedStatus.textContent()) ?? ""), "reviewed panel states that no reviewed ranking exists");
  const provisionalBox = page.getByTestId("provisional-ranking");
  check((await provisionalBox.getAttribute("open")) === null, "provisional exploratory ranking is collapsed by default");
  await provisionalBox.locator("summary").first().click();
  const pivotalIds = await page.getByTestId("pivotal-inputs").locator("[data-review-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-review-id")));
  check(
    JSON.stringify(pivotalIds) ===
      JSON.stringify([
        "relevance:gap-lake-connection",
        "task-gap:task-abrasion-proximity->gap-no-in-situ-data",
        "task-gap:task-abrasion-proximity->gap-formation-unknown",
        "task-gap:task-abrasion-proximity->gap-lake-connection",
      ]),
    `provisional ranking lists the 4 pivotal unreviewed inputs (got ${pivotalIds.length})`,
  );
  check(/Provisional · not scientifically validated/.test((await page.getByTestId("recommendation").textContent()) ?? ""), "provisional top task is labelled as not validated");
  await provisionalBox.locator("summary").first().click();
  const registryItems = page.getByTestId("review-registry").locator("[data-review-id]");
  const registryStatuses = await registryItems.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(registryStatuses.length === 28 && registryStatuses.every((x) => x === "pending"), `review registry shows 28 visible relationships, all pending (got ${registryStatuses.length})`);

  await page.getByRole("button", { name: "Reveal later evidence" }).click();
  check((await page.getByTestId("reveal").count()) === 1, "reveal shows later evidence on request");

  await goToStep(page, "mission");
  await page.getByRole("button", { name: "All evidence" }).click();
  const summaryAll = (await summary.textContent())?.trim() ?? "";
  check(/0 later record\(s\) withheld/.test(summaryAll), "'All evidence' snapshot withholds nothing");
  check((await registryItems.count()) === 50, "review registry shows all 50 relationships with all evidence");
  check((await page.getByTestId("reveal").count()) === 0, "reveal re-hides when the snapshot date changes");
  await page.getByRole("button", { name: "Scenario default" }).click();

  // Layer controls request the expected Trek products.
  const requestsFor = (layerId) =>
    tileRequests.filter((url) => url.includes(`/EQ/${layerId}/`)).length;

  const hiriseBefore = requestsFor(HIRISE_ID);
  await page.getByLabel(/HiRISE, Jezero Mosaic/).check();
  await page.waitForTimeout(2_000);
  check(
    requestsFor(HIRISE_ID) > hiriseBefore,
    `HiRISE overlay toggle requests HiRISE tiles (${requestsFor(HIRISE_ID) - hiriseBefore})`,
  );

  await page.getByRole("button", { name: "Global" }).click();
  await page.locator("select").selectOption({ label: "MGS MOLA, Global Color Hillshade" });
  await page.waitForTimeout(2_000);
  check(requestsFor(MOLA_ID) > 0, `MOLA basemap requests MOLA tiles (${requestsFor(MOLA_ID)})`);

  // UX-0 regression: no-feasible-task states, clean and under simulated page translation.
  await checkInfeasibleStates(browser, false);
  await checkInfeasibleStates(browser, true);

  // Mobile layout: map stacked above the panel, no horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 0, `no horizontal overflow at 390px (overflow=${overflow}px)`);

  if (SCREENSHOT) {
    const mobilePath = SCREENSHOT.replace(/\.png$/, "") + "-mobile.png";
    await page.screenshot({ path: mobilePath });
    console.log(`INFO  mobile screenshot saved to ${mobilePath}`);
  }
} finally {
  await browser.close();
}

async function goToStep(page, id) {
  await page.getByTestId(`step-${id}`).click();
  await page.waitForTimeout(150);
}

async function uxGuidedChecks(page) {
  const STEP_IDS = ["mission", "evidence", "unknowns", "decision", "result"];
  const visiblePanels = () =>
    page.evaluate(() => [...document.querySelectorAll("[data-step]")].filter((e) => !e.hidden).map((e) => e.dataset.step));
  const focusedId = () => page.evaluate(() => document.activeElement?.id ?? "");

  const stepButtons = page.getByRole("navigation", { name: "Investigation steps" }).getByRole("button");
  check((await stepButtons.count()) === 5, "UX-1: five-step navigation indicator shows 5 steps");
  check((await page.getByTestId("step-mission").getAttribute("aria-current")) === "step", "UX-1: Mission is the current step on load");
  check(JSON.stringify(await visiblePanels()) === '["mission"]', "UX-1: only the Mission panel is shown on load");
  check(await page.getByTestId("mission-question").isVisible(), "UX-1: Mission step states the mission question");
  check(await page.getByTestId("mission-caveats").isVisible(), "UX-1: Mission step lists the simulation and review caveats");

  // Mouse: Next / Back.
  await page.getByTestId("step-next").click();
  check(JSON.stringify(await visiblePanels()) === '["evidence"]', "UX-1: Next moves to Evidence");
  check((await focusedId()) === "step-heading-evidence", "UX-1: focus moves to the Evidence heading");
  await page.getByTestId("step-back").click();
  check(JSON.stringify(await visiblePanels()) === '["mission"]' && (await focusedId()) === "step-heading-mission", "UX-1: Back returns to Mission and focuses its heading");

  // Keyboard: stepper buttons and Next via Enter.
  await page.getByTestId("step-unknowns").focus();
  await page.keyboard.press("Enter");
  check(JSON.stringify(await visiblePanels()) === '["unknowns"]' && (await focusedId()) === "step-heading-unknowns", "UX-1: keyboard Enter on a step opens it and focuses its heading");
  await page.getByTestId("step-next").focus();
  await page.keyboard.press("Enter");
  check(JSON.stringify(await visiblePanels()) === '["decision"]', "UX-1: keyboard Enter on Next moves to Decision");

  // Integrity bar and map stay visible on every step.
  let barEverywhere = true;
  let mapEverywhere = true;
  for (const id of STEP_IDS) {
    await goToStep(page, id);
    barEverywhere &&= await page.getByTestId("integrity-bar").isVisible();
    mapEverywhere &&= await page.getByTestId("mars-map").isVisible();
  }
  check(barEverywhere, "UX-1: scientific integrity bar is visible on all five steps");
  check(mapEverywhere, "UX-1: NASA map stays visible on all five steps (desktop)");
  const bar = (await page.getByTestId("integrity-bar").textContent()) ?? "";
  check(/Reviewed ranking: unavailable/.test(bar) && /not a NASA plan or endorsement/.test(bar) && /4 feasible task\(s\) excluded pending review/.test(bar), "UX-1: integrity bar shows reviewed status, NASA disclaimer and excluded-task count");

  // Result reachable directly; excluded count shown.
  await goToStep(page, "mission");
  await page.getByTestId("step-result").click();
  check(await page.getByTestId("reviewed-status").isVisible(), "UX-1: Result (reviewed ranking status) is one click away from Mission");
  check(/incomplete: 4$/.test(((await page.getByTestId("excluded-count").textContent()) ?? "").trim()), "UX-1: Result shows 4 feasible tasks excluded due to incomplete review");

  // State persists across steps.
  await goToStep(page, "decision");
  await page.getByLabel("Investigation effort budget").fill("45");
  await page.getByLabel("Scientific priority weight").fill("4");
  await goToStep(page, "mission");
  await goToStep(page, "result");
  await goToStep(page, "decision");
  const kept = (await page.getByLabel("Investigation effort budget").inputValue()) === "45" && (await page.getByLabel("Scientific priority weight").inputValue()) === "4";
  check(kept, "UX-1: budget and weight selections persist across steps");
  await page.getByRole("button", { name: "Reset constraints" }).click();
  await page.getByRole("button", { name: "Reset weights" }).click();

  const bodyText = (await page.locator("body").textContent()) ?? "";
  check(!/NASA recommends|recommended by NASA|endorsed by NASA/i.test(bodyText), "UX-1: no claim of NASA endorsement anywhere on the page");
  await goToStep(page, "mission");
}

/**
 * Simulates browser page translation (e.g. Chrome/Google Translate): every
 * text node outside translate="no" is replaced by <font><font>text</font></font>.
 * React-owned text nodes are thereby detached, which is what caused the
 * "removeChild … not a child of this node" crash found in M3 manual testing.
 */
async function simulateTranslation(page) {
  await page.evaluate(() => {
    const skip = (n) => n.parentElement?.closest('[translate="no"], script, style');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() && !skip(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const outer = document.createElement("font");
      const inner = document.createElement("font");
      inner.textContent = n.nodeValue;
      outer.appendChild(inner);
      n.parentNode.replaceChild(outer, n);
    }
  });
}

async function checkInfeasibleStates(browser, translated) {
  const tag = translated ? "[translated]" : "[clean]";
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  // UX-1: only the current step is visible; wait for the step navigation, then open Decision.
  await page.waitForSelector('[data-testid="step-mission"]', { timeout: 15_000 });
  await page.waitForTimeout(800);
  if (translated) await simulateTranslation(page);
  await goToStep(page, "decision");
  const text = async (id) => ((await page.getByTestId(id).textContent().catch(() => null)) ?? "").trim();
  const platform = (label) => page.locator("label", { hasText: label }).locator("input");

  for (const label of ["Orbital imaging available", "Rover operations available", "Earth laboratories"]) {
    await platform(label).click();
  }
  await page.waitForTimeout(300);
  check(errors.length === 0, `${tag} all platforms disabled: no page error${errors.length ? ` (${errors[0]})` : ""}`);
  check(/No task is feasible under the current constraints/.test(await text("not-ranked")), `${tag} all platforms disabled: explains that no task is feasible`);
  check(/not applicable/.test(await text("basis-gap-coverage")), `${tag} all platforms disabled: ranking basis shown as not applicable`);
  check(!/\*/.test((await page.getByTestId("comparison-table").locator("thead").textContent()) ?? ""), `${tag} all platforms disabled: no 'not in basis' markers`);
  check(/Reviewed ranking unavailable/.test(await text("reviewed-status")), `${tag} all platforms disabled: reviewed ranking still reported as unavailable`);

  await page.getByRole("button", { name: "Reset constraints" }).click();
  await page.waitForTimeout(300);
  check((await text("top-task")) === "Abrade a margin rock and analyse it up close", `${tag} reset restores the default recommendation`);

  await page.getByLabel("Investigation effort budget").fill("0");
  await page.waitForTimeout(300);
  check(errors.length === 0, `${tag} budget 0: no page error${errors.length ? ` (${errors[0]})` : ""}`);
  check(/No task is feasible/.test(await text("no-recommendation")), `${tag} budget 0: no-recommendation message shown`);

  // Values must refresh, not stay stale, after translation replaced text nodes.
  await page.getByLabel("Investigation effort budget").fill("30");
  await page.waitForTimeout(300);
  check((await text("top-task")) === "Stand-off survey of margin outcrops", `${tag} budget 30: top task updates`);
  check(/stays #1 in \d+ of \d+ runs/.test(await text("stability")), `${tag} budget 30: stability text present`);
  await page.getByLabel("Resource feasibility weight").fill("5");
  await page.waitForTimeout(300);
  const weightLabel = await page
    .locator("label", { hasText: "Resource feasibility" })
    .locator("span.font-mono", { hasText: /^w\d+$/ })
    .first()
    .textContent();
  check(weightLabel?.trim() === "w5", `${tag} weight label updates to w5 (got ${weightLabel?.trim()})`);
  for (const id of ["mission", "evidence", "unknowns", "decision", "result", "mission"]) await goToStep(page, id);
  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  check(focused === "step-heading-mission", `${tag} navigating all five steps works and focuses the step heading`);
  check(errors.length === 0, `${tag} no page errors overall${errors.length ? ` (${errors.join(" | ")})` : ""}`);
  await page.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke checks passed");
