from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import os
import hmac
from .schema import Configuration, Session, Transition, Capture
from .acquisition import transition, SyntheticSource
from .store import database, event

def acquisition_auth(credentials: HTTPAuthorizationCredentials | None = Depends(HTTPBearer(auto_error=False))):
    token = os.environ.get('MYOMARS_ACQUISITION_TOKEN', '')
    if len(token) < 16:
        raise HTTPException(503, 'Configure MYOMARS_ACQUISITION_TOKEN (at least 16 characters)')
    if credentials is None or not hmac.compare_digest(credentials.credentials, token):
        raise HTTPException(401, 'Acquisition credentials required')

router = APIRouter(prefix='/api/myomars/v1', tags=['MyoMars data pipeline'], dependencies=[Depends(acquisition_auth)])

def load_session(conn, session_id):
    row = conn.execute('SELECT payload FROM myo_sessions WHERE id=?', (str(session_id),)).fetchone()
    if row is None: raise HTTPException(404, 'Session not found')
    return Session.model_validate_json(row['payload'])

@router.post('/sessions', status_code=201)
def create_session(config: Configuration):
    session = Session(configuration=config)
    with database() as conn:
        conn.execute('INSERT INTO myo_sessions VALUES(?,?)', (str(session.session_id), session.model_dump_json()))
        event(conn, session.session_id, 'created', {'source_type': 'synthetic'})
    return session

@router.get('/sessions/{session_id}')
def get_session(session_id: UUID):
    with database() as conn: return load_session(conn, session_id)

@router.post('/sessions/{session_id}/transition')
def change_state(session_id: UUID, command: Transition):
    with database() as conn:
        session = load_session(conn, session_id)
        if command.action == 'complete' and conn.execute('SELECT 1 FROM myo_recordings WHERE id=?',(str(session_id),)).fetchone() is None:
            raise HTTPException(409, 'Capture data before completion')
        try: session = transition(session, command)
        except ValueError as exc: raise HTTPException(409, str(exc))
        conn.execute('UPDATE myo_sessions SET payload=? WHERE id=?', (session.model_dump_json(), str(session_id)))
        event(conn, session_id, command.action, session.events[-1])
    return session

@router.post('/sessions/{session_id}/capture', status_code=201)
def capture(session_id: UUID, request: Capture):
    with database() as conn:
        session = load_session(conn, session_id)
        if conn.execute('SELECT 1 FROM myo_recordings WHERE id=?', (str(session_id),)).fetchone():
            raise HTTPException(409, 'Immutable recording already stored; use a new session')
        try: recording = SyntheticSource().capture(session, request.duration_s, request.scenario)
        except ValueError as exc: raise HTTPException(409, str(exc))
        conn.execute('INSERT INTO myo_recordings VALUES(?,?)', (str(session_id), recording.model_dump_json()))
        event(conn, session_id, 'recorded', {'samples':len(recording.emg), 'source_type':recording.source_type})
    return {'session_id':session_id, 'samples':len(recording.emg), 'raw_reference':f'/api/myomars/v1/sessions/{session_id}/recording'}

@router.get('/sessions/{session_id}/recording')
def get_recording(session_id: UUID, offset: int = 0, limit: int = 1000):
    if offset < 0 or not 1 <= limit <= 10000: raise HTTPException(422, 'Invalid chunk range')
    import json
    with database() as conn:
        row = conn.execute('SELECT payload FROM myo_recordings WHERE id=?', (str(session_id),)).fetchone()
        if row is None: raise HTTPException(404, 'Recording not found')
        data = json.loads(row['payload'])
    total = len(data['emg'])
    for field in ('emg', 'emg_time_s', 'emg_sequence'): data[field] = data[field][offset:offset+limit]
    return {'recording':data, 'offset':offset, 'total_emg_samples':total, 'next_offset':offset+limit if offset+limit < total else None}

from .schema import Recording
from .processing import ProcessRequest, process

@router.post('/sessions/{session_id}/recording', status_code=201)
def ingest_recording(session_id: UUID, recording: Recording):
    """Acquisition-client handoff. This prototype accepts synthetic sensor sources only."""
    with database() as conn:
        session=load_session(conn,session_id)
        if session.state!='RECORDING': raise HTTPException(409,'Recording session is not active')
        c=session.configuration
        expected={'session_id':session_id,'source_type':'synthetic','subject_id':c.astronaut_id,
            'astronaut_id':c.astronaut_id,'device_id':c.device_id,'muscle':c.muscle,'protocol':c.protocol,
            'conditions':c.conditions,'sensor_configuration':c.sensor_configuration,'channels':c.channels,
            'emg_sample_rate_hz':c.emg_sample_rate_hz,'imu_sample_rate_hz':c.imu_sample_rate_hz,
            'emg_units':'microvolts','trigger':session.trigger,'started_at':session.started_at}
        if any(getattr(recording,k)!=v for k,v in expected.items()) or recording.provenance.get('actual_sensor') is not False:
            raise HTTPException(409,'Recording metadata differs from approved synthetic session')
        if conn.execute('SELECT 1 FROM myo_recordings WHERE id=?',(str(session_id),)).fetchone():
            raise HTTPException(409,'Immutable recording already stored')
        conn.execute('INSERT INTO myo_recordings VALUES(?,?)',(str(session_id),recording.model_dump_json()))
        event(conn,session_id,'recording_ingested',{'samples':len(recording.emg),'source_type':'synthetic'})
    return {'session_id':session_id,'samples':len(recording.emg),'stored':True}

