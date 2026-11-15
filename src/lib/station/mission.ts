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

/** preparing: no EVA yet · starting: "Start EVA" sent, waiting for the relay · eva-active · eva-ended. */
export type MissionPhase = "preparing" | "starting" | "eva-active" | "eva-ended";

export const PHASE_LABEL: Record<MissionPhase, string> = {
  preparing: "Mission preparation",
  starting: "Starting EVA",
  "eva-active": "Simulated EVA in progress",
  "eva-ended": "Simulated EVA ended",
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
export const MISSION_CREW = [{ id: "a-02", callsign: "A-02", hud: "A-02 HUD (integration mode page)" }] as const;

/** A fresh run id for a new EVA (one per confirmed start). */
export const evaRunId = (nowMs: number) => `eva-${nowMs.toString(36)}`;

/** The mission task a run carries (scenario.start task id), if it belongs to this mission. */
export function runTask(def: MissionDef | null, s: Pick<StationState, "run">): MissionTask | null {
  if (!def || !s.run || s.run.scenarioId !== def.id) return null;
  return def.tasks.find((t) => t.taskId === s.run!.task.id) ?? null;
}

/** What the summary states about health-measurement conditions (never derived from the task or terrain). */
export const CONDITION_NOTES = [
  "Protocol and measurement conditions come with each measurement (current integration sample protocol: std-grip-40, not the only protocol for future data).",
  "The task does not state load, posture or device conditions: they stay unknown and are not inferred from the task.",
  "Choosing a task does not make measurements comparable: comparability is checked per measurement against the protocol and this astronaut's individual baseline.",
  "Terrain, route or task scores are never turned into fatigue or health risk.",
] as const;
