import copy
import json
import pytest
from astra_patch.handoff import CONTRACTS,validate_envelope,review_astra_observation
from test_trigger_console import client,create,act,tick,rows

@pytest.mark.parametrize('scenario',['normal','fatigue_suspected','sensor_fault'])
def test_source_intake_never_invents_v1_measurements(client,scenario):
    s=create(client,scenario,mode='summary_fixture');s=act(client,s,'start',approved=True)
    for seq in range(1,5):s=tick(client,s,seq)
    for row in rows(client,s):
        source=row['observation'];report=review_astra_observation(source)
        assert not report['publishable'] and report['message'] is None
        assert report['possible_feature_mapping']['rmsPctMvc'] is None
        assert report['possible_feature_mapping']['gripForceN'] is None
        assert report['reported_summary_features']==source['reported_summary_features']
        assert 'expected_classification' not in json.dumps(report)
        if source['signal_quality']['status']=='unsuitable':assert report['possible_feature_mapping']['medianFreqHz'] is None

@pytest.mark.parametrize('kind',['scenario.start','scenario.reset','observation.submitted'])
def test_official_examples_validate_without_modifying_contract(kind):
    pytest.importorskip('jsonschema')
    example=json.loads((CONTRACTS.parent/'examples'/f'{kind}.json').read_text())
    assert validate_envelope(example)['valid']
    assert validate_envelope(example)['external_submission']=='disabled'

def test_invalid_and_forbidden_messages_rejected():
    pytest.importorskip('jsonschema')
    example=json.loads((CONTRACTS.parent/'examples'/'observation.submitted.json').read_text())
    for mutation in ('quality','source','date','case','extra'):
        message=copy.deepcopy(example)
        if mutation=='quality':del message['payload']['signal']['electrodeImpedanceKOhm']
        if mutation=='source':message['source']='hud'
        if mutation=='date':message['payload']['capturedAt']='not-a-time'
        if mutation=='case':message['caseId']=None
        if mutation=='extra':message['payload']['expected_classification']='fatigue'
        assert not validate_envelope(message)['valid']
    for kind in ('retest.result','station.notice.approved','hud.ack'):
        message=json.loads((CONTRACTS.parent/'examples'/f'{kind}.json').read_text())
        assert not validate_envelope(message)['valid']
