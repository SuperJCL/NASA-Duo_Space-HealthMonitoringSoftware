# Mars Station: local mock extensions and interface proposals

**Status:** proposals from the Mars Station owner, **not agreed**. Not part of the shared contracts
v1 (`docs/myomars/CONTRACTS.md`). Nothing here changes the Trigger's or the HUD's interface.

The crew overview needs three things that contracts v1 has no message for. Until the team decides,
the station accepts them only from its **local demo**, with their own schema tag
(`"schema": "myomars/v1-local"`), so they can never be mistaken for contract messages.

- Source: `src/lib/station/local-protocol.ts` (Zod).
- Use: `src/lib/station/station.ts`.
- All values are simulated.

## 1. Crew roster — `local.crew.roster` (Trigger)

`scenario.start` names one astronaut. The overview shows every crew member on EVA.

```json
{ "members": [ { "astronautId": "ev2", "callsign": "EV2（模拟宇航员）",
  "task": { "id": "eva-inspection", "title": "EVA 设备巡检" },
  "evaStartedAt": "2026-11-14T21:30:00Z", "deviceId": "semg-ev2" } ] }
```

- 1 to 6 members per run.
- Replaces the roster of the current run.

**Proposal:** an optional `crew` array on `scenario.start`, or this separate message.

## 2. Device connection — `local.device.status` (Trigger / transport)

The card shows device connection **separately** from data validity and event status.

```json
{ "astronautId": "ev2", "deviceId": "semg-ev2", "connection": "disconnected", "at": "2026-11-14T22:05:00Z" }
```

**Proposal:** who reports this, the Trigger, the HUD or the relay, and at what interval?

## 3. Astronaut's own report — `local.hud.report` (HUD)

The HUD lets the astronaut report something themselves.

```json
{ "reportId": "r-1", "astronautId": "ev2", "text": "右前臂持续酸胀，握工具时比平时吃力。",
  "request": "请基地评估是否需要做一次测量", "reportedAt": "2026-11-14T22:10:00Z" }
```

The envelope needs a `caseId`, which defines a new event. How the station handles a report:

- It is checked, never treated as a diagnosis.
- It is never discarded because sensor data is missing or invalid.
- No sEMG analysis is made without a new measurement.
- The latest valid measurement, if any, is shown only as reference.
- The candidate asks the base whether to reply and request a standardised measurement. That
  measurement then follows the normal flow:
  `station.notice.approved` + `station.retest.requested` → `retest.result`.

**Proposal:** a `hud.report` event type, published by the HUD with a `caseId`.

## Related wording points on the shared contracts

These need team review. Nothing has been changed on main.

- `station.audit.assessment.trigger` allows only `observation | retest`. A report check is
  therefore not sent as an audit record; it appears only in the station timeline. Proposal: add
  `report`.
- `CONTRACTS.md` describes `station.reassessment` as "version 2 or later". The station also uses
  it at version 1 for the close / keep-watching status notification. The schema already allows
  it. Proposal: reword it as "status notification after a human close or keep-watching decision".

## Not messages

- **"Viewed by the base" (unread counts)** is station-internal (`view` action). It never sends
  anything and never counts as an astronaut confirmation or a close.
- **Pausing the demo replay** is a demo-drawer state. It is not a device status.
