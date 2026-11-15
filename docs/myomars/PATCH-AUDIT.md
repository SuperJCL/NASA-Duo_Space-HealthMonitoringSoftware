# ASTRA patch demo: integration audit (read-only)

**Date:** 2026-11-15. **Audited source:** `feat/astra-standalone-demo` at `18f8cd6`.

**Status (updated 2026-11-15T07:32Z):** the standalone patch demo is **merged into `main`**.
- PR [#4](https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence/pull/4) was retargeted from
  `feat/myomars-patch-trigger` to `main` and merged as `d518aca`.
- The merged tree is `astra-patch/` (33 files) plus a 4-line `DEVELOPMENT_LOG.md` entry. No app,
  relay, station, HUD, contract, script, dependency or config files changed.
- PR [#3](https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence/pull/3) (the earlier
  integration approach) is closed as superseded by #4, without merging. Its branch
  `feat/myomars-patch-trigger` is kept.
- `main` was then merged into PR #5 (`feat/myomars-english-overlay`).

**Conclusion:** the patch demo is integrated as an independent tool; the data link is not connected
yet. Nothing in it reaches the relay, the Mars Base analysis or the HUD.
- Connecting it is follow-up work and needs the decisions at the end of this document.
- No station or HUD page claims a patch connection. In integration mode the HUD's data-link panel
  reads "simulated sample → HUD → Base (patch not connected)".

## What it is

| Item | Finding |
|---|---|
| Location | `astra-patch/` only: a Python 3.12+ package. It imports nothing from the Next.js app, relay or HUD. |
| Entry, without a service | `python -m astra_patch replay --scenario normal \| fatigue_suspected \| sensor_fault`. It prints four observations as JSON, then deletes its temporary database. |
| Entry, local API | `uvicorn astra_patch.service:app --host 127.0.0.1 --port 8142`, with a bearer token in `MYOMARS_ACQUISITION_TOKEN`. Swagger is at `/docs`. Endpoints cover sessions and state transitions, capture, recordings, processing, queueing, a trigger console and trigger streams. |
| Checks | `python -m astra_patch check <message.json>` validates an envelope against the parent `contracts/schema/` when present. Missing schemas fail with exit code 2. |
| Tests | On the `main` + #4 merge result: `pytest -q tests` gave **84 passed** (Python 3.12.3). `replay` exits 0 for all three scenarios, with 4 observations each. The local API answered `/docs` with 200 and showed 20 endpoints under `/api/myomars/v1`; it returned 401 without a token, and a console was created with a token. |
| Transport | External transmission is **disabled**: no network client, no relay publisher, no enabling switch. The handoff review is a blocked local intake report (`contract_validation: not_performed`). |

## Data

| Question | Finding |
|---|---|
| Hardware, recorded or simulated? | **Simulated.** No hardware measurement and no recorded dataset. `SyntheticSource` makes seeded illustrative waveforms (sine plus noise; `actual_sensor: false`). The replay scenarios read a 12-row synthetic CSV (4 windows per scenario, seed 20261114) labelled "synthetic summary features, not raw EMG or clinical thresholds". |
| Raw signal or computed indicators? | **Both, separately.** The API capture path makes synthetic raw sEMG (4 channels) and IMU (6 axes) arrays. The replay emits summary features (`rms_microvolts`, `median_frequency_hz`), a quality score and flags, and states `raw_signal_validation: unavailable`. |
| Body site | API default `left_quadriceps`; fixtures `vastus_lateralis_demo`. |
| Device | `sim-patch-001` (simulated). |
| Sample rate | sEMG 2000 Hz by default (allowed 1000–4096); IMU 100 Hz. The replay's summary rows carry no sample rate and list it as missing. |
| Units | sEMG in **microvolts**. There is no %MVC and no grip force. |
| Time | Fixtures give elapsed seconds 6 / 12 / 18 / 24 in "accelerated recorded time", with no UTC acquisition time (listed as missing). |
| Conditions / protocol | API default `simulated_isometric_v1`, `simulated_seated`. Fixtures: `demo_walk_fixed`, activity walking. |
| Missing, by its own report | subject identity, sensor configuration, sampling rates, raw EMG and IMU, acquisition UTC, baseline-compatibility metadata. |

## Why it is not connected to the current analysis

The station's integration sample uses `std-grip-40`: forearm grip at 40 % MVC, with features `medianFreqHz`,
`rmsPctMvc` and `gripForceN` compared against that protocol's individual baseline. Against that:

- **Unit:** microvolt RMS cannot become %MVC without a compatible calibration.
- **Grip force:** it cannot be derived from sEMG.
- **Protocol:** walking, or quadriceps under `demo_walk_fixed`, is not the grip protocol. Relabelling it as
  `std-grip-40` or using that baseline would be wrong.
- **Missing fields:** the contract `Observation` needs a person, capture time, sample rate, duration,
  impedance and artefact/dropout percentages, which the fixtures do not carry. Nothing may be invented.
- **Scenario labels:** `fatigue_suspected` and `expected_classification` are test oracle metadata. They
  must never be shown as health evidence.

As instructed, none of this was changed: the patch is not wired into `std-grip-40`, no label was changed
to fit a baseline, and no missing value was filled in.

## Decisions for the team before any connection

These concern the data protocol, the meaning of the analysis or the choice of data source, so they wait
for the owner.

1. **Input:** which patch output becomes station input — summary features (and which ones), or raw
   signals with a feature-extraction step that is defined and validated first?
2. **Protocol and baseline:** register a new protocol id (for example walking, quadriceps) with its own
   individual baseline. A different protocol stays "not comparable" until that baseline exists.
3. **Units:** either keep sEMG in µV with features defined for µV, or define an MVC calibration
   procedure. Also decide whether grip force stays required for that protocol.
4. **Person mapping:** how a patch session maps to `astronautId`, and who confirms it.
5. **Transport:** whether the patch publishes `observation.submitted` to the relay as the data
   producer (role `trigger`), in place of or next to the data-replay module (one producer per run,
   or several).
6. **Time:** the acquisition UTC and its source, since accelerated fixture time is not wall-clock time.
