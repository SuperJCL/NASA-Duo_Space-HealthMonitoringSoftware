/**
 * MAP-3A: verified local terrain (pure: no DOM, no three.js).
 *
 * The data is a bounded crop of the Mars Trek CTX DTM (20 m posts,
 * equirectangular on the Mars 2000 sphere) and the matching CTX orthomosaic,
 * built by scripts/build-ctx-terrain.mjs. Elevations are DTM posts copied
 * unchanged; nothing is interpolated except to place a point between posts.
 *
 * Coordinates:
 *   - lon/lat: degrees, planetocentric latitude, east-positive longitude
 *     (the same convention as src/lib/geo and the 2D map).
 *   - grid: fractional post column/row inside the crop, where post (c, r)
 *     covers [c, c+1) × [r, r+1) and its value sits at its centre.
 *   - local: metres east/north on a tangent plane at the crop centre:
 *     east = Δλ·R·cos φ₀, north = Δφ·R. The DTM grid itself has no cos φ
 *     factor, so this conversion keeps east–west distances true (≈ 5 % at 18.5° N).
 * Geography never affects scores (see CLAUDE.md).
 */
import { z } from "zod";
import meta from "@/data/terrain/ctx-lefroy-bay.json";

export const MARS_RADIUS_M = 3396190;
const DEG = 180 / Math.PI;

const Bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const TerrainMeta = z.object({
  id: z.string(),
  title: z.string(),
  builtBy: z.string(),
  retrievedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dtm: z.object({
    sourceId: z.literal("trek-jezero-ctx-dtm"),
    productLabel: z.string(),
    downloadUrl: z.string().url(),
    metadataUrl: z.string().url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int(),
    format: z.string(),
    crs: z.string(),
    verticalDatum: z.string(),
    postSpacingM: z.literal(20),
    scene: z.object({ cols: z.number().int(), rows: z.number().int(), tiePointM: z.tuple([z.number(), z.number()]), bboxDeg: Bbox }),
    noDataValue: z.number(),
  }),
  crop: z.object({
    col0: z.number().int(),
    row0: z.number().int(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    bboxDeg: Bbox,
    sizeM: z.object({ eastWest: z.number(), northSouth: z.number() }),
    rationale: z.string(),
  }),
  heights: z.object({ file: z.string().startsWith("/terrain/"), encoding: z.string(), minM: z.number(), maxM: z.number(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  imagery: z.object({
    sourceId: z.literal("trek-jezero-ctx-ortho"),
    layer: z.string(),
    tileUrlTemplate: z.string().url(),
    zoom: z.number().int(),
    degPerPx: z.number(),
    tiles: z.number().int(),
    file: z.string().startsWith("/terrain/"),
    width: z.number().int(),
    height: z.number().int(),
    resampling: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  validation: z.object({
    catalogBboxMaxErrorDeg: z.number(),
    pdsSampleSites: z.array(z.object({ id: z.string(), pdsElevationM: z.number(), dtmElevationM: z.number(), differenceM: z.number() })),
    alignment: z.object({
      method: z.string(),
      fittedAzimuthDeg: z.number(),
      bestShiftPosts: z.tuple([z.number().int(), z.number().int()]),
      nccAtBest: z.number(),
      nccAtZero: z.number(),
      interpretation: z.string(),
    }),
  }),
  caveats: z.array(z.string()).min(1),
});
export type TerrainMeta = z.infer<typeof TerrainMeta>;

/** The committed Lefroy Bay terrain metadata, validated at build time. */
export const LEFROY_TERRAIN: TerrainMeta = TerrainMeta.parse(meta);

export type LonLat = readonly [number, number];

/** Fractional grid position (post units) of a lon/lat inside the crop. */
export function lonLatToGrid(m: TerrainMeta, [lon, lat]: LonLat): { col: number; row: number } {
  const [x0, y0] = m.dtm.scene.tiePointM;
  const s = m.dtm.postSpacingM;
  return {
    col: ((lon / DEG) * MARS_RADIUS_M - x0) / s - m.crop.col0,
    row: (y0 - (lat / DEG) * MARS_RADIUS_M) / s - m.crop.row0,
  };
}

/** Lon/lat of a fractional grid position (inverse of lonLatToGrid). */
export function gridToLonLat(m: TerrainMeta, col: number, row: number): [number, number] {
  const [x0, y0] = m.dtm.scene.tiePointM;
  const s = m.dtm.postSpacingM;
  return [(((m.crop.col0 + col) * s + x0) / MARS_RADIUS_M) * DEG, ((y0 - (m.crop.row0 + row) * s) / MARS_RADIUS_M) * DEG];
}

export function cropCentre(m: TerrainMeta): [number, number] {
  const [w, s, e, n] = m.crop.bboxDeg;
  return [(w + e) / 2, (s + n) / 2];
}

/** Metres east/north of the crop centre on a local tangent plane. */
export function lonLatToLocal(m: TerrainMeta, [lon, lat]: LonLat): [east: number, north: number] {
  const [lon0, lat0] = cropCentre(m);
  return [((lon - lon0) / DEG) * MARS_RADIUS_M * Math.cos(lat0 / DEG), ((lat - lat0) / DEG) * MARS_RADIUS_M];
}

export function insideCrop(m: TerrainMeta, [lon, lat]: LonLat): boolean {
  const [w, s, e, n] = m.crop.bboxDeg;
  return lon > w && lon < e && lat > s && lat < n;
}

/**
 * DTM elevation at a lon/lat: bilinear between the four surrounding post
 * centres (clamped at the crop edge). Returns null outside the crop.
 */
export function sampleHeight(m: TerrainMeta, heights: Float32Array, p: LonLat): number | null {
  if (!insideCrop(m, p)) return null;
  const { col, row } = lonLatToGrid(m, p);
  const fc = Math.min(Math.max(col - 0.5, 0), m.crop.cols - 1.000001);
  const fr = Math.min(Math.max(row - 0.5, 0), m.crop.rows - 1.000001);
  const c = Math.floor(fc);
  const r = Math.floor(fr);
  const dx = fc - c;
  const dy = fr - r;
  const h = (cc: number, rr: number) => heights[rr * m.crop.cols + cc];
  return h(c, r) * (1 - dx) * (1 - dy) + h(c + 1, r) * dx * (1 - dy) + h(c, r + 1) * (1 - dx) * dy + h(c + 1, r + 1) * dx * dy;
}

/** Texture coordinates of a lon/lat on the orthoimage (u east, v south; both 0..1 over the crop). */
export function lonLatToUv(m: TerrainMeta, [lon, lat]: LonLat): [u: number, v: number] {
  const [w, s, e, n] = m.crop.bboxDeg;
  return [(lon - w) / (e - w), (n - lat) / (n - s)];
}

export const EXAGGERATIONS = [1, 2, 3] as const;
export type Exaggeration = (typeof EXAGGERATIONS)[number];
/** Requirement: 1× by default; any other value is labelled on screen. */
export const DEFAULT_EXAGGERATION: Exaggeration = 1;

/** Human-readable resolution and source line, shown with the 3D view. */
export function sourceLine(m: TerrainMeta): string {
  return `CTX DTM ${m.dtm.postSpacingM} m posts (${m.dtm.productLabel}), crop ${(m.crop.sizeM.eastWest / 1000).toFixed(1)} × ${(m.crop.sizeM.northSouth / 1000).toFixed(1)} km; imagery CTX orthomosaic 6 m (Mars Trek z${m.imagery.zoom})`;
}
