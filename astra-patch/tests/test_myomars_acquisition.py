import pytest
from datetime import timedelta
from astra_patch.schema import Session, Configuration, Transition, utcnow
from astra_patch.acquisition import transition, SyntheticSource

def command(action, **kwargs):
    return Transition(action=action, operator='test operator', **kwargs)

def active():
    s=Session(configuration=Configuration(astronaut_id='sim-a01'))
    transition(s,command('arm',approved=True))
    transition(s,command('motion',acceleration_m_s2=2))
    return s

def test_permission_and_transitions():
    s=Session(configuration=Configuration(astronaut_id='a01'))
    with pytest.raises(ValueError): transition(s,command('start'))
    with pytest.raises(ValueError): transition(s,command('arm'))
    transition(s,command('arm',approved=True))
    with pytest.raises(ValueError): transition(s,command('motion',acceleration_m_s2=.1))
    transition(s,command('motion',acceleration_m_s2=2))
    transition(s,command('pause')); transition(s,command('resume')); transition(s,command('complete'))
    assert s.state=='COMPLETED' and s.trigger=='imu_motion'
    with pytest.raises(ValueError): transition(s,command('start'))

def test_seeded_synchronized_recording():
    s=active(); source=SyntheticSource()
    a=source.capture(s,2,'normal'); b=source.capture(s,2,'normal')
    assert a==b and len(a.emg)==4000 and len(a.imu)==200
    assert a.emg_time_s[20]==a.imu_time_s[1]
    assert a.astronaut_id=='sim-a01' and a.source_type=='synthetic'
    assert len(a.emg[0])==4 and len(a.imu[0])==6

def test_schedule_disconnect_and_pause():
    s=Session(configuration=Configuration(astronaut_id='a01',scheduled_at=utcnow()+timedelta(hours=1)))
    transition(s,command('arm',approved=True))
    with pytest.raises(ValueError): transition(s,command('schedule'))
    transition(s,command('schedule'),s.configuration.scheduled_at)
    transition(s,command('pause'))
    with pytest.raises(ValueError): SyntheticSource().capture(s,2,'normal')
    transition(s,command('disconnect'))
    assert s.state=='ERROR'

def test_drop_retains_sequence_gap():
    r=SyntheticSource().capture(active(),2,'drop')
    assert 25 not in r.emg_sequence and r.emg_sequence[25]==26

def test_api_storage_and_immutable_recording(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    from astra_patch.service import app
    monkeypatch.setenv('ASTRA_PATCH_DB',str(tmp_path/'test.sqlite3'))
    monkeypatch.setenv('MYOMARS_ACQUISITION_TOKEN','test-acquisition-token')
    client=TestClient(app)
    assert client.post('/api/myomars/v1/sessions',json={'astronaut_id':'a01'}).status_code==401
    client.headers['Authorization']='Bearer test-acquisition-token'
    sid=client.post('/api/myomars/v1/sessions',json={'astronaut_id':'a01'}).json()['session_id']
    route=f'/api/myomars/v1/sessions/{sid}'
    for action in ('arm','start'):
        assert client.post(route+'/transition',json={'action':action,'operator':'test','approved':True}).status_code==200
    assert client.post(route+'/capture',json={}).status_code==201
    assert client.post(route+'/capture',json={}).status_code==409
    assert client.get(route+'/recording?limit=100').json()['next_offset']==100
    assert client.post(route+'/transition',json={'action':'complete','operator':'test'}).json()['state']=='COMPLETED'
