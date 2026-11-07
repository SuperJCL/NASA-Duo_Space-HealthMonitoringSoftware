# SCI-0 review package

This package is for human review of the SCI-0 scenario evidence audit.

**Status:**

- docs only;
- not merged;
- SCI-1 not started.

All times are UTC and recorded, not estimated. "Unknown" marks a time that
was not recorded.

## Contents

| Material | File |
|---|---|
| Main audit report (Scenario Evidence Contract) | [`../SCI0_SCENARIO_EVIDENCE_CONTRACT.md`](../SCI0_SCENARIO_EVIDENCE_CONTRACT.md) |
| Evidence matrix (every claim, class, verbatim source, review status) | [`EVIDENCE_MATRIX.md`](EVIDENCE_MATRIX.md) |
| Ranking claims list (every displayed rank/priority statement, location, class) | [`RANKING_CLAIMS.md`](RANKING_CLAIMS.md) |
| Issue list | [`ISSUES.md`](ISSUES.md) |
| Reproduction record (data version, IDs, parameters, full-precision outputs) | [`REPRODUCTION.md`](REPRODUCTION.md) |
| Follow-up proposals: A wording, B SCI-1, C SCI-2 (not implemented) | [`FOLLOW_UP_PROPOSALS.md`](FOLLOW_UP_PROPOSALS.md) |

**Links on GitHub** (branch `sci0-scenario-evidence-audit`; repository
access is required):

- https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence/blob/sci0-scenario-evidence-audit/docs/SCI0_SCENARIO_EVIDENCE_CONTRACT.md
- https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence/tree/sci0-scenario-evidence-audit/docs/sci0

## 1. MAP-2 integration record

### Commits

| Item | Value |
|---|---|
| Remote `main` after integration | `6fd4222df4cc1d63b2cda51c4b6b4af896d9f7fa`, the log commit, 2026-11-07T00:40:26Z |
| MAP-2 merge commit (`--no-ff`) | `5e5a99dd9703dbceb29e06956e011de0087c7014`, 2026-11-07T00:40:26Z |
| MAP-2 branch head merged | `3a161efa3e64c9e78c81b7eb654069565dcc853b`, 2026-11-06T21:31:47Z |
| Previous `main` (merge base) | `321e4ee0eb1a8804d41a52488b8c6ff6c9d7ccdb` |
| Pull request | **None.** The merge was made locally with `git merge --no-ff` and pushed directly to `main`, as authorised. No PR was opened. |

Commit links:

- https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence/commit/5e5a99dd9703dbceb29e06956e011de0087c7014
- https://github.com/SuperJCL/NASA-11-Mars-Discovery-Intelligence/commit/6fd4222df4cc1d63b2cda51c4b6b4af896d9f7fa

### Timeline

The timestamps come from `date -u` at the start, the verification log
files' last-modified times, and the git commit times.

