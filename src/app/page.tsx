import type { Metadata } from "next";
import { CrewStation } from "@/components/station/crew/CrewStation";
import { loadStationMission } from "./station-mission";
export const metadata: Metadata = {
  title: "MyoMars · Mars Base",
  description: "MyoMars base station: one simulated EVA from task preparation on the map (2D map, 3D terrain, task selection) to health monitoring (simulated observations, rule-based simulated analysis, human review, HUD dispatch, retest and re-evaluation). Not a medical device.",
};

/**
 * Default entry: the MyoMars base station. Task preparation reuses the existing Mission Glass (loaded
 * here exactly as on /legacy/mission-glass); health monitoring is the crew overview and person panel.
 * Kept as separate pages: /legacy/mission-glass (full Mission Glass), /research, /legacy/workbench.
 */
export default function StationPage() {
  return <CrewStation mission={loadStationMission()} />;
}
