import type { Metadata } from "next";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { Station } from "@/components/station/Station";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { loadMission, missionContext, selectGeoFeatures } from "@/lib/mission/mode";
import { parseScenario, simulatedTargets } from "@/lib/prototype/mission-glass";
import { loadEvaScouting } from "@/lib/eva-route/repository";

export const metadata: Metadata = {
  title: "MyoMars · 火星基站",
  description: "MyoMars base station demo: simulated observations, simulated (rule-based) analysis, human review and retest management. Not a medical device.",
};

/**
 * Default entry point on the MyoMars branch: the base station, built on the Mission Glass shell.
 * The previous Mission Glass page is at /mission-glass; the research workspace at /research.
 */
export default function StationPage() {
  const { scenario } = loadJezeroMarginScenario();
  const geo = loadJezeroGeo();
  const s = parseScenario(scenarioJson, scenario, geo.catalog);
  const { features } = selectGeoFeatures(geo, missionContext(loadMission(), scenario, "present-day"));
  return <Station features={features} targets={simulatedTargets(s, geo.catalog)} routeScenario={loadEvaScouting(geo)} />;
}
