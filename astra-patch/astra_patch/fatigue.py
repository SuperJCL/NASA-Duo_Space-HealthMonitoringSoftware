"""Non-clinical demonstration criteria; no health alert, diagnosis or authority."""
from typing import Literal
from pydantic import Field,model_validator
from .schema import StrictModel

class TriggerPolicy(StrictModel):
    version:str=Field(default='nonclinical-trigger-demo-v1',min_length=1,max_length=100)
    scope:Literal['non_clinical_demonstration']='non_clinical_demonstration'
    walking_interval_seconds:Literal[6]=6
    squat_repetitions:Literal[3]=3
    rms_rise_percent:float=Field(default=25,gt=0,le=500)
    median_frequency_drop_percent:float=Field(default=15,gt=0,lt=100)
    persistent_windows:int=Field(default=3,ge=2,le=30)
    recovery_windows:int=Field(default=2,ge=1,le=30)
    cooldown_seconds:float=Field(default=60,ge=0,le=3600)
    severity_step_percent:float=Field(default=20,gt=0,le=100)
    max_gap_seconds:float=Field(default=.25,ge=0,le=5)
    max_window_seconds:float=Field(default=2,ge=1,le=10)
    squat_lower_angle_deg:float=Field(default=45,gt=0,lt=150)
    squat_standing_angle_deg:float=Field(default=10,ge=0,lt=45)

    @model_validator(mode='after')
    def angle_order(self):
        if self.squat_standing_angle_deg>=self.squat_lower_angle_deg:raise ValueError('Standing angle must be below squat angle')
        return self

def fresh_fatigue():
    return {'counts':{},'evidence':{},'episode':0,'open':False,'recovery':0,'emitted':{}}

def break_persistence(state):
    # A fault/gap is not proof of physiological recovery. Retain episode cooldown.
    state['counts']={};state['evidence']={};state['recovery']=0

def evaluate(state,result,policy,clock,observation_id):
    """Return a local candidate only after same-channel qualifying evidence persists."""
    comparison=result['baseline_comparison']
    rises=comparison['rms_change_percent'];drops=[-x for x in comparison['median_frequency_change_percent']]
    qualifying=[]
    for index,(rise,drop) in enumerate(zip(rises,drops)):
        key=str(index)
        if rise>=policy.rms_rise_percent and drop>=policy.median_frequency_drop_percent:
            state['counts'][key]=state['counts'].get(key,0)+1
            state['evidence'][key]=(state['evidence'].get(key,[])+[observation_id])[-policy.persistent_windows:]
            if state['counts'][key]>=policy.persistent_windows:qualifying.append(index)
        else:
            state['counts'][key]=0;state['evidence'][key]=[]
    if not any(count>0 for count in state['counts'].values()):
        state['recovery']+=1
        if state['recovery']>=policy.recovery_windows:
            state['open']=False;state['emitted']={}
        return None
    state['recovery']=0
    if not qualifying:return None
    if not state['open']:
        state['episode']+=1;state['open']=True;state['emitted']={}
    # Meaningfully changed channels/severity bypass an old signature's cooldown.
    bins=[(i,int((rises[i]-policy.rms_rise_percent)//policy.severity_step_percent),
        int((drops[i]-policy.median_frequency_drop_percent)//policy.severity_step_percent)) for i in qualifying]
    signature=str(bins)
    last=state['emitted'].get(signature)
    if last is not None and clock-last<policy.cooldown_seconds:return None
    state['emitted'][signature]=clock
    return {'scope':policy.scope,'classification':'qualifying_demo_indicator_not_diagnosis',
        'episode':state['episode'],'qualifying_channels':[result['features']['channels'][i] for i in qualifying],
        'rms_rise_percent':rises,'median_frequency_drop_percent':drops,
        'evidence_observation_ids':sorted({oid for i in qualifying for oid in state['evidence'][str(i)]}),
        'cooldown_seconds':policy.cooldown_seconds,
        'limitations':'Demonstration thresholds are not medically validated fatigue thresholds.'}
