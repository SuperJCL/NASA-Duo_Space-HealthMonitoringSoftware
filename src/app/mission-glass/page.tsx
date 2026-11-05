import type { Metadata } from "next";
import scenarioJson from "@/data/prototype/mission-glass.json";
import { MissionGlass } from "@/components/prototype/MissionGlass";
import { loadBriefings } from "@/lib/briefing/repository";
import { briefingView } from "@/lib/briefing/view";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { latestRecordDate, loadMission, missionContext, selectGeoFeatures } from "@/lib/mission/mode";
import { parseScenario, simulatedTargets } from "@/lib/prototype/mission-glass";

export const metadata: Metadata = {
  title: "Mission Glass prototype · MDI 2.0",
  description: "Interaction prototype: simulated mission planning and EVA HUD over verified NASA/PDS context.",
};

/** MDI 2.0 Mission Glass prototype (separate route; the main app is unchanged). */
export default function MissionGlassPage() {
  const { scenario, sources, registry } = loadJezeroMarginScenario();
  const geo = loadJezeroGeo();
  const s = parseScenario(scenarioJson, scenario, geo.catalog);
  const ctx = missionContext(loadMission(), scenario, "present-day");
  const { features } = selectGeoFeatures(geo, ctx);
  const lefroy = loadBriefings().find((b) => b.locationId === s.verifiedAnchorId);
  return (
    <MissionGlass
      scenario={scenario}
      registry={registry}
      sources={sources}
      s={s}
      targets={simulatedTargets(s, geo.catalog)}
      features={features}
      asOf={latestRecordDate(scenario)}
      briefing={lefroy ? briefingView(lefroy, geo, sources) : null}
    />
  );
}
