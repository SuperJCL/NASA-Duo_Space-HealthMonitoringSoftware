"""Deterministic research processing. Quality flags are sensor events, not health alerts."""
from typing import Literal
import numpy as np
from scipy.signal import butter, sosfiltfilt, welch, iirnotch, filtfilt
from pydantic import Field
from .schema import StrictModel, Recording, utcnow

class ProcessingConfig(StrictModel):
    low_hz: float = Field(default=20, gt=0)
    high_hz: float = Field(default=450, gt=0)
    notch_hz: float | None = Field(default=50, gt=0)
    flatline_std_microvolts: float = Field(default=.01, gt=0)
    motion_dynamic_rms_m_s2: float = Field(default=2, gt=0)
    low_frequency_fraction: float = Field(default=.6, gt=0, lt=1)
    max_age_seconds: float = Field(default=300, gt=0)

COMPATIBILITY = ('subject_id','source_type','muscle','protocol','conditions','sensor_configuration',
                 'channels','emg_sample_rate_hz','emg_units','processing')

class Baseline(StrictModel):
    baseline_id: str
    metadata: dict
    rms: list[float] = Field(min_length=1)
    median_frequency_hz: list[float] = Field(min_length=1)
    quality_status: Literal['acceptable'] = 'acceptable'

class ProcessRequest(StrictModel):
    configuration: ProcessingConfig = Field(default_factory=ProcessingConfig)
    baseline: Baseline | None = None

def metadata(recording, config):
    return {**{k:getattr(recording,k) for k in COMPATIBILITY if k!='processing'}, 'processing':config.model_dump()}

def validate_recording(r: Recording, config: ProcessingConfig, now=None):
    flags=[]
    def flag(name):
        if name not in flags: flags.append(name)
    fs=r.emg_sample_rate_hz
    if not 2*config.high_hz < fs or not config.low_hz < config.high_hz:
        flag('invalid_filter_for_sample_rate')
    if config.notch_hz and not config.notch_hz < fs/2: flag('invalid_notch_for_sample_rate')
    if r.emg_units != 'microvolts': flag('unsupported_or_unverified_emg_units')
    if not r.channels or len(set(r.channels)) != len(r.channels): flag('invalid_channels')
    if not r.emg or any(len(row)!=len(r.channels) for row in r.emg): flag('channel_count_mismatch')
    if len(r.emg) < max(100, fs): flag('insufficient_samples')
    if r.started_at.tzinfo is None or r.started_at.utcoffset().total_seconds()!=0:
        flag('invalid_utc_timestamp')
    elif r.source_type != 'research':
        age=((now or utcnow())-r.started_at).total_seconds()
        if age < -5: flag('future_timestamp')
        if age > config.max_age_seconds: flag('stale_recording')
    for name, values, times, seq, rate, width in (
        ('emg',r.emg,r.emg_time_s,r.emg_sequence,fs,len(r.channels)),
        ('imu',r.imu,r.imu_time_s,r.imu_sequence,r.imu_sample_rate_hz,6)):
        if name=='imu' and r.source_type=='research' and not values and rate is None: continue
        if rate is None or rate<=0 or not values: flag(name+'_missing');continue
        if len(times)!=len(values) or len(seq)!=len(values): flag(name+'_length_mismatch');continue
        if any(len(row)!=width for row in values): flag(name+'_shape_mismatch');continue
        a=np.asarray(values,dtype=float)
        if not np.isfinite(a).all(): flag(name+'_missing_values')
        t=np.asarray(times)
        if not np.isfinite(t).all() or abs(t[0])>1e-7 or not np.allclose(np.diff(t),1/rate,rtol=1e-5,atol=1e-7): flag(name+'_timestamp_gap_or_order')
        if seq[0]!=0 or any(b-a!=1 for a,b in zip(seq,seq[1:])): flag(name+'_sequence_gap_or_duplicate')
    if r.imu and r.emg_time_s and r.imu_time_s and r.imu_sample_rate_hz and r.imu_sample_rate_hz>0:
        if abs(r.emg_time_s[0]-r.imu_time_s[0])>1/r.imu_sample_rate_hz or abs(r.emg_time_s[-1]-r.imu_time_s[-1])>2/r.imu_sample_rate_hz:
            flag('emg_imu_desynchronized')
    if r.accel_units!='m/s2' or r.gyro_units!='rad/s': flag('unsupported_imu_units')
    if r.quality.get('contact') is not True: flag('poor_or_unknown_contact')
    adc_limit=r.quality.get('adc_limit_microvolts')
    if adc_limit is not None and (isinstance(adc_limit,bool) or not isinstance(adc_limit,(float,int)) or not np.isfinite(adc_limit) or adc_limit<=0):
        flag('invalid_adc_limit_metadata')
    if r.quality.get('interrupted'): flag('recording_interrupted')
    if r.provenance.get('unit_verified') is False: flag('unverified_source_units')
    if not r.conditions.strip(): flag('missing_measurement_conditions')
    if not flags:
        a=np.asarray(r.emg)
        if np.any(np.std(a,axis=0)<config.flatline_std_microvolts): flag('flatline')
        limit=r.quality.get('adc_limit_microvolts')
        if limit is not None and np.any(np.abs(a)>=limit*.99): flag('saturation')
        f,p=welch(a,fs=fs,axis=0,nperseg=min(len(a),2048))
        total=np.sum(p,axis=0)
        fraction=np.divide(np.sum(p[f<config.low_hz],axis=0),total,out=np.zeros_like(total),where=total>0)
        if np.any(fraction>config.low_frequency_fraction): flag('low_frequency_artifact')
        if r.imu:
            imu=np.asarray(r.imu)
            dynamic=imu[:,:3]-np.mean(imu[:,:3],axis=0)
            if np.sqrt(np.mean(np.sum(dynamic**2,axis=1)))>config.motion_dynamic_rms_m_s2: flag('motion_artifact_indicator')
    return flags

