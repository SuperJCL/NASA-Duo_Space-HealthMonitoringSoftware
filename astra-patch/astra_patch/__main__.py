"""Headless console/intake entry point. Does not contact a relay or publish messages."""
import argparse
import json
import os
import tempfile
from pathlib import Path
from .console import create,action,observations,CreateConsole,ConsoleAction


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    replay=sub.add_parser('replay');replay.add_argument('--scenario',choices=['normal','fatigue_suspected','sensor_fault'],required=True)
    check=sub.add_parser('check');check.add_argument('file')
    args=parser.parse_args()
    if args.command=='check':
        from .handoff import validate_envelope
        result=validate_envelope(json.loads(Path(args.file).read_text()));print(json.dumps(result,indent=2));return 0 if result['valid'] else 2
    # Accelerated recorded-time demonstration; API controls support separate interactive calls.
    with tempfile.TemporaryDirectory(prefix='astra-patch-demo-') as directory:
        prior=os.environ.get('ASTRA_PATCH_DB');os.environ['ASTRA_PATCH_DB']=str(Path(directory)/'demo.sqlite3')
        try:
            run=create(CreateConsole(configuration={'astronaut_id':'synthetic-console-only'},mode='summary_fixture',scenario=args.scenario))
            action(run['console_id'],ConsoleAction(action='start',round_id=run['round_id'],approved=True))
            for seq in range(1,5):action(run['console_id'],ConsoleAction(action='tick',round_id=run['round_id'],sequence=seq))
            print(json.dumps({'scenario_label':args.scenario,'mode':'accelerated_recorded_time_not_wall_clock_transmission',
                'external_submission':'disabled','contract_validation':'not_performed',
                'observations':[row['observation'] for row in observations(run['console_id'],run['round_id'])]},indent=2))
        finally:
            if prior is None:os.environ.pop('ASTRA_PATCH_DB',None)
            else:os.environ['ASTRA_PATCH_DB']=prior
    return 0

if __name__=='__main__':raise SystemExit(main())
