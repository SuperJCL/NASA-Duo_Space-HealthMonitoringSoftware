// MyoMars base station: LOCAL DEMO director. It is NOT the Trigger and NOT the HUD.
//
// It plays clearly labelled, simulated inputs through the mock adapter for the crew demo:
//   start a run (lead astronaut + local crew roster + device status) → per astronaut, a chosen
//   scenario (a standardised measurement, or the astronaut's own HUD report) → manual or optional
//   automatic simulated HUD feedback → retest results.
//
// Rules:
// - it only drives runs it started itself (runId prefix "demo-");
// - it never decides for the base staff: HUD feedback is only produced for messages the station
//   has already SENT, which exist only after a human approval or decision;
// - every input is an ordinary inbound message with a deterministic eventId, processed by the
//   station like any other (repeats are deduplicated there);
// - timing is cosmetic: pausing, a background tab or reduced motion change WHEN a scripted input
//   arrives, never what the station does with it; reset drops every pending input;
// - pausing the replay is a demo state; a device disconnect is a (simulated) device status.

import { inboundEnvelope } from "./adapter";
import { crewObservation, demoReport, DEMO_CREW, DEMO_START, FIXTURES, RETEST_FIXTURES, rosterMembers, type FixtureId, type RetestFixtureId } from "./fixtures";
import { localEnvelope } from "./local-protocol";
import { caseMessages, latest, messageKind, type StationState } from "./station";

export const DEMO_RUN_PREFIX = "demo-";
export const DEMO_SCENARIOS = {
  change: { label: "设备观测：可比变化（完整流程）", fixture: "change" as FixtureId },
  normal: { label: "设备观测：正常", fixture: "normal" as FixtureId },
  acquisition: { label: "设备观测：采集质量异常", fixture: "acquisition" as FixtureId },
  "not-comparable": { label: "设备观测：条件不可比", fixture: "not-comparable" as FixtureId },
  report: { label: "HUD 主动报告（本地模拟扩展）", fixture: null },
} as const;
export type DemoScenario = keyof typeof DEMO_SCENARIOS;
export type HudInput = "received" | "ack" | "defer" | "completed" | RetestFixtureId;
export const HUD_INPUTS: Record<HudInput, string> = {
  received: "HUD 接收回执",
  ack: "宇航员确认",
  defer: "宇航员暂缓",
  completed: "宇航员报告复测完成（可选）",
  "retest-normal": "复测结果：回到参考范围",
  "retest-changed": "复测结果：仍有变化",
  "retest-invalid": "复测结果：质量无效",
};

type Raw = ReturnType<typeof inboundEnvelope> | ReturnType<typeof localEnvelope>;
/** One simulated input; `make` builds the messages when the step fires (so times are current). */
export type DemoStep = { key: string; label: string; delayMs: number; make: () => Raw[] };

const isDemoRun = (s: StationState) => !!s.run && s.run.runId.startsWith(DEMO_RUN_PREFIX);
const minutesInto = (s: StationState, astronautId: string, nowMs: number) => {
  const start = s.crew[astronautId]?.evaStartedAt;
  return start ? Math.max(0, Math.round((nowMs - Date.parse(start)) / 60_000)) : null;
};

/** Simulated HUD / astronaut input for one case, built from what the station actually sent (null: nothing applies). */
export function hudInput(s: StationState, caseId: string, kind: HudInput, nowMs: number): Raw[] | null {
  const c = s.cases[caseId];
  if (!s.run || !c) return null;
  const runId = s.run.runId;
  const sent = caseMessages(s, caseId).filter((m) => m.delivery === "sent");
  const actions = sent.filter((m) => messageKind(m.type) === "action");
  const lastVersion = Math.max(0, ...actions.map((m) => (m.envelope.payload as { evaluationVersion: number }).evaluationVersion));
  const current = actions.filter((m) => (m.envelope.payload as { evaluationVersion: number }).evaluationVersion === lastVersion);
  const openRetest = c.retests.find((r) => r.status !== "result-received");
  if (kind === "received") {
    const todo = sent.filter((m) => (messageKind(m.type) === "action" || messageKind(m.type) === "status") && !m.hudReceivedAt);
    return todo.length ? todo.map((m) => inboundEnvelope("hud.received", { runId, caseId, payload: { messageId: m.eventId }, eventId: `${runId}-recv-${m.eventId}` })) : null;
  }
  if (kind === "ack") {
    const todo = current.filter((m) => m.feedback !== "acknowledged");
    return todo.length ? todo.map((m) => inboundEnvelope("hud.ack", { runId, caseId, payload: { messageId: m.eventId }, eventId: `${runId}-ack-${m.eventId}` })) : null;
  }
  if (kind === "defer") {
    const m = current.find((x) => x.type === "station.retest.requested") ?? current[0];
    return m && m.feedback === "none" ? [inboundEnvelope("hud.defer", { runId, caseId, payload: { messageId: m.eventId, reason: "正在作业，稍后再做（模拟）" }, eventId: `${runId}-defer-${m.eventId}` })] : null;
  }
  if (!openRetest) return null;
  if (kind === "completed") return [inboundEnvelope("retest.completed", { runId, caseId, retestId: openRetest.retestId, payload: { completedAt: new Date(nowMs).toISOString() }, eventId: `${runId}-done-${openRetest.retestId}` })];
  const n = c.retests.indexOf(openRetest) + 1;
  const o = crewObservation(RETEST_FIXTURES[kind].observation(n), c.astronautId, `${caseId}-rt${n}-obs`, new Date(nowMs).toISOString(), null);
  return [inboundEnvelope("retest.result", { runId, caseId, retestId: openRetest.retestId, payload: { observation: o }, eventId: `${runId}-result-${openRetest.retestId}` })];
}

