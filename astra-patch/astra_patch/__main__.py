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
    # Added on the unified-experience branch: the standalone showcase page (astra_patch/showcase.py).
    showcase=sub.add_parser('showcase',help='Standalone visual showcase page (synthetic data, local only)')
    showcase_sub=showcase.add_subparsers(dest='showcase_command',required=True)
    build=showcase_sub.add_parser('build',help='Write showcase/data/showcase.json from the replay of all three scenarios')
    build.add_argument('--out',type=Path,default=None,help='Output file (default: showcase/data/showcase.json next to the package)')
    serve=showcase_sub.add_parser('serve',help='Serve the showcase folder read-only with the Python standard library')
    serve.add_argument('--host',default='127.0.0.1');serve.add_argument('--port',type=int,default=8150)
    serve.add_argument('--rebuild',action='store_true',help='Regenerate the data file before serving')
    args=parser.parse_args()
    if args.command=='check':
        from .handoff import validate_envelope
        result=validate_envelope(json.loads(Path(args.file).read_text()));print(json.dumps(result,indent=2));return 0 if result['valid'] else 2
    if args.command=='showcase':
        from . import showcase as page
        if args.showcase_command=='build':
            path=page.write_data(args.out);print(f'Wrote {path}');return 0
        return page.serve(args.host,args.port,rebuild=args.rebuild)
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
