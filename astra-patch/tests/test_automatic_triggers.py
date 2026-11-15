from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
from uuid import uuid4

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from astra_patch.service import app
from astra_patch.schema import Configuration,utcnow
from astra_patch.triggers import synthetic_window
from astra_patch.store import database
from astra_patch.delivery import deliver_pending

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('ASTRA_PATCH_DB',str(tmp_path/'automatic.sqlite3'))
    monkeypatch.setenv('MYOMARS_ACQUISITION_TOKEN','test-automatic-trigger-token')
    return TestClient(app,headers={'Authorization':'Bearer test-automatic-trigger-token'})

def create(client,activity='walking',policy=None):
    body={'configuration':{'astronaut_id':'synthetic-trigger-a01'},'activity':activity}
    if policy:body['policy']=policy
    response=client.post('/api/myomars/v1/trigger-streams/demo',json=body)
    assert response.status_code==201,response.text
    return response.json()

def control(client,s,action,code=200,**kwargs):
    response=client.post(f'/api/myomars/v1/trigger-streams/{s["stream_id"]}/control',
        json={'round_id':s['round_id'],'action':action,**kwargs})
    assert response.status_code==code,response.text
    return response.json()

def frame(s,seq,signal='normal',activity='walking',anchor=None):
    c=Configuration(astronaut_id='synthetic-trigger-a01',protocol=activity+'_demo_v1',conditions='synthetic_constant_load_'+activity)
    r=synthetic_window(c,s['round_id'],seq,(anchor or utcnow()-timedelta(seconds=180))+timedelta(seconds=seq-1),signal,activity)
    return {'round_id':s['round_id'],'sequence':seq,'activity':activity,'recording':r.model_dump(mode='json')}

def feed(client,s,body,code=200):
    r=client.post(f'/api/myomars/v1/trigger-streams/{s["stream_id"]}/frames',json=body)
    assert r.status_code==code,r.text
    return r.json()

def events(client,s,kind=None):
    rows=client.get(f'/api/myomars/v1/trigger-streams/{s["stream_id"]}/events?round_id={s["round_id"]}').json()
    return [e for e in rows if kind is None or e['kind']==kind]

def started(client,activity='walking',policy=None):
    return control(client,create(client,activity,policy),'start',approved=True)

def test_walking_telemetry_remains_at_six_second_intervals(client):
    s=started(client);anchor=utcnow()-timedelta(seconds=100)
    for seq in range(1,19):feed(client,s,frame(s,seq,anchor=anchor))
    rows=events(client,s,'walking_telemetry')
    assert [round(e['observation_end_epoch_seconds']-anchor.timestamp()) for e in rows]==[6,12,18]
    assert not events(client,s,'abnormal_observation')

def test_three_completed_squats_not_three_partial_samples(client):
    s=started(client,'squat');anchor=utcnow()-timedelta(seconds=100)
    for seq in range(1,6):feed(client,s,frame(s,seq,activity='squat',anchor=anchor))
    assert events(client,s,'squat_assessment')==[]
    feed(client,s,frame(s,6,activity='squat',anchor=anchor))
    rows=events(client,s,'squat_assessment')
    assert len(rows)==1 and rows[0]['evidence']['completed_repetitions']==3
    assert len(rows[0]['evidence']['evidence_observation_ids'])==6

def test_rule_three_immediate_before_next_telemetry_window(client):
    s=started(client);anchor=utcnow()-timedelta(seconds=100)
    for seq in range(1,10):
        result=feed(client,s,frame(s,seq,'normal' if seq<=6 else 'qualifying',anchor=anchor))
    abnormal=events(client,s,'abnormal_observation')
    assert len(abnormal)==1 and abnormal[0]['observation_end_epoch_seconds']==pytest.approx(anchor.timestamp()+9)
    assert [e['observation_end_epoch_seconds'] for e in events(client,s,'walking_telemetry')]==[pytest.approx(anchor.timestamp()+6)]
    assert result['events'][0]['kind']=='abnormal_observation'
    assert len(abnormal[0]['evidence']['evidence_observation_ids'])==3
    assert abnormal[0]['submission']=='blocked_no_final_contract' and result['public_transmissions']==0

@pytest.mark.parametrize('fault',['poor_contact','flatline','missing_imu','missing_conditions','short_window'])
def test_bad_evidence_cannot_create_physiological_indicator(client,fault):
    s=started(client);anchor=utcnow()-timedelta(seconds=100)
    for seq in range(1,5):
        body=frame(s,seq,'poor_contact' if fault=='poor_contact' else 'qualifying',anchor=anchor)
        r=body['recording']
        if fault=='flatline':r['emg']=[[0]*4 for _ in r['emg']]
        if fault=='missing_imu':r['imu']=[];r['imu_time_s']=[];r['imu_sequence']=[]
        if fault=='missing_conditions':r['conditions']=''
        if fault=='short_window':
            for name in ('emg','emg_time_s','emg_sequence'):r[name]=r[name][:1000]
            for name in ('imu','imu_time_s','imu_sequence'):r[name]=r[name][:50]
        feed(client,s,body)
    assert not events(client,s,'abnormal_observation')
    problems=events(client,s,'evidence_quality_problem');assert problems
    assert problems[0]['evidence']['category']=='sensor_quality'
    assert problems[0]['medical_classification']=='not_diagnosed'

