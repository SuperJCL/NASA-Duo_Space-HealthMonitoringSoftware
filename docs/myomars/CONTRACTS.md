# MyoMars shared message contracts v1: minimal integration guide

**Status (2026-11-14):** the **message contracts** are usable now: the envelope, event types, payloads,
publishing rules, JSON Schemas, examples and fixed scenarios.

The **transport is not available yet**. The relay (HTTP publish plus Server-Sent Events) is
unfinished work on the `feat/myomars-foundation` branch; see `docs/myomars/RELAY-STATUS.md` there.
Until it is ready:

- validate your messages locally (below);
- the Mars Station runs in mock mode.

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
| `contracts/schema/event-rules.json` | For each type: who may publish it, whether it needs a caseId or retestId, its payload schema |
| `contracts/examples/<type>.json` | One valid example message per event type |
| `contracts/scenarios/*.json` | Fixed, reproducible scenarios: `normal`, `acquisition-invalid`, `not-comparable`, `change-retest` |

Commands (the same on Windows, macOS and Linux, with Node 22+):

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

TypeScript code can import `parseEnvelope` from `src/contracts/envelope.ts`. Code in other
languages validates against `contracts/schema/envelope.schema.json` plus the payload schema for
the message's `type`.

## Envelope (every message)

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | Always `"myomars/v1"` |
| `eventId` | yes | Unique per message, chosen by the sender (UUID recommended). **A resend of the same message reuses the same eventId and identical content.** The same eventId with different content is an error. |
| `sessionId` | yes | Demo session (`[a-z0-9-]`, ≤ 40 characters, e.g. `demo`). Sessions are isolated from each other. |
| `runId` | yes | Scenario run. `scenario.start` begins it and `scenario.reset` ends it. Messages for an ended run are stale and are ignored. |
| `caseId` | for case messages | Health event (case). Null only for scenario control messages. |
| `retestId` | for retest messages | Links a retest request, its completion and its result |
| `sentAt` | yes | When the sender sent the message, or first tried to |
| `occurredAt` | no | When the thing happened (e.g. acquisition). Keep it unchanged through offline buffering. |
| `source` | yes | `trigger`, `hud` or `station`. Informational only: a server will check the authenticated role instead. |
| `type`, `payload` | yes | See below |

Messages delivered later by the relay will also carry `seq` (the relay's order), `receivedAt` and
`sender` (the authenticated role). In mock mode these fields are absent.

## Event types

| Type | Publisher | Meaning |
|---|---|---|
| `scenario.start` | Trigger | Starts a run: astronaut and task context |
| `scenario.reset` | Trigger | Ends the run. Later messages for it are ignored. |
| `observation.submitted` | Trigger | One simulated sEMG window: signal quality, features, optional IMU summary, protocol and context |
| `hud.received` | HUD | **The HUD device received** a station message (`messageId` = that message's eventId). Not a confirmation. |
| `hud.ack` | HUD | **The astronaut explicitly acknowledged** it |
| `hud.defer` | HUD | The astronaut deferred it, with a reason |
| `retest.completed` | HUD | **The astronaut reports the retest as performed.** The data comes separately. |
| `retest.result` | Trigger or HUD | The retest measurement (an observation), with the same `retestId` |
| `station.notice.approved` | Station | A notice for the astronaut, published **only after a human approved it** |
| `station.retest.requested` | Station | A standard retest task, published **only after a human approved it** |
| `station.receipt` | Station | The station received a retest result: `accepted`, `duplicate` or `rejected` |
| `station.reassessment` | Station | The human decision on a re-evaluation (version 2 or later) |
| `station.audit.assessment`, `station.audit.review` | Station | Traceability records only. **The HUD and Trigger must not act on them.** |

Delivery, acknowledgement, retest completion and case closure are four different things. Only a
Station human closes a case, and a single normal retest does not close it by itself.

## Example flow (`contracts/scenarios/change-retest.json`)

1. Trigger sends `scenario.start`, then `observation.submitted` with `caseId: "case-change"`.
2. The Station runs its simulated analysis and gets a candidate. A human approves it with a reason.
3. Station sends `station.notice.approved` and `station.retest.requested` (`retestId: "case-change-rt1"`).
4. HUD sends `hud.received` for each message, then `hud.ack` or `hud.defer`, using `messageId` = the station message's `eventId`.
5. HUD sends `retest.completed`. Trigger or HUD sends `retest.result` with `retestId: "case-change-rt1"`.
6. Station sends `station.receipt` (`accepted`) and runs re-evaluation v2. A human closes the case or keeps it under watch, and Station sends `station.reassessment`.

## Migration from the v0 station draft (`docs/station-integration.md`)

| v0-draft | v1 |
|---|---|
| `schema: "myomars.station/v0-draft"` | `schema: "myomars/v1"` |
| — | New required `sessionId` |
| — | Optional `occurredAt`; relay fields `seq`, `receivedAt`, `sender` on delivery |
| Observation fields | Unchanged; new optional `deviceId` and `imu` (`accelRmsG`, `gyroRmsDps`, `movementPct`) |
| `hud.received`, `hud.ack`, `hud.defer` | Unchanged |
| — | New `retest.completed`: the astronaut reports completion, separate from `retest.result` |
| Station payloads (TypeScript types only) | Now Zod schemas plus JSON Schema, unchanged fields |
| — | New `station.audit.assessment` and `station.audit.review` (traceability only) |

## Changing the contracts

1. Change `src/contracts/*.ts`, run `npm run contracts:build`, and add a line under Changelog.
2. v1 accepts only additive changes: optional fields or new types. Anything else becomes `myomars/v2`.
3. Open a PR that the HUD, Trigger and Station owners all review. Do not change another team's
   behaviour silently.

## Open questions for the HUD and Trigger owners

- Who creates `caseId`? This draft assumes the Trigger scenario defines it.
- Can the HUD send a device receipt (`hud.received`) separately from the astronaut's `hud.ack`?
- Does the retest data (`retest.result`) come from the sensor simulator (Trigger), the HUD, or both?
- Are the IMU summary fields sufficient, or does the simulator need raw windows?

## Changelog

- **v1 (2026-11-14):** first shared version, derived from the v0 station draft (see Migration).
