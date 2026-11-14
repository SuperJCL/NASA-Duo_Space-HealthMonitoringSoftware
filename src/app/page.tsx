import type { Metadata } from "next";
import { CrewStation } from "@/components/station/crew/CrewStation";

export const metadata: Metadata = {
  title: "MyoMars · 火星基站",
  description: "MyoMars base station demo: crew overview, alerts, and a per-astronaut analysis and communication panel (simulated observations, rule-based simulated analysis, human review, HUD dispatch, retest and re-evaluation). Not a medical device.",
};

/**
 * Default entry point on the MyoMars branch: the base station crew overview. The previous
 * three-column workbench is kept at /legacy/workbench; Mission Glass (map, EVA route) at
 * /legacy/mission-glass; the research workspace at /research.
 */
export default function StationPage() {
  return <CrewStation />;
}