@pytest.mark.parametrize('mode',['missing','other_subject','other_conditions','other_protocol'])
def test_baseline_missing_or_incompatible_prevents_fatigue_conclusions(client,mode):
    demo=create(client)
    baseline=client.get(demo['baseline_evidence_reference']).json()['baseline']
    if mode!='missing':baseline['metadata'][{'other_subject':'subject_id','other_conditions':'conditions','other_protocol':'protocol'}[mode]]='incompatible'
    c={'astronaut_id':'synthetic-trigger-a01','protocol':'walking_demo_v1','conditions':'synthetic_constant_load_walking'}
    request={'configuration':c,'baseline':None if mode=='missing' else baseline}
    s=client.post('/api/myomars/v1/trigger-streams',json=request).json();s=control(client,s,'start',approved=True)
    anchor=utcnow()-timedelta(seconds=100)
    for seq in range(1,5):feed(client,s,frame(s,seq,'qualifying',anchor=anchor))
    assert not events(client,s,'abnormal_observation')
    assert events(client,s,'evidence_quality_problem')[0]['evidence']['category']=='baseline_evidence'

def test_duplicate_same_window_is_not_processed_or_counted_again(client):
    s=started(client,'squat');body=frame(s,1,activity='squat')
    first=feed(client,s,body);again=feed(client,s,body)
    assert again['duplicate'] and not again['processing_performed']
    assert first['observation_id']==again['observation_id']
    with database() as conn:assert conn.execute('SELECT COUNT(*) FROM myo_observations').fetchone()[0]==1
    body['recording']['conditions']='different'
    feed(client,s,body,409)

def test_pause_stops_new_observations_resume_restarts_persistence(client):
    s=started(client);anchor=utcnow()-timedelta(seconds=100)
    feed(client,s,frame(s,1,'qualifying',anchor=anchor));feed(client,s,frame(s,2,'qualifying',anchor=anchor))
    control(client,s,'pause')
    assert feed(client,s,frame(s,3,'qualifying',anchor=anchor))['accepted'] is False
    with database() as conn:assert conn.execute('SELECT COUNT(*) FROM myo_observations').fetchone()[0]==2
    control(client,s,'resume')
    for seq in (3,4):feed(client,s,frame(s,seq,'qualifying',anchor=anchor))
    assert not events(client,s,'abnormal_observation')
    feed(client,s,frame(s,5,'qualifying',anchor=anchor))
    assert len(events(client,s,'abnormal_observation'))==1

def test_reset_invalidates_events_old_requests_and_streak(client):
    old=started(client);anchor=utcnow()-timedelta(seconds=100)
    for seq in (1,2,3):result=feed(client,old,frame(old,seq,'qualifying',anchor=anchor))
    s=control(client,old,'reset')
    assert s['round_id']!=old['round_id'] and s['sequence']==0
    feed(client,old,frame(old,4,'qualifying',anchor=anchor),409)
    assert client.get(f'/api/myomars/v1/trigger-streams/{s["stream_id"]}/events?round_id={old["round_id"]}').status_code==409
    with database() as conn:assert conn.execute("SELECT COUNT(*) FROM myo_trigger_events WHERE status='invalidated_by_reset'").fetchone()[0]==1
    assert client.post('/api/myomars/v1/observations/'+result['observation_id']+'/queue').status_code==409
    s=control(client,s,'start',approved=True)
    for seq in (1,2):feed(client,s,frame(s,seq,'qualifying',anchor=anchor))
    assert events(client,s,'abnormal_observation')==[]

def test_cooldown_suppresses_repeats_but_allows_persistent_update(client):
    s=started(client);anchor=utcnow()-timedelta(seconds=180)
    for seq in range(1,65):feed(client,s,frame(s,seq,'qualifying',anchor=anchor))
    rows=events(client,s,'abnormal_observation')
    assert len(rows)==2
    assert rows[1]['observation_end_epoch_seconds']-rows[0]['observation_end_epoch_seconds']==pytest.approx(60)

