// MyoMars DATA REPLAY (input side, no product UI). Reads stored samples and publishes them as the
// data producer: contract role "trigger" (the role name is kept from contracts v1; there is no
// Trigger page). Two entry points call this module: the command line (replay/cli.ts) and the Mars
// Station's hidden dev entry (relay mode). It never analyses, never approves, never answers for the HUD.
//
// TODAY'S SOURCE IS SIMULATED: the shared contract demo fixtures (src/contracts/demo-fixtures.ts,
// published on main 58b5a08). It is NOT the health-data teammate's data. Their data is read from
// their branch when it is pushed and goes through intakeCheck() first (format, source, person,
// body site, device, units, sample rate, time, protocol conditions, missing values, raw vs features).
//
// PROTOCOL: the grip protocol of the shared fixtures (std-grip-40) is only the CURRENT INTEGRATION
// SAMPLE. It is not the protocol future data must use: teammate data keeps its own protocol id and
// conditions, and the station needs a baseline for that protocol before it can compare anything.
//
// Pure module, relative ".ts" imports only, so Node 22 runs it directly (CLI) and Next.js bundles it.

import { SCHEMA, type Envelope } from "../../contracts/envelope.ts";
import { FIXTURES, STANDARD_PROTOCOL as INTEGRATION_SAMPLE_PROTOCOL } from "../../contracts/demo-fixtures.ts";
import { Observation, type ScenarioStart } from "../../contracts/payloads.ts";

export const REPLAY_CLIENT_SUFFIX = "replay";

export type SampleSource = {
  /** Where the values come from. */
  label: string;
  /** True only for the health-data teammate's data. Nothing in this file is. */
  teammateData: boolean;
  /** Summary features (what the station analyses) or raw signals (would need a conversion step). */
  kind: "features" | "raw";
};

/** Metadata the contract does not carry. `assumed: true` = a demo assumption, shown as such. */
export type MetaItem = { value: string; assumed: boolean; note: string };

export type ReplaySample = {
  id: string;
  label: string;
  source: SampleSource;
  /** The stored observation, exactly as recorded in the source (its own astronautId and time). */
  observation: Observation;
  meta: { bodySite: MetaItem; device: MetaItem };
};

const SHARED: SampleSource = { label: "模拟样例 · 共享契约 demo fixtures（main 58b5a08）", teammateData: false, kind: "features" };
/** The standard grip protocol does not name a body site; the station's notice text speaks of the forearm. */
const GRIP_SITE: MetaItem = { value: "前臂（握持肌群）", assumed: true, note: "契约没有测量部位字段；按标准握持协议与基站提示文字推定（演示假设）" };
const NO_DEVICE: MetaItem = { value: "未注明", assumed: false, note: "样例没有设备信息；契约中 deviceId 可选，回放不补写" };

const shared = (id: keyof typeof FIXTURES, label: string): ReplaySample => ({
  id,
  label,
  source: SHARED,
  observation: FIXTURES[id].observation,
  meta: { bodySite: id === "not-comparable" ? { value: "前臂（握持肌群）", assumed: true, note: "岩芯钻取持续握持，部位按协议推定（演示假设）" } : GRIP_SITE, device: NO_DEVICE },
});

/** The samples the replay can send today. All simulated. */
export const REPLAY_SAMPLES: readonly ReplaySample[] = [
  shared("change", "可比变化（完整流程）"),
  shared("normal", "正常"),
  shared("acquisition", "采集质量异常"),
  shared("not-comparable", "条件不可比"),
  {
    // Derived from the shared "change" fixture by REMOVING one value (never by adding one): shows how a
    // result without the grip-meter reading is handled. The missing value stays null.
    id: "grip-missing",
    label: "握力计未读数（缺失值演示）",
    source: { ...SHARED, label: "模拟样例 · 由共享 fixture「change」去掉握力读数派生" },
    observation: { ...FIXTURES.change.observation, observationId: "obs-grip-missing-1", features: { ...FIXTURES.change.observation.features!, gripForceN: null } },
    meta: { bodySite: GRIP_SITE, device: NO_DEVICE },
  },
];
export const sampleById = (id: string) => REPLAY_SAMPLES.find((s) => s.id === id) ?? null;

export type RunInfo = { runId: string; astronaut: { id: string; callsign: string }; task: { id: string; title: string } };

export type CheckStatus = "ok" | "assumed" | "missing" | "blocked";
export type CheckItem = { item: string; status: CheckStatus; detail: string };

const FEATURE_TEXT = { medianFreqHz: "肌电中位频率（Hz）", rmsPctMvc: "肌电幅值 RMS（%MVC）", gripForceN: "握力（N，握力计独立读数）" } as const;

/**
 * Intake checklist for one sample against the run it would join. "blocked" items stop publishing.
 * Demo assumptions are allowed only for simulated samples and are always listed; teammate data with a
 * different person, or raw signals, is blocked until a reviewed mapping exists.
 */
