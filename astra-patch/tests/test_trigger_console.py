import json
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from astra_patch.service import app
from astra_patch.store import database
from astra_patch.delivery import deliver_pending
from astra_patch.console import stable_event_id

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('ASTRA_PATCH_DB',str(tmp_path/'console.sqlite3'))
    monkeypatch.setenv('MYOMARS_ACQUISITION_TOKEN','test-local-console-token')
    return TestClient(app,headers={'Authorization':'Bearer test-local-console-token'})

def create(client,scenario='normal',**kwargs):
    r=client.post('/api/myomars/v1/console',json={'configuration':{'astronaut_id':'synthetic-console-a01'},'scenario':scenario,**kwargs})
    assert r.status_code==201,r.text
    return r.json()

def act(client,s,action,code=200,**kwargs):
    r=client.post('/api/myomars/v1/console/'+s['console_id']+'/actions',json={'action':action,'round_id':s['round_id'],**kwargs})
    assert r.status_code==code,r.text
    return r.json()

def tick(client,s,sequence):return act(client,s,'tick',sequence=sequence)

def rows(client,s):
    return client.get(f'/api/myomars/v1/console/{s["console_id"]}/observations?round_id={s["round_id"]}').json()

def test_approval_auth_and_start_pause_resume(client):
    assert TestClient(app).get('/api/myomars/v1/console/'+str(uuid4())).status_code==401
    s=create(client)
    act(client,s,'start',code=403)
    s=act(client,s,'start',approved=True)
    s=tick(client,s,1)
    assert s['processed_count']==1 and s['sent_count']==0
    s=act(client,s,'pause')
    s=tick(client,s,2)
    assert s['processed_count']==1 and s['state']=='paused'
    s=act(client,s,'resume')
    s=tick(client,s,2)
    assert s['processed_count']==2 and len(rows(client,s))==2
    with database() as conn:
        assert conn.execute('SELECT COUNT(*) FROM myo_outbox').fetchone()[0]==0
        assert conn.execute('SELECT COUNT(*) FROM myo_recordings').fetchone()[0]==2

def test_reset_rejects_stale_tick_repeat_and_read(client):
    old=create(client);old=act(client,old,'start',approved=True);old=tick(client,old,1)
    old_oid=old['last_observation_id']
    current=act(client,old,'reset')
    assert current['round_id']!=old['round_id'] and current['processed_count']==0
    act(client,old,'tick',code=409,sequence=2)
    act(client,old,'repeat',code=409)
    assert client.get(f'/api/myomars/v1/console/{old["console_id"]}/observations?round_id={old["round_id"]}').status_code==409
    assert client.post('/api/myomars/v1/observations/'+old_oid+'/queue').status_code==409
    assert rows(client,current)==[]
    current=act(client,current,'start',approved=True);current=tick(client,current,1)
    assert current['last_observation_id']!=old_oid
    assert rows(client,current)[0]['replay_round_id']==current['round_id']

def test_duplicates_reuse_original_event_format_without_processing(client):
    s=create(client);s=act(client,s,'start',approved=True);s=tick(client,s,1)
    before=rows(client,s)
    repeat=tick(client,s,1)
    assert repeat['local_execution']['duplicate'] is True
    assert repeat['local_execution']['processing_performed'] is False
    assert repeat['local_execution']['event_id']==f'{s["round_id"]}:1'
    assert repeat['last_observation_id']==s['last_observation_id']
    assert act(client,s,'repeat')['local_execution']['duplicate'] is True
    assert rows(client,s)==before
    with database() as conn:
        assert conn.execute('SELECT COUNT(*) FROM myo_observations').fetchone()[0]==1
        assert conn.execute('SELECT COUNT(*) FROM myo_console_events').fetchone()[0]==1

def test_public_submission_fails_closed_without_transport(client,monkeypatch):
    def forbidden(*args,**kwargs):raise AssertionError('Console must never call a network transport')
    monkeypatch.setattr(httpx.HTTPTransport,'handle_request',forbidden)
    # In-process TestClient is permitted; actual socket transports must remain unused.
    s=create(client);s=act(client,s,'start',approved=True);s=tick(client,s,1)
    assert s['external_submission']=='blocked_no_final_contract'
    assert s['partner_acknowledgment'] is None
    assert client.post('/api/myomars/v1/observations/'+s['last_observation_id']+'/queue').status_code==423
    act(client,s,'submit',code=423)
    assert deliver_pending()==[]

