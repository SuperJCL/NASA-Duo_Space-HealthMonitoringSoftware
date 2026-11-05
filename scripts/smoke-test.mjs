#!/usr/bin/env node
/**
 * Browser smoke test for the BR-2 science-briefing explorer (map + location panel),
 * including the MF-1 advanced ranking workspace.
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
/** Opens or closes the map's layer panel regardless of its current state. */
const layers = async (page, open) => {
  if ((await page.getByTestId("layer-panel").isVisible()) !== open) await page.getByTestId("layers-toggle").click();
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
  check((await page.getByRole("heading", { name: "Mars Discovery Intelligence" }).count()) === 1, "header renders");
  check((await page.getByTestId("location-panel").count()) === 1, "location panel renders");

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

  // ── BR-2 default interface: map + location panel, no wizard ──
  check((await page.getByRole("navigation", { name: "Investigation steps" }).count()) === 0 && (await page.locator("[data-step]").count()) === 0, "no five-step wizard in the default interface");
  check(await page.getByTestId("mars-map").isVisible(), "interactive map is visible on load");
  check(/Not a NASA mission and not live telemetry/.test(await text(page.getByTestId("mission-disclaimer"))), "disclaimer: not a NASA mission, not live telemetry, rover data historical");
  const chooser = page.getByTestId("site-chooser");
  check(await chooser.isVisible(), "BR-2: the panel starts with a site chooser that says what the app does");
  const chooserText = await text(chooser);
  check(/Lefroy Bay\s*Science briefing/.test(chooserText) && /Pelican Point\s*Location details only/.test(chooserText) && /Comet Geyser\s*Location details only/.test(chooserText), "BR-2: chooser lists the 3 real sample sites; Lefroy Bay has a briefing");
  check(!(await page.getByTestId("action-strip").isVisible()), "BR-2: the four simulated actions are not shown in the default view");
  check(!(await page.getByTestId("layer-panel").isVisible()), "BR-2: layer panel starts collapsed so the sites stay visible");
  await layers(page, true);
  check(/not drawn/.test(await text(page.getByTestId("no-task-markers"))), "legend states that simulated actions are not drawn on the map");
  const optionValues = await page.getByTestId("feature-select").locator("option").evaluateAll((os) => os.map((o) => o.value));
  check(!optionValues.some((v) => v.startsWith("task-")), "no task has a map feature (no invented task coordinates)");
  check(optionValues.filter((v) => v.startsWith("sample-")).length === 3 && optionValues.filter((v) => v.startsWith("traverse-")).length === 332 && optionValues.includes("rover-last-position-in-dataset"), "map lists 3 sample sites, 332 traverse drives and the last position");
  check(/332 drives, sols 14–1176/.test(await text(page.getByTestId("layer-traverse"))) && /3 site\(s\)/.test(await text(page.getByTestId("layer-samples"))), "legend shows traverse and sample counts");
  await layers(page, false);

  // ── The Lefroy Bay science briefing ──
  await page.getByTestId("choose-sample-lefroy-bay").click();
  await settle(page, 500);
  const briefing = page.getByTestId("briefing");
  check((await briefing.getAttribute("data-briefing-id")) === "briefing-lefroy-bay" && /Rock core M2020-949-26/.test(await text(briefing)), "BR-2: selecting Lefroy Bay opens its science briefing immediately");
  check(/particularly strong carbonate signature/.test(await text(page.getByTestId("briefing-why"))), "BR-2: answers 'why does this location matter?'");
  const keyQ = page.getByTestId("key-question");
  const keyBox = await keyQ.boundingBox();
  check(/Still unknown/.test(await text(keyQ)) && /How did this rock form\?/.test(await text(keyQ)) && /altered igneous rock/.test(await text(keyQ)), "BR-2: the open question is shown in a prominent box");
  check(Boolean(keyBox && keyBox.y + keyBox.height < 800), `BR-2: the open question is visible without scrolling (bottom at ${Math.round((keyBox?.y ?? 0) + (keyBox?.height ?? 0))}px)`);
  const silica = page.locator('[data-item-id="lb-silica-cement"]');
  check((await text(silica)).startsWith("Silica fills the spaces between the grains") && (await silica.getAttribute("data-classification")) === "measured", "BR-2: Q1 answer (silica fills the spaces) is listed as measured");
  const silicaBox = await silica.boundingBox();
  check(Boolean(silicaBox && silicaBox.y < 800), `BR-2: the first measured item is in the first screen (y=${Math.round(silicaBox?.y ?? 0)})`);
  check((await page.getByTestId("briefing-measured").locator("[data-classification]").evaluateAll((els) => els.every((e) => e.getAttribute("data-classification") === "measured"))), "BR-2: the measured section holds only measured items");
  check((await page.getByTestId("briefing-interpreted").locator("[data-classification]").evaluateAll((els) => els.length === 2 && els.every((e) => e.getAttribute("data-classification") === "interpreted"))), "BR-2: interpretations are separate and labelled preliminary");
  const doneText = await text(page.getByTestId("briefing-done"));
  check(["Sol 920", "Sol 935", "Sol 942", "Sol 949"].every((s) => doneText.includes(s)) && /does not suggest repeating them/.test(doneText), "BR-2: already done: imaged, abraded, drilled and sealed, with sols; no repeat suggested");
  const nextText = await text(page.getByTestId("briefing-next"));
  check(/not approved NASA missions/.test(nextText) && /If the sample reaches Earth/.test(nextText) && /not guaranteed/.test(nextText), "BR-2: Q3: future investigations are conditional and not approved NASA missions");
  check(/Simulated ideas \(MDI\): not NASA plans, not reviewed/.test(await text(page.getByTestId("briefing-simulated"))), "BR-2: simulated ideas are visually separate and labelled not reviewed");
  check(/No\. After sampling here the rover drove on.*sol 1176.*2\.5 km west.*no live data/.test(await text(page.getByTestId("briefing-rover"))), "BR-2: Q4: the rover is not at Lefroy Bay; data are historical, not live");
  check((await silica.getByTestId("line-source").count()) === 0, "BR-2: exact quotes are collapsed by default");
  await silica.getByTestId("source-toggle").click();
  const src = silica.getByTestId("line-source");
  check(/“Silica fills the space between grains, possibly as a cement\.”/.test(await text(src)) && /report header · p\. 26-1/.test(await text(src)), "BR-2: Source shows the exact quotation with report section and page");
  check((await src.locator("a").getAttribute("href"))?.endsWith("initial_reports_volume4.pdf") ?? false, "BR-2: Source links the original report");
  await silica.getByTestId("source-toggle").click();
  check((await page.getByTestId("briefing-report-link").getAttribute("href"))?.endsWith("initial_reports_volume4.pdf") ?? false, "BR-2: the original report is linked from the briefing");

  // Map-driven selection and other sites.
  await layers(page, true);
  const select = page.getByTestId("feature-select");
  await select.selectOption("sample-pelican-point");
  await settle(page, 600);
  const card = page.getByTestId("feature-card");
  check((await card.getAttribute("data-feature-id")) === "sample-pelican-point" && (await page.getByTestId("no-briefing-note").isVisible()), "BR-2: a site without a briefing shows its location card and says no briefing exists yet");
  check((await page.getByTestId("feature-convention").getAttribute("data-basis")) === "inferred-cross-validation", "location card marks coordinates as inferred by cross-validation");
  await select.selectOption("sample-lefroy-bay");
  await settle(page, 400);
  await page.getByRole("button", { name: "Close briefing" }).click();
  check(await chooser.isVisible(), "BR-2: closing the briefing returns to the site chooser");
  await layers(page, false); // hide the panel so the map centre is clickable
  await page.getByTestId("mars-map").click(); // the map is centred on Lefroy Bay
  await settle(page, 700);
  check((await briefing.getAttribute("data-briefing-id").catch(() => null)) === "briefing-lefroy-bay", "BR-2: clicking the Lefroy Bay marker on the map opens its briefing");

  // Methods & audit.
  await page.getByTestId("open-methods").click();
  await settle(page);
  const methods = page.getByTestId("briefing-methods");
  check(await methods.isVisible(), "BR-2: Methods & audit drawer opens");
  check(/24 points/.test(await text(methods)) && /verify:briefing/.test(await text(methods)), "BR-2: methods state the point count and section-scoped verification");
  check((await page.getByTestId("methods-shared").locator("li").count()) === 3 && /M2020-923-25 Pelican Point/.test(await text(page.getByTestId("methods-shared"))), "BR-2: methods list the 3 statements shared with Pelican Point");
  check(/make Pelican Point of great interest/.test(await text(page.getByTestId("methods-quarantine"))), "BR-2: methods show the quarantined copied sentence");
  check((await page.getByTestId("methods-notes").locator("li").count()) === 4, "BR-2: methods show the 4 source notes");
  await page.keyboard.press("Escape");
  check((await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "open-methods", "drawer Escape returns focus to its opener");

  // Traverse, last position and layer toggles (MF-1 behaviour).
  await layers(page, true);
  await select.selectOption({ label: "Drive on sol 909" });
  await settle(page, 600);
  const traverseCard = await text(card);
  check(/Perseverance drive on sol 909/.test(traverseCard) && /473\.9 m \(source attribute\)/.test(traverseCard) && /Not stated by the source/.test(traverseCard), "traverse drive card shows sol, source length and no invented date");
  await page.getByTestId("layer-traverse").locator("input").uncheck();
  await settle(page);
  check((await card.count()) === 0 && (await chooser.isVisible()), "hiding the traverse layer clears a selected drive");
  await page.getByTestId("layer-traverse").locator("input").check();
  const extents = page.getByTestId("layer-extents").locator("input");
  check(!(await extents.isChecked()), "imagery/DTM extent overlay is off by default");
  await extents.check();
  await select.selectOption("extent-ctx-dtm");
  await settle(page, 400);
  check(/Download only/.test(await text(card)), "extent overlay toggles on; the DTM card says download-only");
  await extents.uncheck();
  const hiriseBefore = tileRequests.filter((u) => u.includes(`/EQ/${HIRISE_ID}/`)).length;
  await page.getByLabel(/HiRISE, Jezero Mosaic/).check();
  await settle(page, 2_000);
  check(tileRequests.filter((u) => u.includes(`/EQ/${HIRISE_ID}/`)).length > hiriseBefore, "HiRISE imagery toggle requests HiRISE tiles");
  await page.getByLabel(/HiRISE, Jezero Mosaic/).uncheck();
  await select.selectOption("rover-last-position-in-dataset");
  await settle(page, 500);
  check(/not live telemetry/.test(await text(page.getByTestId("feature-warning"))) && /no rover data after this sol/.test(await text(page.getByTestId("feature-warning"))), "last-position card warns it is historical, not live, with no later data");

  // ── Advanced ranking workspace (MF-1 functionality preserved) ──
  await page.getByTestId("open-advanced").click();
  await settle(page);
  const adv = page.getByTestId("advanced-drawer");
  check(await adv.isVisible(), "advanced ranking workspace opens");
  const bar = await text(page.getByTestId("integrity-bar"));
  check(/through 2025-05-06 \(not all NASA data\)/.test(bar) && /Reviewed ranking: unavailable/.test(bar) && /4 feasible task\(s\) excluded pending review/.test(bar) && /50 relationship\(s\) awaiting expert review/.test(bar), "advanced: integrity status (dataset date, reviewed unavailable, 4 excluded, 50 awaiting)");
  const actionCards = adv.locator("[data-testid^='action-task-']");
  const cardTexts = await actionCards.allTextContents();
  check(cardTexts.length === 4 && cardTexts.every((t) => /Simulated action/.test(t) && /Cost: \d+ simulated points/.test(t) && /Provisional: \d+ scientific relationship/.test(t) && !/#\d|rank/i.test(t)), "advanced: 4 simulated actions with cost and provisional status, no rank on cards");
  check(/not tied to any location/.test(await text(adv)), "advanced: actions are stated not to be tied to any location");
  const abrasion = page.getByTestId("action-task-abrasion-proximity");
  await abrasion.click();
  const detail = page.getByTestId("action-detail");
  check((await abrasion.getAttribute("aria-pressed")) === "true" && /Simulated future action · not a NASA operation/.test(await text(detail)), "advanced: selecting an action opens its details");
  check((await page.getByTestId("action-chosen").count()) === 0, "advanced: selecting an action does not choose or execute it");
  await page.getByTestId("action-choose").click();
  check(/Nothing is executed/.test(await text(page.getByTestId("action-chosen"))), "advanced: choosing records a simulated decision only");
  await page.getByLabel("Investigation effort budget").fill("30");
  await settle(page);
  check((await abrasion.getAttribute("data-feasible")) === "false" && /Not feasible: Needs 40 points of Investigation effort; simulated budget is 30/.test(await text(abrasion)), "advanced: budget 30 makes the 40-point action infeasible with the stated reason");
  check((await page.getByTestId("action-task-standoff-survey").getAttribute("data-feasible")) === "true", "advanced: the 15-point action stays feasible at budget 30");
  check((await text(page.getByTestId("top-task"))) === "Stand-off survey of margin outcrops", "advanced: budget 30 re-ranks deterministically");
  await page.getByLabel("Investigation effort budget").fill("100");
  await settle(page);
  check((await page.getByTestId("reviewed-status").getAttribute("data-state")) === "unavailable", "RI-1: reviewed ranking unavailable (no relationships approved)");
  const provisionalBox = page.getByTestId("provisional-ranking");
  check((await provisionalBox.getAttribute("open")) === null, "RI-1: provisional ranking collapsed by default");
  await provisionalBox.locator("summary").first().click();
  const pivotalIds = await page.getByTestId("pivotal-inputs").locator("[data-review-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-review-id")));
  check(JSON.stringify(pivotalIds) === JSON.stringify(["relevance:gap-lake-connection", "task-gap:task-abrasion-proximity->gap-formation-unknown", "task-gap:task-abrasion-proximity->gap-lake-connection"]), `RI-1: 3 pivotal unreviewed inputs (got ${pivotalIds.length})`);
  check(/Provisional · not scientifically validated/.test(await text(page.getByTestId("recommendation"))) && /Verified historical sample locations are displayed/.test(await text(page.getByTestId("recommendation"))), "RI-1: provisional top task labelled not validated; MF-1 limitation text present");
  await provisionalBox.locator("summary").first().click();
  check((await page.getByTestId("comparison-table").getByText("NE").count()) > 0, "M3: comparison shows Not Evaluated for unapproved curated criteria");
  check(/Not in ranking basis/.test(await text(page.getByTestId("basis-hypothesis-discrimination"))), "M3: hypothesis discrimination excluded from the basis with a reason");
  const registryItems = page.getByTestId("review-registry").locator("[data-review-id]");
  const statuses = await registryItems.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(statuses.length === 50 && statuses.every((x) => x === "pending"), `RI-1: registry shows 50 relationships, all pending (got ${statuses.length})`);
  await page.getByLabel("Scientific priority weight").fill("4");
  await page.getByTestId("advanced-drawer-close").click();
  await page.getByTestId("open-evidence").click();
  await page.getByTestId("evidence-drawer-close").click();
  await page.getByTestId("open-advanced").click();
  const kept = (await page.getByLabel("Scientific priority weight").inputValue()) === "4" && (await abrasion.getAttribute("aria-pressed")) === "true" && (await card.getAttribute("data-feature-id")) === "rover-last-position-in-dataset";
  check(kept, "state (weights, selected action, selected map feature) persists across drawers");
  await page.getByRole("button", { name: "Reset weights" }).click();
  await page.getByTestId("mode-replay").check();
  await settle(page);
  check(/Historical replay/.test(await text(page.getByTestId("mission-mode"))) && /11 later record\(s\) withheld/.test(await text(page.getByTestId("snapshot-summary"))), "replay: badge shown; 11 later records withheld on 2023-09-08");
  const replayOptions = await select.locator("option").evaluateAll((os) => os.map((o) => o.value));
  check(!replayOptions.some((v) => v.startsWith("sample-") || v.startsWith("traverse-")), "replay: post-date sample sites and the traverse are withheld from the map");
  const replayStatuses = await registryItems.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check(replayStatuses.length === 28, `replay: registry shows 28 relationships on 2023-09-08 (got ${replayStatuses.length})`);
  await page.getByRole("button", { name: "Reveal later evidence" }).click();
  check((await page.getByTestId("reveal").count()) === 1, "replay: reveal shows later evidence on request");
  await page.getByTestId("mode-present").check();
  await settle(page);
  check((await select.locator('option[value="sample-lefroy-bay"]').count()) === 1, "replay: returning to present day restores the sample sites");
  const regionalSim = page.locator('[data-testid="evidence-drawer"] [data-record-id="obs-upper-etched-unit-mapping"]');
  check((await regionalSim.getAttribute("data-relevance")) === "regional-context", "M3: SIM 3464 unit Nue shown as regional context in the evidence drawer");
  await page.keyboard.press("Escape");

  // ── Keyboard ──
  await page.getByRole("button", { name: "Back to the site list" }).click();
  await page.getByTestId("choose-sample-lefroy-bay").focus();
  await page.keyboard.press("Enter");
  await settle(page, 300);
  check((await briefing.count()) === 1, "keyboard: Enter on a site opens its briefing");
  const toggle = page.locator('[data-item-id="lb-oq-rock-type"] [data-testid="source-toggle"]');
  await toggle.focus();
  await page.keyboard.press("Enter");
  check((await toggle.getAttribute("aria-expanded")) === "true" && /p\. 26-1/.test(await text(page.locator('[data-item-id="lb-oq-rock-type"] [data-testid="line-source"]'))), "keyboard: Enter on Source reveals the quotation");
  const scaleBefore = await text(page.locator(".ol-scale-line-inner"));
  await page.getByTestId("mars-map").focus();
  await page.keyboard.press("+");
  await settle(page, 700);
  check((await text(page.locator(".ol-scale-line-inner"))) !== scaleBefore, "keyboard: the map takes focus and + zooms it");

  const bodyText = await text(page.locator("body"));
  check(!/NASA recommends|recommended by NASA|endorsed by NASA/i.test(bodyText), "no claim of NASA endorsement anywhere on the page");
  check(!/\blive (position|location|telemetry feed)\b|current rover position|has continued since/i.test(bodyText), "no live, current or unsourced rover-position wording");
  await page.getByRole("button", { name: "Global" }).click();
  await layers(page, true);
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
  check(((await phone.getByTestId("mars-map").boundingBox())?.y ?? 9999) < 844, "mobile: map starts within the first screen");
  await phone.getByTestId("choose-sample-lefroy-bay").click();
  await settle(phone, 400);
  const order = await phone.evaluate(() => {
    const y = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? -1;
    return y("mars-map") < y("briefing") && y("briefing") < y("key-question");
  });
  check(order, "mobile: briefing follows the map, with the open question near its top");
  await phone.getByTestId("open-advanced").click();
  check(((await phone.getByTestId("advanced-drawer").boundingBox())?.width ?? 999) <= 390, "mobile: drawer fits the screen");
  await phone.keyboard.press("Escape");
  const overflowAfter = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflowAfter <= 0, `mobile: still no horizontal overflow after interaction (overflow=${overflowAfter}px)`);
  if (SCREENSHOT) {
    const mobilePath = SCREENSHOT.replace(/\.png$/, "") + "-mobile.png";
    await phone.screenshot({ path: mobilePath, fullPage: true });
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
  await page.waitForSelector('[data-testid="site-chooser"]', { timeout: 15_000 });
  await settle(page, 800);
  if (translated) await simulateTranslation(page);
  const t = async (id) => text(page.getByTestId(id));

  // Briefing, sources and switching sites after translation replaced text nodes.
  await page.getByTestId("choose-sample-lefroy-bay").click();
  await settle(page, 300);
  check(/How did this rock form/.test(await t("key-question")), `${tag} briefing renders`);
  await page.locator('[data-item-id="lb-silica-cement"] [data-testid="source-toggle"]').click();
  check(/p\. 26-1/.test(await text(page.locator('[data-item-id="lb-silica-cement"] [data-testid="line-source"]'))), `${tag} source quotation opens`);
  await page.getByRole("button", { name: "Close briefing" }).click();
  await page.getByTestId("choose-sample-comet-geyser").click();
  await settle(page, 300);
  check((await t("feature-name")) === "Comet Geyser" && (await page.getByTestId("no-briefing-note").isVisible()), `${tag} switching to another site updates the panel`);
  await page.getByRole("button", { name: "Back to the site list" }).click();
  await page.getByTestId("choose-sample-lefroy-bay").click();
  await settle(page, 300);
  check((await page.getByTestId("briefing").count()) === 1, `${tag} returning to Lefroy Bay restores the briefing`);
  await page.getByTestId("open-methods").click();
  await page.keyboard.press("Escape");

  // Advanced workspace: actions, feasibility, infeasible states (UX-0), weights, replay.
  await page.getByTestId("open-advanced").click();
  const abrasion = page.getByTestId("action-task-abrasion-proximity");
  await abrasion.click();
  await page.getByTestId("action-choose").click();
  await page.getByLabel("Investigation effort budget").fill("30");
  await settle(page);
  check(/Not feasible/.test(await text(abrasion)) && /budget is 30/.test(await text(abrasion)) && /30 points/.test(await t("budget-value")), `${tag} budget 30: feasibility and budget labels update`);
  for (const label of ["Orbital imaging available", "Rover operations available", "Earth laboratories"]) {
    await page.locator('[data-testid="constraints"] label', { hasText: label }).locator("input").click();
  }
  await settle(page);
  check(errors.length === 0, `${tag} all platforms disabled: no page error${errors.length ? ` (${errors[0]})` : ""}`);
  check(/No task is feasible under the current constraints/.test(await t("not-ranked")) && /not applicable/.test(await t("basis-gap-coverage")), `${tag} all platforms disabled: explained; ranking basis not applicable`);
  check(/Reviewed ranking unavailable/.test(await t("reviewed-status")) && (await page.getByTestId("action-strip").locator('[data-feasible="false"]').count()) === 4, `${tag} all platforms disabled: reviewed unavailable; every action infeasible`);
  await page.getByRole("button", { name: "Reset constraints" }).click();
  await settle(page);
  check((await t("top-task")) === "Abrade a margin rock and analyse it up close", `${tag} reset restores the provisional top task`);
  await page.getByLabel("Investigation effort budget").fill("0");
  await settle(page);
  check(/No task is feasible/.test(await t("no-recommendation")), `${tag} budget 0: no-recommendation message shown`);
  await page.getByLabel("Investigation effort budget").fill("30");
  await settle(page);
  check((await t("top-task")) === "Stand-off survey of margin outcrops" && /stays #1 in \d+ of \d+ runs/.test(await t("stability")), `${tag} budget 30: top task and stability text update`);
  await page.getByLabel("Resource feasibility weight").fill("5");
  await settle(page);
  const weightLabel = await page.locator("label", { hasText: "Resource feasibility" }).locator("span.font-mono", { hasText: /^w\d+$/ }).first().textContent();
  check(weightLabel?.trim() === "w5", `${tag} weight label updates to w5 (got ${weightLabel?.trim()})`);
  await page.getByTestId("mode-replay").check();
  await settle(page);
  check(/11 later record\(s\) withheld/.test(await t("snapshot-summary")), `${tag} replay mode updates the evidence summary`);
  await page.getByTestId("mode-present").check();
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