@router.post('/sessions/{session_id}/process')
def process_session(session_id: UUID, request: ProcessRequest):
    import json
    from uuid import uuid4
    with database() as conn:
        session = load_session(conn, session_id)
        if session.state not in ('COMPLETED','ERROR'):
            raise HTTPException(409, 'Complete acquisition before processing')
        row = conn.execute('SELECT payload FROM myo_recordings WHERE id=?',(str(session_id),)).fetchone()
        if row is None: raise HTTPException(404, 'No recording')
        recording = Recording.model_validate_json(row['payload'])
        recording.quality['interrupted'] = session.state=='ERROR' or any(x['event']=='pause' for x in session.events)
        result=process(recording,request.configuration,request.baseline)
        version=conn.execute('SELECT COALESCE(MAX(version),0)+1 FROM myo_observations WHERE session_id=?',(str(session_id),)).fetchone()[0]
        identifier=str(uuid4())
        result.update(observation_id=identifier,session_id=str(session_id),version=version,
            evidence_reference=f'/api/myomars/v1/sessions/{session_id}/recording')
        conn.execute('INSERT INTO myo_observations VALUES(?,?,?,?)',(identifier,str(session_id),version,json.dumps(result,allow_nan=False)))
        event(conn,session_id,'processed',{'observation_id':identifier,'version':version,'quality':result['signal_quality']})
    return result


@router.post('/observations/{observation_id}/queue')
def queue_observation(observation_id:UUID):
    from .console import assert_not_console_submission, CONTRACT_BLOCKER
    from .triggers import assert_submission_blocked
    with database() as conn:
        assert_submission_blocked(conn,observation_id)
        assert_not_console_submission(conn,observation_id)
    raise HTTPException(423,CONTRACT_BLOCKER)

@router.get('/sessions/{session_id}/recording/raw')
def get_raw_recording(session_id: UUID):
    from fastapi.responses import Response
    with database() as conn:
        row=conn.execute('SELECT payload FROM myo_recordings WHERE id=?',(str(session_id),)).fetchone()
        if row is None: raise HTTPException(404,'Recording not found')
        return Response(content=row['payload'],media_type='application/json')

from . import console as trigger_console

@router.post('/console',status_code=201)
def create_console(request:trigger_console.CreateConsole):
    return trigger_console.create(request)

@router.get('/console/{console_id}')
def console_status(console_id:UUID):
    with database() as conn:return trigger_console.status(trigger_console.load(conn,console_id))

@router.post('/console/{console_id}/actions')
def console_action(console_id:UUID,request:trigger_console.ConsoleAction):
    return trigger_console.action(console_id,request)

@router.get('/console/{console_id}/observations')
def console_observations(console_id:UUID,round_id:UUID):
    return trigger_console.observations(console_id,round_id)

from . import triggers

@router.post('/trigger-streams',status_code=201)
def create_trigger_stream(request:triggers.CreateTriggerStream):return triggers.create(request)

@router.post('/trigger-streams/demo',status_code=201)
def create_demo_trigger_stream(request:triggers.DemoStreamRequest):return triggers.create_demo(request)

@router.get('/trigger-streams/{stream_id}')
def trigger_stream_status(stream_id:UUID):
    with database() as conn:return triggers.status(triggers.load(conn,stream_id))

@router.post('/trigger-streams/{stream_id}/control')
def trigger_stream_control(stream_id:UUID,request:triggers.StreamControl):return triggers.control(stream_id,request)

@router.post('/trigger-streams/{stream_id}/frames')
def trigger_stream_frame(stream_id:UUID,request:triggers.IncomingWindow):return triggers.ingest(stream_id,request)

@router.post('/trigger-streams/{stream_id}/demo-window')
def trigger_stream_demo_window(stream_id:UUID,request:triggers.DemoWindow):return triggers.demo_ingest(stream_id,request)

@router.get('/trigger-streams/{stream_id}/events')
def trigger_stream_events(stream_id:UUID,round_id:UUID):return triggers.events_for(stream_id,round_id)

@router.get('/trigger-streams/{stream_id}/baseline-evidence')
def trigger_baseline_evidence(stream_id:UUID):
    with database() as conn:
        run=triggers.load(conn,stream_id)
        return {'baseline':run['baseline'],'calibration':run.get('calibration_evidence'),
            'note':'Compatibility is checked; caller-supplied baselines are not authenticated clinical evidence.'}
