"""Private streaming rule engine. Internal evidence rows are NOT partner messages."""
from datetime import datetime,timedelta,timezone
import hashlib
import json
import math
from typing import Literal
from uuid import UUID,uuid4,uuid5,NAMESPACE_URL

import numpy as np
from fastapi import HTTPException
from pydantic import Field

from .acquisition import SyntheticSource,transition
from .console import CONTRACT_BLOCKER
from .fatigue import TriggerPolicy,fresh_fatigue,break_persistence,evaluate
from .processing import Baseline,ProcessingConfig,process
from .schema import Configuration,Recording,Session,StrictModel,Transition,utcnow
from .store import database,event
from .trigger_console_vendor.engine import ReplayEngine

def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)

class CreateTriggerStream(StrictModel):
    configuration:Configuration
    source_type:Literal['synthetic','patch']='synthetic'
    processing:ProcessingConfig=Field(default_factory=ProcessingConfig)
    policy:TriggerPolicy=Field(default_factory=TriggerPolicy)
    baseline:Baseline|None=None

class StreamControl(StrictModel):
    round_id:UUID
    action:Literal['start','pause','resume','reset']
    approved:bool=False

class IncomingWindow(StrictModel):
    round_id:UUID
    sequence:int=Field(ge=1)
    activity:Literal['walking','squat','other']
    recording:Recording

def fresh_state():
    return {'last_end':None,'walking_anchor':None,'fatigue':fresh_fatigue(),'faults':{},
        'squat_angle':0.,'squat_lowered':False,'squat_count':0,'squat_evidence':[],'squat_group':0}

def load(conn,stream_id):
    row=conn.execute('SELECT payload FROM myo_trigger_streams WHERE id=?',(str(stream_id),)).fetchone()
    if row is None:raise HTTPException(404,'Trigger stream not found')
    return json.loads(row['payload'])

def assert_round(run,round_id):
    if run['round_id']!=str(round_id):raise HTTPException(409,'Stale trigger round rejected')

def save(conn,run):
    conn.execute('UPDATE myo_trigger_streams SET round_id=?,payload=? WHERE id=?',
        (run['round_id'],encoded(run),run['stream_id']))

def status(run):
    return {'stream_id':run['stream_id'],'round_id':run['round_id'],'state':run['state'],
        'sequence':run['sequence'],'policy':run['policy'],'policy_digest':run['policy_digest'],
        'completed_squats_in_group':run['runtime']['squat_count'],
        'baseline_evidence_reference':f'/api/myomars/v1/trigger-streams/{run["stream_id"]}/baseline-evidence',
        'external_submission':'blocked_no_final_contract','contract_blocker':CONTRACT_BLOCKER,
        'public_transmissions':0,'partner_acknowledgment':None}

def create(request):
    policy=request.policy.model_dump();digest=hashlib.sha256(encoded(policy).encode()).hexdigest()
    run={'stream_id':str(uuid4()),'round_id':ReplayEngine().round_id,'state':'idle','sequence':0,
        'configuration':request.configuration.model_dump(mode='json'),'source_type':request.source_type,
        'processing':request.processing.model_dump(),'policy':policy,'policy_digest':digest,
        'baseline':request.baseline.model_dump() if request.baseline else None,'runtime':fresh_state()}
    run['demo_anchor']=(utcnow()-timedelta(seconds=60)).isoformat()
    with database() as conn:
        prior=conn.execute('SELECT digest FROM myo_trigger_policies WHERE version=?',(policy['version'],)).fetchone()
        if prior and prior['digest']!=digest:raise HTTPException(409,'Changed demonstration thresholds require a new policy version')
        conn.execute('INSERT OR IGNORE INTO myo_trigger_policies VALUES(?,?,?)',(policy['version'],digest,encoded(policy)))
        conn.execute('INSERT INTO myo_trigger_streams VALUES(?,?,?)',(run['stream_id'],run['round_id'],encoded(run)))
        event(conn,run['stream_id'],'trigger_stream_created',{'round_id':run['round_id'],'policy_digest':digest,'public_submission':'disabled'})
    return status(run)