def test_scenario_label_does_not_replace_values_quality_conditions_or_times(client):
    s=create(client,'contact_loss');s=act(client,s,'start',approved=True)
    s=tick(client,s,1);s=tick(client,s,2)
    observations=rows(client,s)
    first,second=[r['observation'] for r in observations]
    assert all(row['scenario_label']=='contact_loss' for row in observations)
    assert first['signal_quality']['status']=='acceptable'
    assert second['signal_quality']['status']=='unsuitable' and second['features'] is None
    assert 'poor_or_unknown_contact' in second['signal_quality']['flags']
    for r in observations:
        raw=client.get(r['observation']['evidence_reference']+'/raw').json()
        assert 'scenario' not in raw['quality']
        assert raw['source_type']=='synthetic' and raw['started_at']
        assert raw['conditions']=='simulated_seated'
        assert r['observation']['baseline_comparison']['status']=='not_available'
    assert first['features']['rms'][0]!=51  # Actual preprocessing, not the scene scalar.

def test_missing_context_is_explicit_and_blocks_interpretation(client):
    s=create(client,'missing_context');s=act(client,s,'start',approved=True);s=tick(client,s,1);s=tick(client,s,2)
    result=rows(client,s)[1]['observation']
    assert 'missing_measurement_conditions' in result['signal_quality']['flags']
    assert result['features'] is None and result['metadata']['conditions']==''

@pytest.mark.parametrize('scenario',['normal','contact_loss','activity_shift','missing_context'])
def test_seeded_replay_repeats_samples_but_not_identity_or_timestamp(client,scenario):
    s=create(client,scenario);s=act(client,s,'start',approved=True);s=tick(client,s,1)
    first=client.get(rows(client,s)[0]['observation']['evidence_reference']+'/raw').json()
    s=act(client,s,'reset');s=act(client,s,'start',approved=True);s=tick(client,s,1)
    second=client.get(rows(client,s)[0]['observation']['evidence_reference']+'/raw').json()
    assert first['emg']==second['emg'] and first['imu']==second['imu']
    assert first['session_id']!=second['session_id'] and first['started_at']!=second['started_at']

def test_out_of_order_and_wrong_event_rejected(client):
    s=create(client);s=act(client,s,'start',approved=True)
    act(client,s,'tick',code=409,sequence=2)
    act(client,s,'tick',code=409,sequence=1,event_id='wrong-round:1')
    act(client,s,'tick',code=422)
    s=tick(client,s,1)
    act(client,s,'select',code=409,scenario='normal')

def test_round_state_survives_new_client_and_server_object(client):
    s=create(client);s=act(client,s,'start',approved=True);s=tick(client,s,1);s=act(client,s,'pause')
    fresh=TestClient(app,headers={'Authorization':'Bearer test-local-console-token'})
    restored=fresh.get('/api/myomars/v1/console/'+s['console_id']).json()
    assert restored['round_id']==s['round_id'] and restored['sequence']==1 and restored['state']=='paused'

def test_concurrent_identical_ticks_process_once(client):
    s=create(client);s=act(client,s,'start',approved=True)
    with ThreadPoolExecutor(max_workers=4) as pool:responses=list(pool.map(lambda _:tick(client,s,1),range(4)))
    assert sum(not r['local_execution']['duplicate'] for r in responses)==1
    with database() as conn:assert conn.execute('SELECT COUNT(*) FROM myo_observations').fetchone()[0]==1

