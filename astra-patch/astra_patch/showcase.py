"""Standalone visual showcase page for the ASTRA patch demo (synthetic data, local only).

`build_data()` runs the SAME replay code path as `python -m astra_patch replay` for the three
fixture scenarios (`replay.replay_report`: console create, start, four ticks, observations, in a
temporary database) and calls the existing synthetic capture path in-process
(`acquisition.SyntheticSource.capture`) for a short illustrative waveform excerpt. Nothing is
analysed here: the page (showcase/app.js) only displays the file this module writes.

`serve()` serves the showcase folder read-only with the Python standard library. The page loads
only its own files; it never connects to the Mars Base, the HUD or the relay.
"""
import copy
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

from .replay import SCENARIOS, replay_report

PACKAGE_DIR = Path(__file__).resolve().parent
SHOWCASE_DIR = PACKAGE_DIR.parent / 'showcase'
DATA_FILE = SHOWCASE_DIR / 'data' / 'showcase.json'
FIXTURE_DIR = PACKAGE_DIR / 'scenario_fixtures'
FIXTURE_FILE = 'scenario_windows.csv'
MANIFEST_FILE = 'scenario_manifest.json'

WAVEFORM_LABEL = "Synthetic illustrative signal from the demo's capture path"
WAVEFORM_RELATION = ('The scenario windows are summary features only; the waveform below is a separate '
                     'synthetic capture example, not the source of these numbers.')
EXCERPT_SECONDS = 1.0
EMG_DECIMATION = 4  # 2000 Hz -> 500 Hz, for display only
EMG_DECIMALS = 2
IMU_DECIMALS = 4

# One plain sentence (or two) per scenario. tests/test_showcase.py checks every claim and number
# in these sentences against the replay output, so they cannot drift from the data.
EXPLANATIONS = {
    'normal': ('All four windows pass the quality check with no flags, and both summary features stay '
               'within a narrow range: RMS 42–44 µV, median frequency 84–86 Hz.'),
    'fatigue_suspected': ('All four windows pass the quality check while RMS rises from 43 to 61 µV and '
                          'median frequency falls from 85 to 66 Hz. Unlike a sensor fault, nothing is '
                          'flagged; the demo still draws no conclusion, because the scenario name is a '
                          'simulated label and there is no baseline comparison.'),
    'sensor_fault': ('Windows 1–2 pass the quality check (RMS 42–43 µV, median frequency 85–86 Hz). '
                     'Windows 3–4 fail it with motion artifact and electrode contact fault flags, so '
                     'their values (132 and 175 µV, 18 and 11 Hz) are reported as signal problems, '
                     'not as muscle changes.'),
}

# Volatile values in the replay output (random UUIDs, wall-clock import time) are replaced so the
# data file is reproducible byte for byte. Every other field is the replay output unchanged.
NORMALIZATION = {
    'note': ('Volatile values in the replay output are replaced with stable ones so the file is '
             'reproducible; every other field is the replay output unchanged.'),
    'replaced_fields': {
        'observation_id': '<scenario>-observation-<window> (was a random UUID)',
        'session_id': '<scenario>-session-<window> (was a random UUID)',
        'replay_round_id': '<scenario>-round (was a random UUID)',
        'event_id': '<scenario>-round:<window> (was <round UUID>:<window>)',
        'imported_at': 'null (was the wall-clock import time of the build)',
    },
}


def normalize_report(report):
    """Return a copy of a replay report with volatile ids and wall-clock times made stable."""
    result = copy.deepcopy(report)
    scenario = result['scenario_label']
    for window, observation in enumerate(result['observations'], start=1):
        round_id = observation['replay_round_id']
        if observation['event_id'] != f'{round_id}:{window}':
            raise ValueError('Unexpected replay event id format')
        observation.update(observation_id=f'{scenario}-observation-{window}', session_id=f'{scenario}-session-{window}',
                           replay_round_id=f'{scenario}-round', event_id=f'{scenario}-round:{window}', imported_at=None)
    return result