def test_new_episode_after_recovery_is_not_hidden_by_cooldown(client):
    s=started(client);anchor=utcnow()-timedelta(seconds=100)
    for seq in range(1,9):feed(client,s,frame(s,seq,'normal' if seq in (4,5) else 'qualifying',anchor=anchor))
    rows=events(client,s,'abnormal_observation')
    assert [r['evidence']['episode'] for r in rows]==[1,2]
    assert rows[1]['observation_end_epoch_seconds']-rows[0]['observation_end_epoch_seconds']<60

def test_material_new_indicator_not_hidden_by_old_signature_cooldown(client):
    s=started(client);anchor=utcnow()-timedelta(seconds=100)
    for seq in (1,2,3):feed(client,s,frame(s,seq,'qualifying',anchor=anchor))
    body=frame(s,4,'qualifying',anchor=anchor)
    body['recording']['emg']=(np.asarray(body['recording']['emg'])*1.6).tolist()
    feed(client,s,body)
    assert len(events(client,s,'abnormal_observation'))==2

def test_same_channel_must_persist_not_alternating_channels(client):
    s=started(client);anchor=utcnow()-timedelta(seconds=100)
    for seq in range(1,9):
        body=frame(s,seq,anchor=anchor);bad=frame(s,seq,'qualifying',anchor=anchor)
        values=np.asarray(body['recording']['emg']);values[:,seq%4]=np.asarray(bad['recording']['emg'])[:,seq%4]
        body['recording']['emg']=values.tolist();feed(client,s,body)
    assert not events(client,s,'abnormal_observation')

def test_fault_breaks_qualifying_streak(client):
    s=started(client);anchor=utcnow()-timedelta(seconds=100)
    for seq in range(1,6):feed(client,s,frame(s,seq,'poor_contact' if seq==3 else 'qualifying',anchor=anchor))
    assert not events(client,s,'abnormal_observation')
    feed(client,s,frame(s,6,'qualifying',anchor=anchor))
    assert len(events(client,s,'abnormal_observation'))==1

def test_policy_is_nonclinical_versioned_and_rules_one_two_fixed(client):
    create(client)
    response=client.post('/api/myomars/v1/trigger-streams/demo',json={'configuration':{'astronaut_id':'a'},'policy':{'rms_rise_percent':30}})
    assert response.status_code==409
    s=create(client,policy={'version':'nonclinical-demo-v2','rms_rise_percent':30})
    assert s['policy']['scope']=='non_clinical_demonstration'
    for field,value in [('walking_interval_seconds',7),('squat_repetitions',4)]:
        assert client.post('/api/myomars/v1/trigger-streams/demo',json={'configuration':{'astronaut_id':'a'},'policy':{field:value}}).status_code==422

def test_public_submission_disabled_and_no_hud_retest_authority(client,monkeypatch):
    monkeypatch.setattr(httpx.HTTPTransport,'handle_request',lambda *a,**k:(_ for _ in ()).throw(AssertionError('No external send')))
    s=started(client);r=feed(client,s,frame(s,1))
    assert client.post('/api/myomars/v1/observations/'+r['observation_id']+'/queue').status_code==423
    with database() as conn:conn.execute('INSERT INTO myo_outbox(id,payload) VALUES(?,?)',(r['observation_id'],'{}'))
    assert deliver_pending()==[]
    for action in ('publish_hud_alert','submit_retest','authorize_return_to_base','approve_rest','close_case'):
        assert client.post(f'/api/myomars/v1/trigger-streams/{s["stream_id"]}/control',json={'round_id':s['round_id'],'action':action}).status_code==422

def test_concurrent_duplicate_does_not_double_process(client):
    s=started(client);body=frame(s,1)
    with ThreadPoolExecutor(max_workers=4) as pool:responses=list(pool.map(lambda _:feed(client,s,body),range(4)))
    assert sum(r['processing_performed'] for r in responses)==1

def test_stale_or_gapped_data_no_fatigue_inference(client):
    s=started(client);anchor=utcnow()-timedelta(seconds=400)
    r=feed(client,s,frame(s,1,'qualifying',anchor=anchor))
    assert r['signal_quality']['status']=='unsuitable'
    assert not events(client,s,'abnormal_observation')
    s=control(client,s,'reset');s=control(client,s,'start',approved=True)
    anchor=utcnow()-timedelta(seconds=100)
    feed(client,s,frame(s,1,'qualifying',anchor=anchor))
    r=feed(client,s,frame(s,2,'qualifying',anchor=anchor+timedelta(seconds=10)))
    assert 'recording_gap' in r['signal_quality']['flags']

def test_synthetic_calibration_evidence_and_raw_features_reproducible(client):
    s=create(client)
    evidence=client.get(s['baseline_evidence_reference']).json()
    assert evidence['calibration']['recording']['source_type']=='synthetic'
    assert evidence['baseline']['metadata']['subject_id']=='synthetic-trigger-a01'
    assert evidence['calibration']['processing_result']['features']['median_frequency_hz']
