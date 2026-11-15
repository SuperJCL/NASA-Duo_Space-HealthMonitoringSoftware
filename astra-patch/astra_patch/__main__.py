"""Headless console/intake entry point. Does not contact a relay or publish messages."""
import argparse
import json
from pathlib import Path
from .replay import SCENARIOS, replay_report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    replay=sub.add_parser('replay');replay.add_argument('--scenario',choices=list(SCENARIOS),required=True)
    check=sub.add_parser('check');check.add_argument('file')
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
    print(json.dumps(replay_report(args.scenario),indent=2))
    return 0

if __name__=='__main__':raise SystemExit(main())