/** Optional automatic simulated HUD feedback (local demo only): receipt → confirmation → normal retest result. */
export function nextAutoStep(s: StationState, nowMs: number): DemoStep | null {
  if (!isDemoRun(s)) return null;
  for (const caseId of s.caseOrder) {
    const c = s.cases[caseId];
    const recv = hudInput(s, caseId, "received", nowMs);
    if (recv) return { key: `auto:${recv.map((e) => e.eventId).join(",")}`, label: "自动模拟 HUD：接收回执", delayMs: 1600, make: () => recv };
    if (c.phase === "closed" || c.phase === "deferred") continue;
    const ack = hudInput(s, caseId, "ack", nowMs);
    if (ack) return { key: `auto:${ack.map((e) => e.eventId).join(",")}`, label: "自动模拟宇航员：确认提示与复测任务", delayMs: 2200, make: () => ack };
    if (c.retests.some((r) => r.status === "acknowledged" || r.status === "completed")) {
      const res = hudInput(s, caseId, "retest-normal", nowMs);
      if (res) return { key: `auto:${res[0].eventId}`, label: "自动模拟复测：按标准协议复测并回传结果", delayMs: 3000, make: () => res };
    }
  }
  return null;
}

export type DemoSnapshot = {
  paused: boolean;
  autoHud: boolean;
  /** Next scripted or automatic simulated input (dueAt null while paused). */
  pending: { label: string; dueAt: number | null } | null;
  queued: number;
};

