# ASTRA patch demo: an independent explanatory demo

**Position (decided by the project owner, 2026-11-15):** `astra-patch/` is a **separate, independent
program**. It explains what the sEMG/IMU patch is and how it works. Its independence is the current
design, not a gap waiting to be filled.

- It has no communication link with the Mars Base, the HUD or the relay.
- It starts on its own (Python), and nothing in the Base, HUD or relay depends on it at run time.
- No data adapter from the patch to the relay, Base or HUD is developed.
- No new protocol, analysis baseline or field mapping is added for the patch.
- The Base ↔ HUD demo keeps using its own simulated data replay. That covers analysis, human
  review, retest and case closure. See [DEMOS.md](DEMOS.md).

**History:**
- PR [#4](https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence/pull/4) (`feat/astra-standalone-demo`)
  was merged into `main` as `d518aca` on 2026-11-15. It added only `astra-patch/` (33 files) and a
  4-line log entry.
- PR [#3](https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence/pull/3) (an earlier
  integration approach) is closed as superseded. Its branch `feat/myomars-patch-trigger` is kept.

## How it runs

| Item | Finding |
|---|---|
| Location | `astra-patch/` only: a Python 3.12+ package with its own `requirements.txt` and `.gitignore`. It imports nothing from the Next.js app, relay or HUD. |
| Main entry: command line | `python -m astra_patch replay --scenario normal \| fatigue_suspected \| sensor_fault`. It prints four observations as JSON in the terminal, then deletes its temporary database. |
| Showcase page (added 2026-11-15) | **New on the unified-experience branch, not a restoration.** The teammate's demo (`feat/astra-standalone-demo`, identical to `main`) has no visual page, and its upstream React product UI was never ported (`SOURCE.json`). The page keeps its own look and is not bound to the Base/HUD design rules (its CSS lives in `showcase/assets/showcase-*.css`, not synced or checked). `python -m astra_patch showcase serve` (stdlib server, port 8150, read-only) shows `showcase/data/showcase.json`. `showcase build` writes that file from the SAME code path as `replay` (`replay.py`), deterministic (volatile ids replaced and listed). It shows: the patch diagram; sEMG / IMU explanations; per-window indicators and signal quality; one sentence per scenario checked against the data. Waveforms come from the existing synthetic capture path (`SyntheticSource.capture`, seed 42, `actual_sensor: false`), labelled as not the source of the scenario numbers. No connection to the Base, HUD or relay. `showcase/check.mjs` (browser) and `tests/test_showcase.py` check the page against the data. |
| Optional: local API | `uvicorn astra_patch.service:app --host 127.0.0.1 --port 8142`, with a bearer token in `MYOMARS_ACQUISITION_TOKEN`. `/docs` is the Swagger **API explorer**, not a demo page. Its 20 endpoints under `/api/myomars/v1` cover sessions, capture, recordings, processing, a console and trigger streams. |
| Optional: offline check | `python -m astra_patch check <message.json>` checks a message file against the repository's `contracts/schema/` files when they are present. It sends nothing. |
| Transport | External transmission is **disabled**: there is no network client, relay publisher or enabling switch. |
| Verified (2026-11-15, on the `main` + #4 result and again inside PR #5) | `pytest -q tests` **84 passed** (Python 3.12.3). `replay` of all three scenarios exits 0 with 4 observations each. The API answered `/docs` with 200; it returned 401 without a token and created a console with a token. With the showcase (unified-experience branch): **96 passed**, the replay output unchanged, `showcase/check.mjs` 98/98. Windows not yet verified (owner's acceptance). |

## Data (what the demo shows)

| Question | Finding |
|---|---|
| Hardware, recorded or simulated? | **Simulated.** There is no hardware measurement and no recorded dataset. The replay reads a 12-row synthetic CSV (4 windows per scenario, seed 20261114), labelled "synthetic summary features, not raw EMG or clinical thresholds". The API capture path makes seeded illustrative waveforms (`actual_sensor: false`). |
| Raw signal or computed indicators? | The replay shows **summary features** (`rms_microvolts`, `median_frequency_hz`), a quality score and flags, and says `raw_signal_validation: unavailable`. Only the API capture path makes synthetic raw sEMG (4 channels) and IMU (6 axes) arrays. |
| Body site, device | API default `left_quadriceps`; fixtures `vastus_lateralis_demo`. Device `sim-patch-001` (simulated). |
| Sample rate, units | sEMG 2000 Hz by default, IMU 100 Hz. sEMG in **microvolts**. The replay rows carry no sample rate and list it as missing. |
| Time, conditions | 6-second walking windows in "accelerated recorded time", with no UTC acquisition time. Fixture protocol `demo_walk_fixed`. |
| Its own "missing" list | subject identity, sensor configuration, sampling rates, raw EMG and IMU, acquisition UTC, baseline-compatibility metadata |

**What each scenario shows** (4 observations each; `baseline_comparison: not_available` and
`research_indicator: not_assessed` in all of them, so there is no diagnosis):

| Scenario | RMS (µV) | Median frequency (Hz) | Signal quality |
|---|---|---|---|
| `normal` | 42 → 43 → 44 → 43 | 86 → 85 → 84 → 85 | acceptable, no flags |
| `fatigue_suspected` | 43 → 48 → 54 → 61 (rising) | 85 → 80 → 73 → 66 (falling) | acceptable, no flags |
| `sensor_fault` | 42, 43, then 132, 175 | 86, 85, then 18, 11 | windows 3–4 **unsuitable**: `motion_artifact` and `electrode_contact_fault` |

Notes:
- In `fatigue_suspected`, the scenario name is test metadata; the demo itself draws no fatigue conclusion.
- `sensor_fault` shows that a signal-quality fault is kept separate from physiology.

## Boundaries (why the two demos stay separate)

These facts explain why the patch output is not meant to feed the Base analysis. They are context,
not a to-do list:
- The Base/HUD demo compares a standardised grip measurement (`std-grip-40`: %MVC, grip force from a
  grip meter) against that protocol's individual baseline.
- The patch shows walking / quadriceps sEMG in µV, with no %MVC and no grip force.
- Rules for anyone changing the code:
  - never relabel patch data as `std-grip-40`;
  - never fill in its missing fields;
  - never present its scenario names as health evidence.
