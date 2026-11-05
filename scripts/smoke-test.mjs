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
  const budget = page.getByLabel("Investigation effort budget");
  await budget.fill("30");
  const infeasibleText = (await page.getByTestId("infeasible").textContent()) ?? "";
  check(/Needs 40 points of Investigation effort; simulated budget is 30/.test(infeasibleText), "lower budget excludes tasks with a stated reason");
  const topAt30 = (await page.getByTestId("top-task").textContent())?.trim();
  console.log(`INFO  top task with budget 30: ${topAt30}`);
  check(topAt30 === "Stand-off survey of margin outcrops", "re-ranking under the budget constraint is deterministic");
  await page.getByRole("button", { name: "Reset constraints" }).click();

  await page.getByRole("button", { name: "Reveal later evidence" }).click();
  check((await page.getByTestId("reveal").count()) === 1, "reveal shows later evidence on request");

  await page.getByRole("button", { name: "All evidence" }).click();
  const summaryAll = (await summary.textContent())?.trim() ?? "";
  check(/0 later record\(s\) withheld/.test(summaryAll), "'All evidence' snapshot withholds nothing");
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

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke checks passed");
