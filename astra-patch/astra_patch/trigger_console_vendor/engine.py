"""Deterministic replay engine. The base-service payload is an externally supplied template."""
import copy
import json
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCENARIOS = {
    'normal': [{'rms_uv': 55, 'imu_motion': 0.15, 'quality': 'good', 'contact': 'good'}, {'rms_uv': 58, 'imu_motion': 0.2, 'quality': 'good', 'contact': 'good'}, {'rms_uv': 54, 'imu_motion': 0.18, 'quality': 'good', 'contact': 'good'}],
    'contact_loss': [{'rms_uv': 51, 'imu_motion': 0.2, 'quality': 'good', 'contact': 'good'}, {'rms_uv': 5, 'imu_motion': 0.3, 'quality': 'poor', 'contact': 'poor'}, {'rms_uv': 2, 'imu_motion': 0.1, 'quality': 'poor', 'contact': 'poor'}],
    'activity_shift': [{'rms_uv': 45, 'imu_motion': 0.15, 'quality': 'good', 'contact': 'good'}, {'rms_uv': 82, 'imu_motion': 0.75, 'quality': 'good', 'contact': 'good'}, {'rms_uv': 90, 'imu_motion': 0.85, 'quality': 'good', 'contact': 'good'}],
    'missing_context': [{'rms_uv': 52, 'imu_motion': 0.15, 'quality': 'good', 'contact': 'good'}, {'rms_uv': 57, 'imu_motion': 0.17, 'quality': 'good', 'contact': 'good'}],
}
PLACEHOLDERS = {'round_id', 'sequence', 'event_id', 'scenario', 'observed_at', 'sent_at', 'rms_uv', 'imu_motion', 'quality', 'contact', 'source', 'protocol', 'muscle', 'device_id', 'measurement_condition'}

class ContractError(Exception):
    pass


def render_template(template, values):
    """Replace placeholders inside the partner-provided sample without changing keys/shape."""
    if isinstance(template, dict):
        return {k: render_template(v, values) for k, v in template.items()}
    if isinstance(template, list):
        return [render_template(v, values) for v in template]
    if isinstance(template, str) and template.startswith('{{') and template.endswith('}}'):
        key = template[2:-2].strip()
        if key not in PLACEHOLDERS:
            raise ContractError(f'Unrecognized placeholder: {key}')
        return values[key]
    return template

class ReplayEngine:
    def __init__(self, transport=None):
        if transport is not None:
            raise ValueError("Transport is not part of the offline ASTRA port")
        self.lock = threading.RLock()
        self.transport = transport
        self.scenario = 'normal'
        self.reset()

    def reset(self):
        with self.lock:
            self.round_id = str(uuid.uuid4())
            self.state = 'idle'
            self.index = 0
            self.delivery = 'not_sent'
            self.error = None
            self.last_receipt = None
            self.last_payload = None
            self.history = []
            return self.status()

    def select(self, scenario):
        with self.lock:
            if scenario not in SCENARIOS:
                raise ValueError('Unknown scenario')
            if self.state in ('running','paused'):
                raise ValueError('Reset before changing scenario')
            self.scenario = scenario
            return self.reset()

    def start(self):
        with self.lock:
            if self.state != 'idle':
                raise ValueError('Can start only from idle')
            self.state = 'running'
            return self.status()

    def pause(self):
        with self.lock:
            if self.state != 'running':
                raise ValueError('Can pause only while running')
            self.state = 'paused'
            return self.status()

    def resume(self):
        with self.lock:
            if self.state != 'paused':
                raise ValueError('Can resume only from paused')
            self.state = 'running'
            return self.status()

    def tick(self):
        with self.lock:
            self.delivery = 'blocked_no_approved_transport'
            self.error = 'Use the local ASTRA console; network delivery is disabled.'
            return self.status()

    def resend_last(self):
        raise ValueError('Network delivery is disabled in the offline port')

    def status(self):
        with self.lock:
            return {'scenario':self.scenario, 'state':self.state, 'round_id':self.round_id,
                    'sent_count':len(self.history), 'sequence':self.index,
                    'total':len(SCENARIOS[self.scenario]), 'delivery':self.delivery,
                    'error':self.error, 'receipt':self.last_receipt,
                    'connected':self.transport is not None}
