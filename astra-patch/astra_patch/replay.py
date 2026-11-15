"""Accelerated recorded-time replay of the summary fixtures in a temporary database.

Shared by `python -m astra_patch replay` and `python -m astra_patch showcase build`, so the
showcase data file comes from exactly the same code path as the command-line demo.
Does not contact a relay or publish messages.
"""
import os
import tempfile
from pathlib import Path

from .console import create, action, observations, CreateConsole, ConsoleAction

SCENARIOS = ('normal', 'fatigue_suspected', 'sensor_fault')


def replay_report(scenario):
    """Run one fixture scenario through the console (create, start, 4 ticks) and return the report."""
    # Accelerated recorded-time demonstration; API controls support separate interactive calls.
    with tempfile.TemporaryDirectory(prefix='astra-patch-demo-') as directory:
        prior = os.environ.get('ASTRA_PATCH_DB'); os.environ['ASTRA_PATCH_DB'] = str(Path(directory) / 'demo.sqlite3')
        try:
            run = create(CreateConsole(configuration={'astronaut_id': 'synthetic-console-only'}, mode='summary_fixture', scenario=scenario))
            action(run['console_id'], ConsoleAction(action='start', round_id=run['round_id'], approved=True))
            for seq in range(1, 5): action(run['console_id'], ConsoleAction(action='tick', round_id=run['round_id'], sequence=seq))
            return {'scenario_label': scenario, 'mode': 'accelerated_recorded_time_not_wall_clock_transmission',
                'external_submission': 'disabled', 'contract_validation': 'not_performed',
                'observations': [row['observation'] for row in observations(run['console_id'], run['round_id'])]}
        finally:
            if prior is None: os.environ.pop('ASTRA_PATCH_DB', None)
            else: os.environ['ASTRA_PATCH_DB'] = prior
