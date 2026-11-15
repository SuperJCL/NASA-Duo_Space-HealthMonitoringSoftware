import type { Metadata } from "next";
import { Station } from "@/components/station/Station";

export const metadata: Metadata = {
  title: "MyoMars · 基站（旧版三栏工作台）",
  description: "Previous MyoMars base station layout (three-column health-event workbench), kept for comparison. Simulated data and simulated analysis. Not a medical device.",
};

/** The previous three-column station workbench, kept unchanged for comparison. The default entry (/) is the crew overview. */
export default function LegacyWorkbenchPage() {
  return <Station />;
}
