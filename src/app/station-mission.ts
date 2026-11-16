// The station's mission inputs (Mission Glass data, mission definition), loaded on the server.
// Shared by the station page (/) and the online demo (/demo), so both show the same mission.
import scenarioJson from "@/data/prototype/mission-glass.json";
import type { StationMission } from "@/components/station/crew/CrewStation";
import { loadBriefings } from "@/lib/briefing/repository";
import { briefingView } from "@/lib/briefing/view";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { latestRecordDate, loadMission, missionContext, selectGeoFeatures } from "@/lib/mission/mode";
import { loadCandidateCompare } from "@/lib/prototype/candidate-compare-data";
import { parseScenario, simulatedTargets } from "@/lib/prototype/mission-glass";
import { loadEvaScouting } from "@/lib/eva-route/repository";

export function loadStationMission(): StationMission {
  const { scenario, sources, registry } = loadJezeroMarginScenario();
  const geo = loadJezeroGeo();
  const s = parseScenario(scenarioJson, scenario, geo.catalog);
  const ctx = missionContext(loadMission(), scenario, "present-day");
  const { features } = selectGeoFeatures(geo, ctx);
  const lefroy = loadBriefings().find((b) => b.locationId === s.verifiedAnchorId);
  const asOf = latestRecordDate(scenario);
  const targets = simulatedTargets(s, geo.catalog);
  const mission: StationMission = {
    data: {
      scenario,
      registry,
      sources,
      s,
      targets,
      features,
      asOf,
      briefing: lefroy ? briefingView(lefroy, geo, sources) : null,
      compare: loadCandidateCompare({ asOf, sources, actionTaskIds: s.actions.map((a) => a.taskId) }),
      routeScenario: loadEvaScouting(geo),
    },
    def: {
      id: s.id,
      title: s.title,
      label: s.label,
      tasks: s.actions.map((a) => ({ taskId: a.taskId, title: a.shortTitle, targetId: a.targetId, targetName: targets.find((t) => t.id === a.targetId)?.name ?? a.targetId })),
    },
  };
  return mission;
}
