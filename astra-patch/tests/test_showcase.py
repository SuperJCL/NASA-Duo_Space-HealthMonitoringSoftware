"""Showcase page: reproducible data file, equal to the replay CLI, honest labels, read-only server."""
import json
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pytest

from astra_patch import showcase
from astra_patch.replay import SCENARIOS

ROOT = Path(__file__).resolve().parents[1]
PAGE_FILES = [showcase.SHOWCASE_DIR / name for name in ('index.html', 'app.js', 'style.css')]
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
ISO_TIME = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')


def cli(*args, cwd=ROOT):
    result = subprocess.run([sys.executable, '-m', 'astra_patch', *args], cwd=cwd, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr
    return result.stdout


@pytest.fixture(scope='module')
def committed():
    return json.loads(showcase.DATA_FILE.read_text(encoding='utf-8'))


def test_build_command_regenerates_the_committed_file_byte_for_byte(tmp_path):
    first, second = tmp_path / 'a.json', tmp_path / 'b.json'
    cli('showcase', 'build', '--out', str(first))
    cli('showcase', 'build', '--out', str(second))
    assert first.read_bytes() == second.read_bytes() == showcase.DATA_FILE.read_bytes()


def test_data_file_has_no_volatile_values():
    text = showcase.DATA_FILE.read_text(encoding='utf-8')
    assert not UUID.search(text)
    assert not ISO_TIME.search(text)
    assert list(json.loads(text)) == sorted(json.loads(text))


@pytest.mark.parametrize('scenario', SCENARIOS)
def test_data_file_equals_replay_cli_output(committed, scenario):
    report = json.loads(cli('replay', '--scenario', scenario))
    stored = committed['scenarios'][scenario]['replay']
    # Whole report: equal after replacing only the documented volatile fields.
    assert showcase.normalize_report(report) == stored
    # And the displayed values directly, without any normalisation.
    for live, kept in zip(report['observations'], stored['observations'], strict=True):
        assert live['reported_summary_features'] == kept['reported_summary_features']
        assert live['signal_quality'] == kept['signal_quality']
        assert live['elapsed_seconds'] == kept['elapsed_seconds']
        assert live['baseline_comparison'] == kept['baseline_comparison']
        assert live['research_indicator'] == kept['research_indicator']
    changed = {key for live, kept in zip(report['observations'], stored['observations']) for key in live if live[key] != kept[key]}
    assert changed <= set(showcase.NORMALIZATION['replaced_fields'])


def facts(committed, scenario):
    rows = committed['scenarios'][scenario]['replay']['observations']
    rms = [r['reported_summary_features']['rms_microvolts'] for r in rows]
    mf = [r['reported_summary_features']['median_frequency_hz'] for r in rows]
    bad = [i for i, r in enumerate(rows, 1) if r['signal_quality']['status'] == 'unsuitable']
    good = [i for i in range(1, len(rows) + 1) if i not in bad]
    flags = {f for r in rows for f in r['signal_quality']['flags']}
    return rows, rms, mf, good, bad, flags


def g(value):
    return f'{value:g}'


@pytest.mark.parametrize('scenario', SCENARIOS)
def test_explanation_sentences_agree_with_the_data(committed, scenario):
    sentence = committed['scenarios'][scenario]['explanation']
    assert sentence == showcase.EXPLANATIONS[scenario]
    rows, rms, mf, good, bad, flags = facts(committed, scenario)
    allowed = {float(v) for v in [*range(1, len(rows) + 1), *rms, *mf]}
    assert {float(n) for n in re.findall(r'\d+(?:\.\d+)?', sentence)} <= allowed
    for word in ('fatigue', 'fatigued', 'injury', 'healthy', 'recovered', 'diagnos'):
        assert word not in sentence.lower()
    if scenario == 'normal':
        assert bad == [] and flags == set()
        assert 'All four windows pass the quality check with no flags' in sentence
        assert f'RMS {g(min(rms))}–{g(max(rms))} µV' in sentence
        assert f'median frequency {g(min(mf))}–{g(max(mf))} Hz' in sentence
    elif scenario == 'fatigue_suspected':
        assert bad == [] and flags == set()
        assert rms == sorted(rms) and mf == sorted(mf, reverse=True)
        assert f'RMS rises from {g(rms[0])} to {g(rms[-1])} µV' in sentence
        assert f'median frequency falls from {g(mf[0])} to {g(mf[-1])} Hz' in sentence
        assert 'nothing is flagged' in sentence and 'no baseline comparison' in sentence
    else:
        assert good == [1, 2] and bad == [3, 4]
        assert flags == {'motion_artifact', 'electrode_contact_fault'}
        assert all(rows[i - 1]['signal_quality']['flags'] == ['motion_artifact', 'electrode_contact_fault'] for i in bad)
        assert 'Windows 1–2 pass the quality check' in sentence and 'Windows 3–4 fail it' in sentence
        assert 'motion artifact and electrode contact fault flags' in sentence
        assert f'RMS {g(min(rms[:2]))}–{g(max(rms[:2]))} µV, median frequency {g(min(mf[:2]))}–{g(max(mf[:2]))} Hz' in sentence
        assert f'({g(rms[2])} and {g(rms[3])} µV, {g(mf[2])} and {g(mf[3])} Hz)' in sentence
        assert all(rows[i - 1]['evidence_problem'] == 'sensor_quality' for i in bad)
        assert 'signal problems, not as muscle changes' in sentence
    assert all(r['baseline_comparison']['status'] == 'not_available' for r in rows)
    assert all(r['research_indicator']['status'] == 'not_assessed' for r in rows)


def test_waveform_excerpt_is_the_capture_path_output_and_labelled(committed):
    from astra_patch.acquisition import SyntheticSource, transition
    from astra_patch.schema import Configuration, Session, Transition

    example = committed['capture_example']
    assert example['label'] == "Synthetic illustrative signal from the demo's capture path"
    assert 'not the source of these numbers' in example['relation_to_scenarios']
    assert example['provenance']['actual_sensor'] is False
    session = Session(configuration=Configuration(astronaut_id='independent-check'))
    transition(session, Transition(action='arm', operator='test', approved=True))
    transition(session, Transition(action='start', operator='test'))
    recording = SyntheticSource().capture(session, 2, 'normal')
    emg, imu = np.asarray(recording.emg), np.asarray(recording.imu)
    excerpt = example['excerpt']
    assert excerpt['emg']['decimation'] == 4 and 'decimated for display' in excerpt['emg']['note']
    assert excerpt['emg']['values'] == [round(float(v), 2) for v in emg[:2000:4, 0]]
    assert excerpt['imu']['accel_x'] == [round(float(v), 4) for v in imu[:100, 0]]
    assert excerpt['imu']['accel_y'] == [round(float(v), 4) for v in imu[:100, 1]]
    assert example['configuration']['emg_sample_rate_hz'] == 2000 and example['configuration']['imu_sample_rate_hz'] == 100
    assert example['configuration']['muscle'] == 'left_quadriceps' and example['configuration']['emg_units'] == 'microvolts'
    fixture_rows = [r for s in SCENARIOS for r in committed['scenarios'][s]['replay']['observations']]
    assert {r['signal_quality']['raw_signal_validation'] for r in fixture_rows} == {'unavailable'}
    assert {r['metadata']['muscle'] for r in fixture_rows} == {'vastus_lateralis_demo'}


def test_page_loads_only_its_own_files():
    allowed = {'http://www.w3.org/2000/svg'}  # SVG namespace identifier, not a request
    for path in PAGE_FILES:
        text = path.read_text(encoding='utf-8')
        assert set(re.findall(r'(?:https?|wss?)://[^\s\'"`)]+', text)) <= allowed, path
        for port in ('3000', '8787', '8788', '8142'):
            assert f':{port}' not in text, path
    script = (showcase.SHOWCASE_DIR / 'app.js').read_text(encoding='utf-8')
    assert script.count('fetch(') == 1 and "DATA_URL = 'data/showcase.json'" in script
    html = (showcase.SHOWCASE_DIR / 'index.html').read_text(encoding='utf-8')
    assert 'ASTRA patch · how the sensor demo works' in html
    assert 'Synthetic data</span>' in html and 'Standalone demo</span>' in html
    assert 'not connected to the Mars Base or the HUD' in html


@pytest.fixture
def server():
    httpd = showcase.make_server('127.0.0.1', 0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{httpd.server_address[1]}'
    finally:
        httpd.shutdown()
        httpd.server_close()


def fetch(url, method='GET'):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=10) as response:
            return response.status, response.headers, response.read()  # case-insensitive header access
    except urllib.error.HTTPError as error:
        return error.code, error.headers, b''


def test_server_serves_the_page_read_only(server):
    status, headers, body = fetch(server + '/')
    assert status == 200 and b'ASTRA patch' in body
    assert "connect-src 'self'" in headers['Content-Security-Policy']
    status, _, body = fetch(server + '/data/showcase.json')
    assert status == 200 and body == showcase.DATA_FILE.read_bytes()
    status, headers, _ = fetch(server + '/assets/fonts/geist-latin.woff2')
    assert status == 200 and headers['Content-Type'] == 'font/woff2'
    assert fetch(server + '/data/')[0] == 404  # no directory listings
    assert fetch(server + '/', method='POST')[0] == 501
    assert fetch(server + '/', method='PUT')[0] == 501
    assert fetch(server + '/%2e%2e/astra_patch/showcase.py')[0] == 404


def test_replay_and_check_commands_are_unchanged():
    usage = cli('--help')
    assert '{replay,check,showcase}' in usage
    replay_help = cli('replay', '--help')
    assert '--scenario {normal,fatigue_suspected,sensor_fault}' in replay_help