def control(stream_id,command):
    with database() as conn:
        run=load(conn,stream_id);assert_round(run,command.round_id)
        engine=ReplayEngine();engine.round_id=run['round_id'];engine.state=run['state']
        try:
            if command.action=='start':
                if not command.approved:raise HTTPException(403,'Explicit recording/replay permission required; not EVA authorization')
                engine.start()
            else:getattr(engine,command.action)()
        except ValueError as exc:raise HTTPException(409,str(exc))
        run['state']=engine.state
        if command.action=='reset':
            run.update(round_id=engine.round_id,sequence=0,runtime=fresh_state())
            run['demo_anchor']=(utcnow()-timedelta(seconds=60)).isoformat()
            conn.execute("UPDATE myo_trigger_events SET status='invalidated_by_reset' WHERE stream_id=? AND round_id=?",
                (run['stream_id'],str(command.round_id)))
        elif command.action in ('pause','resume'):
            rt=run['runtime'];break_persistence(rt['fatigue'])
            rt.update(last_end=None,walking_anchor=None,squat_angle=0.,squat_lowered=False)
        save(conn,run)
        event(conn,run['stream_id'],'trigger_'+command.action,{'round_id':run['round_id']})
    return status(run)

def emit(conn,run,kind,r,oid,clock,evidence):
    identifier=str(uuid4())
    row={'id':identifier,'kind':kind,'stream_id':run['stream_id'],'round_id':run['round_id'],
        'observation_id':oid,'raw_reference':f'/api/myomars/v1/sessions/{r.session_id}/recording/raw',
        'observed_at':r.started_at.isoformat(),'observation_end_epoch_seconds':clock,
        'detected_at':utcnow().isoformat(),'policy_version':run['policy']['version'],
        'policy_digest':run['policy_digest'],'evidence':evidence,
        'measurement_conditions':r.conditions,'protocol':r.protocol,'subject_id':r.subject_id,
        'source_type':r.source_type,'provenance':r.provenance,
        'submission':'blocked_no_final_contract','partner_acknowledgment':None,
        'medical_classification':'not_diagnosed','scope':'non_clinical_demonstration'}
    conn.execute('INSERT INTO myo_trigger_events VALUES(?,?,?,?,?,?,?,?)',
        (identifier,run['stream_id'],run['round_id'],kind,str(r.session_id),oid,encoded(row),'held_contract'))
    event(conn,run['stream_id'],'trigger_candidate_held',{'id':identifier,'kind':kind,'round_id':run['round_id']})
    return row

def squat_cycles(rt,r,policy,oid):
    # Demonstration assumes calibrated gyro-Y alignment and zero bias. No squat
    # count comes from a scene label, manual completion boolean, or EMG amplitude.
    if oid not in rt['squat_evidence']:rt['squat_evidence'].append(oid)
    completed=[]
    for row in r.imu:
        rt['squat_angle']=max(0.,rt['squat_angle']+math.degrees(row[4])/r.imu_sample_rate_hz)
        if rt['squat_angle']>=policy.squat_lower_angle_deg:rt['squat_lowered']=True
        if rt['squat_lowered'] and rt['squat_angle']<=policy.squat_standing_angle_deg:
            rt['squat_lowered']=False;rt['squat_count']+=1
            if rt['squat_count']==policy.squat_repetitions:
                rt['squat_group']+=1
                completed.append({'completed_repetitions':3,'group':rt['squat_group'],
                    'evidence_observation_ids':list(rt['squat_evidence']),
                    'imu_method':'demo_gyro_y_integrated_angle_not_hardware_validated'})
                rt['squat_count']=0;rt['squat_evidence']=[]
    return completed

