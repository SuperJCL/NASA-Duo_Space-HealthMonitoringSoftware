"""ASTRA-local integration of the team's console, gated on its missing final contract.

These control/state models are private ASTRA APIs, never public-base payloads.
The original engine's Transport/template renderer is intentionally not wired up.
"""
import json
from uuid import UUID, uuid4
from typing import Literal

import numpy as np
from fastapi import HTTPException
from pydantic import Field, model_validator

from .schema import StrictModel, Configuration, Session, Transition
from .acquisition import transition, SyntheticSource
from .processing import process
from .store import database, event
from .trigger_console_vendor.engine import ReplayEngine, SCENARIOS

CONTRACT_BLOCKER='Target myomars/v1 is authoritative; ASTRA measurement mapping and production authentication are incomplete. External submission is disabled.'

class CreateConsole(StrictModel):
    configuration: Configuration
    scenario: Literal['normal','contact_loss','activity_shift','missing_context','fatigue_suspected','sensor_fault'] = 'normal'
    mode: Literal['synthetic_acquisition','research_observations','summary_fixture'] = 'synthetic_acquisition'
    research_observation_ids: list[UUID] = Field(default_factory=list,max_length=100)

    @model_validator(mode='after')
    def distinct_source_modes(self):
        allowed = ('normal','fatigue_suspected','sensor_fault') if self.mode=='summary_fixture' else tuple(SCENARIOS)
        if self.scenario not in allowed: raise ValueError('Scenario is unavailable for this replay source')
        if self.mode=='summary_fixture' and self.research_observation_ids: raise ValueError('Fixture replay cannot contain research observations')
        if self.mode=='research_observations' and not self.research_observation_ids:
            raise ValueError('Research replay requires existing research observation IDs')
        if self.mode=='synthetic_acquisition' and self.research_observation_ids:
            raise ValueError('Research observations cannot become synthetic patch measurements')
        if len(set(self.research_observation_ids))!=len(self.research_observation_ids):
            raise ValueError('Duplicate research observation IDs')
        return self

class ConsoleAction(StrictModel):
    action: Literal['start','pause','resume','reset','select','tick','repeat','submit']
    round_id: UUID
    sequence: int | None = Field(default=None,ge=1)
    event_id: str | None = Field(default=None,min_length=1,max_length=100)
    scenario: Literal['normal','contact_loss','activity_shift','missing_context','fatigue_suspected','sensor_fault'] | None = None
    approved: bool = False
    operator: str = Field(default='local-demo-operator',min_length=2,max_length=100)

def stable_event_id(console_id,round_id,sequence):
    return f'{round_id}:{sequence}'  # Existing console event format, not a public-base protocol.

def load(conn,console_id):
    row=conn.execute('SELECT payload FROM myo_console_runs WHERE id=?',(str(console_id),)).fetchone()
    if row is None:raise HTTPException(404,'Console not found')
    return json.loads(row['payload'])

def restore_engine(run):
    engine=ReplayEngine()  # No public Transport can be supplied to the integration.
    engine.scenario='normal' if run['mode']=='summary_fixture' else run['scenario'];engine.round_id=run['round_id']
    engine.state=run['state'];engine.index=run['index']
    return engine

def total(run):
    if run['mode']=='summary_fixture':
        from .scenario_fixture import rows
        return len(rows(run['scenario']))
    return len(run['research_observation_ids']) if run['mode']=='research_observations' else len(SCENARIOS[run['scenario']])

def status(run):
    return {'console_id':run['console_id'],'round_id':run['round_id'],'scenario':run['scenario'],
        'state':run['state'],'mode':run['mode'],'sequence':run['index'],'processed_count':run['index'],
        'sent_count':0,'total':total(run),'external_submission':'blocked_no_final_contract',
        'contract_blocker':CONTRACT_BLOCKER,'partner_acknowledgment':None,
        'local_execution':run.get('local_execution'),'last_observation_id':run.get('last_observation_id')}

def save(conn,run):
    conn.execute('UPDATE myo_console_runs SET round_id=?,payload=? WHERE id=?',
        (run['round_id'],json.dumps(run,allow_nan=False),run['console_id']))

