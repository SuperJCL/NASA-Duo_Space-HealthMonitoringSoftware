import type { Source } from "@/lib/evidence/schema";
import { formatLonLat } from "@/lib/map/mars-geodesy";
import type { MapFeature } from "./features";
import type { GeoBundle } from "./repository";

/**
 * Plain-language details for a selected map feature (MF-1 context card).
 * Pure: the UI renders these strings as they are. Every value comes from a
 * geographic record or its cited source; nothing is estimated here.
 */
export type FeatureDetails = {
  id: string;
  name: string;
  typeLabel: string;
  layer: MapFeature["layer"];
  facts: { label: string; value: string }[];
  /** Shown prominently (e.g. the last position is not live). */
  warning: string | null;
  convention: { basis: MapFeature["provenance"]["conventionBasis"]; text: string };
  sources: { id: string; title: string; url: string; publishedOn: string }[];
  relatedObservationIds: string[];
};

const INFERRED_SAMPLE =
  "Planetocentric latitude, east-positive longitude: inferred by cross-validation (within 2.5 m of the rover traverse, within 3.6 m of CTX elevation data), not confirmed by complete authoritative coordinate-system metadata. The source prints only “Latitude (N), Longitude (E)”.";
const INFERRED_TRAVERSE =
  "Planetocentric latitude, east-positive longitude: inferred by cross-validation against the PDS sample sites and CTX elevation data. The service states the Mars 2000 frame but not the latitude type.";
const STATED = "Planetocentric latitude, east-positive longitude: stated by the source.";

const fmtM = (m: number) => `${m.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} m`;

export function describeFeature(feature: MapFeature, bundle: GeoBundle, sources: readonly Source[]): FeatureDetails {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const base = {
    id: feature.id,
    layer: feature.layer,
    sources: feature.provenance.sourceIds.flatMap((id) => {
      const s = sourceById.get(id);
      return s ? [{ id, title: s.title, url: s.url, publishedOn: s.publishedOn }] : [];
    }),
    relatedObservationIds: feature.relatedObservationIds,
  };
  const inferred = feature.provenance.conventionBasis === "inferred-cross-validation";

  if (feature.kind === "traverse-segment" || feature.kind === "rover-last-position") {
    const convention = { basis: feature.provenance.conventionBasis, text: inferred ? INFERRED_TRAVERSE : STATED };
    const published = `Dataset published ${bundle.traverseAvailableFrom} (Mars Trek catalog); sols ${bundle.traverse.solRange.join("–")}`;
    if (feature.kind === "rover-last-position") {
      const p = feature.geometry.type === "Point" ? feature.geometry.coordinates : null;
      return {
        ...base,
        name: "Last recorded position in the available dataset",
        typeLabel: "Historical rover position (not live)",
        facts: [
          { label: "Location", value: p ? formatLonLat(p, 5) : "–" },
          { label: "Sol", value: `End of the sol ${feature.event?.sol ?? "?"} drive` },
          { label: "Date", value: "Not stated by the source (only the sol)" },
          { label: "Dataset", value: published },
        ],
        warning:
          "Historical data, not live telemetry and not the rover’s current position. This app has no rover data after this sol.",
        convention,
      };
    }
    const segment = bundle.traverse.segments.find((s) => feature.id === `traverse-sol-${s.sol}-fid-${s.fid}`);
    return {
      ...base,
      name: `Perseverance drive on sol ${feature.event?.sol ?? "?"}`,
      typeLabel: "Historical rover traverse",
      facts: [
        { label: "Sol", value: `Sol ${feature.event?.sol ?? "?"}` },
        { label: "Date", value: "Not stated by the source (only the sol)" },
        { label: "Drive length", value: segment ? `${fmtM(segment.length)} (source attribute)` : "–" },
        { label: "Rover motion counter", value: segment ? `${segment.fromRMC} → ${segment.toRMC}` : "–" },
        { label: "Dataset", value: published },
      ],
      warning: null,
      convention,
    };
  }

  const record = bundle.catalog.records.find((r) => r.id === feature.id);
  if (!record) throw new Error(`No geographic record for feature ${feature.id}`);
  const convention = { basis: feature.provenance.conventionBasis, text: inferred ? INFERRED_SAMPLE : STATED };

  switch (record.kind) {
    case "sample-site":
      return {
        ...base,
        name: record.name,
        typeLabel: "Historical rover sample site",
        facts: [
          { label: "Sample", value: record.designation },
          { label: "Location", value: formatLonLat(record.position, 5) },
          { label: "Elevation", value: `${fmtM(record.elevationM)} (reference surface inferred: Mars areoid)` },
          { label: "Cored", value: `${record.coringDate} (“Date of Coring”), sealed on sol ${record.sealingSol}` },
          { label: "Campaign", value: `${record.campaign} · ${record.regionOfInterest}` },
        ],
        warning: null,
        convention,
      };
    case "crater-centre":
      return {
        ...base,
        name: `${record.name} (centre)`,
        typeLabel: "Reference location",
        facts: [
          { label: "Location", value: formatLonLat(record.position, 2) },
          { label: "Diameter", value: `${record.diameterKm} km` },
        ],
        warning: null,
        convention,
      };
    case "product-extent": {
      const [w, s, e, n] = record.bbox;
      return {
        ...base,
        name: record.title,
        typeLabel: record.product === "orthoimage" ? "Imagery coverage (reference)" : "Elevation-data coverage (reference)",
        facts: [
          { label: "Instrument", value: `MRO ${record.instrument}` },
          { label: "Nominal resolution", value: `${record.nominalResolution.replace(/(\d)(c?m)$/, "$1 $2")} (from the product label)` },
          { label: "Served as", value: record.servedAs === "wmts-tiles" ? "Map tiles (can be shown on this map)" : "Download only (not shown as imagery)" },
          { label: "Extent", value: `${w.toFixed(3)}–${e.toFixed(3)}° E, ${s.toFixed(3)}–${n.toFixed(3)}° N` },
          { label: "Catalog date", value: record.availableFrom },
        ],
        warning: null,
        convention,
      };
    }
  }
}