def ingest(stream_id,request):
    r=request.recording
    with database() as conn:
        run=load(conn,stream_id);assert_round(run,request.round_id)
        digest=hashlib.sha256(encoded(request.model_dump(mode='json')).encode()).hexdigest()
        existing=conn.execute('SELECT digest,result FROM myo_trigger_frames WHERE stream_id=? AND round_id=? AND sequence=?',
            (str(stream_id),run['round_id'],request.sequence)).fetchone()
        if existing:
            if existing['digest']!=digest:raise HTTPException(409,'Sequence reused with different evidence')
            result=json.loads(existing['result']);result.update(duplicate=True,processing_performed=False)
            return result
        if run['state']=='paused':return {**status(run),'accepted':False,'reason':'paused','events':[]}
        if run['state']!='running':raise HTTPException(409,'Start the trigger stream before ingesting recordings')
        if request.sequence!=run['sequence']+1:raise HTTPException(409,'Out-of-order trigger sequence')
        if conn.execute('SELECT 1 FROM myo_recordings WHERE id=?',(str(r.session_id),)).fetchone():
            raise HTTPException(409,'Raw session evidence already exists; use its original sequence')
        c=run['configuration']
        if r.source_type!=run['source_type'] or r.subject_id!=c['astronaut_id'] or r.astronaut_id!=c['astronaut_id'] or any(
            getattr(r,k)!=c[k] for k in ('device_id','muscle','sensor_configuration','channels')):
            raise HTTPException(409,'Recording identity/configuration differs from the approved stream')
        policy=TriggerPolicy(**run['policy']);rt=run['runtime']
        if r.emg_sample_rate_hz<=0 or len(r.emg)>r.emg_sample_rate_hz*policy.max_window_seconds:
            raise HTTPException(422,'Expected a positive rate and a bounded streaming window')
        clock=None;extra=[]
        if r.started_at.tzinfo is not None and r.started_at.utcoffset().total_seconds()==0:
            start=r.started_at.timestamp();clock=start+len(r.emg)/r.emg_sample_rate_hz
            if rt['last_end'] is not None:
                if start<rt['last_end']-1/r.emg_sample_rate_hz:raise HTTPException(409,'Overlapping/reordered recording timestamps')
                if start-rt['last_end']>policy.max_gap_seconds:
                    extra.append('recording_gap');rt.update(walking_anchor=None,squat_angle=0.,squat_lowered=False,squat_count=0,squat_evidence=[])
        if request.activity=='walking' and r.protocol!='walking_demo_v1':extra.append('walking_protocol_not_confirmed')
        if request.activity=='squat' and r.protocol!='squat_demo_v1':extra.append('squat_protocol_not_confirmed')
        processing_input=r.model_copy(deep=True)
        if extra:processing_input.quality['interrupted']=True
        result=process(processing_input,ProcessingConfig(**run['processing']),Baseline(**run['baseline']) if run['baseline'] else None)
        if extra:
            flags=result['signal_quality']['flags']
            result['signal_quality']['flags']=sorted(set([f for f in flags if f!='recording_interrupted']+extra))
        oid=str(uuid4());sid=str(r.session_id)
        result.update(observation_id=oid,session_id=sid,version=1,evidence_reference=f'/api/myomars/v1/sessions/{sid}/recording')
        conn.execute('INSERT INTO myo_recordings VALUES(?,?)',(sid,r.model_dump_json()))
        conn.execute('INSERT INTO myo_observations VALUES(?,?,?,?)',(oid,sid,1,encoded(result)))
        events=[];quality_ok=result['signal_quality']['status']=='acceptable'
        comparison_ok=result['baseline_comparison']['status']=='compatible'
        time_ok=clock is not None and not any(f in result['signal_quality']['flags'] for f in ('stale_recording','future_timestamp','invalid_utc_timestamp'))
        if not quality_ok or not comparison_ok:
            break_persistence(rt['fatigue'])
            problem={'category':'sensor_quality' if not quality_ok else 'baseline_evidence',
                'signal_quality':result['signal_quality'],'baseline_comparison':result['baseline_comparison'],
                'evidence_observation_ids':[oid],'physiological_interpretation':'not_assessed'}
            signature=encoded({'category':problem['category'],'flags':result['signal_quality']['flags'],
                'comparison':result['baseline_comparison']})
            fault_clock=clock if time_ok else utcnow().timestamp()
            if signature not in rt['faults'] or fault_clock-rt['faults'][signature]>=policy.cooldown_seconds:
                events.append(emit(conn,run,'evidence_quality_problem',r,oid,clock,problem));rt['faults'][signature]=fault_clock
        else:
            candidate=evaluate(rt['fatigue'],result,policy,clock,oid)
            if candidate:
                candidate.update(signal_quality=result['signal_quality'],baseline_comparison=result['baseline_comparison'],
                    features=result['features'],processing=result['processing'],processing_version=result['processing_version'],
                    preprocessing_history=result['preprocessing_history'])
                events.append(emit(conn,run,'abnormal_observation',r,oid,clock,candidate))
        # Rules 1/2 run independently of Rule 3 and do not await its persistence.
        if time_ok:
            if request.activity=='walking':
                if rt['walking_anchor'] is None:rt['walking_anchor']=r.started_at.timestamp()
                if clock-rt['walking_anchor']>=6-1e-6:
                    due=rt['walking_anchor']+6
                    events.append(emit(conn,run,'walking_telemetry',r,oid,clock,{'interval_seconds':6,
                        'scheduled_observation_epoch_seconds':due,'window_completion_delay_seconds':max(0.,clock-due),
                        'signal_quality':result['signal_quality']}))
                    rt['walking_anchor']=due
            else:rt['walking_anchor']=None
            rt['last_end']=clock
        else:rt['last_end']=None;rt['walking_anchor']=None
        if request.activity=='squat' and quality_ok and r.imu and r.imu_sample_rate_hz:
            for completed in squat_cycles(rt,r,policy,oid):events.append(emit(conn,run,'squat_assessment',r,oid,clock,completed))
        else:rt.update(squat_angle=0.,squat_lowered=False)
        run['sequence']=request.sequence;save(conn,run)
        output={**status(run),'accepted':True,'duplicate':False,'processing_performed':True,
            'observation_id':oid,'signal_quality':result['signal_quality'],'baseline_comparison':result['baseline_comparison'],'events':events}
        conn.execute('INSERT INTO myo_trigger_frames VALUES(?,?,?,?,?,?,?)',
            (str(stream_id),run['round_id'],request.sequence,digest,sid,oid,encoded(output)))
        return output

