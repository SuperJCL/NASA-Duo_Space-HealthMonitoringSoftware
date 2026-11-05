#!/usr/bin/env node
/**
 * Browser smoke test for the MF-1 map-first mission explorer.
 *
 * Usage (the app must already be running, e.g. `npm run build && npm start`):
 *   npm run smoke                       # BASE_URL defaults to http://localhost:3000
 *   SMOKE_LIVE=1 npm run smoke          # also require real NASA tiles to load (+2 checks)
 *   SMOKE_SCREENSHOT=out.png npm run smoke   # also writes out-mobile.png
 *
 * Every "PASS"/"FAIL" line is one executed check (an assertion). "INFO" lines
 * are logs only. The summary prints how many checks ran; SMOKE_LIVE=1 adds
 * exactly two tile checks, which is why a live run reports two more.
 *
 * No responses are faked: tile requests go to the real network.
 */
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LIVE = process.env.SMOKE_LIVE === "1";
const SCREENSHOT = process.env.SMOKE_SCREENSHOT;

const HIRISE_ID = "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd";
const MOLA_ID = "Mars_MGS_MOLA_ClrShade_merge_global_463m";
const TILE_URL_RE = /^https:\/\/trek\.nasa\.gov\/tiles\/Mars\/EQ\/([^/]+)\/1\.0\.0\/default\/default028mm\/(\d+)\/(\d+)\/(\d+)\.(jpg|png)$/;