def process(recording: Recording, config=None, baseline=None, now=None):
    config=config or ProcessingConfig()
    flags=validate_recording(recording,config,now)
    result={'processing_version':'musclesense-research-v1','processing':config.model_dump(),
        'metadata':metadata(recording,config),
        'signal_quality':{'status':'unsuitable' if flags else 'acceptable','flags':flags,
            'metrics':{'emg_frames_received':len(recording.emg),'imu_frames_received':len(recording.imu),
                'missing_emg_values':sum(v is None for row in recording.emg for v in row),
                'missing_imu_values':sum(v is None for row in recording.imu for v in row),
                'contact_verified':recording.quality.get('contact') is True},
            'clinical_interpretation':'unsuitable' if flags else 'not_clinically_validated'},
        'features':None,'baseline_comparison':{'status':'not_available'},
        'research_indicator':{'status':'not_assessed','uncertainty':'No validated fatigue threshold or diagnosis; workload, contact and protocol confound sEMG.'},
        'preprocessing_history':[]}
    if flags: return result
    fs=recording.emg_sample_rate_hz
    features,history=extract_signal_features(recording.emg,fs,recording.channels,config)
    result['preprocessing_history']=history
    median=features['median_frequency_hz']
    if recording.imu:
        imu=np.asarray(recording.imu);dynamic=imu[:,:3]-np.mean(imu[:,:3],axis=0)
        features['imu']={'dynamic_acceleration_rms_m_s2':float(np.sqrt(np.mean(np.sum(dynamic**2,axis=1)))),
            'angular_velocity_rms_rad_s':float(np.sqrt(np.mean(np.sum(imu[:,3:]**2,axis=1))))}
    result['features']=features
    if baseline:
        mismatch=[k for k in COMPATIBILITY if baseline.metadata.get(k)!=result['metadata'][k]]
        if len(baseline.rms)!=len(median) or len(baseline.median_frequency_hz)!=len(median) or any(x<=0 for x in baseline.rms+baseline.median_frequency_hz): mismatch.append('baseline_feature_shape_or_value')
        if mismatch: result['baseline_comparison']={'status':'incompatible','mismatched_fields':mismatch}
        else:
            result['baseline_comparison']={'status':'compatible','baseline_id':baseline.baseline_id,
                'rms_change_percent':[(x/y-1)*100 for x,y in zip(features['rms'],baseline.rms)],
                'median_frequency_change_percent':[(x/y-1)*100 for x,y in zip(median,baseline.median_frequency_hz)]}
            result['research_indicator']['status']='descriptive_change_only'
            result['research_indicator']['evidence']={'baseline_id':baseline.baseline_id,'channels':recording.channels,'comparison':result['baseline_comparison']}
    return result

def extract_signal_features(samples, fs, channels, config, units='microvolts'):
    """Numerical primitive shared by gated patch processing and labeled research analysis.

    Callers must validate numerical suitability first. This function grants no clinical
    suitability; the research batch keeps unknown contact and source units explicit.
    """
    a=np.asarray(samples,dtype=float)
    if a.ndim!=2 or a.shape[1]!=len(channels) or len(a)<fs or not np.isfinite(a).all():
        raise ValueError('Finite, shaped signal with at least one second required')
    if not 0<config.low_hz<config.high_hz<fs/2 or (config.notch_hz and config.notch_hz>=fs/2):
        raise ValueError('Invalid processing frequencies')
    history=[]
    sos=butter(4,[config.low_hz,config.high_hz],btype='bandpass',fs=fs,output='sos')
    filtered=sosfiltfilt(sos,a,axis=0)
    history.append({'operation':'zero_phase_butterworth_bandpass','order':4,'low_hz':config.low_hz,'high_hz':config.high_hz})
    if config.notch_hz:
        b,c=iirnotch(config.notch_hz,30,fs=fs);filtered=filtfilt(b,c,filtered,axis=0)
        history.append({'operation':'zero_phase_notch','hz':config.notch_hz,'Q':30})
    frequencies,power=welch(filtered,fs=fs,axis=0,nperseg=min(2048,len(a)))
    median=[float(frequencies[np.searchsorted(np.cumsum(power[:,i]),np.sum(power[:,i])/2)]) for i in range(a.shape[1])]
    duration=len(a)/fs
    features={'rms':np.sqrt(np.mean(filtered**2,axis=0)).tolist(),
        'mav':np.mean(np.abs(filtered),axis=0).tolist(),
        'zero_crossing_rate_hz':(np.sum(np.diff(np.signbit(filtered),axis=0),axis=0)/duration).tolist(),
        'waveform_length':np.sum(np.abs(np.diff(filtered,axis=0)),axis=0).tolist(),
        'median_frequency_hz':median,
        'mean_frequency_hz':(np.sum(frequencies[:,None]*power,axis=0)/np.sum(power,axis=0)).tolist(),
        'peak_frequency_hz':frequencies[np.argmax(power,axis=0)].tolist(),
        'band_power':np.trapezoid(power,frequencies,axis=0).tolist(),
        'channels':channels,
        'units':{'rms':units,'mav':units,'waveform_length':units,'zero_crossing_rate_hz':'1/s','median_frequency_hz':'Hz',
            'mean_frequency_hz':'Hz','peak_frequency_hz':'Hz','band_power':units+'^2'},'imu':None}
    return features,history
