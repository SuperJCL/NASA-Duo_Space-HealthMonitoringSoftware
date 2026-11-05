import { z } from "zod";
import missionJson from "@/data/missions/jezero-2026.json";
import type { Scenario } from "@/lib/evidence/schema";
import { allFeatures, type MapFeature } from "@/lib/geo/features";
import type { GeoBundle } from "@/lib/geo/repository";
import { MissionConfig, type MissionMode } from "./schema";

/**
 * Present-day exploration vs historical replay (MF-0).
 *
 * Both modes choose ONE evidence date, which the UI then passes to the
 * existing `selectEvidenceAsOf`. The engine and its leakage protection are
 * unchanged:
 *  - present-day uses the latest record date in the dataset, so no
 *    scientific record is withheld. The 2026 mission year is a label, not a
 *    filter date.
 *  - historical replay uses a chosen date in the scenario's valid range.
 */

export type MissionContext = {
  mode: MissionMode;
  missionId: string;
  title: string;
  disclaimer: string;
  actionFraming: string;
  caveats: string[];
  /** The date to pass to selectEvidenceAsOf. */
  evidenceAsOf: string;
  /** Latest availableFrom among the scenario's evidence records. */
  latestRecordDate: string;
  evidenceNote: string;
};

export function loadMission(raw: unknown = missionJson): MissionConfig {
  const parsed = MissionConfig.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid mission config:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Same rule as the workspace's "All evidence" button: the latest record date, at least the default snapshot. */
export function latestRecordDate(scenario: Scenario): string {
  return [...scenario.observations, ...scenario.interpretations, ...scenario.gaps]
    .map((r) => r.availableFrom)
    .reduce((a, b) => (a > b ? a : b), scenario.defaultSnapshotDate);
}

export function missionContext(
  mission: MissionConfig,
  scenario: Scenario,
  mode: MissionMode = mission.defaultMode,
  replayDate: string = scenario.defaultSnapshotDate,
): MissionContext {
  if (mission.scenarioId !== scenario.id) throw new Error(`Mission ${mission.id} is for scenario ${mission.scenarioId}, not ${scenario.id}`);
  const latest = latestRecordDate(scenario);
  const common = {
    mode,
    missionId: mission.id,
    title: mission.title,
    disclaimer: mission.disclaimer,
    actionFraming: mission.actionFraming,
    caveats: mission.caveats,
    latestRecordDate: latest,
  };
  if (mode === "present-day") {
    return { ...common, evidenceAsOf: latest, evidenceNote: mission.presentDay.evidenceNote.replace("{latestRecordDate}", latest) };
  }
  if (!z.iso.date().safeParse(replayDate).success) throw new RangeError(`Replay date must be an ISO date, got "${replayDate}"`);
  if (replayDate < scenario.minSnapshotDate || replayDate > latest) {
    throw new RangeError(`Replay date ${replayDate} is outside ${scenario.minSnapshotDate} to ${latest}`);
  }
  return { ...common, evidenceAsOf: replayDate, evidenceNote: mission.historicalReplay.evidenceNote.replace("{replayDate}", replayDate) };
}

export type GeoSelection = {
  features: MapFeature[];
  /** Features not shown in this mode, with the reason (for an honest legend). */
  withheld: { id: string; reason: string }[];
};

/**
 * Geographic features for a mission context.
 *  - present-day: every verified feature (full traverse, sample sites,
 *    crater centre, product extents).
 *  - historical replay: only features whose source was public on the replay
 *    date. The traverse is withheld entirely until per-sol filtering exists
 *    (planned for MF-2), because its dataset postdates most replay dates and
 *    covers drives after them.
 */
export function selectGeoFeatures(bundle: GeoBundle, ctx: MissionContext): GeoSelection {
  const features = allFeatures(bundle);
  if (ctx.mode === "present-day") return { features, withheld: [] };

  const date = ctx.evidenceAsOf;
  const shown: MapFeature[] = [];
  const withheld: GeoSelection["withheld"] = [];
  for (const f of features) {
    if (f.kind === "traverse-segment" || f.kind === "rover-last-position") {
      withheld.push({ id: f.id, reason: "The traverse is not shown in historical replay until per-sol filtering is implemented (MF-2)." });
    } else if (f.provenance.availableFrom > date || (f.event?.date !== undefined && f.event.date > date)) {
      withheld.push({ id: f.id, reason: `Published ${f.provenance.availableFrom}, after the replay date ${date}.` });
    } else {
      shown.push(f);
    }
  }
  return { features: shown, withheld };
}
