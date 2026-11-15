import json
import pytest
from test_trigger_console import client,create,act,tick,rows

@pytest.mark.parametrize('scenario',['normal','fatigue_suspected','sensor_fault'])
def test_fixture_round_playback(client,scenario):
    s=create(client,scenario,mode='summary_fixture');s=act(client,s,'start',approved=True)
    s=tick(client,s,1);first=rows(client,s)[0]['observation']
    assert tick(client,s,1)['local_execution']['duplicate']
    s=act(client,s,'pause');s=tick(client,s,2);assert s['sequence']==1
    s=act(client,s,'resume')
    for i in (2,3,4):s=tick(client,s,i)
    observed=[x['observation'] for x in rows(client,s)]
    assert [x['local_schedule']['due_elapsed_seconds'] for x in observed]==[6,12,18,24]
    assert all(x['features'] is None and x['baseline_comparison']['status']=='not_available' for x in observed)
    assert all('expected_classification' not in json.dumps(x) and 'scenario' not in x for x in observed)
    assert all(x['external_submission']=='blocked_no_final_contract' for x in observed)
    assert client.post('/api/myomars/v1/observations/'+first['observation_id']+'/queue').status_code==423
    if scenario=='sensor_fault':
        assert observed[2]['signal_quality']['status']=='unsuitable'
        assert observed[2]['reported_summary_features']['rms_microvolts']==132
    old=s;s=act(client,s,'reset')
    act(client,old,'tick',code=409,sequence=1)
    assert client.post('/api/myomars/v1/observations/'+first['observation_id']+'/queue').status_code==409
    s=act(client,s,'start',approved=True);s=tick(client,s,1)
    replay=rows(client,s)[0]['observation']
    assert replay['reported_summary_features']==first['reported_summary_features']
    assert replay['event_id']!=first['event_id']
