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

## Showcase page

A small visual page that explains the same demo: the patch and where it sits, what the
sEMG and IMU sensors record, the three replay scenarios with their indicators and signal
quality, and one plain sentence per scenario. Synthetic data, standalone demo.

```bash
.venv/bin/python3 -m astra_patch showcase serve            # http://127.0.0.1:8150/
.venv/bin/python3 -m astra_patch showcase serve --port 8160 --rebuild
.venv/bin/python3 -m astra_patch showcase build            # rewrite showcase/data/showcase.json
```

- **Server:** Python standard library only (`http.server`). It serves `showcase/` read-only (GET/HEAD,
  no directory listings) and finds the folder from the package location, so it works from any
  working directory. It builds the data file first only when it is missing, or with `--rebuild`.
  Ctrl+C stops it.
- **Page:** `showcase/index.html`, `app.js`, `style.css`; no framework, CDN or build step; works
  offline. It uses the shared MyoMars design resources copied into `showcase/assets/` (do not edit
  them here: edit `design/` and run `npm run design:sync`). A scenario can be linked with
  `#scenario=sensor_fault` or `?scenario=sensor_fault`.
- **Data:** `showcase build` runs the same code path as `replay` (`astra_patch.replay.replay_report`:
  console create, start, four ticks, observations, in a temporary database) for all three scenarios
  and writes `showcase/data/showcase.json` with sorted keys. Random ids and the wall-clock import
  time are replaced with stable values (listed in the file's `normalization` block), so rebuilding
  gives byte-identical output; every other field is the replay output unchanged. The page only
  displays this file: no analysis rules in JavaScript.
- **Waveforms:** a 1 s excerpt of the API capture path's seeded synthetic signal
  (`acquisition.SyntheticSource.capture`, seed 42, `actual_sensor: false`): sEMG channel E01
  decimated for display (2000 → 500 Hz) and IMU accelerometer X/Y at 100 Hz. It is labelled
  "Synthetic illustrative signal from the demo's capture path" and the page says that the scenario
  windows are summary features only, so the waveform is not the source of their numbers.
- **Independence:** not connected to the Mars Base, the HUD or the relay. The page fetches only its
  own data file (the server sends a `connect-src 'self'` Content-Security-Policy); there is no
  adapter, protocol, baseline or field mapping. `fatigue_suspected` stays a simulated scenario
  label, never a diagnosis.

Browser check (Playwright from the repository's Node dependencies), with the server running:

```bash
node astra-patch/showcase/check.mjs        # SHOWCASE=http://127.0.0.1:8150/ by default
SHOT_DIR=/tmp/showcase-shots node astra-patch/showcase/check.mjs   # also writes screenshots
```

It compares the data file with the `replay` CLI output, checks that the page shows exactly those
numbers for all three scenarios, the labels, keyboard switching, no page scroll at 1440 × 900 and
1920 × 1080, no console errors and no request outside the page's own origin.

## Tests

```bash
PYTHONPATH=. .venv/bin/python3 -m pytest -q tests
```

The standalone tests copy the package without parent application files and verify
all three CLI scenarios, API startup and rejection of unavailable contracts.
`tests/test_showcase.py` checks that the showcase data file regenerates byte for byte, equals the
`replay` output, agrees with the explanation sentences, and that the page server is read-only.
Four optional target-contract integration cases skip when parent contracts are absent.

## Boundaries and limitations

This is a headless Python demo, an API explorer and a standalone showcase page, not a graphical HUD. Synthetic
summary scenarios are not raw waveform recordings or validated fatigue evidence.
Signal-quality faults remain separate from physiological indicators. Existing
walking, three-squat and automatic demonstration trigger rules remain unchanged.
No medical diagnosis, automatic retest result, base analysis, treatment, EVA
approval or HUD alert is produced. No production transport can be enabled here.

Optional `python -m astra_patch check <message.json>` validates against authoritative
parent `contracts/schema/` artifacts when available. Missing contracts fail
validation with exit code 2; replay never requires them or invents replacements.
See `INTEGRATION.md` for the optional handoff boundary.