def events_for(stream_id,round_id):
    with database() as conn:
        run=load(conn,stream_id);assert_round(run,round_id)
        return [{**json.loads(row['payload']),'status':row['status']} for row in conn.execute(
            'SELECT payload,status FROM myo_trigger_events WHERE stream_id=? AND round_id=? ORDER BY rowid',(str(stream_id),str(round_id)))]

def assert_submission_blocked(conn,observation_id):
    row=conn.execute('SELECT f.stream_id,f.round_id FROM myo_trigger_frames f JOIN myo_observations o ON o.session_id=f.source_session_id WHERE o.id=? ORDER BY f.rowid DESC LIMIT 1',
        (str(observation_id),)).fetchone()
    if row:
        run=load(conn,row['stream_id'])
        if run['round_id']!=row['round_id']:raise HTTPException(409,'Old trigger round cannot be submitted')
        raise HTTPException(423,CONTRACT_BLOCKER)

class DemoStreamRequest(StrictModel):
    configuration:Configuration
    activity:Literal['walking','squat']='walking'
    policy:TriggerPolicy=Field(default_factory=TriggerPolicy)

class DemoWindow(StrictModel):
    round_id:UUID
    sequence:int=Field(ge=1)
    signal:Literal['normal','qualifying','poor_contact']='normal'

def synthetic_window(configuration,round_id,sequence,started_at,signal='normal',activity='walking'):
    c=configuration.model_copy(update={'seed':(configuration.seed+sequence-1)%(2**32)})
    session=Session(configuration=c,session_id=uuid5(NAMESPACE_URL,f'{round_id}:{sequence}'))
    transition(session,Transition(action='arm',operator='synthetic-source',approved=True))
    transition(session,Transition(action='start',operator='synthetic-source'))
    session.started_at=started_at
    r=SyntheticSource().capture(session,1,'normal' if signal!='poor_contact' else 'contact')
    t=np.asarray(r.emg_time_s)
    frequency_scale=.6 if signal=='qualifying' else 1.
    amplitude_scale=1.5 if signal=='qualifying' else 1.
    r.emg=np.column_stack([65*amplitude_scale*np.sin(2*np.pi*(100+10*(i%8))*frequency_scale*t) for i in range(len(c.channels))]).tolist()
    r.quality.pop('scenario',None)
    if activity=='squat':
        imu=np.asarray(r.imu);imu[:,4]=1. if sequence%2 else -1.;r.imu=imu.tolist()
    r.provenance.update(generator='myomars-trigger-synthetic-replay-v1',time_basis='synthetic_replay_UTC',
        synthetic_input_parameters={'amplitude_scale':amplitude_scale,'frequency_scale':frequency_scale,'contact':signal!='poor_contact'})
    return r

def create_demo(request):
    c=request.configuration.model_copy(update={'protocol':request.activity+'_demo_v1',
        'conditions':'synthetic_constant_load_'+request.activity})
    processing=ProcessingConfig()
    r=synthetic_window(c,str(uuid4()),1,utcnow(),'normal',request.activity)
    calibration=process(r,processing)
    baseline=Baseline(baseline_id='synthetic-calibration-'+str(uuid4()),metadata=calibration['metadata'],
        rms=calibration['features']['rms'],median_frequency_hz=calibration['features']['median_frequency_hz'])
    created=create(CreateTriggerStream(configuration=c,policy=request.policy,processing=processing,baseline=baseline))
    with database() as conn:
        run=load(conn,created['stream_id'])
        run['calibration_evidence']={'recording':r.model_dump(mode='json'),'processing_result':calibration,
            'scope':'synthetic_calibration_only_not_a_real_astronaut_baseline'}
        save(conn,run)
    return created

def demo_ingest(stream_id,request):
    with database() as conn:
        run=load(conn,stream_id);assert_round(run,request.round_id)
        if run['source_type']!='synthetic':raise HTTPException(409,'Synthetic demo cannot feed a real sensor stream')
    c=Configuration(**run['configuration'])
    activity='squat' if c.protocol=='squat_demo_v1' else 'walking'
    started=datetime.fromisoformat(run['demo_anchor'])+timedelta(seconds=request.sequence-1)
    r=synthetic_window(c,run['round_id'],request.sequence,started,request.signal,activity)
    return ingest(stream_id,IncomingWindow(round_id=request.round_id,sequence=request.sequence,activity=activity,recording=r))