/** Plays the local demo: a queue of scripted inputs plus optional automatic HUD feedback, one timer at a time. */
export class DemoDirector {
  private snap: DemoSnapshot = { paused: false, autoHud: false, pending: null, queued: 0 };
  private queue: DemoStep[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduledKey: string | null = null;
  private state: StationState | null = null;
  private listeners = new Set<() => void>();
  private seq = 0;

  constructor(
    private readonly inject: (raw: unknown) => void,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snap;
  get hasTimer() {
    return this.timer !== null;
  }

  update = (state: StationState) => {
    this.state = state;
    this.reconsider();
  };

  /** Start a demo run if none: lead astronaut, crew roster and connected devices (immediately). */
  private ensureRun(): string {
    const s = this.state;
    if (s && isDemoRun(s)) return s.run!.runId;
    this.queue = [];
    this.seq += 1;
    const now = this.clock();
    const runId = `${DEMO_RUN_PREFIX}${now.toString(36)}-${this.seq}`;
    const at = new Date(now).toISOString();
    this.inject(inboundEnvelope("scenario.start", { runId, payload: DEMO_START, eventId: `${runId}-start` }));
    this.inject(localEnvelope("local.crew.roster", { runId, payload: { members: rosterMembers(now) }, eventId: `${runId}-roster` }));
    for (const m of DEMO_CREW) this.inject(localEnvelope("local.device.status", { runId, payload: { astronautId: m.astronautId, deviceId: m.deviceId, connection: "connected", at }, eventId: `${runId}-dev-${m.astronautId}-0` }));
    return runId;
  }

  /** Queue one scenario for one simulated astronaut (starts a demo run first if needed). */
  launch = (astronautId: string, scenario: DemoScenario) => {
    const runId = this.ensureRun();
    this.seq += 1;
    const n = this.seq;
    const caseId = `${astronautId}-${scenario}-${n}`;
    const callsign = DEMO_CREW.find((m) => m.astronautId === astronautId)?.callsign ?? astronautId;
    const fixture = DEMO_SCENARIOS[scenario].fixture;
    const build = (): Raw[] => {
      const now = this.clock();
      const at = new Date(now).toISOString();
      if (!fixture) return [localEnvelope("local.hud.report", { runId, caseId, payload: demoReport(astronautId, `${caseId}-report`, at), eventId: `${runId}-${caseId}` })];
      const o = crewObservation(FIXTURES[fixture].observation, astronautId, `${caseId}-obs`, at, this.state ? minutesInto(this.state, astronautId, now) : null);
      return [inboundEnvelope("observation.submitted", { runId, caseId, payload: o, eventId: `${runId}-${caseId}` })];
    };
    this.queue.push({ key: `script:${runId}:${caseId}`, label: `模拟${fixture ? " Trigger" : " HUD"}：${callsign} · ${DEMO_SCENARIOS[scenario].label}`, delayMs: 1500, make: build });
    this.set({ queued: this.queue.length });
    this.reconsider();
  };

  /** Manual simulated HUD input for a case (a direct user action: not affected by pause). Returns false when nothing applies. */
  hud = (caseId: string, kind: HudInput): boolean => {
    if (!this.state) return false;
    const envs = hudInput(this.state, caseId, kind, this.clock());
    if (!envs) return false;
    for (const e of envs) this.inject(e);
    return true;
  };

  /** Simulated device connection change (a device status, not a pause). */
  toggleDevice = (astronautId: string) => {
    const s = this.state;
    const m = s?.crew[astronautId];
    if (!s?.run || !m || !m.deviceId) return;
    this.seq += 1;
    const connection = m.connection === "connected" ? "disconnected" : "connected";
    this.inject(localEnvelope("local.device.status", { runId: s.run.runId, payload: { astronautId, deviceId: m.deviceId, connection, at: new Date(this.clock()).toISOString() }, eventId: `${s.run.runId}-dev-${astronautId}-${this.seq}` }));
  };

  /** End the current run: the station cancels its analysis; queued and pending inputs are dropped. */
  reset = () => {
    this.queue = [];
    this.cancel();
    const runId = this.state?.run?.runId;
    this.seq += 1;
    if (runId) this.inject(inboundEnvelope("scenario.reset", { runId, payload: {}, eventId: `${runId}-reset-${this.seq}` }));
    this.set({ pending: null, queued: 0 });
  };
  setPaused = (paused: boolean) => {
    this.set({ paused });
    this.reconsider();
  };
  setAutoHud = (autoHud: boolean) => {
    this.set({ autoHud });
    this.reconsider();
  };
  /** Send the next scripted / automatic input now (e.g. while paused). */
  stepNow = () => {
    const step = this.next();
    if (!step) return;
    this.cancel();
    this.fire(step);
  };
  dispose = () => this.cancel();

  private next(): DemoStep | null {
    if (this.queue.length) return this.queue[0];
    return this.state && this.snap.autoHud ? nextAutoStep(this.state, this.clock()) : null;
  }
  private reconsider() {
    const step = this.next();
    if (!step) {
      this.cancel();
      if (this.snap.pending) this.set({ pending: null });
      return;
    }
    if (this.snap.paused) {
      this.cancel();
      this.set({ pending: { label: step.label, dueAt: null } });
      return;
    }
    if (step.key === this.scheduledKey) return;
    this.cancel();
    this.scheduledKey = step.key;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scheduledKey = null;
      this.fire(step);
    }, step.delayMs);
    this.set({ pending: { label: step.label, dueAt: this.clock() + step.delayMs } });
  }
  private fire(step: DemoStep) {
    if (this.queue[0]?.key === step.key) {
      this.queue.shift();
      this.set({ queued: this.queue.length });
    }
    for (const e of step.make()) this.inject(e);
  }
  private cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.scheduledKey = null;
  }
  private set(p: Partial<DemoSnapshot>) {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l();
  }
}

/** The astronaut's open case the demo drawer acts on (latest not-closed case, else the latest). */
export function demoTargetCase(s: StationState, astronautId: string): string | null {
  const cases = s.caseOrder.map((id) => s.cases[id]).filter((c) => c.astronautId === astronautId);
  return (cases.filter((c) => c.phase !== "closed").at(-1) ?? cases.at(-1))?.caseId ?? null;
}
export const caseLabel = (s: StationState, caseId: string) => {
  const c = s.cases[caseId];
  const ev = c ? latest(c) : null;
  return ev ? `${ev.trigger === "report" ? "报告" : "测量"} · ${ev.completedAt ? ev.result.headline : "核查中"}` : caseId;
};
