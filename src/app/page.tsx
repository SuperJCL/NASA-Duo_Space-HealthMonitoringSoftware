import { AppHeader } from "@/components/layout/AppHeader";
import { InvestigationPanel } from "@/components/investigation/InvestigationPanel";
import { MarsMapLoader } from "@/components/map/MarsMapLoader";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label="Mars map"
          className="relative h-[55dvh] shrink-0 lg:h-auto lg:flex-1"
        >
          <MarsMapLoader />
        </section>
        <InvestigationPanel />
      </main>
    </div>
  );
}