const failures = [];
let checks = 0;
const check = (condition, message) => {
  checks++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${message}`);
  if (!condition) failures.push(message);
};
const settle = (page, ms = 300) => page.waitForTimeout(ms);
const text = async (locator) => ((await locator.textContent().catch(() => null)) ?? "").trim();

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
  check((await page.getByRole("heading", { name: "Mars Discovery Intelligence" }).count()) === 1, "header renders");
  check((await page.locator("#workspace-heading").count()) === 1, "mission workspace renders");

  await page.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 15_000 });
  check(true, "OpenLayers canvas mounted");
  await page
    .waitForFunction(() => {
      const el = document.querySelector('[data-testid="tile-status"]');
      return el ? Number(el.dataset.loaded) + Number(el.dataset.failed) >= 4 : false;
    }, undefined, { timeout: 30_000 })
    .catch(() => {});

  // ── NASA tiles (unchanged since M1b) ──
  check(tileRequests.length > 0, `map requested ${tileRequests.length} Trek tile URLs`);
  const badUrls = tileRequests.filter((url) => {
    const m = TILE_URL_RE.exec(url);
    if (!m) return true;
    const [z, row, col] = [m[2], m[3], m[4]].map(Number);
    return col >= 2 ** (z + 1) || row >= 2 ** z;
  });
  check(badUrls.length === 0, "all tile URLs match the WMTS REST pattern and grid bounds");
  if (badUrls.length) console.log("  e.g.", badUrls.slice(0, 3));
  const status = page.getByTestId("tile-status");
  const loaded = Number(await status.getAttribute("data-loaded"));
  const failed = Number(await status.getAttribute("data-failed"));
  console.log(`INFO  tile status: loaded=${loaded} failed=${failed}`);
  if (LIVE) {
    check(loaded > 0, "SMOKE_LIVE: real NASA tiles loaded");
    check(failed === 0, "SMOKE_LIVE: no tile errors");
  } else if (loaded === 0 && failed > 0) {
    check(/unavailable/i.test(await text(status)), "badge reports NASA tiles unavailable when every tile fails");
  }
  if (SCREENSHOT) {
    await settle(page, 1_500);
    await page.screenshot({ path: SCREENSHOT });
    console.log(`INFO  desktop screenshot saved to ${SCREENSHOT}`);
  }
  const box = await page.getByTestId("mars-map").boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const readout = await page.locator(".font-mono", { hasText: /° [NS], .*° [EW]$/ }).first().textContent({ timeout: 5_000 }).catch(() => null);
    check(Boolean(readout), `pointer coordinate readout: ${readout ?? "(none)"}`);
  }
  check(Boolean(await page.locator(".ol-scale-line-inner").textContent().catch(() => null)), "scale line renders");

  // ── Map-first default interface (no wizard) ──
  check((await page.getByRole("navigation", { name: "Investigation steps" }).count()) === 0 && (await page.locator("[data-step]").count()) === 0, "MF-1: no five-step wizard in the default interface");
  check(await page.getByTestId("mars-map").isVisible(), "MF-1: interactive map is visible on load");
  check(/Simulated mission · 2026/.test(await text(page.getByTestId("mission-mode"))), "MF-1: objective strip shows the simulated 2026 mission");
  const bar = await text(page.getByTestId("integrity-bar"));
  check(/through 2025-05-06 \(not all NASA data\)/.test(bar), "MF-1: evidence label is the latest in this dataset, not all NASA data");
  check(/Reviewed ranking: unavailable/.test(bar) && /4 feasible task\(s\) excluded pending review/.test(bar) && /50 relationship\(s\) awaiting expert review/.test(bar), "MF-1: integrity status shows reviewed ranking unavailable, 4 excluded, 50 awaiting review");
  check(/not a NASA mission, not a real astronaut mission and not live telemetry/.test(await text(page.getByTestId("mission-disclaimer"))), "MF-1: disclaimer: not a NASA or astronaut mission, not live telemetry");
  const actionCards = page.getByTestId("action-strip").locator("[data-testid^='action-task-']");
  check((await actionCards.count()) === 4 && (await actionCards.first().isVisible()), "MF-1: four simulated actions are visible without navigating");
  const cardTexts = await actionCards.allTextContents();
  check(cardTexts.every((t) => /Simulated action/.test(t) && /Cost: \d+ simulated points/.test(t) && /Feasible: needs/.test(t) && /Provisional: \d+ scientific relationship/.test(t)), "MF-1: each action shows platform, simulated cost, feasibility and provisional status");
  check(/Rover/.test(cardTexts[0]) && /Earth laboratory/.test(cardTexts[2]) && /Orbiter/.test(cardTexts[3]), "MF-1: actions show their real model platforms (rover, Earth laboratory, orbiter)");
  check(cardTexts.every((t) => !/#\d|rank/i.test(t)), "MF-1: action cards show no provisional rank (RI-1: provisional ranking stays collapsed)");
  check(/not drawn/.test(await text(page.getByTestId("no-task-markers"))), "MF-1: legend states that simulated actions are not drawn on the map");
  const optionValues = await page.getByTestId("feature-select").locator("option").evaluateAll((os) => os.map((o) => o.value));
  check(!optionValues.some((v) => v.startsWith("task-")), "MF-1: no task has a map feature (no invented task coordinates)");
  check(optionValues.filter((v) => v.startsWith("sample-")).length === 3 && optionValues.filter((v) => v.startsWith("traverse-")).length === 332 && optionValues.includes("rover-last-position-in-dataset") && optionValues.includes("jezero-crater-centre"), "MF-1: map lists 3 sample sites, 332 traverse drives, the last position and the crater centre");
  check(/332 drives, sols 14–1176/.test(await text(page.getByTestId("layer-traverse"))) && /3 site\(s\)/.test(await text(page.getByTestId("layer-samples"))), "MF-1: legend shows traverse and sample counts");

  // ── Geographic feature selection ──
  const select = page.getByTestId("feature-select");
  const card = page.getByTestId("feature-card");
  await select.selectOption("sample-lefroy-bay");
  await settle(page, 600);
  check((await card.getAttribute("data-feature-id")) === "sample-lefroy-bay" && (await text(page.getByTestId("feature-name"))) === "Lefroy Bay", "MF-1: selecting a sample site opens its context card");
  const cardText = await text(card);
  check(/Verified historical data · Historical rover sample site/.test(cardText) && /M2020-949-26 Lefroy Bay/.test(cardText) && /18\.48867° N, 77\.34705° E/.test(cardText) && /2023-10-13/.test(cardText) && /sol 949/.test(cardText), "MF-1: sample card shows type, designation, location, coring date and sol");
  check((await page.getByTestId("feature-convention").getAttribute("data-basis")) === "inferred-cross-validation" && /inferred by cross-validation/.test(cardText), "MF-1: sample card marks its coordinates as inferred by cross-validation");
  check((await card.locator("a").first().getAttribute("href"))?.includes("initial_reports_volume4.pdf") ?? false, "MF-1: sample card links its PDS source");
  await card.getByRole("button", { name: "Close feature details" }).click();
  check((await card.count()) === 0, "MF-1: context card closes");
  await page.getByTestId("mars-map").click(); // the map is centred on Lefroy Bay
  await settle(page, 700);
  check((await card.getAttribute("data-feature-id").catch(() => null)) === "sample-lefroy-bay", "MF-1: clicking the marker on the map selects it");

  // Evidence on demand from the card.
  await page.getByTestId("feature-evidence").click();
  await settle(page);
  const evidenceDrawer = page.getByTestId("evidence-drawer");
  check(await evidenceDrawer.isVisible(), "MF-1: related evidence opens the evidence drawer");
  check((await evidenceDrawer.locator('[data-record-id="obs-lefroy-bay-hydrated-silica"]').getAttribute("data-highlight")) === "true", "MF-1: the related observation is highlighted");
  check((await page.evaluate(() => document.activeElement?.id)) === "evidence-drawer-title", "MF-1: focus moves to the drawer heading");
  await page.keyboard.press("Escape");
  await settle(page);
  check(!(await evidenceDrawer.isVisible()) && (await card.getAttribute("data-feature-id")) === "sample-lefroy-bay", "MF-1: Escape closes the drawer and the selection persists");
  check((await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "feature-evidence", "MF-1: focus returns to the opener after closing the drawer");

  // Traverse interaction.
  await select.selectOption({ label: "Drive on sol 909" });
  await settle(page, 600);
  const traverseCard = await text(card);
  check(/Perseverance drive on sol 909/.test(traverseCard) && /Historical rover traverse/.test(traverseCard) && /473\.9 m \(source attribute\)/.test(traverseCard) && /Not stated by the source/.test(traverseCard), "MF-1: traverse drive card shows sol, source length and no invented date");
  await page.getByTestId("layer-traverse").locator("input").uncheck();
  await settle(page);
  check((await card.count()) === 0, "MF-1: hiding the traverse layer clears a selected traverse drive");
  await select.selectOption({ label: "Drive on sol 909" });
  await settle(page, 400);
  check((await page.getByTestId("layer-traverse").locator("input").isChecked()) && (await card.count()) === 1, "MF-1: selecting a drive from the list re-enables its layer");

  // Layer toggles.
  const extents = page.getByTestId("layer-extents").locator("input");
  check(!(await extents.isChecked()), "MF-1: imagery/DTM extent overlay is off by default");
  await extents.check();
  await select.selectOption("extent-ctx-dtm");
  await settle(page, 400);
  check(/Elevation-data coverage/.test(await text(card)) && /Download only/.test(await text(card)), "MF-1: extent overlay toggles on and its card says the DTM is download-only");
  await extents.uncheck();
  check((await card.count()) === 0, "MF-1: hiding the extents clears the selected extent");
  const hiriseBefore = tileRequests.filter((u) => u.includes(`/EQ/${HIRISE_ID}/`)).length;
  await page.getByLabel(/HiRISE, Jezero Mosaic/).check();
  await settle(page, 2_000);
  check(tileRequests.filter((u) => u.includes(`/EQ/${HIRISE_ID}/`)).length > hiriseBefore, "HiRISE imagery toggle requests HiRISE tiles");
  await page.getByLabel(/HiRISE, Jezero Mosaic/).uncheck();

  // Last-position warning.
  await select.selectOption("rover-last-position-in-dataset");
  await settle(page, 600);
  const warning = await text(page.getByTestId("feature-warning"));
  check(/not live telemetry/.test(warning) && /not the rover’s current position/.test(warning), "MF-1: last-position card warns it is historical, not live or current");
  check(/End of the sol 1176 drive/.test(await text(card)), "MF-1: last-position card identifies the final sol in the dataset");

  // ── Simulated actions ──
  const abrasion = page.getByTestId("action-task-abrasion-proximity");
  await abrasion.click();
  const detail = page.getByTestId("action-detail");
  check((await abrasion.getAttribute("aria-pressed")) === "true" && (await detail.isVisible()), "MF-1: selecting an action opens its details");
  const detailText = await text(detail);
  check(/Simulated future action · not a NASA operation/.test(detailText) && /None assigned/.test(detailText), "MF-1: action details say simulated, not a NASA operation, with no location");
  check(/Reviewed ranking unavailable/.test(detailText) && /research task R4/.test(detailText), "MF-1: essential limitations (reviewed ranking, 2026 reassessment) sit next to the action");
  check((await page.getByTestId("action-provisional").getAttribute("open")) === null, "MF-1: provisional rank is collapsed by default");
  await page.getByTestId("action-provisional").locator("summary").click();
  check(/Provisional rank 1 of 4.*Not validated/.test(await text(page.getByTestId("action-provisional"))), "MF-1: provisional rank is labelled not validated when inspected");
  check((await page.getByTestId("action-chosen").count()) === 0, "MF-1: selecting an action does not choose or execute it");
  await page.getByTestId("action-choose").click();
  check(/Nothing is executed/.test(await text(page.getByTestId("action-chosen"))) && /Your simulated choice: Abrade a margin rock/.test(await text(page.getByTestId("chosen-summary"))), "MF-1: choosing records a simulated decision only");

  // Budget-dependent feasibility.
  await page.getByLabel("Investigation effort budget").fill("30");
  await settle(page);
  check((await abrasion.getAttribute("data-feasible")) === "false" && /Not feasible: Needs 40 points of Investigation effort; simulated budget is 30/.test(await text(abrasion)), "MF-1: budget 30 makes the 40-point action infeasible with the stated reason");
  check((await page.getByTestId("action-task-standoff-survey").getAttribute("data-feasible")) === "true", "MF-1: the 15-point action stays feasible at budget 30");
  check(/not feasible under the current simulated constraints/.test(await text(detail)), "MF-1: a chosen action that becomes infeasible is flagged");

  // ── Drawers and ranking integrity ──
  await page.getByTestId("open-advanced").click();
  await settle(page);
  const adv = page.getByTestId("advanced-drawer");
  check(await adv.isVisible(), "MF-1: advanced workspace drawer opens");
  check((await page.getByTestId("reviewed-status").getAttribute("data-state")) === "unavailable", "RI-1: reviewed ranking unavailable (no relationships approved)");
  const provisionalBox = page.getByTestId("provisional-ranking");
  check((await provisionalBox.getAttribute("open")) === null, "RI-1: provisional exploratory ranking collapsed by default");
  check((await text(page.getByTestId("top-task"))) === "Stand-off survey of margin outcrops", "budget 30 re-ranks deterministically (provisional top: stand-off survey)");
  await page.getByLabel("Investigation effort budget").fill("100");
  await settle(page);
  await provisionalBox.locator("summary").first().click();
  const pivotalIds = await page.getByTestId("pivotal-inputs").locator("[data-review-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-review-id")));
  check(
    JSON.stringify(pivotalIds) === JSON.stringify(["relevance:gap-lake-connection", "task-gap:task-abrasion-proximity->gap-formation-unknown", "task-gap:task-abrasion-proximity->gap-lake-connection"]),
    `RI-1: present-day provisional ranking lists 3 pivotal unreviewed inputs (got ${pivotalIds.length})`,
  );
  check(/Provisional · not scientifically validated/.test(await text(page.getByTestId("recommendation"))), "RI-1: provisional top task labelled not validated");
  check(/Verified historical sample locations are displayed/.test(await text(page.getByTestId("recommendation"))) && !/sample markers are drawn/.test(await text(page.getByTestId("recommendation"))), "MF-1: updated limitation text shown; stale sample-marker text gone");
  await provisionalBox.locator("summary").first().click();
  check((await page.getByTestId("comparison-table").getByText("NE").count()) > 0, "M3: comparison shows Not Evaluated for unapproved curated criteria");
  check(/Not in ranking basis/.test(await text(page.getByTestId("basis-hypothesis-discrimination"))), "M3: hypothesis discrimination excluded from the ranking basis with a reason");
  check((await page.getByTestId("task-gap-links").first().getByText("AI draft · pending review").count()) > 0, "M3: task-gap links show pending-review status");
  const registryItems = page.getByTestId("review-registry").locator("[data-review-id]");
  const statuses = await registryItems.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(statuses.length === 50 && statuses.every((x) => x === "pending"), `RI-1: registry shows 50 relationships, all pending (got ${statuses.length})`);
  // State persists while drawers close and reopen.
  await page.getByLabel("Scientific priority weight").fill("4");
  await page.getByTestId("advanced-drawer-close").click();
  await page.getByLabel("Investigation effort budget").fill("45");
  await page.getByTestId("open-evidence").click();
  await page.getByTestId("evidence-drawer-close").click();
  await page.getByTestId("open-advanced").click();
  const kept =
    (await page.getByLabel("Scientific priority weight").inputValue()) === "4" &&
    (await page.getByLabel("Investigation effort budget").inputValue()) === "45" &&
    (await abrasion.getAttribute("aria-pressed")) === "true" &&
    (await card.getAttribute("data-feature-id")) === "rover-last-position-in-dataset";
  check(kept, "MF-1: weights, budget, selected action and selected feature persist across drawers");
  await page.getByRole("button", { name: "Reset weights" }).click();
  await page.keyboard.press("Escape"); // the drawer covers part of the action strip
  await page.getByRole("button", { name: "Reset constraints" }).click();
  await page.getByTestId("open-advanced").click();
  const regionalSim = page.locator('[data-testid="evidence-drawer"] [data-record-id="obs-upper-etched-unit-mapping"]');
  check((await regionalSim.getAttribute("data-relevance")) === "regional-context", "M3: SIM 3464 unit Nue shown as regional context in the evidence drawer");

  // ── Historical replay (advanced) ──
  await page.getByTestId("mode-replay").check();
  await settle(page);
  check(/Historical replay/.test(await text(page.getByTestId("mission-mode"))) && /11 later record\(s\) hidden/.test(await text(page.getByTestId("integrity-bar"))), "Replay: mode badge and 11 hidden records shown");
  check(/11 later record\(s\) withheld/.test(await text(page.getByTestId("snapshot-summary"))), "Replay: default date 2023-09-08 withholds 11 later records");
  const replayOptions = await select.locator("option").evaluateAll((os) => os.map((o) => o.value));
  check(!replayOptions.some((v) => v.startsWith("sample-") || v.startsWith("traverse-") || v === "rover-last-position-in-dataset"), "Replay: post-date sample sites and the traverse are withheld from the map");
  check(/withheld/.test(await text(page.getByTestId("replay-map-note"))), "Replay: the map note explains withheld features");
  const replayStatuses = await registryItems.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(replayStatuses.length === 28 && replayStatuses.every((x) => x === "pending"), `Replay: registry shows 28 visible relationships on 2023-09-08 (got ${replayStatuses.length})`);
  check((await text(page.getByTestId("top-task"))) === "Abrade a margin rock and analyse it up close", "Replay: provisional top task at 2023-09-08 unchanged");
  await page.getByRole("button", { name: "Reveal later evidence" }).click();
  check((await page.getByTestId("reveal").count()) === 1, "Replay: reveal shows later evidence on request");
  await page.getByTestId("mode-present").check();
  await settle(page);
  check(!/later record\(s\) hidden/.test(await text(page.getByTestId("integrity-bar"))) && (await select.locator('option[value="sample-lefroy-bay"]').count()) === 1, "Replay: returning to present day restores all evidence and map features");
  await page.keyboard.press("Escape");

  // ── Keyboard navigation ──
  await page.getByTestId("action-task-orbital-stereo").focus();
  await page.keyboard.press("Enter");
  check((await page.getByTestId("action-task-orbital-stereo").getAttribute("aria-pressed")) === "true", "Keyboard: Enter on an action card selects it");
  const scaleBefore = await text(page.locator(".ol-scale-line-inner"));
  await page.getByTestId("mars-map").focus();
  await page.keyboard.press("+");
  await settle(page, 700);
  check((await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "mars-map" && (await text(page.locator(".ol-scale-line-inner"))) !== scaleBefore, "Keyboard: the map takes focus and + zooms it");
  await page.getByTestId("open-evidence").focus();
  await page.keyboard.press("Enter");
  check((await page.evaluate(() => document.activeElement?.id)) === "evidence-drawer-title", "Keyboard: Enter opens the evidence drawer and focuses its heading");
  await page.keyboard.press("Escape");
  check((await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "open-evidence", "Keyboard: Escape closes it and returns focus");

  const bodyText = await text(page.locator("body"));
  check(!/NASA recommends|recommended by NASA|endorsed by NASA/i.test(bodyText), "no claim of NASA endorsement anywhere on the page");
  check(!/\blive (position|location|telemetry feed)\b|current rover position/i.test(bodyText), "no live or current rover-position wording");
  await page.getByRole("button", { name: "Global" }).click();
  await page.locator('[data-testid="layer-panel"] select').first().selectOption({ label: "MGS MOLA, Global Color Hillshade" });
  await settle(page, 2_000);
  check(tileRequests.filter((u) => u.includes(`/EQ/${MOLA_ID}/`)).length > 0, "MOLA basemap requests MOLA tiles");
  const unexpected = consoleErrors.filter((t) => !/Failed to load resource|ERR_TUNNEL|net::/i.test(t));
  check(unexpected.length === 0, "no unexpected console errors");
  if (unexpected.length) console.log(unexpected);

  // ── Browser translation (UX-0 regression) and infeasible states ──
  await translatedChecks(browser, false);
  await translatedChecks(browser, true);

  // ── Mobile ──
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await phone.waitForSelector('[data-testid="mars-map"] canvas', { timeout: 15_000 });
  await settle(phone, 800);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal overflow at 390px (overflow=${overflow}px)`);
  const mapTop = (await phone.getByTestId("mars-map").boundingBox())?.y ?? 9999;
  check(mapTop < 844, `mobile: map starts within the first screen (y=${Math.round(mapTop)})`);
  check(!(await phone.getByTestId("layer-panel").isVisible()), "mobile: layer panel starts collapsed so the map stays usable");
  await phone.getByTestId("action-task-abrasion-proximity").click();
  const order = await phone.evaluate(() => {
    const y = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? -1;
    return y("action-detail") > y("action-strip");
  });
  check(order, "mobile: action details appear below the action strip");
  await phone.getByTestId("open-advanced").click();
  const drawerWidth = (await phone.getByTestId("advanced-drawer").boundingBox())?.width ?? 0;
  check(drawerWidth <= 390, `mobile: drawer fits the screen (width ${Math.round(drawerWidth)}px)`);
  await phone.keyboard.press("Escape");
  const overflowAfter = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflowAfter <= 0, `mobile: still no horizontal overflow after interaction (overflow=${overflowAfter}px)`);
  if (SCREENSHOT) {
    const mobilePath = SCREENSHOT.replace(/\.png$/, "") + "-mobile.png";
    await phone.screenshot({ path: mobilePath });
    console.log(`INFO  mobile screenshot saved to ${mobilePath}`);
  }
  await phone.close();
} finally {
  await browser.close();
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

async function translatedChecks(browser, translated) {
  const tag = translated ? "[translated]" : "[clean]";
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="feature-select"]', { timeout: 15_000 });
  await settle(page, 800);
  if (translated) await simulateTranslation(page);
  const t = async (id) => text(page.getByTestId(id));

  // Map selection and cards update after translation replaced text nodes.
  await page.getByTestId("feature-select").selectOption("sample-pelican-point");
  await settle(page, 400);
  await page.getByTestId("feature-select").selectOption("sample-comet-geyser");
  await settle(page, 400);
  check((await t("feature-name")) === "Comet Geyser", `${tag} feature card updates between selections`);
  await page.getByTestId("feature-select").selectOption("rover-last-position-in-dataset");
  await settle(page, 300);
  check(/not live telemetry/.test(await t("feature-warning")), `${tag} last-position warning renders`);

  // Actions, feasibility and choice.
  const abrasion = page.getByTestId("action-task-abrasion-proximity");
  await abrasion.click();
  await page.getByTestId("action-choose").click();
  await page.getByLabel("Investigation effort budget").fill("30");
  await settle(page);
  check(/Not feasible/.test(await text(abrasion)) && /budget is 30/.test(await text(abrasion)), `${tag} budget 30: action feasibility text updates`);
  check(/30 points/.test(await t("budget-value")), `${tag} budget value label updates`);

  // Infeasible states (UX-0): all platforms off, then budget 0.
  for (const label of ["Orbital imaging available", "Rover operations available", "Earth laboratories"]) {
    await page.locator('[data-testid="constraints"] label', { hasText: label }).locator("input").click();
  }
  await settle(page);
  check(errors.length === 0, `${tag} all platforms disabled: no page error${errors.length ? ` (${errors[0]})` : ""}`);
  check(/No task is feasible under the current constraints/.test(await t("not-ranked")), `${tag} all platforms disabled: explains that no task is feasible`);
  check(/not applicable/.test(await t("basis-gap-coverage")), `${tag} all platforms disabled: ranking basis shown as not applicable`);
  check(/Reviewed ranking unavailable/.test(await t("reviewed-status")), `${tag} all platforms disabled: reviewed ranking still unavailable`);
  check((await page.getByTestId("action-strip").locator('[data-feasible="false"]').count()) === 4, `${tag} all platforms disabled: every action marked not feasible`);
  await page.getByRole("button", { name: "Reset constraints" }).click();
  await settle(page);
  check((await t("top-task")) === "Abrade a margin rock and analyse it up close", `${tag} reset restores the provisional top task`);
  await page.getByLabel("Investigation effort budget").fill("0");
  await settle(page);
  check(/No task is feasible/.test(await t("no-recommendation")), `${tag} budget 0: no-recommendation message shown`);
  await page.getByLabel("Investigation effort budget").fill("30");
  await settle(page);
  check((await t("top-task")) === "Stand-off survey of margin outcrops", `${tag} budget 30: provisional top task updates`);
  check(/stays #1 in \d+ of \d+ runs/.test(await t("stability")), `${tag} budget 30: stability text present`);

  // Drawers, weights and replay.
  await page.getByTestId("open-advanced").click();
  await page.getByLabel("Resource feasibility weight").fill("5");
  await settle(page);
  const weightLabel = await page.locator("label", { hasText: "Resource feasibility" }).locator("span.font-mono", { hasText: /^w\d+$/ }).first().textContent();
  check(weightLabel?.trim() === "w5", `${tag} weight label updates to w5 (got ${weightLabel?.trim()})`);
  await page.getByTestId("mode-replay").check();
  await settle(page);
  check(/11 later record\(s\) withheld/.test(await t("snapshot-summary")), `${tag} replay mode updates the evidence summary`);
  await page.getByTestId("mode-present").check();
  await page.keyboard.press("Escape");
  await page.getByTestId("open-evidence").click();
  await page.keyboard.press("Escape");
  check(errors.length === 0, `${tag} no page errors overall${errors.length ? ` (${errors.join(" | ")})` : ""}`);
  await page.close();
}

const liveOnly = LIVE ? 2 : 0;
if (failures.length) {
  console.error(`\n${failures.length} of ${checks} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll smoke checks passed: ${checks} checks (${liveOnly} SMOKE_LIVE-only)`);
