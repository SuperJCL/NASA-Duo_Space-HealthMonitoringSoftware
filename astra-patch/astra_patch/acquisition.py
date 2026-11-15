from typing import Protocol
import numpy as np
from .schema import Session, Recording, utcnow

class SensorSource(Protocol):
    def capture(self, session: Session, duration_s: float, scenario: str) -> Recording: ...

def transition(session, command, now=None):
    now = now or utcnow()
    action = command.action
    transitions = {'arm': ('IDLE', 'ARMED'), 'start': ('ARMED', 'RECORDING'),
                   'motion': ('ARMED', 'RECORDING'), 'schedule': ('ARMED', 'RECORDING'),
                   'pause': ('RECORDING', 'PAUSED'), 'resume': ('PAUSED', 'RECORDING')}
    if action == 'disconnect':
        if session.state in ('COMPLETED', 'ERROR'):
            raise ValueError('Terminal recording state')
        target = 'ERROR'
    elif action == 'complete':
        if session.state not in ('RECORDING', 'PAUSED'):
            raise ValueError('No active recording')
        target = 'COMPLETED'
    else:
        source, target = transitions[action]
        if session.state != source:
            raise ValueError(f'{action} requires {source}')
    if action == 'arm':
        if not command.approved:
            raise ValueError('Explicit acquisition permission required; this is not EVA authorization')
        session.permission_to_record = True
        session.operator = command.operator
    if target == 'RECORDING':
        if not session.permission_to_record:
            raise ValueError('Acquisition permission missing')
        if action == 'motion' and command.acceleration_m_s2 < session.configuration.motion_threshold_m_s2:
            raise ValueError('Below configured motion threshold')
        if action == 'schedule' and (session.configuration.scheduled_at is None or now < session.configuration.scheduled_at):
            raise ValueError('Scheduled assessment not due')
        if session.started_at is None:
            session.started_at = now
            session.trigger = {'start': 'manual', 'motion': 'imu_motion', 'schedule': 'scheduled'}[action]
    session.state = target
    session.events.append({'at': now.isoformat(), 'event': action, 'operator': command.operator, 'state': target})
    return session

class SyntheticSource:
    """Seeded illustrative waveforms, not hardware specifications or health measurements."""
    def capture(self, session, duration_s, scenario='normal'):
        if session.state != 'RECORDING':
            raise ValueError('Capture requires RECORDING')
        c = session.configuration
        rng = np.random.default_rng(c.seed)
        t = np.arange(round(duration_s*c.emg_sample_rate_hz))/c.emg_sample_rate_hz
        ti = np.arange(round(duration_s*c.imu_sample_rate_hz))/c.imu_sample_rate_hz
        emg = np.column_stack([65*np.sin(2*np.pi*(75+i*17)*t)+rng.normal(0,8,len(t)) for i in range(len(c.channels))])
        imu = np.column_stack([.15*np.sin(2*np.pi*ti), .1*np.cos(2*np.pi*ti), 9.80665+.1*np.sin(4*np.pi*ti), .02*np.sin(ti), .01*np.cos(ti), .01*np.sin(2*ti)])
        if scenario == 'flatline': emg[:, 0] = 0
        if scenario == 'saturation': emg[:100, 0] = 5000
        if scenario == 'artifact': emg += 600*np.sin(2*np.pi*3*t[:, None]); imu[:, 0] += 5*np.sin(2*np.pi*3*ti)
        sequence = np.arange(len(t))
        if scenario == 'drop':
            keep = sequence != 25
            emg, t, sequence = emg[keep], t[keep], sequence[keep]
        data = emg.tolist()
        if scenario == 'missing': data[25][0] = None
        return Recording(session_id=session.session_id, source_type='synthetic', subject_id=c.astronaut_id,
            astronaut_id=c.astronaut_id, device_id=c.device_id, muscle=c.muscle, protocol=c.protocol,
            conditions=c.conditions, sensor_configuration=c.sensor_configuration, trigger=session.trigger,
            started_at=session.started_at, emg_sample_rate_hz=c.emg_sample_rate_hz,
            imu_sample_rate_hz=c.imu_sample_rate_hz, emg_units='microvolts', channels=c.channels,
            emg=data, emg_time_s=t.tolist(), emg_sequence=sequence.tolist(), imu=imu.tolist(),
            imu_time_s=ti.tolist(), imu_sequence=list(range(len(ti))),
            quality={'contact': scenario != 'contact', 'adc_limit_microvolts': 5000, 'scenario': scenario},
            provenance={'generator': 'myomars-synthetic-v1', 'seed': c.seed, 'actual_sensor': False, 'preprocessing': []})