def create(request):
    engine=ReplayEngine();engine.select('normal' if request.mode=='summary_fixture' else request.scenario)
    if request.mode=='summary_fixture':
        from .scenario_fixture import rows
        rows(request.scenario)
        engine.scenario=request.scenario
    run={'console_id':str(uuid4()),'round_id':engine.round_id,'scenario':engine.scenario,
        'state':engine.state,'index':0,'mode':request.mode,'configuration':request.configuration.model_dump(mode='json'),
        'research_observation_ids':[str(x) for x in request.research_observation_ids],
        'permission_to_record':False,'operator':None,'local_execution':None,'last_observation_id':None}
    with database() as conn:
        for oid in run['research_observation_ids']:
            row=conn.execute('SELECT payload FROM myo_observations WHERE id=?',(oid,)).fetchone()
            if row is None:raise HTTPException(404,'Research observation not found')
            result=json.loads(row['payload'])
            if result.get('source_type',result.get('metadata',{}).get('source_type'))!='research':
                raise HTTPException(409,'Only explicitly labeled research observations can enter research replay')
        conn.execute('INSERT INTO myo_console_runs VALUES(?,?,?)',(run['console_id'],run['round_id'],json.dumps(run)))
        event(conn,run['console_id'],'console_created',{'round_id':run['round_id'],'mode':run['mode'],'external_submission':'disabled'})
    return status(run)

def assert_round(run,round_id):
    if run['round_id']!=str(round_id):raise HTTPException(409,'Stale replay round rejected; refresh console status')

def planned_inputs(run,index):
    # Original script values are planned synthetic inputs, never measured results.
    plan=dict(SCENARIOS[run['scenario']][index])
    return {'target_raw_rms_microvolts':plan['rms_uv'],'motion_gain_dimensionless':plan['imu_motion'],
        'simulated_contact':plan['contact']=='good',
        'measurement_conditions':None if run['scenario']=='missing_context' and index>0 else run['configuration']['conditions']}

def acquire_and_process(conn,run,sequence):
    c=Configuration(**run['configuration'])
    plan=planned_inputs(run,sequence-1)
    c=c.model_copy(update={'conditions':plan['measurement_conditions'] or '', 'seed':(c.seed+sequence-1)%(2**32)})
    session=Session(configuration=c)
    transition(session,Transition(action='arm',operator=run['operator'],approved=run['permission_to_record']))
    transition(session,Transition(action='start',operator=run['operator']))
    recording=SyntheticSource().capture(session,2,'normal' if plan['simulated_contact'] else 'contact')
    raw=np.asarray(recording.emg)
    raw*=plan['target_raw_rms_microvolts']/np.sqrt(np.mean(raw**2,axis=0))
    recording.emg=raw.tolist()
    imu=np.asarray(recording.imu)
    imu[:,0:2]*=plan['motion_gain_dimensionless']
    recording.imu=imu.tolist()
    recording.quality.pop('scenario',None)
    recording.provenance['generator']='myomars-trigger-console-synthetic-v1'
    recording.provenance['synthetic_input_parameters']=plan
    transition(session,Transition(action='complete',operator=run['operator']))
    result=process(recording)  # No baseline provided; the scene label cannot set quality/features.
    oid=str(uuid4());sid=str(session.session_id)
    result.update(observation_id=oid,session_id=sid,version=1,evidence_reference=f'/api/myomars/v1/sessions/{sid}/recording')
    conn.execute('INSERT INTO myo_sessions VALUES(?,?)',(sid,session.model_dump_json()))
    conn.execute('INSERT INTO myo_recordings VALUES(?,?)',(sid,recording.model_dump_json()))
    conn.execute('INSERT INTO myo_observations VALUES(?,?,?,?)',(oid,sid,1,json.dumps(result,allow_nan=False)))
    event(conn,sid,'console_acquisition_processed',{'observation_id':oid,'source_type':'synthetic'})
    return oid,sid,plan

