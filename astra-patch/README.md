# ASTRA / MyoMars — standalone Python demo

ASTRA runs entirely under `astra-patch/`. No HUD, Mars Station, Relay, Next.js,
Node.js, or parent contract directory is needed for the demo. It includes synthetic
sEMG/IMU Patch Acquisition, MuscleSense processing, a headless Trigger Console and
NORMAL, FATIGUE SUSPECTED and SENSOR FAULT scenarios. External transmission is disabled.

## Setup

From this directory, use Python 3.12 or newer:

```bash
python3 -m venv .venv
.venv/bin/python3 -m pip install -r requirements.txt
```

## Start the local API

One command from `astra-patch/`:

```bash
MYOMARS_ACQUISITION_TOKEN="$(.venv/bin/python3 -c 'import secrets; print(secrets.token_urlsafe(32))')" ASTRA_PATCH_DB="$PWD/astra-patch.sqlite3" .venv/bin/python3 -m uvicorn astra_patch.service:app --host 127.0.0.1 --port 8142
```

For interactive authenticated requests, instead set `MYOMARS_ACQUISITION_TOKEN`
in your terminal to a private token of at least 16 characters, then start:

```bash
.venv/bin/python3 -m uvicorn astra_patch.service:app --host 127.0.0.1 --port 8142
```

Open `http://127.0.0.1:8142/docs`. Choose **Authorize**, enter that bearer token,
then use **Try it out** on acquisition, console and trigger-stream endpoints.
Create a console with a chosen scenario and `mode: summary_fixture`; use its
returned console ID and round ID for Start, Tick, Pause, Resume and Reset actions.
Start requires `approved: true` for local replay consent, never EVA authorization.
Reset returns a new round ID; use it for subsequent calls. The API schemas show
required fields and action names. No background clock sends observations: submit
Tick actions explicitly. Stop the service with Ctrl-C. Keep tokens and SQLite
files local; never commit them. The one-command random token is not printed, so
use the separately configured token approach when operating protected endpoints.

## Replay scenarios without starting any service

```bash
.venv/bin/python3 -m astra_patch replay --scenario normal
.venv/bin/python3 -m astra_patch replay --scenario fatigue_suspected
.venv/bin/python3 -m astra_patch replay --scenario sensor_fault
```

Each command emits four local observations from a temporary database, then deletes
that database. Playback is accelerated recorded time (6/12/18/24 seconds), not
wall-clock transmission. Output is ASTRA's internal observation model, not a
public-base message. Scenario labels are separate from measured fixture values.

## Tests

```bash
PYTHONPATH=. .venv/bin/python3 -m pytest -q tests
```

The standalone tests copy the package without parent application files and verify
all three CLI scenarios, API startup and rejection of unavailable contracts.
Four optional target-contract integration cases skip when parent contracts are absent.

## Boundaries and limitations

This is a headless Python demo and API explorer, not a graphical HUD. Synthetic
summary scenarios are not raw waveform recordings or validated fatigue evidence.
Signal-quality faults remain separate from physiological indicators. Existing
walking, three-squat and automatic demonstration trigger rules remain unchanged.
No medical diagnosis, automatic retest result, base analysis, treatment, EVA
approval or HUD alert is produced. No production transport can be enabled here.

Optional `python -m astra_patch check <message.json>` validates against authoritative
parent `contracts/schema/` artifacts when available. Missing contracts fail
validation with exit code 2; replay never requires them or invents replacements.
See `INTEGRATION.md` for the optional handoff boundary.
