# NASA Mars Trek WMTS + OpenLayers — research notes

Last verified: **2026-11-04, against the live Trek services** (after
`trek.nasa.gov` was allowed in the environment's network policy).

Labels:
- **[LIVE]** — checked against the live service on that date.
- **[V-code]** — read in library source.
- **[UNVERIFIED]** — not confirmed.

## Sources

- Capabilities: `https://trek.nasa.gov/tiles/Mars/EQ/<LayerId>/1.0.0/WMTSCapabilities.xml`
- Catalog search API (titles, mission, instrument, descriptions, nomenclature):
  `https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?proj=urn:ogc:def:crs:EPSG::104905&start=0&rows=40&key=<term>`
- Archived 2023 capabilities copies:
  https://github.com/blitheli/ImageTileLayerConfig-Mars (commit a3f30a2).
  The live files for all four layers below are **byte-identical** to these.
- ESRI:104905 (GCS_Mars_2000):
  https://github.com/OSGeo/PROJ-CRS-Explorer/blob/main/wkt1/ESRI/104905.txt
- OpenLayers source, `ol@10.11.0`: `ol/proj.js`, `ol/source/ImageTile.js`,
  `ol/tilegrid/WMTS.js`.

## Service facts [LIVE]

### Tiles and URLs

- **Encoding:** RESTful only. The capabilities template is
  `…/<LayerId>/1.0.0//{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.<ext>`.
- **Slash in the path:** a single slash after `1.0.0` returns the same bytes as
  the double slash. The app uses the single-slash form.
- **Style and matrix set:** Style `default`, TileMatrixSet `default028mm`.
- **Grid:**
  - Origin is the top-left corner (-180, 90). Tiles are 256 px.
  - Level 0 is 2×1 tiles at 0.703125°/px. Resolution halves per level.
  - Scale denominators assume an Earth-sized sphere.

### CRS and coordinates

- **CRS:** `urn:ogc:def:crs:EPSG::104905`, which is really ESRI GCS_Mars_2000.
  Regional products state a `Mars_2000_Sphere_IAU` sphere with a 3,396,190 m radius.
- **Longitude:** east-positive, in the range -180..180.

### HTTP behaviour

- **CORS:** responses send `Access-Control-Allow-Origin: *`, so
  `ol/source/ImageTile` (which sets `crossOrigin="anonymous"`) works, and the
  canvas stays exportable.
- **No `Cache-Control` header** was observed on tile responses.
- **Outside a regional extent:** HTTP 404 (text/html). Example:
  `JEZ_ctx…/10/100/100.png`.

## Layers used by the app [LIVE]

| Key | Trek ID | Catalog title | Mission / instrument | Format | Levels | BoundingBox (W, S, E, N) |
|---|---|---|---|---|---|---|
| viking | `Mars_Viking_MDIM21_ClrMosaic_global_232m` | Viking VIS, Global Color Mosaic | Viking / MDIM21 | jpg | 0–7 | -180, -90, 180, 90 |
| mola | `Mars_MGS_MOLA_ClrShade_merge_global_463m` | MGS MOLA, Global Color Hillshade | Mars Global Surveyor / MOLA | jpg | 0–7 | -180, -89.9991635, 179.9983271, 90 |
| jezeroCtx | `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` | MRO CTX, Jezero Mosaic, Controlled | MRO / CTX | png | 0–13 | 77.1604655, 18.2110274, 77.6991776, 18.7211945 |
| jezeroHirise | `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` | MRO HiRISE, Jezero Mosaic, Controlled | MRO / HiRISE | png | 0–17 | 77.2229331, 18.3067994, 77.583964, 18.669315 |

The catalog descriptions say the CTX and HiRISE Jezero mosaics were produced
for Mars 2020 Terrain Relative Navigation by USGS Astrogeology. HiRISE was
also used as the hazard-map basemap.

Other Jezero products in the catalog, possibly useful later:
- `JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0` (CTX DEM)
- `JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40` (HiRISE DEM)
- `Jezero_CTX_BlockAdj_dd` (preliminary CTX mosaic over a wider area)
- `Perseverance_Traverse_Path` (rover traverse; candidate for the retrospective
  "reveal later" view)

**Avoid:** layer IDs such as `Jezero_HiRISE_Mosaic` and
`Mars_MRO_CTX_Jezero_mosaic_6m`. They appear in some hackathon repos but not in
Trek's catalog.

## Coordinates: discrepancy resolved (M2, 2026-11-04)

- **Trek nomenclature index, "Jezero" [LIVE]:** `POINT (77.68734927 18.4082)`.
- **USGS Gazetteer, Feature 14300 [LIVE]:**
  https://planetarynames.wr.usgs.gov/Feature/14300
  - MDIM 2.1 control network (the default): centre 18.41° N, 77.69° E;
    diameter 47.52 km; "Planetocentric, +East, 0 - 360".
  - The older MDIM 2.0 network gives 18.21° N, 77.62° E and 49.00 km.
- **Conclusion:** Trek's point matches the Gazetteer's MDIM 2.1 centre. The
  commonly quoted 18.38° N, 77.58° E did not come from either source checked
  here.
- **How the app uses this:** the site description cites the Gazetteer. The map
  still fits the CTX product extent and draws no crater-centre marker.
- **Possible M3 layer:** the Gazetteer page includes a crater-outline WKT
  polygon.

## OpenLayers implications [V-code, confirmed by tests]

1. **Do not use `optionsFromCapabilities`.** It throws on the `EPSG::104905`
   CRS. Even with a Mars `metersPerUnit`, it would also convert the
   Earth-based scale denominators into wrong degree resolutions. Build the tile
   grid by hand instead (`src/lib/map/create-trek-source.ts`):
   - origin `[-180, 90]`
   - resolutions `0.703125/2^z`
   - 256 px tiles
   - `extent` set to the layer BoundingBox, so no 404 requests outside
     regional mosaics.
2. **Supply Mars geodesy to the projection.** Without its own
   `getPointResolution`, a degree projection measures on a 6,371,008.8 m Earth
   sphere, and the scale line reads about 1.88× too long.
   `src/lib/map/mars-projection.ts` supplies Mars `metersPerUnit` and an
   east–west `getPointResolution`. A unit test asserts about 56 m/px at
   0.001°/px and 18.4°N.
3. **Pass the Mars radius to future measurement tools:**
   `ol/sphere.getLength`/`getArea` with `radius: 3396190`.

## Still unverified

- **Official attribution wording.** The app currently credits "NASA Mars Trek"
  plus the catalog title, mission and instrument.
- **Service SLA / rate limits** for a public demo.