def capture_example():
    """Short excerpt of the API capture path's seeded synthetic waveform (not tied to the scenarios)."""
    from .acquisition import SyntheticSource, transition
    from .processing import ProcessingConfig
    from .schema import Capture, Configuration, Session, Transition

    request = Capture()  # API default capture request
    config = Configuration(astronaut_id='synthetic-showcase-only')
    session = Session(configuration=config)
    transition(session, Transition(action='arm', operator='showcase-build', approved=True))
    transition(session, Transition(action='start', operator='showcase-build'))
    recording = SyntheticSource().capture(session, request.duration_s, request.scenario)
    emg = np.asarray(recording.emg, dtype=float)
    imu = np.asarray(recording.imu, dtype=float)
    emg_samples = int(round(EXCERPT_SECONDS * recording.emg_sample_rate_hz))
    imu_samples = int(round(EXCERPT_SECONDS * recording.imu_sample_rate_hz))
    processing = ProcessingConfig()
    return {
        'label': WAVEFORM_LABEL,
        'relation_to_scenarios': WAVEFORM_RELATION,
        'source': 'astra_patch.acquisition.SyntheticSource.capture, called in-process with the API default capture request',
        'capture_request': {'duration_s': request.duration_s, 'scenario': request.scenario},
        'provenance': recording.provenance,
        'configuration': {'device_id': recording.device_id, 'muscle': recording.muscle, 'protocol': recording.protocol,
                          'conditions': recording.conditions, 'channels': recording.channels,
                          'emg_sample_rate_hz': recording.emg_sample_rate_hz, 'emg_units': recording.emg_units,
                          'imu_sample_rate_hz': recording.imu_sample_rate_hz, 'imu_axes': int(imu.shape[1]),
                          'accel_units': recording.accel_units, 'gyro_units': recording.gyro_units},
        'processing_defaults': {'bandpass_low_hz': processing.low_hz, 'bandpass_high_hz': processing.high_hz,
                                'notch_hz': processing.notch_hz,
                                'motion_dynamic_rms_m_s2': processing.motion_dynamic_rms_m_s2},
        'excerpt': {
            'start_s': 0.0, 'duration_s': EXCERPT_SECONDS,
            'emg': {'channel': recording.channels[0], 'units': recording.emg_units,
                    'source_rate_hz': recording.emg_sample_rate_hz, 'decimation': EMG_DECIMATION,
                    'display_rate_hz': recording.emg_sample_rate_hz / EMG_DECIMATION,
                    'note': f'Every {EMG_DECIMATION}th sample, decimated for display; rounded to {EMG_DECIMALS} decimals',
                    'values': [round(float(v), EMG_DECIMALS) for v in emg[:emg_samples:EMG_DECIMATION, 0]]},
            'imu': {'axes': ['accel_x', 'accel_y'], 'units': recording.accel_units,
                    'source_rate_hz': recording.imu_sample_rate_hz, 'decimation': 1,
                    'note': f'All samples (not decimated); rounded to {IMU_DECIMALS} decimals',
                    'accel_x': [round(float(v), IMU_DECIMALS) for v in imu[:imu_samples, 0]],
                    'accel_y': [round(float(v), IMU_DECIMALS) for v in imu[:imu_samples, 1]]},
        },
    }


def build_data():
    manifest = json.loads((FIXTURE_DIR / MANIFEST_FILE).read_text())
    scenarios = {}
    for scenario in SCENARIOS:
        scenarios[scenario] = {'explanation': EXPLANATIONS[scenario], 'replay': normalize_report(replay_report(scenario))}
    first = scenarios[SCENARIOS[0]]['replay']['observations'][0]
    return {
        'format': 'astra-patch showcase display data v1 (a local file for showcase/index.html, not a message protocol)',
        'generated_by': 'python -m astra_patch showcase build',
        'independence': 'Standalone demo. Not connected to the Mars Base, the HUD or the relay; nothing is transmitted.',
        'normalization': NORMALIZATION,
        'fixture': {'directory': 'astra_patch/scenario_fixtures', 'file': FIXTURE_FILE, 'manifest': MANIFEST_FILE,
                    'dataset_type': manifest['dataset_type'], 'fixed_seed': manifest['fixed_seed'],
                    'window_seconds': manifest['window_seconds'], 'notes': manifest['notes'],
                    'dataset_sha256': first['provenance']['dataset_sha256']},
        'scenario_order': list(SCENARIOS),
        'scenarios': scenarios,
        'capture_example': capture_example(),
    }


def render(data):
    return json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False, allow_nan=False) + '\n'


def write_data(path=None):
    path = Path(path) if path else DATA_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render(build_data()), encoding='utf-8')
    return path


class ShowcaseHandler(SimpleHTTPRequestHandler):
    """GET/HEAD of the showcase files only: no directory listings, no uploads, no proxying."""
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                      '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
                      '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
                      '.svg': 'image/svg+xml', '.woff2': 'font/woff2'}
    # The page may load and fetch only its own files: it cannot reach the Base, HUD or relay ports.
    CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; "
           "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")

    def list_directory(self, path):
        self.send_error(404, 'Not found')
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', self.CSP)
        super().end_headers()


def make_server(host='127.0.0.1', port=8150, directory=SHOWCASE_DIR):
    return ThreadingHTTPServer((host, port), partial(ShowcaseHandler, directory=str(directory)))


def serve(host='127.0.0.1', port=8150, rebuild=False):
    if not (SHOWCASE_DIR / 'index.html').is_file():
        print(f'Showcase page not found at {SHOWCASE_DIR}; run from a full astra-patch checkout.')
        return 1
    if rebuild or not DATA_FILE.is_file():
        print(f'Wrote {write_data()}')
    try:
        server = make_server(host, port)
    except OSError as exc:
        print(f'Cannot listen on {host}:{port}: {exc}. Choose another port with --port.')
        return 1
    print(f'ASTRA patch showcase (synthetic data, standalone): http://{host}:{server.server_address[1]}/')
    print('Serving showcase/ read-only. Press Ctrl+C to stop.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
    finally:
        server.server_close()
    return 0
