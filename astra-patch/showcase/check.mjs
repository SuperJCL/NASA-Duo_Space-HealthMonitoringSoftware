#!/usr/bin/env node
/*
 * Browser check for the ASTRA patch showcase page (standalone; touches no other service).
 *
 *   python -m astra_patch showcase serve          # in astra-patch/, another terminal
 *   node astra-patch/showcase/check.mjs           # from anywhere
 *
 * Env: SHOWCASE  page URL (default http://127.0.0.1:8150/)
 *      SHOT_DIR  optional folder for screenshots (1440×900 and 1920×1080, every scenario)
 *      PYTHON    optional interpreter for the replay comparison (default: astra-patch/.venv/bin/python, then python3)
 *
 * It checks that showcase/data/showcase.json equals the `replay` CLI output, that the page shows
 * exactly those numbers for all three scenarios, the required labels, keyboard switching, no page
 * scroll at 1440×900 and 1920×1080, no console errors and no request outside the page's own origin.
 * Prints PASS/FAIL lines and a total; exits 1 on any failure.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const patchRoot = path.resolve(here, '..');
const repoRoot = path.resolve(patchRoot, '..');
const BASE = process.env.SHOWCASE || 'http://127.0.0.1:8150/';
const SHOT_DIR = process.env.SHOT_DIR || '';
const data = JSON.parse(readFileSync(path.join(here, 'data', 'showcase.json'), 'utf8'));
const ORDER = data.scenario_order;

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

function loadPlaywright() {
  for (const base of [path.join(repoRoot, 'package.json'), import.meta.url]) {
    try {
      return createRequire(base)('playwright');
    } catch {
      // try the next location
    }
  }
  throw new Error('playwright is not installed (expected in the repository node_modules)');
}

function windowsFrom(report) {
  return report.observations.map((o) => ({
    rms: o.reported_summary_features.rms_microvolts,
    mf: o.reported_summary_features.median_frequency_hz,
    status: o.signal_quality.status,
    flags: o.signal_quality.flags,
    score: o.signal_quality.reported_score,
    elapsed: o.elapsed_seconds,
    baseline: o.baseline_comparison.status,
    indicator: o.research_indicator.status,
  }));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const numberIn = (text) => Number.parseFloat(String(text).replace('−', '-'));

// ---- 1. the data file equals the replay CLI output (same code path) ----
function pythonCandidates() {
  return [process.env.PYTHON, path.join(patchRoot, '.venv', 'bin', 'python'), path.join(patchRoot, '.venv', 'Scripts', 'python.exe'), 'python3']
    .filter(Boolean)
    .filter((p) => !p.includes(path.sep) || existsSync(p));
}

const python = pythonCandidates()[0];
for (const scenario of ORDER) {
  const run = spawnSync(python, ['-m', 'astra_patch', 'replay', '--scenario', scenario], { cwd: patchRoot, encoding: 'utf8', timeout: 60000 });
  if (run.status !== 0) {
    check(`replay CLI ${scenario} runs`, false, run.stderr || run.error?.message || `exit ${run.status}`);
    continue;
  }
  const cli = JSON.parse(run.stdout);
  check(`data file equals replay CLI output: ${scenario}`,
    same(windowsFrom(cli), windowsFrom(data.scenarios[scenario].replay)) && cli.scenario_label === scenario &&
    cli.observations.length === data.scenarios[scenario].replay.observations.length);
}

// ---- 2. the page ----
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const origin = new URL(BASE).origin;
const consoleErrors = [];
const foreignRequests = [];

async function openPage(viewport, options = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...options });
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('request', (req) => { if (new URL(req.url()).origin !== origin) foreignRequests.push(req.url()); });
  return { context, page };
}

async function ready(page, url) {
  await page.goto(url);
  await page.waitForSelector('html[data-ready="true"]', { timeout: 10000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(150);
}

async function noScroll(page) {
  return page.evaluate(() => {
    const el = document.scrollingElement;
    return { ok: el.scrollHeight <= window.innerHeight && el.scrollWidth <= window.innerWidth, h: el.scrollHeight, w: el.scrollWidth };
  });
}

async function displayed(page) {
  return page.evaluate(() => {
    const out = [];
    for (let i = 1; i <= 4; i += 1) {
      const rms = document.querySelector(`#plot-rms [data-field="rms"][data-window="${i}"]`);
      const mf = document.querySelector(`#plot-mf [data-field="mf"][data-window="${i}"]`);
      const q = document.querySelector(`[data-field="quality"][data-window="${i}"]`);
      out.push({
        rms: rms?.textContent, rmsPlotted: rms?.getAttribute('data-plotted') !== 'false',
        mf: mf?.textContent, mfPlotted: mf?.getAttribute('data-plotted') !== 'false',
        status: q?.dataset.status, qualityText: q?.textContent,
        flags: [...(q?.querySelectorAll('[data-field="flag"]') || [])].map((f) => f.textContent),
        score: q?.querySelector('[data-field="score"]')?.textContent,
        elapsed: document.querySelector(`[data-field="elapsed"][data-window="${i}"]`)?.textContent,
        hatched: Boolean(document.querySelector(`[data-fault-window="${i}"]`)),
      });
    }
    return {
      windows: out,
      points: document.querySelectorAll('#plot-rms circle.c-point').length + document.querySelectorAll('#plot-mf circle.c-point').length,
      pressed: [...document.querySelectorAll('#scenario-switch [aria-pressed="true"]')].map((b) => b.dataset.scenario),
      chip: document.querySelector('[data-testid="scenario-chip"]').textContent,
      honesty: document.querySelector('[data-testid="honesty-chip"]').textContent,
      explanation: document.querySelector('[data-testid="explanation"]').textContent,
      hash: location.hash,
    };
  });
}

async function checkScenario(page, scenario, how, { urlUpdated = true } = {}) {
  const shown = await displayed(page);
  const expected = windowsFrom(data.scenarios[scenario].replay);
  const urlOk = urlUpdated ? shown.hash === `#scenario=${scenario}` : true;
  check(`[${scenario}] selected via ${how}: aria-pressed${urlUpdated ? ' and URL' : ''}`, same(shown.pressed, [scenario]) && urlOk,
    `pressed=${shown.pressed} hash=${shown.hash}`);
  let numbersOk = true;
  let qualityOk = true;
  let detail = '';
  expected.forEach((w, i) => {
    const d = shown.windows[i];
    const acceptable = w.status !== 'unsuitable';
    if (numberIn(d.rms) !== w.rms || numberIn(d.mf) !== w.mf || numberIn(d.elapsed) !== w.elapsed) {
      numbersOk = false;
      detail += ` w${i + 1}: rms=${d.rms} mf=${d.mf} elapsed=${d.elapsed};`;
    }
    if (d.status !== w.status || !same(d.flags, w.flags) || numberIn(d.score.replace('score', '')) !== w.score ||
        d.rmsPlotted !== acceptable || d.mfPlotted !== acceptable || d.hatched === acceptable ||
        !d.qualityText.includes(acceptable ? 'Acceptable' : 'Unsuitable')) {
      qualityOk = false;
      detail += ` w${i + 1}: quality=${d.status} ${d.flags} ${d.score} hatched=${d.hatched};`;
    }
  });
  const acceptableCount = expected.filter((w) => w.status !== 'unsuitable').length;
  check(`[${scenario}] RMS, median frequency and elapsed time equal the data file`, numbersOk, detail);
  check(`[${scenario}] quality status, flags, score; unsuitable windows hatched and not plotted`, qualityOk && shown.points === 2 * acceptableCount, detail || `points=${shown.points}`);
  check(`[${scenario}] scenario chip says simulated label, not a diagnosis`, shown.chip.includes(scenario) && shown.chip.includes('simulated label, not a diagnosis'));
  const honest = expected.every((w) => w.baseline === 'not_available' && w.indicator === 'not_assessed');
  check(`[${scenario}] honesty chip matches baseline/research fields`, honest && shown.honesty.includes('No baseline comparison · no diagnosis'), shown.honesty);
  check(`[${scenario}] explanation sentence equals the data file`, shown.explanation === data.scenarios[scenario].explanation);
}

const { context, page } = await openPage({ width: 1440, height: 900 });
await ready(page, BASE);

// labels
const text = await page.evaluate(() => document.body.innerText);
const capture = data.capture_example;
const labels = [
  ['title', 'ASTRA patch · how the sensor demo works'],
  ['chip Synthetic data', 'Synthetic data'],
  ['chip Standalone demo', 'Standalone demo'],
  ['waveform label', capture.label],
  ['waveform relation sentence', capture.relation_to_scenarios],
  ['decimated for display', 'decimated for display'],
  ['footer', 'Synthetic data generated by python -m astra_patch showcase build · not connected to the Mars Base or the HUD'],
  ['footer provenance: fixture file', data.fixture.file],
  ['footer provenance: seed', `seed ${data.fixture.fixed_seed}`],
  ['capture provenance: actual_sensor false', 'actual_sensor: false'],
  ['placement from fixtures', data.scenarios.normal.replay.observations[0].metadata.muscle],
  ['placement capture default', capture.configuration.muscle],
  ['sEMG rate', `${capture.configuration.emg_sample_rate_hz} Hz`],
  ['IMU rate', `${capture.configuration.imu_sample_rate_hz} Hz`],
];
for (const [name, needle] of labels) check(`label present: ${name}`, text.includes(needle), needle);
const header = await page.evaluate(() => [...document.querySelectorAll('header.top .mm-chip')].map((c) => [c.textContent, getComputedStyle(c).borderStyle]));
check('header chips: "Synthetic data" dashed, "Standalone demo"', same(header.map((c) => c[0]), ['Synthetic data', 'Standalone demo']) && header[0][1] === 'dashed', JSON.stringify(header));
check('waveform label shown exactly', (await page.textContent('[data-testid="waveform-label"]')) === "Synthetic illustrative signal from the demo's capture path");

// waveform traces = the data points, nothing added
const traces = await page.evaluate(() => [...document.querySelectorAll('#trace-emg polyline, #trace-imu polyline')].map((p) => p.getAttribute('points').trim().split(/\s+/).length));
check('traces draw exactly the excerpt samples', same(traces, [capture.excerpt.emg.values.length, capture.excerpt.imu.accel_x.length, capture.excerpt.imu.accel_y.length]), JSON.stringify(traces));

// default scenario, then mouse switching through all three
await checkScenario(page, ORDER[0], 'default load', { urlUpdated: false });
for (const scenario of ORDER) {
  await page.click(`#scenario-switch [data-scenario="${scenario}"]`);
  await checkScenario(page, scenario, 'click');
  const scroll = await noScroll(page);
  check(`[${scenario}] no page scroll at 1440×900`, scroll.ok, `${scroll.w}×${scroll.h}`);
}

// keyboard switching
await page.focus(`#scenario-switch [data-scenario="${ORDER[0]}"]`);
await page.keyboard.press('Enter');
await page.keyboard.press('ArrowRight');
await checkScenario(page, ORDER[1], 'ArrowRight');
await page.keyboard.press('End');
await checkScenario(page, ORDER[2], 'End');
await page.keyboard.press('Home');
await checkScenario(page, ORDER[0], 'Home');
await page.keyboard.press('Tab');
await page.keyboard.press('Space');
const focused = await page.evaluate(() => document.activeElement?.dataset.scenario);
await checkScenario(page, focused, 'Tab + Space');
check('keyboard focus stays on the switch buttons', focused === ORDER[1], String(focused));

// deep links
await ready(page, `${BASE}?scenario=sensor_fault`);
check('?scenario=sensor_fault selects sensor_fault', same((await displayed(page)).pressed, ['sensor_fault']));
await ready(page, `${BASE}#scenario=fatigue_suspected`);
check('#scenario=fatigue_suspected selects fatigue_suspected', same((await displayed(page)).pressed, ['fatigue_suspected']));
await context.close();

// reduced motion and the large screen
const reduced = await openPage({ width: 1920, height: 1080 }, { reducedMotion: 'reduce' });
await ready(reduced.page, `${BASE}#scenario=sensor_fault`);
const duration = await reduced.page.evaluate(() => getComputedStyle(document.querySelector('.plot-in')).animationDuration);
check('reduced motion sets animation duration to 0', duration === '0s', duration);
for (const scenario of ORDER) {
  await reduced.page.click(`#scenario-switch [data-scenario="${scenario}"]`);
  await checkScenario(reduced.page, scenario, 'click at 1920×1080');
  const scroll = await noScroll(reduced.page);
  check(`[${scenario}] no page scroll at 1920×1080`, scroll.ok, `${scroll.w}×${scroll.h}`);
}
await reduced.context.close();

// screenshots
if (SHOT_DIR) {
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const [w, h] of [[1440, 900], [1920, 1080]]) {
    const shot = await openPage({ width: w, height: h }, { reducedMotion: 'reduce' });
    for (const scenario of ORDER) {
      await ready(shot.page, `${BASE}#scenario=${scenario}`);
      await shot.page.screenshot({ path: path.join(SHOT_DIR, `patch-${scenario}-${w}x${h}.png`) });
    }
    await shot.context.close();
  }
  console.log(`Screenshots: ${SHOT_DIR}`);
}
await browser.close();

check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
check('no request outside the page origin (no Base, HUD or relay)', foreignRequests.length === 0, foreignRequests.join(' '));
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
