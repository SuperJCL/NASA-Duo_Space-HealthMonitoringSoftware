import { z } from "zod";
import { Citation, IsoDate, RecordId } from "@/lib/evidence/schema";

/**
 * Zod schemas for geographic records (MF-0).
 *
 * Geographic records describe WHERE verified things are or happened: sample
 * sites, the rover traverse, the crater centre and data-product extents.
 * They are deliberately separate from the scientific scenario:
 *  - they are never inputs to the decision engine;
 *  - they never reference candidate tasks (tasks are methods, not places, and
 *    have no coordinates).
 *
 * Positions are [longitude, latitude] in degrees on Mars. Every record names
 * the coordinate convention it uses, and says whether that convention is
 * stated by the source or inferred by cross-validation (docs/GEO_DATA.md).
 */

const Longitude = z.number().min(-180).max(360);
const Latitude = z.number().min(-90).max(90);
export const LonLat = z.tuple([Longitude, Latitude]);
/** [west, south, east, north] in degrees. */
export const BBox = z
  .tuple([Longitude, Latitude, Longitude, Latitude])
  .refine(([w, s, e, n]) => w < e && s < n, { message: "bbox must be [west, south, east, north]" });

export const ConventionBasis = z.enum(["stated", "inferred-cross-validation"]);

export const CoordinateConvention = z
  .object({
    id: RecordId,
    frame: z.string().min(1),
    latitude: z.enum(["planetocentric", "planetographic"]),
    longitude: z.enum(["east-positive", "west-positive"]),
    basis: ConventionBasis,
    note: z.string().min(1).optional(),
    citations: z.array(Citation).min(1),
  })
  .strict()
  .refine((c) => c.basis === "stated" || Boolean(c.note), {
    message: "an inferred convention must explain the inference in `note`",
  });

/** Which map layer a record belongs to. Simulated actions have no geometry, so they have no layer here. */
export const GeoLayer = z.enum(["historical-rover", "reference"]);

const base = {
  id: RecordId,
  conventionId: RecordId,
  citations: z.array(Citation).min(1),
  /** Publication date of the latest cited source (same rule as evidence records). */
  availableFrom: IsoDate,
};

export const CraterCentre = z
  .object({
    ...base,
    kind: z.literal("crater-centre"),
    layer: z.literal("reference"),
    name: z.string().min(1),
    position: LonLat,
    diameterKm: z.number().positive(),
  })
  .strict();

export const SampleSite = z
  .object({
    ...base,
    kind: z.literal("sample-site"),
    layer: z.literal("historical-rover"),
    name: z.string().min(1),
    /** Sample designation exactly as printed by the source. */
    designation: z.string().min(1),
    /** "Date of Coring" as printed by the source. */
    coringDate: IsoDate,
    /** Sol in "Mars Time of Sample Core Sealing", as printed by the source. */
    sealingSol: z.number().int().nonnegative(),
    campaign: z.string().min(1),
    regionOfInterest: z.string().min(1),
    position: LonLat,
    /** Elevation as printed; its reference surface is inferred (see the convention). */
    elevationM: z.number(),
    /** Observations whose citations name this sample (checked by an integrity rule). */
    relatedObservationIds: z.array(RecordId),
  })
  .strict();

export const ProductExtent = z
  .object({
    ...base,
    kind: z.literal("product-extent"),
    layer: z.literal("reference"),
    title: z.string().min(1),
    productLabel: z.string().min(1),
    product: z.enum(["orthoimage", "elevation-model"]),
    instrument: z.enum(["CTX", "HiRISE"]),
    /** Resolution as it appears in the product label (e.g. "20m"); not a measured effective resolution. */
    nominalResolution: z.string().regex(/^\d+(cm|m)$/),
    /** How Mars Trek serves the product (verified 2026-11-05). */
    servedAs: z.enum(["wmts-tiles", "download-only"]),
    /** Key in TREK_LAYERS when the product is already a map layer. */
    trekLayerKey: z.string().min(1).optional(),
    bbox: BBox,
  })
  .strict();

export const GeoRecord = z.discriminatedUnion("kind", [CraterCentre, SampleSite, ProductExtent]);

export const CrossValidationCheck = z
  .object({ id: RecordId, description: z.string().min(1), result: z.string().min(1), threshold: z.string().min(1) })
  .strict();

export const GeoCatalog = z
  .object({
    scenarioId: RecordId,
    conventions: z.array(CoordinateConvention).min(1),
    crossValidation: z
      .object({
        checkedOn: IsoDate,
        reproduce: z.string().min(1),
        reasoning: z.string().min(1),
        checks: z.array(CrossValidationCheck).min(1),
      })
      .strict(),
    records: z.array(GeoRecord).min(1),
  })
  .strict();

/** One traverse segment as served by Mars Trek (one feature per drive). */
export const TraverseSegment = z
  .object({
    fid: z.number().int().nonnegative(),
    sol: z.number().int().nonnegative(),
    /** Rover motion counters (site_drive), as served; a few are malformed in the source. */
    fromRMC: z.string().min(1),
    toRMC: z.string().min(1),
    /** Source attribute `length`; metres inferred (see `attributes.lengthUnit`). */
    length: z.number().nonnegative(),
    lines: z.array(z.array(LonLat).min(2)).min(1),
  })
  .strict();

export const Traverse = z
  .object({
    id: RecordId,
    sourceId: RecordId,
    service: z.url(),
    retrievedOn: IsoDate,
    crs: z
      .object({
        serviceSpatialReference: z.string().min(1),
        geojsonLabel: z.string().nullable(),
        interpretation: z.string().min(1),
        conventionBasis: ConventionBasis,
      })
      .strict(),
    attributes: z.object({ kept: z.array(z.string()), dropped: z.array(z.string()), lengthUnit: z.string() }).strict(),
    lengthCheck: z
      .object({
        sumOfLengthAttribute: z.number(),
        geometricLengthOfSourceM: z.number(),
        geometricLengthOfSimplifiedM: z.number(),
        note: z.string().min(1),
      })
      .strict(),
    simplification: z
      .object({
        method: z.string(),
        toleranceM: z.number().positive(),
        maxDeviationM: z.number().nonnegative(),
        sourceVertexCount: z.number().int().positive(),
        vertexCount: z.number().int().positive(),
      })
      .strict(),
    segmentCount: z.number().int().positive(),
    solRange: z.tuple([z.number().int(), z.number().int()]),
    segments: z.array(TraverseSegment).min(1),
  })
  .strict();

export type LonLat = z.infer<typeof LonLat>;
export type ConventionBasis = z.infer<typeof ConventionBasis>;
export type BBox = z.infer<typeof BBox>;
export type CoordinateConvention = z.infer<typeof CoordinateConvention>;
export type GeoRecord = z.infer<typeof GeoRecord>;
export type SampleSite = z.infer<typeof SampleSite>;
export type CraterCentre = z.infer<typeof CraterCentre>;
export type ProductExtent = z.infer<typeof ProductExtent>;
export type GeoCatalog = z.infer<typeof GeoCatalog>;
export type Traverse = z.infer<typeof Traverse>;
export type TraverseSegment = z.infer<typeof TraverseSegment>;
