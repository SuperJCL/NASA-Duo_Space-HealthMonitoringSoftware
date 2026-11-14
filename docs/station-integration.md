# MyoMars base station: integration proposal (DRAFT)

> **Status:** proposal from the base station side, written 2026-11-14 on branch
> `feat/myomars-station`. No team protocol existed in the repository when this was written, and
> neither did the Trigger or HUD branches. **Nothing here is an agreed team standard.**
>
> Please review it with the Trigger and HUD owners. Names and fields can change; the base station
> only needs its adapter updated (`src/lib/station/adapter.ts`).

## Current link status

| Mode | Status |
|---|---|
| Standalone demo (station alone, local mock adapter) | **Working**: unit tests and the browser smoke test |
| Same-browser link (e.g. one browser, several tabs) | Not implemented, not tested |
| Cross-device link (Trigger, HUD and station on different machines) | Not implemented, not tested |

The station header always shows "独立演示 · 未连接 Trigger / HUD", and the page's root element
carries `data-link-mode`. Do not claim the three parts are connected until a real adapter has
been tested end to end.

## Envelope (every message)

```json
{
  "schema": "myomars.station/v0-draft",
  "eventId": "unique per message (sender-generated)",
  "runId": "scenario run id (from scenario.start)",
  "caseId": "case id, or null for scenario control",
  "retestId": "retest task id (retest messages only)",
  "sentAt": "ISO 8601 date-time",
  "source": "trigger | hud | station",
  "type": "see below",
  "payload": {}
}
```

Validated with Zod in `src/lib/station/protocol.ts` (`Envelope`, `parseInbound`).

- **Deduplication:** a message whose `eventId` was already processed is ignored. A duplicate
  `retest.result` gets a `station.receipt` with `status: "duplicate"`. Senders may therefore
  safely retry with the **same** `eventId`.
- **Runs:** events from a reset or superseded `runId` are ignored and logged. After
  `scenario.reset`, every pending simulated analysis is cancelled.

## Station receives

| `type` | From | `caseId` | Payload (summary) |
|---|---|---|---|
| `scenario.start` | Trigger | null | `scenarioId`, `astronaut {id, callsign}`, `task {id, title, targetId}` |
| `scenario.reset` | Trigger | null | `{}` (must use the active `runId`) |
| `observation.submitted` | Trigger | required | `Observation` (below) |
| `hud.received` | HUD (device) | required | `messageId`: the message reached the HUD (not that the astronaut saw or accepted it) |
| `hud.ack` | HUD (astronaut) | required | `messageId` (the station message's `eventId`), optional `note`: the astronaut confirmed |
| `hud.defer` | HUD | required | `messageId`, `reason` |
| `retest.result` | HUD (or Trigger) | required, plus `retestId` | `{ observation: Observation }` |

`Observation` (all values simulated) has these fields:

- `observationId`, `astronautId`, `capturedAt`;
- `protocol {id, label, targetPctMvc, posture, glove}`;
- `context {taskId, phase: pre-eva | eva | post-eva | retest, minutesIntoEva}`;
- `signal {sampleRateHz, durationS, electrodeImpedanceKOhm, saturationPct, motionArtifactPct, dropoutPct}`;
- `features {medianFreqHz, rmsPctMvc, gripForceN}`, or `null` when extraction failed.

**Open question for the Trigger owner:** who creates `caseId`? This draft assumes the Trigger's
scenario defines it, one case per scenario incident.

## Station sends

The station sends only after a human approval, except for receipts.

| `type` | To | When | Payload (summary) |
|---|---|---|---|
| `station.notice.approved` | HUD | A reviewer approved a candidate that includes a notice | `noticeId`, `text`, `basis[]`, `evaluationVersion`, `reviewedBy`, `reviewReason`, `simulated: true` |
| `station.retest.requested` | HUD | A reviewer approved a retest candidate | `retestId` (also in the envelope), `protocol`, `instructions`, `evaluationVersion`, `reviewedBy`, `simulated: true` |
| `station.receipt` | HUD | A `retest.result` arrived | `receivedEventId`, `receivedType`, `status: accepted \| duplicate \| rejected`, `reason` |
| `station.reassessment` | HUD / Trigger | A reviewer decided on a re-evaluation (version ≥ 2) | `evaluationVersion`, `outcome`, `summary`, `reviewDecision`, `caseStatus`, `simulated: true` |

- The simulated analysis **never** sends anything by itself. It only produces a candidate that
  waits for human review.
- **Answering station messages.** The HUD should answer `station.notice.approved` and
  `station.retest.requested`, always using the station message's `eventId` as `messageId`:
  - first with `hud.received`, as soon as the message is on the device;
  - then with `hud.ack` or `hud.defer`, when the astronaut responds.
- **Open question for the HUD owner:** can the HUD send a device receipt (`hud.received`) that is
  separate from the astronaut's confirmation? `hud.received` was added on 2026-11-14 for this.
  Without it the station shows "未收到接收回执" and never infers a receipt.
- A retest result must carry the `retestId` from `station.retest.requested`. Unknown ids get a
  `rejected` receipt. A second result for the same retest gets a `duplicate` receipt and does not
  start a new evaluation.
- **Three separate statuses per dispatched message:**
  1. Handed to the adapter ("已交给适配层").
  2. Received by the HUD (`hud.received`).
  3. Astronaut confirmed or deferred (`hud.ack` / `hud.defer`).

  Each status shows "done" only when that exact signal arrives; none is inferred from another.

## Adapter contract

```ts
interface StationAdapter {
  readonly mode: "standalone-mock" | "same-browser" | "cross-device";
  readonly label: string;
  subscribe(onInbound: (raw: unknown) => void): () => void; // raw: the station validates
  send(envelope: Envelope): Promise<{ ok: boolean; note: string }>; // idempotent per eventId
}
```

To connect the real Trigger and HUD:
1. Write a new adapter (for example over the team's chosen transport).
2. Pass it to `useStation` in `src/components/station/Station.tsx`.

The station's business logic (`station.ts`, `analysis.ts`, `controller.ts`) does not change.

**Transport: not decided.** Options to discuss:
- `BroadcastChannel` for a same-browser demo;
- a small WebSocket relay for cross-device;
- whatever the team's shared module provides.

The station will not build the team's shared communication system on its own.

## What is still mock or fixture

- **Adapter:** `MockStationAdapter`. Nothing leaves the browser.
- **Inputs:** the hidden development panel injects them (`/?dev=1`, `src/components/station/DevPanel.tsx`).
  It covers four observation fixtures and three retest-result fixtures (`src/lib/station/fixtures.ts`).
- **Simulated data:**
  - the astronaut;
  - the individual baseline (6 sessions);
  - all signal values;
  - the demo thresholds (`DEMO_RULES`).

  None of these are measurements, and none are clinically validated.
- **The "LLM analysis":** a deterministic rule pipeline with paced stages (`src/lib/station/analysis.ts`).
  No model is called.
