# MyoMars shared message contracts v1: minimal integration guide

**Status (2026-11-14):** the **message contracts** are usable now: the envelope, event types,
payloads, publishing rules, JSON Schemas, examples and fixed scenarios.

> **There is no network communication service yet.** Nothing can be sent between the Trigger, the
> HUD and the Mars Station today. The relay (HTTP publish plus Server-Sent Events) is paused,
> unfinished work on the `feat/myomars-foundation` branch; see `docs/myomars/RELAY-STATUS.md`
> there. Until it is ready:
>
> - build and validate your messages locally (below);
> - the Mars Station runs on its own local mock.

Proposal status: written by the Station owner from the existing station protocol. It is a
**proposal for the team to review**, not yet an agreed standard.

All data in these contracts is **SIMULATED** demo data. Nothing here is a measurement, a
diagnosis or a clinical threshold.

## Files

| Path | What |
|---|---|
| `src/contracts/payloads.ts`, `envelope.ts` | Source of truth (Zod, TypeScript). Node 22 runs these directly. |
| `src/contracts/demo-fixtures.ts` | Shared demo inputs: scenario start, 4 observations, 3 retest results |
| `contracts/schema/*.schema.json` | Language-neutral JSON Schema (draft 2020-12), generated |
| `contracts/schema/event-rules.json` | For each type: who may publish it, whether it needs a caseId or retestId, its `status` (`core` or `proposed-extension`), and its payload schema |
| `contracts/examples/<type>.json` | One valid example message per event type |
| `contracts/scenarios/*.json` | Fixed, reproducible scenarios: `normal`, `acquisition-invalid`, `not-comparable`, `change-retest` |

Commands (the same on Windows, macOS and Linux, with Node 22+, after `npm install`):

```bash
npm run contracts:validate -- contracts/examples/hud.ack.json
```
```bash
npm run contracts:check
```
```bash
npm run contracts:build
```

- `contracts:validate` checks one or more JSON messages; a file may hold one message or an array.
- `contracts:check` reports whether the generated files match the sources.
- `contracts:build` regenerates the generated files after you change a source file.

The `package.json` files inside `src/contracts/` and `tools/myomars/` only declare
`"type": "module"` for those two folders, so Node runs the TypeScript files as ES modules. They
do not change the rest of the repository.

## Using the samples (no service needed)

1. Look at `contracts/examples/<type>.json` for the exact shape of each message. Look at
   `contracts/scenarios/change-retest.json` for a full sequence with fixed, simulated values.
2. Build your message in any language, then check it:
   `npm run contracts:validate -- my-message.json`.
3. Non-TypeScript projects can validate in-process with any JSON Schema 2020-12 validator:
   - `envelope.schema.json` for the envelope;
   - `payload.<type>.schema.json` for its payload;
   - the per-type rules (publisher, caseId, retestId) are in `event-rules.json`.
4. Reuse the fixed IDs from the scenarios (`case-change`, `case-change-rt1`, `obs-change-1`, …) so
   that everyone tests the same situations.

## Envelope (every message)

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | Always `"myomars/v1"` |
| `eventId` | yes | Unique per message, chosen by the sender (UUID recommended). **A resend of the same message reuses the same eventId and identical content.** The same eventId with different content is an error. |
| `sessionId` | yes | Demo session (`[a-z0-9-]`, ≤ 40 characters, e.g. `demo`). Sessions are isolated from each other. |
| `runId` | yes | Scenario run. `scenario.start` begins it and `scenario.reset` ends it. Messages for an ended run are stale and are ignored. |
| `caseId` | for case messages | Health event (case). Null only for scenario control messages. |
| `retestId` | for retest messages | Links a retest request and its result |
| `sentAt` | yes | When the sender sent the message, or first tried to |
| `occurredAt` | no | When the thing happened (e.g. acquisition). Keep it unchanged through offline buffering. |
| `source` | yes | `trigger`, `hud` or `station`. Informational only: a server will check the authenticated role instead. |
| `type`, `payload` | yes | See below |

