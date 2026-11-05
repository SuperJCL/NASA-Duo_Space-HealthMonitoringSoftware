import type { Metadata } from "next";
import { AppHeader } from "@/components/layout/AppHeader";
import { loadBriefings } from "@/lib/briefing/repository";
import { MissionWorkspace } from "@/components/mission/MissionWorkspace";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";
import { loadJezeroGeo } from "@/lib/geo/repository";
import { loadMission } from "@/lib/mission/mode";

export const metadata: Metadata = {
  title: "Research workspace · Mars Discovery Intelligence",
  description: "Jezero crater sample-site science briefings and the full evidence and ranking workspace.",
};

/** The research workspace (formerly the home page); Mission Glass is the default entry at /. */
export default function ResearchPage() {
  // Curated JSON, the review registry, geographic records and the mission
  // config are validated (Zod + integrity rules) here, at build time.
  const { scenario, sources, registry } = loadJezeroMarginScenario();
  const geo = loadJezeroGeo();
  const mission = loadMission();
  const briefings = loadBriefings();

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <AppHeader />
      {/* BR-2: map plus location science briefing; the MF-1 ranking workspace is in the advanced drawer. */}
      <MissionWorkspace scenario={scenario} sources={sources} registry={registry} geo={geo} mission={mission} briefings={briefings} />
    </div>
  );
}
