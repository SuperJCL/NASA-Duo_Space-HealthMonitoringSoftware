import type { FeatureKind, MapFeature } from "@/lib/geo/features";

/**
 * Map layer groups for geographic features (MF-1). Pure configuration: no
 * OpenLayers imports, so it stays unit-testable. Order is bottom → top.
 *
 * There is deliberately no layer for simulated observation actions: they have
 * no verified location.
 */
export const GEO_LAYERS = [
  { key: "extents", kinds: ["product-extent"], group: "reference", label: "Imagery and elevation-data extents", defaultVisible: false },
  { key: "traverse", kinds: ["traverse-segment"], group: "historical-rover", label: "Perseverance traverse", defaultVisible: true },
  { key: "craterCentre", kinds: ["crater-centre"], group: "reference", label: "Jezero crater centre", defaultVisible: true },
  { key: "samples", kinds: ["sample-site"], group: "historical-rover", label: "Rover sample sites (PDS)", defaultVisible: true },
  { key: "lastPosition", kinds: ["rover-last-position"], group: "historical-rover", label: "Last position in the dataset", defaultVisible: true },
] as const satisfies readonly { key: string; kinds: readonly FeatureKind[]; group: MapFeature["layer"]; label: string; defaultVisible: boolean }[];

export type GeoLayerKey = (typeof GEO_LAYERS)[number]["key"];

export function geoLayerFor(kind: FeatureKind): GeoLayerKey {
  const layer = GEO_LAYERS.find((l) => (l.kinds as readonly FeatureKind[]).includes(kind));
  if (!layer) throw new Error(`No map layer for feature kind ${kind}`);
  return layer.key;
}

/** Click priority when features overlap: points first, then lines, then outlines. */
export const SELECTION_PRIORITY: readonly FeatureKind[] = [
  "rover-last-position",
  "sample-site",
  "crater-centre",
  "traverse-segment",
  "product-extent",
];

export function pickFeature<T extends { kind: FeatureKind }>(hits: readonly T[]): T | null {
  let best: T | null = null;
  for (const h of hits) {
    if (!best || SELECTION_PRIORITY.indexOf(h.kind) < SELECTION_PRIORITY.indexOf(best.kind)) best = h;
  }
  return best;
}
