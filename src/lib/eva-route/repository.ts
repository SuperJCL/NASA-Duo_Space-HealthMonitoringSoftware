// Loader for the simulated EVA route & scouting scenario (server-side or tests). Pure: the JSON
// is bundled; the anchor comes from the verified geo catalog.

import raw from "@/data/prototype/eva-scouting.json";
import type { GeoBundle } from "@/lib/geo/repository";
import type { MapFeature } from "@/lib/geo/features";
import { insideCrop, LEFROY_TERRAIN, type LonLat } from "@/lib/terrain/terrain";
import { parseEvaScouting, resolveScouting, type ResolvedScouting } from "./scenario";

/** Parse and resolve the scenario; every scenario-defined position must lie inside the terrain crop. */
export function loadEvaScouting(geo: GeoBundle): ResolvedScouting {
  const s = parseEvaScouting(raw);
  const anchor = geo.catalog.records.find((r) => r.id === s.anchorId);
  if (!anchor || anchor.kind !== "sample-site") throw new Error(`EVA scouting scenario: anchor ${s.anchorId} is not a verified sample site`);
  const r = resolveScouting(s, anchor.position);
  const points: [string, LonLat][] = [
    ["base", r.base.position],
    ...r.knownAreas.flatMap((a): [string, LonLat][] => (a.kind === "disk" ? [[a.label, a.centre]] : a.kind === "band" ? [[a.label, a.from], [a.label, a.to]] : [])),
    ...r.variants.flatMap((v): [string, LonLat][] => [[`${v.id} rover start`, v.rover.start], ...v.hazards.flatMap((h): [string, LonLat][] => (h.kind === "disk" ? [[h.label, h.centre]] : [[h.label, h.from], [h.label, h.to]]))]),
  ];
  for (const [what, p] of points) if (!insideCrop(LEFROY_TERRAIN, p)) throw new Error(`EVA scouting scenario: ${what} lies outside the terrain crop`);
  return r;
}

/** Perseverance's historical traverse as lon/lat lines, from the same map features the 3D view draws. */
export function traverseLinesOf(features: readonly MapFeature[]): LonLat[][] {
  return features.flatMap((f) => (f.kind === "traverse-segment" && f.geometry.type === "MultiLineString" ? f.geometry.coordinates.map((l) => l.map((p) => [p[0], p[1]] as const)) : []));
}