def test_reset_waits_for_inflight_processing_then_rejects_prior_round(client,monkeypatch):
    from astra_patch import console
    entered=threading.Event();release=threading.Event();original=console.acquire_and_process
    def controlled(*args):
        entered.set();assert release.wait(5);return original(*args)
    monkeypatch.setattr(console,'acquire_and_process',controlled)
    s=create(client);s=act(client,s,'start',approved=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending=pool.submit(tick,client,s,1);assert entered.wait(5)
        reset=pool.submit(act,client,s,'reset');release.set()
        assert pending.result()['processed_count']==1
        current=reset.result()
    assert current['round_id']!=s['round_id'] and rows(client,current)==[]
    act(client,s,'tick',code=409,sequence=2)

def test_completed_scene_needs_reset_and_new_permission(client):
    s=create(client,'missing_context');s=act(client,s,'start',approved=True)
    s=tick(client,s,1);s=tick(client,s,2)
    assert s['state']=='completed'
    act(client,s,'start',code=409,approved=True)
    s=act(client,s,'reset');act(client,s,'start',code=403)

def test_research_quality_and_existing_payload_remain_byte_identical(client):
    oid,sid=str(uuid4()),str(uuid4())
    original=json.dumps({'observation_id':oid,'session_id':sid,'source_type':'research','astronaut_id':None,
        'signal_quality':{'status':'unsuitable','flags':['source_unit_conflicts_with_documentation','cross_subject_identical_waveform'],
            'clinical_interpretation':'unsuitable'},'features':None,'research_features':{'scope':'descriptive_only','native_units':'mV'},
        'baseline_comparison':{'status':'not_available'}},indent=3)
    with database() as conn:conn.execute('INSERT INTO myo_observations VALUES(?,?,?,?)',(oid,sid,1,original))
    s=create(client,mode='research_observations',research_observation_ids=[oid]);s=act(client,s,'start',approved=True);s=tick(client,s,1)
    assert rows(client,s)[0]['observation']==json.loads(original)
    assert s['local_execution']['processing_performed'] is False
    with database() as conn:
        assert conn.execute('SELECT payload FROM myo_observations WHERE id=?',(oid,)).fetchone()[0]==original
        assert conn.execute('SELECT COUNT(*) FROM myo_observations').fetchone()[0]==1

def test_legacy_pending_row_cannot_bypass_console_contract_gate(client):
    oid,sid=str(uuid4()),str(uuid4())
    with database() as conn:
        conn.execute('INSERT INTO myo_observations VALUES(?,?,?,?)',(oid,sid,1,json.dumps({'source_type':'research'})))
        conn.execute('INSERT INTO myo_outbox(id,payload) VALUES(?,?)',(oid,'{}'))
    s=create(client,mode='research_observations',research_observation_ids=[oid]);s=act(client,s,'start',approved=True);tick(client,s,1)
    assert deliver_pending()==[]
    with database() as conn:assert conn.execute('SELECT attempts FROM myo_outbox WHERE id=?',(oid,)).fetchone()[0]==0

def test_request_or_environment_cannot_enable_unapproved_contract(client,monkeypatch):
    monkeypatch.setenv('MYOMARS_BASE_URL','https://unapproved.invalid/ingest')
    response=client.post('/api/myomars/v1/console',json={'configuration':{'astronaut_id':'synthetic'},
        'contract_approved':True,'url':'https://unapproved.invalid/ingest'})
    assert response.status_code==422
    s=create(client);s=act(client,s,'start',approved=True);s=tick(client,s,1)
    act(client,s,'submit',code=423)
    assert s['sent_count']==0 and s['partner_acknowledgment'] is None

@pytest.mark.parametrize('action',['submit_retest','publish_hud_alert','authorize_mission'])
def test_console_has_no_retest_hud_or_mission_action(client,action):
    s=create(client)
    response=client.post('/api/myomars/v1/console/'+s['console_id']+'/actions',json={'action':action,'round_id':s['round_id']})
    assert response.status_code==422

def test_reprocessing_cannot_bypass_console_session_contract_gate(client):
    s=create(client);s=act(client,s,'start',approved=True);s=tick(client,s,1)
    sid=rows(client,s)[0]['observation']['session_id']
    newer=client.post(f'/api/myomars/v1/sessions/{sid}/process',json={}).json()
    oid=newer['observation_id']
    assert client.post('/api/myomars/v1/observations/'+oid+'/queue').status_code==423
    with database() as conn:conn.execute('INSERT INTO myo_outbox(id,payload) VALUES(?,?)',(oid,'{}'))
    assert deliver_pending()==[]
    act(client,s,'reset')
    assert client.post('/api/myomars/v1/observations/'+oid+'/queue').status_code==409
