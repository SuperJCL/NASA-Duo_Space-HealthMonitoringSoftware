import { AppHeader } from "@/components/layout/AppHeader";
import { MissionWorkspace } from "@/components/mission/MissionWorkspace";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { loadMission } from "@/lib/mission/mode";

export default function Home() {
  // Curated JSON, the review registry, geographic records and the mission
  // config are validated (Zod + integrity rules) here, at build time.
  const { scenario, sources, registry } = loadJezeroMarginScenario();
  const geo = loadJezeroGeo();
  const mission = loadMission();

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <AppHeader />
      {/* MF-1: map-first mission explorer (no step wizard). */}
      <MissionWorkspace scenario={scenario} sources={sources} registry={registry} geo={geo} mission={mission} />
    </div>
  );
}
