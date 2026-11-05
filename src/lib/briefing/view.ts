import type { Source } from "@/lib/evidence/schema";
import { roverLastPositionFeature } from "@/lib/geo/features";
import { polylineLengthM } from "@/lib/geo/geometry";
import type { GeoBundle } from "@/lib/geo/repository";
import type { Briefing, BriefingItem, Classification } from "./schema";

/**
 * View model for the science-briefing panel (BR-2). Pure, so the UI renders
 * only tested strings. Order and grouping follow the product goal: why it
 * matters → the open question → what was measured → what the team thinks →
 * already done → what the source proposes next.
 */
export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  measured: "Measured",
  interpreted: "Interpreted · preliminary",
  "open-question": "Open question · stated by the source",
  "proposed-by-source": "Proposed by the source · conditional",
  "simulated-idea": "Simulated idea · MDI, not reviewed",
};

export type BriefingLine = {
  id: string;
  claim: string;
  classification: Classification;
  badge: string;
  scope: BriefingItem["scope"];
  limitations: string[];
  sources: { quote: string; where: string; url: string; sourceTitle: string }[];
};

export type BriefingView = {
  id: string;
  locationId: string;
  title: string;
  subtitle: string;
  whyItMatters: BriefingLine[];
  keyQuestion: BriefingLine;
  otherQuestions: BriefingLine[];
  measured: BriefingLine[];
  interpreted: BriefingLine[];
  alreadyDone: (BriefingLine & { sols: number[] })[];
  proposed: BriefingLine[];
  status: BriefingLine[];
  simulated: BriefingLine[];
  roverNote: string;
  report: { title: string; url: string; date: string };
};

const compass = (dLonM: number, dLatM: number) => {
  const deg = ((Math.atan2(dLonM, dLatM) * 180) / Math.PI + 360) % 360;
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(deg / 45) % 8];
};

export function briefingView(b: Briefing, geo: GeoBundle, sources: readonly Source[]): BriefingView {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const line = (i: BriefingItem): BriefingLine => ({
    id: i.id,
    claim: i.claim,
    classification: i.classification,
    badge: CLASSIFICATION_LABEL[i.classification],
    scope: i.scope,
    limitations: i.limitations,
    sources: i.citations.map((c) => ({
      quote: c.quote,
      where:
        c.sourceId === b.report.sourceId
          ? `${b.report.title} initial report · ${c.section === "Sample Designation:" ? "report header" : c.section} · p. ${c.pages.join("–")}`
          : (sourceById.get(c.sourceId)?.title ?? c.sourceId),
      url: c.sourceUrl,
      sourceTitle: sourceById.get(c.sourceId)?.title ?? c.sourceId,
    })),
  });
  const of = (pred: (i: BriefingItem) => boolean) => b.items.filter(pred).map(line);

  // Where is the rover? Only historical data: the last position in the dataset.
  const site = geo.catalog.records.find((r) => r.id === b.locationId);
  const last = roverLastPositionFeature(geo);
  let roverNote = "This app has no live rover data.";
  if (site?.kind === "sample-site" && last.geometry.type === "Point") {
    const p = last.geometry.coordinates;
    const km = polylineLengthM([site.position, p]) / 1000;
    const dLonM = polylineLengthM([site.position, [p[0], site.position[1]]]) * Math.sign(p[0] - site.position[0]);
    const dLatM = polylineLengthM([site.position, [site.position[0], p[1]]]) * Math.sign(p[1] - site.position[1]);
    roverNote = `No. After sampling here the rover drove on: this app’s historical traverse ends at sol ${last.event?.sol}, about ${km.toFixed(1)} km ${compass(dLonM, dLatM)} of ${b.title}. There are no live data, so its current position is not shown.`;
  }

  const key = b.items.find((i) => i.id === b.keyQuestionItemId)!;
  const reportSource = sourceById.get(b.report.sourceId);
  return {
    id: b.id,
    locationId: b.locationId,
    title: b.title,
    subtitle: b.subtitle,
    whyItMatters: of((i) => i.topic === "why-here"),
    keyQuestion: line(key),
    otherQuestions: of((i) => i.classification === "open-question" && i.id !== key.id),
    measured: of((i) => i.topic === "measured"),
    interpreted: of((i) => i.topic === "interpreted"),
    alreadyDone: b.items.filter((i) => i.topic === "already-done").map((i) => ({ ...line(i), sols: i.sols ?? [] })),
    proposed: of((i) => i.classification === "proposed-by-source"),
    status: of((i) => i.topic === "next" && i.classification === "measured"),
    simulated: of((i) => i.classification === "simulated-idea"),
    roverNote,
    report: { title: b.report.title, url: reportSource?.url ?? "", date: b.report.reportDate },
  };
}
