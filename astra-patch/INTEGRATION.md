# ASTRA Patch data-producer integration (offline review)

Source: `leonardoTT-debug/ASTRA-MyoMars`, commit `91a464b87afa32c000b75c5a4dfeacc13871e2cb`. Target preparation base: `integration/myomars` at `0d0427681c7aefd8277cb69714a9e774af7e52d1`. This addition is for the existing `feat/myomars-patch-trigger` branch. It does not replace its README.

## Scope

An isolated Python package under `astra-patch/astra_patch/` ports acquisition, synchronized synthetic sEMG/IMU, signal-quality-first MuscleSense processing, individual baseline checks, walking/three-squat/automatic-indicator rules, local SQLite audit/observations, and Trigger Console controls. There is no third product page. CLI and authenticated local FastAPI controls expose the headless console; Station and HUD stay the two existing interfaces. No station analysis, HUD behavior, shared contracts, root dependencies, routes or source data are edited.

The original ASTRA public-prototype sender, WFDB datasets and UI application are not copied. The old engine's network/template transport is removed. Queue attempts fail closed; stale-round queue attempts return 409. There is no live sending toggle or automatic retest/result publication. SQLite uses a separate `ASTRA_PATCH_DB` path, never the Station's state or original ASTRA database.

## Run locally

Use Python 3.12+; dependencies require installation in your authenticated/dependency-enabled environment:

```sh
cd astra-patch
python3 -m venv .venv
.venv/bin/python3 -m pip install -r requirements.txt
PYTHONPATH=. .venv/bin/python3 -m pytest -q tests
PYTHONPATH=. .venv/bin/python3 -m astra_patch replay --scenario normal
PYTHONPATH=. .venv/bin/python3 -m astra_patch replay --scenario fatigue_suspected
PYTHONPATH=. .venv/bin/python3 -m astra_patch replay --scenario sensor_fault
PYTHONPATH=. .venv/bin/python3 -m astra_patch check ../contracts/examples/observation.submitted.json
```

Replay is accelerated recorded-time playback: observations retain elapsed times 6/12/18/24 seconds; this CLI is not a six-second wall-clock network sender. The inherited trigger stream evaluates every accepted window, schedules walking at six recorded seconds, counts three completed synthetic IMU squat cycles, and emits held non-clinical indicators independently. The test suite verifies those behaviors separately from incomplete summary fixtures.

Optional private control API: set `MYOMARS_ACQUISITION_TOKEN` through your approved local secret mechanism, set `ASTRA_PATCH_DB` to a dedicated ignored path, then run `.venv/bin/python3 -m uvicorn astra_patch.service:app --host 127.0.0.1 --port 8142` from this directory. Do not expose it on the LAN or treat it as production authentication. Paths remain `/api/myomars/v1/sessions`, `/console`, `/trigger-streams` to preserve the internal controller interfaces. Start requires explicit acquisition/replay approval; this never authorizes an EVA. All controls use their existing run IDs and transaction isolation. See runtime `/docs` for these local APIs; they are not the shared message contract.

## Contract boundary

The target's `src/contracts/` and generated `contracts/schema/` remain authoritative and unchanged. `handoff.py` reads their generated JSON schemas and publishing rules directly. It validates supplied v1 messages offline; validation is not authorization to transmit. Only scenario.start/reset and observation.submitted are in this adapter's scope; retest results, HUD events and Station actions are rejected even where the broad shared contract permits a trigger role. JSON Schema validation fails closed if the validator is unavailable. The TypeScript Zod contract remains the authority if validation semantics differ.

`review_astra_observation` emits a local intake report, never a wire message. It retains source observation and round references, supplied summary values and quality flags, identifies missing target measurements, and hashes the target observation schema. It does not use expected classification labels as evidence. Poor-quality median-frequency values are not offered as usable features.

A full data handoff remains blocked on specific data gaps:

- microvolt RMS has no compatible MVC calibration, so it cannot become `rmsPctMvc`;
- summary fixtures do not contain required sampling rate, electrode impedance, saturation/dropout/artifact percentages, captured UTC, person or structured protocol conditions;
- grip force is independent and cannot be derived from EMG;
- walking/quadriceps protocols must not be relabelled as the Station's standard grip protocol or compared with its baseline;
- raw acquisition has more metadata but still lacks a reviewed target protocol, channel-selection/MVC mapping and electrode impedance;
- live transport/authentication are not approved; target relay role headers are not production authentication.

No null-for-required fields, fabricated zeroes or relabelled participants are sent. Future work must provide actual compatible metadata or separately reviewed contract/protocol changes. This PR does not claim a successful Patch → Station → HUD round trip.

## Tests and limits

Ported tests preserve meaningful acquisition, quality, baseline, trigger, round, duplicate and safety behavior. New tests exercise target intake and the authoritative target example/schema files. No tests publish to a server. The original ASTRA source and its tests remain untouched. The source pipeline uses explicitly non-clinical demonstration thresholds, never diagnoses atrophy or clinically validated fatigue.

During preparation: Python tests ran in the existing local Python 3 environment. The separate JSON Schema dependency was not available, so its four conformance cases are explicitly skipped (not passes). Full target `npm run check` was attempted and stopped at missing `eslint` because this checkout has no node_modules. Install dependencies and run all checks in the teammate development environment before treating this draft as integration-ready. No network-based end-to-end verification is claimed.
