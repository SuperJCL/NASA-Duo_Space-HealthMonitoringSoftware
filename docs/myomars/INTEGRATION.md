# MyoMars integration: status, local relay, interface differences

**Status (2026-11-15):** station-side preparation for the **two-end** run (Mars Station ↔ real HUD).
Observations still come from a simulated input: the station's dev entry, acting as the Trigger.
This is **not** a three-end integration.

## Sources

| Part | Source | Status |
|---|---|---|
| Shared contracts | `main` `58b5a08` | Published |
| Mars Station | `feat/myomars-station` `7638421` | Accepted UI baseline; relay adaptation on `integration/myomars` |
| HUD | `feat/myomars-hud`, PR #1 | **Not merged.** The HUD teammate is pushing an update. `a76c0e8` was read as a reference only; the version to integrate is locked when the team sends the commit. |
| Trigger | — | **No branch yet.** Waiting for the branch name. |

`integration/myomars` contains no HUD code. All merges into `main` are done by the station side; the
HUD teammate does not merge.

## Local relay (`relay/`, `npm run relay`)

HTTP publish plus Server-Sent Events. Its routes and responses follow what the HUD client
(`hud/base-client.js`) calls today. It validates against the shared contracts v1.

| Route | Meaning |
|---|---|
| `POST /v1/sessions/:sid/events` | Publish one envelope. Headers `x-myomars-role` (`trigger` / `hud` / `station`) and `x-myomars-client`. Returns `{ seq, receivedAt, duplicate }`. |
| `GET /v1/sessions/:sid/events?after=n` | Delivered history: `{ events, lastSeq, activeRun }` |
| `GET /v1/sessions/:sid/stream?after=n` | SSE stream; `id` is the sequence number; `Last-Event-ID` resumes |
| `POST` / `DELETE /v1/sessions/:sid/station-lease` | Only one station window publishes at a time (15 s lease, renewed every 5 s) |
| `GET /v1/health` | Status |

Rules:

- **Validation:** the shared Zod contracts (envelope, per-type rules, payload).
- **Publisher role:** checked against `event-rules.json`.
- **De-duplication:** same `eventId` with the same content is a duplicate and is not delivered again; with different content it is rejected (`409 eventId-conflict`).
- **Run gating:** an ended run is rejected (`409 stale-run`), any other run too (`409 unknown-run`).
- **Browser origins:** same-host origins on any port are allowed (development); add more with `MYOMARS_ALLOWED_ORIGINS`.
- **Scope:** the relay never analyses data and never approves anything.
- **Security:** roles are declared by header, so this is for local / LAN development only (no authentication yet).

It reuses selected ideas from the paused F2 work (body limit, origin check, rate limit, static
serving). It does not reuse F2's cookie login or `/api/v1` routes, because the HUD client does not
use them.

Options:

- `PORT` (default 8787, the HUD's default);
- `HOST` (default `0.0.0.0`, reachable on the LAN);
- `MYOMARS_STATIC_DIR` (serve the HUD folder at `/`; the HUD derives its relay address from its own origin);
- `MYOMARS_RELAY_DATA` (append-only persistence).

## Station in relay mode

Open the station with `/?relay=auto`, which means "same host as the page, port 8787". A full URL
also works (`?relay=http://<host>:8787`), or set `NEXT_PUBLIC_MYOMARS_RELAY`. Without either, the
station runs the standalone local mock, which stays available as the fallback entry.

- **History restore:** history is applied as one batch. The station's own earlier messages (approvals, tasks, completed analyses, receipts) are **restored, never sent again**: no repeated approval or dispatch after a reload. Covered by `src/lib/station/relay-integration.test.ts`.
- **Lease:** one window holds the lease. Other windows are read-only mirrors: no decisions and no sends. A reload keeps the same tab's lease.
- **Statuses:** connection (connected / reconnecting / not connected), lease, and send failures are shown. "已发出" means the relay stored it (sequence number). HUD receipt and astronaut confirmation come **only** from the HUD (`hud.received`, `hud.ack`, `hud.defer`).
- **No mock feedback:** the mock HUD feedback, its buttons and auto mode are off in relay mode. The dev entry publishes only the simulated Trigger observation, into the run the HUD started.

## Interface differences found (reference: HUD `a76c0e8`; to re-check on the locked version)

1. **Run ownership.**
   - Today: the HUD's intro screen requires choosing one of its scenarios, and doing so publishes `scenario.start` (astronaut A-02); switching scenario resets the run. So the HUD starts the run, and the station and its dev entry join it.
   - Decide: who starts runs once the Trigger exists.
2. **Observation source overlap.**
   - Today: the HUD embeds a simulated patch (Trigger role) that publishes walking segments, `caseId = {runId}-lq`, protocol `walk-auto-v1`.
   - Effect: the station rates these as not comparable with its grip baseline. Repeated segments land in the same open case.
   - Decide: who publishes observations: the HUD's patch simulator or the Trigger.
3. **Diagnosis-like wording on the HUD.**
   - Today: the HUD infers the notice kind from the `noticeId` suffix (`-n` / `-ok` / `-sensor`, gap V1-11) and shows "AMBER · Muscle fatigue suspected". The station's notice never says fatigue ("测量与平时基线不同"; no diagnosis).
   - Proposed: the HUD shows the station's notice text, or the team agrees an explicit category field (additive contract change).
4. **Internal reason shown to the astronaut.**
   - Today: the HUD uses `notice.reviewReason` (the base reviewer's internal reason) as the notice headline.
   - Decide: whether that is intended.
5. **Retest card text.**
   - Today: the HUD card says "returning to the habitat"; the station's instruction says "休息后，按标准协议…".
   - Today: `protocol.label` is split on " · " into body site / action, which gives "标准握持 40% MVC" / "30 s".
   - Decide: explicit fields, or a label convention.
6. **Retest result source and fields (step 2).**
   - Today: the HUD publishes `retest.result` (single source, so the Trigger must not also send it for the same retest).
   - Today: its sample has `gripForceN: null`, so the station's re-evaluation reports "特征缺失".
   - Decide: either the station compares only the sEMG features when grip was not measured, or the result includes the grip-meter reading.
7. **Session id.** The HUD uses the fixed session `demo`; the station uses `?session=demo` (default) in relay mode.
8. **Station local extensions are not used in relay mode.** The crew roster, device status and HUD reports are local mock extensions and are not contract messages, so device connection shows "未知（无设备状态消息）" there.

Preliminary checks against `a76c0e8` (reference only, not merged, not final):

- **Node probe:** the HUD client ↔ relay ↔ station.
- **Browser run:** real station page plus the reference HUD page served by the relay. HUD starts its run, simulated observation, station analysis, approval, HUD shows notice and retest task, HUD device receipts, astronaut confirmations, station shows each separately.
- **Results:** zero invalid, duplicate or rejected messages on the HUD side; station reload restores without re-sending; second station window read-only; HUD reload restores the task.

## Next (after "HUD 已更新" with a commit)

1. Fetch that commit, lock it, and merge it into `integration/myomars`. Serve `myomars-hud/` from the relay.
2. Re-check the differences above, then run the two-end step 1 on the real pages, on one machine and then on the LAN.
3. Step 2: retest result → re-evaluation → human close / keep watching → HUD status update.
4. Trigger, once the branch is provided.
