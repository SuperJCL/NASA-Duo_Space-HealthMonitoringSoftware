"""Offline intake against the target's authoritative v1 schemas; no transport."""
from datetime import datetime
import hashlib
import json
from pathlib import Path

CONTRACTS = Path(__file__).resolve().parents[2] / 'contracts' / 'schema'
ALLOWED_TYPES = {'scenario.start', 'scenario.reset', 'observation.submitted'}


def validate_envelope(message):
    """Validate supplied v1 messages locally, never invent defaults or authorize sending."""
    errors=[]
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        return {'valid':False,'errors':['JSON Schema validator unavailable; install requirements.txt'],
                'external_submission':'disabled'}
    try:
        rules=json.loads((CONTRACTS/'event-rules.json').read_text())
        envelope=json.loads((CONTRACTS/'envelope.schema.json').read_text())
        errors.extend(e.message for e in Draft202012Validator(envelope).iter_errors(message))
        kind=message.get('type') if isinstance(message,dict) else None
        rule=rules.get(kind)
        if not rule or kind not in ALLOWED_TYPES:
            errors.append('Event is outside Patch handoff scope; HUD/retest/Station actions are prohibited')
        else:
            if message.get('source')!='trigger' or 'trigger' not in rule['publishers']:
                errors.append('Patch messages require the trigger publisher role (not authentication)')
            for field,required in [('caseId',rule['needsCaseId']),('retestId',rule['needsRetestId'])]:
                if required and not message.get(field):errors.append(f'Missing {field}')
            schema=json.loads((CONTRACTS/rule['payloadSchema']).read_text())
            errors.extend(e.message for e in Draft202012Validator(schema).iter_errors(message.get('payload')))
            # Zod Iso date refinement is not represented in generated JSON Schema.
            payload=message.get('payload')
            dates=[message.get('sentAt')]
            if 'occurredAt' in message:dates.append(message['occurredAt'])
            if kind=='observation.submitted' and isinstance(payload,dict):dates.append(payload.get('capturedAt'))
            for value in dates:
                try:datetime.fromisoformat(value.replace('Z','+00:00'))
                except (AttributeError,TypeError,ValueError):errors.append('Invalid event/acquisition timestamp')
    except (OSError,ValueError,KeyError) as exc:
        errors.append('Authoritative contract unavailable or invalid: '+str(exc))
    return {'valid':not errors,'errors':errors,'external_submission':'disabled'}


def review_astra_observation(observation):
    """An intake report, not a v1 payload. Explicitly preserves missing evidence."""
    reported=observation.get('reported_summary_features',{})
    quality=observation.get('signal_quality',{})
    return {
        'publishable':False,'external_submission':'disabled','message':None,
        'source_observation_id':observation.get('observation_id'),
        'source_round_id':observation.get('replay_round_id'),
        'reported_summary_features':reported,'signal_quality':quality,
        'possible_feature_mapping':{
            'medianFreqHz':reported.get('median_frequency_hz') if quality.get('status')=='fixture_reported_acceptable' else None,
            'rmsPctMvc':None,'gripForceN':None},
        'blockers':[
            'No reviewed person, capture-time and structured protocol mapping for the summary fixtures',
            'Required sample rate, impedance and signal-quality percentages are unavailable in summary fixtures',
            'RMS microvolts cannot become percent MVC without compatible MVC calibration',
            'No independently measured grip force; no walking/quadriceps Station baseline',
            'Source flags and quality score cannot substitute for impedance or artifact/dropout percentages',
            'Production authentication and approved transport configuration are unavailable'],
        'contract_sha256':hashlib.sha256((CONTRACTS/'payload.observation.submitted.schema.json').read_bytes()).hexdigest(),
        'note':'Review report only. Nulls and missing data are not zero-filled; no outgoing message is generated.'}
