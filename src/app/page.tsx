import { AppHeader } from "@/components/layout/AppHeader";
import { MarsMapLoader } from "@/components/map/MarsMapLoader";
import { InvestigationWorkspace } from "@/components/workspace/InvestigationWorkspace";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";

export default function Home() {
  // Curated JSON and the review registry are validated (Zod + integrity rules) here, at build time.
  const { scenario, sources, registry } = loadJezeroMarginScenario();

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      {/* UX-1: the workspace lays out the step navigation, integrity bar, map and step panel. */}
      <InvestigationWorkspace scenario={scenario} sources={sources} registry={registry} map={<MarsMapLoader />} />
    </div>
  );
}
