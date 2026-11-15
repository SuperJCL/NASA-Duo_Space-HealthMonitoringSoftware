"""Summary-only fixture adapter; no raw-signal synthesis or partner contract."""
import csv
import hashlib
import json
from pathlib import Path
from uuid import uuid4
from fastapi import HTTPException
from .schema import utcnow

ROOT=Path(__file__).with_name('scenario_fixtures')
MISSING=['subject_identity','sensor_configuration','sampling_rates','raw_emg','raw_imu','acquisition_utc','baseline_compatibility_metadata']
def rows(scenario):
    with (ROOT/'scenario_windows.csv').open() as source:
        selected=[r for r in csv.DictReader(source) if r['scenario']==scenario]
    if not selected:raise HTTPException(422,'Unknown summary fixture scenario')
    return selected

def ingest_summary(conn,run,sequence):
    row=rows(run['scenario'])[sequence-1]
    flags=[]
    if row['motion_artifact_flag']=='1':flags.append('motion_artifact')
    if row['electrode_contact_fault_flag']=='1':flags.append('electrode_contact_fault')
    values={'rms_microvolts':float(row['emg_rms_uv']), 'median_frequency_hz':float(row['emg_median_frequency_hz'])}
    oid=str(uuid4());sid=str(uuid4())
    data={'observation_id':oid,'session_id':sid,'version':1,'source_type':'synthetic',
        'processing_version':'summary-fixture-import-v1','features':None,
        'reported_summary_features':values,
        'signal_quality':{'status':'unsuitable' if flags else 'fixture_reported_acceptable',
            'flags':flags,'reported_score':float(row['quality_score']),'raw_signal_validation':'unavailable'},
        'baseline_comparison':{'status':'not_available','reason':'Individual identity and compatible baseline metadata absent'},
        'reported_baseline':{'rms_microvolts':float(row['baseline_rms_uv']),'median_frequency_hz':float(row['baseline_median_frequency_hz'])},
        'research_indicator':{'status':'not_assessed'},'missing_measurements':MISSING,
        'metadata':{'protocol':row['protocol'],'muscle':row['muscle_site'],'activity':row['activity'],
            'subject_id':None,'conditions':None,'source_type':'synthetic'},
        'observed_at':None,'imported_at':utcnow().isoformat(),'elapsed_seconds':int(row['elapsed_seconds']),
        'provenance':{'dataset_sha256':hashlib.sha256((ROOT/'scenario_windows.csv').read_bytes()).hexdigest(),
            'source_row':sequence,'kind':'synthetic_summary_fixture'},
        'replay_round_id':run['round_id'],'event_id':f"{run['round_id']}:{sequence}",
        'local_schedule':{'kind':'walking_telemetry','interval_seconds':6,'due_elapsed_seconds':int(row['elapsed_seconds'])},
        'evidence_problem':'sensor_quality' if flags else 'baseline_and_raw_evidence_missing',
        'external_submission':'blocked_no_final_contract'}
    conn.execute('INSERT INTO myo_observations VALUES(?,?,?,?)',(oid,sid,1,json.dumps(data)))
    return oid,sid,{'summary_fixture':True}
