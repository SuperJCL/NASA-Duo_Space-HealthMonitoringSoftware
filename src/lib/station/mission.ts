// MyoMars mission context (pure, no DOM): one SIMULATED EVA = one relay run.
//
// Task preparation happens on the mission map (the existing Mission Glass: 2D map, 3D terrain, task
// selection). Base staff then choose the astronaut, read the summary and explicitly confirm
// "开始EVA" — only that publishes scenario.start. Selecting a task, opening the map or switching
// views never starts or restarts anything. "结束EVA" changes the mission phase only: it closes no
// health event, deletes nothing and says nothing about the astronaut's health.
//
// A task gives context for display and for documented checks only. It does not make a health
// measurement comparable: load, posture and device conditions that the task does not state stay
// unknown, and terrain or route scores are never turned into fatigue or health risk.

import type { StationState } from "./station";

export type MissionTask = { taskId: string; title: string; targetId: string; targetName: string };
/** A mission defined by the existing Mission Glass scenario (simulated targets, scenario-defined positions). */
export type MissionDef = { id: string; title: string; label: string; tasks: MissionTask[] };

/** preparing: no EVA yet · starting: "开始EVA" sent, waiting for the relay · eva-active · eva-ended. */
export type MissionPhase = "preparing" | "starting" | "eva-active" | "eva-ended";

export const PHASE_LABEL: Record<MissionPhase, string> = {
  preparing: "任务准备",
  starting: "正在开始 EVA",
  "eva-active": "EVA 进行中（模拟）",
  "eva-ended": "EVA 已结束（模拟）",
};

export function missionPhase(s: Pick<StationState, "run" | "pendingStart">): MissionPhase {
  if (s.pendingStart && (!s.run || s.run.evaEndedAt)) return "starting";
  if (!s.run) return "preparing";
  return s.run.evaEndedAt ? "eva-ended" : "eva-active";
}

/**
 * Astronauts who can execute an EVA in the two-end run: those with a HUD in integration mode. The
 * HUD page is A-02's device, so A-02 is the only choice; others would receive no HUD messages.
 */
export const MISSION_CREW = [{ id: "a-02", callsign: "A-02", hud: "A-02 HUD（集成模式页面）" }] as const;

/** A fresh run id for a new EVA (one per confirmed start). */
export const evaRunId = (nowMs: number) => `eva-${nowMs.toString(36)}`;

/** The mission task a run carries (scenario.start task id), if it belongs to this mission. */
export function runTask(def: MissionDef | null, s: Pick<StationState, "run">): MissionTask | null {
  if (!def || !s.run || s.run.scenarioId !== def.id) return null;
  return def.tasks.find((t) => t.taskId === s.run!.task.id) ?? null;
}

/** What the summary states about health-measurement conditions (never derived from the task or terrain). */
export const CONDITION_NOTES = [
  "协议与测量条件由每次测量自带（当前集成样例协议 std-grip-40，不是未来数据的唯一协议）。",
  "任务未提供负荷、姿势、设备条件：保持未知，不由任务推断。",
  "选择任务不代表测量条件可比：可比性按每次测量的协议与该宇航员的个体基线核对。",
  "不把地形、路线或任务评分转换成疲劳或健康风险。",
] as const;
