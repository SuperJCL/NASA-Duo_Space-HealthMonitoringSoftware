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

const SHARED: SampleSource = { label: "Simulated sample · shared contract demo fixtures (main 58b5a08)", teammateData: false, kind: "features" };
/** The standard grip protocol does not name a body site; the station's notice text speaks of the forearm. */
const GRIP_SITE: MetaItem = { value: "Forearm (grip muscles)", assumed: true, note: "The contract has no body-site field; inferred from the standard grip protocol and the base notice text (demo assumption)" };
export const NOT_STATED = "Not stated";
const NO_DEVICE: MetaItem = { value: NOT_STATED, assumed: false, note: "The sample has no device information; deviceId is optional in the contract and the replay does not add one" };

const shared = (id: keyof typeof FIXTURES, label: string): ReplaySample => ({
  id,
  label,
  source: SHARED,
  observation: FIXTURES[id].observation,
  meta: { bodySite: id === "not-comparable" ? { value: "Forearm (grip muscles)", assumed: true, note: "Sustained grip during core drilling; site inferred from the protocol (demo assumption)" } : GRIP_SITE, device: NO_DEVICE },
});

/** The samples the replay can send today. All simulated. */
export const REPLAY_SAMPLES: readonly ReplaySample[] = [
  shared("change", "Comparable change (full flow)"),
  shared("normal", "Within Reference Range"),
  shared("acquisition", "Signal quality failed"),
  shared("not-comparable", "Conditions Not Comparable"),
  {
    // Derived from the shared "change" fixture by REMOVING one value (never by adding one): shows how a
    // result without the grip-meter reading is handled. The missing value stays null.
    id: "grip-missing",
    label: "Grip meter not read (missing-value demo)",
    source: { ...SHARED, label: "Simulated sample · derived from the shared fixture \"change\" by removing the grip reading" },
    observation: { ...FIXTURES.change.observation, observationId: "obs-grip-missing-1", features: { ...FIXTURES.change.observation.features!, gripForceN: null } },
    meta: { bodySite: GRIP_SITE, device: NO_DEVICE },
  },
];
export const sampleById = (id: string) => REPLAY_SAMPLES.find((s) => s.id === id) ?? null;

export type RunInfo = { runId: string; astronaut: { id: string; callsign: string }; task: { id: string; title: string } };

export type CheckStatus = "ok" | "assumed" | "missing" | "blocked";
export type CheckItem = { item: string; status: CheckStatus; detail: string };

const FEATURE_TEXT = { medianFreqHz: "sEMG median frequency (Hz)", rmsPctMvc: "sEMG RMS amplitude (%MVC)", gripForceN: "grip force (N, independent grip-meter reading)" } as const;

/**
 * Intake checklist for one sample against the run it would join. "blocked" items stop publishing.
 * Demo assumptions are allowed only for simulated samples and are always listed; teammate data with a
 * different person, or raw signals, is blocked until a reviewed mapping exists.
 */
