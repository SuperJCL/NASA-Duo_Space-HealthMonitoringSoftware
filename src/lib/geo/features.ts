import { bboxRing } from "./geometry";
import type { GeoBundle } from "./repository";
import type { ConventionBasis, GeoRecord, LonLat, Traverse } from "./schema";

/**
 * Render-neutral map features (MF-0 adapters). The same list can feed the
 * OpenLayers map (via `toGeoJson`) and, later, a 3D view. Geometry is in Mars
 * degrees [lon, lat]; nothing here assumes Earth coordinates.
 *
 * Only verified geographic records become features. Simulated mission
 * actions (the candidate tasks) have no coordinates, so they never appear
 * here.
 */

export type FeatureKind = "sample-site" | "traverse-segment" | "rover-last-position" | "crater-centre" | "product-extent";

export type FeatureGeometry =
  | { type: "Point"; coordinates: LonLat }
  | { type: "MultiLineString"; coordinates: LonLat[][] }
  | { type: "Polygon"; coordinates: LonLat[][] };

export type MapFeature = {
  id: string;
  layer: "historical-rover" | "reference";
  kind: FeatureKind;
  geometry: FeatureGeometry;
  /** Short name for map labels and lists. */
  name: string;
  /** Longer, user-facing label. Historical rover items always say so. */
  label: string;
  provenance: {
    sourceIds: string[];
    /** Publication date of the latest cited source. */
    availableFrom: string;
    conventionId: string;
    conventionBasis: ConventionBasis;
  };
  /** When the depicted rover activity happened, as stated by the source. */
  event?: { sol?: number; date?: string };
  relatedObservationIds: string[];
};

/** Convention id used for traverse-derived features (see jezero-geo.json). */
export const TRAVERSE_CONVENTION_ID = "trek-traverse-mars2000";

export function recordToFeature(record: GeoRecord, bundle: GeoBundle): MapFeature {
  const convention = bundle.catalog.conventions.find((c) => c.id === record.conventionId);
  if (!convention) throw new Error(`Unknown convention ${record.conventionId}`);
  const provenance = {
    sourceIds: [...new Set(record.citations.map((c) => c.sourceId))],
    availableFrom: record.availableFrom,
    conventionId: convention.id,
    conventionBasis: convention.basis,
  };
  switch (record.kind) {
    case "sample-site":
      return {
        id: record.id,
        layer: "historical-rover",
        kind: "sample-site",
        geometry: { type: "Point", coordinates: record.position },
        name: record.name,
        label: `Sample ${record.designation} (historical, cored ${record.coringDate})`,
        provenance,
        event: { sol: record.sealingSol, date: record.coringDate },
        relatedObservationIds: record.relatedObservationIds,
      };
    case "crater-centre":
      return {
        id: record.id,
        layer: "reference",
        kind: "crater-centre",
        geometry: { type: "Point", coordinates: record.position },
        name: `${record.name} centre`,
        label: `${record.name} centre (USGS Gazetteer)`,
        provenance,
        relatedObservationIds: [],
      };
    case "product-extent":
      return {
        id: record.id,
        layer: "reference",
        kind: "product-extent",
        geometry: { type: "Polygon", coordinates: [bboxRing(record.bbox)] },
        name: `${record.instrument} ${record.product === "orthoimage" ? "imagery" : "elevation data"} extent`,
        label: `${record.title}: coverage extent`,
        provenance,
        relatedObservationIds: [],
      };
  }
}

const traverseProvenance = (bundle: GeoBundle) => {
  const convention = bundle.catalog.conventions.find((c) => c.id === TRAVERSE_CONVENTION_ID);
  if (!convention) throw new Error(`Unknown convention ${TRAVERSE_CONVENTION_ID}`);
  return {
    sourceIds: [bundle.traverse.sourceId],
    availableFrom: bundle.traverseAvailableFrom,
    conventionId: convention.id,
    conventionBasis: convention.basis,
  };
};

/** One feature per traverse segment (drive), so each keeps its sol. */
export function traverseFeatures(bundle: GeoBundle): MapFeature[] {
  const provenance = traverseProvenance(bundle);
  return bundle.traverse.segments.map((s) => ({
    id: `traverse-sol-${s.sol}-fid-${s.fid}`,
    layer: "historical-rover" as const,
    kind: "traverse-segment" as const,
    geometry: { type: "MultiLineString" as const, coordinates: s.lines },
    name: `Sol ${s.sol}`,
    label: `Perseverance drive, sol ${s.sol} (historical)`,
    provenance,
    event: { sol: s.sol },
    relatedObservationIds: [],
  }));
}

/** The final segment of the dataset: unique by an integrity rule. */
export function finalSegment(traverse: Traverse) {
  const lastSol = traverse.solRange[1];
  const segment = traverse.segments.find((s) => s.sol === lastSol);
  if (!segment) throw new Error("Traverse has no segment on its final sol");
  return segment;
}

/**
 * The end point of the last drive in the available dataset. This is NOT a
 * live or current rover position, and the label says so.
 */
export function roverLastPositionFeature(bundle: GeoBundle): MapFeature {
  const segment = finalSegment(bundle.traverse);
  const lastLine = segment.lines[segment.lines.length - 1];
  return {
    id: "rover-last-position-in-dataset",
    layer: "historical-rover",
    kind: "rover-last-position",
    geometry: { type: "Point", coordinates: lastLine[lastLine.length - 1] },
    name: `Last position in dataset (sol ${segment.sol})`,
    label: `Last position in the available dataset: end of the sol ${segment.sol} drive (historical data; not a live or current position)`,
    provenance: traverseProvenance(bundle),
    event: { sol: segment.sol },
    relatedObservationIds: [],
  };
}

/** Every verified feature, without any time filtering. */
export function allFeatures(bundle: GeoBundle): MapFeature[] {
  return [...bundle.catalog.records.map((r) => recordToFeature(r, bundle)), ...traverseFeatures(bundle), roverLastPositionFeature(bundle)];
}

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    geometry: FeatureGeometry;
    properties: {
      layer: MapFeature["layer"];
      kind: FeatureKind;
      name: string;
      label: string;
      availableFrom: string;
      conventionBasis: MapFeature["provenance"]["conventionBasis"];
      sol: number | null;
    };
  }[];
};

/**
 * Plain GeoJSON for map libraries. Coordinates are Mars degrees: read them
 * with the Mars projection as the data projection, never as EPSG:4326.
 */
export function toGeoJson(features: readonly MapFeature[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      id: f.id,
      geometry: f.geometry,
      properties: {
        layer: f.layer,
        kind: f.kind,
        name: f.name,
        label: f.label,
        availableFrom: f.provenance.availableFrom,
        conventionBasis: f.provenance.conventionBasis,
        sol: f.event?.sol ?? null,
      },
    })),
  };
}
