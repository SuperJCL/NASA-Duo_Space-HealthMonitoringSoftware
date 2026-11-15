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
import hiriseMeta from "@/data/terrain/hirise-lefroy-bay.json";

export const MARS_RADIUS_M = 3396190;
const DEG = 180 / Math.PI;

const Bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const TerrainMeta = z.object({
  id: z.string(),
  title: z.string(),
  builtBy: z.string(),
  retrievedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dtm: z.object({
    sourceId: z.enum(["trek-jezero-ctx-dtm", "trek-jezero-hirise-dtm"]),
    productLabel: z.string(),
    downloadUrl: z.string().url(),
    metadataUrl: z.string().url(),
    /** Whole-file checksum (CTX: downloaded whole). HiRISE is read with byte ranges: ETag + fetched-rows checksum instead. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    etag: z.string().optional(),
    fetchedRowsSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    alsoServedAt: z.string().url().optional(),
    doi: z.string().url().optional(),
    bytes: z.number().int(),
    format: z.string(),
    crs: z.string(),
    verticalDatum: z.string(),
    /** Post spacing of the SOURCE DTM (m). */
    postSpacingM: z.union([z.literal(20), z.literal(1)]),
    scene: z.object({ cols: z.number().int(), rows: z.number().int(), tiePointM: z.tuple([z.number(), z.number()]), bboxDeg: Bbox }),
    noDataValue: z.number(),
  }),
  crop: z.object({
    col0: z.number().int(),
    row0: z.number().int(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    /** Keep every n-th source post (unchanged); output post k is source post col0 + n·k + ⌊n/2⌋. */
    stride: z.number().int().positive().default(1),
    bboxDeg: Bbox,
    sizeM: z.object({ eastWest: z.number(), northSouth: z.number() }),
    rationale: z.string(),
  }),
  heights: z.object({ file: z.string().startsWith("/terrain/"), encoding: z.string(), minM: z.number(), maxM: z.number(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  imagery: z.object({
    sourceId: z.enum(["trek-jezero-ctx-ortho", "trek-jezero-hirise-ortho"]),
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
    versusCtxCrop: z.object({ posts: z.number().int(), meanM: z.number(), rmsM: z.number(), method: z.string() }).optional(),
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

/**
 * The committed Lefroy Bay CTX terrain (20 m), validated at build time. The EVA route grid and the
 * plan-sequence profiles use it.
 */
export const LEFROY_TERRAIN: TerrainMeta = TerrainMeta.parse(meta);
/**
 * The same area from the HiRISE DTM mosaic (every 5th post of the 1 m DTM → 5 m mesh), built by
 * scripts/build-hirise-terrain.mjs: the default model of the 3D view (sharper relief; closer to the
 * PDS sample-site elevations). See docs/myomars/MAP-DATA-JMARS.md.
 */
export const LEFROY_HIRISE: TerrainMeta = TerrainMeta.parse(hiriseMeta);
/** Spacing of the posts in the crop (m): source spacing × stride (CTX 20 m, HiRISE 5 m). */
export const postSpacing = (m: TerrainMeta) => m.dtm.postSpacingM * m.crop.stride;
export const isHirise = (m: TerrainMeta) => m.dtm.sourceId === "trek-jezero-hirise-dtm";

export type LonLat = readonly [number, number];

/** Fractional grid position (post units) of a lon/lat inside the crop. */
export function lonLatToGrid(m: TerrainMeta, [lon, lat]: LonLat): { col: number; row: number } {
  const [x0, y0] = m.dtm.scene.tiePointM;
  const s = m.dtm.postSpacingM;
  const k = m.crop.stride;
  return {
    col: (((lon / DEG) * MARS_RADIUS_M - x0) / s - m.crop.col0) / k,
    row: ((y0 - (lat / DEG) * MARS_RADIUS_M) / s - m.crop.row0) / k,
  };
}

/** Lon/lat of a fractional grid position (inverse of lonLatToGrid). */
export function gridToLonLat(m: TerrainMeta, col: number, row: number): [number, number] {
  const [x0, y0] = m.dtm.scene.tiePointM;
  const s = m.dtm.postSpacingM;
  const k = m.crop.stride;
  return [(((m.crop.col0 + col * k) * s + x0) / MARS_RADIUS_M) * DEG, ((y0 - (m.crop.row0 + row * k) * s) / MARS_RADIUS_M) * DEG];
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

/** MAP-3A.1: 1× (true scale), and 3× / 5× for low-relief terrain (always labelled). */
export const EXAGGERATIONS = [1, 3, 5] as const;
export type Exaggeration = (typeof EXAGGERATIONS)[number];
/** Requirement: 1× by default; any other value is labelled on screen. */
export const DEFAULT_EXAGGERATION: Exaggeration = 1;

/** Human-readable resolution and source line, shown with the 3D view. */
export function sourceLine(m: TerrainMeta): string {
  const size = `crop ${(m.crop.sizeM.eastWest / 1000).toFixed(1)} × ${(m.crop.sizeM.northSouth / 1000).toFixed(1)} km`;
  return isHirise(m)
    ? `HiRISE DTM, every ${m.crop.stride}th post of the 1 m mosaic = ${postSpacing(m)} m mesh (${m.dtm.productLabel}), ${size}; imagery HiRISE orthomosaic (Mars Trek z${m.imagery.zoom}, ≈ 2.5 m/px)`
    : `CTX DTM ${m.dtm.postSpacingM} m posts (${m.dtm.productLabel}), ${size}; imagery CTX orthomosaic 6 m (Mars Trek z${m.imagery.zoom})`;
}

// ── MAP-3A.1: readable relief from the real DTM (nothing here alters elevations) ──

/** Contour interval drawn on the terrain (metres of true elevation). */
export const CONTOUR_INTERVAL_M = 10;

/**
 * Camera presets, as spherical angles around the orbit target in the viewer's
 * frame (x east, y up, z south): azimuth 0° = camera to the south looking
 * north, 90° = camera to the east looking west. Polar 0° = straight down.
 */
export const CAMERA_PRESETS = {
  overview: { label: "Overview", azimuthDeg: -20, polarDeg: 30, distanceM: 3600 },
  oblique: { label: "Oblique", azimuthDeg: -30, polarDeg: 55, distanceM: 3000 },
  lowEast: { label: "Low angle from the east", azimuthDeg: 95, polarDeg: 80, distanceM: 2300 },
  lowSouth: { label: "Low angle from the south", azimuthDeg: 5, polarDeg: 80, distanceM: 2300 },
} as const;
export type CameraPreset = keyof typeof CAMERA_PRESETS;

export type ProfileSample = { distanceM: number; lon: number; lat: number; elevationM: number };
export type Profile = {
  from: LonLat;
  to: LonLat;
  /** Straight-line (tangent-plane) length of the sampling line. */
  lengthM: number;
  samples: ProfileSample[];
  startM: number;
  endM: number;
  minM: number;
  maxM: number;
  netChangeM: number;
};

/**
 * MAP-3A.1: real-DTM elevation profile along a STRAIGHT sampling line
 * between two points inside the crop (not a route). Sampled every `stepM`
 * metres by bilinear interpolation between 20 m posts.
 */
export function profileAlong(m: TerrainMeta, heights: Float32Array, from: LonLat, to: LonLat, stepM = 10): Profile | null {
  if (!insideCrop(m, from) || !insideCrop(m, to)) return null;
  const [e0, n0] = lonLatToLocal(m, from);
  const [e1, n1] = lonLatToLocal(m, to);
  const lengthM = Math.hypot(e1 - e0, n1 - n0);
  const k = Math.max(1, Math.ceil(lengthM / stepM));
  const samples: ProfileSample[] = [];
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    const lon = from[0] + t * (to[0] - from[0]);
    const lat = from[1] + t * (to[1] - from[1]);
    const h = sampleHeight(m, heights, [lon, lat]);
    if (h === null) return null;
    samples.push({ distanceM: t * lengthM, lon, lat, elevationM: h });
  }
  const els = samples.map((x) => x.elevationM);
  return {
    from,
    to,
    lengthM,
    samples,
    startM: els[0],
    endM: els[els.length - 1],
    minM: Math.min(...els),
    maxM: Math.max(...els),
    netChangeM: els[els.length - 1] - els[0],
  };
}

export type ReliefSummary = {
  cropMinM: number;
  cropMaxM: number;
  cropReliefM: number;
  /** Mean elevation of the western and eastern thirds of the crop. */
  westMeanM: number;
  eastMeanM: number;
  /** Slope over a 100 m baseline (the DTM's effective resolution is a few posts): median and 90th percentile, degrees. */
  slopeMedianDeg: number;
  slopeP90Deg: number;
  /** Elevation variation (max − min) within these radii of the reference point. */
  local: { radiusM: number; reliefM: number }[];
};

/** MAP-3A.1: how much relief the DTM really has here, computed from the posts (for an honest statement). */
export function reliefSummary(m: TerrainMeta, heights: Float32Array, reference: LonLat, radii: readonly number[] = [150, 300, 1000]): ReliefSummary {
  const N = m.crop.cols;
  const rows = m.crop.rows;
  const [, s, , n] = m.crop.bboxDeg;
  const ew = postSpacing(m) * Math.cos(((s + n) / 2) / DEG);
  const ns = postSpacing(m);
  const at = (c: number, r: number) => heights[r * N + c];
  let min = Infinity;
  let max = -Infinity;
  let west = 0;
  let wk = 0;
  let east = 0;
  let ek = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < N; c++) {
      const v = at(c, r);
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (c < N / 3) {
        west += v;
        wk++;
      } else if (c >= (2 * N) / 3) {
        east += v;
        ek++;
      }
    }
  const B = 5; // 5 posts each side → 100 m baseline in N–S
  const slopes: number[] = [];
  for (let r = B; r < rows - B; r++)
    for (let c = B; c < N - B; c++) {
      const gx = (at(c + B, r) - at(c - B, r)) / (2 * B * ew);
      const gy = (at(c, r - B) - at(c, r + B)) / (2 * B * ns);
      slopes.push(Math.atan(Math.hypot(gx, gy)) * DEG);
    }
  slopes.sort((a, b) => a - b);
  const local = radii.map((radiusM) => ({ radiusM, reliefM: localRange(m, heights, reference, radiusM).reliefM }));
  return {
    cropMinM: min,
    cropMaxM: max,
    cropReliefM: max - min,
    westMeanM: west / wk,
    eastMeanM: east / ek,
    slopeMedianDeg: slopes[Math.floor(0.5 * (slopes.length - 1))],
    slopeP90Deg: slopes[Math.floor(0.9 * (slopes.length - 1))],
    local,
  };
}

/**
 * MAP-2: whether a straight connection lies inside the DTM crop. The crop is
 * a lon/lat rectangle (equirectangular), so a straight line between two
 * inside points stays inside; anything else is "outside" and gets no 3D line
 * and no profile (never extrapolated elevations).
 */
export function segmentCoverage(m: TerrainMeta, from: LonLat, to: LonLat): "inside" | "outside" {
  return insideCrop(m, from) && insideCrop(m, to) ? "inside" : "outside";
}

/** The same finding in one short sentence, for narrow screens. */
export function reliefHeadline(r: ReliefSummary, referenceName: string): string {
  const mid = r.local.find((x) => x.radiusM === 300)?.reliefM;
  return `Relief is real but modest: ${Math.round(r.cropReliefM)} m across the crop${mid !== undefined ? `, about ${Math.round(mid)} m within 300 m of ${referenceName}` : ""}; nearly flat at 1× near the targets.`;
}

/** Lowest and highest DTM posts within `radiusM` of a point (posts outside the crop are not available). */
export function localRange(m: TerrainMeta, heights: Float32Array, centre: LonLat, radiusM: number): { minM: number; maxM: number; reliefM: number } {
  const N = m.crop.cols;
  const [, s, , n] = m.crop.bboxDeg;
  const ew = postSpacing(m) * Math.cos(((s + n) / 2) / DEG);
  const ns = postSpacing(m);
  const g = lonLatToGrid(m, centre);
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0; r < m.crop.rows; r++)
    for (let c = 0; c < N; c++)
      if (Math.hypot((c + 0.5 - g.col) * ew, (r + 0.5 - g.row) * ns) <= radiusM) {
        lo = Math.min(lo, heights[r * N + c]);
        hi = Math.max(hi, heights[r * N + c]);
      }
  return { minM: lo, maxM: hi, reliefM: hi - lo };
}

/** One plain statement of the relief, for the viewer (numbers from reliefSummary). */
export function reliefStatement(r: ReliefSummary, referenceName: string): string {
  const fall = r.westMeanM - r.eastMeanM;
  const l = (rad: number) => r.local.find((x) => x.radiusM === rad)?.reliefM;
  const near = l(150);
  const mid = l(300);
  return [
    `Relief is real but modest: ${Math.round(r.cropReliefM)} m across this 3 km crop (${fall >= 0 ? "falling" : "rising"} about ${Math.abs(Math.round(fall))} m from west to east; median slope ${r.slopeMedianDeg.toFixed(1)}°, 90 % below ${r.slopeP90Deg.toFixed(1)}°).`,
    near !== undefined && mid !== undefined
      ? `Around ${referenceName} and the targets it varies by only about ${Math.round(near)} m within 150 m and ${Math.round(mid)} m within 300 m, so at 1× (true scale) it looks nearly flat.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