export function intakeCheck(sample: ReplaySample, run: RunInfo | null, replayTimeIso: string): { items: CheckItem[]; publishable: boolean } {
  const o = sample.observation;
  const items: CheckItem[] = [];
  const parsed = Observation.safeParse(o);
  items.push({ item: "Format", status: parsed.success ? "ok" : "blocked", detail: parsed.success ? "Matches the shared contract Observation (myomars/v1)" : `Does not match the contract Observation; a field mapping is needed first. Missing or invalid: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(root)"))].join(", ")}` });
  items.push({ item: "Source", status: "ok", detail: `${sample.source.label}${sample.source.teammateData ? "" : " (not teammate data)"}` });
  if (!parsed.success) return { items, publishable: false };   // nothing else can be read reliably
  items.push({
    item: "Data type",
    status: sample.source.kind === "features" ? "ok" : "blocked",
    detail: sample.source.kind === "features" ? "Computed summary features (the base accepts summary indicators only)" : "Raw sEMG/IMU: feature extraction must be defined and validated first; it cannot go into the features field directly",
  });
  if (!run) items.push({ item: "Person", status: "blocked", detail: "No run in progress" });
  else if (o.astronautId === run.astronaut.id) items.push({ item: "Person", status: "ok", detail: `${o.astronautId}` });
  else if (!sample.source.teammateData) items.push({ item: "Person", status: "assumed", detail: `Sample recorded for ${o.astronautId}; attributed to ${run.astronaut.callsign} (${run.astronaut.id}) as a demo assumption` });
  else items.push({ item: "Person", status: "blocked", detail: `The data belongs to ${o.astronautId}, not to this run's ${run.astronaut.id}: another person's baseline is never used` });
  items.push({ item: "Body site", status: sample.meta.bodySite.assumed ? "assumed" : "ok", detail: `${sample.meta.bodySite.value} · ${sample.meta.bodySite.note}` });
  items.push({ item: "Device", status: sample.meta.device.value === NOT_STATED ? "missing" : sample.meta.device.assumed ? "assumed" : "ok", detail: sample.meta.device.note });
  const p = o.protocol;
  items.push({ item: "Protocol conditions", status: "ok", detail: `${p.label} (${p.id}) · ${p.targetPctMvc}% MVC · ${p.posture} · ${p.glove}${p.id === INTEGRATION_SAMPLE_PROTOCOL.id ? " · current integration sample protocol (not the only protocol for future data)" : ` · the base has an individual baseline for ${INTEGRATION_SAMPLE_PROTOCOL.id} only; this protocol is judged Not Comparable until a baseline exists for it`}` });
  items.push({ item: "Units", status: "ok", detail: "Fixed by the contract fields: Hz, %MVC, N, kΩ, %" });
  items.push({ item: "Sample rate and duration", status: "ok", detail: `${o.signal.sampleRateHz} Hz · ${o.signal.durationS} s` });
  items.push({ item: "Time", status: "assumed", detail: `Original capture time ${o.capturedAt}; on replay it is recorded as the replay time (demo assumption)${replayTimeIso ? ` ${replayTimeIso}` : ""}` });
  if (run) {
    const same = o.context.taskId === run.task.id;
    items.push({ item: "Task context", status: same ? "ok" : "assumed", detail: same ? `${run.task.title} (${run.task.id})` : `Sample recorded for task ${o.context.taskId ?? "not stated"}; attributed to this EVA task "${run.task.title}" as a demo assumption. The task states no load, posture or device conditions` });
    items.push({ item: "EVA time point", status: o.context.minutesIntoEva === null ? "ok" : "missing", detail: o.context.minutesIntoEva === null ? "Not stated in the sample" : `The sample is at EVA minute ${o.context.minutesIntoEva}; the time point in this EVA is unknown and recorded as unknown (not carried over)` });
  }
  const missing = o.features ? (Object.keys(FEATURE_TEXT) as (keyof typeof FEATURE_TEXT)[]).filter((k) => o.features![k] === null) : [];
  items.push({
    item: "Missing values",
    status: !o.features || missing.length ? "missing" : "ok",
    detail: !o.features ? "All features missing (kept null)" : missing.length ? `Missing ${missing.map((k) => FEATURE_TEXT[k]).join(", ")}: kept null, never invented or set to zero` : "All three features the protocol needs are present",
  });
  return { items, publishable: !items.some((i) => i.status === "blocked") };
}

/** scenario.start for a new integration run (the data producer starts runs; the HUD only joins). */
export function startEnvelope(sessionId: string, nowMs: number, astronaut = { id: "a-02", callsign: "A-02" }): Envelope {
  const runId = `run-rp-${nowMs.toString(36)}`;
  const at = new Date(nowMs).toISOString();
  // Task matches the shared fixtures' context (taskId "eva-sampling"), so run and observations agree.
  const payload: ScenarioStart = { scenarioId: "myomars-integration-replay", astronaut, task: { id: "eva-sampling", title: "EVA sampling", targetId: null } };
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
