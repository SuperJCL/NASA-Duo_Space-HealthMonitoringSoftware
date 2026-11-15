# Standalone ASTRA and optional contract integration

ASTRA lives exclusively in `astra-patch/` and starts with Python dependencies only.
Acquisition, MuscleSense, synthetic scenarios, trigger rules, SQLite persistence
and console controls do not import the parent application. See `README.md` for
Demo Day setup. No Next.js, HUD, Relay or Station process is required.

The original ASTRA port came from `91a464b`; the standalone extension preserves
its acquisition, processing, quality, baseline, trigger and round-isolation logic.
It does not port the original React UI, raw WFDB datasets or prototype transport.

## Independent replay

`python -m astra_patch replay --scenario <name>` emits local internal observations
without calling the target handoff reviewer. It labels external submission disabled
and contract validation not performed. This output is not a wire contract.
Summary fixtures retain their values, provenance and quality flags. Missing raw
signals, sampling metadata or calibrated physiological evidence are not fabricated.

## Optional offline handoff review

`handoff.py` alone references the parent's generated `contracts/schema/` directory.
`review_astra_observation` remains a blocked local intake report. Its optional
schema hash is null when unavailable; a hash is provenance, never validation.
`contract_validation` is always `not_performed` for these reports.

Explicit `python -m astra_patch check <file>` retains strict schema and publisher
checks against the existing authoritative v1 artifacts. Missing or invalid
artifacts fail closed. Neither a successful check nor a local report authorizes
transmission. No replacement schemas are generated or bundled. The authoritative
TypeScript contracts remain owned by the parent project and unchanged.

The Python suite includes optional parent-contract integration tests; four cases
skip when the parent contract directory is absent. Standalone acceptance tests and
missing-contract failure checks still run in a detached copy. With parent artifacts
present, those integration tests must pass too.

## Safety and data gaps

External delivery remains disabled, with no network transport or enabling switch.
Patch does not publish HUD messages, retest results, medical decisions or mission
instructions. FastAPI bearer authentication is local demo access control only.
The local database defaults to `astra-patch.sqlite3`, configurable through
`ASTRA_PATCH_DB`; it must not point to a teammate's database.

Microvolt RMS cannot become percent MVC without compatible calibration; grip force
cannot be derived from EMG. Summary fixtures lack required target sampling,
impedance, artifact/dropout percentages, person and acquisition/protocol mapping.
Walking/quadriceps observations must not be relabelled as grip-protocol measurements
or compared to its baseline. Thus no live Patch-to-base handoff is claimed.
