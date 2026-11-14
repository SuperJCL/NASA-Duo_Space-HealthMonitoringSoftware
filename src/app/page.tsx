import type { Metadata } from "next";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { MissionGlass } from "@/components/prototype/MissionGlass";
import { loadBriefings } from "@/lib/briefing/repository";
import { briefingView } from "@/lib/briefing/view";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { latestRecordDate, loadMission, missionContext, selectGeoFeatures } from "@/lib/mission/mode";
import { loadCandidateCompare } from "@/lib/prototype/candidate-compare-data";
import { parseScenario, simulatedTargets } from "@/lib/prototype/mission-glass";
import { loadEvaScouting } from "@/lib/eva-route/repository";

export const metadata: Metadata = {
  title: "Mission Glass · MDI 2.0",
  description: "Simulated mission planning and EVA HUD over verified NASA/PDS context (training prototype, not flight software).",
};

/**
 * Default entry point (MAP-0): MDI 2.0 Mission Glass. The research workspace
 * (location briefings, full ranking workspace) is at /research.
 */
export default function MissionGlassPage() {
  const { scenario, sources, registry } = loadJezeroMarginScenario();
  const geo = loadJezeroGeo();
  const s = parseScenario(scenarioJson, scenario, geo.catalog);
  const ctx = missionContext(loadMission(), scenario, "present-day");
  const { features } = selectGeoFeatures(geo, ctx);
  const lefroy = loadBriefings().find((b) => b.locationId === s.verifiedAnchorId);
  const asOf = latestRecordDate(scenario);
  return (
    <MissionGlass
      scenario={scenario}
      registry={registry}
      sources={sources}
      s={s}
      targets={simulatedTargets(s, geo.catalog)}
      features={features}
      asOf={asOf}
      briefing={lefroy ? briefingView(lefroy, geo, sources) : null}
      compare={loadCandidateCompare({ asOf, sources, actionTaskIds: s.actions.map((a) => a.taskId) })}
      routeScenario={loadEvaScouting(geo)}
    />
  );
}
