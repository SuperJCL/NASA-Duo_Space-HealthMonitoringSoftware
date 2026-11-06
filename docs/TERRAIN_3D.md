# MAP-3A: local 3D terrain from the verified CTX DTM

The planning map in Mission Glass has a **2D map | 3D terrain** switch. The 3D
view shows a bounded crop of the **real Jezero CTX elevation model** (not
imagery brightness), draped with the matching CTX orthomosaic. It shows:
- the verified sample sites and the verified rover traverse, in cyan;
- the scenario-defined targets, in coral.

It is **not** a route, travel-time, traversability or safety model.

## Data and provenance

| | Value |
|---|---|
| **Elevation source** | Mars Trek `JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0` (source `trek-jezero-ctx-dtm`), downloaded from `https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=…` |
| **File** | GeoTIFF, float32, uncompressed, 1596 × 1512 posts, 20 m post spacing; SHA-256 `46fb2e1e…c8e97e` (identical on 2026-11-05 and 2026-11-06) |
| **CRS** | Equirectangular, standard parallel 0°, Mars 2000 sphere R = 3,396,190 m (read from the GeoTIFF tags) |
| **Heights** | Metres relative to the areoid (product label: `MOLAtopography_DeltaGeoid`) |
| **Imagery** | Mars Trek `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` (source `trek-jezero-ctx-ortho`), WMTS tiles at z13 (≈ 5 m/px), mosaicked and resampled (bilinear) onto the crop's exact bounds |
| **Crop** | 160 × 160 posts (≈ 3.0 km E–W × 3.2 km N–S), bbox 77.31196–77.36595° E, 18.46071–18.51470° N. It contains Pelican Point, Lefroy Bay, Comet Geyser and the targets A–C |
| **Committed assets** | `public/terrain/ctx-lefroy-bay/heights.f32` (100 KB, float32 posts copied unchanged); `public/terrain/ctx-lefroy-bay/ortho.png` (629 × 629, 8-bit grey, 251 KB); `src/data/terrain/ctx-lefroy-bay.json` (all metadata, checksums and validation) |

No elevation is invented, resampled or quantised. Heights between posts are
read only to place a marker or report the elevation under the pointer, by
bilinear interpolation.

## Pipeline: `npm run build:terrain`, `npm run verify:terrain`

`scripts/build-ctx-terrain.mjs` runs these steps:
1. **Download** the DTM with `curl`, and **check its SHA-256** against the
   recorded value.
2. **Check the GeoTIFF tags:** float32, uncompressed, 20 m, Mars 2000 sphere,
   equirectangular with standard parallel 0. The corners computed from the
   tie point must reproduce the Trek catalog bbox in
   `src/data/geo/jezero-geo.json`. The maximum error was 4 × 10⁻⁸°.
3. **Crop** a square that contains every verified sample site and every
   simulated target. The build fails on any no-data value.
4. **Validate the elevations against PDS:** DTM − PDS must be within ±5 m at
   every sample site. Measured: Pelican Point −1.7 m, Lefroy Bay −3.2 m,
   Comet Geyser −2.6 m.
5. **Build the imagery crop** from the Trek tiles, and fail if any pixel is
   transparent (outside the mosaic).
6. **Run an alignment check (topographic shading).** The high-passed image
   brightness is correlated with the DTM slope along a fitted illumination
   azimuth, for shifts of ±4 posts.
   - **Result:** the best fit is at a shift of 1 post east (NCC 0.225, vs
     0.204 at zero), with the azimuth fitted at 110°.
   - **The build fails** if the peak is more than 2 posts away.
   - **What this shows:** it rules out a gross misregistration of 40 m or
     more. The correlation is modest, because albedo also varies, so it does
     **not** demonstrate sub-post (< 20 m) registration. The earlier,
     weaker gradient-magnitude test was discarded.
7. **Write** the assets and the metadata.

`verify:terrain` rebuilds from the live sources into a temporary folder and
compares the result with the committed files and metadata, ignoring the
retrieval date. On 2026-11-06 they were byte-identical.

## Coordinates (`src/lib/terrain/terrain.ts`, pure)

- **lon/lat:** degrees, planetocentric, east-positive. This is the same
  convention as `src/lib/geo` and the 2D map.
- **Grid:** post column and row inside the crop; a post's value sits at its
  centre.
- **Local metres:** a tangent plane at the crop centre, with
  east = Δλ·R·cos φ₀ and north = Δφ·R. The DTM grid has no cos φ factor, so
  this keeps east–west distances true (≈ 5 % at 18.5° N).
- **Imagery UV:** the same bounds as the heights, with u east and v south.

The unit tests (`terrain.test.ts`) check:
- the round trips;
- the crop corners as post edges;
- local distances against great-circle distances on the Mars sphere (within
  0.2 %);
- the scenario's target distances (118, 138 and 163 m);
- agreement between the UV and grid mappings (< 1 cm);
- the asset checksums;
- PDS agreement, recomputed;
- that all markers are inside the crop.

## Viewer (`src/components/terrain/`)

- **Rendering:** plain `three` 0.186.1, loaded client-side only, like the 2D
  map. The mesh has one vertex per 20 m post ("Low" quality uses every
  second post) and is shown at **1× vertical exaggeration** by default.
  2× and 3× are labelled "heights stretched; not true scale".
- **Markers:**
  - verified sample sites are cyan spheres;
  - simulated targets are coral diamonds, with the same tones and provisional
    rank badges as the 2D map;
  - the verified traverse is draped 2 m above the DTM.

  The labels are HTML buttons (keyboard, screen-reader and translation safe),
  and selecting one selects the task.
- **Selection is shared with 2D.** Switching keeps the selected target. The
  2D map stays mounted, so its view is kept too. On selection the camera
  re-centres and, if it is further than 1.4 km, comes closer.
- **Controls:** orbit, tilt and zoom (mouse, touch, and buttons usable by
  keyboard), and a reset.
- **Information shown:**
  - the source and resolution line;
  - the exaggeration;
  - the elevation under the pointer (read back from the DTM);
  - the selected marker's DTM elevation and its difference from Lefroy Bay.
    Differences under 5 m are called "not meaningful at this resolution",
    because the DTM agrees with PDS to within about 3 m.
- **Performance and motion:**
  - render on demand;
  - "Low" quality is the default on narrow or low-memory devices;
  - on phones the view controls start collapsed;
  - reduced motion turns off orbit inertia.
- **Fallback to 2D, with a plain-language reason,** if WebGL is unavailable,
  the data cannot be downloaded, its checksum does not match (verified in
  the browser with SubtleCrypto), or the WebGL context is lost. If only the
  imagery fails, the terrain is shown with slope shading and a notice.

## What it cannot show

- **Resolution:** at 20 m posts the effective resolution is about 60–100 m.
  No rocks or metre-scale relief, and nothing about traversability.
- **Area:** only this 3 km crop. The HiRISE 1 m DTM (1.84 GB) is not used.
- **Lighting:** a fixed directional light adds depth cues. It is not the
  illumination at the time of imaging.
- **No routes:** routes, travel times and route optimisation are out of
  scope (MAP-2 will add only labelled conceptual connections).
