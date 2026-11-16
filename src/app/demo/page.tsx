import type { Metadata } from "next";
import { LiveDemo } from "@/components/demo/LiveDemo";
import { loadStationMission } from "../station-mission";

export const metadata: Metadata = {
  title: "MyoMars · Live demo",
  description:
    "Browser-based demo of MyoMars: the Mars Base and the Astronaut HUD in one page, exchanging messages inside the browser. Simulated data and simulated analysis; human review before anything reaches the crew. Not a medical device.",
};

/**
 * Online single-page demo (Vercel): Mars Base and Astronaut HUD as two tabs of one page, linked by an
 * in-browser bus (src/lib/demo). No relay process, no server session; each visitor has their own.
 * The two-end relay mode stays on / (?relay=auto) with `npm run relay`.
 */
export default function DemoPage() {
  return <LiveDemo mission={loadStationMission()} />;
}
