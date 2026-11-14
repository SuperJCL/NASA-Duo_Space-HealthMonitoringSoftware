// Generates the language-neutral contract files (contracts/schema, contracts/examples,
// contracts/scenarios) from the Zod sources and the station's demo fixtures. Pure: returns
// { relativePath: fileContent }. Written by tools/myomars/build-contracts.ts; a unit test
// fails when the committed files drift from the sources.

import { z } from "zod";
import { DEMO_START, FIXTURES, RETEST_FIXTURES, STANDARD_PROTOCOL } from "../../src/contracts/demo-fixtures.ts";
import { Delivered, Envelope, EVENT_RULES, EVENT_TYPES, SCHEMA, type EventType } from "../../src/contracts/envelope.ts";

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const schemaOf = (title: string, s: z.ZodType) => ({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://myomars.local/contracts/v1/${title}.schema.json`, title, ...z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) });

const T0 = "2026-11-14T10:00:00.000Z";
const base = (type: EventType, extra: Partial<Envelope> = {}): Envelope => ({
  schema: SCHEMA,
  eventId: `example-${type.replaceAll(".", "-")}`,
  sessionId: "demo",
  runId: "run-example-1",
  caseId: EVENT_RULES[type].caseId ? "case-change" : null,
  ...(EVENT_RULES[type].retestId ? { retestId: "case-change-rt1" } : {}),
  sentAt: T0,
  source: EVENT_RULES[type].roles[0],
  type,
  payload: {},
  ...extra,
});

/** One valid example envelope per event type (all values simulated). */
export function exampleEnvelopes(): Record<EventType, Envelope> {
  const retestObs = RETEST_FIXTURES["retest-normal"].observation(1);
  const payloads: Record<EventType, unknown> = {
    "scenario.start": DEMO_START,
    "scenario.reset": {},
    "observation.submitted": { ...FIXTURES.change.observation, deviceId: "sim-band-01", imu: { accelRmsG: 0.18, gyroRmsDps: 22, movementPct: 6 } },
    "hud.received": { messageId: "stn-run-example-1-001" },
    "hud.ack": { messageId: "stn-run-example-1-001" },
    "hud.defer": { messageId: "stn-run-example-1-002", reason: "正在作业，稍后处理（模拟）" },
    "retest.completed": { completedAt: "2026-11-14T10:39:00.000Z" },
    "retest.result": { observation: retestObs },
    "station.notice.approved": {
      noticeId: "case-change-n1",
      text: "基地提示（模拟）：你的前臂肌电与握力测量与平时基线不同。请在下一次停顿时按标准协议完成一次复测；如有不适请报告。",
      basis: ["信号质量满足演示规则，可继续。"],
      evaluationVersion: 1,
      reviewedBy: "基地值班员",
      reviewReason: "多项特征同向偏离，安排复测",
      simulated: true,
    },
    "station.retest.requested": { retestId: "case-change-rt1", protocol: STANDARD_PROTOCOL, instructions: "休息后，按标准协议复测一次。", evaluationVersion: 1, reviewedBy: "基地值班员", simulated: true },
    "station.receipt": { receivedEventId: "example-retest-result", receivedType: "retest.result", status: "accepted", reason: null },
    "station.reassessment": { evaluationVersion: 2, outcome: "within-baseline", summary: "复测在个体基线范围内", reviewDecision: "close", caseStatus: "closed", simulated: true },
    "station.audit.assessment": {
      evaluationVersion: 1,
      trigger: "observation",
      sourceEventId: "example-observation-submitted",
      inputKey: "example",
      outcome: "change-beyond-baseline",
      headline: "可比条件下特征超出个体基线波动",
      candidateKind: "notice-and-retest",
      simulated: true,
    },
    "station.audit.review": { evaluationVersion: 1, decision: "approve", reason: "多项特征同向偏离，安排复测", reviewer: "基地值班员", decidedAt: T0, caseStatus: "awaiting-hud", dispatchedEventIds: ["stn-run-example-1-001", "stn-run-example-1-002"] },
  };
  return Object.fromEntries(EVENT_TYPES.map((t) => [t, base(t, { payload: payloads[t], ...(t === "observation.submitted" ? { occurredAt: FIXTURES.change.observation.capturedAt } : {}) })])) as Record<EventType, Envelope>;
}

/** Reproducible scenario inputs (what the Trigger / sensor simulator sends), with the expected flow. */
export function scenarios() {
  const common = { schema: SCHEMA, simulated: true, note: "SIMULATED demo data; not measurements, not clinically validated.", start: DEMO_START };
  const flow = (id: string, title: string, observation: unknown, caseId: string, expected: string[], retest?: Record<string, unknown>) => ({ id, title, ...common, caseId, observation, ...(retest ? { retestResults: retest } : {}), expected });
  return {
    normal: flow("normal", "正常 · 在个体基线范围内", FIXTURES.normal.observation, FIXTURES.normal.caseId, ["station: all four analysis stages done; record-only candidate", "station staff: close or keep under watch; nothing is sent to the HUD"]),
    "acquisition-invalid": flow("acquisition-invalid", "采集异常 · 信号质量不合格", FIXTURES.acquisition.observation, FIXTURES.acquisition.caseId, ["station: quality stage blocked; no physiological inference", "station staff may approve a re-acquisition retest (technical, not a health conclusion)"]),
    "not-comparable": flow("not-comparable", "条件不可比", FIXTURES["not-comparable"].observation, FIXTURES["not-comparable"].caseId, ["station: comparability blocked; no muscle-function conclusion", "station staff may approve a standard-protocol retest"]),
    "change-retest": flow(
      "change-retest",
      "可比变化 → 审核 → HUD → 复测 → 重评",
      FIXTURES.change.observation,
      FIXTURES.change.caseId,
      [
        "station: change beyond the individual baseline; candidate notice + retest, pending human review",
        "station staff approves with a reason → station.notice.approved + station.retest.requested",
        "HUD → hud.received (device) for each, later hud.ack (astronaut) or hud.defer",
        "HUD → retest.completed; Trigger/HUD → retest.result with the same retestId",
        "station → station.receipt (accepted); re-evaluation v2; staff closes or keeps under watch → station.reassessment",
      ],
      Object.fromEntries((Object.keys(RETEST_FIXTURES) as (keyof typeof RETEST_FIXTURES)[]).map((k) => [k, { label: RETEST_FIXTURES[k].label, observation: RETEST_FIXTURES[k].observation(1) }])),
    ),
  };
}

export function generateContractFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  files["contracts/schema/envelope.schema.json"] = json(schemaOf("envelope", Envelope));
  files["contracts/schema/delivered.schema.json"] = json(schemaOf("delivered", Delivered));
  for (const t of EVENT_TYPES) files[`contracts/schema/payload.${t}.schema.json`] = json(schemaOf(`payload.${t}`, EVENT_RULES[t].payload));
  files["contracts/schema/event-rules.json"] = json(Object.fromEntries(EVENT_TYPES.map((t) => [t, { publishers: EVENT_RULES[t].roles, needsCaseId: EVENT_RULES[t].caseId, needsRetestId: EVENT_RULES[t].retestId, payloadSchema: `payload.${t}.schema.json` }])));
  for (const [t, e] of Object.entries(exampleEnvelopes())) files[`contracts/examples/${t}.json`] = json(e);
  for (const [id, s] of Object.entries(scenarios())) files[`contracts/scenarios/${id}.json`] = json(s);
  return files;
}