export function intakeCheck(sample: ReplaySample, run: RunInfo | null, replayTimeIso: string): { items: CheckItem[]; publishable: boolean } {
  const o = sample.observation;
  const items: CheckItem[] = [];
  const parsed = Observation.safeParse(o);
  items.push({ item: "格式", status: parsed.success ? "ok" : "blocked", detail: parsed.success ? "符合共享契约 Observation（myomars/v1）" : `不符合契约 Observation，需先确定字段映射；缺失或不符：${[...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(根)"))].join("、")}` });
  items.push({ item: "来源", status: "ok", detail: `${sample.source.label}${sample.source.teammateData ? "" : "（不是队友数据）"}` });
  if (!parsed.success) return { items, publishable: false };   // nothing else can be read reliably
  items.push({
    item: "数据类型",
    status: sample.source.kind === "features" ? "ok" : "blocked",
    detail: sample.source.kind === "features" ? "已计算的汇总特征（基站当前只接收汇总指标）" : "原始 sEMG/IMU：需要先定义并验证特征提取，不能直接写入 features 字段",
  });
  if (!run) items.push({ item: "人员", status: "blocked", detail: "没有进行中的运行" });
  else if (o.astronautId === run.astronaut.id) items.push({ item: "人员", status: "ok", detail: `${o.astronautId}` });
  else if (!sample.source.teammateData) items.push({ item: "人员", status: "assumed", detail: `样例记录于 ${o.astronautId}，本次按演示假设归属 ${run.astronaut.callsign}（${run.astronaut.id}）` });
  else items.push({ item: "人员", status: "blocked", detail: `数据属于 ${o.astronautId}，与本次运行 ${run.astronaut.id} 不同：不套用他人基线` });
  items.push({ item: "测量部位", status: sample.meta.bodySite.assumed ? "assumed" : "ok", detail: `${sample.meta.bodySite.value} · ${sample.meta.bodySite.note}` });
  items.push({ item: "设备", status: sample.meta.device.value === "未注明" ? "missing" : sample.meta.device.assumed ? "assumed" : "ok", detail: sample.meta.device.note });
  const p = o.protocol;
  items.push({ item: "协议条件", status: "ok", detail: `${p.label}（${p.id}）· ${p.targetPctMvc}% MVC · ${p.posture} · ${p.glove}${p.id === INTEGRATION_SAMPLE_PROTOCOL.id ? " · 当前集成样例协议（不是未来数据的唯一协议）" : ` · 基站目前只有 ${INTEGRATION_SAMPLE_PROTOCOL.id} 的个体基线，此协议会判为条件不可比，直到为它建立基线`}` });
  items.push({ item: "单位", status: "ok", detail: "按契约字段固定：Hz、%MVC、N、kΩ、%" });
  items.push({ item: "采样率与时长", status: "ok", detail: `${o.signal.sampleRateHz} Hz · ${o.signal.durationS} s` });
  items.push({ item: "时间", status: "assumed", detail: `原始采集时间 ${o.capturedAt}；回放时按演示假设记为回放时刻${replayTimeIso ? ` ${replayTimeIso}` : ""}` });
  if (run) {
    const same = o.context.taskId === run.task.id;
    items.push({ item: "任务情境", status: same ? "ok" : "assumed", detail: same ? `${run.task.title}（${run.task.id}）` : `样例记录于任务 ${o.context.taskId ?? "未注明"}，按演示假设归属本次 EVA 任务「${run.task.title}」；任务不提供负荷、姿势或设备条件` });
    items.push({ item: "EVA 时间点", status: o.context.minutesIntoEva === null ? "ok" : "missing", detail: o.context.minutesIntoEva === null ? "样例未注明" : `样例为 EVA 第 ${o.context.minutesIntoEva} 分钟；本次 EVA 中的时间点未知，回放记为未知（不套用）` });
  }
  const missing = o.features ? (Object.keys(FEATURE_TEXT) as (keyof typeof FEATURE_TEXT)[]).filter((k) => o.features![k] === null) : [];
  items.push({
    item: "缺失值",
    status: !o.features || missing.length ? "missing" : "ok",
    detail: !o.features ? "特征整体缺失（保持 null）" : missing.length ? `缺少 ${missing.map((k) => FEATURE_TEXT[k]).join("、")}：保持 null，不补造、不填零` : "协议要求的三项特征齐全",
  });
  return { items, publishable: !items.some((i) => i.status === "blocked") };
}

/** scenario.start for a new integration run (the data producer starts runs; the HUD only joins). */
export function startEnvelope(sessionId: string, nowMs: number, astronaut = { id: "a-02", callsign: "A-02" }): Envelope {
  const runId = `run-rp-${nowMs.toString(36)}`;
  const at = new Date(nowMs).toISOString();
  // Task matches the shared fixtures' context (taskId "eva-sampling"), so run and observations agree.
  const payload: ScenarioStart = { scenarioId: "myomars-integration-replay", astronaut, task: { id: "eva-sampling", title: "EVA 采样作业", targetId: null } };
  return { schema: SCHEMA, eventId: `${runId}-start`, sessionId, runId, caseId: null, sentAt: at, source: "trigger", type: "scenario.start", payload } as Envelope;
}

/**
 * observation.submitted for one sample in the current run. Only the person, the time and the task
 * context change (all listed as assumptions by intakeCheck); every measured value is published as stored.
 */
export function observationEnvelope(sessionId: string, run: RunInfo, sample: ReplaySample, nowMs: number): Envelope {
  const at = new Date(nowMs).toISOString();
  const caseId = `${run.runId}-rp-${nowMs.toString(36)}`;
  const o = sample.observation;
  // Person, time and task are re-assigned to this run (each listed as an assumption by intakeCheck); the
  // minute into the EVA of the original recording does not apply here, so it becomes unknown.
  const payload: Observation = { ...o, observationId: `${o.observationId}-${nowMs.toString(36)}`, astronautId: run.astronaut.id, capturedAt: at, context: { ...o.context, taskId: run.task.id, minutesIntoEva: null } };
  return { schema: SCHEMA, eventId: `${caseId}-obs`, sessionId, runId: run.runId, caseId, sentAt: at, occurredAt: at, source: "trigger", type: "observation.submitted", payload } as Envelope;
}
