from datetime import timedelta
import numpy as np
import pytest
from astra_patch.acquisition import SyntheticSource
from astra_patch.schema import utcnow
from astra_patch.processing import process, Baseline, ProcessingConfig
from test_myomars_acquisition import active

def recording(scenario='normal'):
    return SyntheticSource().capture(active(),2,scenario)

@pytest.mark.parametrize('scenario,flag',[('drop','emg_sequence_gap_or_duplicate'),('flatline','flatline'),('saturation','saturation'),('contact','poor_or_unknown_contact'),('artifact','motion_artifact_indicator'),('missing','emg_missing_values')])
def test_quality_suppresses_features(scenario,flag):
    p=process(recording(scenario))
    assert flag in p['signal_quality']['flags']
    assert p['features'] is None and p['research_indicator']['status']=='not_assessed'

def test_known_sine_features():
    r=recording();t=np.asarray(r.emg_time_s)
    r.emg=np.tile((100*np.sin(2*np.pi*100*t))[:,None],(1,4)).tolist()
    p=process(r,ProcessingConfig(notch_hz=None))
    assert p['signal_quality']['status']=='acceptable'
    assert p['features']['rms'][0]==pytest.approx(100/np.sqrt(2),rel=.03)
    assert p['features']['mav'][0]==pytest.approx(200/np.pi,rel=.04)
    assert p['features']['median_frequency_hz'][0]==pytest.approx(100,abs=2)
    assert p['features']['zero_crossing_rate_hz'][0]==pytest.approx(200,rel=.02)
    assert p['features']['waveform_length'][0]>0
    assert p['features']['imu']['dynamic_acceleration_rms_m_s2']>0

@pytest.mark.parametrize('field,value,flag',[
 ('emg_units','mV','unsupported_or_unverified_emg_units'),
 ('emg_sample_rate_hz',400,'invalid_filter_for_sample_rate'),
 ('channels',['E1'],'channel_count_mismatch'),
 ('imu',[],'imu_missing'),
 ('started_at',utcnow()-timedelta(hours=1),'stale_recording'),
 ('started_at',utcnow()+timedelta(hours=1),'future_timestamp')])
def test_invalid_metadata(field,value,flag):
    r=recording();setattr(r,field,value)
    assert flag in process(r)['signal_quality']['flags']

def test_incompatible_person_or_protocol_never_compared():
    r=recording();p=process(r)
    baseline=Baseline(baseline_id='b1',metadata=p['metadata'],rms=p['features']['rms'],median_frequency_hz=p['features']['median_frequency_hz'])
    assert process(r,baseline=baseline)['baseline_comparison']['status']=='compatible'
    for key in ('subject_id','source_type','muscle','protocol','conditions','sensor_configuration','channels','processing'):
        wrong=baseline.model_copy(deep=True);wrong.metadata[key]='wrong'
        result=process(r,baseline=wrong)
        assert result['baseline_comparison']['status']=='incompatible'
        assert result['research_indicator']['status']=='not_assessed'

def test_timestamp_and_duplicate_sequence():
    r=recording();r.emg_time_s[20]=r.emg_time_s[19];r.emg_sequence[20]=19
    p=process(r)
    assert 'emg_timestamp_gap_or_order' in p['signal_quality']['flags']
    assert 'emg_sequence_gap_or_duplicate' in p['signal_quality']['flags']

def test_invalid_adc_metadata_cannot_produce_features():
    r=recording();r.quality['adc_limit_microvolts']='unknown'
    result=process(r)
    assert 'invalid_adc_limit_metadata' in result['signal_quality']['flags']
    assert result['features'] is None
