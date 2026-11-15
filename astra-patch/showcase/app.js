/*
 * ASTRA patch showcase: display only.
 *
 * Every number on this page comes from data/showcase.json, written by
 * `python -m astra_patch showcase build` from the same code path as
 * `python -m astra_patch replay`. This script never analyses, judges or derives indicators: it
 * reads fields, formats them and draws the real points (no smoothing, no invented points).
 * It fetches only its own data file and talks to no other service.
 */
'use strict';

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DATA_URL = 'data/showcase.json';
  const ACCEPTABLE = new Set(['acceptable', 'fixture_reported_acceptable']);
  const MODE_TEXT = {
    accelerated_recorded_time_not_wall_clock_transmission: 'accelerated recorded time, not wall-clock',
  };
  const METRICS = [
    { key: 'rms', field: 'rms_microvolts', title: 'RMS amplitude', unit: 'µV', step: 10 },
    { key: 'mf', field: 'median_frequency_hz', title: 'Median frequency', unit: 'Hz', step: 10 },
  ];

  const state = { data: null, scenario: null, ranges: null };

  // ---------- small DOM helpers ----------
  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }

  function s(tag, attrs, children) {
    const node = document.createElementNS(SVG_NS, tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }

  function setAttrs(node, attrs) {
    for (const [name, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'text') node.textContent = String(value);
      else node.setAttribute(name, String(value));
    }
  }

  function append(node, children) {
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  function bind(name, value) {
    for (const node of document.querySelectorAll(`[data-bind="${name}"]`)) node.textContent = value;
  }

  // ---------- formatting (DESIGN.md §2: tabular, value + space + unit, true minus) ----------
  function num(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unknown';
    const text = Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
    return text.replace('-', '−');
  }

  function words(identifier) {
    return String(identifier).replaceAll('_', ' ');
  }

  // ---------- data access (field reads only) ----------
  function windowsOf(name) {
    return state.data.scenarios[name].replay.observations.map((obs, i) => ({
      index: i + 1,
      elapsed: obs.elapsed_seconds,
      rms: obs.reported_summary_features.rms_microvolts,
      mf: obs.reported_summary_features.median_frequency_hz,
      status: obs.signal_quality.status,
      acceptable: ACCEPTABLE.has(obs.signal_quality.status),
      flags: obs.signal_quality.flags,
      score: obs.signal_quality.reported_score,
    }));
  }

  // One shared y-range per metric across all scenarios, so switching scenarios keeps the scale.
  // Display scaling only: it covers the windows that pass the quality check, padded to whole steps.
  function sharedRanges() {
    const ranges = {};
    for (const metric of METRICS) {
      const values = [];
      for (const name of state.data.scenario_order) {
        for (const w of windowsOf(name)) if (w.acceptable) values.push(w[metric.key]);
      }
      const lo = Math.floor((Math.min(...values) - 2) / metric.step) * metric.step;
      const hi = Math.ceil((Math.max(...values) + 2) / metric.step) * metric.step;
      ranges[metric.key] = { lo, hi, step: metric.step };
    }
    return ranges;
  }

  // Runtime guard: the explanation sentence may only quote numbers that are in the data.
  function assertSentenceMatchesData(name, windows, sentence) {
    const allowed = new Set();
    for (const w of windows) [w.index, w.rms, w.mf].forEach((v) => allowed.add(Number(v)));
    const quoted = (sentence.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    const unknown = quoted.filter((v) => !allowed.has(v));
    if (unknown.length) console.error(`Explanation for ${name} quotes numbers not in the data: ${unknown.join(', ')}`);
  }

  // ---------- static facts (sensor cards, placement, provenance) ----------
  function renderStatic() {
    const data = state.data;
    const capture = data.capture_example;
    const config = capture.configuration;
    const firstObs = data.scenarios[data.scenario_order[0]].replay.observations[0];
    const fixtureMuscles = new Set();
    for (const name of data.scenario_order) {
      for (const obs of data.scenarios[name].replay.observations) fixtureMuscles.add(obs.metadata.muscle);
    }
    bind('device', config.device_id);
    bind('fixture-muscle', [...fixtureMuscles].join(', '));
    bind('capture-muscle', config.muscle);
    bind('channel-count', String(config.channels.length));
    bind('channel-range', `${config.channels[0]}–${config.channels[config.channels.length - 1]}`);
    bind('emg-rate', `${num(config.emg_sample_rate_hz)} Hz`);
    bind('imu-rate', `${num(config.imu_sample_rate_hz)} Hz`);
    bind('imu-axes', String(config.imu_axes));
    const p = capture.processing_defaults;
    bind('motion-threshold', `${num(p.motion_dynamic_rms_m_s2)} m/s²`);

    const ex = capture.excerpt;
    bind('waveform-label', capture.label);
    bind('waveform-relation', capture.relation_to_scenarios);
    bind('emg-channel', ex.emg.channel);
    bind('excerpt-seconds', `${num(ex.duration_s)} s`);
    bind('emg-decimation',
      `${num(ex.emg.source_rate_hz)} Hz decimated for display to ${num(ex.emg.display_rate_hz)} Hz (every ${ex.emg.decimation}th sample)`);
    bind('imu-trace-rate', `${num(ex.imu.source_rate_hz)} Hz, all samples`);
    const prov = capture.provenance;
    bind('capture-provenance',
      `${prov.generator} · seed ${prov.seed} · actual_sensor: ${prov.actual_sensor} · ` +
      `${num(capture.capture_request.duration_s)} s capture · ${config.protocol} · ${config.conditions}`);

    const fx = data.fixture;
    bind('provenance',
      `Fixture ${fx.file} · seed ${fx.fixed_seed} · sha256 ${fx.dataset_sha256.slice(0, 10)}… · ` +
      `${firstObs.provenance.kind.replaceAll('_', ' ')} · random ids replaced with stable ones`);
  }

  // ---------- scenario switch ----------
  function renderSwitch() {
    const group = document.getElementById('scenario-switch');
    group.replaceChildren();
    for (const name of state.data.scenario_order) {
      const button = h('button', { type: 'button', class: 'mm-btn', 'data-scenario': name, 'aria-pressed': 'false', text: name });
      button.addEventListener('click', () => select(name, true));
      button.addEventListener('keydown', onSwitchKey);
      group.append(button);
    }
  }

  function onSwitchKey(event) {
    const order = state.data.scenario_order;
    const current = order.indexOf(event.currentTarget.dataset.scenario);
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % order.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(order[next], true);
    document.querySelector(`#scenario-switch [data-scenario="${order[next]}"]`).focus();
  }

  function scenarioFromUrl() {
    const order = state.data.scenario_order;
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    const fromHash = hash.startsWith('scenario=') ? hash.slice('scenario='.length) : hash;
    if (order.includes(fromHash)) return fromHash;
    const fromQuery = new URLSearchParams(location.search).get('scenario');
    if (order.includes(fromQuery)) return fromQuery;
    return order[0];
  }

  function select(name, updateUrl) {
    if (!state.data.scenario_order.includes(name)) return;
    state.scenario = name;
    for (const button of document.querySelectorAll('#scenario-switch [data-scenario]')) {
      button.setAttribute('aria-pressed', String(button.dataset.scenario === name));
    }
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.delete('scenario');
      url.hash = `scenario=${name}`;
      history.replaceState(null, '', url);
    }
    renderScenario();
  }

  // ---------- scenario facts, strip and sentence ----------
  function renderScenario() {
    const name = state.scenario;
    const entry = state.data.scenarios[name];
    const report = entry.replay;
    const observations = report.observations;
    const windows = windowsOf(name);
    document.documentElement.dataset.scenario = name;

    bind('scenario-name', report.scenario_label);
    const baselines = [...new Set(observations.map((o) => o.baseline_comparison.status))];
    const indicators = [...new Set(observations.map((o) => o.research_indicator.status))];
    const honest = baselines.length === 1 && baselines[0] === 'not_available' && indicators.length === 1 && indicators[0] === 'not_assessed';
    bind('honesty', honest ? 'No baseline comparison · no diagnosis'
      : `Baseline comparison: ${baselines.join(', ')} · research indicator: ${indicators.join(', ')}`);

    const first = observations[0];
    const interval = first.local_schedule.interval_seconds;
    bind('meta', `${observations.length} windows · ${interval} s each · ${first.metadata.activity} · ` +
      `${first.metadata.protocol} · ${MODE_TEXT[report.mode] || words(report.mode)}`);

    const reasons = [...new Set(observations.map((o) => o.baseline_comparison.reason).filter(Boolean))];
    const rawValidation = [...new Set(observations.map((o) => o.signal_quality.raw_signal_validation))];
    const missing = [...new Set(observations.flatMap((o) => o.missing_measurements))];
    bind('fields',
      `baseline_comparison: ${baselines.join(', ')}${reasons.length ? ` (${reasons.join('; ')})` : ''} · ` +
      `research_indicator: ${indicators.join(', ')} · raw_signal_validation: ${rawValidation.join(', ')}`);
    bind('missing', `Not in the fixture windows: ${missing.join(', ')}.`);

    assertSentenceMatchesData(name, windows, entry.explanation);
    bind('explanation', entry.explanation);

    renderStrip(windows);
  }

  function renderStrip(windows) {
    const strip = document.getElementById('strip');
    strip.replaceChildren();
    const place = (node, column, row) => {
      node.style.gridColumn = String(column);
      node.style.gridRow = String(row);
      return node;
    };

    // Hatched backdrop through the whole column of each window that failed the quality check.
    for (const w of windows) {
      if (w.acceptable) continue;
      const fault = h('div', { class: 'strip__fault', 'data-fault-window': w.index, 'aria-hidden': 'true' });
      fault.style.gridColumn = String(w.index + 1);
      strip.append(fault);
    }

    strip.append(place(h('div', { class: 'strip__window', 'aria-hidden': 'true' }), 1, 1));
    for (const w of windows) {
      strip.append(place(h('div', { class: 'strip__window' }, [
        h('strong', {}, [h('span', { class: 'w-word', text: 'Window ' }), `${w.index}`]),
        h('span', { class: 'mm-num', 'data-field': 'elapsed', 'data-window': w.index, text: `${w.elapsed} s` }),
      ]), w.index + 1, 1));
    }

    METRICS.forEach((metric, i) => {
      const row = i + 2;
      strip.append(place(h('div', { class: 'strip__label' }, [
        h('b', { text: metric.title }),
        h('span', { text: `${metric.unit} · per window` }),
      ]), 1, row));
      const plot = h('div', { class: 'strip__plot', id: `plot-${metric.key}`, 'data-metric': metric.key });
      plot.style.gridRow = String(row);
      strip.append(plot);
    });

    strip.append(place(h('div', { class: 'strip__label' }, [
      h('b', { text: 'Signal quality' }),
      h('span', { text: 'fixture-reported score' }),
    ]), 1, 4));
    for (const w of windows) strip.append(place(qualityCell(w), w.index + 1, 4));

    drawStripCharts(windows);
  }

  function qualityCell(w) {
    const cell = h('div', { class: 'strip__quality', 'data-field': 'quality', 'data-window': w.index, 'data-status': w.status });
    if (w.acceptable) {
      cell.append(h('span', { class: 'q-status q-status--ok' }, [h('span', { class: 'q-icon', 'aria-hidden': 'true', text: '✓' }), 'Acceptable']));
      if (w.status === 'fixture_reported_acceptable') cell.append(h('span', { text: 'fixture-reported' }));
    } else if (w.status === 'unsuitable') {
      cell.append(h('span', { class: 'q-status q-status--bad' }, [h('span', { class: 'q-icon', 'aria-hidden': 'true', text: '!' }), 'Unsuitable']));
      for (const flag of w.flags) cell.append(h('span', { class: 'flag', 'data-field': 'flag', text: flag }));
    } else {
      cell.append(h('span', { class: 'q-status' }, [h('span', { class: 'q-icon', 'aria-hidden': 'true', text: '?' }), words(w.status)]));
    }
    cell.append(h('span', { class: 'mm-num', 'data-field': 'score', text: `score ${w.score}` }));
    return cell;
  }

  function drawStripCharts(windows) {
    for (const metric of METRICS) {
      const plot = document.getElementById(`plot-${metric.key}`);
      if (plot) drawIndicator(plot, windows, metric, state.ranges[metric.key]);
    }
  }

  // Layout size in CSS px (unaffected by the large-screen zoom), so SVG text keeps its token size.
  function boxSize(node) {
    return { width: node.clientWidth, height: node.clientHeight };
  }

  function drawIndicator(plot, windows, metric, range) {
    const { width, height } = boxSize(plot);
    if (width < 40 || height < 40) return;
    const top = 30;
    const bottom = 14;
    const x = (i) => ((i - 0.5) / windows.length) * width;
    const y = (v) => top + (1 - (v - range.lo) / (range.hi - range.lo)) * (height - top - bottom);
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-label': `${metric.title} in ${metric.unit} for ${windows.length} windows` });

    for (let v = range.lo; v <= range.hi; v += range.step) {
      svg.append(s('line', { class: 'c-grid', x1: 34, x2: width, y1: y(v).toFixed(1), y2: y(v).toFixed(1) }));
      svg.append(s('text', { class: 'c-tick', x: 4, y: (y(v) + 4).toFixed(1), text: num(v) }));
    }

    const marks = s('g', { class: 'plot-in' });
    // Lines join consecutive windows that pass the quality check; a failed window breaks the line.
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        marks.append(s('polyline', { class: 'c-line', points: run.map((w) => `${x(w.index).toFixed(1)},${y(w[metric.key]).toFixed(1)}`).join(' ') }));
      }
      run = [];
    };
    for (const w of windows) {
      if (w.acceptable) run.push(w);
      else flush();
    }
    flush();

    for (const w of windows) {
      const value = w[metric.key];
      if (w.acceptable) {
        const g = s('g', {}, [s('title', { text: `Window ${w.index} · ${w.elapsed} s · ${metric.title} ${num(value)} ${metric.unit}` })]);
        g.append(s('circle', { class: 'c-point', cx: x(w.index).toFixed(1), cy: y(value).toFixed(1), r: 5 }));
        g.append(s('text', { class: 'c-value', x: x(w.index).toFixed(1), y: (y(value) - 12).toFixed(1), 'text-anchor': 'middle',
          'data-field': metric.key, 'data-window': w.index, 'data-value': value }, [
          num(value), s('tspan', { class: 'c-value-unit', text: ` ${metric.unit}` }),
        ]));
        marks.append(g);
      } else {
        const cy = top + (height - top - bottom) / 2;
        marks.append(s('text', { class: 'c-reported', x: x(w.index).toFixed(1), y: cy.toFixed(1), 'text-anchor': 'middle',
          'data-field': metric.key, 'data-window': w.index, 'data-value': value, 'data-plotted': 'false' }, [
          num(value), s('tspan', { class: 'c-value-unit', text: ` ${metric.unit}` }),
        ]));
        // Narrow columns get the note on two lines.
        const lines = width / windows.length < 130 ? ['reported', 'not plotted'] : ['reported · not plotted'];
        lines.forEach((line, k) => marks.append(s('text', { class: 'c-reported-note', x: x(w.index).toFixed(1),
          y: (cy + 17 + 13 * k).toFixed(1), 'text-anchor': 'middle', text: line })));
      }
    }
    svg.append(marks);
    plot.replaceChildren(svg);
  }

  // ---------- capture example traces ----------
  function niceSymmetric(values, step) {
    const peak = Math.max(...values.map((v) => Math.abs(v)));
    return Math.max(step, Math.ceil(peak / step) * step);
  }

  function drawTrace(container, series, limit, unit, seconds) {
    const { width, height } = boxSize(container);
    if (width < 40 || height < 30) return;
    const left = 46;
    const pad = 8;
    const y = (v) => pad + (1 - (v + limit) / (2 * limit)) * (height - 2 * pad);
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-label': `Synthetic illustrative trace, ${seconds} s, ${unit}` });
    svg.append(s('line', { class: 'c-zero', x1: left, x2: width - 6, y1: y(0).toFixed(1), y2: y(0).toFixed(1) }));
    const ticks = height >= 72 ? [limit, 0, -limit] : [limit, -limit];
    for (const v of ticks) {
      svg.append(s('text', { class: 'c-tick', x: 6, y: (y(v) + (v === limit ? 9 : v === -limit ? -1 : 4)).toFixed(1), text: v === 0 ? '0' : num(v) }));
    }
    svg.append(s('text', { class: 'c-tick', x: width - 8, y: height - 4, 'text-anchor': 'end', text: `${num(seconds)} s` }));
    for (const { values, cls } of series) {
      const span = Math.max(1, values.length - 1);
      const pts = values.map((v, i) => `${(left + (i / span) * (width - left - 8)).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      svg.append(s('polyline', { class: `c-trace ${cls}`, points: pts }));
    }
    container.replaceChildren(svg);
  }

  function drawTraces() {
    const ex = state.data.capture_example.excerpt;
    const emg = ex.emg.values;
    drawTrace(document.getElementById('trace-emg'), [{ values: emg, cls: 'c-trace--1' }], niceSymmetric(emg, 50), 'µV', ex.duration_s);
    const ax = ex.imu.accel_x;
    const ay = ex.imu.accel_y;
    drawTrace(document.getElementById('trace-imu'), [{ values: ax, cls: 'c-trace--2' }, { values: ay, cls: 'c-trace--3' }],
      niceSymmetric(ax.concat(ay), 0.1), 'm/s²', ex.duration_s);
  }

  // ---------- boot ----------
  let frame = 0;
  function redraw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      drawStripCharts(windowsOf(state.scenario));
      drawTraces();
    });
  }

  async function boot() {
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
    } catch (error) {
      const main = document.querySelector('main');
      main.replaceChildren(h('p', { class: 'load-error', role: 'alert',
        text: `Could not load ${DATA_URL} (${error.message}). Run: python -m astra_patch showcase serve` }));
      console.error(error);
      return;
    }
    state.ranges = sharedRanges();
    renderStatic();
    renderSwitch();
    select(scenarioFromUrl(), false);
    drawTraces();
    window.addEventListener('hashchange', () => select(scenarioFromUrl(), false));
    if ('ResizeObserver' in window) new ResizeObserver(redraw).observe(document.querySelector('.grid'));
    else window.addEventListener('resize', redraw);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
    document.documentElement.dataset.ready = 'true';
  }

  boot();
})();