| Step | Start | End |
|---|---|---|
| Integration started (branches fetched and checked) | **00:30:49** (recorded) | — |
| Merge staged (`--no-commit`) | unknown | unknown (before the check's unit tests started) |
| `npm run check` (lint, typecheck, tests, build) | unknown (its unit-test phase started 00:31:38, from the vitest log) | 00:31:55 |
| Production server start | unknown | log written 00:31:56 |
| Prototype smoke, run 1 (186/186) | unknown | 00:34:21 |
| Prototype smoke, run 2 (186/186) | unknown | 00:36:43 |
| Research smoke (116/116) | unknown | 00:37:09 |
| `verify:citations` (129 quotes, 0 problems) | unknown | 00:38:23 |
| `verify:geo` (0 problems) | unknown | 00:38:25 |
| `verify:briefing` (35 checks, 0 problems) | unknown | 00:39:57 |
| `verify:terrain` (assets match a fresh build) | unknown | 00:40:08 |
| Merge commit and log commit | — | 00:40:26 |
| Push to `origin/main` | — | unknown; completed before 00:40:42, the next recorded timestamp |

- **Wall-clock elapsed:** 00:30:49 → 00:40:26, **9 min 37 s**, to the log
  commit. Including the push, it is at most 9 min 53 s (upper bound only).
- **Per-step start times** were not recorded, so they are given as unknown,
  not estimated.

## 2. SCI-0 branch, commits and diff

| Item | Value |
|---|---|
| Branch | `sci0-scenario-evidence-audit`, created from `main` `6fd4222` |
| SCI-0 commit | `05b480c3814e0c358dda0cdb0e88d1e44b0cfde4`, 2026-11-07T00:47:14Z |
| Supplement commit | the commit that adds this package; see `git log` on the branch |

The SCI-0 commit (`git diff --stat 6fd4222 05b480c`) changed three files:

| File | Change |
|---|---|
| `docs/SCI0_SCENARIO_EVIDENCE_CONTRACT.md` | new; the main report |
| `docs/EVIDENCE_CURATION.md` | 1 line; the R4 row points to the report |
| `DEVELOPMENT_LOG.md` | appended SCI-0 entry |

The supplement:

- adds `docs/sci0/` (this file plus five materials);
- edits `docs/SCI0_SCENARIO_EVIDENCE_CONTRACT.md`: a scope section, exact
  pivotal IDs and tie values, and "not assessed as low";
- appends to `DEVELOPMENT_LOG.md`.

**Docs-only confirmation:** reproduce with

```bash
git diff --name-only main...sci0-scenario-evidence-audit
```

The output must list only `docs/…` and `DEVELOPMENT_LOG.md`.

```bash
git diff --stat main...sci0-scenario-evidence-audit -- src scripts public package.json
```

The output must be empty: no code, data, review status, weight or formula
changed. The engine probe ran from a temporary test file that was deleted
and never committed. Its code is reproduced in `REPRODUCTION.md`.

## 3. Wall-clock time

| Work | Start | End | Elapsed |
|---|---|---|---|
| SCI-0 audit | 2026-11-07T00:40:42Z | 2026-11-07T00:47:14Z (commit) | **6 min 32 s** |
| This supplement | 2026-11-07T01:32:59Z | see `DEVELOPMENT_LOG.md` (commit time) | see the log |

There were no gaps or parallel work inside either interval. The time
between 00:47:14 and 01:32:59 was waiting for review, not work.

## 4. Data cutoff, unread sources, unverified current status

### Data cutoff

| Item | Date |
|---|---|
| Latest dated record in the dataset (`availableFrom`) | 2025-05-06: Mars 2020 Initial Reports Vol. 4, v2.0. The individual sample reports inside carry their own dates; for example, Lefroy Bay is dated December 18, 2023. |
| Latest NASA web source in the dataset | 2024-08-30 (2024 Science Team Meeting blog) |
| Sample-return status in the dataset | NASA page, December 2023: "will hopefully be brought back to Earth" |
| Quote verification (live) | 2026-11-07 (`verify:citations`, 129 quotes) |
| Geo cross-validation | 2026-11-05 (`docs/GEO_DATA.md`) |

### Not read for this audit

The audit used only the dataset's curated, verified quotes.

- **R1:** Zastrow & Glotch (2021). Blocked: domain denied by the proxy.
- **R2:** Moreland et al. (2025). Blocked: Cloudflare challenge.
- **The rest of the PDS reports:** the full Initial Reports for Pelican Point
  (M2020-923-25) and Comet Geyser (M2020-1088-27), beyond the quoted lines
  already in the dataset.
- **Instrument documentation:** Mars 2020 instrument papers or pages
  (SuperCam, Mastcam-Z, PIXL, SHERLOC, WATSON, the coring system).
- **Later literature:** any peer-reviewed Margin-unit literature after
  Horgan et al. (2020), other than the PDS initial reports.
- **Later blogs and releases:** NASA Mars 2020 blogs and releases after
  2024-08-30.
- **Sample return:** official Mars Sample Return programme documents.

### Not verified (current status)

- Perseverance's current operating status and location.
- Whether further Margin-unit abrasions or samples exist after 2024-03-11,
  the Comet Geyser coring date.
- The current sample-tube inventory and caching or depot status.
- The current status and timeline of any sample-return effort.
- Whether newer studies have changed the working hypotheses for the Margin
  unit.
