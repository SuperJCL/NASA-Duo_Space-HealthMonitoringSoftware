"""Acceptance checks with only the Python package copied outside the repository."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


@pytest.fixture
def detached(tmp_path):
    source = Path(__file__).resolve().parents[1] / 'astra_patch'
    shutil.copytree(source, tmp_path / 'astra_patch', ignore=shutil.ignore_patterns('__pycache__'))
    assert not (tmp_path.parent / 'contracts').exists()
    return tmp_path


def run(detached, *args):
    env = dict(os.environ, PYTHONPATH=str(detached), PYTHONDONTWRITEBYTECODE='1')
    return subprocess.run([sys.executable, *args], cwd=detached, env=env,
                          capture_output=True, text=True, timeout=30)


@pytest.mark.parametrize('scenario', ['normal', 'fatigue_suspected', 'sensor_fault'])
def test_detached_scenario_replay(detached, scenario):
    result = run(detached, '-m', 'astra_patch', 'replay', '--scenario', scenario)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report['scenario_label'] == scenario
    assert report['external_submission'] == 'disabled'
    assert report['contract_validation'] == 'not_performed'
    assert len(report['observations']) == 4
    qualities = [o['signal_quality']['status'] for o in report['observations']]
    if scenario == 'sensor_fault':
        assert qualities[-2:] == ['unsuitable', 'unsuitable']
    else:
        assert set(qualities) == {'fixture_reported_acceptable'}


def test_detached_api_startup_and_auth(detached):
    result = run(detached, '-c', '''
from fastapi.testclient import TestClient
from astra_patch.service import app
with TestClient(app) as client:
    assert client.get('/docs').status_code == 200
    assert client.get('/openapi.json').status_code == 200
    assert client.post('/api/myomars/v1/sessions', json={}).status_code in (401,503)
''')
    assert result.returncode == 0, result.stderr


def test_detached_explicit_contract_check_fails(detached):
    (detached / 'message.json').write_text('{"type":"observation.submitted"}')
    result = run(detached, '-m', 'astra_patch', 'check', 'message.json')
    assert result.returncode == 2
    report = json.loads(result.stdout)
    assert report['valid'] is False and report['errors']
    assert report['external_submission'] == 'disabled'