Messages delivered later by the relay will also carry `seq` (the relay's order), `receivedAt` and
`sender` (the authenticated role). Without the relay these fields are absent.

## Event types

| Type | Publisher | Meaning |
|---|---|---|
| `scenario.start` | Trigger or Station | Starts a run: astronaut and task context. *v1.1, additive:* the station may publish it when base staff explicitly confirm "开始EVA" (simulated EVA): `scenarioId` = mission id, `task` = the chosen mission task and its `targetId`. Selecting a task or opening a map never sends it. |
| `scenario.reset` | Trigger | Ends the run. Later messages for it are ignored. |
| `observation.submitted` | Trigger | One simulated sEMG window: signal quality, features, optional IMU summary, protocol and context |
| `hud.received` | HUD | **The HUD device received** a station message (`messageId` = that message's eventId). Not a confirmation. |
| `hud.ack` | HUD | **The astronaut explicitly acknowledged** it |
| `hud.defer` | HUD | The astronaut deferred it, with a reason |
| `retest.result` | Trigger or HUD | The retest measurement (an observation), with the same `retestId`. **Complete on its own**: it is all the station needs to receive a retest and re-evaluate. |
| `retest.completed` | HUD | *Proposed extension, pending team confirmation, optional.* The astronaut reports the retest as performed. |
| `station.notice.approved` | Station | A notice for the astronaut, published **only after a human approved it** |
| `station.retest.requested` | Station | A standard retest task, published **only after a human approved it** |
| `station.receipt` | Station | The station received a retest result: `accepted`, `duplicate` or `rejected` |
| `station.reassessment` | Station | The human decision on a re-evaluation (version 2 or later) |
| `station.audit.assessment`, `station.audit.review` | Station | *Proposed extension.* Traceability records only. **The HUD and Trigger must ignore them.** |
| `station.eva.ended` | Station | *Proposed extension (v1.1).* Base staff ended the simulated EVA of this run (`endedBy`, `endedAt`). Mission phase only: the run stays open, open health events stay open and can still be handled, nothing is deleted, and it says nothing about the astronaut's health. Receivers may ignore it. |

Delivery, acknowledgement, retest completion and case closure are four different things. Only a
Station human closes a case, and a single normal retest does not close it by itself.

**Nothing to migrate for the proposed extensions.** `retest.completed` and `station.audit.*` are
marked `proposed-extension` in `event-rules.json`. They are new in v1 and pending team
confirmation, and nobody has to implement them now:

- a HUD or Trigger that never sends `retest.completed` is fully compatible;
- every receiver should ignore message types it does not handle;
- the optional fields `deviceId`, `imu` and `occurredAt` can also be left out.

## Example flow (`contracts/scenarios/change-retest.json`)

1. Trigger sends `scenario.start`, then `observation.submitted` with `caseId: "case-change"`.
2. The Station runs its simulated analysis and gets a candidate. A human approves it with a reason.
3. Station sends `station.notice.approved` and `station.retest.requested` (`retestId: "case-change-rt1"`).
4. HUD sends `hud.received` for each message, then `hud.ack` or `hud.defer`, using `messageId` = the station message's `eventId`.
5. Trigger or HUD sends `retest.result` with `retestId: "case-change-rt1"`. The HUD may send the proposed `retest.completed` first.
6. Station sends `station.receipt` (`accepted`) and runs re-evaluation v2. A human closes the case or keeps it under watch, and Station sends `station.reassessment`.

## Migration from the v0 station draft

The v0 draft is `docs/station-integration.md`, on branch `feat/myomars-station`.

| v0-draft | v1 |
|---|---|
| `schema: "myomars.station/v0-draft"` | `schema: "myomars/v1"` |
| — | New required `sessionId` |
| — | Optional `occurredAt`; relay fields `seq`, `receivedAt`, `sender` on delivery |
| Observation fields | Unchanged; new optional `deviceId` and `imu` (`accelRmsG`, `gyroRmsDps`, `movementPct`) |
| `hud.received`, `hud.ack`, `hud.defer`, `retest.result` | Unchanged |
| — | New, optional `retest.completed` (proposed extension; `retest.result` alone remains sufficient) |
| Station payloads (TypeScript types only) | Now Zod schemas plus JSON Schema, unchanged fields |
| — | New `station.audit.assessment` and `station.audit.review` (proposed extension; traceability only, ignore them) |

## Changing the contracts

1. Change `src/contracts/*.ts`, run `npm run contracts:build`, and add a line under Changelog.
2. v1 accepts only additive changes: optional fields or new types. Anything else becomes `myomars/v2`.
3. Open a PR that the HUD, Trigger and Station owners all review. Do not change another team's
   behaviour silently.

## Open questions for the HUD and Trigger owners

- Do we adopt the proposed `retest.completed` (the astronaut reports the retest done, separate
  from the data)? Until we decide, it stays optional.
- Who creates `caseId`? This draft assumes the Trigger scenario defines it.
- Can the HUD send a device receipt (`hud.received`) separately from the astronaut's `hud.ack`?
- Does the retest data (`retest.result`) come from the sensor simulator (Trigger), the HUD, or both?
- Are the IMU summary fields sufficient, or does the simulator need raw windows?

## Changelog

- **v1 (2026-11-14):** first shared version, derived from the v0 station draft (see Migration).
  `retest.completed` and `station.audit.*` are proposed extensions.
