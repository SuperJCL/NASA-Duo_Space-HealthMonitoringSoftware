/**
 * NASA Mars Trek layer catalog (pure data, no OpenLayers imports).
 *
 * Every value below was read from the live Trek services on 2026-11-04:
 *   - WMTSCapabilities.xml:
 *     https://trek.nasa.gov/tiles/Mars/EQ/<id>/1.0.0/WMTSCapabilities.xml
 *     (format, highest TileMatrix, BoundingBox, tile grid)
 *   - Trek catalog search API:
 *     https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?proj=urn:ogc:def:crs:EPSG::104905&key=<id>
 *     (title, mission, instrument)
 * See docs/NASA_MAP_RESEARCH.md. Do not add layers without the same checks.
 */

export const TREK_TILE_HOST = "https://trek.nasa.gov/tiles/Mars/EQ";

/**
 * The `default028mm` TileMatrixSet shared by all Trek Mars EQ layers:
 * top-left origin (-180, 90), 256 px tiles, 2×1 tiles at level 0, and the
 * resolution halving at each level.
 *
 * The capabilities' ScaleDenominators assume an Earth-sized sphere, so the
 * grid is defined here in degrees instead of being parsed from them.
 */
export const TREK_EQ_TILE_GRID = {
  tileSize: 256,
  origin: [-180, 90] as const,
  extent: [-180, -90, 180, 90] as const,
  level0DegreesPerPixel: 180 / 256, // 0.703125
} as const;

export type Extent = readonly [west: number, south: number, east: number, north: number];

export type TrekLayerRole = "basemap" | "overlay";

export interface TrekLayer {
  /** Trek product identifier (URL path segment). */
  id: string;
  /** Title as listed in the Trek catalog. */
  title: string;
  role: TrekLayerRole;
  mission: string;
  instrument: string;
  format: "jpg" | "png";
  /** Highest TileMatrix identifier in the layer's capabilities. */
  maxNativeZoom: number;
  /** Layer BoundingBox from capabilities (degrees, Mars 2000 sphere). */
  extent: Extent;
}

export const TREK_LAYERS = {
  viking: {
    id: "Mars_Viking_MDIM21_ClrMosaic_global_232m",
    title: "Viking VIS, Global Color Mosaic",
    role: "basemap",
    mission: "Viking",
    instrument: "MDIM21",
    format: "jpg",
    maxNativeZoom: 7,
    extent: [-180, -90, 180, 90],
  },
  mola: {
    id: "Mars_MGS_MOLA_ClrShade_merge_global_463m",
    title: "MGS MOLA, Global Color Hillshade",
    role: "basemap",
    mission: "Mars Global Surveyor",
    instrument: "MOLA",
    format: "jpg",
    maxNativeZoom: 7,
    extent: [-180, -89.9991635, 179.9983271, 90],
  },
  jezeroCtx: {
    id: "JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0",
    title: "MRO CTX, Jezero Mosaic, Controlled",
    role: "overlay",
    mission: "Mars Reconnaissance Orbiter",
    instrument: "CTX",
    format: "png",
    maxNativeZoom: 13,
    extent: [77.1604655, 18.2110274, 77.6991776, 18.7211945],
  },
  jezeroHirise: {
    id: "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd",
    title: "MRO HiRISE, Jezero Mosaic, Controlled",
    role: "overlay",
    mission: "Mars Reconnaissance Orbiter",
    instrument: "HiRISE",
    format: "png",
    maxNativeZoom: 17,
    extent: [77.2229331, 18.3067994, 77.583964, 18.669315],
  },
} as const satisfies Record<string, TrekLayer>;

export type TrekLayerKey = keyof typeof TREK_LAYERS;

export const BASEMAP_KEYS = ["viking", "mola"] as const satisfies readonly TrekLayerKey[];
export type BasemapKey = (typeof BASEMAP_KEYS)[number];

export const OVERLAY_KEYS = ["jezeroCtx", "jezeroHirise"] as const satisfies readonly TrekLayerKey[];
export type OverlayKey = (typeof OVERLAY_KEYS)[number];

export const DEFAULT_BASEMAP: BasemapKey = "viking";
export const DEFAULT_OVERLAYS: readonly OverlayKey[] = ["jezeroCtx"];

/**
 * RESTful WMTS tile URL template using OpenLayers XYZ placeholders.
 * {z} = TileMatrix, {y} = TileRow (from the top), {x} = TileCol.
 * The capabilities' template contains "1.0.0//"; a single slash returns
 * identical bytes (verified 2026-11-04) and is used here.
 */
export function trekTileUrlTemplate(layer: TrekLayer): string {
  return `${TREK_TILE_HOST}/${layer.id}/1.0.0/default/default028mm/{z}/{y}/{x}.${layer.format}`;
}

export function trekCapabilitiesUrl(layer: TrekLayer): string {
  return `${TREK_TILE_HOST}/${layer.id}/1.0.0/WMTSCapabilities.xml`;
}

/** Degrees-per-pixel resolutions for TileMatrix 0..maxZoom. */
export function trekResolutions(maxZoom: number): number[] {
  return Array.from(
    { length: maxZoom + 1 },
    (_, z) => TREK_EQ_TILE_GRID.level0DegreesPerPixel / 2 ** z,
  );
}

/** Attribution HTML shown by OpenLayers (static, trusted string). */
export function trekAttribution(layer: TrekLayer): string {
  return `<a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener noreferrer">NASA Mars Trek</a>: ${layer.title} (${layer.mission} ${layer.instrument})`;
}
