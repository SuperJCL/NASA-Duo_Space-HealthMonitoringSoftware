import type { Metadata } from "next";
import { Station } from "@/components/station/Station";

export const metadata: Metadata = {
  title: "MyoMars · 火星基站",
  description: "MyoMars base station demo: health-event workbench with simulated observations, simulated (rule-based) analysis, human review, HUD dispatch and retest management. Not a medical device.",
};

/**
 * Default entry point on the MyoMars branch: the base station (health-event workbench), built
 * with the Mission Glass visual system. The previous Mission Glass page (with its map and EVA
 * route view) is kept at /legacy/mission-glass; the research workspace is at /research.
 */
export default function StationPage() {
  return <Station />;
}