def step(conn,run,command):
    sequence=command.sequence
    if sequence is None:raise HTTPException(422,'Tick requires an explicit sequence for idempotency')
    key=stable_event_id(run['console_id'],run['round_id'],sequence)
    if command.event_id is not None and str(command.event_id)!=key:
        raise HTTPException(409,'Event ID does not match replay round and sequence')
    row=conn.execute('SELECT execution FROM myo_console_events WHERE event_id=?',(key,)).fetchone()
    if row:
        execution=json.loads(row['execution']);execution.update(duplicate=True,status='local_duplicate',processing_performed=False)
        response=status(run);response['local_execution']=execution
        return response
    if run['state']=='paused':return status(run)
    if run['state']!='running':raise HTTPException(409,'Replay is not running')
    if sequence!=run['index']+1 or sequence>total(run):raise HTTPException(409,'Unexpected or out-of-order sequence')
    if run['mode']=='summary_fixture':
        from .scenario_fixture import ingest_summary
        oid,sid,plan=ingest_summary(conn,run,sequence)
    elif run['mode']=='research_observations':
        oid=run['research_observation_ids'][sequence-1]
        row=conn.execute('SELECT session_id FROM myo_observations WHERE id=?',(oid,)).fetchone()
        if row is None:raise HTTPException(404,'Research observation unavailable')
        sid=row['session_id'];plan=None
    else:oid,sid,plan=acquire_and_process(conn,run,sequence)
    execution={'status':'processed_locally' if plan else 'referenced_research_locally','event_id':key,
        'round_id':run['round_id'],'sequence':sequence,'observation_id':oid,'duplicate':False,
        'processing_performed':plan is not None,'external_submitted':False,'partner_acknowledgment':None}
    conn.execute('INSERT INTO myo_console_events VALUES(?,?,?,?,?,?,?)',
        (key,run['console_id'],run['round_id'],sequence,oid,sid,json.dumps(execution)))
    run['index']=sequence;run['last_observation_id']=oid;run['local_execution']=execution
    if sequence==total(run):run['state']='completed'
    save(conn,run)
    event(conn,run['console_id'],'console_step_local',{'round_id':run['round_id'],'event_id':key,'observation_id':oid,'external_submission':'disabled'})
    return status(run)

def action(console_id,command):
    # BEGIN IMMEDIATE serializes tick/pause/reset across threads and server workers.
    # No network is called while holding this lock or anywhere in this console.
    with database() as conn:
        run=load(conn,console_id);assert_round(run,command.round_id)
        if command.action=='submit':raise HTTPException(423,CONTRACT_BLOCKER)
        if command.action=='tick':return step(conn,run,command)
        if command.action=='repeat':
            if run['index']==0:raise HTTPException(409,'No local observation to repeat')
            return step(conn,run,command.model_copy(update={'sequence':run['index']}))
        engine=restore_engine(run)
        try:
            if command.action=='start':
                if not command.approved:raise HTTPException(403,'Explicit acquisition/replay permission required; this does not authorize EVA')
                engine.start();run['permission_to_record']=True;run['operator']=command.operator
            elif command.action=='select':
                if command.scenario is None:raise HTTPException(422,'Select requires a scenario label')
                if run['mode']=='summary_fixture':
                    from .scenario_fixture import rows
                    rows(command.scenario)
                    engine.select('normal');run['scenario']=command.scenario
                else:engine.select(command.scenario)
            else:getattr(engine,command.action)()
        except ValueError as exc:raise HTTPException(409,str(exc))
        changed_round=run['round_id']!=engine.round_id
        run.update(round_id=engine.round_id,state=engine.state,index=engine.index,scenario=run['scenario'] if run['mode']=='summary_fixture' else engine.scenario)
        if changed_round:
            run.update(permission_to_record=False,operator=None,local_execution=None,last_observation_id=None)
        save(conn,run)
        event(conn,run['console_id'],'console_'+command.action,{'round_id':run['round_id'],'external_submission':'disabled'})
    return status(run)

def observations(console_id,round_id):
    with database() as conn:
        run=load(conn,console_id);assert_round(run,round_id)
        rows=conn.execute('SELECT * FROM myo_console_events WHERE console_id=? AND round_id=? ORDER BY sequence',
            (str(console_id),str(round_id))).fetchall()
        result=[]
        for row in rows:
            data=json.loads(conn.execute('SELECT payload FROM myo_observations WHERE id=?',(row['observation_id'],)).fetchone()[0])
            result.append({'replay_event_id':row['event_id'],'replay_round_id':row['round_id'],'sequence':row['sequence'],
                'scenario_label':run['scenario'],'observation':data})
    return result

def assert_not_console_submission(conn,observation_id):
    row=conn.execute('SELECT e.console_id,e.round_id FROM myo_console_events e JOIN myo_observations o ON o.session_id=e.session_id WHERE o.id=? ORDER BY e.rowid DESC LIMIT 1',
        (str(observation_id),)).fetchone()
    if row:
        run=load(conn,row['console_id'])
        if run['round_id']!=row['round_id']:raise HTTPException(409,'Stale console round cannot be submitted')
        raise HTTPException(423,CONTRACT_BLOCKER)
