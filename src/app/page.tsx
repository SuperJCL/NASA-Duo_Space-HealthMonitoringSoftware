import { AppHeader } from "@/components/layout/AppHeader";
import { MarsMapLoader } from "@/components/map/MarsMapLoader";
import { InvestigationWorkspace } from "@/components/workspace/InvestigationWorkspace";
import { loadJezeroMarginScenario } from "@/lib/evidence/repository";

export default function Home() {
  // Curated JSON is validated (Zod + integrity rules) here, at build time.
  const { scenario, sources, registry } = loadJezeroMarginScenario();

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section aria-label="Mars map" className="relative h-[45dvh] shrink-0 lg:h-auto lg:flex-1">
          <MarsMapLoader />
        </section>
        <InvestigationWorkspace scenario={scenario} sources={sources} registry={registry} />
      </main>
    </div>
  );
}
